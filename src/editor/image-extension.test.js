import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'

import { imageEmbedPlugin } from './image-extension.js'

describe('image-extension resize behavior', () => {
  let container
  let view

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)

    window.imageSaveLocation = 'Files/'

    invoke.mockReset()
    invoke.mockResolvedValue('data:image/png;base64,AAAA')
  })

  afterEach(() => {
    if (view) {
      view.destroy()
      view = null
    }

    delete window.imageSaveLocation
    container.remove()
  })

  test('dragging the resize handle persists width in local image embed syntax', async () => {
    const state = EditorState.create({
      doc: 'intro\n![[Files/test-image.png]]',
      selection: { anchor: 0 },
      extensions: [imageEmbedPlugin]
    })

    view = new EditorView({
      state,
      parent: container
    })

    await Promise.resolve()
    await Promise.resolve()

    const image = container.querySelector('.cm-local-image-widget img')
    const resizeHandle = container.querySelector('.cm-local-image-resize-handle')

    expect(image).toBeTruthy()
    expect(resizeHandle).toBeTruthy()

    Object.defineProperty(image, 'naturalWidth', {
      value: 320,
      configurable: true
    })

    image.getBoundingClientRect = () => ({
      width: 320,
      height: 200,
      top: 0,
      left: 0,
      right: 320,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() { return {} }
    })

    resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }))
    image.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 220 }))
    image.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 220 }))

    expect(view.state.doc.toString()).toBe('intro\n![[Files/test-image.png|440]]')
  })
})
