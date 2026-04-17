/**
 * Floating Toolbar Extension for CodeMirror 6
 *
 * Provides a floating formatting toolbar that appears when text is selected.
 * Supports toggle behavior for bold, italic, strikethrough, code, and links.
 *
 * Features:
 * - Positioned above selection (or below if near top of editor)
 * - Appears after 100ms delay when selection stabilizes
 * - Disappears on click outside, Escape, or selection cleared
 * - Toggle behavior: clicking Bold on bold text removes the markers
 * - Buttons show "active" state when format is already applied
 */

import { EditorView, ViewPlugin } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

// Lucide SVG icons (16x16, viewBox 0 0 24 24)
const ICONS = {
  bold: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
  italic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
  highlight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
  list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  task: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="m9 12 2 2 4-4"/></svg>',
  h1: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>',
  h2: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
  h3: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>',
  strikethrough: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
}

// Toolbar buttons configuration
const TOOLBAR_BUTTONS = [
  { id: 'bold', icon: ICONS.bold, title: 'Bold (Cmd+B)', marker: '**' },
  { id: 'italic', icon: ICONS.italic, title: 'Italic (Cmd+I)', marker: '*' },
  { id: 'highlight', icon: ICONS.highlight, title: 'Highlight (Cmd+Shift+H)', marker: '==' },
  { id: 'bullet', icon: ICONS.list, title: 'Bullet List', prefix: '- ' },
  { id: 'task', icon: ICONS.task, title: 'Task', prefix: '- [ ] ' },
  { id: 'h1', icon: ICONS.h1, title: 'Heading 1', prefix: '# ' },
  { id: 'h2', icon: ICONS.h2, title: 'Heading 2', prefix: '## ' },
  { id: 'h3', icon: ICONS.h3, title: 'Heading 3', prefix: '### ' },
  { id: 'strikethrough', icon: ICONS.strikethrough, title: 'Strikethrough', marker: '~~' },
  { id: 'code', icon: ICONS.code, title: 'Code (Cmd+`)', marker: '`' },
  { id: 'link', icon: ICONS.link, title: 'Link (Cmd+K)', action: 'link' },
]

/**
 * Check if the selection is wrapped with a specific marker
 */
function isFormatActive(view, marker) {
  const { from, to } = view.state.selection.main
  const markerLen = marker.length
  const before = view.state.sliceDoc(from - markerLen, from)
  const after = view.state.sliceDoc(to, to + markerLen)
  return before === marker && after === marker
}

function selectionOverlapsRange(selection, from, to) {
  return to > selection.from && from < selection.to
}

function selectionInsideMarkerRange(view, marker) {
  return Boolean(findMarkerRange(view, marker))
}

function adjustPositionForRemovals(pos, removals) {
  let adjusted = pos

  for (const removal of removals) {
    const length = removal.to - removal.from

    if (pos >= removal.to) {
      adjusted -= length
      continue
    }

    if (pos > removal.from) {
      adjusted = removal.from
      break
    }
  }

  return adjusted
}

function findSyntaxMarkRange(view, marker) {
  const selection = view.state.selection.main
  if (selection.empty) return null

  const nodeNamesByMarker = {
    '**': ['StrongEmphasis'],
    '*': ['Emphasis'],
    '~~': ['Strikethrough'],
    '`': ['InlineCode'],
  }

  const matchingNodeNames = nodeNamesByMarker[marker]
  if (!matchingNodeNames) {
    return null
  }

  let bestMatch = null
  const tree = syntaxTree(view.state)
  tree.iterate({
    from: selection.from,
    to: selection.to,
    enter: (node) => {
      if (!matchingNodeNames.includes(node.name)) {
        return
      }

      if (!selectionOverlapsRange(selection, node.from, node.to)) {
        return
      }

      const candidate = {
        openFrom: node.from,
        openTo: node.from + marker.length,
        closeFrom: node.to - marker.length,
        closeTo: node.to,
      }

      if (!bestMatch || (candidate.closeTo - candidate.openFrom) < (bestMatch.closeTo - bestMatch.openFrom)) {
        bestMatch = candidate
      }
    }
  })

  return bestMatch
}

function findMarkerRange(view, marker) {
  const selection = view.state.selection.main
  if (selection.empty) return null

  const syntaxRange = findSyntaxMarkRange(view, marker)
  if (syntaxRange) {
    return syntaxRange
  }

  const doc = view.state.doc.toString()
  let searchFrom = 0
  let bestMatch = null

  while (searchFrom < doc.length) {
    const start = doc.indexOf(marker, searchFrom)
    if (start === -1) {
      break
    }

    const contentStart = start + marker.length
    const closeFrom = doc.indexOf(marker, contentStart)
    if (closeFrom === -1) {
      break
    }

    if (selectionOverlapsRange(selection, contentStart, closeFrom)) {
      const candidate = {
        openFrom: start,
        openTo: contentStart,
        closeFrom,
        closeTo: closeFrom + marker.length,
      }

      if (!bestMatch || (candidate.closeTo - candidate.openFrom) < (bestMatch.closeTo - bestMatch.openFrom)) {
        bestMatch = candidate
      }
    }

    searchFrom = closeFrom + marker.length
  }

  return bestMatch
}

function findSingleStructuredLineContentRange(view) {
  const selection = view.state.selection.main
  if (selection.empty) return null

  const doc = view.state.doc
  const startLine = doc.lineAt(selection.from)
  const endLinePos = Math.max(selection.to - 1, selection.from)
  const endLine = doc.lineAt(endLinePos)

  if (startLine.number !== endLine.number) {
    return null
  }

  if (selection.from !== startLine.from || selection.to !== startLine.to) {
    return null
  }

  const match = startLine.text.match(/^(\s*(?:#{1,6}\s+|- \[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s+))(.*)$/)
  if (!match || !match[2]) {
    return null
  }

  return {
    from: startLine.from + match[1].length,
    to: startLine.to
  }
}

function selectedLinesMatch(view, matcher) {
  const selection = view.state.selection.main
  if (selection.empty) return false

  const doc = view.state.doc
  const startLine = doc.lineAt(selection.from)
  const endLinePos = Math.max(selection.from, selection.to - 1)
  const endLine = doc.lineAt(endLinePos)
  let foundContentLine = false

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = doc.line(lineNumber)
    if (!line.text.trim()) continue
    foundContentLine = true
    if (!matcher(line.text)) {
      return false
    }
  }

  return foundContentLine
}

function getSyntaxActiveButtons(view) {
  const selection = view.state.selection.main
  const active = new Set()
  if (selection.empty) return active

  const tree = syntaxTree(view.state)
  tree.iterate({
    from: selection.from,
    to: selection.to,
    enter: (node) => {
      if (!selectionOverlapsRange(selection, node.from, node.to)) {
        return
      }

      switch (node.name) {
        case 'StrongEmphasis':
          active.add('bold')
          break
        case 'Emphasis':
          active.add('italic')
          break
        case 'Highlight':
          active.add('highlight')
          break
        case 'Strikethrough':
          active.add('strikethrough')
          break
        case 'InlineCode':
          active.add('code')
          break
        case 'Link':
          active.add('link')
          break
        default:
          break
      }
    }
  })

  return active
}

function getFallbackActiveButtons(view) {
  const active = new Set()

  if (selectionInsideMarkerRange(view, '==')) {
    active.add('highlight')
  }

  return active
}

function getLinePrefixActiveButtons(view) {
  const active = new Set()

  if (selectedLinesMatch(view, (line) => /^\s*#\s+/.test(line))) {
    active.add('h1')
  }
  if (selectedLinesMatch(view, (line) => /^\s*##\s+/.test(line))) {
    active.add('h2')
  }
  if (selectedLinesMatch(view, (line) => /^\s*###\s+/.test(line))) {
    active.add('h3')
  }
  if (selectedLinesMatch(view, (line) => /^\s*-\s+\[[ xX]\]\s+/.test(line))) {
    active.add('task')
  }
  if (selectedLinesMatch(view, (line) => /^\s*[-*+]\s+(?!\[[ xX]\]\s+)/.test(line))) {
    active.add('bullet')
  }

  return active
}

function getActiveToolbarButtons(view) {
  const active = getSyntaxActiveButtons(view)
  getFallbackActiveButtons(view).forEach((buttonId) => active.add(buttonId))
  getLinePrefixActiveButtons(view).forEach((buttonId) => active.add(buttonId))

  return active
}

/**
 * Toggle a formatting marker around the selection
 * If already wrapped, remove the markers; otherwise add them
 */
function toggleMark(view, marker) {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  const markerLen = marker.length

  const activeRange = findMarkerRange(view, marker)

  if (activeRange) {
    const removals = [
      { from: activeRange.openFrom, to: activeRange.openTo },
      { from: activeRange.closeFrom, to: activeRange.closeTo }
    ]

    view.dispatch({
      changes: removals.map(({ from: removalFrom, to: removalTo }) => ({
        from: removalFrom,
        to: removalTo,
        insert: ''
      })),
      selection: {
        anchor: adjustPositionForRemovals(from, removals),
        head: adjustPositionForRemovals(to, removals)
      }
    })
  } else {
    const structuredContentRange = findSingleStructuredLineContentRange(view)

    if (structuredContentRange) {
      view.dispatch({
        changes: [
          { from: structuredContentRange.from, to: structuredContentRange.from, insert: marker },
          { from: structuredContentRange.to, to: structuredContentRange.to, insert: marker }
        ],
        selection: {
          anchor: structuredContentRange.from + markerLen,
          head: structuredContentRange.to + markerLen
        }
      })
      view.focus()
      return
    }

    // Add markers, keep selection on the text
    view.dispatch({
      changes: { from, to, insert: marker + text + marker },
      selection: { anchor: from + markerLen, head: to + markerLen }
    })
  }

  view.focus()
}

/**
 * Insert a markdown link around the selection
 * Places cursor between the parentheses for URL entry
 */
function insertLink(view) {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)

  // Insert [text](url) with cursor in url position
  const linkText = `[${text}]()`
  view.dispatch({
    changes: { from, to, insert: linkText },
    selection: { anchor: from + text.length + 3 } // cursor between ()
  })

  view.focus()
}

/**
 * Apply a line prefix (for headings, lists, etc.)
 * Replaces any existing prefix on the line
 */
function applyLinePrefix(view, prefix) {
  const { from, to } = view.state.selection.main
  const doc = view.state.doc

  // Get all lines in selection
  const startLine = doc.lineAt(from)
  const endLine = doc.lineAt(to)

  const changes = []
  let newSelectionStart = from
  let offsetAdjustment = 0

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = doc.line(lineNum)
    const lineText = line.text

    // Remove existing prefix patterns (headings, lists, tasks)
    const prefixMatch = lineText.match(/^(\s*)(#{1,6}\s+|- \[[ x]\] |- |\* |\d+\. )?(.*)$/)
    const indent = prefixMatch[1] || ''
    const existingPrefix = prefixMatch[2] || ''
    const content = prefixMatch[3] || ''

    // Calculate new line content
    const newLineText = indent + prefix + content

    if (lineNum === startLine.number) {
      // Adjust selection start based on prefix change
      const prefixDiff = prefix.length - existingPrefix.length
      newSelectionStart = from + prefixDiff
    }

    changes.push({
      from: line.from,
      to: line.to,
      insert: newLineText
    })

    offsetAdjustment += (prefix.length - existingPrefix.length)
  }

  view.dispatch({
    changes,
    selection: { anchor: newSelectionStart }
  })

  view.focus()
}

/**
 * Handle button click based on button configuration
 */
function handleButtonClick(view, button) {
  if (button.action === 'link') {
    insertLink(view)
  } else if (button.marker) {
    toggleMark(view, button.marker)
  } else if (button.prefix) {
    applyLinePrefix(view, button.prefix)
  }
}

/**
 * ViewPlugin to manage the floating toolbar UI
 */
const floatingToolbarPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view
      this.toolbar = null
      this.showTimeout = null
      this.boundHandleDocumentClick = this.handleDocumentClick.bind(this)
      this.boundHandleKeydown = this.handleKeydown.bind(this)
    }

    update(update) {
      const selection = update.view.state.selection.main
      const hasSelection = !selection.empty

      if (hasSelection) {
        // Selection exists, schedule showing toolbar
        this.scheduleShow()
      } else {
        // No selection, hide toolbar
        this.hide()
      }
    }

    scheduleShow() {
      clearTimeout(this.showTimeout)
      this.showTimeout = setTimeout(() => {
        // Verify selection still exists before showing
        const selection = this.view.state.selection.main
        if (!selection.empty) {
          this.show()
        }
      }, 100)
    }

    show() {
      // If toolbar already exists, just update position and active states
      if (this.toolbar) {
        this.positionToolbar()
        this.updateActiveStates()
        return
      }

      // Create toolbar DOM
      this.toolbar = this.createToolbar()
      this.positionToolbar()

      // Add event listeners for closing
      document.addEventListener('mousedown', this.boundHandleDocumentClick, true)
      document.addEventListener('keydown', this.boundHandleKeydown, true)

      // Append to body
      document.body.appendChild(this.toolbar)
    }

    hide() {
      clearTimeout(this.showTimeout)
      this.showTimeout = null

      if (this.toolbar) {
        document.removeEventListener('mousedown', this.boundHandleDocumentClick, true)
        document.removeEventListener('keydown', this.boundHandleKeydown, true)
        this.toolbar.remove()
        this.toolbar = null
      }
    }

    createToolbar() {
      const toolbar = document.createElement('div')
      toolbar.className = 'cm-floating-toolbar'
      toolbar.setAttribute('role', 'toolbar')
      toolbar.setAttribute('aria-label', 'Text formatting')

      // Apply inline styles (toolbar is appended to body, outside CodeMirror's theme scope)
      Object.assign(toolbar.style, {
        position: 'fixed',
        zIndex: '10000',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        backgroundColor: '#ffffff',
        border: '1px solid #e9e9e7',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
        padding: '4px',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
      })

      // Check for dark mode
      const isDarkMode = document.body.classList.contains('dark-mode') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches
      if (isDarkMode) {
        Object.assign(toolbar.style, {
          backgroundColor: '#1e1e1e',
          borderColor: '#3d3d3d',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)'
        })
      }

      for (const button of TOOLBAR_BUTTONS) {
        // Handle separator
        if (button.isSeparator) {
          const sep = document.createElement('div')
          Object.assign(sep.style, {
            width: '1px',
            height: '20px',
            backgroundColor: isDarkMode ? '#444444' : '#e0e0e0',
            margin: '0 4px'
          })
          toolbar.appendChild(sep)
          continue
        }

        const btn = document.createElement('button')
        btn.className = 'cm-floating-toolbar-btn'
        btn.setAttribute('type', 'button')
        btn.setAttribute('data-button-id', button.id)
        btn.setAttribute('title', button.title)
        btn.setAttribute('aria-label', button.title)
        btn.innerHTML = button.icon

        // Base button styles
        Object.assign(btn.style, {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: isDarkMode ? '#e0e0e0' : '#1f2937',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease'
        })

        // Apply highlight button special styling
        if (button.id === 'highlight') {
          btn.style.backgroundColor = 'rgba(255, 235, 59, 0.3)'
        }

        const activeButtons = getActiveToolbarButtons(this.view)

        // Check if format is active
        if (activeButtons.has(button.id)) {
          btn.style.backgroundColor = isDarkMode ? '#2d4a7c' : '#e8f0fe'
          btn.style.color = isDarkMode ? '#6bb3f8' : '#4572DE'
          btn.dataset.active = 'true'
        }

        // Get default background for this button
        const getDefaultBg = () => {
          if (button.id === 'highlight') return 'rgba(255, 235, 59, 0.3)'
          return 'transparent'
        }

        // Hover effects
        btn.addEventListener('mouseenter', () => {
          if (btn.dataset.active !== 'true') {
            btn.style.backgroundColor = isDarkMode ? '#333333' : '#f5f5f5'
          }
        })
        btn.addEventListener('mouseleave', () => {
          if (btn.dataset.active !== 'true') {
            btn.style.backgroundColor = getDefaultBg()
          }
        })

        // Handle click
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault() // Prevent losing selection
          e.stopPropagation()
          handleButtonClick(this.view, button)
          // Update active states after toggling
          this.updateActiveStates()
        })

        toolbar.appendChild(btn)
      }

      return toolbar
    }

    updateActiveStates() {
      if (!this.toolbar) return

      const isDarkMode = document.body.classList.contains('dark-mode') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches
      const activeButtons = getActiveToolbarButtons(this.view)

      const buttons = this.toolbar.querySelectorAll('.cm-floating-toolbar-btn')
      buttons.forEach(btn => {
        const buttonId = btn.getAttribute('data-button-id')
        const buttonConfig = TOOLBAR_BUTTONS.find(b => b.id === buttonId)

        if (!buttonConfig) return

        const isActive = activeButtons.has(buttonConfig.id)
        if (isActive) {
          btn.style.backgroundColor = isDarkMode ? '#2d4a7c' : '#e8f0fe'
          btn.style.color = isDarkMode ? '#6bb3f8' : '#4572DE'
          btn.dataset.active = 'true'
        } else {
          btn.style.backgroundColor = buttonConfig.id === 'highlight' ? 'rgba(255, 235, 59, 0.3)' : 'transparent'
          btn.style.color = isDarkMode ? '#e0e0e0' : '#1f2937'
          btn.dataset.active = 'false'
        }
      })
    }

    positionToolbar() {
      if (!this.toolbar) return

      const selection = this.view.state.selection.main
      const coords = this.view.coordsAtPos(selection.from)

      if (!coords) return

      const editorRect = this.view.dom.getBoundingClientRect()
      const toolbarHeight = 40 // Approximate toolbar height
      const toolbarWidth = 200 // Approximate toolbar width
      const gap = 8

      // Position above selection by default
      let top = coords.top - toolbarHeight - gap
      let left = coords.left

      // If too close to top of viewport, position below selection
      if (top < editorRect.top + 10 || top < 10) {
        const endCoords = this.view.coordsAtPos(selection.to)
        if (endCoords) {
          top = endCoords.bottom + gap
        }
      }

      // Constrain horizontal position to editor bounds
      const minLeft = editorRect.left + 8
      const maxLeft = editorRect.right - toolbarWidth - 8
      left = Math.max(minLeft, Math.min(left, maxLeft))

      // Also constrain to viewport
      left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8))

      this.toolbar.style.top = `${top}px`
      this.toolbar.style.left = `${left}px`
    }

    handleDocumentClick(e) {
      // If click is outside toolbar, hide it
      if (this.toolbar && !this.toolbar.contains(e.target)) {
        // Don't hide if clicking in the editor (selection might change)
        if (!this.view.dom.contains(e.target)) {
          this.hide()
        }
      }
    }

    handleKeydown(e) {
      // Hide on Escape
      if (e.key === 'Escape') {
        this.hide()
        e.preventDefault()
        e.stopPropagation()
      }
    }

    destroy() {
      this.hide()
    }
  }
)

/**
 * Keyboard shortcuts for formatting
 */
function createFormatCommand(marker) {
  return (view) => {
    const selection = view.state.selection.main
    if (selection.empty) return false
    toggleMark(view, marker)
    return true
  }
}

function createLinkCommand(view) {
  const selection = view.state.selection.main
  if (selection.empty) return false
  insertLink(view)
  return true
}

const floatingToolbarKeymap = keymap.of([
  { key: 'Mod-b', run: createFormatCommand('**') },
  { key: 'Mod-i', run: createFormatCommand('*') },
  { key: 'Mod-Shift-h', run: createFormatCommand('==') },
  { key: 'Mod-`', run: createFormatCommand('`') },
  { key: 'Mod-k', run: createLinkCommand },
])

/**
 * Styles for the floating toolbar
 */
const floatingToolbarStyles = EditorView.theme({
  '.cm-floating-toolbar': {
    position: 'fixed',
    zIndex: '1000',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    backgroundColor: 'var(--bg-primary, #ffffff)',
    border: '1px solid var(--border-color, #e9e9e7)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    padding: '4px',
    fontFamily: 'var(--font-family, Inter, -apple-system, BlinkMacSystemFont, sans-serif)'
  },

  '.cm-floating-toolbar-btn': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: 'var(--editor-text-color, #1f2937)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'background-color 0.1s ease, color 0.1s ease'
  },

  '.cm-floating-toolbar-btn:hover': {
    backgroundColor: 'var(--bg-hover, #f5f5f5)'
  },

  '.cm-floating-toolbar-btn:active': {
    backgroundColor: 'var(--bg-selected, #e8f0fe)'
  },

  '.cm-floating-toolbar-btn-active': {
    backgroundColor: 'var(--bg-selected, #e8f0fe) !important',
    color: 'var(--accent-color, #4572DE) !important'
  },

  '.cm-floating-toolbar-btn-bold': {
    fontWeight: '700'
  },

  '.cm-floating-toolbar-btn-italic': {
    fontStyle: 'italic',
    fontFamily: 'Georgia, "Times New Roman", serif'
  },

  '.cm-floating-toolbar-btn-strikethrough': {
    textDecoration: 'line-through'
  },

  '.cm-floating-toolbar-btn-code': {
    fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: '12px'
  },

  '.cm-floating-toolbar-btn-highlight': {
    backgroundColor: 'rgba(255, 235, 59, 0.3)',
    fontWeight: '600'
  },

  // Dark mode support through CSS variables
  '@media (prefers-color-scheme: dark)': {
    '.cm-floating-toolbar': {
      backgroundColor: 'var(--bg-primary, #1e1e1e)',
      borderColor: 'var(--border-color, #3d3d3d)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)'
    }
  }
})

/**
 * Complete floating toolbar extension
 */
export function floatingToolbarExtension() {
  return [
    floatingToolbarPlugin,
    floatingToolbarKeymap,
    floatingToolbarStyles,
  ]
}

// Export individual components for testing
export {
  TOOLBAR_BUTTONS,
  isFormatActive,
  findMarkerRange,
  getActiveToolbarButtons,
  toggleMark,
  insertLink
}
