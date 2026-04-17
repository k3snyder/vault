// PDFHighlightManager.test.js - Unit tests for PDFHighlightManager
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Tauri API mocks are handled by moduleNameMapper in jest.config.js
// Import after module resolution handles mocking
import {
  initHighlightManager,
  cleanupHighlightManager,
  getHighlights,
  setHighlights,
  addHighlight
} from '../PDFHighlightManager.js'

describe('PDFHighlightManager', () => {
  let container
  let mockViewerWrapper
  let originalAddEventListener
  let originalRemoveEventListener
  let eventListeners

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()

    // Track event listeners
    eventListeners = {
      window: {},
      element: {}
    }

    // Create container element
    container = document.createElement('div')
    container.className = 'pdf-viewer'
    document.body.appendChild(container)

    // Mock viewerWrapper
    mockViewerWrapper = {
      currentScale: 1.5
    }

    // Track window event listeners
    originalAddEventListener = window.addEventListener
    originalRemoveEventListener = window.removeEventListener

    window.addEventListener = jest.fn((event, handler) => {
      if (!eventListeners.window[event]) {
        eventListeners.window[event] = []
      }
      eventListeners.window[event].push(handler)
    })

    window.removeEventListener = jest.fn((event, handler) => {
      if (eventListeners.window[event]) {
        eventListeners.window[event] = eventListeners.window[event].filter(h => h !== handler)
      }
    })

    // Clear any existing highlights
    setHighlights({})
  })

  afterEach(() => {
    // Clean up
    cleanupHighlightManager()

    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }

    // Restore original event listener methods
    window.addEventListener = originalAddEventListener
    window.removeEventListener = originalRemoveEventListener
  })

  describe('initHighlightManager', () => {
    it('sets up pdf-page-rendered listener', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      expect(window.addEventListener).toHaveBeenCalledWith(
        'pdf-page-rendered',
        expect.any(Function)
      )
    })

    it('sets up all required event listeners', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      expect(window.addEventListener).toHaveBeenCalledWith(
        'pdf-highlight-selection',
        expect.any(Function)
      )
      expect(window.addEventListener).toHaveBeenCalledWith(
        'pdf-undo-highlight',
        expect.any(Function)
      )
      expect(window.addEventListener).toHaveBeenCalledWith(
        'pdf-redo-highlight',
        expect.any(Function)
      )
      expect(window.addEventListener).toHaveBeenCalledWith(
        'pdf-clear-all-highlights',
        expect.any(Function)
      )
    })
  })

  describe('cleanupHighlightManager', () => {
    it('removes all event listeners', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      cleanupHighlightManager()

      expect(window.removeEventListener).toHaveBeenCalledWith(
        'pdf-highlight-selection',
        expect.any(Function)
      )
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'pdf-undo-highlight',
        expect.any(Function)
      )
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'pdf-redo-highlight',
        expect.any(Function)
      )
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'pdf-clear-all-highlights',
        expect.any(Function)
      )
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'pdf-page-rendered',
        expect.any(Function)
      )
    })

    it('clears all module state', () => {
      // Set up some state
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)
      setHighlights({ 1: [{ text: 'test', bounds: [[0, 0, 10, 10]] }] })

      cleanupHighlightManager()

      // Module state should be cleared (tested indirectly through behavior)
      // Re-initializing should work without issues
      initHighlightManager(container, '/test/other.pdf', mockViewerWrapper)
    })
  })

  describe('getHighlights', () => {
    it('returns current highlights object', () => {
      const testHighlights = {
        1: [{ text: 'test', bounds: [[0, 0, 10, 10]] }]
      }
      setHighlights(testHighlights)

      const result = getHighlights()

      expect(result).toEqual(testHighlights)
    })

    it('returns empty object when no highlights', () => {
      setHighlights({})

      const result = getHighlights()

      expect(result).toEqual({})
    })
  })

  describe('setHighlights', () => {
    it('updates highlights state', () => {
      const newHighlights = {
        2: [{ text: 'new highlight', bounds: [[5, 5, 20, 20]] }]
      }

      setHighlights(newHighlights)

      expect(getHighlights()).toEqual(newHighlights)
    })
  })

  describe('addHighlight', () => {
    it('adds highlight to correct page', () => {
      const highlight = { text: 'test text', bounds: [[0, 0, 10, 10]] }

      addHighlight(3, highlight)

      const highlights = getHighlights()
      expect(highlights[3]).toBeDefined()
      expect(highlights[3].length).toBe(1)
      expect(highlights[3][0].text).toBe('test text')
    })

    it('appends to existing page highlights', () => {
      setHighlights({ 1: [{ text: 'first', bounds: [[0, 0, 10, 10]] }] })

      addHighlight(1, { text: 'second', bounds: [[20, 20, 30, 30]] })

      const highlights = getHighlights()
      expect(highlights[1].length).toBe(2)
    })
  })

  describe('page rendered event handling', () => {
    it('renders highlights when page is rendered', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      // Create a page
      const page = document.createElement('div')
      page.className = 'page'
      page.setAttribute('data-page-number', '1')
      container.appendChild(page)

      // Add highlights
      setHighlights({
        1: [
          { text: 'test1', bounds: [[10, 10, 50, 20]], timestamp: new Date().toISOString() },
          { text: 'test2', bounds: [[10, 40, 50, 20]], timestamp: new Date().toISOString() }
        ]
      })

      // Trigger page rendered event
      const handler = eventListeners.window['pdf-page-rendered']?.[0]
      if (handler) {
        handler({ detail: { pageNumber: 1, pageElement: page } })
      }

      // Check highlights were rendered
      const highlightEls = page.querySelectorAll('.pdf-highlight')
      expect(highlightEls.length).toBe(2)
    })

    it('does not render highlights for pages with no highlights', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      // Create a page
      const page = document.createElement('div')
      page.className = 'page'
      page.setAttribute('data-page-number', '5')
      container.appendChild(page)

      // No highlights for page 5
      setHighlights({
        1: [{ text: 'test', bounds: [[10, 10, 50, 20]] }]
      })

      // Trigger page rendered event for page 5
      const handler = eventListeners.window['pdf-page-rendered']?.[0]
      if (handler) {
        handler({ detail: { pageNumber: 5, pageElement: page } })
      }

      // No highlights should be rendered
      const highlightEls = page.querySelectorAll('.pdf-highlight')
      expect(highlightEls.length).toBe(0)
    })
  })

  describe('scale handling', () => {
    it('uses viewerWrapper.currentScale when available', () => {
      mockViewerWrapper.currentScale = 2.0
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      // Create a page
      const page = document.createElement('div')
      page.className = 'page'
      page.setAttribute('data-page-number', '1')
      container.appendChild(page)

      // Add a highlight
      setHighlights({
        1: [{ text: 'test', bounds: [[10, 10, 50, 20]], timestamp: new Date().toISOString() }]
      })

      // Trigger page rendered event
      const handler = eventListeners.window['pdf-page-rendered']?.[0]
      if (handler) {
        handler({ detail: { pageNumber: 1, pageElement: page } })
      }

      // Check if highlight was rendered with correct scale
      const highlightEl = page.querySelector('.pdf-highlight')
      expect(highlightEl).toBeTruthy()
      // Scale of 2.0 should multiply the bounds
      expect(highlightEl.style.left).toBe('20px') // 10 * 2.0
      expect(highlightEl.style.top).toBe('20px')  // 10 * 2.0
    })

    it('falls back to default scale when wrapper not available', () => {
      initHighlightManager(container, '/test/file.pdf', null)

      // Create a page
      const page = document.createElement('div')
      page.className = 'page'
      page.setAttribute('data-page-number', '1')
      container.appendChild(page)

      // Add a highlight
      setHighlights({
        1: [{ text: 'test', bounds: [[10, 10, 50, 20]], timestamp: new Date().toISOString() }]
      })

      // Trigger page rendered event
      const handler = eventListeners.window['pdf-page-rendered']?.[0]
      if (handler) {
        handler({ detail: { pageNumber: 1, pageElement: page } })
      }

      // Check if highlight was rendered with default scale (1.5)
      const highlightEl = page.querySelector('.pdf-highlight')
      expect(highlightEl).toBeTruthy()
      expect(highlightEl.style.left).toBe('15px') // 10 * 1.5
      expect(highlightEl.style.top).toBe('15px')  // 10 * 1.5
    })
  })

  describe('supports both page selectors', () => {
    it('works with .page class (PDF.js)', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      // Create a page with PDF.js structure
      const page = document.createElement('div')
      page.className = 'page'
      page.setAttribute('data-page-number', '5')
      container.appendChild(page)

      // Add highlights
      setHighlights({
        5: [{ text: 'test', bounds: [[10, 10, 50, 20]], timestamp: new Date().toISOString() }]
      })

      // Trigger page rendered event
      const handler = eventListeners.window['pdf-page-rendered']?.[0]
      if (handler) {
        handler({ detail: { pageNumber: 5, pageElement: page } })
      }

      const highlightEl = page.querySelector('.pdf-highlight')
      expect(highlightEl).toBeTruthy()
    })

    it('works with .pdf-page class (legacy)', () => {
      initHighlightManager(container, '/test/file.pdf', mockViewerWrapper)

      // Create a page with legacy structure
      const page = document.createElement('div')
      page.className = 'pdf-page'
      page.setAttribute('data-page-number', '3')
      container.appendChild(page)

      // Add highlights
      setHighlights({
        3: [{ text: 'test', bounds: [[10, 10, 50, 20]], timestamp: new Date().toISOString() }]
      })

      // Trigger page rendered event
      const handler = eventListeners.window['pdf-page-rendered']?.[0]
      if (handler) {
        handler({ detail: { pageNumber: 3, pageElement: page } })
      }

      const highlightEl = page.querySelector('.pdf-highlight')
      expect(highlightEl).toBeTruthy()
    })
  })
})
