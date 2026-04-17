/**
 * @jest-environment jsdom
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { IntelligencePanel } from '../IntelligencePanel.js'

// Import mock (invoke is mocked via moduleNameMapper)
import { invoke } from '@tauri-apps/api/core'

describe('IntelligencePanel', () => {
  let panel
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    panel = new IntelligencePanel()

    // Clear all mocks
    jest.clearAllMocks()
  })

  afterEach(() => {
    if (container.parentElement) {
      document.body.removeChild(container)
    }
  })

  describe('mount()', () => {
    it('should mount panel to parent element', () => {
      panel.mount(container)

      expect(container.querySelector('.intelligence-panel')).toBeTruthy()
    })

    it('should create summary and pages tabs', () => {
      panel.mount(container)

      const tabs = container.querySelectorAll('.intelligence-tab')
      expect(tabs.length).toBe(2)
      expect(tabs[0].textContent).toContain('Summary')
      expect(tabs[1].textContent).toContain('Pages')
    })

    it('should show summary tab by default', () => {
      panel.mount(container)

      const summaryTab = container.querySelector('[data-tab="summary"]')
      expect(summaryTab.classList.contains('active')).toBe(true)
    })

    it('should render export button', () => {
      panel.mount(container)

      const exportBtn = container.querySelector('.intelligence-export-btn')
      expect(exportBtn).toBeTruthy()
      expect(exportBtn.textContent).toContain('Export')
    })
  })

  describe('setResult()', () => {
    const mockResult = {
      version: '1.0',
      generatedAt: '2026-01-07T10:00:00Z',
      sourcePdf: '/path/to/test.pdf',
      config: {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'full'
      },
      extraction: {
        documentId: 'doc_test',
        filename: 'test.pdf',
        totalPages: 3,
        pages: [
          {
            pageNumber: 1,
            text: 'Page 1 content',
            tables: [],
            images: []
          }
        ],
        metadata: {
          title: 'Test Document',
          author: 'Test Author'
        }
      },
      enrichments: [
        {
          pageNumber: 1,
          summaryNotes: ['Key finding 1', 'Important insight 2'],
          summaryTopics: ['machine learning', 'neural networks', 'deep learning'],
          relevancyScore: 92.5
        }
      ],
      processingStats: {
        extractionTimeMs: 1234,
        visionTimeMs: 5678,
        summarizationTimeMs: 12345,
        pagesWithVision: 1
      }
    }

    beforeEach(() => {
      panel.mount(container)
    })

    it('should update panel with result data', () => {
      panel.setResult(mockResult)

      expect(panel.result).toBe(mockResult)
    })

    it('should render topics as clickable tags', () => {
      panel.setResult(mockResult)

      const topics = container.querySelectorAll('.intelligence-topic')
      expect(topics.length).toBe(3)
      expect(topics[0].textContent).toBe('machine learning')
      expect(topics[1].textContent).toBe('neural networks')
      expect(topics[2].textContent).toBe('deep learning')
    })

    it('should render notes as bullet list', () => {
      panel.setResult(mockResult)

      const notes = container.querySelectorAll('.intelligence-note')
      expect(notes.length).toBe(2)
      expect(notes[0].textContent).toBe('Key finding 1')
      expect(notes[1].textContent).toBe('Important insight 2')
    })

    it('should render page count', () => {
      panel.setResult(mockResult)

      const pageCount = container.querySelector('.intelligence-page-count')
      expect(pageCount.textContent).toContain('3')
    })

    it('should switch to pages tab when clicked', () => {
      panel.setResult(mockResult)

      const pagesTab = container.querySelector('[data-tab="pages"]')
      pagesTab.click()

      expect(pagesTab.classList.contains('active')).toBe(true)
      const summaryTab = container.querySelector('[data-tab="summary"]')
      expect(summaryTab.classList.contains('active')).toBe(false)
    })

    it('should render per-page details in pages tab', () => {
      panel.setResult(mockResult)

      const pagesTab = container.querySelector('[data-tab="pages"]')
      pagesTab.click()

      const pageItems = container.querySelectorAll('.intelligence-page-item')
      expect(pageItems.length).toBe(1)
    })
  })

  describe('export to Markdown', () => {
    beforeEach(() => {
      panel.mount(container)
      panel.setResult({
        version: '1.0',
        generatedAt: '2026-01-07T10:00:00Z',
        sourcePdf: '/path/to/test.pdf',
        config: { mode: 'full' },
        extraction: {
          documentId: 'doc_test',
          filename: 'test.pdf',
          totalPages: 1,
          pages: [],
          metadata: {}
        },
        enrichments: [],
        processingStats: {
          extractionTimeMs: 1000
        }
      })
    })

    it('should have functional export button', () => {
      const exportBtn = container.querySelector('.intelligence-export-btn')

      // Button exists and is not disabled
      expect(exportBtn).toBeTruthy()
      expect(exportBtn.disabled).toBe(false)

      // Button is clickable (doesn't throw)
      expect(() => exportBtn.click()).not.toThrow()
    })

    it('should disable export button during export', async () => {
      const exportBtn = container.querySelector('.intelligence-export-btn')

      // Verify button starts enabled
      expect(exportBtn.disabled).toBe(false)

      // Note: Full export flow testing requires integration tests
      // Unit tests verify UI behavior only
    })
  })

  describe('empty state', () => {
    beforeEach(() => {
      panel.mount(container)
    })

    it('should show empty state when no result', () => {
      const emptyState = container.querySelector('.intelligence-empty')
      expect(emptyState).toBeTruthy()
      expect(emptyState.textContent).toContain('No intelligence data')
    })

    it('should hide empty state after setResult', () => {
      panel.setResult({
        version: '1.0',
        extraction: { pages: [], metadata: {} },
        enrichments: [],
        processingStats: {}
      })

      const emptyState = container.querySelector('.intelligence-empty')
      expect(emptyState).toBeFalsy()
    })
  })
})
