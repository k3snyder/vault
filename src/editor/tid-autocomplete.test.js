/**
 * Test suite for TID (Task ID) Autocomplete System
 * 
 * This test suite covers:
 * - TID pattern trigger detection (`[[TID:` and `[[tid:`)
 * - Task fetching with debouncing
 * - Fuzzy matching with task metadata
 * - Cache management and invalidation
 * - Performance requirements (< 50ms dropdown, < 100ms query)
 * - Integration with CodeMirror 6 autocompletion
 * - Edge cases and error handling
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { 
  tidCompletionSource,
  TidAutocompletion,
  extractTidCompletionContext,
  filterTasksByQuery,
  formatTaskCompletion
} from './tid-autocomplete.js'

// Mock Tauri API
const mockInvoke = jest.fn()
jest.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

// Mock task data for testing
const mockTasks = [
  {
    id: '01938e5a-1234-5678-9abc-def012345678',
    text: 'Implement user authentication',
    file_path: 'projects/app-dev.md',
    status: 'todo',
    due_date: '2025-09-15',
    priority: 'high',
    tags: ['backend', 'security'],
    project: 'webapp-v2'
  },
  {
    id: '01938e5a-2345-6789-abcd-ef0123456789',
    text: 'Write unit tests for auth module',
    file_path: 'projects/app-dev.md',
    status: 'todo',
    due_date: '2025-09-20',
    priority: 'medium',
    tags: ['testing', 'backend'],
    project: 'webapp-v2'
  },
  {
    id: '01938e5a-3456-789a-bcde-f01234567890',
    text: 'Update documentation',
    file_path: 'docs/tasks.md',
    status: 'done',
    due_date: null,
    priority: 'low',
    tags: ['docs'],
    project: null
  },
  {
    id: '01938e5a-4567-89ab-cdef-012345678901',
    text: 'Review PR #123',
    file_path: 'daily/2025-08-30.md',
    status: 'todo',
    due_date: '2025-08-30',
    priority: 'high',
    tags: ['review'],
    project: 'webapp-v2'
  },
  {
    id: '01938e5a-5678-9abc-def0-123456789012',
    text: 'Fix memory leak in task processor',
    file_path: 'bugs/critical.md',
    status: 'cancelled',
    due_date: null,
    priority: 'critical',
    tags: ['bug', 'performance'],
    project: 'core-engine'
  }
]

describe('TID Autocomplete System', () => {
  let tidAutocomplete
  
  beforeEach(() => {
    jest.clearAllMocks()
    mockInvoke.mockResolvedValue(mockTasks)
    tidAutocomplete = new TidAutocompletion()
  })
  
  afterEach(() => {
    jest.clearAllTimers()
    tidAutocomplete?.destroy()
  })

  describe('TID Pattern Detection', () => {
    it('should trigger on [[TID: pattern', () => {
      const context = createMockCompletionContext('[[TID:')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(6) // Should equal to position when no query
      expect(trigger.to).toBe(6) // Cursor position
      expect(trigger.query).toBe('')
    })
    
    it('should trigger on [[tid: pattern (case-insensitive)', () => {
      const context = createMockCompletionContext('[[tid:')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(6) // Should equal to position when no query
      expect(trigger.to).toBe(6) // Cursor position
      expect(trigger.query).toBe('')
    })
    
    it('should extract partial query after colon', () => {
      const context = createMockCompletionContext('[[TID:auth')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(6) // After [[TID:
      expect(trigger.query).toBe('auth')
    })
    
    it('should handle queries with spaces', () => {
      const context = createMockCompletionContext('[[TID:user auth')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.query).toBe('user auth')
    })
    
    it('should not trigger on completed TID reference', () => {
      const context = createMockCompletionContext('[[TID:01938e5a-1234-5678-9abc-def012345678]]')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
    
    it('should not trigger on WikiLink pattern', () => {
      const context = createMockCompletionContext('[[Some Note]]')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
    
    it('should not trigger without colon', () => {
      const context = createMockCompletionContext('[[TID')
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
    
    it('should handle cursor position in middle of text', () => {
      const context = createMockCompletionContext('Task depends on [[TID:auth more text')
      context.pos = 26 // After [[TID:auth
      const trigger = extractTidCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(22) // After [[TID:
      expect(trigger.query).toBe('auth')
    })
  })

  describe('Task Fetching and Backend Integration', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })
    
    afterEach(() => {
      jest.useRealTimers()
    })
    
    it('should fetch tasks from backend', async () => {
      const tasks = await tidAutocomplete.fetchTasks('')
      
      expect(mockInvoke).toHaveBeenCalledWith('query_tasks', {
        query: {
          status: null,
          project: null,
          tags: null
        }
      })
      expect(tasks).toEqual(mockTasks)
    })
    
    it('should debounce task fetching (250ms)', async () => {
      const spy = jest.spyOn(tidAutocomplete, 'fetchTasksDebounced')
      
      // Trigger multiple rapid queries
      tidAutocomplete.fetchTasksDebounced('a')
      tidAutocomplete.fetchTasksDebounced('au')
      tidAutocomplete.fetchTasksDebounced('auth')
      
      // Should not have called backend yet
      expect(mockInvoke).not.toHaveBeenCalled()
      
      // Advance time by debounce delay
      jest.advanceTimersByTime(250)
      
      // Should have called backend only once with latest query
      await Promise.resolve() // Let promises resolve
      expect(spy).toHaveBeenCalledTimes(3)
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
    
    it('should handle backend errors gracefully', async () => {
      mockInvoke.mockRejectedValue(new Error('Backend error'))
      
      const tasks = await tidAutocomplete.fetchTasks('')
      
      expect(tasks).toEqual([]) // Should return empty array on error
    })
    
    it('should handle concurrent requests properly', async () => {
      // Simulate slow backend response
      let resolveFirst
      const firstPromise = new Promise(resolve => {
        resolveFirst = resolve
      })
      
      mockInvoke.mockImplementationOnce(() => firstPromise)
      mockInvoke.mockImplementationOnce(() => Promise.resolve(mockTasks))
      
      // Start first request
      const firstRequest = tidAutocomplete.fetchTasks('first')
      
      // Start second request before first completes
      const secondRequest = tidAutocomplete.fetchTasks('second')
      
      // Resolve first request
      resolveFirst([])
      
      const firstResult = await firstRequest
      const secondResult = await secondRequest
      
      // Second request should not be cancelled
      expect(secondResult).toEqual(mockTasks)
    })
  })

  describe('Fuzzy Matching and Filtering', () => {
    it('should find exact matches with highest score', () => {
      const results = filterTasksByQuery(mockTasks, 'Review PR #123')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].task.text).toBe('Review PR #123')
      expect(results[0].score).toBeGreaterThan(0.9)
    })
    
    it('should find partial matches', () => {
      const results = filterTasksByQuery(mockTasks, 'auth')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.task.text.includes('authentication'))).toBe(true)
      expect(results.some(r => r.task.text.includes('auth module'))).toBe(true)
    })
    
    it('should be case insensitive', () => {
      const results = filterTasksByQuery(mockTasks, 'AUTH')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.task.text.includes('authentication'))).toBe(true)
    })
    
    it('should search in project names', () => {
      const results = filterTasksByQuery(mockTasks, 'webapp')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.every(r => r.task.project === 'webapp-v2')).toBe(true)
    })
    
    it('should search in tags', () => {
      const results = filterTasksByQuery(mockTasks, 'backend')
      
      expect(results.length).toBe(2)
      expect(results.every(r => r.task.tags.includes('backend'))).toBe(true)
    })
    
    it('should handle empty query by returning all tasks', () => {
      const results = filterTasksByQuery(mockTasks, '')
      
      expect(results.length).toBe(mockTasks.length)
      expect(results.every(r => r.score >= 0)).toBe(true)
    })
    
    it('should rank by relevance score', () => {
      const results = filterTasksByQuery(mockTasks, 'test')
      
      // "Write unit tests" should rank higher than other partial matches
      expect(results[0].task.text).toContain('tests')
      expect(results[0].score).toBeGreaterThan(results[results.length - 1].score)
    })
    
    it('should handle special characters in query', () => {
      const results = filterTasksByQuery(mockTasks, 'PR #123')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].task.text).toBe('Review PR #123')
    })
    
    it('should filter by task status when specified', () => {
      const todoTasks = mockTasks.filter(t => t.status === 'todo')
      const results = filterTasksByQuery(todoTasks, '')
      
      expect(results.every(r => r.task.status === 'todo')).toBe(true)
    })
    
    it('should handle no matches gracefully', () => {
      const results = filterTasksByQuery(mockTasks, 'xyznonexistent')
      
      expect(results).toEqual([])
    })
  })

  describe('Completion Formatting', () => {
    it('should format task with all metadata', () => {
      const task = mockTasks[0] // High priority task with due date
      const completion = formatTaskCompletion(task)
      
      expect(completion.label).toBe('Implement user authentication')
      expect(completion.detail).toContain('webapp-v2')
      expect(completion.detail).toContain('Sep 15')
      expect(completion.apply).toBe(`[[TID:${task.id}]]`)
      expect(completion.type).toBe('tid')
      expect(completion.boost).toBe(1) // High priority boost
    })
    
    it('should format task without optional fields', () => {
      const task = mockTasks[2] // No project, no due date
      const completion = formatTaskCompletion(task)
      
      expect(completion.label).toBe('Update documentation')
      expect(completion.detail).not.toContain('null')
      expect(completion.apply).toBe(`[[TID:${task.id}]]`)
    })
    
    it('should include priority indicator', () => {
      const highPriorityTask = mockTasks[0]
      const completion = formatTaskCompletion(highPriorityTask)
      
      expect(completion.detail).toContain('⚡')
      expect(completion.boost).toBe(1)
    })
    
    it('should include status indicator', () => {
      const doneTask = mockTasks[2]
      const completion = formatTaskCompletion(doneTask)
      
      expect(completion.detail).toContain('✓')
    })
    
    it('should format due date nicely', () => {
      const task = {
        ...mockTasks[0],
        due_date: new Date().toISOString().split('T')[0] // Today
      }
      const completion = formatTaskCompletion(task)
      
      expect(completion.detail).toContain('Today')
    })
    
    it('should provide helpful info text', () => {
      const task = mockTasks[0]
      const completion = formatTaskCompletion(task)
      
      expect(completion.info).toContain('Insert reference to task')
      expect(completion.info).toContain(task.text)
    })
  })

  describe('Cache Management', () => {
    it('should cache tasks for performance', async () => {
      await tidAutocomplete.fetchTasks('')
      await tidAutocomplete.fetchTasks('')
      
      // Should have called backend only once due to caching
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
    
    it('should invalidate cache after TTL (5 minutes)', async () => {
      await tidAutocomplete.fetchTasks('')
      
      // Mock cache timeout
      tidAutocomplete.cacheTimestamp = Date.now() - (5 * 60 * 1000 + 1000) // 5 minutes + 1 second
      
      await tidAutocomplete.fetchTasks('')
      
      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })
    
    it('should invalidate cache on explicit clear', async () => {
      await tidAutocomplete.fetchTasks('')
      
      tidAutocomplete.clearCache()
      
      await tidAutocomplete.fetchTasks('')
      
      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })
    
    it('should warm cache on editor focus', async () => {
      await tidAutocomplete.warmCache()
      
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(tidAutocomplete.cache.size).toBeGreaterThan(0)
    })
  })

  describe('CodeMirror Integration', () => {
    it('should return proper completion format', async () => {
      const context = createMockCompletionContext('[[TID:auth')
      const result = await tidCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.from).toBe(6) // After [[TID:
      expect(result.options).toBeInstanceOf(Array)
      expect(result.options.length).toBeGreaterThan(0)
      
      const option = result.options[0]
      expect(option.label).toBeTruthy()
      expect(option.apply).toContain('[[TID:')
      expect(option.apply).toContain(']]')
      expect(option.type).toBe('tid')
    })
    
    it('should handle cursor position correctly', async () => {
      const context = createMockCompletionContext('Blocked by [[TID:rev more text')
      context.pos = 20 // After [[TID:rev
      
      const result = await tidCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.from).toBe(17) // After [[TID:
    })
    
    it('should limit dropdown to maximum items', async () => {
      // Create many tasks
      const manyTasks = Array.from({ length: 100 }, (_, i) => ({
        id: `0193-${i}`,
        text: `Task ${i}`,
        file_path: 'tasks.md',
        status: 'todo'
      }))
      
      mockInvoke.mockResolvedValue(manyTasks)
      
      const context = createMockCompletionContext('[[TID:')
      const result = await tidCompletionSource(context)
      
      expect(result.options.length).toBeLessThanOrEqual(10) // Max 10 visible
    })
    
    it('should handle empty task list', async () => {
      mockInvoke.mockResolvedValue([])
      
      const context = createMockCompletionContext('[[TID:test')
      const result = await tidCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.options).toEqual([])
    })
    
    it('should return null when not triggered', async () => {
      const context = createMockCompletionContext('[[WikiLink]]')
      const result = await tidCompletionSource(context)
      
      expect(result).toBe(null)
    })
  })

  describe('Performance Requirements', () => {
    it('should detect pattern in < 10ms', () => {
      const context = createMockCompletionContext('[[TID:test')
      
      const start = performance.now()
      const trigger = extractTidCompletionContext(context)
      const end = performance.now()
      
      expect(end - start).toBeLessThan(10)
      expect(trigger.shouldTrigger).toBe(true)
    })
    
    it('should render dropdown in < 50ms', async () => {
      // Pre-cache tasks
      await tidAutocomplete.warmCache()
      
      const context = createMockCompletionContext('[[TID:auth')
      
      const start = performance.now()
      const result = await tidCompletionSource(context)
      const end = performance.now()
      
      expect(end - start).toBeLessThan(50)
      expect(result).toBeTruthy()
    })
    
    it('should handle 1000+ tasks efficiently', async () => {
      const largeTasks = Array.from({ length: 1000 }, (_, i) => ({
        id: `0193-${i}`,
        text: `Task ${i} with some description`,
        file_path: 'tasks.md',
        status: i % 3 === 0 ? 'done' : 'todo',
        tags: [`tag${i % 10}`]
      }))
      
      mockInvoke.mockResolvedValue(largeTasks)
      
      const start = performance.now()
      const results = filterTasksByQuery(largeTasks, 'Task 500')
      const end = performance.now()
      
      expect(end - start).toBeLessThan(100) // Should filter quickly
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle very short queries', async () => {
      const context = createMockCompletionContext('[[TID:a')
      const result = await tidCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.options).toBeInstanceOf(Array)
    })
    
    it('should handle very long queries', async () => {
      const longQuery = 'a'.repeat(500)
      const context = createMockCompletionContext(`[[TID:${longQuery}`)
      const result = await tidCompletionSource(context)
      
      expect(result).toBeTruthy() // Should not crash
    })
    
    it('should handle special characters in task text', () => {
      const specialTasks = [{
        id: '123',
        text: 'Fix bug: @#$%^&*() [special] {chars}',
        file_path: 'test.md',
        status: 'todo'
      }]
      
      const results = filterTasksByQuery(specialTasks, '@#$')
      
      expect(results.length).toBe(1)
    })
    
    it('should handle unicode in task text', () => {
      const unicodeTasks = [{
        id: '123',
        text: '完成测试 🎯 Unicode task',
        file_path: 'test.md',
        status: 'todo'
      }]
      
      const results = filterTasksByQuery(unicodeTasks, '测试')
      
      expect(results.length).toBe(1)
    })
    
    it('should handle malformed task data', async () => {
      mockInvoke.mockResolvedValue([
        { id: '1', text: 'Good task', status: 'todo' },
        { id: null, text: 'Bad task' }, // Missing ID
        { id: '2', text: null, status: 'todo' }, // Missing text
        { id: '3', text: 'Another good task', status: 'todo' }
      ])
      
      const tasks = await tidAutocomplete.fetchTasks('')
      const validTasks = tasks.filter(t => t.id && t.text)
      
      expect(validTasks.length).toBe(2)
    })
    
    it('should handle network timeout gracefully', async () => {
      // Simulate timeout
      mockInvoke.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 1000)
        )
      )
      
      const tasks = await tidAutocomplete.fetchTasks('')
      
      expect(tasks).toEqual([])
    })
    
    it('should handle rapid typing and cancellation', async () => {
      jest.useFakeTimers()
      
      const spy = jest.spyOn(tidAutocomplete, 'fetchTasksDebounced')
      
      // Simulate rapid typing
      for (let i = 0; i < 10; i++) {
        tidAutocomplete.fetchTasksDebounced(`query${i}`)
        jest.advanceTimersByTime(50) // Less than debounce delay
      }
      
      // Final query
      tidAutocomplete.fetchTasksDebounced('final')
      jest.advanceTimersByTime(250)
      
      // Should only execute with final query
      await Promise.resolve()
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      
      jest.useRealTimers()
    })
  })

  describe('Memory Management', () => {
    it('should clean up on destroy', () => {
      const instance = new TidAutocompletion()
      
      instance.cache.set('test', mockTasks)
      instance.debounceTimer = setTimeout(() => {}, 1000)
      
      instance.destroy()
      
      expect(instance.cache.size).toBe(0)
      expect(instance.debounceTimer).toBe(null)
    })
    
    it('should not leak memory with large task lists', async () => {
      const largeTasks = Array.from({ length: 5000 }, (_, i) => ({
        id: `0193-${i}`,
        text: `Task ${i}`,
        file_path: 'tasks.md',
        status: 'todo'
      }))
      
      mockInvoke.mockResolvedValue(largeTasks)
      
      // Perform multiple operations
      for (let i = 0; i < 10; i++) {
        await tidAutocomplete.fetchTasks(`query${i}`)
        tidAutocomplete.clearCache()
      }
      
      // Cache should be cleared
      expect(tidAutocomplete.cache.size).toBe(0)
    })
  })
})

// Helper function to create mock completion context
function createMockCompletionContext(text, pos = null) {
  const actualPos = pos !== null ? pos : text.length
  
  return {
    state: {
      doc: {
        toString: () => text,
        length: text.length,
        lineAt: (pos) => ({
          text: text,
          from: 0,
          to: text.length
        }),
        sliceString: (from, to) => text.slice(from, to)
      }
    },
    pos: actualPos,
    matchBefore: (regex) => {
      const beforeCursor = text.slice(0, actualPos)
      const match = regex.exec(beforeCursor)
      
      if (match && match.index + match[0].length === actualPos) {
        return {
          from: match.index,
          to: actualPos,
          text: match[0]
        }
      }
      return null
    }
  }
}