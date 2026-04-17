import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockInvoke = jest.fn()
const mockLoadHighlights = jest.fn().mockResolvedValue(undefined)
const mockInitHighlightManager = jest.fn()
const mockSaveHighlights = jest.fn().mockResolvedValue(undefined)
const mockCleanupHighlightManager = jest.fn()
const mockExtractHighlightsToMarkdown = jest.fn()
const mockGetHighlights = jest.fn().mockReturnValue({})

let mockPageChangeHandler = null
let mockWrapperInstance = null

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

jest.unstable_mockModule('@tauri-apps/api/path', () => ({
  basename: jest.fn(async (filePath) => filePath.split('/').pop())
}))

jest.unstable_mockModule('../PDFViewerWrapper.js', () => ({
  PDFViewerWrapper: jest.fn(() => {
    mockPageChangeHandler = null
    mockWrapperInstance = {
      initialize: jest.fn().mockResolvedValue(undefined),
      loadDocument: jest.fn().mockResolvedValue(430),
      onPageChange: jest.fn((handler) => {
        mockPageChangeHandler = handler
      }),
      offPageChange: jest.fn(),
      destroy: jest.fn(),
      setScale: jest.fn(),
      currentScale: 1.15
    }

    return mockWrapperInstance
  })
}))

jest.unstable_mockModule('../PDFHighlightManager.js', () => ({
  initHighlightManager: mockInitHighlightManager,
  loadHighlights: mockLoadHighlights,
  saveHighlights: mockSaveHighlights,
  extractHighlightsToMarkdown: mockExtractHighlightsToMarkdown,
  cleanupHighlightManager: mockCleanupHighlightManager,
  getHighlights: mockGetHighlights
}))

jest.unstable_mockModule('../../contexts/WindowContext.js', () => ({
  default: {
    vaultPath: '/vault'
  }
}))

const { PDFTab } = await import('../PDFTab.js')

describe('PDFTab', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPageChangeHandler = null
    mockWrapperInstance = null
    mockInvoke.mockResolvedValue('JVBERg==')
  })

  it('updates the page counter when PDF.js reports a page change from scrolling', async () => {
    const tab = new PDFTab('docs/test.pdf', null, 'pane-1')
    tab.fileName = 'test.pdf'

    tab.container = document.createElement('div')
    tab.container.className = 'pdf-container'
    tab.toolbar = tab.createToolbar()
    tab.container.appendChild(tab.toolbar)

    tab.viewerContainer = document.createElement('div')
    tab.viewerContainer.className = 'pdf-viewer'
    tab.container.appendChild(tab.viewerContainer)
    document.body.appendChild(tab.container)

    await tab.initializePDF()

    expect(tab.pageCounter.textContent).toBe('Page 1 / 430')
    expect(mockWrapperInstance.onPageChange).toHaveBeenCalledWith(expect.any(Function))

    mockPageChangeHandler(37)

    expect(tab.currentPage).toBe(37)
    expect(tab.pageCounter.textContent).toBe('Page 37 / 430')
  })
})
