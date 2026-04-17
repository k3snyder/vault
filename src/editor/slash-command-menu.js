/**
 * Slash Command Menu Extension for CodeMirror 6
 *
 * Provides a floating menu for quick markdown formatting when typing "/"
 * at the start of a line or after whitespace.
 *
 * Features:
 * - Floating panel positioned below cursor
 * - Fuzzy filtering as user types
 * - Keyboard navigation (arrows, enter, escape)
 * - Mouse click selection
 * - Auto-close on non-matching input
 * - Does not trigger inside code blocks or inline code
 */

import { EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { StateField, StateEffect, Prec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { keymap } from '@codemirror/view'

// Lucide SVG icons (14x14 for menu)
const ICONS = {
  h1: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>',
  h2: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
  h3: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>',
  bold: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
  italic: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
  highlight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
  list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  listOrdered: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
  task: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="m9 12 2 2 4-4"/></svg>',
  quote: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>',
  code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  divider: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
}

// Slash commands configuration
const SLASH_COMMANDS = [
  { id: 'h1', aliases: ['heading1'], label: 'Heading 1', icon: ICONS.h1, insert: '# ' },
  { id: 'h2', aliases: ['heading2'], label: 'Heading 2', icon: ICONS.h2, insert: '## ' },
  { id: 'h3', aliases: ['heading3'], label: 'Heading 3', icon: ICONS.h3, insert: '### ' },
  { id: 'bold', aliases: ['strong', 'b'], label: 'Bold', icon: ICONS.bold, insert: '****', cursorOffset: 2 },
  { id: 'italic', aliases: ['emphasis', 'em', 'i'], label: 'Italic', icon: ICONS.italic, insert: '**', cursorOffset: 1 },
  { id: 'highlight', aliases: ['mark', 'hl'], label: 'Highlight', icon: ICONS.highlight, insert: '====', cursorOffset: 2 },
  { id: 'bullet', aliases: ['list', 'ul'], label: 'Bullet List', icon: ICONS.list, insert: '- ' },
  { id: 'numbered', aliases: ['num', 'ol'], label: 'Numbered List', icon: ICONS.listOrdered, insert: '1. ' },
  { id: 'task', aliases: ['todo', 'checkbox'], label: 'Task', icon: ICONS.task, insert: '- [ ] ' },
  { id: 'quote', aliases: ['blockquote'], label: 'Quote', icon: ICONS.quote, insert: '> ' },
  { id: 'code', aliases: ['codeblock'], label: 'Code Block', icon: ICONS.code, insert: '```\n\n```', cursorOffset: 4 },
  { id: 'divider', aliases: ['hr', 'line'], label: 'Divider', icon: ICONS.divider, insert: '---\n' },
  { id: 'image', aliases: ['img', 'picture'], label: 'Image', icon: ICONS.image, insert: '![]()', cursorOffset: 2 },
  { id: 'link', aliases: ['url', 'href'], label: 'Link', icon: ICONS.link, insert: '[]()', cursorOffset: 1 },
]

// StateEffects for menu control
const openSlashMenuEffect = StateEffect.define()
const closeSlashMenuEffect = StateEffect.define()
const updateSlashMenuEffect = StateEffect.define()

// StateField to track menu state
const slashMenuState = StateField.define({
  create() {
    return {
      open: false,
      pos: 0,
      slashPos: 0,
      filter: '',
      selectedIndex: 0
    }
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(openSlashMenuEffect)) {
        return {
          open: true,
          pos: effect.value.pos,
          slashPos: effect.value.slashPos,
          filter: '',
          selectedIndex: 0
        }
      }
      if (effect.is(closeSlashMenuEffect)) {
        return {
          open: false,
          pos: 0,
          slashPos: 0,
          filter: '',
          selectedIndex: 0
        }
      }
      if (effect.is(updateSlashMenuEffect)) {
        return {
          ...value,
          ...effect.value
        }
      }
    }

    // Auto-close if cursor moves away from the slash command area
    if (value.open && tr.selection) {
      const newPos = tr.state.selection.main.head
      const lineAtSlash = tr.state.doc.lineAt(value.slashPos)
      const lineAtCursor = tr.state.doc.lineAt(newPos)

      // Close if cursor moved to different line or before slash position
      if (lineAtSlash.number !== lineAtCursor.number || newPos < value.slashPos) {
        return { open: false, pos: 0, slashPos: 0, filter: '', selectedIndex: 0 }
      }
    }

    return value
  }
})

/**
 * Check if position is inside a code block or inline code
 */
function isInsideCode(state, pos) {
  const tree = syntaxTree(state)
  let insideCode = false

  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      // Check for fenced code blocks
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        if (pos >= node.from && pos <= node.to) {
          insideCode = true
          return false
        }
      }
      // Check for inline code
      if (node.name === 'InlineCode' || node.name === 'CodeMark' || node.name === 'CodeText') {
        if (pos >= node.from && pos <= node.to) {
          insideCode = true
          return false
        }
      }
    }
  })

  // Also check manually for code fence markers
  const line = state.doc.lineAt(pos)
  const lineText = line.text.trim()
  if (lineText.startsWith('```')) {
    return true
  }

  // Check if we're between ``` markers
  const docText = state.doc.toString()
  const textBefore = docText.slice(0, pos)
  const openFences = (textBefore.match(/```/g) || []).length
  // Odd number of ``` means we're inside a code block
  if (openFences % 2 === 1) {
    return true
  }

  // Check for inline code (backticks)
  const lineTextUpToCursor = line.text.slice(0, pos - line.from)
  const backticksBefore = (lineTextUpToCursor.match(/`/g) || []).length
  if (backticksBefore % 2 === 1) {
    return true
  }

  return insideCode
}

/**
 * Check if slash is in valid position (start of line or after whitespace)
 */
function isValidSlashPosition(state, pos) {
  const line = state.doc.lineAt(pos)
  const charBeforePos = pos - 1

  // At start of line
  if (charBeforePos < line.from) {
    return true
  }

  // After whitespace
  const charBefore = state.doc.sliceString(charBeforePos, pos)
  if (/\s/.test(charBefore)) {
    return true
  }

  return false
}

/**
 * Fuzzy filter commands based on query
 */
function filterCommands(query) {
  if (!query) {
    return SLASH_COMMANDS
  }

  const q = query.toLowerCase()
  return SLASH_COMMANDS.filter(cmd =>
    cmd.id.includes(q) ||
    cmd.label.toLowerCase().includes(q) ||
    cmd.aliases.some(a => a.includes(q))
  )
}

/**
 * Calculate score for sorting filtered results
 */
function scoreCommand(cmd, query) {
  const q = query.toLowerCase()

  // Exact id match
  if (cmd.id === q) return 100

  // Id starts with query
  if (cmd.id.startsWith(q)) return 90

  // Label starts with query
  if (cmd.label.toLowerCase().startsWith(q)) return 80

  // Alias exact match
  if (cmd.aliases.includes(q)) return 75

  // Alias starts with query
  if (cmd.aliases.some(a => a.startsWith(q))) return 70

  // Id contains query
  if (cmd.id.includes(q)) return 60

  // Label contains query
  if (cmd.label.toLowerCase().includes(q)) return 50

  // Alias contains query
  if (cmd.aliases.some(a => a.includes(q))) return 40

  return 0
}

/**
 * Execute a slash command - replace the /query with the command's insert text
 */
function executeCommand(view, command, slashPos) {
  const currentPos = view.state.selection.main.head
  const insertText = command.insert

  // Replace from slash position to current cursor position
  const changes = {
    from: slashPos,
    to: currentPos,
    insert: insertText
  }

  // Calculate cursor position after insert
  let newCursorPos = slashPos + insertText.length
  if (command.cursorOffset !== undefined) {
    newCursorPos = slashPos + insertText.length - command.cursorOffset
  }

  view.dispatch({
    changes,
    selection: { anchor: newCursorPos },
    effects: closeSlashMenuEffect.of(null)
  })

  view.focus()
}

/**
 * Slash Menu Widget for rendering the floating menu
 */
class SlashMenuWidget {
  constructor(view) {
    this.view = view
    this.menu = null
    this.boundHandleClick = this.handleClick.bind(this)
    this.boundHandleMouseMove = this.handleMouseMove.bind(this)
  }

  createMenu() {
    const menu = document.createElement('div')
    menu.className = 'cm-slash-menu'
    menu.setAttribute('role', 'listbox')
    menu.setAttribute('aria-label', 'Slash commands')

    // Apply styles inline since the menu is outside CodeMirror's scoped styles
    Object.assign(menu.style, {
      position: 'fixed',
      zIndex: '10000',
      backgroundColor: 'var(--bg-primary, #ffffff)',
      border: '1px solid var(--border-color, #e9e9e7)',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
      maxHeight: '300px',
      minWidth: '200px',
      maxWidth: '280px',
      overflow: 'auto',
      padding: '4px',
      fontFamily: 'var(--font-family, Inter, -apple-system, BlinkMacSystemFont, sans-serif)',
      fontSize: '14px'
    })

    return menu
  }

  updateMenuContent(state) {
    if (!this.menu) return

    const filteredCommands = filterCommands(state.filter)
      .sort((a, b) => scoreCommand(b, state.filter) - scoreCommand(a, state.filter))

    // Clear existing content
    this.menu.innerHTML = ''

    if (filteredCommands.length === 0) {
      const emptyItem = document.createElement('div')
      emptyItem.className = 'cm-slash-menu-empty'
      Object.assign(emptyItem.style, {
        padding: '12px',
        color: 'var(--text-secondary, #6b6b6b)',
        textAlign: 'center',
        fontStyle: 'italic'
      })
      emptyItem.textContent = 'No matching commands'
      this.menu.appendChild(emptyItem)
      return
    }

    filteredCommands.forEach((cmd, index) => {
      const item = document.createElement('div')
      item.className = 'cm-slash-menu-item'
      item.setAttribute('role', 'option')
      item.setAttribute('data-command-id', cmd.id)
      item.setAttribute('data-index', String(index))

      // Apply inline styles for menu item
      Object.assign(item.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'var(--editor-text-color, #1f2937)',
        transition: 'background-color 0.1s ease',
        backgroundColor: index === state.selectedIndex
          ? 'var(--bg-selected, #e8f0fe)'
          : 'transparent'
      })

      if (index === state.selectedIndex) {
        item.classList.add('cm-slash-menu-item-selected')
        item.setAttribute('aria-selected', 'true')
      }

      // Add hover effect
      item.addEventListener('mouseenter', () => {
        if (!item.classList.contains('cm-slash-menu-item-selected')) {
          item.style.backgroundColor = 'var(--bg-hover, #f5f5f5)'
        }
      })
      item.addEventListener('mouseleave', () => {
        if (!item.classList.contains('cm-slash-menu-item-selected')) {
          item.style.backgroundColor = 'transparent'
        }
      })

      const icon = document.createElement('span')
      icon.className = 'cm-slash-menu-icon'
      Object.assign(icon.style, {
        width: '24px',
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-secondary, #f8f9fa)',
        borderRadius: '4px',
        color: 'var(--text-secondary, #6b6b6b)',
        flexShrink: '0'
      })
      icon.innerHTML = cmd.icon

      const label = document.createElement('span')
      label.className = 'cm-slash-menu-label'
      Object.assign(label.style, {
        flex: '1',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      })
      label.textContent = cmd.label

      item.appendChild(icon)
      item.appendChild(label)
      this.menu.appendChild(item)
    })
  }

  positionMenu(view, pos) {
    if (!this.menu) return

    const coords = view.coordsAtPos(pos)
    if (!coords) return

    const editorRect = view.dom.getBoundingClientRect()

    // Position below the cursor
    let top = coords.bottom + 4
    let left = coords.left

    // Ensure menu stays within viewport
    const menuHeight = 300 // max height
    const menuWidth = 240

    if (top + menuHeight > window.innerHeight) {
      // Position above cursor if not enough space below
      top = coords.top - menuHeight - 4
    }

    if (left + menuWidth > window.innerWidth) {
      left = window.innerWidth - menuWidth - 8
    }

    this.menu.style.top = `${top}px`
    this.menu.style.left = `${left}px`
  }

  showMenu(view, state) {
    console.log('[SlashCommand] showMenu called, state:', state)

    if (this.menu) {
      this.hideMenu()
    }

    this.menu = this.createMenu()
    console.log('[SlashCommand] Menu created:', this.menu)

    this.updateMenuContent(state)

    // Add event listeners
    this.menu.addEventListener('click', this.boundHandleClick)
    this.menu.addEventListener('mousemove', this.boundHandleMouseMove)

    document.body.appendChild(this.menu)
    console.log('[SlashCommand] Menu appended to body')

    // Defer positioning to after the update cycle completes
    // (coordsAtPos cannot be called during an update)
    setTimeout(() => {
      if (this.menu) {
        this.positionMenu(view, state.slashPos)
        console.log('[SlashCommand] Menu positioned, style:', this.menu.style.cssText)
      }
    }, 0)
  }

  hideMenu() {
    if (this.menu) {
      this.menu.removeEventListener('click', this.boundHandleClick)
      this.menu.removeEventListener('mousemove', this.boundHandleMouseMove)
      this.menu.remove()
      this.menu = null
    }
  }

  handleClick(e) {
    const item = e.target.closest('.cm-slash-menu-item')
    if (!item) return

    const commandId = item.getAttribute('data-command-id')
    const command = SLASH_COMMANDS.find(c => c.id === commandId)

    if (command) {
      const state = this.view.state.field(slashMenuState)
      executeCommand(this.view, command, state.slashPos)
    }
  }

  handleMouseMove(e) {
    const item = e.target.closest('.cm-slash-menu-item')
    if (!item) return

    const index = parseInt(item.getAttribute('data-index'), 10)
    const state = this.view.state.field(slashMenuState)

    if (index !== state.selectedIndex) {
      this.view.dispatch({
        effects: updateSlashMenuEffect.of({ selectedIndex: index })
      })
    }
  }

  updateMenu(view, state) {
    if (!this.menu) return

    this.updateMenuContent(state)

    // Defer positioning to after the update cycle completes
    setTimeout(() => {
      if (this.menu) {
        this.positionMenu(view, state.slashPos)
      }
    }, 0)
  }
}

/**
 * ViewPlugin to manage the slash menu UI
 */
const slashMenuPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view
      this.menuWidget = new SlashMenuWidget(view)
      console.log('[SlashCommand] ViewPlugin initialized')
    }

    update(update) {
      const state = update.view.state.field(slashMenuState)
      const prevState = update.startState.field(slashMenuState)

      console.log('[SlashCommand] ViewPlugin update, state.open:', state.open, 'prevState.open:', prevState.open)

      if (state.open && !prevState.open) {
        // Menu just opened
        console.log('[SlashCommand] Menu opening...')
        this.menuWidget.showMenu(update.view, state)
      } else if (!state.open && prevState.open) {
        // Menu just closed
        console.log('[SlashCommand] Menu closing...')
        this.menuWidget.hideMenu()
      } else if (state.open) {
        // Menu is open and needs update
        if (state.filter !== prevState.filter ||
            state.selectedIndex !== prevState.selectedIndex ||
            state.slashPos !== prevState.slashPos) {
          this.menuWidget.updateMenu(update.view, state)
        }
      }
    }

    destroy() {
      this.menuWidget.hideMenu()
    }
  }
)

/**
 * Input handler to detect "/" and trigger menu
 */
const slashInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  console.log('[SlashCommand] Input handler called, text:', text, 'from:', from, 'to:', to)

  // Check if typing "/"
  if (text !== '/') {
    return false
  }

  console.log('[SlashCommand] Detected "/" input')

  const state = view.state.field(slashMenuState)

  // If menu is already open, let it handle the input normally
  if (state.open) {
    console.log('[SlashCommand] Menu already open, skipping')
    return false
  }

  // Check if in valid position (start of line or after whitespace)
  const validPos = isValidSlashPosition(view.state, from)
  console.log('[SlashCommand] Valid position check:', validPos)
  if (!validPos) {
    return false
  }

  // Check if inside code block or inline code
  const insideCode = isInsideCode(view.state, from)
  console.log('[SlashCommand] Inside code check:', insideCode)
  if (insideCode) {
    return false
  }

  console.log('[SlashCommand] Opening menu at pos:', from)

  // Insert the "/" and open the menu
  view.dispatch({
    changes: { from, to, insert: '/' },
    selection: { anchor: from + 1 },
    effects: openSlashMenuEffect.of({ pos: from + 1, slashPos: from })
  })

  return true
})

/**
 * Update handler to track filter text as user types
 */
const slashUpdateHandler = EditorView.updateListener.of((update) => {
  const state = update.state.field(slashMenuState)

  if (!state.open) return

  // Check if document changed
  if (update.docChanged) {
    const currentPos = update.state.selection.main.head
    const slashPos = state.slashPos

    // Get text between slash and cursor
    const filterText = update.state.doc.sliceString(slashPos + 1, currentPos)

    // Check if filter contains invalid characters (space, newline)
    if (/[\s\n]/.test(filterText)) {
      update.view.dispatch({
        effects: closeSlashMenuEffect.of(null)
      })
      return
    }

    // Check if there are any matching commands
    const filteredCommands = filterCommands(filterText)
    if (filteredCommands.length === 0 && filterText.length > 0) {
      // No matches, close menu
      update.view.dispatch({
        effects: closeSlashMenuEffect.of(null)
      })
      return
    }

    // Update filter if changed
    if (filterText !== state.filter) {
      // Reset selected index when filter changes
      const newSelectedIndex = 0
      update.view.dispatch({
        effects: updateSlashMenuEffect.of({
          filter: filterText,
          selectedIndex: newSelectedIndex
        })
      })
    }
  }
})

/**
 * Move selection up in the menu
 */
function moveSelectionUp(view) {
  const state = view.state.field(slashMenuState)
  if (!state.open) return false

  const filteredCommands = filterCommands(state.filter)
  if (filteredCommands.length === 0) return true

  const newIndex = state.selectedIndex <= 0
    ? filteredCommands.length - 1
    : state.selectedIndex - 1

  view.dispatch({
    effects: updateSlashMenuEffect.of({ selectedIndex: newIndex })
  })

  return true
}

/**
 * Move selection down in the menu
 */
function moveSelectionDown(view) {
  const state = view.state.field(slashMenuState)
  if (!state.open) return false

  const filteredCommands = filterCommands(state.filter)
  if (filteredCommands.length === 0) return true

  const newIndex = state.selectedIndex >= filteredCommands.length - 1
    ? 0
    : state.selectedIndex + 1

  view.dispatch({
    effects: updateSlashMenuEffect.of({ selectedIndex: newIndex })
  })

  return true
}

/**
 * Execute the currently selected command
 */
function executeSelectedCommand(view) {
  const state = view.state.field(slashMenuState)
  if (!state.open) return false

  const filteredCommands = filterCommands(state.filter)
    .sort((a, b) => scoreCommand(b, state.filter) - scoreCommand(a, state.filter))

  if (filteredCommands.length === 0) return true

  const selectedCommand = filteredCommands[state.selectedIndex]
  if (selectedCommand) {
    executeCommand(view, selectedCommand, state.slashPos)
  }

  return true
}

/**
 * Close the slash menu
 */
function closeMenu(view) {
  const state = view.state.field(slashMenuState)
  if (!state.open) return false

  view.dispatch({
    effects: closeSlashMenuEffect.of(null)
  })

  return true
}

/**
 * Keymap for menu navigation
 * Use Prec.highest to ensure these keybindings take priority over
 * CodeMirror's default keymaps when the slash menu is open
 */
const slashMenuKeymap = Prec.highest(keymap.of([
  { key: 'ArrowUp', run: moveSelectionUp },
  { key: 'ArrowDown', run: moveSelectionDown },
  { key: 'Enter', run: executeSelectedCommand },
  { key: 'Tab', run: executeSelectedCommand },
  { key: 'Escape', run: closeMenu },
]))

/**
 * Styles for the slash menu
 */
const slashMenuStyles = EditorView.theme({
  '.cm-slash-menu': {
    position: 'fixed',
    zIndex: '1000',
    backgroundColor: 'var(--bg-primary, #ffffff)',
    border: '1px solid var(--border-color, #e9e9e7)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    maxHeight: '300px',
    minWidth: '200px',
    maxWidth: '280px',
    overflow: 'auto',
    padding: '4px',
    fontFamily: 'var(--font-family, Inter, -apple-system, BlinkMacSystemFont, sans-serif)',
    fontSize: '14px'
  },

  '.cm-slash-menu-item': {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    color: 'var(--editor-text-color, #1f2937)',
    transition: 'background-color 0.1s ease'
  },

  '.cm-slash-menu-item:hover': {
    backgroundColor: 'var(--bg-hover, #f5f5f5)'
  },

  '.cm-slash-menu-item-selected': {
    backgroundColor: 'var(--bg-selected, #e8f0fe) !important'
  },

  '.cm-slash-menu-icon': {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--bg-secondary, #f8f9fa)',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary, #6b6b6b)',
    flexShrink: '0'
  },

  '.cm-slash-menu-label': {
    flex: '1',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  '.cm-slash-menu-empty': {
    padding: '12px',
    color: 'var(--text-secondary, #6b6b6b)',
    textAlign: 'center',
    fontStyle: 'italic'
  }
})

/**
 * Complete slash command extension
 */
export function slashCommandExtension() {
  return [
    slashMenuState,
    slashMenuPlugin,
    slashInputHandler,
    slashUpdateHandler,
    slashMenuKeymap,
    slashMenuStyles,
  ]
}

// Export individual components for testing
export {
  SLASH_COMMANDS,
  slashMenuState,
  filterCommands,
  isInsideCode,
  isValidSlashPosition
}
