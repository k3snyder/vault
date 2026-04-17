// PDFViewerWrapper.js - Encapsulates PDF.js PDFViewer setup with virtualization
// Provides page lifecycle events for highlight system integration

import * as pdfjsLib from 'pdfjs-dist'
import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer'

// Import PDF.js viewer CSS for proper styling
import 'pdfjs-dist/web/pdf_viewer.css'

// Configure PDF.js worker - use local worker to avoid CDN issues
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'

/**
 * Wrapper around PDF.js PDFViewer that provides:
 * - Built-in virtualization (only renders visible pages)
 * - Page lifecycle events for highlight integration
 * - Simple API for zoom and document management
 */
export class PDFViewerWrapper {
  /**
   * Create a new PDFViewerWrapper
   * @param {HTMLElement} containerElement - The container element for the viewer
   */
  constructor(containerElement) {
    this.container = containerElement
    this.eventBus = null
    this.viewer = null
    this.viewerElement = null
    this.pdfDocument = null
    this.pageChangeCallbacks = new Set()
  }

  /**
   * Initialize the PDF viewer
   * Creates the PDFViewer instance with virtualization enabled
   */
  async initialize() {
    // Prevent duplicate initialization
    if (this.viewer) {
      return
    }

    // PDF.js PDFViewer requires a specific DOM structure:
    // <container>
    //   <div class="pdfViewer"></div>
    // </container>
    // Create the viewer element inside the container
    this.viewerElement = document.createElement('div')
    this.viewerElement.className = 'pdfViewer'
    this.container.appendChild(this.viewerElement)

    // Create event bus for internal PDF.js communication
    this.eventBus = new EventBus()

    // Create viewer with virtualization enabled
    this.viewer = new PDFViewer({
      container: this.container,
      viewer: this.viewerElement,
      eventBus: this.eventBus,
      textLayerMode: 2,           // Enable text layer for selection
      annotationMode: 0,          // Disable built-in annotations (we use our own highlights)
      removePageBorders: false    // Keep page shadows for visual separation
    })

    // Hook into page lifecycle events for highlight system
    this.eventBus.on('pagerendered', this._onPageRendered.bind(this))
    this.eventBus.on('pagechanging', this._onPageChanging.bind(this))
    this.eventBus.on('pagesdestroy', this._onPagesDestroy.bind(this))
  }

  /**
   * Wait until the container is actually attached to the DOM and has layout
   * @private
   */
  _waitForLayout() {
    return new Promise((resolve) => {
      const check = () => {
        // Check if container is in document and has layout (offsetParent is set)
        if (this.container.offsetParent !== null ||
            document.body.contains(this.container) && this.container.offsetWidth > 0) {
          resolve()
        } else {
          requestAnimationFrame(check)
        }
      }
      check()
    })
  }

  /**
   * Load a PDF document
   * @param {Object} pdfData - PDF data object (url, data, etc.)
   * @param {string|number} initialScale - Initial scale: 'page-width', 'page-fit', or number (default 'page-width')
   * @returns {Promise<number>} Number of pages in the document
   */
  async loadDocument(pdfData, initialScale = 'page-width') {
    const loadingTask = pdfjsLib.getDocument(pdfData)
    this.pdfDocument = await loadingTask.promise
    this.viewer.setDocument(this.pdfDocument)

    // Wait for pages to be initialized
    return new Promise((resolve) => {
      const onPagesInit = async () => {
        this.eventBus.off('pagesinit', onPagesInit)

        // Wait until container is actually in the DOM with layout
        await this._waitForLayout()

        // Set initial scale - this triggers the first render
        if (typeof initialScale === 'string') {
          this.viewer.currentScaleValue = initialScale
        } else {
          this.viewer.currentScale = initialScale
        }
        resolve(this.pdfDocument.numPages)
      }

      this.eventBus.on('pagesinit', onPagesInit)
    })
  }

  /**
   * Set the zoom scale
   * @param {number} scale - New scale value
   */
  setScale(scale) {
    if (this.viewer) {
      this.viewer.currentScale = scale
    }
  }

  /**
   * Get the current zoom scale
   * @returns {number} Current scale
   */
  get currentScale() {
    return this.viewer ? this.viewer.currentScale : 1
  }

  /**
   * Subscribe to PDF.js current-page changes.
   * @param {(pageNumber: number) => void} callback
   */
  onPageChange(callback) {
    if (typeof callback === 'function') {
      this.pageChangeCallbacks.add(callback)
    }
  }

  /**
   * Unsubscribe from PDF.js current-page changes.
   * @param {(pageNumber: number) => void} callback
   */
  offPageChange(callback) {
    this.pageChangeCallbacks.delete(callback)
  }

  /**
   * Handle page rendered event from PDF.js
   * Dispatches custom event for highlight system to restore highlights
   * @param {Object} evt - PDF.js pagerendered event
   * @private
   */
  _onPageRendered(evt) {
    window.dispatchEvent(new CustomEvent('pdf-page-rendered', {
      detail: {
        pageNumber: evt.pageNumber,
        pageElement: evt.source.div
      }
    }))
  }

  /**
   * Handle current page changes from PDF.js.
   * @param {Object} evt - PDF.js pagechanging event
   * @private
   */
  _onPageChanging(evt) {
    for (const callback of this.pageChangeCallbacks) {
      callback(evt.pageNumber)
    }
  }

  /**
   * Handle pages destroy event from PDF.js
   * Called when pages are being removed from DOM (virtualized out)
   * @private
   */
  _onPagesDestroy() {
    window.dispatchEvent(new CustomEvent('pdf-pages-cleanup'))
  }

  /**
   * Clean up resources
   * Call when closing the PDF tab
   */
  destroy() {
    if (this.viewer) {
      this.viewer.cleanup()
    }
    if (this.pdfDocument) {
      this.pdfDocument.destroy()
    }
    if (this.viewerElement && this.viewerElement.parentNode) {
      this.viewerElement.parentNode.removeChild(this.viewerElement)
    }
    this.viewerElement = null
    this.viewer = null
    this.pdfDocument = null
    this.eventBus = null
    this.pageChangeCallbacks.clear()
  }
}
