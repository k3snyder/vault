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
})
