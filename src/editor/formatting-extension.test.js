/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { blockWidgetExtension, inlineFormattingExtension, inlineFormattingStyles } from './formatting-extension.js'

describe('formatting-extension code block widgets', () => {
  let pane
  let container
  let view

  beforeEach(() => {
    localStorage.clear()

    pane = document.createElement('div')
    container = document.createElement('div')
    pane.appendChild(container)
    document.body.appendChild(pane)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue() },
      configurable: true
    })
  })

  afterEach(() => {
    if (view) {
      view.destroy()
      view = null
    }

    pane.remove()
  })

  test('stops mouse events from bubbling out of rendered code blocks', () => {
    const doc = '```sh\necho hello\n```'
    const state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const codeBlock = container.querySelector('.cm-code-block-formatted')
    expect(codeBlock).toBeTruthy()

    const bubbleSpy = jest.fn()
    pane.addEventListener('mousedown', bubbleSpy)
    pane.addEventListener('mouseup', bubbleSpy)
    pane.addEventListener('click', bubbleSpy)

    codeBlock.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    codeBlock.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    codeBlock.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(bubbleSpy).not.toHaveBeenCalled()
  })

  test('does not rebuild rendered code blocks on pure selection changes', () => {
    const doc = '```js\nconst value = 1\n```'
    const state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const initialCodeBlock = container.querySelector('.cm-code-block-formatted')
    expect(initialCodeBlock).toBeTruthy()

    view.dispatch({
      selection: { anchor: doc.length, head: doc.length }
    })

    const nextCodeBlock = container.querySelector('.cm-code-block-formatted')
    expect(nextCodeBlock).toBe(initialCodeBlock)
  })

  test('renders markdown links inside table widgets instead of showing raw link syntax', () => {
    const doc = [
      '| Situation | Path |',
      '| --- | --- |',
      '| App archived locally | [Path A](#path-a-local-signing-switch) |'
    ].join('\n')

    const state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const table = container.querySelector('.cm-table-formatted')
    const link = table?.querySelector('a')

    expect(table).toBeTruthy()
    expect(link).toBeTruthy()
    expect(link?.textContent).toBe('Path A')
    expect(link?.getAttribute('href')).toBe('#path-a-local-signing-switch')
    expect(table?.textContent).not.toContain('[Path A]')
  })

  test('adds draggable column resize handles to rendered table widgets', () => {
    const doc = [
      '| Service | Live Port | Notes |',
      '| --- | --- | --- |',
      '| Dashboard | 7100 | Primary web UI |'
    ].join('\n')

    const state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const table = container.querySelector('.cm-table-formatted')
    const handles = table?.querySelectorAll('.cm-table-column-resize-handle')

    expect(table).toBeTruthy()
    expect(handles).toHaveLength(3)
    expect(handles?.[0].getAttribute('role')).toBe('separator')
    expect(handles?.[0].getAttribute('aria-orientation')).toBe('vertical')
  })

  test('resizes and selects a table column when dragging its resize handle', () => {
    const doc = [
      '| Service | Live Port | Notes |',
      '| --- | --- | --- |',
      '| Dashboard | 7100 | Primary web UI |'
    ].join('\n')

    const state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const table = container.querySelector('.cm-table-formatted')
    const firstHeader = table.querySelector('th[data-column-index="0"]')
    const handle = firstHeader.querySelector('.cm-table-column-resize-handle')
    const col = table.querySelector('col[data-column-index="0"]')

    Object.defineProperty(firstHeader, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120 })
    })

    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      button: 0
    }))

    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: 150
    }))

    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: 150
    }))

    expect(col.style.width).toBe('170px')
    expect(table.style.getPropertyValue('width')).toBe('266px')
    expect(firstHeader.classList.contains('cm-table-column-selected')).toBe(true)
    expect(table.querySelector('td[data-column-index="0"]').classList.contains('cm-table-column-selected')).toBe(true)
  })

  test('clears temporary table column highlight after clicking away', () => {
    const doc = [
      '| Service | Live Port | Notes |',
      '| --- | --- | --- |',
      '| Dashboard | 7100 | Primary web UI |'
    ].join('\n')
    const outsideTarget = document.createElement('button')
    document.body.appendChild(outsideTarget)

    const state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const table = container.querySelector('.cm-table-formatted')
    const firstHeader = table.querySelector('th[data-column-index="0"]')
    const handle = firstHeader.querySelector('.cm-table-column-resize-handle')

    Object.defineProperty(firstHeader, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120 })
    })

    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      button: 0
    }))
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: 100
    }))

    expect(firstHeader.classList.contains('cm-table-column-selected')).toBe(true)

    outsideTarget.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0
    }))

    expect(table.querySelector('.cm-table-column-selected')).toBeNull()
    outsideTarget.remove()
  })

  test('persists resized table column widths across editor reloads', () => {
    const doc = [
      '| Persistent | Width | Notes |',
      '| --- | --- | --- |',
      '| Dashboard | 7100 | Primary web UI |'
    ].join('\n')

    let state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })

    view = new EditorView({
      state,
      parent: container
    })

    let table = container.querySelector('.cm-table-formatted')
    const firstHeader = table.querySelector('th[data-column-index="0"]')
    const handle = firstHeader.querySelector('.cm-table-column-resize-handle')

    Object.defineProperty(firstHeader, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120 })
    })

    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      button: 0
    }))
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: 145
    }))
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: 145
    }))

    expect(JSON.parse(localStorage.getItem('vault-table-column-widths-v1'))).toBeTruthy()

    view.destroy()
    container.textContent = ''

    state = EditorState.create({
      doc,
      extensions: [blockWidgetExtension]
    })
    view = new EditorView({
      state,
      parent: container
    })

    table = container.querySelector('.cm-table-formatted')
    expect(table.querySelector('col[data-column-index="0"]').style.width).toBe('165px')
    expect(table.style.getPropertyValue('width')).toBe('261px')
  })
})

describe('formatting-extension heading inline formatting', () => {
  let container
  let view

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (view) {
      view.destroy()
      view = null
    }

    container.remove()
  })

  test('formats bold markdown inside headings instead of leaving raw ** markers visible', () => {
    const doc = '# **Important Heading**'
    const state = EditorState.create({
      doc,
      extensions: [inlineFormattingExtension, inlineFormattingStyles]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const headingEl = container.querySelector('.cm-heading-1-formatted')
    const boldEl = container.querySelector('.cm-strong-formatted')

    expect(headingEl).toBeTruthy()
    expect(boldEl).toBeTruthy()
    expect(container.textContent).toContain('Important Heading')
    expect(container.textContent).not.toContain('**')
    expect(boldEl.textContent).toBe('Important Heading')
  })

  test('formats inline code spans with the code color class and hides backticks', () => {
    const doc = 'Use `Slipbox/RAW/` as the raw source folder.'
    const state = EditorState.create({
      doc,
      extensions: [inlineFormattingExtension, inlineFormattingStyles]
    })

    view = new EditorView({
      state,
      parent: container
    })

    const codeEl = container.querySelector('.cm-code-formatted')

    expect(codeEl).toBeTruthy()
    expect(codeEl.textContent).toBe('Slipbox/RAW/')
    expect(container.textContent).not.toContain('`')
  })
})
