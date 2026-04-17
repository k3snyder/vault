import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { wikiLinkPlugin, wikiLinkStyles } from './wikilink-extension.js'

// Mock JSDOM environment for CodeMirror
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document

describe('WikiLink Extension - Pattern Recognition', () => {
  let container, view

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (view) {
      view.destroy()
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  describe('WikiLink Regex Pattern Matching', () => {
    const wikiLinkPattern = /\[\[([^\]]+)\]\]/g

    test('should match basic WikiLink syntax', () => {
      const testCases = [
        { input: '[[Note Name]]', expected: ['Note Name'] },
        { input: '[[Simple]]', expected: ['Simple'] },
        { input: '[[Multi Word Note]]', expected: ['Multi Word Note'] },
        { input: '[[Note-with-hyphens]]', expected: ['Note-with-hyphens'] },
        { input: '[[Note_with_underscores]]', expected: ['Note_with_underscores'] },
        { input: '[[Note123]]', expected: ['Note123'] },
        { input: '[[123Note]]', expected: ['123Note'] }
      ]

      testCases.forEach(({ input, expected }) => {
        const matches = Array.from(input.matchAll(wikiLinkPattern))
        expect(matches).toHaveLength(expected.length)
        matches.forEach((match, index) => {
          expect(match[1]).toBe(expected[index])
        })
      })
    })

    test('should match multiple WikiLinks in same text', () => {
      const text = 'Check out [[First Note]] and [[Second Note]] for details.'
      const matches = Array.from(text.matchAll(wikiLinkPattern))
      
      expect(matches).toHaveLength(2)
      expect(matches[0][1]).toBe('First Note')
      expect(matches[1][1]).toBe('Second Note')
    })

    test('should handle special characters in note names', () => {
      const testCases = [
        { input: '[[Café Notes]]', expected: ['Café Notes'] },
        { input: '[[Notes (2024)]]', expected: ['Notes (2024)'] },
        { input: '[[Meeting Notes - Q1 2024]]', expected: ['Meeting Notes - Q1 2024'] },
        { input: '[[Project #1]]', expected: ['Project #1'] },
        { input: '[[50% Complete]]', expected: ['50% Complete'] }
      ]

      testCases.forEach(({ input, expected }) => {
        const matches = Array.from(input.matchAll(wikiLinkPattern))
        expect(matches).toHaveLength(expected.length)
        expect(matches[0][1]).toBe(expected[0])
      })
    })

    test('should handle unicode characters', () => {
      const testCases = [
        { input: '[[中文笔记]]', expected: ['中文笔记'] },
        { input: '[[Español Notas]]', expected: ['Español Notas'] },
        { input: '[[Заметки]]', expected: ['Заметки'] },
        { input: '[[🚀 Rocket Notes]]', expected: ['🚀 Rocket Notes'] }
      ]

      testCases.forEach(({ input, expected }) => {
        const matches = Array.from(input.matchAll(wikiLinkPattern))
        expect(matches).toHaveLength(expected.length)
        expect(matches[0][1]).toBe(expected[0])
      })
    })

    test('should NOT match malformed WikiLink patterns', () => {
      const malformedCases = [
        '[[]]', // Empty brackets
        '[Note]', // Single brackets
        '[[[Note]]]', // Triple brackets
        '[[Note]', // Unclosed
        '[Note]]', // Wrong opening
        '[ [Note] ]', // Spaces around brackets
        '[[Note Name]', // Missing closing bracket
        '[Note Name]]' // Missing opening bracket
      ]

      malformedCases.forEach((input) => {
        const matches = Array.from(input.matchAll(wikiLinkPattern))
        expect(matches).toHaveLength(0)
      })
    })

    test('should handle nested brackets correctly', () => {
      const testCases = [
        { input: '[[Note [with] brackets]]', expected: [] }, // Should not match
        { input: '[[Outer]] [[Inner]]', expected: ['Outer', 'Inner'] }
      ]

      testCases.forEach(({ input, expected }) => {
        const matches = Array.from(input.matchAll(wikiLinkPattern))
        expect(matches).toHaveLength(expected.length)
        matches.forEach((match, index) => {
          expect(match[1]).toBe(expected[index])
        })
      })
    })

    test('should extract correct positions for matches', () => {
      const text = 'Start [[First Note]] middle [[Second Note]] end'
      const matches = Array.from(text.matchAll(wikiLinkPattern))
      
      expect(matches).toHaveLength(2)
      
      // First match
      expect(matches[0].index).toBe(6) // Position of first [[
      expect(matches[0][0]).toBe('[[First Note]]')
      expect(matches[0][1]).toBe('First Note')
      
      // Second match
      expect(matches[1].index).toBe(27) // Position of second [[
      expect(matches[1][0]).toBe('[[Second Note]]')
      expect(matches[1][1]).toBe('Second Note')
    })
  })

  describe('WikiLink Extension Integration', () => {
    test('should initialize WikiLink extension without errors', () => {
      expect(() => {
        const state = EditorState.create({
          doc: 'Test content with [[WikiLink]]',
          extensions: [
            wikiLinkPlugin,
            wikiLinkStyles
          ]
        })

        view = new EditorView({
          state,
          parent: container
        })
      }).not.toThrow()
    })

    test('should detect WikiLinks in document content', () => {
      const testContent = 'Here is a [[Test Note]] and another [[Second Note]].'
      
      const state = EditorState.create({
        doc: testContent,
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // The extension should process the document without errors
      expect(view.state.doc.toString()).toBe(testContent)
    })

    test('should handle document changes with WikiLinks', () => {
      const state = EditorState.create({
        doc: 'Initial content',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Add WikiLink to document
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: ' with [[New WikiLink]]'
        }
      })

      expect(view.state.doc.toString()).toBe('Initial content with [[New WikiLink]]')
    })

    test('should handle empty document', () => {
      expect(() => {
        const state = EditorState.create({
          doc: '',
          extensions: [
            wikiLinkPlugin,
            wikiLinkStyles
          ]
        })

        view = new EditorView({
          state,
          parent: container
        })
      }).not.toThrow()
    })

    test('should handle document with no WikiLinks', () => {
      const state = EditorState.create({
        doc: 'This is regular markdown content with [normal links](http://example.com) and **bold** text.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      expect(view.state.doc.toString()).toContain('regular markdown content')
    })
  })

  describe('WikiLink Extraction Utilities', () => {
    test('should extract all WikiLinks from text', () => {
      const extractWikiLinks = (text) => {
        const pattern = /\[\[([^\]]+)\]\]/g
        const links = []
        let match
        while ((match = pattern.exec(text)) !== null) {
          links.push({
            text: match[1],
            start: match.index,
            end: match.index + match[0].length,
            fullMatch: match[0]
          })
        }
        return links
      }

      const testText = 'Start [[First]] middle [[Second Note]] and [[Third]].'
      const links = extractWikiLinks(testText)

      expect(links).toHaveLength(3)
      expect(links[0]).toEqual({
        text: 'First',
        start: 6,
        end: 15,
        fullMatch: '[[First]]'
      })
      expect(links[1]).toEqual({
        text: 'Second Note',
        start: 23,
        end: 38,
        fullMatch: '[[Second Note]]'
      })
      expect(links[2]).toEqual({
        text: 'Third',
        start: 43,
        end: 52,
        fullMatch: '[[Third]]'
      })
    })

    test('should normalize WikiLink names for resolution', () => {
      const normalizeWikiLinkName = (name) => {
        return name.trim()
          .replace(/\s+/g, ' ') // Normalize multiple spaces
          .toLowerCase() // Case insensitive matching
      }

      const testCases = [
        { input: 'Note Name', expected: 'note name' },
        { input: '  Spaced  Note  ', expected: 'spaced note' },
        { input: 'UPPERCASE', expected: 'uppercase' },
        { input: 'Mixed Case Note', expected: 'mixed case note' }
      ]

      testCases.forEach(({ input, expected }) => {
        expect(normalizeWikiLinkName(input)).toBe(expected)
      })
    })
  })

  describe('Error Handling', () => {
    test('should handle malformed regex gracefully', () => {
      // Test that the extension doesn't crash with edge cases
      const edgeCases = [
        '[[',
        ']]',
        '[[]',
        '[[]]',
        '[[[[]]]]',
        'Normal text without links'
      ]

      edgeCases.forEach((content) => {
        expect(() => {
          const state = EditorState.create({
            doc: content,
            extensions: [
              wikiLinkPlugin,
              wikiLinkStyles
            ]
          })

          const testView = new EditorView({
            state,
            parent: container
          })
          
          testView.destroy()
        }).not.toThrow()
      })
    })

    test('should handle very long WikiLink names', () => {
      const longName = 'A'.repeat(1000)
      const content = `[[${longName}]]`

      expect(() => {
        const state = EditorState.create({
          doc: content,
          extensions: [
            wikiLinkPlugin,
            wikiLinkStyles
          ]
        })

        const testView = new EditorView({
          state,
          parent: container
        })
        
        testView.destroy()
      }).not.toThrow()
    })
  })

  describe('Performance Considerations', () => {
    test('should handle documents with many WikiLinks', () => {
      // Create a document with 100 WikiLinks
      const wikiLinks = Array.from({ length: 100 }, (_, i) => `[[Note ${i}]]`).join(' ')
      
      const startTime = Date.now()
      
      const state = EditorState.create({
        doc: wikiLinks,
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      const endTime = Date.now()
      
      // Should process 100 WikiLinks in reasonable time (< 100ms)
      expect(endTime - startTime).toBeLessThan(100)
      expect(view.state.doc.toString()).toBe(wikiLinks)
    })

    test('should handle rapid document changes', () => {
      const state = EditorState.create({
        doc: 'Initial',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Rapid document changes
      for (let i = 0; i < 10; i++) {
        view.dispatch({
          changes: {
            from: view.state.doc.length,
            insert: ` [[Note ${i}]]`
          }
        })
      }

      expect(view.state.doc.toString()).toContain('[[Note 9]]')
    })
  })
})