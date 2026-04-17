import { syntaxTree } from '@codemirror/language'
import { Prec, RangeSetBuilder, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value = '') {
  return escapeHtml(value)
}

// Table widget for rendering markdown tables as HTML tables
class TableWidget extends WidgetType {
  constructor(tableRows) {
    super()
    this.tableRows = tableRows
  }

  // Allow mouse events to pass through for text selection within the table
  ignoreEvent(event) {
    const selectionEvents = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'selectstart']
    return selectionEvents.includes(event.type)
  }

  toDOM() {
    const table = document.createElement('table')
    table.className = 'cm-table-formatted'

    // Make table focusable to preserve text selection
    table.setAttribute('tabindex', '-1')

    // Prevent CodeMirror from stealing focus on mouse events
    // This preserves native text selection within the table
    table.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      // Focus the table so it can receive keyboard events (for copy)
      table.focus()
    })
    table.addEventListener('mouseup', (e) => {
      e.stopPropagation()
    })
    table.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    // Handle copy event to copy native selection to clipboard
    table.addEventListener('copy', (e) => {
      const selection = window.getSelection()
      if (selection && selection.toString()) {
        e.preventDefault()
        e.clipboardData.setData('text/plain', selection.toString())
      }
    })

    // Handle keydown for Cmd+C / Ctrl+C
    table.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const selection = window.getSelection()
        if (selection && selection.toString()) {
          e.preventDefault()
          e.stopPropagation()
          navigator.clipboard.writeText(selection.toString())
        }
      }
    })

    // Parse table structure
    const headerRow = this.tableRows[0]
    const separatorRow = this.tableRows[1]
    const dataRows = this.tableRows.slice(2)

    // Parse header
    const headerCells = this.parseTableRow(headerRow)

    // Parse alignment from separator row
    const alignments = this.parseTableAlignment(separatorRow)

    // Create header
    const thead = document.createElement('thead')
    const headerTr = document.createElement('tr')

    // Ensure we have at least as many header cells as alignment columns
    const maxColumns = Math.max(headerCells.length, alignments.length)

    for (let i = 0; i < maxColumns; i++) {
      const th = document.createElement('th')
      const cellContent = headerCells[i] || ''
      th.innerHTML = this.parseInlineFormatting(cellContent.trim()) || '&nbsp;'
      if (alignments[i]) {
        th.style.textAlign = alignments[i]
      }
      headerTr.appendChild(th)
    }
    thead.appendChild(headerTr)
    table.appendChild(thead)

    // Create body
    if (dataRows.length > 0) {
      const tbody = document.createElement('tbody')
      dataRows.forEach(row => {
        const cells = this.parseTableRow(row)
        const tr = document.createElement('tr')

        // Ensure we have at least as many cells as columns
        for (let i = 0; i < maxColumns; i++) {
          const td = document.createElement('td')
          const cellContent = cells[i] || ''
          td.innerHTML = this.parseInlineFormatting(cellContent.trim()) || '&nbsp;'
          if (alignments[i]) {
            td.style.textAlign = alignments[i]
          }
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      })
      table.appendChild(tbody)
    }

    return table
  }
  
  parseTableRow(row) {
    // Split by | but handle escaped pipes
    const cells = []
    let currentCell = ''
    let escaped = false
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i]
      
      if (char === '\\' && !escaped) {
        escaped = true
        continue
      }
      
      if (char === '|' && !escaped) {
        cells.push(currentCell)
        currentCell = ''
      } else {
        currentCell += char
      }
      
      escaped = false
    }
    
    cells.push(currentCell)
    
    // Remove first and last empty cells (from leading/trailing |)
    if (cells.length > 0 && cells[0].trim() === '') {
      cells.shift()
    }
    if (cells.length > 0 && cells[cells.length - 1].trim() === '') {
      cells.pop()
    }
    
    return cells
  }
  
  parseTableAlignment(separatorRow) {
    const cells = this.parseTableRow(separatorRow)
    return cells.map(cell => {
      const trimmed = cell.trim()
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
        return 'center'
      } else if (trimmed.endsWith(':')) {
        return 'right'
      } else {
        return 'left'
      }
    })
  }
  
  parseInlineFormatting(text) {
    const escaped = escapeHtml(text)

    return escaped
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => (
        `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      ))
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/==([^=\n]+)==/g, '<mark class="cm-table-highlight">$1</mark>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<u>$1</u>')
  }

  eq(other) {
    return other.tableRows && 
           this.tableRows.length === other.tableRows.length &&
           this.tableRows.every((row, i) => row === other.tableRows[i])
  }
}

// Enhanced code block widget with syntax highlighting
class CodeBlockWidget extends WidgetType {
  constructor(content, language = '') {
    super()
    this.content = content
    this.language = language
  }

  // Tell CodeMirror to ignore selection-related events so they pass through
  // to native browser handling, enabling text selection within the widget.
  // Returning true = "yes, ignore this event" = let browser handle it
  ignoreEvent(event) {
    const selectionEvents = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'selectstart']
    return selectionEvents.includes(event.type)
  }

  toDOM() {
    const pre = document.createElement('pre')
    pre.className = 'cm-code-block-formatted'
    pre.setAttribute('tabindex', '-1')

    // Add inline styles as fallback for user selection
    pre.style.userSelect = 'text'
    pre.style.webkitUserSelect = 'text'

    const preserveNativeSelection = (e) => {
      if (e.target.closest?.('.cm-code-copy-btn')) {
        return
      }

      e.stopPropagation()
    }

    // Prevent pane/editor click handlers from reclaiming focus during text selection.
    pre.addEventListener('mousedown', (e) => {
      preserveNativeSelection(e)
      pre.focus()
    })
    pre.addEventListener('mouseup', preserveNativeSelection)
    pre.addEventListener('click', preserveNativeSelection)

    // Preserve native copy behavior for partial code selections inside the widget.
    pre.addEventListener('copy', (e) => {
      const selection = window.getSelection()
      if (selection && selection.toString()) {
        e.preventDefault()
        e.clipboardData.setData('text/plain', selection.toString())
      }
    })

    pre.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const selection = window.getSelection()
        if (selection && selection.toString()) {
          e.preventDefault()
          e.stopPropagation()
          navigator.clipboard.writeText(selection.toString())
        }
      }
    })

    // Add copy button
    const copyBtn = document.createElement('button')
    copyBtn.className = 'cm-code-copy-btn'
    copyBtn.textContent = 'Copy'
    copyBtn.setAttribute('aria-label', 'Copy code to clipboard')
    copyBtn.setAttribute('type', 'button')

    // Event handler for copy action
    copyBtn.onclick = (e) => {
      e.stopPropagation()
      e.preventDefault()

      navigator.clipboard.writeText(this.content).then(() => {
        copyBtn.textContent = 'Copied!'
        copyBtn.setAttribute('aria-label', 'Code copied to clipboard')
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
          copyBtn.setAttribute('aria-label', 'Copy code to clipboard')
        }, 2000)
      }).catch(err => {
        console.error('Failed to copy code:', err)
        copyBtn.textContent = 'Failed'
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
        }, 2000)
      })
    }

    pre.appendChild(copyBtn)

    const code = document.createElement('code')
    code.className = 'cm-code-content'
    // Add inline styles for text selection as fallback
    code.style.userSelect = 'text'
    code.style.webkitUserSelect = 'text'
    code.style.cursor = 'text'

    // Add language label if specified
    if (this.language) {
      const langLabel = document.createElement('div')
      langLabel.className = 'cm-code-language-label'
      langLabel.textContent = this.language
      pre.appendChild(langLabel)
    }

    // Apply basic syntax highlighting if language is specified
    if (this.language) {
      try {
        const highlightedContent = this.applyBasicSyntaxHighlighting(this.content, this.language)
        code.innerHTML = highlightedContent
      } catch (error) {
        console.warn('Failed to apply syntax highlighting:', error)
        code.textContent = this.content
      }
    } else {
      code.textContent = this.content
    }

    pre.appendChild(code)
    return pre
  }
  
  applyBasicSyntaxHighlighting(content, language) {
    // Simple regex-based syntax highlighting for common languages
    let highlightedContent = this.escapeHtml(content)
    
    // Apply language-specific highlighting
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'js':
        highlightedContent = this.highlightJavaScript(highlightedContent)
        break
      case 'python':
      case 'py':
        highlightedContent = this.highlightPython(highlightedContent)
        break
      case 'html':
        highlightedContent = this.highlightHTML(highlightedContent)
        break
      case 'css':
        highlightedContent = this.highlightCSS(highlightedContent)
        break
      case 'json':
        highlightedContent = this.highlightJSON(highlightedContent)
        break
      default:
        // Basic highlighting for any language
        highlightedContent = this.highlightGeneric(highlightedContent)
    }
    
    return highlightedContent
  }
  
  highlightJavaScript(content) {
    // Keywords
    content = content.replace(/\b(const|let|var|function|if|else|for|while|return|class|extends|import|export|async|await|try|catch|finally|throw|new|this|super|static|get|set|true|false|null|undefined)\b/g, '<span class="cm-keyword">$1</span>')
    
    // Strings
    content = content.replace(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="cm-string">$1$2$1</span>')
    
    // Comments
    content = content.replace(/\/\/.*$/gm, '<span class="cm-comment">$&</span>')
    content = content.replace(/\/\*[\s\S]*?\*\//g, '<span class="cm-comment">$&</span>')
    
    // Numbers
    content = content.replace(/\b\d+(\.\d+)?\b/g, '<span class="cm-number">$&</span>')
    
    return content
  }
  
  highlightPython(content) {
    // Keywords
    content = content.replace(/\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|raise|with|pass|break|continue|lambda|yield|global|nonlocal|assert|del|True|False|None|and|or|not|is|in)\b/g, '<span class="cm-keyword">$1</span>')
    
    // Strings
    content = content.replace(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="cm-string">$1$2$1</span>')
    
    // Comments
    content = content.replace(/#.*$/gm, '<span class="cm-comment">$&</span>')
    
    // Numbers
    content = content.replace(/\b\d+(\.\d+)?\b/g, '<span class="cm-number">$&</span>')
    
    return content
  }
  
  highlightHTML(content) {
    // HTML tags
    content = content.replace(/&lt;(\/?[a-zA-Z][^&gt;]*)&gt;/g, '<span class="cm-keyword">&lt;$1&gt;</span>')
    
    // Attributes
    content = content.replace(/(\w+)=(['"])(.*?)\2/g, '<span class="cm-variable">$1</span>=<span class="cm-string">$2$3$2</span>')
    
    return content
  }
  
  highlightCSS(content) {
    // Selectors
    content = content.replace(/^([^{]+){/gm, '<span class="cm-keyword">$1</span>{')
    
    // Properties
    content = content.replace(/(\w+):\s*([^;]+);/g, '<span class="cm-variable">$1</span>: <span class="cm-string">$2</span>;')
    
    return content
  }
  
  highlightJSON(content) {
    // Keys
    content = content.replace(/"([^"]+)":/g, '<span class="cm-variable">"$1"</span>:')
    
    // String values
    content = content.replace(/:\s*"([^"]+)"/g, ': <span class="cm-string">"$1"</span>')
    
    // Numbers
    content = content.replace(/:\s*(\d+(\.\d+)?)/g, ': <span class="cm-number">$1</span>')
    
    // Booleans and null
    content = content.replace(/:\s*(true|false|null)\b/g, ': <span class="cm-keyword">$1</span>')
    
    return content
  }
  
  highlightGeneric(content) {
    // Basic highlighting for any language
    
    // Strings (single and double quotes)
    content = content.replace(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="cm-string">$1$2$1</span>')
    
    // Line comments (// and #)
    content = content.replace(/\/\/.*$/gm, '<span class="cm-comment">$&</span>')
    content = content.replace(/#.*$/gm, '<span class="cm-comment">$&</span>')
    
    // Block comments (/* */)
    content = content.replace(/\/\*[\s\S]*?\*\//g, '<span class="cm-comment">$&</span>')
    
    // Numbers
    content = content.replace(/\b\d+(\.\d+)?\b/g, '<span class="cm-number">$&</span>')
    
    return content
  }
  
  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  eq(other) {
    return other.content === this.content && other.language === this.language
  }
}

/**
 * StateField for block widgets (tables, code blocks) - follows CodeMirror 6 best practices
 * Block widgets should be in StateField, not ViewPlugin
 */
const blockWidgetField = StateField.define({
  create: (state) => computeBlockDecorations(state),
  update(decorations, tr) {
    decorations = decorations.map(tr.changes)
    
    // Block widgets are selection-agnostic in current WYSIWYG mode.
    // Avoid rebuilding them on cursor moves so native widget selections survive.
    if (tr.docChanged) {
      return computeBlockDecorations(tr.state)
    }
    
    return decorations
  },
  provide: f => EditorView.decorations.from(f)
})

function computeBlockDecorations(state) {
  const builder = new RangeSetBuilder()
  const { doc } = state
  
  // Process all lines for block widgets
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    
    // Check if this line starts a table
    const tableResult = processTableForStateField(doc, builder, line)
    if (tableResult) {
      i = tableResult.skipToLine
      continue
    }
    
    // Check if this line starts a code block
    const codeBlockResult = processCodeBlockForStateField(doc, builder, line)
    if (codeBlockResult) {
      i = codeBlockResult.skipToLine
      continue
    }
  }
  
  return builder.finish()
}

function processTableForStateField(doc, builder, line) {
  const text = line.text.trim()
  
  // Check if this line looks like a table row (starts with |)
  if (!text.startsWith('|')) {
    return null
  }
  
  // Collect table lines
  let currentLine = line
  const tableLines = []
  let lastLineNumber = line.number
  
  while (currentLine.number <= doc.lines) {
    const currentText = currentLine.text.trim()

    // True WYSIWYG mode: always render table widget, even when cursor is inside
    // Users edit tables via table editing UI or by toggling WYSIWYG mode off

    if (currentText.startsWith('|')) {
      tableLines.push(currentText)
      lastLineNumber = currentLine.number
      
      if (currentLine.number < doc.lines) {
        currentLine = doc.line(currentLine.number + 1)
      } else {
        break
      }
    } else {
      break
    }
  }
  
  // Need at least header + separator for a valid table
  if (tableLines.length < 2) {
    return null
  }
  
  // Check if second line is a separator
  const separatorLine = tableLines[1]
  if (!/^[\|\-\:\s]+$/.test(separatorLine)) {
    return null
  }
  
  // Replace the entire table with a single widget
  const startLine = doc.line(line.number)
  const endLine = doc.line(lastLineNumber)
  
  builder.add(
    startLine.from,
    endLine.to,
    Decoration.replace({
      widget: new TableWidget(tableLines),
      block: true
    })
  )
  
  return { skipToLine: lastLineNumber }
}

function processCodeBlockForStateField(doc, builder, line) {
  const text = line.text.trim()
  
  // Check if this line starts a code block
  const codeBlockMatch = text.match(/^```(\w+)?$/)
  if (!codeBlockMatch) {
    return null
  }
  
  const language = codeBlockMatch[1] || ''
  let currentLine = line
  let codeContent = ''
  let lastLineNumber = line.number
  
  // Skip the opening ``` line
  if (currentLine.number < doc.lines) {
    currentLine = doc.line(currentLine.number + 1)
  }
  
  // Collect all code content lines until closing ```
  while (currentLine.number <= doc.lines) {
    const currentText = currentLine.text.trim()

    // True WYSIWYG mode: always render code block widget, even when cursor is inside
    // Users can still select and copy code from within the rendered widget

    // Check for closing ```
    if (currentText === '```') {
      lastLineNumber = currentLine.number
      break
    }
    
    // Add content line
    codeContent += currentLine.text + '\n'
    
    if (currentLine.number < doc.lines) {
      currentLine = doc.line(currentLine.number + 1)
    } else {
      break
    }
  }
  
  // Remove trailing newline
  codeContent = codeContent.slice(0, -1)
  
  // Replace the entire code block with a single widget
  const startLine = doc.line(line.number)
  const endLine = doc.line(lastLineNumber)
  
  builder.add(
    startLine.from,
    endLine.to,
    Decoration.replace({
      widget: new CodeBlockWidget(codeContent, language),
      block: true
    })
  )
  
  return { skipToLine: lastLineNumber }
}

/**
 * Proper markdown formatting extension that hides markers when not active
 * Uses CodeMirror 6 best practices: Decoration.replace() for hiding content
 * and Decoration.mark() for applying formatting styles
 *
 * Now includes headings alongside bold, italic, and underline formatting
 * Block widgets moved to separate StateField
 *
 * Implements EditorView.atomicRanges so cursor movement skips hidden syntax.
 * Only the Decoration.replace() decorations (hidden markers) are atomic.
 * The Decoration.mark() decorations (styling) are NOT atomic.
 */
// Use Prec.highest() to ensure our replace decorations take priority
// over syntax highlighting decorations from the markdown language extension
export const inlineFormattingExtension = Prec.highest(ViewPlugin.fromClass(
  class {
    constructor(view) {
      const result = this.computeDecorations(view)
      this.decorations = result.decorations
      this.atomicDecorations = result.atomicDecorations
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        const result = this.computeDecorations(update.view)
        this.decorations = result.decorations
        this.atomicDecorations = result.atomicDecorations
      }
    }

    computeDecorations(view) {
      const { doc, selection } = view.state

      // Get cursor position for active line detection
      const cursor = selection.main.head
      const activeLine = doc.lineAt(cursor)

      // Collect all decorations first, tracking which are atomic (replace) vs styling (mark)
      const allDecorations = []
      const atomicDecorations = [] // Only Decoration.replace() decorations

      // Process each line in visible ranges (now only for inline formatting)
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = doc.lineAt(pos)
          const isLineActive = cursor >= line.from && cursor <= line.to

          // Process all formatting for this line (inline only - blocks handled by StateField)
          this.processLineFormatting(view, allDecorations, atomicDecorations, line, isLineActive)

          pos = line.to + 1
        }

        // Process multi-line highlights that span across lines
        this.processMultiLineHighlights(allDecorations, atomicDecorations, doc, from, to)
      }

      // Sort all decorations by position
      allDecorations.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from
        if (a.to !== b.to) return a.to - b.to
        return 0
      })

      // Sort atomic decorations by position
      atomicDecorations.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from
        if (a.to !== b.to) return a.to - b.to
        return 0
      })

      // Add sorted decorations to builder
      const builder = new RangeSetBuilder()
      for (const decoration of allDecorations) {
        builder.add(decoration.from, decoration.to, decoration.decoration)
      }

      // Build atomic decorations set (only the hidden ranges)
      const atomicBuilder = new RangeSetBuilder()
      for (const decoration of atomicDecorations) {
        atomicBuilder.add(decoration.from, decoration.to, decoration.decoration)
      }

      return {
        decorations: builder.finish(),
        atomicDecorations: atomicBuilder.finish()
      }
    }


    processLineFormatting(view, decorations, atomicDecorations, line, isLineActive) {
      const text = line.text
      const lineStart = line.from

      // Skip empty lines
      if (!text.trim()) return

      // True WYSIWYG mode: always hide markdown syntax, even on active line
      // Users format text using the '/' slash command menu or floating toolbar

      // Process heading formatting first (higher priority)
      const headingInfo = this.processHeadingFormatting(decorations, atomicDecorations, text, lineStart)
      if (headingInfo) {
        // Headings can still contain inline markdown like **bold** or ==highlight==.
        // Process only the heading content segment so the leading # markers stay hidden
        // while the inline markers inside the heading are also formatted.
        this.processInlineFormatting(
          decorations,
          atomicDecorations,
          headingInfo.content,
          headingInfo.contentStart
        )
        return
      }

      // Process blockquote formatting (also higher priority)
      const isBlockquote = this.processBlockquoteFormatting(decorations, atomicDecorations, text, lineStart)

      // Process inline formatting: bold, italic, underline
      // Note: We process inline formatting even for blockquotes to handle **bold** and *italic* inside quotes
      this.processInlineFormatting(decorations, atomicDecorations, text, lineStart)
    }

    processHeadingFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match headings: # ## ### etc.
      const headingMatch = text.match(/^(\s*)(#{1,6})\s+(.+)$/)
      if (!headingMatch) {
        return null
      }

      const indent = headingMatch[1] // Any leading whitespace
      const hashSymbols = headingMatch[2] // # ## ### etc.
      const content = headingMatch[3] // The actual heading text
      const level = hashSymbols.length

      const indentStart = lineStart
      const hashStart = lineStart + indent.length
      const hashEnd = hashStart + hashSymbols.length
      const contentStart = text.indexOf(content, hashEnd - lineStart) + lineStart

      // Hide the hash symbols and the space after them
      const replaceDecoration = Decoration.replace({})
      decorations.push({
        from: hashStart,
        to: contentStart,
        decoration: replaceDecoration
      })
      // Add to atomic decorations so cursor skips over hidden syntax
      atomicDecorations.push({
        from: hashStart,
        to: contentStart,
        decoration: replaceDecoration
      })

      // Apply heading styling to the content (NOT atomic - cursor should move through text)
      decorations.push({
        from: contentStart,
        to: lineStart + text.length,
        decoration: Decoration.mark({
          class: `cm-heading-formatted cm-heading-${level}-formatted`
        })
      })

      return {
        content,
        contentStart
      }
    }

    processBlockquoteFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match blockquotes: > text or >text
      const blockquoteMatch = text.match(/^(\s*)(>)(\s*)(.*)$/)
      if (!blockquoteMatch) return false


      const indent = blockquoteMatch[1] // Any leading whitespace
      const marker = blockquoteMatch[2] // The > symbol
      const spacesAfterMarker = blockquoteMatch[3] // Any spaces after >
      const content = blockquoteMatch[4] // The actual blockquote text

      const markerStart = lineStart + indent.length
      const markerEnd = markerStart + marker.length
      const spacesEnd = markerEnd + spacesAfterMarker.length
      const contentStart = spacesEnd

      // For empty blockquote lines (just > with no content), hide the entire line
      if (content.trim().length === 0) {
        const replaceDecoration = Decoration.replace({})
        decorations.push({
          from: markerStart,
          to: lineStart + text.length,
          decoration: replaceDecoration
        })
        atomicDecorations.push({
          from: markerStart,
          to: lineStart + text.length,
          decoration: replaceDecoration
        })
      } else {
        // Hide the > marker and any spaces after it
        const replaceDecoration = Decoration.replace({})
        decorations.push({
          from: markerStart,
          to: contentStart,
          decoration: replaceDecoration
        })
        atomicDecorations.push({
          from: markerStart,
          to: contentStart,
          decoration: replaceDecoration
        })

        // Apply blockquote styling to the content (NOT atomic)
        decorations.push({
          from: contentStart,
          to: lineStart + text.length,
          decoration: Decoration.mark({
            class: 'cm-blockquote-formatted'
          })
        })
      }

      return true // Indicates this line was processed as a blockquote
    }

    processInlineFormatting(decorations, atomicDecorations, text, lineStart) {
      // Collect all decorations first, then sort them before adding to builder
      const inlineDecorations = []
      const inlineAtomicDecorations = []

      // For blockquotes, we need to process inline formatting only in the content portion
      // Check if this is a blockquote and adjust the text accordingly
      const blockquoteMatch = text.match(/^(\s*)(>)(\s*)(.*)$/)
      let processingText = text
      let processingOffset = 0

      if (blockquoteMatch) {
        // For blockquotes, only process the content part (after the > marker)
        const indent = blockquoteMatch[1]
        const marker = blockquoteMatch[2]
        const spacesAfterMarker = blockquoteMatch[3]
        const content = blockquoteMatch[4]

        processingText = content
        processingOffset = indent.length + marker.length + spacesAfterMarker.length
      }

      // Process bold and italic formatting: ***text*** (highest priority)
      this.processBoldItalicFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Process bold formatting: **text**
      this.processBoldFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Process italic formatting: *text* (but not **text**)
      this.processItalicFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Process underline formatting: _text_
      this.processUnderlineFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Process highlight formatting: ==text==
      this.processHighlightFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Process strikethrough formatting: ~~text~~
      this.processStrikethroughFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Process WikiLink formatting: [[text]]
      this.processWikiLinkFormatting(inlineDecorations, inlineAtomicDecorations, processingText, lineStart + processingOffset)

      // Sort inline decorations by start position to ensure proper order
      inlineDecorations.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from
        if (a.to !== b.to) return a.to - b.to
        return 0
      })

      // Add sorted decorations to the main decorations array
      for (const decoration of inlineDecorations) {
        decorations.push(decoration)
      }

      // Add sorted atomic decorations to the main atomic array
      for (const decoration of inlineAtomicDecorations) {
        atomicDecorations.push(decoration)
      }
    }

    processBoldItalicFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match ***text*** for bold and italic combined
      const boldItalicRegex = /\*\*\*([^*]+)\*\*\*/g
      let match

      while ((match = boldItalicRegex.exec(text)) !== null) {
        const fullMatch = match[0]
        const content = match[1]
        const startPos = lineStart + match.index
        const endPos = startPos + fullMatch.length

        // Hide the opening ***
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 3,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 3,
          decoration: openReplace
        })

        // Apply both bold and italic styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 3,
          to: endPos - 3,
          decoration: Decoration.mark({ class: 'cm-strong-formatted cm-emphasis-formatted' })
        })

        // Hide the closing ***
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 3,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 3,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    processBoldFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match **text** but avoid ***text*** (which is handled by bold+italic)
      const boldRegex = /\*\*([^*]+)\*\*/g
      let match

      while ((match = boldRegex.exec(text)) !== null) {
        const fullMatch = match[0]
        const content = match[1]
        const startIndex = match.index
        const endIndex = startIndex + fullMatch.length

        // Check if this is actually part of bold+italic formatting (***text***)
        const beforeChar = startIndex > 0 ? text[startIndex - 1] : ''
        const afterChar = endIndex < text.length ? text[endIndex] : ''

        // Skip if this is part of bold+italic formatting
        if (beforeChar === '*' || afterChar === '*') {
          continue
        }

        const startPos = lineStart + startIndex
        const endPos = lineStart + endIndex

        // Hide the opening **
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })

        // Apply bold styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 2,
          to: endPos - 2,
          decoration: Decoration.mark({ class: 'cm-strong-formatted' })
        })

        // Hide the closing **
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    processItalicFormatting(decorations, atomicDecorations, text, lineStart) {
      // Use a simpler, more reliable regex for italic formatting
      // This will match *text* but we'll manually check to avoid **bold** and ***bold+italic*** conflicts
      const italicRegex = /\*([^*]+)\*/g
      let match

      while ((match = italicRegex.exec(text)) !== null) {
        const fullMatch = match[0] // *text*
        const content = match[1] // text
        const startIndex = match.index
        const endIndex = startIndex + fullMatch.length

        // Check if this is actually part of bold (**text**) or bold+italic (***text***) formatting
        const beforeChar = startIndex > 0 ? text[startIndex - 1] : ''
        const afterChar = endIndex < text.length ? text[endIndex] : ''
        const beforeChar2 = startIndex > 1 ? text[startIndex - 2] : ''
        const afterChar2 = endIndex < text.length - 1 ? text[endIndex + 1] : ''

        // Skip if this is part of bold formatting (**text**) or bold+italic (***text***)
        if (beforeChar === '*' || afterChar === '*' ||
            (beforeChar2 === '*' && beforeChar === '*') ||
            (afterChar === '*' && afterChar2 === '*')) {
          continue
        }

        const startPos = lineStart + startIndex
        const endPos = lineStart + endIndex

        // Hide the opening *
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 1,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 1,
          decoration: openReplace
        })

        // Apply italic styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 1,
          to: endPos - 1,
          decoration: Decoration.mark({ class: 'cm-emphasis-formatted' })
        })

        // Hide the closing *
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 1,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 1,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    processUnderlineFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match _text_ - we treat underscores as underline, not italic
      const underlineRegex = /_([^_]+)_/g
      let match

      while ((match = underlineRegex.exec(text)) !== null) {
        const startIndex = match.index
        const endIndex = startIndex + match[0].length

        // Skip if this is part of double underscore formatting (__text__)
        const beforeChar = startIndex > 0 ? text[startIndex - 1] : ''
        const afterChar = endIndex < text.length ? text[endIndex] : ''

        if (beforeChar === '_' || afterChar === '_') {
          continue // Skip this match as it's part of double underscore formatting
        }

        const content = match[1]
        const startPos = lineStart + startIndex
        const endPos = startPos + match[0].length

        // Hide the opening _
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 1,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 1,
          decoration: openReplace
        })

        // Apply underline styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 1,
          to: endPos - 1,
          decoration: Decoration.mark({ class: 'cm-underline-formatted' })
        })

        // Hide the closing _
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 1,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 1,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    processHighlightFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match ==text== for highlighting
      const highlightRegex = /==((?:[^=]|=(?!=))+)==/g
      let match

      while ((match = highlightRegex.exec(text)) !== null) {
        const fullMatch = match[0]
        const content = match[1]
        const startPos = lineStart + match.index
        const endPos = startPos + fullMatch.length

        // Hide the opening ==
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })

        // Apply highlight styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 2,
          to: endPos - 2,
          decoration: Decoration.mark({ class: 'cm-highlight-formatted' })
        })

        // Hide the closing ==
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    /**
     * Process multi-line highlight formatting: ==text that spans
     * multiple lines==
     * This must be called separately from the per-line processing
     * to handle patterns that cross line boundaries.
     */
    processMultiLineHighlights(decorations, atomicDecorations, doc, fromPos, toPos) {
      const text = doc.sliceString(fromPos, toPos)
      // Match ==...== allowing newlines in content
      // Use non-greedy match and require at least one character
      const highlightRegex = /==([\s\S]+?)==/g
      let match

      while ((match = highlightRegex.exec(text)) !== null) {
        const fullMatch = match[0]
        const content = match[1]

        // Skip single-line highlights (already handled by processHighlightFormatting)
        if (!content.includes('\n')) {
          continue
        }

        const startPos = fromPos + match.index
        const endPos = startPos + fullMatch.length

        // Hide the opening ==
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })

        // Apply highlight styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 2,
          to: endPos - 2,
          decoration: Decoration.mark({ class: 'cm-highlight-formatted' })
        })

        // Hide the closing ==
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    processStrikethroughFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match ~~text~~ for strikethrough
      const strikethroughRegex = /~~([^~]+)~~/g
      let match

      while ((match = strikethroughRegex.exec(text)) !== null) {
        const fullMatch = match[0]
        const content = match[1]
        const startPos = lineStart + match.index
        const endPos = startPos + fullMatch.length

        // Hide the opening ~~
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })

        // Apply strikethrough styling to the content (NOT atomic)
        decorations.push({
          from: startPos + 2,
          to: endPos - 2,
          decoration: Decoration.mark({ class: 'cm-strikethrough-formatted' })
        })

        // Hide the closing ~~
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
      }
    }

    processWikiLinkFormatting(decorations, atomicDecorations, text, lineStart) {
      // Match [[text]] for WikiLinks
      const wikiLinkRegex = /\[\[([^\]]+)\]\]/g
      let match

      while ((match = wikiLinkRegex.exec(text)) !== null) {
        const fullMatch = match[0]
        const content = match[1]
        const startPos = lineStart + match.index
        const endPos = startPos + fullMatch.length

        // Hide the opening [[
        const openReplace = Decoration.replace({})
        decorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })
        atomicDecorations.push({
          from: startPos,
          to: startPos + 2,
          decoration: openReplace
        })

        // The content itself is already styled by the WikiLink extension
        // We just need to hide the brackets

        // Hide the closing ]]
        const closeReplace = Decoration.replace({})
        decorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
        atomicDecorations.push({
          from: endPos - 2,
          to: endPos,
          decoration: closeReplace
        })
      }
    }
  },
  {
    decorations: v => v.decorations,

    // Provide atomicRanges so cursor movement skips over hidden syntax markers.
    // This makes arrow key navigation feel natural: the cursor jumps over invisible
    // characters (like ** for bold) rather than stopping on them.
    provide: plugin => EditorView.atomicRanges.of(view => {
      const p = view.plugin(plugin)
      return p ? p.atomicDecorations : Decoration.none
    })
  }
))

/**
 * Clean styles for formatted text - no CSS hacks needed!
 * Now includes heading styles alongside inline formatting
 */
export const inlineFormattingStyles = EditorView.theme({
  // Heading styles - inherit line-height to align click targets with text
  '.cm-heading-formatted': {
    fontWeight: '600 !important',
    color: 'var(--md-heading-color, #1a202c) !important'
  },

  '.cm-heading-1-formatted': {
    fontSize: '1.875em !important',
    fontWeight: '700 !important'
  },

  '.cm-heading-2-formatted': {
    fontSize: '1.5em !important',
    fontWeight: '600 !important'
  },

  '.cm-heading-3-formatted': {
    fontSize: '1.25em !important',
    fontWeight: '600 !important'
  },

  '.cm-heading-4-formatted': {
    fontSize: '1.125em !important',
    fontWeight: '600 !important'
  },

  '.cm-heading-5-formatted': {
    fontSize: '1em !important',
    fontWeight: '600 !important'
  },

  '.cm-heading-6-formatted': {
    fontSize: '0.875em !important',
    fontWeight: '600 !important',
    color: 'var(--md-heading-muted, #6a737d) !important'
  },

  // Blockquote formatting with left border and subtle background
  '.cm-blockquote-formatted': {
    color: 'var(--md-blockquote-color, #6a737d) !important',
    backgroundColor: 'var(--md-blockquote-bg, #f8f9fa) !important',
    paddingLeft: '1rem !important',
    paddingRight: '0.5rem !important',
    paddingTop: '0.25rem !important',
    paddingBottom: '0.25rem !important',
    borderLeft: '4px solid var(--accent-color, #4572DE) !important',
    borderRadius: '0 4px 4px 0 !important',
    marginLeft: '-0.5rem !important',
    display: 'inline-block !important',
    minWidth: 'calc(100% - 0.5rem) !important',
    boxSizing: 'border-box !important'
  },

  // Inline formatting styles
  '.cm-strong-formatted': {
    fontWeight: '600 !important'
  },

  '.cm-heading-formatted .cm-strong-formatted, .cm-heading-formatted.cm-strong-formatted': {
    fontWeight: '700 !important'
  },

  '.cm-heading-1-formatted .cm-strong-formatted, .cm-heading-1-formatted.cm-strong-formatted': {
    fontWeight: '800 !important'
  },
  
  '.cm-emphasis-formatted': {
    fontStyle: 'italic !important'
  },
  
  '.cm-underline-formatted': {
    textDecoration: 'underline !important',
    textDecorationColor: 'currentColor !important',
    textUnderlineOffset: '2px !important',
    fontStyle: 'normal !important'  // Override any italic styling
  },
  
  // Highlight formatting yellow background
  '.cm-highlight-formatted': {
    backgroundColor: '#ffeb3b !important',
    color: '#000000 !important',
    padding: '0 2px !important',
    borderRadius: '2px !important',
    fontWeight: '500 !important'
  },
  
  // Strikethrough formatting - clean strikethrough line
  '.cm-strikethrough-formatted': {
    position: 'relative !important',
    textDecoration: 'line-through !important'
  },
  
  '.cm-strikethrough-formatted::after': {
    content: '""',
    position: 'absolute !important',
    top: '50% !important',
    left: '0 !important',
    right: '0 !important',
    height: '1px !important',
    backgroundColor: 'currentColor !important',
    transform: 'translateY(-50%) !important'
  },

  // Table formatting - clean, professional styling with content-based width
  '.cm-table-formatted': {
    borderCollapse: 'collapse !important',
    width: 'auto !important',
    maxWidth: '100% !important',
    margin: '0.5em 0 !important',
    border: '2px solid var(--border-color, #e9e9e7) !important',
    borderRadius: '8px !important',
    overflow: 'hidden !important',
    fontSize: '14px !important',
    fontFamily: 'inherit !important',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1) !important',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
    cursor: 'text !important'
  },
  
  '.cm-table-formatted th': {
    backgroundColor: 'var(--bg-secondary, #f8f9fa) !important',
    color: 'var(--editor-text-color, #1f2937) !important',
    fontWeight: '600 !important',
    padding: '12px 16px !important',
    borderBottom: '2px solid var(--border-color, #e9e9e7) !important',
    borderRight: '1px solid var(--border-color, #e9e9e7) !important',
    minWidth: '40px !important',
    minHeight: '20px !important',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
    cursor: 'text !important'
  },
  
  '.cm-table-formatted th:last-child': {
    borderRight: 'none !important'
  },
  
  '.cm-table-formatted td': {
    padding: '10px 16px !important',
    borderBottom: '1px solid var(--border-color, #e9e9e7) !important',
    borderRight: '1px solid var(--border-color, #e9e9e7) !important',
    color: 'var(--editor-text-color, #1f2937) !important',
    minWidth: '40px !important',
    whiteSpace: 'normal !important',
    wordBreak: 'break-word !important',
    overflowWrap: 'anywhere !important',
    overflow: 'visible !important',
    textOverflow: 'unset !important',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
    cursor: 'text !important'
  },
  
  '.cm-table-formatted td:last-child': {
    borderRight: 'none !important'
  },
  
  '.cm-table-formatted tr:last-child td': {
    borderBottom: 'none !important'
  },
  
  '.cm-table-formatted tr:hover': {
    backgroundColor: 'var(--bg-hover, #f5f5f5) !important'
  },
  
  // Table inline formatting
  '.cm-table-formatted strong': {
    fontWeight: '600 !important'
  },
  
  '.cm-table-formatted em': {
    fontStyle: 'italic !important'
  },
  
  '.cm-table-formatted code': {
    backgroundColor: 'var(--bg-secondary, #f8f9fa) !important',
    color: 'var(--editor-text-color, #1f2937) !important',
    padding: '2px 4px !important',
    borderRadius: '3px !important',
    fontSize: '13px !important',
    fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace !important'
  },

  '.cm-table-formatted a': {
    color: 'var(--link-color, #2563eb) !important',
    textDecoration: 'underline !important',
    textUnderlineOffset: '2px !important'
  },

  '.cm-table-formatted a:hover': {
    color: 'var(--link-hover, #1d4ed8) !important'
  },

  '.cm-table-formatted .cm-table-highlight': {
    color: 'inherit !important',
    backgroundColor: 'rgba(253, 240, 209, 0.95) !important',
    borderRadius: '0.22em !important',
    padding: '0.02em 0.08em !important'
  },
  
  // Responsive behavior for smaller screens
  '@media (max-width: 768px)': {
    '.cm-table-formatted': {
      fontSize: '13px !important'
    },
    '.cm-table-formatted th, .cm-table-formatted td': {
      padding: '8px 12px !important',
      whiteSpace: 'normal !important'
    }
  },
  
  // Code block formatting - professional syntax highlighting
  '.cm-code-block-formatted': {
    backgroundColor: 'var(--bg-secondary, #f8f9fa) !important',
    border: '1px solid var(--border-color, #e9e9e7) !important',
    borderRadius: '8px !important',
    margin: '0 !important',
    padding: '1em 0 !important',
    fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace !important',
    fontSize: '14px !important',
    lineHeight: '1.5 !important',
    position: 'relative !important',
    overflow: 'visible !important',
    display: 'block !important',
    clear: 'both !important',
    maxWidth: '100% !important',
    boxSizing: 'border-box !important',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
    pointerEvents: 'auto !important'
  },
  
  '.cm-code-language-label': {
    position: 'absolute !important',
    top: '8px !important',
    right: '80px !important',
    fontSize: '12px !important',
    color: 'var(--text-secondary, #6b6b6b) !important',
    backgroundColor: 'var(--bg-primary, #ffffff) !important',
    padding: '2px 6px !important',
    borderRadius: '4px !important',
    border: '1px solid var(--border-color, #e9e9e7) !important',
    fontWeight: '500 !important',
    textTransform: 'uppercase !important',
    letterSpacing: '0.5px !important'
  },
  
  '.cm-code-content': {
    display: 'block !important',
    padding: '16px !important',
    paddingTop: '12px !important',
    margin: '0 !important',
    fontFamily: 'inherit !important',
    fontSize: 'inherit !important',
    lineHeight: 'inherit !important',
    color: 'var(--editor-text-color, #1f2937) !important',
    backgroundColor: 'transparent !important',
    border: 'none !important',
    whiteSpace: 'pre-wrap !important',
    wordWrap: 'break-word !important',
    overflowWrap: 'break-word !important',
    overflowX: 'hidden !important',
    overflowY: 'auto !important',
    maxHeight: '400px !important',
    maxWidth: '100% !important',
    boxSizing: 'border-box !important',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
    MozUserSelect: 'text !important',
    msUserSelect: 'text !important',
    cursor: 'text !important',
    pointerEvents: 'auto !important'
  },
  
  // Syntax highlighting styles - using CSS variables from token system
  '.cm-code-content .cm-keyword': {
    color: 'var(--syntax-keyword) !important',
    fontWeight: '600 !important'
  },

  '.cm-code-content .cm-string': {
    color: 'var(--syntax-string) !important'
  },

  '.cm-code-content .cm-comment': {
    color: 'var(--syntax-comment) !important',
    fontStyle: 'italic !important'
  },

  '.cm-code-content .cm-number': {
    color: 'var(--syntax-number) !important'
  },

  '.cm-code-content .cm-function': {
    color: 'var(--syntax-function) !important',
    fontWeight: '600 !important'
  },

  '.cm-code-content .cm-variable': {
    color: 'var(--syntax-variable) !important'
  },

  '.cm-code-content .cm-operator': {
    color: 'var(--syntax-operator) !important'
  },

  '.cm-code-content .cm-bracket': {
    color: 'var(--syntax-bracket) !important'
  },

  // Copy button styles
  '.cm-code-copy-btn': {
    position: 'absolute !important',
    top: '8px !important',
    right: '8px !important',
    padding: '4px 8px !important',
    fontSize: '11px !important',
    fontWeight: '500 !important',
    color: 'var(--text-secondary, #6b7280) !important',
    backgroundColor: 'var(--bg-tertiary, #e5e7eb) !important',
    border: 'none !important',
    borderRadius: '4px !important',
    cursor: 'pointer !important',
    opacity: '0 !important',
    transition: 'opacity 0.15s ease, background-color 0.15s ease !important',
    zIndex: '10 !important',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif !important'
  },

  '.cm-code-block-formatted:hover .cm-code-copy-btn': {
    opacity: '1 !important'
  },

  '.cm-code-copy-btn:hover': {
    backgroundColor: 'var(--bg-quaternary, #d1d5db) !important'
  },

  '.cm-code-copy-btn:focus': {
    outline: '2px solid var(--focus-ring, #3b82f6) !important',
    outlineOffset: '2px !important',
    opacity: '1 !important'
  },

  '.cm-code-copy-btn:active': {
    transform: 'scale(0.95) !important'
  },

  // Code block scrollbar styling - make horizontal scroll visible
  '.cm-code-content::-webkit-scrollbar': {
    height: '8px !important',
    width: '8px !important'
  },

  '.cm-code-content::-webkit-scrollbar-track': {
    background: 'var(--bg-tertiary, #e5e7eb) !important',
    borderRadius: '4px !important'
  },

  '.cm-code-content::-webkit-scrollbar-thumb': {
    backgroundColor: 'var(--text-tertiary, #9ca3af) !important',
    borderRadius: '4px !important',
    border: '2px solid var(--bg-tertiary, #e5e7eb) !important'
  },

  '.cm-code-content::-webkit-scrollbar-thumb:hover': {
    backgroundColor: 'var(--text-secondary, #6b7280) !important'
  },

  // Responsive code blocks
  '@media (max-width: 768px)': {
    '.cm-code-block-formatted': {
      fontSize: '13px !important',
      margin: '0 !important'
    },
    '.cm-code-content': {
      padding: '12px !important',
      maxHeight: '300px !important'
    },
    '.cm-code-copy-btn': {
      opacity: '1 !important',
      top: '6px !important',
      right: '6px !important'
    },
    '.cm-code-language-label': {
      fontSize: '11px !important',
      top: '6px !important',
      right: '70px !important'
    }
  }
})

// Export the block widget field
export const blockWidgetExtension = blockWidgetField

// Export the old names for backward compatibility
export const underlineExtension = inlineFormattingExtension
export const underlineStyles = inlineFormattingStyles
