// PDFViewerWrapper.test.js - Unit tests for PDF.js PDFViewer wrapper
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mock pdfjs-dist
const mockEventHandlers = {}
const mockEventBus = {
  on: jest.fn((eventName, handler) => {
    mockEventHandlers[eventName] = handler
  }),
  off: jest.fn((eventName, handler) => {
    if (mockEventHandlers[eventName] === handler) {
      delete mockEventHandlers[eventName]
    }
  }),
  dispatch: jest.fn()
}

const mockViewer = {
  setDocument: jest.fn(),
  cleanup: jest.fn(),
  currentScale: 1.5,
  _setScale: function(scale) { this.currentScale = scale }
}

// Make currentScale settable
Object.defineProperty(mockViewer, 'currentScale', {
  get: function() { return this._currentScale || 1.5 },
  set: function(val) { this._currentScale = val }
})

const mockPdfDocument = {
  numPages: 10,
  destroy: jest.fn()
}

const mockLoadingTask = {
  promise: Promise.resolve(mockPdfDocument)
}

jest.unstable_mockModule('pdfjs-dist', () => ({
  getDocument: jest.fn(() => mockLoadingTask),
  GlobalWorkerOptions: { workerSrc: '' }
}))

jest.unstable_mockModule('pdfjs-dist/web/pdf_viewer', () => ({
  EventBus: jest.fn(() => mockEventBus),
  PDFViewer: jest.fn(() => mockViewer)
}))

// Import the module after mocking
const pdfjsLib = await import('pdfjs-dist')
const { EventBus, PDFViewer } = await import('pdfjs-dist/web/pdf_viewer')

describe('PDFViewerWrapper', () => {
  let PDFViewerWrapper
  let container
  let originalDispatchEvent

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks()
    mockViewer._currentScale = 1.5
    mockPdfDocument.destroy.mockClear()
    Object.keys(mockEventHandlers).forEach(key => delete mockEventHandlers[key])

    // Create container element
    container = document.createElement('div')
    container.id = 'viewer-container'
    document.body.appendChild(container)

    // Mock window.dispatchEvent
    originalDispatchEvent = window.dispatchEvent
    window.dispatchEvent = jest.fn()

    // Dynamically import the module (we'll create it next)
    const module = await import('../PDFViewerWrapper.js')
    PDFViewerWrapper = module.PDFViewerWrapper
  })

  afterEach(() => {
    // Clean up
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
    window.dispatchEvent = originalDispatchEvent
  })

  describe('constructor', () => {
    it('creates container reference and null viewer', () => {
      const wrapper = new PDFViewerWrapper(container)

      expect(wrapper.container).toBe(container)
      expect(wrapper.viewer).toBeNull()
      expect(wrapper.pdfDocument).toBeNull()
      expect(wrapper.eventBus).toBeNull()
    })
  })

  describe('initialize', () => {
    it('creates PDFViewer instance with correct options', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      expect(EventBus).toHaveBeenCalled()
      expect(PDFViewer).toHaveBeenCalledWith(
        expect.objectContaining({
          container: container,
          eventBus: mockEventBus,
          textLayerMode: 2,
          annotationMode: 0
        })
      )
      expect(wrapper.viewer).toBe(mockViewer)
      expect(wrapper.eventBus).toBe(mockEventBus)
    })

    it('sets up pagerendered event listener', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      expect(mockEventBus.on).toHaveBeenCalledWith(
        'pagerendered',
        expect.any(Function)
      )
    })

    it('sets up pagesdestroy event listener', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      expect(mockEventBus.on).toHaveBeenCalledWith(
        'pagesdestroy',
        expect.any(Function)
      )
    })

    it('sets up pagechanging event listener', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      expect(mockEventBus.on).toHaveBeenCalledWith(
        'pagechanging',
        expect.any(Function)
      )
    })

    it('does not create duplicate viewers on multiple initialize calls', async () => {
      const wrapper = new PDFViewerWrapper(container)

      await wrapper.initialize()
      const firstViewer = wrapper.viewer
      const callCount = PDFViewer.mock.calls.length

      await wrapper.initialize()

      // Should not create new viewer
      expect(PDFViewer.mock.calls.length).toBe(callCount)
      expect(wrapper.viewer).toBe(firstViewer)
    })
  })

  describe('loadDocument', () => {
    it('returns correct page count', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()
      wrapper._waitForLayout = jest.fn().mockResolvedValue(undefined)

      const pdfData = { data: new Uint8Array([1, 2, 3]) }
      const numPagesPromise = wrapper.loadDocument(pdfData)
      await Promise.resolve()
      await mockEventHandlers.pagesinit()
      const numPages = await numPagesPromise

      expect(numPages).toBe(10)
      expect(pdfjsLib.getDocument).toHaveBeenCalledWith(pdfData)
      expect(mockViewer.setDocument).toHaveBeenCalledWith(mockPdfDocument)
    })

    it('stores the PDF document reference', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()
      wrapper._waitForLayout = jest.fn().mockResolvedValue(undefined)

      const loadPromise = wrapper.loadDocument({ data: new Uint8Array([1, 2, 3]) })
      await Promise.resolve()
      await mockEventHandlers.pagesinit()
      await loadPromise

      expect(wrapper.pdfDocument).toBe(mockPdfDocument)
    })
  })

  describe('scale management', () => {
    it('setScale updates viewer currentScale', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      wrapper.setScale(2.0)

      expect(wrapper.viewer.currentScale).toBe(2.0)
    })

    it('currentScale getter returns viewer scale', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      wrapper.viewer.currentScale = 1.8

      expect(wrapper.currentScale).toBe(1.8)
    })
  })

  describe('destroy', () => {
    it('calls viewer.cleanup() and document.destroy()', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()
      wrapper._waitForLayout = jest.fn().mockResolvedValue(undefined)

      const loadPromise = wrapper.loadDocument({ data: new Uint8Array([1, 2, 3]) })
      await Promise.resolve()
      await mockEventHandlers.pagesinit()
      await loadPromise

      wrapper.destroy()

      expect(mockViewer.cleanup).toHaveBeenCalled()
      expect(mockPdfDocument.destroy).toHaveBeenCalled()
    })

    it('handles destroy when viewer is null', () => {
      const wrapper = new PDFViewerWrapper(container)

      // Should not throw
      expect(() => wrapper.destroy()).not.toThrow()
    })

    it('handles destroy when document is null', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      // Should not throw
      expect(() => wrapper.destroy()).not.toThrow()
    })
  })

  describe('page rendered event', () => {
    it('dispatches custom event with correct detail', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      // Get the pagerendered callback
      const pagerenderedCallback = mockEventBus.on.mock.calls.find(
        call => call[0] === 'pagerendered'
      )[1]

      // Simulate page rendered event
      const mockPageDiv = document.createElement('div')
      const mockEvent = {
        pageNumber: 5,
        source: { div: mockPageDiv }
      }

      pagerenderedCallback(mockEvent)

      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pdf-page-rendered',
          detail: {
            pageNumber: 5,
            pageElement: mockPageDiv
          }
        })
      )
    })
  })

  describe('page changing event', () => {
    it('notifies page change subscribers with the new page number', async () => {
      const wrapper = new PDFViewerWrapper(container)
      const pageChangeHandler = jest.fn()

      await wrapper.initialize()
      wrapper.onPageChange(pageChangeHandler)

      const pagechangingCallback = mockEventBus.on.mock.calls.find(
        call => call[0] === 'pagechanging'
      )[1]

      pagechangingCallback({ pageNumber: 7 })

      expect(pageChangeHandler).toHaveBeenCalledWith(7)
    })
  })

  describe('pages destroy event', () => {
    it('dispatches pdf-pages-cleanup custom event', async () => {
      const wrapper = new PDFViewerWrapper(container)
      await wrapper.initialize()

      // Get the pagesdestroy callback
      const pagesdestroyCallback = mockEventBus.on.mock.calls.find(
        call => call[0] === 'pagesdestroy'
      )[1]

      // Simulate pages destroy event
      pagesdestroyCallback()

      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pdf-pages-cleanup'
        })
      )
    })
  })
})
