import { syntaxTree } from '@codemirror/language'
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import toast from '../plugin-hub/components/Toast.js'

// Debounced editor sync helper (shared pattern)
if (!window.__taskSyncTimers) window.__taskSyncTimers = new Map()
async function scheduleEditorSync(filePath, lineNumber) {
  const key = filePath || 'unknown'
  if (window.__taskSyncTimers.has(key)) clearTimeout(window.__taskSyncTimers.get(key))
  window.__taskSyncTimers.set(key, setTimeout(async () => {
    try {
      const updated = await invoke('read_file_content', { filePath })
      const activeEditor = window.paneManager?.getActiveTabManager()?.getActiveTab()?.editor
      const isActive = activeEditor?.currentFile === filePath || !activeEditor?.currentFile
      if (activeEditor && typeof activeEditor.setContent === 'function' && isActive) {
        const doc = activeEditor.view?.state?.doc
        const targetLine = doc ? Math.min(lineNumber || 1, doc.lines) : (lineNumber || 1)
        const anchor = doc ? doc.line(targetLine).from : 0
        activeEditor.setContent(updated, true, activeEditor.currentFile, true)
        if (activeEditor.view) activeEditor.view.dispatch({ selection: { anchor } })
        if (typeof activeEditor.save === 'function') { try { await activeEditor.save() } catch {} }
      }
    } catch (e) {
      console.warn('[Task] Debounced sync failed:', e)
    }
  }, 300))
}
import { RangeSetBuilder } from '@codemirror/state'

// Enhanced heading widget that renders beautiful headings
class HeadingWidget extends WidgetType {
  constructor(level, text, markupLength) {
    super()
    this.level = level
    this.text = text
    this.markupLength = markupLength
  }

  toDOM() {
    const heading = document.createElement(`h${this.level}`)
    heading.className = `cm-heading cm-heading-${this.level}`
    heading.textContent = this.text
    
    // Add heading anchor functionality
    heading.onclick = (e) => {
      e.stopPropagation()
      // Could implement heading navigation here
    }
    
    return heading
  }

  eq(other) {
    return other.level === this.level && other.text === this.text
  }

  get estimatedHeight() {
    const heights = { 1: 48, 2: 40, 3: 32, 4: 28, 5: 24, 6: 22 }
    return heights[this.level] || 24
  }
}

// Enhanced list item widget with proper spacing and checkboxes
class ListItemWidget extends WidgetType {
  constructor(content, isTask = false, isChecked = false, indent = 0) {
    super()
    this.content = content
    this.isTask = isTask
    this.isChecked = isChecked
    this.indent = indent
  }

  toDOM() {
    const li = document.createElement('div')
    li.className = 'cm-list-item'
    li.style.paddingLeft = `${this.indent * 20 + 20}px`
    
    if (this.isTask) {
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = this.isChecked
      checkbox.className = 'cm-task-checkbox'
      checkbox.onclick = (e) => {
        e.stopPropagation()
        // Toggle task state - this would update the markdown
      }
      
      const label = document.createElement('label')
      label.className = 'cm-task-label'
      if (this.isChecked) {
        label.classList.add('cm-task-checked')
      }
      label.appendChild(checkbox)
      
      const text = document.createElement('span')
      text.textContent = this.content
      label.appendChild(text)
      
      li.appendChild(label)
    } else {
      const bullet = document.createElement('span')
      bullet.className = 'cm-list-bullet'
      bullet.textContent = '•'
      
      const text = document.createElement('span')
      text.className = 'cm-list-text'
      text.textContent = this.content
      
      li.appendChild(bullet)
      li.appendChild(text)
    }
    
    return li
  }

  eq(other) {
    return other.content === this.content && 
           other.isTask === this.isTask && 
           other.isChecked === this.isChecked &&
           other.indent === this.indent
  }
}

// Enhanced blockquote widget
class BlockquoteWidget extends WidgetType {
  constructor(content) {
    super()
    this.content = content
  }

  toDOM() {
    const blockquote = document.createElement('blockquote')
    blockquote.className = 'cm-blockquote'
    blockquote.textContent = this.content
    return blockquote
  }

  eq(other) {
    return other.content === this.content
  }
}

// Code block widget with syntax highlighting
class CodeBlockWidget extends WidgetType {
  constructor(content, language = '') {
    super()
    this.content = content
    this.language = language
  }

  toDOM() {
    const pre = document.createElement('pre')
    pre.className = 'cm-code-block'
    
    const code = document.createElement('code')
    if (this.language) {
      code.className = `language-${this.language}`
    }
    code.textContent = this.content
    
    pre.appendChild(code)
    return pre
  }

  eq(other) {
    return other.content === this.content && other.language === this.language
  }
}

// Simple task checkbox widget
class TaskCheckboxWidget extends WidgetType {
  constructor(isChecked, lineNumber, lineText, view) {
    super()
    this.isChecked = isChecked
    this.lineNumber = lineNumber
    this.lineText = lineText
    this.view = view
  }

  toDOM() {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = this.isChecked
    checkbox.className = 'cm-task-checkbox-inline'
    checkbox.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        console.log('[LivePreview] Checkbox click at line', this.lineNumber)
        // Build absolute file path
        const relPath = this.view.state.field(window.currentFilePath) || window.tabManager?.activeTab?.filePath
        const filePath = (relPath && (relPath.startsWith('/') || relPath.includes(':'))) ? relPath : (window.currentVaultPath && relPath ? `${window.currentVaultPath}/${relPath}` : relPath)
        if (!filePath) return

        // Determine explicit target status from UI
        const newStatus = e.target.checked ? 'done' : 'todo'

        // Update the line in the editor buffer immediately
        try {
          const doc = this.view.state.doc
          const line = doc.line(this.lineNumber)
          const replaced = line.text.replace(/^(\s*)- \[(?:x| )\]/, `$1- [${newStatus === 'done' ? 'x' : ' '}]`)
          if (replaced !== line.text) {
            this.view.dispatch({ changes: { from: line.from, to: line.to, insert: replaced } })
          }
        } catch {}

        // Persist task metadata explicitly when we know the ID
        const tidMatch = /<!--\s*tid:\s*([a-f0-9-]+)\s*-->/.exec(this.lineText)
        if (tidMatch && tidMatch[1]) {
          try {
            await invoke('update_task_properties', {
              request: {
                file_path: filePath,
                task_id: tidMatch[1],
                updates: { status: newStatus }
              }
            })
          } catch (err) {
            // Fallback if nested snake_case is still mismatched in some envs
            try {
              await invoke('toggle_task_by_id', { filePath, taskId: tidMatch[1] })
            } catch (e2) {
              throw err
            }
          }
        } else {
          // Fallback: flip the body line to ensure persistence in content
          await invoke('toggle_task_status', { filePath, lineNumber: this.lineNumber })
        }

        // Save current editor state to disk immediately
        try {
          const activeEditor = window.paneManager?.getActiveTabManager()?.getActiveTab()?.editor
          if (activeEditor && typeof activeEditor.save === 'function') { await activeEditor.save() }
        } catch {}
        try { toast.success(e.target.checked ? 'Task marked done' : 'Task updated', 1200) } catch {}
      } catch (err) {
        console.error('[LivePreview] Toggle failed:', err)
        try { toast.error('Failed to toggle task', 2000) } catch {}
      }
    })
    return checkbox
  }

  eq(other) {
    return other.isChecked === this.isChecked && other.lineNumber === this.lineNumber
  }

  // Let widget receive pointer events without editor interference
  ignoreEvent() {
    return true
  }
}

// Simple bullet widget
class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement('span')
    bullet.className = 'cm-bullet-inline'
    bullet.textContent = '•'
    return bullet
  }

  eq(other) {
    return true
  }
}

// Horizontal rule widget (keeping this as widget replacement)
class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-horizontal-rule'
    return hr
  }

  eq(other) {
    return true
  }
}

// Live preview plugin that renders markdown beautifully using inline styling
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.fmEnd = this.computeFrontmatterEnd(view.state.doc)
      this.decorations = this.computeDecorations(view)
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.fmEnd = this.computeFrontmatterEnd(update.view.state.doc)
        this.decorations = this.computeDecorations(update.view)
      }
    }

    computeFrontmatterEnd(doc) {
      // Scan only the first 10k chars for performance
      const head = doc.sliceString(0, Math.min(10000, doc.length))
      if (head.startsWith('---\n') || head.startsWith('---\r\n')) {
        const m = head.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
        if (m && m.index === 0) return m[0].length
        // Fallback: simple search for closing delimiter
        const lfClose = '\n---\n'
        const crlfClose = '\r\n---\r\n'
        const searchStart = 4
        let pos = head.indexOf(lfClose, searchStart)
        if (pos === -1) pos = head.indexOf(crlfClose, searchStart)
        if (pos !== -1) return pos + (head.includes('\r\n') ? crlfClose.length : lfClose.length)
      }
      return 0
    }

    computeDecorations(view) {
      const builder = new RangeSetBuilder()
      const doc = view.state.doc
      
      for (const { from, to } of view.visibleRanges) {
        this.processRange(view, builder, from, to)
      }
      
      return builder.finish()
    }

    processRange(view, builder, from, to) {
      const doc = view.state.doc
      
      // Process line by line for markdown styling
      for (let pos = from; pos <= to;) {
        const line = doc.lineAt(pos)
        const text = line.text
        
        // Skip empty lines
        if (text.trim() === '') {
          pos = line.to + 1
          continue
        }
        
        // Process different markdown elements
        this.processLine(view, builder, line, text)
        
        pos = line.to + 1
      }
    }

    processLine(view, builder, line, text) {
      // Skip any processing for lines within the YAML frontmatter
      if (this.fmEnd && line.from < this.fmEnd) {
        return
      }
      const trimmed = text.trim()

      // True WYSIWYG mode: always render widgets (checkboxes, bullets, hr)
      // even when the cursor is on the line. Users format via '/' command menu.

      // Note: Inline formatting (bold, italic, underline) AND headings are
      // handled by the separate formatting-extension.js
      
      // Horizontal rules (--- or ***)
      if (trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
        builder.add(
          line.from,
          line.to,
          Decoration.replace({
            widget: new HorizontalRuleWidget()
          })
        )
        return
      }
      
      // Task lists (- [ ] or - [x])
      const taskMatch = trimmed.match(/^(-\s\[(x| )\])\s+(.*)$/)
      if (taskMatch) {
          const checkbox = taskMatch[1]
          const isChecked = taskMatch[2] === 'x'
          const content = taskMatch[3]
          const checkboxStart = line.from + text.indexOf(checkbox)
          const contentStart = line.from + text.indexOf(content)
          
          // Replace checkbox with styled checkbox
          builder.add(
              checkboxStart,
              contentStart,
              Decoration.replace({
                  widget: new TaskCheckboxWidget(isChecked, line.number, line.text, view)
              })
          )
          return
      }
      
      // Regular list items (- or *)
      const listMatch = trimmed.match(/^([*-])\s+(.*)$/)
      if (listMatch) {
          const bullet = listMatch[1]
          const content = listMatch[2]
          const bulletStart = line.from + text.indexOf(bullet)
          const contentStart = line.from + text.indexOf(content)
          
          // Replace bullet with styled bullet
          builder.add(
              bulletStart,
              contentStart,
              Decoration.replace({
                  widget: new BulletWidget()
              })
          )
          return
      }
    }
    
    // Note: Inline formatting (bold, italic, underline) is now handled 
    // by the separate formatting-extension.js to avoid conflicts and 
    // ensure proper active line detection.
  },
  {
    decorations: (v) => v.decorations
  }
)

// Enhanced styling for the live preview - widgets only
export const livePreviewStyles = EditorView.theme({
  // Simple inline elements
  '.cm-task-checkbox-inline': {
    marginRight: '0.5em',
    accentColor: 'var(--accent-color, #5b47e0)'
  },
  
  '.cm-bullet-inline': {
    color: 'var(--md-list-bullet, #586e75)',
    marginRight: '0.5em'
  },
  
  // Horizontal rules (still using widgets)
  '.cm-horizontal-rule': {
    border: 'none',
    borderTop: '2px solid var(--md-hr-color, #e1e4e8)',
    margin: '1em 0',
    width: '100%'
  }
  
  // Note: Inline formatting styles (bold, italic, underline) AND headings 
  // are now handled by formatting-extension.js
})

// Helper function to enable/disable live preview
export function toggleLivePreview(view, enabled) {
  const effects = []
  
  if (enabled) {
    effects.push({
      effects: view.state.compartment.reconfigure([
        livePreviewPlugin,
        livePreviewStyles
      ])
    })
  } else {
    effects.push({
      effects: view.state.compartment.reconfigure([])
    })
  }
  
  view.dispatch({ effects })
}
