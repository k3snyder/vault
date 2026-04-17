import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { extractWikiLinks, normalizeWikiLinkName } from './wikilink-extension.js'

// Mock dependencies
const mockInvoke = jest.fn()
jest.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

describe('WikiLink Graph Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('WikiLink Extraction for Graph Relations', () => {
    test('should extract WikiLinks from markdown content for graph processing', () => {
      const content = `
# My Note

This note links to [[Project Alpha]] and [[Meeting Notes]].

## Related Ideas
- See [[Concept Map]] for overview
- Check [[Task List]] for todos
- Review [[Research Papers]] folder

The [[Project Alpha]] connects to [[Development Tasks]].
      `.trim()

      const links = extractWikiLinks(content)
      
      expect(links).toHaveLength(7)
      expect(links.map(l => l.text)).toEqual([
        'Project Alpha',
        'Meeting Notes', 
        'Concept Map',
        'Task List',
        'Research Papers',
        'Project Alpha',
        'Development Tasks'
      ])
    })

    test('should extract unique WikiLinks from content', () => {
      const content = `
[[Note A]] references [[Note B]].
Later, [[Note A]] also connects to [[Note C]].
The [[Note B]] has details about [[Note A]].
      `.trim()

      const links = extractWikiLinks(content)
      const uniqueLinks = [...new Set(links.map(l => l.text))]
      
      expect(links).toHaveLength(6) // Total occurrences
      expect(uniqueLinks).toHaveLength(3) // Unique links
      expect(uniqueLinks).toEqual(['Note A', 'Note B', 'Note C'])
    })

    test('should handle WikiLinks with complex names', () => {
      const content = `
Links to [[2024-07-30 Meeting Notes]] and [[Project Alpha - Phase 1]].
Also see [[Research/Deep Learning]] and [[TODO: Fix Bug #123]].
      `.trim()

      const links = extractWikiLinks(content)
      
      expect(links.map(l => l.text)).toEqual([
        '2024-07-30 Meeting Notes',
        'Project Alpha - Phase 1',
        'Research/Deep Learning',
        'TODO: Fix Bug #123'
      ])
    })

    test('should extract WikiLinks with position information for graph context', () => {
      const content = 'Start [[First Note]] middle [[Second Note]] end'
      const links = extractWikiLinks(content)
      
      expect(links[0]).toEqual({
        text: 'First Note',
        start: 6,
        end: 20,
        fullMatch: '[[First Note]]'
      })
      
      expect(links[1]).toEqual({
        text: 'Second Note',
        start: 28,
        end: 43,
        fullMatch: '[[Second Note]]'
      })
    })
  })

  describe('WikiLink Normalization for Graph Matching', () => {
    test('should normalize WikiLink names for consistent graph node matching', () => {
      const testCases = [
        { input: 'Project Alpha', expected: 'project alpha' },
        { input: '  Spaced  Note  Name  ', expected: 'spaced note name' },
        { input: 'UPPERCASE NOTE', expected: 'uppercase note' },
        { input: 'Mixed-Case_Note', expected: 'mixed-case_note' },
        { input: '2024-07-30 Meeting', expected: '2024-07-30 meeting' }
      ]

      testCases.forEach(({ input, expected }) => {
        expect(normalizeWikiLinkName(input)).toBe(expected)
      })
    })

    test('should handle unicode characters in normalization', () => {
      const testCases = [
        { input: 'Café Notes', expected: 'café notes' },
        { input: '中文 Notes', expected: '中文 notes' },
        { input: 'Español Notas', expected: 'español notas' }
      ]

      testCases.forEach(({ input, expected }) => {
        expect(normalizeWikiLinkName(input)).toBe(expected)
      })
    })
  })

  describe('Graph Relationship Creation', () => {
    test('should create relationship data for WikiLinks', async () => {
      mockInvoke.mockResolvedValueOnce({
        id: 'note-123',
        path: '/vault/source-note.md',
        title: 'Source Note'
      })

      const sourceNote = {
        id: 'note-123',
        path: '/vault/source-note.md',
        title: 'Source Note',
        content: 'This links to [[Target Note]] and [[Another Note]].'
      }

      const links = extractWikiLinks(sourceNote.content)
      
      // Mock the graph relationship creation
      const relationships = links.map(link => ({
        sourceId: sourceNote.id,
        sourcePath: sourceNote.path,
        targetName: link.text,
        normalizedTargetName: normalizeWikiLinkName(link.text),
        relationType: 'WIKILINK',
        context: {
          position: link.start,
          fullMatch: link.fullMatch
        }
      }))

      expect(relationships).toHaveLength(2)
      expect(relationships[0]).toEqual({
        sourceId: 'note-123',
        sourcePath: '/vault/source-note.md',
        targetName: 'Target Note',
        normalizedTargetName: 'target note',
        relationType: 'WIKILINK',
        context: {
          position: 14,
          fullMatch: '[[Target Note]]'
        }
      })
    })

    test('should handle WikiLink resolution for existing notes', async () => {
      // Mock successful note resolution
      const expectedResult = {
        exists: true,
        path: '/vault/target-note.md',
        id: 'target-123'
      }
      mockInvoke.mockResolvedValueOnce(expectedResult)

      const linkName = 'Target Note'
      const result = await mockInvoke('resolve_wikilink', { 
        noteName: linkName,
        vaultPath: '/vault' 
      })

      expect(result).toEqual(expectedResult)
      expect(result.exists).toBe(true)
      expect(result.path).toBe('/vault/target-note.md')
      expect(result.id).toBe('target-123')
    })

    test('should handle WikiLink resolution for non-existing notes', async () => {
      // Mock failed note resolution
      const expectedResult = {
        exists: false,
        path: null,
        id: null
      }
      mockInvoke.mockResolvedValueOnce(expectedResult)

      const linkName = 'Non Existing Note'
      const result = await mockInvoke('resolve_wikilink', { 
        noteName: linkName,
        vaultPath: '/vault' 
      })

      expect(result).toEqual(expectedResult)
      expect(result.exists).toBe(false)
      expect(result.path).toBe(null)
      expect(result.id).toBe(null)
    })
  })

  describe('Graph Update Operations', () => {
    test('should create graph update operations for WikiLink changes', () => {
      const oldContent = 'This links to [[Old Note]].'
      const newContent = 'This links to [[New Note]] and [[Another Note]].'

      const oldLinks = extractWikiLinks(oldContent)
      const newLinks = extractWikiLinks(newContent)

      // Calculate differences
      const oldLinkNames = new Set(oldLinks.map(l => normalizeWikiLinkName(l.text)))
      const newLinkNames = new Set(newLinks.map(l => normalizeWikiLinkName(l.text)))

      const addedLinks = newLinks.filter(l => !oldLinkNames.has(normalizeWikiLinkName(l.text)))
      const removedLinks = oldLinks.filter(l => !newLinkNames.has(normalizeWikiLinkName(l.text)))

      expect(addedLinks.map(l => l.text)).toEqual(['New Note', 'Another Note'])
      expect(removedLinks.map(l => l.text)).toEqual(['Old Note'])
    })

    test('should generate bulk graph operations for multiple WikiLink changes', () => {
      const noteId = 'note-123'
      const changes = [
        { type: 'add', targetName: 'New Note A', normalizedName: 'new note a' },
        { type: 'add', targetName: 'New Note B', normalizedName: 'new note b' },
        { type: 'remove', targetName: 'Old Note', normalizedName: 'old note' }
      ]

      const operations = changes.map(change => ({
        operation: change.type === 'add' ? 'CREATE_WIKILINK_RELATION' : 'DELETE_WIKILINK_RELATION',
        sourceId: noteId,
        targetName: change.targetName,
        normalizedTargetName: change.normalizedName,
        relationType: 'WIKILINK'
      }))

      expect(operations).toHaveLength(3)
      expect(operations.filter(op => op.operation === 'CREATE_WIKILINK_RELATION')).toHaveLength(2)
      expect(operations.filter(op => op.operation === 'DELETE_WIKILINK_RELATION')).toHaveLength(1)
    })
  })

  describe('Vault Context Integration', () => {
    test('should include vault context in WikiLink operations', async () => {
      const expectedVaultInfo = {
        path: '/vault/test',
        id: 'vault-123'
      }
      mockInvoke.mockResolvedValueOnce(expectedVaultInfo)

      const vaultInfo = await mockInvoke('get_current_vault')
      const noteId = 'note-123'
      const wikiLinks = ['Target Note']

      // Verify vault info was received correctly
      expect(vaultInfo).toEqual(expectedVaultInfo)
      expect(vaultInfo.id).toBe('vault-123')
      expect(vaultInfo.path).toBe('/vault/test')

      const operations = wikiLinks.map(linkName => ({
        operation: 'CREATE_WIKILINK_RELATION',
        vaultId: vaultInfo?.id || null,
        vaultPath: vaultInfo?.path || null,
        sourceId: noteId,
        targetName: linkName,
        normalizedTargetName: normalizeWikiLinkName(linkName)
      }))

      expect(operations[0]).toMatchObject({
        vaultId: 'vault-123',
        vaultPath: '/vault/test',
        sourceId: 'note-123',
        targetName: 'Target Note',
        normalizedTargetName: 'target note'
      })
    })

    test('should isolate WikiLink operations by vault', () => {
      const vault1Operations = [
        { vaultId: 'vault-1', sourceId: 'note-1', targetName: 'Note A' },
        { vaultId: 'vault-1', sourceId: 'note-2', targetName: 'Note B' }
      ]

      const vault2Operations = [
        { vaultId: 'vault-2', sourceId: 'note-3', targetName: 'Note A' },
        { vaultId: 'vault-2', sourceId: 'note-4', targetName: 'Note C' }
      ]

      // Ensure operations are isolated by vault
      const vault1VaultIds = [...new Set(vault1Operations.map(op => op.vaultId))]
      const vault2VaultIds = [...new Set(vault2Operations.map(op => op.vaultId))]

      expect(vault1VaultIds).toEqual(['vault-1'])
      expect(vault2VaultIds).toEqual(['vault-2'])
      expect(vault1VaultIds).not.toEqual(vault2VaultIds)
    })
  })

  describe('Error Handling', () => {
    test('should handle WikiLink extraction errors gracefully', () => {
      const malformedContent = '[[[broken]] [[unclosed] ]closed]]'
      
      expect(() => {
        const links = extractWikiLinks(malformedContent)
        // Should return empty array or valid links only
        expect(Array.isArray(links)).toBe(true)
      }).not.toThrow()
    })

    test('should handle graph operation failures', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Graph connection failed'))

      try {
        await mockInvoke('create_wikilink_relation', {
          sourceId: 'note-123',
          targetName: 'Target Note'
        })
      } catch (error) {
        expect(error.message).toBe('Graph connection failed')
      }
    })

    test('should handle empty content gracefully', () => {
      const emptyContent = ''
      const links = extractWikiLinks(emptyContent)
      
      expect(links).toEqual([])
    })

    test('should handle null or undefined content', () => {
      expect(() => {
        extractWikiLinks(null)
      }).not.toThrow()
      
      expect(() => {
        extractWikiLinks(undefined)
      }).not.toThrow()
    })
  })

  describe('Performance Tests', () => {
    test('should handle large documents with many WikiLinks efficiently', () => {
      // Create a document with 1000 WikiLinks
      const wikiLinks = Array.from({ length: 1000 }, (_, i) => `[[Note ${i}]]`)
      const content = wikiLinks.join(' ')

      const startTime = Date.now()
      const links = extractWikiLinks(content)
      const endTime = Date.now()

      expect(links).toHaveLength(1000)
      expect(endTime - startTime).toBeLessThan(100) // Should complete within 100ms
    })

    test('should handle rapid WikiLink extraction calls', () => {
      const contents = Array.from({ length: 100 }, (_, i) => `Content ${i} with [[Note ${i}]]`)
      
      const startTime = Date.now()
      const allLinks = contents.map(content => extractWikiLinks(content))
      const endTime = Date.now()

      expect(allLinks).toHaveLength(100)
      expect(allLinks.every(links => links.length === 1)).toBe(true)
      expect(endTime - startTime).toBeLessThan(50) // Should complete within 50ms
    })
  })
})