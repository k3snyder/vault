// PDFHighlightManager.js: Manages text selection, highlighting, and persistence for PDFs
// Handles highlight creation, storage, and extraction to markdown
// Updated to work with PDFViewerWrapper's virtualized page rendering

import { invoke } from '@tauri-apps/api/core'
import { dirname, join, basename } from '@tauri-apps/api/path'

// Module state
let currentSelection = null
let pdfPath = null
let container = null
let viewerWrapper = null
let highlights = {} // Structure: { pageNum: [{ bounds: [[x,y,w,h]], text: string }] }

const HIGHLIGHTS_ROOT_DIR = '.vault'
const LEGACY_HIGHLIGHTS_ROOT_DIR = '.gaimplan'
const HIGHLIGHTS_SUBDIR = 'pdf-highlights'

// Undo/redo history
let highlightHistory = []
let historyIndex = -1
const MAX_HISTORY = 50

// Event handler references for cleanup
let mouseUpHandler = null
let pageRenderedHandler = null

/**
 * Get current highlights
 * @returns {Object} Current highlights object
 */
export function getHighlights() {
  return highlights
}

/**
 * Set highlights (used when loading from storage)
 * @param {Object} newHighlights - Highlights object to set
 */
export function setHighlights(newHighlights) {
  highlights = newHighlights
  console.log('Highlights loaded:', Object.keys(highlights).length, 'pages with highlights')
}

/**
 * Add a highlight to a specific page
 * @param {number} pageNum - Page number
 * @param {Object} highlight - Highlight object with bounds and text
 */
export function addHighlight(pageNum, highlight) {
  if (!highlights[pageNum]) {
    highlights[pageNum] = []
  }
  highlights[pageNum].push(highlight)
  console.log(`Added highlight to page ${pageNum}: "${highlight.text.substring(0, 50)}..."`)
}

/**
 * Clear all highlights from memory
 */
export function clearHighlightsMemory() {
  highlights = {}
  console.log('All highlights cleared from memory')
}

async function getHighlightsPath(filePath, rootDir = HIGHLIGHTS_ROOT_DIR) {
  const pdfDir = await dirname(filePath)
  const pdfName = await basename(filePath)
  return join(pdfDir, rootDir, HIGHLIGHTS_SUBDIR, `${pdfName}.json`)
}

async function getHighlightPaths(filePath) {
  const currentPath = await getHighlightsPath(filePath, HIGHLIGHTS_ROOT_DIR)
  const legacyPath = await getHighlightsPath(filePath, LEGACY_HIGHLIGHTS_ROOT_DIR)
  return { currentPath, legacyPath }
}

async function fileExists(filePath) {
  return invoke('file_exists', { filePath })
}

async function deleteHighlightFileIfExists(filePath) {
  if (await fileExists(filePath)) {
    await invoke('delete_file', { filePath })
    console.log(`Deleted highlight file: ${filePath}`)
  }
}

/**
 * Initialize the highlight manager for a PDF viewer
 * @param {HTMLElement} viewerContainer - The PDF viewer container
 * @param {string} filePath - Path to the PDF file
 * @param {Object} wrapper - PDFViewerWrapper instance (optional, for scale info)
 */
export function initHighlightManager(viewerContainer, filePath, wrapper = null) {
  console.log('Initializing highlight manager for:', filePath)

  container = viewerContainer
  pdfPath = filePath
  viewerWrapper = wrapper

  // Set up selection tracking
  mouseUpHandler = handleTextSelection
  viewerContainer.addEventListener('mouseup', mouseUpHandler)

  // Listen for highlight command
  window.addEventListener('pdf-highlight-selection', highlightCurrentSelection)

  // Listen for undo/redo commands
  window.addEventListener('pdf-undo-highlight', undoHighlight)
  window.addEventListener('pdf-redo-highlight', redoHighlight)
  window.addEventListener('pdf-clear-all-highlights', handleClearAllHighlights)

  // Listen for page render events (for virtualized rendering)
  pageRenderedHandler = handlePageRendered
  window.addEventListener('pdf-page-rendered', pageRenderedHandler)

  // Initialize history with current state
  saveToHistory()
}

/**
 * Clean up the highlight manager - remove all event listeners and clear state
 */
export function cleanupHighlightManager() {
  console.log('Cleaning up highlight manager')

  // Remove event listeners from container
  if (container && mouseUpHandler) {
    container.removeEventListener('mouseup', mouseUpHandler)
  }

  // Remove window event listeners
  window.removeEventListener('pdf-highlight-selection', highlightCurrentSelection)
  window.removeEventListener('pdf-undo-highlight', undoHighlight)
  window.removeEventListener('pdf-redo-highlight', redoHighlight)
  window.removeEventListener('pdf-clear-all-highlights', handleClearAllHighlights)

  if (pageRenderedHandler) {
    window.removeEventListener('pdf-page-rendered', pageRenderedHandler)
  }

  // Clear state
  currentSelection = null
  pdfPath = null
  container = null
  viewerWrapper = null
  highlightHistory = []
  historyIndex = -1
}

/**
 * Handle page rendered events from PDFViewerWrapper
 * Renders highlights for the newly rendered page
 * @param {CustomEvent} event - pdf-page-rendered event
 */
function handlePageRendered(event) {
  const { pageNumber, pageElement } = event.detail
  renderHighlightsForPage(pageNumber, pageElement)
}

/**
 * Render highlights for a specific page
 * @param {number} pageNum - Page number
 * @param {HTMLElement} pageElement - Page container element
 */
function renderHighlightsForPage(pageNum, pageElement) {
  const pageHighlights = highlights[pageNum]
  if (!pageHighlights || pageHighlights.length === 0) return

  console.log(`Rendering ${pageHighlights.length} highlights for page ${pageNum}`)

  // Clear any existing highlights on this page first
  const existingHighlights = pageElement.querySelectorAll('.pdf-highlight')
  existingHighlights.forEach(el => el.remove())

  const scale = getCurrentScale()

  pageHighlights.forEach((highlight) => {
    renderHighlight(pageElement, highlight, pageNum, scale)
  })
}

/**
 * Get current scale from viewerWrapper or default
 * @returns {number} Current scale
 */
function getCurrentScale() {
  if (viewerWrapper && viewerWrapper.currentScale) {
    return viewerWrapper.currentScale
  }
  return 1.5 // Default scale
}

/**
 * Handle text selection events
 * @param {MouseEvent} event - Mouse up event
 */
function handleTextSelection(event) {
  const selection = window.getSelection()

  if (selection.rangeCount === 0 || selection.isCollapsed) {
    currentSelection = null
    return
  }

  // Get the selected range
  const range = selection.getRangeAt(0)

  // Check if selection is within the PDF viewer
  if (!container.contains(range.commonAncestorContainer)) {
    currentSelection = null
    return
  }

  // Store current selection info
  currentSelection = {
    range: range,
    text: selection.toString().trim()
  }

  console.log('Text selected:', currentSelection.text.substring(0, 50) + '...')
}

/**
 * Highlight the current selection
 */
async function highlightCurrentSelection() {
  if (!currentSelection || !currentSelection.text) {
    console.log('No text selected to highlight')
    return
  }

  try {
    // Get the page number from the selection
    const pageElement = getPageElementFromNode(currentSelection.range.commonAncestorContainer)
    if (!pageElement) {
      console.error('Could not determine page for selection')
      return
    }

    const pageNum = parseInt(pageElement.getAttribute('data-page-number'))

    // Get bounding rectangles for the selection
    const rects = Array.from(currentSelection.range.getClientRects())

    // Convert to page-relative coordinates
    const pageRect = pageElement.getBoundingClientRect()
    const scale = getCurrentScale()

    const bounds = rects.map(rect => {
      return [
        (rect.left - pageRect.left) / scale,
        (rect.top - pageRect.top) / scale,
        rect.width / scale,
        rect.height / scale
      ]
    })

    // Create highlight object
    const highlight = {
      text: currentSelection.text,
      bounds: bounds,
      timestamp: new Date().toISOString()
    }

    // Save current state to history before making changes
    saveToHistory()

    // Add to highlights
    addHighlight(pageNum, highlight)

    // Render the highlight immediately
    renderHighlight(pageElement, highlight, pageNum, scale)

    // Save highlights
    await saveHighlights(pdfPath)

    // Update the highlight count in the toolbar
    updateHighlightCountInToolbar()

    // Clear selection
    window.getSelection().removeAllRanges()
    currentSelection = null

    console.log(`Highlighted text on page ${pageNum}`)
  } catch (error) {
    console.error('Error creating highlight:', error)
  }
}

/**
 * Get the page element containing a node
 * Supports both legacy .pdf-page and PDF.js .page selectors
 * @param {Node} node - DOM node
 * @returns {HTMLElement|null} Page element or null
 */
function getPageElementFromNode(node) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement

  // Check for both .pdf-page (legacy) and .page (PDF.js) classes
  while (element) {
    if (element.classList.contains('pdf-page') || element.classList.contains('page')) {
      return element
    }
    element = element.parentElement
  }

  return null
}

/**
 * Render a single highlight on a page
 * @param {HTMLElement} pageElement - Page container element
 * @param {Object} highlight - Highlight object
 * @param {number} pageNum - Page number
 * @param {number} scale - Current scale
 */
function renderHighlight(pageElement, highlight, pageNum, scale) {
  highlight.bounds.forEach((rect) => {
    const highlightDiv = document.createElement('div')
    highlightDiv.className = 'pdf-highlight'
    highlightDiv.style.position = 'absolute'
    highlightDiv.style.left = `${rect[0] * scale}px`
    highlightDiv.style.top = `${rect[1] * scale}px`
    highlightDiv.style.width = `${rect[2] * scale}px`
    highlightDiv.style.height = `${rect[3] * scale}px`
    highlightDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.4)' // Yellow
    highlightDiv.style.pointerEvents = 'none'
    highlightDiv.style.mixBlendMode = 'multiply'
    highlightDiv.setAttribute('data-page', pageNum)
    highlightDiv.setAttribute('data-highlight-text', highlight.text)

    pageElement.appendChild(highlightDiv)
  })
}

/**
 * Save highlights to disk
 * @param {string} filePath - PDF file path
 */
export async function saveHighlights(filePath) {
  try {
    if (Object.keys(highlights).length === 0) {
      console.log('No highlights to save')
      return
    }

    // Save highlights file
    const highlightsPath = await getHighlightsPath(filePath)

    await invoke('write_file_content', {
      filePath: highlightsPath,
      content: JSON.stringify(highlights, null, 2)
    })
    console.log(`Saved highlights to: ${highlightsPath}`)
  } catch (error) {
    console.error('Error saving highlights:', error)
  }
}

/**
 * Load highlights from disk
 * @param {string} filePath - PDF file path
 */
export async function loadHighlights(filePath) {
  try {
    const { currentPath, legacyPath } = await getHighlightPaths(filePath)

    if (await fileExists(currentPath)) {
      const content = await invoke('read_file_content', { filePath: currentPath })
      const loadedHighlights = JSON.parse(content)
      setHighlights(loadedHighlights)
      console.log('Loaded highlights from:', currentPath)
      updateHighlightCountInToolbar()
      return
    }

    if (currentPath !== legacyPath && await fileExists(legacyPath)) {
      const content = await invoke('read_file_content', { filePath: legacyPath })
      const loadedHighlights = JSON.parse(content)
      setHighlights(loadedHighlights)
      console.log('Loaded legacy highlights from:', legacyPath)
      updateHighlightCountInToolbar()

      // Migrate legacy highlight storage forward after a successful load.
      await invoke('write_file_content', {
        filePath: currentPath,
        content: JSON.stringify(loadedHighlights, null, 2)
      })
      await invoke('delete_file', { filePath: legacyPath })
      console.log(`Migrated highlights to: ${currentPath}`)
      return
    }

    console.log('No existing highlights found')
    setHighlights({})
  } catch (error) {
    console.error('Error loading highlights:', error)
    setHighlights({})
  }
}

/**
 * Extract all highlights to a markdown file
 * @param {string} filePath - PDF file path
 * @returns {Promise<string>} Path to the created markdown file
 */
export async function extractHighlightsToMarkdown(filePath) {
  try {
    const pdfName = await basename(filePath)
    const pdfNameWithoutExt = pdfName.replace(/\.pdf$/i, '')

    // Prepare the markdown file path
    const pdfDir = await dirname(filePath)
    const markdownPath = await join(pdfDir, `${pdfNameWithoutExt}-highlights.md`)

    // Check if file exists and has frontmatter
    let existingFrontmatter = ''
    let existingContent = ''
    try {
      const existing = await invoke('read_file_content', { filePath: markdownPath })

      // Parse existing frontmatter if present
      if (existing.startsWith('---\n')) {
        const frontmatterEnd = existing.indexOf('\n---\n', 4)
        if (frontmatterEnd !== -1) {
          // Extract frontmatter including the closing ---
          existingFrontmatter = existing.substring(0, frontmatterEnd + 5)
          // Keep any content after frontmatter that isn't our generated highlights
          const afterFrontmatter = existing.substring(frontmatterEnd + 5)
          // Look for our marker to identify generated content
          if (!afterFrontmatter.includes('# PDF Highlights:')) {
            existingContent = afterFrontmatter
          }
        }
      }
    } catch (error) {
      // File doesn't exist, which is fine
      console.log('No existing highlights file found, creating new one')
    }

    // Generate frontmatter if none exists
    if (!existingFrontmatter) {
      const now = new Date()
      existingFrontmatter = `---
title: "${pdfNameWithoutExt} Highlights"
source: "${pdfName}"
created_at: ${now.toISOString()}
updated_at: ${now.toISOString()}
type: pdf-highlights
tags: []
---`
    } else {
      // Update the updated_at field in existing frontmatter
      const now = new Date()
      existingFrontmatter = existingFrontmatter.replace(
        /updated_at:.*$/m,
        `updated_at: ${now.toISOString()}`
      )
      // If no updated_at field exists, add it before the closing ---
      if (!existingFrontmatter.includes('updated_at:')) {
        existingFrontmatter = existingFrontmatter.replace(
          /\n---$/,
          `\nupdated_at: ${now.toISOString()}\n---`
        )
      }
    }

    // Generate highlights content
    let highlightsContent = `\n# PDF Highlights: ${pdfName}\n\n`

    if (Object.keys(highlights).length === 0) {
      highlightsContent += '*No highlights found in this PDF.*\n'
    } else {
      // Add summary
      const totalHighlights = Object.values(highlights).reduce((sum, pageHighlights) =>
        sum + (pageHighlights ? pageHighlights.length : 0), 0)
      highlightsContent += `*Total highlights: ${totalHighlights}*\n\n`

      // Sort pages numerically
      const sortedPages = Object.keys(highlights).sort((a, b) => parseInt(a) - parseInt(b))

      for (const pageNum of sortedPages) {
        const pageHighlights = highlights[pageNum]

        if (pageHighlights && pageHighlights.length > 0) {
          highlightsContent += `## Page ${pageNum}\n\n`

          pageHighlights.forEach((highlight) => {
            highlightsContent += `- "${highlight.text}"\n`
          })

          highlightsContent += '\n'
        }
      }
    }

    // Add extraction metadata at the bottom
    highlightsContent += `---\n\n`
    highlightsContent += `*Last extracted: ${new Date().toLocaleString()}*\n`
    highlightsContent += `*Source: ${pdfName}*\n`

    // Combine everything: frontmatter at top, then any existing content, then highlights
    const finalContent = existingFrontmatter + '\n' +
                        (existingContent ? existingContent + '\n' : '') +
                        highlightsContent

    // Save the file
    await invoke('write_file_content', {
      filePath: markdownPath,
      content: finalContent
    })
    console.log(`Extracted highlights to: ${markdownPath}`)

    // Emit event that file was updated
    window.dispatchEvent(new CustomEvent('file-updated', {
      detail: { filePath: markdownPath }
    }))

    return markdownPath
  } catch (error) {
    console.error('Error extracting highlights:', error)
    throw error
  }
}

/**
 * Update highlight count in the toolbar
 */
function updateHighlightCountInToolbar() {
  const highlightCounter = document.querySelector('.pdf-highlight-count')
  if (highlightCounter) {
    let totalHighlights = 0

    Object.values(highlights).forEach(pageHighlights => {
      if (Array.isArray(pageHighlights)) {
        totalHighlights += pageHighlights.length
      }
    })

    highlightCounter.textContent = `${totalHighlights} highlight${totalHighlights !== 1 ? 's' : ''}`
  }
}

/**
 * Save current highlights state to history
 */
function saveToHistory() {
  // Remove any states after current index (when we add new state after undo)
  highlightHistory = highlightHistory.slice(0, historyIndex + 1)

  // Add current state
  highlightHistory.push(JSON.parse(JSON.stringify(highlights)))
  historyIndex++

  // Limit history size
  if (highlightHistory.length > MAX_HISTORY) {
    highlightHistory.shift()
    historyIndex--
  }
}

/**
 * Undo last highlight action
 */
async function undoHighlight() {
  if (historyIndex <= 0) {
    console.log('Nothing to undo')
    return
  }

  historyIndex--
  const previousState = highlightHistory[historyIndex]

  // Apply the previous state
  setHighlights(previousState)

  // Re-render all highlights
  reRenderAllHighlights()

  // Save to disk
  await saveHighlights(pdfPath)

  // Update count
  updateHighlightCountInToolbar()

  console.log('Undid highlight action')
}

/**
 * Redo previously undone highlight action
 */
async function redoHighlight() {
  if (historyIndex >= highlightHistory.length - 1) {
    console.log('Nothing to redo')
    return
  }

  historyIndex++
  const nextState = highlightHistory[historyIndex]

  // Apply the next state
  setHighlights(nextState)

  // Re-render all highlights
  reRenderAllHighlights()

  // Save to disk
  await saveHighlights(pdfPath)

  // Update count
  updateHighlightCountInToolbar()

  console.log('Redid highlight action')
}

/**
 * Re-render all highlights on all existing pages
 * Only renders highlights for pages that are currently in the DOM
 * (handles virtualized rendering gracefully)
 */
function reRenderAllHighlights() {
  // Remove all existing highlight elements
  if (container) {
    const existingHighlights = container.querySelectorAll('.pdf-highlight')
    existingHighlights.forEach(el => el.remove())
  }

  // Re-render highlights for each page that exists in the DOM
  const scale = getCurrentScale()
  Object.entries(highlights).forEach(([pageNum, pageHighlights]) => {
    // Support both .pdf-page and .page selectors
    const pageElement = container.querySelector(`[data-page-number="${pageNum}"]`)
    if (pageElement && pageHighlights && pageHighlights.length > 0) {
      pageHighlights.forEach((highlight) => {
        renderHighlight(pageElement, highlight, pageNum, scale)
      })
    }
    // Silent skip if page doesn't exist (it's virtualized out)
  })
}

/**
 * Handle clear all highlights with history
 */
async function handleClearAllHighlights() {
  // Save current state to history first
  saveToHistory()

  // Clear all highlights
  await clearAllHighlights()
}

/**
 * Clear all highlights from the current PDF
 */
export async function clearAllHighlights() {
  // Remove highlight elements from DOM
  if (container) {
    const highlightElements = container.querySelectorAll('.pdf-highlight')
    highlightElements.forEach(el => el.remove())
  }

  // Clear from memory
  setHighlights({})

  // Delete the highlight file completely
  if (pdfPath) {
    try {
      const { currentPath, legacyPath } = await getHighlightPaths(pdfPath)
      await deleteHighlightFileIfExists(currentPath)
      if (legacyPath !== currentPath) {
        await deleteHighlightFileIfExists(legacyPath)
      }
    } catch (error) {
      // File might not exist, which is fine
      console.log('No highlight file to delete or error deleting:', error)
    }
  }

  console.log('All highlights cleared')

  // Update the highlight count in the toolbar
  updateHighlightCountInToolbar()
}
