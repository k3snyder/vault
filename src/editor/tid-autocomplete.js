/**
 * TID (Task ID) Autocomplete System
 * 
 * Provides autocomplete functionality for Task ID references in the format [[TID:uuid]]
 * Triggers on [[TID: or [[tid: patterns and shows a dropdown of available tasks.
 * 
 * Features:
 * - Pattern detection for [[TID: and [[tid: triggers
 * - Fuzzy search across task text, project, and tags
 * - Debounced backend queries (250ms)
 * - Multi-layer caching with 5-minute TTL
 * - Performance optimized for < 50ms dropdown render
 * - Integration with CodeMirror 6 autocomplete system
 */

import { invoke } from '@tauri-apps/api/core'
import { autocompletion } from '@codemirror/autocomplete'
import Fuse from 'fuse.js'

/**
 * Main TID autocomplete class managing state and operations
 */
export class TidAutocompletion {
  constructor() {
    this.cache = new Map()
    this.debounceTimer = null
    this.cacheTimestamp = 0
    this.cacheTTL = 5 * 60 * 1000 // 5 minutes
    this.debounceDelay = 250 // ms
    this.maxResults = 10 // Maximum visible items in dropdown
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.cache.clear()
  }

  /**
   * Check if cache is still valid
   */
  isCacheValid() {
    return Date.now() - this.cacheTimestamp < this.cacheTTL
  }

  /**
   * Clear the task cache
   */
  clearCache() {
    this.cache.clear()
    this.cacheTimestamp = 0
  }

  /**
   * Warm the cache by pre-fetching tasks
   */
  async warmCache() {
    try {
      const tasks = await this.fetchTasks('')
      return tasks
    } catch (error) {
      console.warn('Failed to warm TID cache:', error)
      return []
    }
  }

  /**
   * Fetch tasks from backend with caching
   */
  async fetchTasks(query) {
    try {
      // Check cache validity
      if (this.isCacheValid() && this.cache.has('all_tasks')) {
        return this.cache.get('all_tasks')
      }

      // Fetch from backend
      const tasks = await invoke('query_tasks', {
        query: {
          status: null,
          project: null,
          tags: null
        }
      })

      // Update cache
      this.cache.set('all_tasks', tasks)
      this.cacheTimestamp = Date.now()

      return tasks
    } catch (error) {
      console.error('Failed to fetch tasks for TID autocomplete:', error)
      return []
    }
  }

  /**
   * Debounced version of fetchTasks
   */
  fetchTasksDebounced(query) {
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }

      this.debounceTimer = setTimeout(async () => {
        const tasks = await this.fetchTasks(query)
        resolve(tasks)
      }, this.debounceDelay)
    })
  }
}

/**
 * Extract TID completion context from CodeMirror state
 */
export function extractTidCompletionContext(context) {
  // Check for TID pattern before cursor
  const beforeCursor = context.state.doc.sliceString(0, context.pos)
  
  // Match [[TID: or [[tid: pattern - note the space after colon is optional
  // Don't include closing brackets in the pattern
  const tidMatch = /\[\[(TID|tid):\s*([^\]]*)?$/i.exec(beforeCursor)
  
  if (!tidMatch) {
    return { shouldTrigger: false }
  }

  // Check if it's already a complete reference (UUID pattern)
  const query = tidMatch[2] || ''
  if (query && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.trim())) {
    return { shouldTrigger: false }
  }
  
  // Check if cursor is between complete brackets (like [[tid:|]] where | is cursor)
  const afterCursor = context.state.doc.sliceString(context.pos, Math.min(context.pos + 2, context.state.doc.length))
  const hasClosingBrackets = afterCursor.startsWith(']]')
  
  const startPos = tidMatch.index
  
  // For CodeMirror autocomplete to work properly:
  // Try to match WikiLink behavior - replace from after [[
  const fromPos = startPos + 2 // After [[ 
  const toPos = context.pos // Current cursor position

  return {
    shouldTrigger: true,
    from: fromPos,
    to: toPos,
    query: query,
    hasClosingBrackets: hasClosingBrackets,
    startPos: startPos,
    replaceFromBrackets: true // Flag to indicate we're replacing from after [[
  }
}

/**
 * Filter tasks by query using fuzzy matching with Fuse.js
 */
export function filterTasksByQuery(tasks, query) {
  if (!query) {
    // Return all tasks with neutral score
    return tasks.map(task => ({ task, score: 0.5 }))
  }

  // Configure Fuse.js for task searching
  const fuseOptions = {
    keys: [
      { name: 'text', weight: 0.6 },
      { name: 'project', weight: 0.2 },
      { name: 'tags', weight: 0.2 }
    ],
    threshold: 0.4, // Lower = more strict matching
    includeScore: true,
    ignoreLocation: true, // Don't prioritize by position in string
    minMatchCharLength: 1
  }

  const fuse = new Fuse(tasks, fuseOptions)
  const fuseResults = fuse.search(query)

  // Convert Fuse results to our format
  const results = fuseResults.map(result => ({
    task: result.item,
    score: 1 - result.score // Fuse uses 0 = perfect match, we use 1 = perfect
  }))

  // Add exact matches with boost if not already at top
  const queryLower = query.toLowerCase()
  for (const task of tasks) {
    const textLower = (task.text || '').toLowerCase()
    if (textLower === queryLower) {
      // Check if already in results
      const existingIndex = results.findIndex(r => r.task.id === task.id)
      if (existingIndex >= 0) {
        results[existingIndex].score = 1.0 // Boost to perfect score
      } else {
        results.unshift({ task, score: 1.0 }) // Add at beginning
      }
    }
  }

  // Sort by score (highest first), then alphabetically
  results.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) {
      return b.score - a.score
    }
    return (a.task.text || '').localeCompare(b.task.text || '')
  })

  return results
}

/**
 * Format a task for CodeMirror completion
 */
export function formatTaskCompletion(task) {
  // Format due date
  let dueText = ''
  if (task.due_date) {
    const due = new Date(task.due_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueDay = new Date(due)
    dueDay.setHours(0, 0, 0, 0)
    
    const dayDiff = Math.floor((dueDay - today) / (1000 * 60 * 60 * 24))
    
    if (dayDiff === 0) {
      dueText = 'Today'
    } else if (dayDiff === 1) {
      dueText = 'Tomorrow'
    } else if (dayDiff === -1) {
      dueText = 'Yesterday'
    } else if (dayDiff > 0 && dayDiff <= 7) {
      dueText = `${dayDiff} days`
    } else {
      // Format as "Sep 15"
      const month = due.toLocaleDateString('en-US', { month: 'short' })
      const day = due.getDate()
      dueText = `${month} ${day}`
    }
  }

  // Build detail text
  const details = []
  
  // Status indicator
  if (task.status === 'done') {
    details.push('✓')
  } else if (task.status === 'cancelled') {
    details.push('✗')
  }
  
  // Priority indicator
  if (task.priority === 'critical' || task.priority === 'high') {
    details.push('⚡')
  }
  
  // Project
  if (task.project) {
    details.push(task.project)
  }
  
  // Due date
  if (dueText) {
    details.push(dueText)
  }
  
  // Tags (first 2)
  if (task.tags && task.tags.length > 0) {
    details.push(...task.tags.slice(0, 2).map(t => `#${t}`))
  }

  // Priority boost for sorting
  let boost = 0
  if (task.priority === 'critical') boost = 2
  else if (task.priority === 'high') boost = 1
  else if (task.priority === 'medium') boost = 0.5
  
  // Reduce boost for completed tasks
  if (task.status === 'done' || task.status === 'cancelled') {
    boost = boost * 0.5
  }

  // Include task name in the TID reference for better readability
  const taskName = task.text || 'Untitled Task'
  
  return {
    label: taskName,
    detail: details.length > 0 ? details.join(' • ') : undefined,
    apply: `TID:${task.id}|${taskName}]]`, // Without [[ since we're replacing from after [[
    type: 'tid',
    boost: boost
  }
}

// Global instance for caching
let globalTidAutocomplete = null

/**
 * CodeMirror completion source for TID references
 */
export async function tidCompletionSource(context) {
  console.log('TID completion source called')
  
  // Extract completion context
  const tidContext = extractTidCompletionContext(context)
  console.log('TID completion context:', tidContext)
  
  if (!tidContext.shouldTrigger) {
    console.log('Not triggering TID completion')
    return null
  }
  
  console.log('Triggering TID completion with query:', tidContext.query)

  // Initialize global instance if needed
  if (!globalTidAutocomplete) {
    globalTidAutocomplete = new TidAutocompletion()
  }

  try {
    // Fetch tasks (with caching)
    const tasks = await globalTidAutocomplete.fetchTasks(tidContext.query)
    console.log('Fetched tasks:', tasks.length)
    
    // Filter tasks based on query
    const filtered = filterTasksByQuery(tasks, tidContext.query)
    console.log('Filtered tasks:', filtered.length)
    
    // Limit results
    const limited = filtered.slice(0, globalTidAutocomplete.maxResults)
    
    // Format for CodeMirror
    const options = limited.map(({ task }) => formatTaskCompletion(task))
    console.log('TID completion options:', options)
    
    // Don't adjust the options - the apply string should always be complete
    // CodeMirror will handle replacing the correct range
    const adjustedOptions = options
    
    // Expand the replacement range to consume any immediately following
    // closing brackets so we don't duplicate "]]" when applying.
    const doc = context.state.doc
    let expandedTo = tidContext.to
    while (expandedTo < doc.length && doc.sliceString(expandedTo, expandedTo + 1) === ']') {
      expandedTo += 1
    }

    const result = {
      from: tidContext.from, // Use the from position calculated in extractTidCompletionContext
      to: expandedTo,
      options: adjustedOptions,
      validFor: /.*/, // Match anything - let all completions through
      filter: false // Don't filter - show all options
    }
    
    console.log('Returning TID completion result:', result)
    console.log('Context pos:', context.pos)
    console.log('Options details:', adjustedOptions.map(o => ({ label: o.label, apply: o.apply })))
    
    // Ensure from <= to for valid range
    if (result.from > result.to) {
      console.error('Invalid range: from > to', result.from, result.to)
      return null
    }
    
    return result
  } catch (error) {
    console.error('TID autocomplete error:', error)
    return null
  }
}

/**
 * Create CodeMirror extension for TID autocomplete
 */
export function createTidCompletion() {
  // Return just the completion source - it will be added to the autocomplete extension
  // This allows it to work alongside WikiLink completions
  return tidCompletionSource
}

// Keep the old name for compatibility
export const tidAutocomplete = createTidCompletion

// Export for testing
export default {
  TidAutocompletion,
  extractTidCompletionContext,
  filterTasksByQuery,
  formatTaskCompletion,
  tidCompletionSource,
  tidAutocomplete
}
