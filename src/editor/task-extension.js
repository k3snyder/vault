import { 
  Decoration, 
  ViewPlugin, 
  EditorView, 
  WidgetType,
  keymap
} from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'
import { invoke } from '@tauri-apps/api/core'
import toast from '../plugin-hub/components/Toast.js'

// Debounced editor sync after toggles
if (!window.__taskSyncTimers) window.__taskSyncTimers = new Map()
if (!window.__taskStickyEditLines) window.__taskStickyEditLines = new Set()
if (typeof window.__taskLastEditLine !== 'number') window.__taskLastEditLine = 0
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

// Task patterns for detection
const TASK_PATTERNS = {
  todo: /^(\s*)-\s\[\s\]\s(.*)$/,
  done: /^(\s*)-\s\[x\]\s(.*)$/,
  cancelled: /^(\s*)-\s\[-\]\s(.*)$/,
  // Combined pattern for any task
  any: /^(\s*)-\s\[([ x-])\]\s(.*)$/
}

// Property patterns for inline parsing
const PROPERTY_PATTERNS = {
  // Keep legacy pattern but parseTaskLine handles additional syntaxes
  due: /@due:([^\s]+)/,
  // Match whole token; include 'medium' alias
  priority: /!(low|medium|med|high|p[1-5])\b/,
  // Allow nested tags with slashes and dashes: #parent/child or #tag-name
  tags: /#([A-Za-z0-9][A-Za-z0-9/_-]*)/g,
  project: /@project:([^\s]+)/,
  tid: /<!-- tid:\s*([a-f0-9-]+)\s*-->/
}

// Task state update effect
const updateTaskEffect = StateEffect.define()

// Effect to toggle edit mode for a specific line
export const toggleEditModeEffect = StateEffect.define()

// Track which lines are in edit mode
const editModeField = StateField.define({
  create() {
    return new Set() // Set of line numbers in edit mode
  },
  update(value, tr) {
    let newValue = value
    for (const effect of tr.effects) {
      if (effect.is(toggleEditModeEffect)) {
        newValue = new Set(value)
        const lineNumber = effect.value
        if (newValue.has(lineNumber)) {
          newValue.delete(lineNumber)
        } else {
          newValue.add(lineNumber)
        }
      }
    }
    return newValue
  }
})

// Export the task state field so tests can access it
export const taskStateField = StateField.define({
  create(state) {
    // Initial scan of document for tasks
    const tasks = new Map()
    const doc = state.doc
    
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i)
      const text = line.text
      const match = TASK_PATTERNS.any.exec(text)
      
      if (match) {
        const [, indent, status, content] = match
        const taskInfo = parseTaskLine(text, status, content)
        taskInfo.lineNumber = i
        taskInfo.from = line.from
        taskInfo.to = line.to
        tasks.set(i, taskInfo)
      }
    }
    
    return tasks
  },
  update(value, tr) {
    if (tr.docChanged || tr.effects.some(e => e.is(updateTaskEffect))) {
      // Re-scan document for tasks
      const newTasks = new Map()
      const doc = tr.state.doc
      
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i)
        const text = line.text
        const match = TASK_PATTERNS.any.exec(text)
        
        if (match) {
          const [, indent, status, content] = match
          const taskInfo = parseTaskLine(text, status, content)
          taskInfo.lineNumber = i
          taskInfo.from = line.from
          taskInfo.to = line.to
          newTasks.set(i, taskInfo)
        }
      }
      
      return newTasks
    }
    
    // Handle effects
    for (const effect of tr.effects) {
      if (effect.is(updateTaskEffect)) {
        const { lineNumber, taskInfo } = effect.value
        const newValue = new Map(value)
        newValue.set(lineNumber, taskInfo)
        return newValue
      }
    }
    
    return value
  }
})

// Parse task line for properties and metadata
function parseTaskLine(fullLine, status, content) {
  const properties = {}
  
  // Extract task ID from comment if present
  const tidMatch = PROPERTY_PATTERNS.tid.exec(fullLine)
  if (tidMatch) {
    properties.id = tidMatch[1]
  }
  
  // Extract due date: support @due:YYYY-MM-DD, @due YYYY-MM-DD, @due(YYYY-MM-DD|today|tomorrow)
  let dueValue = null
  {
    const paren = /@due\s*\(\s*([^\)]+)\s*\)/i.exec(content)
    if (paren) dueValue = paren[1]
    if (!dueValue) {
      const alt = /@due(?::|\s+)([^\s]+)/i.exec(content)
      if (alt) dueValue = alt[1]
    }
  }
  if (dueValue) {
    properties.due = dueValue
  }
  
  // Extract priority
  const priorityMatch = PROPERTY_PATTERNS.priority.exec(content)
  if (priorityMatch) {
    properties.priority = normalizePriority(priorityMatch[1])
  }
  
  // Extract tags
  const tags = []
  let tagMatch
  while ((tagMatch = PROPERTY_PATTERNS.tags.exec(content)) !== null) {
    tags.push(tagMatch[1])
  }
  if (tags.length > 0) {
    properties.tags = tags
  }
  
  // Extract project
  const projectMatch = PROPERTY_PATTERNS.project.exec(content)
  if (projectMatch) {
    properties.project = projectMatch[1]
  }
  
  // Clean text by removing properties
  let cleanText = content
    .replace(/@due\s*\([^)]*\)|@due(?::|\s+)[^\s]+/gi, '')
    .replace(PROPERTY_PATTERNS.priority, '')
    .replace(PROPERTY_PATTERNS.tags, '')
    .replace(PROPERTY_PATTERNS.project, '')
    .trim()
  
  return {
    status: statusFromChar(status),
    text: cleanText,
    rawText: content,
    ...properties
  }
}

// Normalize priority values
function normalizePriority(priority) {
  const mapping = {
    'p1': 'high',
    'p2': 'high',
    'p3': 'med',
    'p4': 'low',
    'p5': 'low',
    'high': 'high',
    'med': 'med',
    'medium': 'med',
    'low': 'low'
  }
  return mapping[priority.toLowerCase()] || 'med'
}

// Convert status character to string
function statusFromChar(char) {
  switch (char) {
    case ' ': return 'todo'
    case 'x': return 'done'
    case '-': return 'cancelled'
    default: return 'todo'
  }
}

// Convert status string to character
function charFromStatus(status) {
  switch (status) {
    case 'todo': return ' '
    case 'done': return 'x'
    case 'cancelled': return '-'
    default: return ' '
  }
}

// Checkbox widget for interactive task toggling
class CheckboxWidget extends WidgetType {
  constructor(taskInfo, view) {
    super()
    this.taskInfo = taskInfo
    this.view = view
  }
  
  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-task-checkbox-wrapper'
    
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = `cm-task-checkbox cm-task-${this.taskInfo.status}`
    checkbox.checked = this.taskInfo.status === 'done'
    checkbox.indeterminate = this.taskInfo.status === 'cancelled'
    
    // Prevent line-level mousedown handler from triggering when interacting with checkbox
    checkbox.addEventListener('mousedown', (e) => {
      e.stopPropagation()
    })
    wrapper.addEventListener('mousedown', (e) => {
      e.stopPropagation()
    })
    
    // Use change event for better reliability with inputs
    checkbox.addEventListener('change', async (e) => {
      e.stopPropagation()
      // Let the browser toggle the visual checkbox, then persist
      try {
        await this.handleClick()
      } catch (err) {
        console.error('[Task Checkbox] Toggle failed:', err)
      }
    })
    
    wrapper.appendChild(checkbox)
    return wrapper
  }
  
  async handleClick() {
    console.log('[Task Checkbox] handleClick start for line', this.taskInfo.lineNumber)
    const currentStatus = this.taskInfo.status
    let newStatus
    
    // Cycle through: todo -> done -> cancelled -> todo
    switch (currentStatus) {
      case 'todo':
        newStatus = 'done'
        break
      case 'done':
        newStatus = 'cancelled'
        break
      case 'cancelled':
        newStatus = 'todo'
        break
      default:
        newStatus = 'done'
    }
    
    // Get file path from state field and normalize to absolute
    const relPath = this.view.state.field(window.currentFilePath) ||
                    window.tabManager?.activeTab?.filePath
    const filePath = (relPath && (relPath.startsWith('/') || relPath.includes(':')))
      ? relPath
      : (window.currentVaultPath && relPath ? `${window.currentVaultPath}/${relPath}` : relPath)
    
    if (!filePath) {
      console.error('No file path available for task update')
      return
    }
    
    try {
      // Ensure task has UUID if it doesn't already
      if (!this.taskInfo.id) {
        // Get the line content for hybrid processing
        const line = this.view.state.doc.line(this.taskInfo.lineNumber)
        const lineContent = line.text
        
        const result = await invoke('ensure_task_uuid', {
          filePath: filePath,  // Tauri expects camelCase
          lineNumber: this.taskInfo.lineNumber, // Already 1-indexed from CodeMirror
          lineContent: lineContent // Pass line content for hybrid approach
        })
        
        if (result && result.uuid) {
          this.taskInfo.id = result.uuid
          
          // If it's a new temporary UUID, update the document
          if (result.isNew && result.isTemporary) {
            const newText = `${lineContent} <!-- tid: ${result.uuid} -->`
            this.view.dispatch({
              changes: {
                from: line.from,
                to: line.to,
                insert: newText
              }
            })
          }
        }
      }
      
      // Prefer robust ID-based toggle with absolute path
      if (this.taskInfo.id) {
        await invoke('toggle_task_by_id', {
          filePath: filePath,
          taskId: this.taskInfo.id
        })
      } else {
        // Fallback to line-based toggle if ID is unavailable
        await invoke('toggle_task_status', {
          filePath: filePath,
          lineNumber: this.taskInfo.lineNumber
        })
      }
      
      // Update the line in the editor
      const line = this.view.state.doc.line(this.taskInfo.lineNumber)
      const newChar = charFromStatus(newStatus)
      const newText = line.text.replace(TASK_PATTERNS.any, `$1- [${newChar}] $3`)
      
      // Apply the change to the editor for immediate feedback
      this.view.dispatch({
        changes: {
          from: line.from,
          to: line.to,
          insert: newText
        },
        effects: updateTaskEffect.of({
          lineNumber: this.taskInfo.lineNumber,
          taskInfo: { ...this.taskInfo, status: newStatus }
        })
      })

      // Mark document dirty to ensure auto-save persists any in-memory changes
      if (this.view.state && this.view.state.update) {
        // no-op; change above already marks docChanged and triggers auto-save
      }

      // Immediate read-back + save to avoid losing changes on quick close
      try {
        const updated = await invoke('read_file_content', { filePath })
        const activeEditor = window.paneManager?.getActiveTabManager()?.getActiveTab()?.editor
        if (activeEditor && typeof activeEditor.setContent === 'function') {
          const doc = activeEditor.view?.state?.doc
          const targetLine = doc ? Math.min(this.taskInfo.lineNumber, doc.lines) : this.taskInfo.lineNumber
          const anchor = doc ? doc.line(targetLine).from : 0
          activeEditor.setContent(updated, true, activeEditor.currentFile, true)
          if (activeEditor.view) activeEditor.view.dispatch({ selection: { anchor } })
          if (typeof activeEditor.save === 'function') { try { await activeEditor.save() } catch {} }
        }
      } catch {}
      try { toast.success(newStatus === 'done' ? 'Task marked done' : 'Task updated', 1200) } catch {}
    
    } catch (error) {
      console.error('Failed to toggle task status:', error)
      try { toast.error('Failed to toggle task', 2000) } catch {}
    }
  }
  
  eq(other) {
    return other instanceof CheckboxWidget && 
           other.taskInfo.status === this.taskInfo.status &&
           other.taskInfo.lineNumber === this.taskInfo.lineNumber
  }
  
  // Ensure CodeMirror lets the widget handle pointer events
  ignoreEvent() { 
    return true 
  }
}

// Property chip widget for displaying task metadata
class PropertyChipWidget extends WidgetType {
  constructor(type, value) {
    super()
    this.type = type
    this.value = value
  }
  
  toDOM() {
    const chip = document.createElement('span')
    chip.className = `cm-task-chip cm-task-chip-${this.type}`
    
    // Format display based on type
    let display = this.value
    let icon = ''
    
    switch (this.type) {
      case 'due':
        icon = '📅'
        display = this.formatDueDate(this.value)
        break
      case 'priority':
        icon = this.getPriorityIcon(this.value)
        display = this.value
        break
      case 'project':
        icon = '📁'
        break
      case 'tag':
        icon = '#'
        // Use a project organizer icon for #project/<name> tags
        if (typeof this.value === 'string' && this.value.toLowerCase().startsWith('project/')) {
          icon = '🗂️'
        }
        break
      case 'tid':
        icon = '⚡'
        display = ''
        break
    }
    
    chip.textContent = display ? `${icon} ${display}` : `${icon}`
    chip.title = this.type === 'tid' ? `Task ID: ${this.value}` : this.getTooltip()
    // Special style for nested project tag: #project/<name>
    if (this.type === 'tag' && typeof this.value === 'string' && this.value.toLowerCase().startsWith('project/')) {
      chip.classList.add('cm-task-chip-tag-project')
    }

    return chip
  }
  
  formatDueDate(dateStr) {
    // Normalize friendly tokens
    if (!dateStr) return ''
    const token = String(dateStr).trim().toLowerCase()
    if (token === 'today') return 'Today'
    if (token === 'tomorrow') return 'Tomorrow'
    if (token === 'yesterday') return 'Yesterday'

    // Parse YYYY-MM-DD in local time to avoid UTC shift
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token)
    if (ymd) {
      const [, y, m, d] = ymd
      const date = new Date(Number(y), Number(m) - 1, Number(d))

      const today = new Date()
      const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)

      if (isSameDay(date, today)) return 'Today'
      if (isSameDay(date, tomorrow)) return 'Tomorrow'
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    // Fallback: attempt native parse
    try {
      const date = new Date(dateStr)
      if (!isNaN(date)) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }
    } catch {}

    return dateStr
  }
  
  getPriorityIcon(priority) {
    switch (priority) {
      case 'high': return '🔴'
      case 'med': return '🟡'
      case 'low': return '🔵'
      default: return '⚪'
    }
  }
  
  getTooltip() {
    switch (this.type) {
      case 'due':
        return `Due: ${this.value}`
      case 'priority':
        return `Priority: ${this.value}`
      case 'project':
        return `Project: ${this.value}`
      case 'tag':
        return `Tag: ${this.value}`
      default:
        return this.value
    }
  }
  
  eq(other) {
    return other instanceof PropertyChipWidget && 
           other.type === this.type && 
           other.value === this.value
  }
  
  ignoreEvent() { 
    return true 
  }
}

// Create decorations for tasks
function createTaskDecorations(view) {
  const decorations = []
  const taskState = view.state.field(taskStateField)
  const editMode = view.state.field(editModeField)
  
  for (const [lineNumber, taskInfo] of taskState) {
    const line = view.state.doc.line(lineNumber)
    const lineText = line.text
    const quickMatch = TASK_PATTERNS.any.exec(lineText)
    const quickAfter = quickMatch ? (quickMatch[3] || '') : ''
    const isEmptyTaskContent = quickMatch ? quickAfter.trim().length === 0 : false
    
    // Skip decorations if this line is in edit mode, is newly empty, or is marked sticky edit
    if (editMode.has(lineNumber) || isEmptyTaskContent || window.__taskStickyEditLines.has(lineNumber)) {
      // Add line decoration to indicate edit mode
      decorations.push(
        Decoration.line({
          class: 'cm-task-line cm-task-edit-mode',
          attributes: {
            'data-edit-mode': 'true'
          }
        }).range(line.from)
      )
      
      // Add a mark to show this line is editable
      decorations.push(
        Decoration.mark({
          class: 'cm-task-edit-mode-content',
          attributes: {
            title: 'Click again to return to preview mode'
          }
        }).range(line.from, line.to)
      )
      
      continue
    }
    
    // Find checkbox position
    const checkboxMatch = quickMatch || TASK_PATTERNS.any.exec(lineText)
    if (!checkboxMatch) continue
    
    const checkboxStart = line.from + checkboxMatch.index + checkboxMatch[1].length
    const checkboxEnd = checkboxStart + 5 // Length of "- [ ]"
    
    // Add checkbox widget decoration
    decorations.push(
      Decoration.replace({
        widget: new CheckboxWidget(taskInfo, view)
      }).range(checkboxStart, checkboxEnd)
    )
    
    // Add click handler decoration for the entire line
    decorations.push(
      Decoration.mark({
        class: 'cm-task-clickable',
        attributes: {
          'data-line': String(lineNumber),
          title: 'Click to toggle edit/preview mode'
        }
      }).range(line.from, line.to)
    )
    
    // Add property chip decorations
    const contentStart = checkboxEnd + 1 // After space following checkbox
    
    // Due date chip
    if (taskInfo.due) {
      // Locate any due token matching the parsed value
      const patterns = [
        new RegExp(`@due:\\s*${escapeRegex(taskInfo.due)}\\b`, 'i'),
        new RegExp(`@due\\s+${escapeRegex(taskInfo.due)}\\b`, 'i'),
        new RegExp(`@due\\s*\\(\\s*${escapeRegex(taskInfo.due)}\\s*\\)`, 'i')
      ]
      let m = null
      for (const re of patterns) { m = re.exec(lineText); if (m) break }
      if (m) {
        const dueStart = line.from + m.index
        const dueEnd = dueStart + m[0].length
        decorations.push(
          Decoration.replace({
            widget: new PropertyChipWidget('due', taskInfo.due)
          }).range(dueStart, dueEnd)
        )
      }
    }
    
    // Priority chip
    if (taskInfo.priority) {
      const priorityRegex = /!(low|medium|med|high|p[1-5])\b/g
      let priorityMatch
      while ((priorityMatch = priorityRegex.exec(lineText)) !== null) {
        const priorityStart = line.from + priorityMatch.index
        const priorityEnd = priorityStart + priorityMatch[0].length
        decorations.push(
          Decoration.replace({
            widget: new PropertyChipWidget('priority', taskInfo.priority)
          }).range(priorityStart, priorityEnd)
        )
      }
    }
    
    // Project chip
    if (taskInfo.project) {
      const projectMatch = lineText.indexOf(`@project:${taskInfo.project}`)
      if (projectMatch !== -1) {
        const projectStart = line.from + projectMatch
        const projectEnd = projectStart + `@project:${taskInfo.project}`.length
        decorations.push(
          Decoration.replace({
            widget: new PropertyChipWidget('project', taskInfo.project)
          }).range(projectStart, projectEnd)
        )
      }
    }
    
    // Tag chips
    if (taskInfo.tags && taskInfo.tags.length > 0) {
      for (const tag of taskInfo.tags) {
        const tagRegex = new RegExp(`#${escapeRegex(tag)}\\b`, 'g')
        let tagMatch
        while ((tagMatch = tagRegex.exec(lineText)) !== null) {
          const tagStart = line.from + tagMatch.index
          const tagEnd = tagStart + tagMatch[0].length
          decorations.push(
            Decoration.replace({
              widget: new PropertyChipWidget('tag', tag)
            }).range(tagStart, tagEnd)
          )
        }
      }
    }

    // TID chip – replace HTML comment with a small check icon pill
    if (taskInfo.id) {
      const tidRegex = /<!--\s*tid:\s*([a-f0-9-]+)\s*-->/ig
      let m
      while ((m = tidRegex.exec(lineText)) !== null) {
        const start = line.from + m.index
        const end = start + m[0].length
        decorations.push(
          Decoration.replace({
            widget: new PropertyChipWidget('tid', taskInfo.id)
          }).range(start, end)
        )
      }
    }
    
    // Add task line decoration for styling
    decorations.push(
      Decoration.line({
        class: `cm-task-line cm-task-${taskInfo.status}`
      }).range(line.from)
    )
  }
  
  return Decoration.set(decorations, true)
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Debounce helper
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Task extension ViewPlugin
export const taskExtension = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = createTaskDecorations(view)
      this.ensureTaskUUIDs = debounce(this._ensureTaskUUIDs.bind(this), 1000)
      
      // Initial scan for tasks without UUIDs
      setTimeout(() => this.ensureTaskUUIDs(view), 100)
    }
    
    update(update) {
      // Update decorations when document changes, selection changes (for ESC),
      // task metadata changes, or edit mode toggles
      const hasRelevantEffect = update.transactions.some(tr =>
        tr.effects && tr.effects.some(e => e.is(updateTaskEffect) || e.is(toggleEditModeEffect))
      )

      if (update.docChanged || update.selectionSet || hasRelevantEffect) {
        // If selection moved off a sticky/edit line, auto-exit edit mode to prevent mixed state
        if (update.selectionSet) {
          try {
            const prevPos = update.startState.selection.main.head
            const prevLine = update.startState.doc.lineAt(prevPos).number
            const currPos = update.state.selection.main.head
            const currLine = update.state.doc.lineAt(currPos).number
            if (prevLine !== currLine) {
              const prevEdit = update.startState.field(editModeField)
              const wasEdit = prevEdit.has(prevLine) || window.__taskStickyEditLines.has(prevLine)
              if (wasEdit) {
                // Clear sticky + exit edit mode for previous line
                try { window.__taskStickyEditLines.delete(prevLine) } catch {}
                update.view.dispatch({ effects: toggleEditModeEffect.of(prevLine) })
              }
            }
          } catch {}
        }
        this.decorations = createTaskDecorations(update.view)

        // Queue UUID assignment for new tasks
        if (update.docChanged) {
          this.ensureTaskUUIDs(update.view)
          // If user just typed a new task marker "- [ ]", keep the line in raw edit mode
          try {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            const text = line.text
            const m = TASK_PATTERNS.any.exec(text)
            if (m) {
              const after = m[3] || ''
              if (after.trim().length === 0) {
                const editMode = update.state.field(editModeField)
                if (!editMode.has(line.number)) {
                  window.__taskStickyEditLines.add(line.number)
                  window.__taskLastEditLine = line.number
                  update.view.dispatch({ effects: toggleEditModeEffect.of(line.number) })
                }
              }
            }
          } catch {}
        }
      }
    }
    
  async _ensureTaskUUIDs(view) {
      const filePath = view.state.field(window.currentFilePath) ||
                       window.tabManager?.activeTab?.filePath
      
      if (!filePath) {
        console.log('No file path available for UUID assignment')
        return
      }
      
      const taskState = view.state.field(taskStateField)
      const editSet = view.state.field(editModeField)
      const doc = view.state.doc
      
      // Collect all tasks that need UUIDs
      const tasksNeedingUUIDs = []
      for (const [lineNumber, taskInfo] of taskState) {
        if (!taskInfo.id) {
          const line = doc.line(lineNumber)
          tasksNeedingUUIDs.push({
            lineNumber,
            taskInfo,
            line,
            lineContent: line.text
          })
        }
      }
      
      // Sort tasks in reverse order (bottom to top) to prevent line number shifts
      tasksNeedingUUIDs.sort((a, b) => b.lineNumber - a.lineNumber)
      
      // Process each task and collect changes
      const changes = []
      const effects = []
      
    for (const task of tasksNeedingUUIDs) {
      // Skip lines that are not yet real tasks (empty content after '- [ ] ')
      if (!task.taskInfo || !task.taskInfo.text || task.taskInfo.text.trim().length === 0) {
        continue
      }
      // Defer UUID while line is in explicit edit mode or sticky edit
      if (editSet.has(task.lineNumber) || window.__taskStickyEditLines.has(task.lineNumber)) {
        continue
      }
      try {
          console.log(`Ensuring UUID for task at line ${task.lineNumber}, file: ${filePath}`)
          
          // Use hybrid approach - pass line content for in-memory processing
          const result = await invoke('ensure_task_uuid', {
            filePath: filePath,  // Tauri expects camelCase
            lineNumber: task.lineNumber, // Already 1-indexed from CodeMirror
            lineContent: task.lineContent // Pass the actual line content
          })
          
          if (result && result.uuid) {
            console.log(`Task UUID ${result.isNew ? 'generated' : 'found'}: ${result.uuid}`)
            
            // If it's a new temporary UUID, we need to add it to the document
            if (result.isNew && result.isTemporary) {
              // Add the UUID comment to the end of the line
              const newText = `${task.lineContent} <!-- tid: ${result.uuid} -->`
              changes.push({
                from: task.line.from,
                to: task.line.to,
                insert: newText
              })
            }
            
            // Always update the task state
            effects.push(updateTaskEffect.of({
              lineNumber: task.lineNumber,
              taskInfo: { ...task.taskInfo, id: result.uuid }
            }))
          } else {
            console.log(`No UUID returned for task at line ${task.lineNumber}`)
          }
        } catch (error) {
          console.error(`Failed to assign UUID to task at line ${task.lineNumber}:`, error)
        }
      }
      
      // Apply all changes and effects in a single transaction
      if (changes.length > 0 || effects.length > 0) {
        const transaction = {}
        if (changes.length > 0) transaction.changes = changes
        if (effects.length > 0) transaction.effects = effects
        view.dispatch(transaction)
      }
    }
  },
  {
    decorations: v => v.decorations
  }
)

// Create a separate dom event handler for task clicks (mousedown for priority)
const taskClickHandler = EditorView.domEventHandlers({
  mousedown(e, view) {
    // Ignore interactions on controls or links
    const target = e.target
    if (
      target.closest('.cm-task-checkbox-wrapper') ||
      target.closest('.cm-task-chip') ||
      target.closest('a') ||
      target.closest('button')
    ) {
      return false
    }

    // Prefer dataset-based line detection from our decoration span
    const clickable = target.closest('.cm-task-clickable')
    if (!clickable || !clickable.dataset || !clickable.dataset.line) {
      // Only toggle when explicitly clicking on clickable decoration in preview mode
      return false
    }
    const lineNumber = Number(clickable.dataset.line)

    // Validate this is a task line
    const taskState = view.state.field(taskStateField)
    if (!taskState.has(lineNumber)) return false

    // Toggle edit mode for this task line
    e.preventDefault()
    e.stopPropagation()

    console.log('[Task Edit] Toggling edit mode for line', lineNumber)

    // Use line start as a reasonable editing anchor
    const line = view.state.doc.line(lineNumber)
    const editMode = view.state.field(editModeField)
    if (!editMode.has(lineNumber)) {
      // entering edit mode
      window.__taskLastEditLine = lineNumber
    } else {
      // exiting edit mode clears sticky flag if present
      try { window.__taskStickyEditLines.delete(lineNumber) } catch {}
    }
    view.dispatch({ effects: toggleEditModeEffect.of(lineNumber), selection: { anchor: line.from } })

    // If we are exiting edit mode, ensure UUID is present and persist comment
    if (editMode.has(lineNumber)) {
      setTimeout(() => ensureUuidForLine(view, lineNumber), 0)
    }

    view.focus()
    return true
  }
})

// Optional: Allow exiting edit mode with Escape key
const taskKeyHandler = EditorView.domEventHandlers({
  keydown(e, view) {
    if (e.key !== 'Escape') return false
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    let lineNumber = line.number
    const editMode = view.state.field(editModeField)
    if (!editMode.has(lineNumber)) {
      // If cursor not on an edit line, fall back to last known edit line
      if (window.__taskLastEditLine && editMode.has(window.__taskLastEditLine)) {
        lineNumber = window.__taskLastEditLine
      } else {
        // Or pick any line from the editMode set
        try {
          const iter = editMode.values?.() || editMode[Symbol.iterator]?.()
          const first = iter && iter.next ? iter.next() : null
          if (first && !first.done) lineNumber = first.value
        } catch {}
        if (!editMode.has(lineNumber)) return false
      }
    }
    e.preventDefault()
    // Exit sticky edit mode explicitly on ESC
    try { window.__taskStickyEditLines.delete(lineNumber) } catch {}
    view.dispatch({ effects: toggleEditModeEffect.of(lineNumber) })
    return true
  }
})

// Fallback keymap to ensure ESC is handled even if DOM handler doesn't fire
function exitEditModeViaKeymap(view) {
  const editMode = view.state.field(editModeField)
  // Try current line
  const pos = view.state.selection.main.head
  let target = view.state.doc.lineAt(pos).number
  if (!editMode.has(target)) {
    if (window.__taskLastEditLine && editMode.has(window.__taskLastEditLine)) {
      target = window.__taskLastEditLine
    } else {
      try {
        const iter = editMode.values?.() || editMode[Symbol.iterator]?.()
        const first = iter && iter.next ? iter.next() : null
        if (first && !first.done) target = first.value
      } catch {}
      if (!editMode.has(target)) return false
    }
  }
  try { window.__taskStickyEditLines.delete(target) } catch {}
  view.dispatch({ effects: toggleEditModeEffect.of(target) })
  // After exiting via keymap, ensure UUID/comment
  setTimeout(() => ensureUuidForLine(view, target), 0)
  return true
}

// Export the complete extension configuration
export function taskExtensionConfig() {
  return [
    taskStateField,
    editModeField,
    taskExtension,
    taskClickHandler,
    taskKeyHandler,
    keymap.of([
      { key: 'Escape', run: exitEditModeViaKeymap }
    ])
  ]
}

// Helper: ensure UUID for a specific line and add inline comment if needed
async function ensureUuidForLine(view, lineNumber) {
  try {
    const filePath = view.state.field(window.currentFilePath) || window.tabManager?.activeTab?.filePath
    if (!filePath) return
    const line = view.state.doc.line(lineNumber)
    const lineContent = line.text
    const result = await invoke('ensure_task_uuid', {
      filePath: filePath,
      lineNumber: lineNumber,
      lineContent: lineContent
    })
    if (result && result.uuid) {
      // Update task state with UUID
      view.dispatch({ effects: updateTaskEffect.of({ lineNumber, taskInfo: { id: result.uuid } }) })
      // If it's a temporary new UUID, add the comment to the end of the line, preserving caret
      if (result.isNew && result.isTemporary) {
        const newText = `${lineContent} <!-- tid: ${result.uuid} -->`
        const head = view.state.selection.main.head
        const delta = newText.length - line.length
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newText },
          selection: { anchor: Math.max(0, head + delta) }
        })
      }
    }
  } catch (err) {
    console.warn('[Task] ensureUuidForLine failed', err)
  }
}
