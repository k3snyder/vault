import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { wikiLinkPlugin, wikiLinkStyles } from './wikilink-extension.js'
import { TabManager } from '../TabManager.js'

// Mock JSDOM environment for CodeMirror
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document

// Mock Tauri API
global.__TAURI_INTERNALS__ = {}
global.__TAURI__ = {
  core: {
    invoke: jest.fn()
  }
}

describe('WikiLink Navigation Integration Tests', () => {
  let container, view, tabManager
  let mockInvoke

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    
    // Create a tab manager container for testing
    const tabContainer = document.createElement('div')
    tabContainer.id = 'editor-tabs'
    document.body.appendChild(tabContainer)
    
    tabManager = new TabManager('test-pane')
    
    // Mock Tauri invoke function
    mockInvoke = jest.fn()
    global.__TAURI__.core.invoke = mockInvoke
    
    // Setup window context mock
    global.window.windowContext = {
      registerComponent: jest.fn(),
      getComponent: jest.fn(() => tabManager)
    }
  })

  afterEach(() => {
    if (view) {
      view.destroy()
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
    if (tabManager) {
      tabManager.cleanup()
    }
    jest.clearAllMocks()
  })

  describe('TabManager Integration', () => {
    test('should integrate WikiLink clicks with TabManager.openFile for existing notes', async () => {
      // Mock successful note resolution
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: true,
            path: 'test-note.md',
            name: args.link_name
          })
        }
        if (command === 'read_file_content') {
          return Promise.resolve('# Test Note\n\nThis is a test note.')
        }
        return Promise.resolve()
      })

      const state = EditorState.create({
        doc: 'Click on [[Test Note]] to navigate.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Wait for WikiLink processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Find the WikiLink element
      const wikiLinkElement = container.querySelector('[data-wikilink="Test Note"]')
      expect(wikiLinkElement).toBeTruthy()

      // Spy on TabManager methods
      const openFileSpy = jest.spyOn(tabManager, 'openFile')
      const createTabSpy = jest.spyOn(tabManager, 'createTab')

      // Simulate click event
      const clickEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
      })

      wikiLinkElement.dispatchEvent(clickEvent)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify TabManager.openFile was called
      expect(openFileSpy).toHaveBeenCalledWith('test-note.md', expect.any(String))
    })

    test('should handle WikiLink clicks for non-existent notes with confirmation', async () => {
      // Mock note resolution for non-existent note
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: false,
            path: null,
            name: args.link_name
          })
        }
        if (command === 'create_note_from_wikilink') {
          return Promise.resolve({
            path: 'new-note.md',
            content: '# New Note\n\n'
          })
        }
        return Promise.resolve()
      })

      // Mock confirm dialog
      global.confirm = jest.fn(() => true)

      const state = EditorState.create({
        doc: 'Create [[New Note]] by clicking.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Wait for WikiLink processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Find the WikiLink element
      const wikiLinkElement = container.querySelector('[data-wikilink="New Note"]')
      expect(wikiLinkElement).toBeTruthy()

      // Spy on TabManager methods
      const openFileSpy = jest.spyOn(tabManager, 'openFile')

      // Simulate click event
      const clickEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
      })

      wikiLinkElement.dispatchEvent(clickEvent)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200))

      // Verify confirmation was shown
      expect(global.confirm).toHaveBeenCalledWith(
        expect.stringContaining('New Note')
      )

      // Verify note creation was attempted
      expect(mockInvoke).toHaveBeenCalledWith('create_note_from_wikilink', {
        noteName: 'New Note'
      })
    })

    test('should handle confirmation dialog cancellation for new notes', async () => {
      // Mock note resolution for non-existent note
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: false,
            path: null,
            name: args.link_name
          })
        }
        return Promise.resolve()
      })

      // Mock confirm dialog to return false (cancelled)
      global.confirm = jest.fn(() => false)

      const state = EditorState.create({
        doc: 'Cancel creating [[Cancelled Note]].',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Wait for WikiLink processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Find the WikiLink element
      const wikiLinkElement = container.querySelector('[data-wikilink="Cancelled Note"]')
      expect(wikiLinkElement).toBeTruthy()

      // Simulate click event
      const clickEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
      })

      wikiLinkElement.dispatchEvent(clickEvent)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify confirmation was shown
      expect(global.confirm).toHaveBeenCalled()

      // Verify note creation was NOT attempted
      expect(mockInvoke).not.toHaveBeenCalledWith('create_note_from_wikilink', expect.any(Object))
    })
  })

  describe('Focus Management', () => {
    test('should properly focus new tab when opening existing note', async () => {
      // Mock successful note resolution and content loading
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: true,
            path: 'focus-test.md',
            name: args.link_name
          })
        }
        if (command === 'read_file_content') {
          return Promise.resolve('# Focus Test\n\nContent for focus testing.')
        }
        return Promise.resolve()
      })

      // Create initial tab
      const initialTabId = tabManager.createTab('initial.md', '# Initial Tab')
      tabManager.activateTab(initialTabId)

      const state = EditorState.create({
        doc: 'Navigate to [[Focus Test]] note.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Wait for WikiLink processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Spy on tab activation
      const activateTabSpy = jest.spyOn(tabManager, 'activateTab')

      // Find and click WikiLink
      const wikiLinkElement = container.querySelector('[data-wikilink="Focus Test"]')
      const clickEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
      })

      wikiLinkElement.dispatchEvent(clickEvent)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200))

      // Verify new tab was activated
      expect(activateTabSpy).toHaveBeenCalled()
      
      // Verify the active tab changed
      const activeTab = tabManager.getActiveTab()
      expect(activeTab.filePath).toBe('focus-test.md')
    })

    test('should maintain proper tab order when navigating through WikiLinks', async () => {
      // Mock multiple note resolutions
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: true,
            path: `${args.link_name.toLowerCase().replace(/\s+/g, '-')}.md`,
            name: args.link_name
          })
        }
        if (command === 'read_file_content') {
          return Promise.resolve(`# ${args.file_path}\n\nContent for ${args.file_path}`)
        }
        return Promise.resolve()
      })

      // Create document with multiple WikiLinks
      const state = EditorState.create({
        doc: 'Navigate: [[First Note]] then [[Second Note]] finally [[Third Note]]',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      // Wait for WikiLink processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Click first WikiLink
      const firstLink = container.querySelector('[data-wikilink="First Note"]')
      firstLink.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 100))

      // Click second WikiLink  
      const secondLink = container.querySelector('[data-wikilink="Second Note"]')
      secondLink.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify tab order
      const tabs = tabManager.getTabs()
      expect(tabs.length).toBeGreaterThanOrEqual(2)
      
      // Verify tabs were created in correct order
      const tabPaths = tabs.map(tab => tab.filePath)
      expect(tabPaths).toContain('first-note.md')
      expect(tabPaths).toContain('second-note.md')
    })
  })

  describe('Error Handling in Navigation', () => {
    test('should handle Tauri command failures gracefully', async () => {
      // Mock Tauri command failure
      mockInvoke.mockImplementation((command) => {
        if (command === 'resolve_wikilink') {
          return Promise.reject(new Error('Network error'))
        }
        return Promise.resolve()
      })

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const state = EditorState.create({
        doc: 'Try clicking [[Error Note]] with network issues.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Click WikiLink that will fail
      const wikiLinkElement = container.querySelector('[data-wikilink="Error Note"]')
      const clickEvent = new MouseEvent('mousedown', { button: 0, bubbles: true })
      
      // Should not throw error
      expect(() => {
        wikiLinkElement.dispatchEvent(clickEvent)
      }).not.toThrow()

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalled()
      
      consoleSpy.mockRestore()
    })

    test('should handle TabManager failures during navigation', async () => {
      // Mock successful resolution but TabManager failure
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: true,
            path: 'test.md',
            name: args.link_name
          })
        }
        return Promise.resolve()
      })

      // Mock TabManager to throw error
      jest.spyOn(tabManager, 'openFile').mockImplementation(() => {
        throw new Error('TabManager error')
      })

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const state = EditorState.create({
        doc: 'Click [[Tab Error]] to test error handling.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Click WikiLink
      const wikiLinkElement = container.querySelector('[data-wikilink="Tab Error"]')
      const clickEvent = new MouseEvent('mousedown', { button: 0, bubbles: true })
      
      // Should not crash the application
      expect(() => {
        wikiLinkElement.dispatchEvent(clickEvent)
      }).not.toThrow()

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalled()
      
      consoleSpy.mockRestore()
    })

    test('should handle invalid WikiLink names', async () => {
      const state = EditorState.create({
        doc: 'Invalid links: [[]] and [[   ]] should be handled.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not find any WikiLink elements for invalid patterns
      const invalidLinks = container.querySelectorAll('[data-wikilink=""]')
      expect(invalidLinks.length).toBe(0)
    })
  })

  describe('Performance and Memory Management', () => {
    test('should handle multiple rapid WikiLink clicks without memory leaks', async () => {
      // Mock fast note resolution
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: true,
            path: `rapid-${Date.now()}.md`,
            name: args.link_name
          })
        }
        return Promise.resolve()
      })

      const state = EditorState.create({
        doc: 'Rapid click test: [[Rapid Note]]',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const wikiLinkElement = container.querySelector('[data-wikilink="Rapid Note"]')
      
      // Rapid fire clicks
      for (let i = 0; i < 5; i++) {
        const clickEvent = new MouseEvent('mousedown', { button: 0, bubbles: true })
        wikiLinkElement.dispatchEvent(clickEvent)
      }

      // Should handle rapid clicks gracefully
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Should not exceed reasonable number of invoke calls
      expect(mockInvoke).toHaveBeenCalledTimes(5) // One for each click
    })
  })

  describe('Multi-tab Navigation Workflows', () => {
    test('should support navigation history through WikiLinks', async () => {
      // Mock note chain: A -> B -> C
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'resolve_wikilink') {
          return Promise.resolve({
            exists: true,
            path: `${args.link_name.toLowerCase()}.md`,
            name: args.link_name
          })
        }
        if (command === 'read_file_content') {
          const content = {
            'a.md': '# Note A\n\nSee [[B]] for more info.',
            'b.md': '# Note B\n\nCheck out [[C]] next.',
            'c.md': '# Note C\n\nEnd of chain.'
          }
          return Promise.resolve(content[args.file_path] || '# Default')
        }
        return Promise.resolve()
      })

      // Start with Note A
      const state = EditorState.create({
        doc: '# Note A\n\nSee [[B]] for more info.',
        extensions: [
          wikiLinkPlugin,
          wikiLinkStyles
        ]
      })

      view = new EditorView({
        state,
        parent: container
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Click to navigate A -> B
      const linkB = container.querySelector('[data-wikilink="B"]')
      linkB.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify tab was created and navigation occurred
      const tabs = tabManager.getTabs()
      expect(tabs.some(tab => tab.filePath === 'b.md')).toBe(true)
    })
  })
})