/**
 * WikiLink Auto-completion System
 * 
 * Provides intelligent auto-completion for WikiLinks when typing [[
 * Features:
 * - Fuzzy matching with relevance scoring
 * - Debounced API calls for performance
 * - Integration with CodeMirror 6 autocompletion
 * - Limited suggestions (50 max) with proper ranking
 * - Integration with existing WikiLink cache system
 */

import { CompletionContext } from '@codemirror/autocomplete'
import { wikiLinkCache } from './wikilink-cache.js'
import { autocompletion } from '@codemirror/autocomplete'

// Debounce configuration
let debounceTimer = null
const DEBOUNCE_DELAY = 250 // 250ms as specified

// Maximum number of suggestions to return
const MAX_SUGGESTIONS = 50

/**
 * WikiLink Auto-completion class for managing state and lifecycle
 */
export class WikiLinkAutocompletion {
  constructor() {
    this.cacheTimestamp = 0
    this.debounceTimer = null
  }
  
  /**
   * Trigger completion with debouncing
   */
  triggerCompletion(query) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    
    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          const result = await this.fetchVaultNotes(query)
          resolve(result)
        } catch (error) {
          console.error('Error in debounced completion:', error)
          resolve(null)
        }
      }, DEBOUNCE_DELAY)
    })
  }
  
  /**
   * Fetch vault notes using the existing cache system
   */
  async fetchVaultNotes(query = '') {
    try {
      return await wikiLinkCache.getVaultNotes()
    } catch (error) {
      console.error('Error fetching vault notes:', error)
      throw error
    }
  }
  
  /**
   * Cleanup resources
   */
  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}

/**
 * Extract completion context from the current editor position
 * Determines if we should trigger WikiLink completion and extracts the query
 */
export function extractCompletionContext(context) {
  const line = context.state.doc.lineAt(context.pos)
  const lineText = line.text.slice(0, context.pos - line.from)
  
  console.log('Checking completion context:', {
    lineText,
    pos: context.pos,
    lineFrom: line.from
  })
  
  // Look for [[ pattern followed by optional text (but not completed with ]])
  const wikiLinkPattern = /\[\[([^\]]*?)$/
  const match = wikiLinkPattern.exec(lineText)
  
  if (!match) {
    console.log('No WikiLink pattern found')
    return { shouldTrigger: false }
  }
  
  // Check if this is part of a triple bracket [[[
  const beforeMatch = lineText.slice(0, match.index)
  if (beforeMatch.endsWith('[')) {
    console.log('Triple bracket detected, skipping')
    return { shouldTrigger: false }
  }
  
  // Extract the query (text after [[)
  const query = match[1] || ''
  const from = line.from + match.index + 2 // Position after [[
  
  // Only trigger if user has started typing after [[
  // This prevents the popup from appearing immediately with all files
  if (query.length === 0) {
    console.log('WikiLink pattern detected but no query yet - not triggering')
    return { shouldTrigger: false }
  }
  
  console.log('WikiLink pattern detected:', {
    query,
    from,
    matchStart: line.from + match.index
  })
  
  return {
    shouldTrigger: true,
    query: query,
    from: from,
    matchStart: line.from + match.index
  }
}

/**
 * Fuzzy matching algorithm for note names
 * Returns array of matches with relevance scores
 */
export function fuzzyMatchNotes(notes, query) {
  if (!query) {
    // Return all notes with neutral score when no query
    return notes.map(note => ({ note, score: 0.5 }))
  }
  
  const queryLower = query.toLowerCase()
  const matches = []
  
  for (const note of notes) {
    if (!note.name) continue // Skip malformed notes
    
    const noteName = note.name.toLowerCase()
    const score = calculateFuzzyScore(noteName, queryLower)
    
    if (score > 0) {
      matches.push({ note, score })
    }
  }
  
  return matches
}

/**
 * Calculate fuzzy matching score between note name and query
 * Higher scores indicate better matches
 */
function calculateFuzzyScore(noteName, query) {
  if (!noteName || !query) return 0
  
  // Exact match gets highest score
  if (noteName === query) {
    return 1.0
  }
  
  // Case-insensitive exact match
  if (noteName.toLowerCase() === query.toLowerCase()) {
    return 0.95
  }
  
  // Starts with query
  if (noteName.startsWith(query)) {
    return 0.9
  }
  
  // Contains query as substring
  if (noteName.includes(query)) {
    // Score based on position (earlier is better) and length ratio
    const position = noteName.indexOf(query)
    const lengthRatio = query.length / noteName.length
    return 0.7 - (position * 0.1) + (lengthRatio * 0.2)
  }
  
  // Abbreviation matching (first letters of words)
  const words = noteName.split(/\s+/)
  const abbreviation = words.map(word => word[0]).join('').toLowerCase()
  if (abbreviation.startsWith(query)) {
    return 0.6
  }
  
  // Character-by-character fuzzy matching
  const fuzzyScore = calculateCharacterScore(noteName, query)
  if (fuzzyScore > 0.3) {
    return fuzzyScore
  }
  
  return 0 // No match
}

/**
 * Calculate character-by-character fuzzy matching score
 */
function calculateCharacterScore(text, query) {
  let textIndex = 0
  let queryIndex = 0
  let matches = 0
  
  while (textIndex < text.length && queryIndex < query.length) {
    if (text[textIndex].toLowerCase() === query[queryIndex].toLowerCase()) {
      matches++
      queryIndex++
    }
    textIndex++
  }
  
  if (queryIndex === query.length) {
    // All query characters found
    return (matches / text.length) * 0.5 // Max 0.5 for fuzzy matches
  }
  
  return 0
}

/**
 * Rank and sort completion matches
 * Returns sorted array limited to maxResults
 */
export function rankCompletions(matches, maxResults = MAX_SUGGESTIONS) {
  // Sort by score (descending), then by name (ascending) for ties
  const sorted = matches.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.001) {
      // Tie-breaker: alphabetical order
      return a.note.name.localeCompare(b.note.name)
    }
    return b.score - a.score
  })
  
  // Limit results
  return sorted.slice(0, maxResults)
}

/**
 * Main completion source function for CodeMirror
 * This is the entry point called by CodeMirror's autocompletion system
 */
export async function wikiLinkCompletionSource(context) {
  console.log('WikiLink completion source called')
  try {
    // Check if we should trigger completion
    const completionContext = extractCompletionContext(context)
    console.log('WikiLink completion context:', completionContext)
    if (!completionContext.shouldTrigger) {
      console.log('Not triggering WikiLink completion')
      return null
    }
    
    // Get cached notes or fetch fresh ones
    const notes = await getCachedVaultNotes()
    if (!notes || notes.length === 0) {
      return {
        from: completionContext.from,
        options: []
      }
    }
    
    // Perform fuzzy matching
    const matches = fuzzyMatchNotes(notes, completionContext.query)
    const rankedMatches = rankCompletions(matches)
    
    // Check if ]] already exists after cursor
    const textAfter = context.state.doc.sliceString(
      context.pos,
      Math.min(context.pos + 2, context.state.doc.length)
    )
    const needsClosingBrackets = textAfter !== ']]'
    
    console.log('Text after cursor:', JSON.stringify(textAfter))
    console.log('Text after length:', textAfter.length)
    
    // Convert to CodeMirror completion format
    const options = rankedMatches.map(match => {
      const completionText = needsClosingBrackets ? `${match.note.name}]]` : match.note.name;
      return {
        label: match.note.name,
        apply: completionText,
        type: 'wikilink',
        detail: match.note.path,
        info: `Navigate to "${match.note.name}"`,
        boost: Math.floor(match.score * 100) // Convert score to boost value
      }
    })
    
    console.log('WikiLink completion options:', options)
    console.log('Completion from position:', completionContext.from)
    console.log('Needs closing brackets:', needsClosingBrackets)
    
    const result = {
      from: completionContext.from,
      options: options,
      validFor: /^[^\]]*$/  // Continue showing while typing until ] is encountered
    }
    
    console.log('Returning completion result:', result)
    return result
    
  } catch (error) {
    console.error('Error in WikiLink completion:', error)
    return null
  }
}

/**
 * Get cached vault notes using the existing cache system
 */
async function getCachedVaultNotes() {
  try {
    return await wikiLinkCache.getVaultNotes()
  } catch (error) {
    console.error('Error fetching vault notes:', error)
    return []
  }
}

/**
 * Invalidate the notes cache
 * Call this when notes are added/removed/renamed
 */
export function invalidateNotesCache() {
  wikiLinkCache.invalidateAll()
}

/**
 * Create the WikiLink completion extension for CodeMirror
 */
export function createWikiLinkCompletion() {
  return autocompletion({
    // Use override to ensure our source is called
    override: [wikiLinkCompletionSource],
    activateOnTyping: true,
    maxRenderedOptions: 50,
    // Ensure completion stays open
    closeOnBlur: false,
    // Add explicit icons  
    icons: false
  })
}

// Export singleton instance for lifecycle management
export const wikiLinkAutocompletion = new WikiLinkAutocompletion()

// Clean up on module unload (if supported)
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('beforeunload', () => {
    wikiLinkAutocompletion.destroy()
  })
}