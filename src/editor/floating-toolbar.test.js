import { describe, expect, test } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { getActiveToolbarButtons, toggleMark } from './floating-toolbar.js'

function createViewLike(doc, from, to = from) {
  return {
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [markdown({ base: markdownLanguage })]
    })
  }
}

function createMutableView(doc, from, to = from) {
  return {
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [markdown({ base: markdownLanguage })]
    }),
    dispatch(spec) {
      this.state = this.state.update(spec).state
    },
    focus() {}
  }
}

describe('floating-toolbar active states', () => {
  test('detects heading and bold formatting for bold H1 selections', () => {
    const doc = '# **switch apple developer account**'
    const from = doc.indexOf('switch')
    const to = from + 'switch apple developer account'.length
    const active = getActiveToolbarButtons(createViewLike(doc, from, to))

    expect(active.has('h1')).toBe(true)
    expect(active.has('bold')).toBe(true)
  })

  test('detects heading and bold formatting when the full heading line is selected', () => {
    const doc = '# **switch apple developer account**'
    const active = getActiveToolbarButtons(createViewLike(doc, 0, doc.length))

    expect(active.has('h1')).toBe(true)
    expect(active.has('bold')).toBe(true)
  })

  test('detects task list formatting from line prefixes', () => {
    const doc = '- [x] Completed migration task'
    const active = getActiveToolbarButtons(createViewLike(doc, 0, doc.length))

    expect(active.has('task')).toBe(true)
    expect(active.has('bullet')).toBe(false)
  })

  test('detects link from syntax nodes and highlight from marker fallback', () => {
    const doc = 'Read ==[this guide](https://example.com)== carefully'
    const from = doc.indexOf('this')
    const to = from + 'this guide'.length
    const active = getActiveToolbarButtons(createViewLike(doc, from, to))

    expect(active.has('highlight')).toBe(true)
    expect(active.has('link')).toBe(true)
  })

  test('removes bold markers from a selected heading line instead of wrapping the line', () => {
    const doc = '## **Scenario Assessment**'
    const view = createMutableView(doc, 0, doc.length)

    toggleMark(view, '**')

    expect(view.state.doc.toString()).toBe('## Scenario Assessment')
  })

  test('adds bold markers inside a selected heading line instead of wrapping the prefix', () => {
    const doc = '## Scenario Assessment'
    const view = createMutableView(doc, 0, doc.length)

    toggleMark(view, '**')

    expect(view.state.doc.toString()).toBe('## **Scenario Assessment**')
  })
})
