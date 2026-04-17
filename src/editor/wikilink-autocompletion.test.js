/**
 * Test suite for WikiLink Auto-completion System
 * 
 * This test suite covers:
 * - Auto-completion trigger patterns
 * - Fuzzy matching algorithm
 * - Suggestion ranking and sorting
 * - Performance requirements (debouncing, limiting)
 * - Integration with CodeMirror 6 autocompletion system
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { 
  wikiLinkCompletionSource,
  fuzzyMatchNotes,
  extractCompletionContext,
  rankCompletions,
  WikiLinkAutocompletion
} from './wikilink-autocompletion.js'

// Mock Tauri API
const mockInvoke = jest.fn()
jest.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

// Mock vault notes for testing
const mockVaultNotes = [
  { name: 'Getting Started', path: 'Getting Started.md', title: 'Getting Started' },
  { name: 'Project Ideas', path: 'Project Ideas.md', title: 'Project Ideas' },
  { name: 'Daily Notes', path: 'Daily Notes.md', title: 'Daily Notes' },
  { name: 'Meeting Notes 2024', path: 'Meeting Notes 2024.md', title: 'Meeting Notes 2024' },
  { name: 'Research Paper', path: 'Research Paper.md', title: 'Research Paper' },
  { name: 'Quick Reference', path: 'Quick Reference.md', title: 'Quick Reference' },
  { name: 'Todo List', path: 'Todo List.md', title: 'Todo List' },
  { name: 'Book Recommendations', path: 'Book Recommendations.md', title: 'Book Recommendations' },
  { name: 'Learning Goals', path: 'Learning Goals.md', title: 'Learning Goals' },
  { name: 'Web Development', path: 'Web Development.md', title: 'Web Development' }
]

describe('WikiLink Auto-completion System', () => {
  let completionInstance
  
  beforeEach(() => {
    jest.clearAllMocks()
    mockInvoke.mockResolvedValue(mockVaultNotes)
    completionInstance = new WikiLinkAutocompletion()
  })
  
  afterEach(() => {
    jest.clearAllTimers()
    completionInstance?.destroy()
  })

  describe('Trigger Pattern Detection', () => {
    it('should trigger completion on [[ pattern', () => {
      const context = createMockCompletionContext('[[')
      const trigger = extractCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(0)
      expect(trigger.query).toBe('')
    })
    
    it('should trigger completion on [[partial pattern', () => {
      const context = createMockCompletionContext('[[project')
      const trigger = extractCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(2) // After [[
      expect(trigger.query).toBe('project')
    })
    
    it('should trigger completion with spaces in query', () => {
      const context = createMockCompletionContext('[[project idea')
      const trigger = extractCompletionContext(context)
      
      expect(trigger).toBeTruthy()
      expect(trigger.shouldTrigger).toBe(true)
      expect(trigger.from).toBe(2)
      expect(trigger.query).toBe('project idea')
    })
    
    it('should not trigger on single bracket', () => {
      const context = createMockCompletionContext('[project')
      const trigger = extractCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
    
    it('should not trigger on completed WikiLink', () => {
      const context = createMockCompletionContext('[[Project Ideas]]')
      const trigger = extractCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
    
    it('should not trigger when cursor is outside WikiLink', () => {
      const context = createMockCompletionContext('Some text [[note]] more text')
      context.pos = 25 // After the WikiLink
      const trigger = extractCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
    
    it('should handle nested brackets correctly', () => {
      const context = createMockCompletionContext('[[[not a wikilink')
      const trigger = extractCompletionContext(context)
      
      expect(trigger.shouldTrigger).toBe(false)
    })
  })

  describe('Fuzzy Matching Algorithm', () => {
    it('should find exact matches first', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'Project Ideas')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].note.name).toBe('Project Ideas')
      expect(results[0].score).toBeGreaterThan(0.9) // High score for exact match
    })
    
    it('should find partial matches', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'project')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.note.name === 'Project Ideas')).toBe(true)
    })
    
    it('should be case insensitive', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'PROJECT')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.note.name === 'Project Ideas')).toBe(true)
    })
    
    it('should match substring patterns', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'meeting')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.note.name === 'Meeting Notes 2024')).toBe(true)
    })
    
    it('should handle abbreviations', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'gs')
      
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.note.name === 'Getting Started')).toBe(true)
    })
    
    it('should rank closer matches higher', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'get')
      
      // "Getting Started" should rank higher than other matches
      const gettingStartedIndex = results.findIndex(r => r.note.name === 'Getting Started')
      expect(gettingStartedIndex).toBe(0) // Should be first result
    })
    
    it('should handle empty query gracefully', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, '')
      
      expect(results.length).toBe(mockVaultNotes.length) // Should return all notes
      expect(results.every(r => r.score >= 0)).toBe(true) // All should have valid scores
    })
    
    it('should handle query with no matches', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'xyznonexistent')
      
      expect(results.length).toBe(0)
    })
    
    it('should handle special characters in query', () => {
      const results = fuzzyMatchNotes(mockVaultNotes, 'note-2024')
      
      expect(results.some(r => r.note.name === 'Meeting Notes 2024')).toBe(true)
    })
  })

  describe('Completion Ranking and Sorting', () => {
    it('should rank by relevance score', () => {
      const matches = [
        { note: { name: 'Project Ideas' }, score: 0.9 },
        { note: { name: 'Daily Notes' }, score: 0.3 },
        { note: { name: 'Project Management' }, score: 0.7 }
      ]
      
      const ranked = rankCompletions(matches)
      
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score)
      expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score)
    })
    
    it('should prioritize exact matches', () => {
      const matches = [
        { note: { name: 'Project Management' }, score: 0.7 },
        { note: { name: 'Project' }, score: 1.0 }, // Exact match
        { note: { name: 'Project Ideas' }, score: 0.8 }
      ]
      
      const ranked = rankCompletions(matches)
      
      expect(ranked[0].note.name).toBe('Project')
    })
    
    it('should break ties by alphabetical order', () => {
      const matches = [
        { note: { name: 'Zebra' }, score: 0.5 },
        { note: { name: 'Apple' }, score: 0.5 },
        { note: { name: 'Banana' }, score: 0.5 }
      ]
      
      const ranked = rankCompletions(matches)
      
      expect(ranked[0].note.name).toBe('Apple')
      expect(ranked[1].note.name).toBe('Banana')
      expect(ranked[2].note.name).toBe('Zebra')
    })
    
    it('should limit results to specified maximum', () => {
      const manyMatches = Array.from({ length: 100 }, (_, i) => ({
        note: { name: `Note ${i}` },
        score: Math.random()
      }))
      
      const ranked = rankCompletions(manyMatches, 50)
      
      expect(ranked.length).toBe(50)
    })
  })

  describe('Performance Requirements', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })
    
    afterEach(() => {
      jest.useRealTimers()
    })
    
    it('should debounce completion requests', async () => {
      const spy = jest.spyOn(completionInstance, 'fetchVaultNotes')
      
      // Trigger multiple rapid completions
      completionInstance.triggerCompletion('[[pro')
      completionInstance.triggerCompletion('[[proj')
      completionInstance.triggerCompletion('[[project')
      
      // Should not have called the API yet
      expect(spy).not.toHaveBeenCalled()
      
      // Advance time by debounce delay (250ms)
      jest.advanceTimersByTime(250)
      
      // Now should have called API only once
      expect(spy).toHaveBeenCalledTimes(1)
    })
    
    it('should cancel previous requests when new one is made', async () => {
      const spy = jest.spyOn(completionInstance, 'fetchVaultNotes')
      
      completionInstance.triggerCompletion('[[old')
      jest.advanceTimersByTime(100) // Partial delay
      
      completionInstance.triggerCompletion('[[new')
      jest.advanceTimersByTime(250) // Full delay
      
      // Should have called API only once with the latest query
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenLastCalledWith('new')
    })
    
    it('should limit suggestions to maximum count', async () => {
      // Create a large number of mock notes
      const manyNotes = Array.from({ length: 200 }, (_, i) => ({
        name: `Note ${i}`,
        path: `Note ${i}.md`,
        title: `Note ${i}`
      }))
      
      mockInvoke.mockResolvedValue(manyNotes)
      
      const context = createMockCompletionContext('[[note')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result.options.length).toBeLessThanOrEqual(50)
    })
    
    it('should handle API errors gracefully', async () => {
      mockInvoke.mockRejectedValue(new Error('API Error'))
      
      const context = createMockCompletionContext('[[test')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBe(null) // Should not crash, return null for no completions
    })
  })

  describe('CodeMirror Integration', () => {
    it('should return proper completion format', async () => {
      const context = createMockCompletionContext('[[proj')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.from).toBe(2) // After [[
      expect(result.options).toBeInstanceOf(Array)
      expect(result.options.length).toBeGreaterThan(0)
      
      const option = result.options[0]
      expect(option.label).toBeTruthy()
      expect(option.apply).toBeTruthy()
      expect(option.info).toBeTruthy()
    })
    
    it('should apply completion with closing brackets', async () => {
      const context = createMockCompletionContext('[[proj')
      const result = await wikiLinkCompletionSource(context)
      
      const option = result.options[0]
      expect(typeof option.apply).toBe('string')
      expect(option.apply.endsWith(']]')).toBe(true)
    })
    
    it('should provide helpful completion info', async () => {
      const context = createMockCompletionContext('[[proj')
      const result = await wikiLinkCompletionSource(context)
      
      const option = result.options[0]
      expect(option.info).toContain('Navigate to')
      expect(option.type).toBe('wikilink')
    })
    
    it('should handle cursor position correctly', async () => {
      const context = createMockCompletionContext('Text [[proj more text')
      context.pos = 10 // In the middle of the WikiLink
      
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.from).toBe(7) // After [[ in the context
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle very short queries', async () => {
      const context = createMockCompletionContext('[[a')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.options).toBeInstanceOf(Array)
    })
    
    it('should handle very long queries', async () => {
      const longQuery = 'a'.repeat(1000)
      const context = createMockCompletionContext(`[[${longQuery}`)
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy() // Should not crash
    })
    
    it('should handle special characters in queries', async () => {
      const context = createMockCompletionContext('[[test@#$%^&*()')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy() // Should not crash
    })
    
    it('should handle unicode characters', async () => {
      const context = createMockCompletionContext('[[测试')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy() // Should not crash
    })
    
    it('should handle empty vault gracefully', async () => {
      mockInvoke.mockResolvedValue([])
      
      const context = createMockCompletionContext('[[test')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.options.length).toBe(0)
    })
    
    it('should handle malformed note data', async () => {
      mockInvoke.mockResolvedValue([
        { name: 'Good Note', path: 'good.md', title: 'Good Note' },
        { name: null, path: 'bad.md' }, // Malformed
        { name: 'Another Good Note', path: 'another.md', title: 'Another Good Note' }
      ])
      
      const context = createMockCompletionContext('[[good')
      const result = await wikiLinkCompletionSource(context)
      
      expect(result).toBeTruthy()
      expect(result.options.length).toBe(2) // Should filter out malformed data
    })
  })

  describe('Cache Management', () => {
    it('should cache vault notes for performance', async () => {
      const context = createMockCompletionContext('[[test')
      
      await wikiLinkCompletionSource(context)
      await wikiLinkCompletionSource(context)
      
      // Should have called the API only once due to caching
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
    
    it('should invalidate cache after timeout', async () => {
      jest.useRealTimers() // Need real timers for cache timeout
      
      const context = createMockCompletionContext('[[test')
      
      await wikiLinkCompletionSource(context)
      
      // Mock a cache timeout (would normally be 30 seconds)
      completionInstance.cacheTimestamp = Date.now() - 35000
      
      await wikiLinkCompletionSource(context)
      
      expect(mockInvoke).toHaveBeenCalledTimes(2)
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
        lineAt: (pos) => {
          // For simplicity, assume single line. In real CodeMirror, this would handle multiple lines.
          return {
            text: text,
            from: 0,
            to: text.length
          }
        },
        sliceString: (from, to) => {
          return text.slice(from, to)
        }
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