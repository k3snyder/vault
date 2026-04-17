// PDFTab.js: Integration with the existing tab system for PDF viewing
// Creates PDF viewer instances that work seamlessly with TabManager
// Uses PDFViewerWrapper for virtualized rendering

import { invoke } from '@tauri-apps/api/core'
import { basename } from '@tauri-apps/api/path'
import { PDFViewerWrapper } from './PDFViewerWrapper.js'
import {
  initHighlightManager,
  loadHighlights,
  saveHighlights,
  extractHighlightsToMarkdown,
  cleanupHighlightManager,
  getHighlights
} from './PDFHighlightManager.js'
import windowContext from '../contexts/WindowContext.js'

// Import CSS for PDF viewer
import './pdf-viewer.css'

/**
 * PDFTab class - Represents a PDF viewer tab
 * Uses PDF.js PDFViewer for virtualized rendering
 */
export class PDFTab {
  constructor(pdfPath, tabManager, paneId) {
    console.log(`Creating PDF tab for: ${pdfPath}`)

    this.pdfPath = pdfPath
    this.fullPath = null  // Resolved path with vault prefix
    this.tabManager = tabManager
    this.paneId = paneId
    this.container = null
    this.toolbar = null
    this.viewerContainer = null
    this.pageCounter = null
    this.currentPage = 1
    this.totalPages = 0
    this.fileName = ''
    this.viewerWrapper = null
  }

  /**
   * Create and return the tab content
   * @returns {Promise<HTMLElement>} The container element for the PDF viewer
   */
  async createContent() {
    // Create main container
    this.container = document.createElement('div')
    this.container.className = 'pdf-container'
    this.container.id = `pdf-container-${Date.now()}`

    // Get filename for display
    this.fileName = await basename(this.pdfPath)

    // Create toolbar (with placeholder zoom level until viewer is ready)
    this.toolbar = this.createToolbar()
    this.container.appendChild(this.toolbar)

    // Create wrapper for viewer (needed for flex layout with absolute positioned viewer)
    const viewerWrapper = document.createElement('div')
    viewerWrapper.className = 'pdf-viewer-wrapper'
    this.container.appendChild(viewerWrapper)

    // Create viewer container (must be absolutely positioned for PDF.js)
    this.viewerContainer = document.createElement('div')
    this.viewerContainer.className = 'pdf-viewer'
    viewerWrapper.appendChild(this.viewerContainer)

    // Set up keyboard shortcuts
    this.setupKeyboardShortcuts()

    // Initialize PDF AFTER returning container (so it can be attached to DOM first)
    // Use setTimeout to ensure this runs after the container is in the DOM
    setTimeout(() => {
      this.initializePDF().catch(error => {
        console.error('Error initializing PDF:', error)
      })
    }, 0)

    return this.container
  }

  /**
   * Create the toolbar matching editor header style
   * @returns {HTMLElement} Toolbar element
   */
  createToolbar() {
    const toolbar = document.createElement('div')
    toolbar.className = 'editor-header pdf-toolbar'

    // Use a placeholder zoom level; will be updated after viewer initializes
    const zoomLevel = this.viewerWrapper ? Math.round(this.viewerWrapper.currentScale * 100) : 150

    toolbar.innerHTML = `
      <div class="editor-header-left">
        <button class="editor-control-btn pdf-prev-btn" title="Previous Page">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <span class="pdf-page-counter">Page 1 / -</span>
        <button class="editor-control-btn pdf-next-btn" title="Next Page">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <div class="editor-header-center pdf-toolbar-center">
        <span class="pdf-filename">${this.fileName}</span>
        <div class="pdf-zoom-controls">
          <button class="editor-control-btn pdf-zoom-out-btn" title="Zoom Out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <span class="pdf-zoom-level">${zoomLevel}%</span>
          <button class="editor-control-btn pdf-zoom-in-btn" title="Zoom In">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
        </div>
        <div class="editor-header-separator"></div>
        <button class="editor-control-btn pdf-highlight-btn" title="Highlight Selection (Cmd+Shift+H)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m9 11-6 6v3h9l3-3"/>
            <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
          </svg>
        </button>
        <button class="editor-control-btn pdf-undo-btn" title="Undo (Cmd+Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"></path>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
          </svg>
        </button>
        <button class="editor-control-btn pdf-redo-btn" title="Redo (Cmd+Shift+Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 7v6h-6"></path>
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path>
          </svg>
        </button>
        <button class="editor-control-btn pdf-extract-btn" title="Extract Highlights (Cmd+Shift+E)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>
          </svg>
        </button>
        <span class="pdf-highlight-count">0 highlights</span>
        <button class="editor-control-btn pdf-clear-highlights-btn" title="Clear All Highlights">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        <div class="editor-header-separator"></div>
        <button class="editor-control-btn pdf-intelligence-btn" title="Extract Intelligence (Cmd+Shift+I)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
            <path d="m4.93 4.93 2.83 2.83m8.48 8.48 2.83 2.83m0-14.14-2.83 2.83m-8.48 8.48-2.83 2.83"/>
          </svg>
        </button>
      </div>

      <div class="editor-header-right">
      </div>
    `

    // Cache frequently used elements
    this.pageCounter = toolbar.querySelector('.pdf-page-counter')
    this.highlightCounter = toolbar.querySelector('.pdf-highlight-count')

    // Bind event handlers
    toolbar.querySelector('.pdf-prev-btn').addEventListener('click', () => this.previousPage())
    toolbar.querySelector('.pdf-next-btn').addEventListener('click', () => this.nextPage())
    toolbar.querySelector('.pdf-zoom-out-btn').addEventListener('click', () => this.handleZoomOut())
    toolbar.querySelector('.pdf-zoom-in-btn').addEventListener('click', () => this.handleZoomIn())
    toolbar.querySelector('.pdf-highlight-btn').addEventListener('click', () => this.highlightSelection())
    toolbar.querySelector('.pdf-undo-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('pdf-undo-highlight')))
    toolbar.querySelector('.pdf-redo-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('pdf-redo-highlight')))
    toolbar.querySelector('.pdf-extract-btn').addEventListener('click', () => this.extractHighlights())
    toolbar.querySelector('.pdf-clear-highlights-btn').addEventListener('click', () => this.clearAllHighlights())
    toolbar.querySelector('.pdf-intelligence-btn').addEventListener('click', () => this.openIntelligencePanel())

    return toolbar
  }

  /**
   * Initialize PDF loading and rendering using PDFViewerWrapper
   */
  async initializePDF() {
    try {
      // Get the vault path from the WindowContext
      const vaultPath = windowContext.vaultPath || ''

      // Construct the full path
      this.fullPath = vaultPath ?
        `${vaultPath}/${this.pdfPath}` :
        this.pdfPath

      console.log(`Original PDF path: ${this.pdfPath}`)
      console.log(`Vault path: ${vaultPath}`)
      console.log(`Full PDF path: ${this.fullPath}`)

      // Read PDF file via Tauri
      let pdfData
      try {
        console.log('Reading PDF file via Tauri API...')
        const base64Data = await invoke('read_file_base64', { path: this.fullPath })
        console.log('Base64 data received, length:', base64Data.length)

        // Convert base64 to Uint8Array
        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        pdfData = { data: bytes }
        console.log('PDF file read successfully, size:', bytes.length)
      } catch (readError) {
        console.error('Failed to read file via Tauri:', readError)
        throw new Error(`Failed to read PDF file: ${readError.message}`)
      }

      // Initialize the viewer wrapper
      this.viewerWrapper = new PDFViewerWrapper(this.viewerContainer)
      await this.viewerWrapper.initialize()
      this.pageChangeHandler = (pageNumber) => {
        if (Number.isInteger(pageNumber) && pageNumber > 0) {
          this.currentPage = pageNumber
          this.updatePageCounter()
        }
      }
      this.viewerWrapper.onPageChange(this.pageChangeHandler)

      // Load the document
      this.totalPages = await this.viewerWrapper.loadDocument(pdfData)
      this.updatePageCounter()
      this.updateZoomLevel()

      // Load existing highlights
      await loadHighlights(this.pdfPath)

      // Initialize highlight manager with viewerWrapper reference
      initHighlightManager(this.viewerContainer, this.pdfPath, this.viewerWrapper)

      // Update highlight count after loading
      this.updateHighlightCount()

      // Scroll to top
      this.viewerContainer.scrollTop = 0

      console.log('PDF initialized successfully with virtualization')
    } catch (error) {
      console.error('Error initializing PDF:', error)
      this.viewerContainer.innerHTML = `
        <div class="pdf-error">
          <p>Error loading PDF: ${error.message}</p>
        </div>
      `
    }
  }

  /**
   * Navigate to previous page
   */
  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--
      this.scrollToPage(this.currentPage)
      this.updatePageCounter()
    }
  }

  /**
   * Navigate to next page
   */
  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++
      this.scrollToPage(this.currentPage)
      this.updatePageCounter()
    }
  }

  /**
   * Scroll to a specific page
   * @param {number} pageNum - Page number to scroll to
   */
  scrollToPage(pageNum) {
    // Try both selectors for compatibility
    const pageElement = this.viewerContainer.querySelector(`[data-page-number="${pageNum}"]`)
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  /**
   * Update page counter display
   */
  updatePageCounter() {
    if (this.pageCounter) {
      this.pageCounter.textContent = `Page ${this.currentPage} / ${this.totalPages}`
    }
  }

  /**
   * Handle zoom in - uses CSS transform for instant feedback
   */
  handleZoomIn() {
    if (this.viewerWrapper) {
      this.viewerWrapper.setScale(this.viewerWrapper.currentScale * 1.2)
      this.updateZoomLevel()
    }
  }

  /**
   * Handle zoom out - uses CSS transform for instant feedback
   */
  handleZoomOut() {
    if (this.viewerWrapper) {
      this.viewerWrapper.setScale(this.viewerWrapper.currentScale / 1.2)
      this.updateZoomLevel()
    }
  }

  /**
   * Update zoom level display
   */
  updateZoomLevel() {
    const zoomElement = this.toolbar.querySelector('.pdf-zoom-level')
    if (zoomElement && this.viewerWrapper) {
      zoomElement.textContent = `${Math.round(this.viewerWrapper.currentScale * 100)}%`
    }
  }

  /**
   * Highlight the current text selection
   */
  highlightSelection() {
    window.dispatchEvent(new CustomEvent('pdf-highlight-selection'))
  }

  /**
   * Update the highlight count display
   */
  updateHighlightCount() {
    if (this.highlightCounter) {
      const highlights = getHighlights()
      let totalHighlights = 0

      Object.values(highlights).forEach(pageHighlights => {
        if (Array.isArray(pageHighlights)) {
          totalHighlights += pageHighlights.length
        }
      })

      this.highlightCounter.textContent = `${totalHighlights} highlight${totalHighlights !== 1 ? 's' : ''}`
    }
  }

  /**
   * Clear all highlights
   */
  clearAllHighlights() {
    const highlights = getHighlights()
    let totalHighlights = 0

    Object.values(highlights).forEach(pageHighlights => {
      if (Array.isArray(pageHighlights)) {
        totalHighlights += pageHighlights.length
      }
    })

    if (totalHighlights === 0) {
      alert('No highlights to clear.')
      return
    }

    const confirmClear = confirm('Are you sure you want to clear all highlights? This action can be undone with Cmd+Z.')
    if (confirmClear) {
      window.dispatchEvent(new CustomEvent('pdf-clear-all-highlights'))
      // Update the highlight count after clearing
      this.updateHighlightCount()
    }
  }

  /**
   * Extract highlights to markdown file
   * If text is selected, highlight it first before extracting
   */
  async extractHighlights() {
    try {
      // Check if there's text selected and no highlights yet - if so, highlight the selection first
      const selection = window.getSelection()
      if (selection && selection.toString().trim() && selection.rangeCount > 0) {
        // Check if this selection is within the PDF viewer
        const range = selection.getRangeAt(0)
        const pdfContainer = range.commonAncestorContainer.closest?.('.pdf-viewer-container') ||
                           range.commonAncestorContainer.parentElement?.closest?.('.pdf-viewer-container')

        if (pdfContainer) {
          console.log('Creating highlight from selected text before extraction')
          // Create highlight from selection
          window.dispatchEvent(new CustomEvent('pdf-highlight-selection'))

          // Wait a moment for the highlight to be created
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      const markdownPath = await extractHighlightsToMarkdown(this.pdfPath)
      console.log(`Highlights extracted to: ${markdownPath}`)

      // Show success notification instead of auto-opening
      alert(`Highlights extracted successfully!\nSaved to: ${markdownPath.split('/').pop()}`)

      // File will appear in the file tree for manual opening
    } catch (error) {
      console.error('Error extracting highlights:', error)
      alert(`Failed to extract highlights: ${error.message}`)
    }
  }

  /**
   * Open PDF intelligence extraction dialog
   * Extracts text only; panel not shown for text-only results (no enrichments)
   */
  async openIntelligencePanel() {
    try {
      const { IntelligenceService } = await import('../pdf-intelligence/IntelligenceService.js')
      const service = new IntelligenceService(this.fullPath || this.pdfPath)

      // Listen for completion to show feedback
      service.onStatusChange((event, data) => {
        if (event === 'complete') {
          this.showExtractionComplete()
        } else if (event === 'error') {
          console.error('Extraction error:', data)
          alert(`Extraction failed: ${data.message || data}`)
        }
      })

      service.openConfigDialog()
    } catch (error) {
      console.error('Error opening intelligence panel:', error)
      alert(`Failed to open intelligence panel: ${error.message}`)
    }
  }

  /**
   * Show extraction complete feedback and refresh file tree
   */
  showExtractionComplete() {
    // Refresh file tree to show new .vault.json file
    if (window.refreshFileTree) {
      window.refreshFileTree()
    }
  }

  /**
   * Set up keyboard shortcuts for PDF navigation
   */
  setupKeyboardShortcuts() {
    // Use a bound function to maintain context
    this.keyboardHandler = (e) => {
      // Only handle shortcuts when this PDF tab is active
      if (!this.container || !this.container.closest('.tab-content.active')) {
        return
      }

      // Navigation shortcuts
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        this.previousPage()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        this.nextPage()
      }

      // Zoom shortcuts
      else if (e.metaKey && e.key === '+') {
        e.preventDefault()
        this.handleZoomIn()
      } else if (e.metaKey && e.key === '-') {
        e.preventDefault()
        this.handleZoomOut()
      }

      // Extract highlights
      else if (e.metaKey && e.shiftKey && e.key === 'e') {
        e.preventDefault()
        this.extractHighlights()
      }

      // Extract intelligence
      else if (e.metaKey && e.shiftKey && e.key === 'i') {
        e.preventDefault()
        this.openIntelligencePanel()
      }

      // Highlight selected text
      else if (e.metaKey && e.shiftKey && e.key === 'h') {
        e.preventDefault()
        // This will be handled by PDFHighlightManager
        window.dispatchEvent(new CustomEvent('pdf-highlight-selection'))
      }

      // Undo highlight
      else if (e.metaKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('pdf-undo-highlight'))
      }

      // Redo highlight
      else if (e.metaKey && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('pdf-redo-highlight'))
      }
    }

    document.addEventListener('keydown', this.keyboardHandler)
  }

  /**
   * Clean up when tab is closed
   */
  destroy() {
    console.log('Destroying PDF tab')

    // Remove keyboard event listener
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler)
    }

    // Save highlights before closing
    saveHighlights(this.pdfPath).catch(error => {
      console.error('Error saving highlights on close:', error)
    })

    // Clean up highlight manager
    cleanupHighlightManager()

    // Clean up viewer wrapper
    if (this.viewerWrapper) {
      if (this.pageChangeHandler) {
        this.viewerWrapper.offPageChange(this.pageChangeHandler)
        this.pageChangeHandler = null
      }
      this.viewerWrapper.destroy()
      this.viewerWrapper = null
    }

    // Clear container
    if (this.container) {
      this.container.remove()
    }
  }

  /**
   * Update scroll position to track current page
   */
  updateCurrentPage() {
    // Support both .pdf-page (legacy) and .page (PDF.js) selectors
    const pages = this.viewerContainer.querySelectorAll('.pdf-page, .pdfViewer .page')
    const containerRect = this.viewerContainer.getBoundingClientRect()

    for (let i = 0; i < pages.length; i++) {
      const pageRect = pages[i].getBoundingClientRect()
      // Check if page is in viewport
      if (pageRect.top < containerRect.top + containerRect.height / 2 &&
          pageRect.bottom > containerRect.top) {
        const newPage = parseInt(pages[i].getAttribute('data-page-number'))
        if (newPage !== this.currentPage) {
          this.currentPage = newPage
          this.updatePageCounter()
        }
        break
      }
    }
  }

  /**
   * Focus the PDF viewer
   */
  focus() {
    if (this.viewerContainer) {
      this.viewerContainer.focus()
    }
  }
}
