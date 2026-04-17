import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { taskExtensionConfig, taskStateField } from './task-extension.js'

// Mock JSDOM environment for CodeMirror
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document

// Mock Tauri API
global.window.invoke = async () => {
  return '018f8a48-1234-5678-9abc-def012345678'
}

describe('Task Extension', () => {
  let container
  let view
  
  beforeEach(() => {
    // Create container for editor
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  
  afterEach(() => {
    // Clean up
    if (view) {
      view.destroy()
    }
    document.body.removeChild(container)
  })
  
  describe('Task Detection', () => {
    test('should detect todo tasks', () => {
      const doc = '- [ ] This is a todo task'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      // Check that task is detected
      const tasks = view.state.field(taskStateField)
      expect(tasks).toBeDefined()
      expect(tasks.size).toBe(1)
      
      const task = tasks.get(1)
      expect(task).toBeDefined()
      expect(task.status).toBe('todo')
      expect(task.text).toBe('This is a todo task')
    })
    
    test('should detect done tasks', () => {
      const doc = '- [x] This is a completed task'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.status).toBe('done')
    })
    
    test('should detect cancelled tasks', () => {
      const doc = '- [-] This is a cancelled task'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.status).toBe('cancelled')
    })
  })
  
  describe('Property Parsing', () => {
    test('should parse due date property', () => {
      const doc = '- [ ] Task with due date @due:2025-12-31'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.due).toBe('2025-12-31')
      expect(task.text).toBe('Task with due date')
    })

    test('should parse due date with space syntax', () => {
      const doc = '- [ ] Task with due date @due 2025-12-31'
      const state = EditorState.create({ doc, extensions: taskExtensionConfig() })
      view = new EditorView({ state, parent: container })
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.due).toBe('2025-12-31')
      expect(task.text).toBe('Task with due date')
    })

    test('should parse due date with parentheses syntax', () => {
      const doc = '- [ ] Task with due date @due(2025-12-31)'
      const state = EditorState.create({ doc, extensions: taskExtensionConfig() })
      view = new EditorView({ state, parent: container })
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.due).toBe('2025-12-31')
      expect(task.text).toBe('Task with due date')
    })

    test('should parse nested tags like #analysis/security and render a single chip', () => {
      const doc = '- [ ] Task with #analysis/security and #misc'
      const state = EditorState.create({ doc, extensions: taskExtensionConfig() })
      view = new EditorView({ state, parent: container })
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.tags).toEqual(['analysis/security', 'misc'])
      const chips = container.querySelectorAll('.cm-task-chip-tag')
      expect(chips.length).toBe(2)
      // Ensure no leftover '/security' plaintext remains
      const textContent = container.textContent || ''
      expect(textContent.includes('# analysis/security')).toBe(true)
      expect(textContent.includes(' /security')).toBe(false)
    })
    test('should replace !medium token fully without leftover text', () => {
      const doc = '- [ ] Priority test !medium and more text'
      const state = EditorState.create({ doc, extensions: taskExtensionConfig() })
      view = new EditorView({ state, parent: container })
      const textContent = container.textContent || ''
      // Should not leave trailing 'ium' in the rendered line
      expect(textContent.includes('ium')).toBe(false)
      // Should display a priority chip (look for chip class)
      const chip = container.querySelector('.cm-task-chip-priority')
      expect(chip).toBeTruthy()
    })

    test('due chip shows Today for local YYYY-MM-DD equal to today', () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-09-01T12:00:00Z'))
      const doc = '- [ ] Local date @due 2025-09-01'
      const state = EditorState.create({ doc, extensions: taskExtensionConfig() })
      view = new EditorView({ state, parent: container })
      const chip = container.querySelector('.cm-task-chip-due')
      expect(chip).toBeTruthy()
      expect(chip.textContent).toContain('Today')
      jest.useRealTimers()
    })
    
    test('should parse priority property', () => {
      const doc = '- [ ] High priority task !high'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.priority).toBe('high')
    })
    
    test('should parse tags', () => {
      const doc = '- [ ] Task with #work #urgent tags'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.tags).toEqual(['work', 'urgent'])
    })
    
    test('should parse project property', () => {
      const doc = '- [ ] Task in project @project:website-redesign'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.project).toBe('website-redesign')
    })
    
    test('should parse task ID from comment', () => {
      const doc = '- [ ] Task with ID <!-- tid: 123e4567-e89b-12d3-a456-426614174000 -->'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.id).toBe('123e4567-e89b-12d3-a456-426614174000')
    })
    
    test('should parse multiple properties', () => {
      const doc = '- [ ] Complex task @due:tomorrow !high #work @project:alpha'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.due).toBe('tomorrow')
      expect(task.priority).toBe('high')
      expect(task.tags).toEqual(['work'])
      expect(task.project).toBe('alpha')
      expect(task.text).toBe('Complex task')
    })
  })
  
  describe('Priority Normalization', () => {
    test('should normalize p1 to high', () => {
      const doc = '- [ ] Task !p1'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.priority).toBe('high')
    })
    
    test('should normalize p3 to med', () => {
      const doc = '- [ ] Task !p3'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.priority).toBe('med')
    })
    
    test('should normalize p5 to low', () => {
      const doc = '- [ ] Task !p5'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      const task = tasks.get(1)
      expect(task.priority).toBe('low')
    })
  })
  
  describe('Multiple Tasks', () => {
    test('should detect multiple tasks in document', () => {
      const doc = `- [ ] First task
- [x] Second task done
- [-] Third task cancelled
Regular text here
- [ ] Fourth task`
      
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({
        state,
        parent: container
      })
      
      const tasks = view.state.field(taskStateField)
      expect(tasks.size).toBe(4)
      
      // Check each task
      expect(tasks.get(1).status).toBe('todo')
      expect(tasks.get(2).status).toBe('done')
      expect(tasks.get(3).status).toBe('cancelled')
      expect(tasks.get(5).status).toBe('todo')
    })
  })

  describe('Edit Toggle Interaction', () => {
    test('should toggle edit mode when mousing down on a task line', () => {
      const doc = '- [ ] Click to edit toggle test'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({ state, parent: container })

      const clickable = container.querySelector('.cm-task-clickable')
      expect(clickable).toBeTruthy()

      // Dispatch mousedown on the clickable span (dataset-driven path)
      const evt = new window.MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 })
      clickable.dispatchEvent(evt)

      // Should render edit mode decoration
      const editEl = container.querySelector('[data-edit-mode="true"]')
      expect(editEl).toBeTruthy()
    })

    test('should not toggle edit mode when mousing down on checkbox', () => {
      const doc = '- [ ] Do not toggle when clicking checkbox'
      const state = EditorState.create({
        doc,
        extensions: taskExtensionConfig()
      })
      view = new EditorView({ state, parent: container })

      const checkbox = container.querySelector('.cm-task-checkbox')
      expect(checkbox).toBeTruthy()

      // Mousedown on checkbox should be stopped by widget
      const evt = new window.MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 })
      checkbox.dispatchEvent(evt)

      const editEl = container.querySelector('[data-edit-mode="true"]')
      expect(editEl).toBeFalsy()
    })
  })
})
