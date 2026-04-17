import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import {
  buildImageEmbedMarkup,
  clampImageEmbedWidth,
  parseImageEmbedInnerContent
} from '../utils/image-embed-syntax.js'
import { resolveImageEmbedPath } from '../utils/image-paths.js'

// Widget for rendering images
class ImageWidget extends WidgetType {
  constructor(url) {
    super()
    this.url = url
  }

  eq(other) {
    return other.url === this.url
  }

  toDOM() {
    const wrapper = document.createElement('div')
    wrapper.style.display = 'block'
    wrapper.style.margin = '8px 0'
    
    const img = document.createElement('img')
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    img.style.display = 'block'
    img.style.borderRadius = '4px'
    img.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)'
    
    // Show loading state
    wrapper.innerHTML = `
      <div style="
        padding: 24px;
        background: var(--bg-secondary, #fbfbfa);
        border: 1px solid var(--border-color, #e9e9e7);
        border-radius: 4px;
        text-align: center;
        color: var(--text-secondary, #6b6b6b);
        font-size: 13px;
        font-family: 'Inter', sans-serif;
      ">
        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
        <div>Loading image...</div>
      </div>
    `
    
    // Use Tauri to fetch the image, bypassing CORS
    invoke('fetch_image_as_base64', { url: this.url })
      .then(base64Data => {
        img.src = base64Data
        wrapper.innerHTML = ''
        wrapper.appendChild(img)
      })
      .catch(error => {
        console.error('Failed to fetch image:', error)
        wrapper.innerHTML = `
          <div style="
            padding: 16px;
            background: var(--bg-tertiary, #f1f1ef);
            border: 1px solid var(--border-color, #e9e9e7);
            border-radius: 4px;
            text-align: center;
            color: var(--text-secondary, #6b6b6b);
            font-size: 13px;
            font-family: 'Inter', sans-serif;
          ">
            <div style="font-size: 24px; margin-bottom: 8px;">🖼️</div>
            <div style="margin-bottom: 4px;">Failed to load image</div>
            <div style="font-size: 11px; opacity: 0.8;">
              ${this.url.length > 50 ? this.url.substring(0, 50) + '...' : this.url}
            </div>
            <div style="font-size: 11px; opacity: 0.6; margin-top: 8px;">
              ${error.toString()}
            </div>
          </div>
        `
      })
    
    return wrapper
  }
}

// Widget for rendering local images from the files folder
class LocalImageWidget extends WidgetType {
  constructor({ filename, width = null, view = null, from = null, to = null }) {
    super()
    this.filename = filename
    this.width = width
    this.view = view
    this.from = from
    this.to = to
    
    // Check if this is likely an image file
    const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i
    this.isLikelyImage = imageExtensions.test(filename)
  }

  eq(other) {
    return (
      other.filename === this.filename &&
      other.width === this.width &&
      other.from === this.from &&
      other.to === this.to
    )
  }

  ignoreEvent(event) {
    if (!event) {
      return false
    }

    return ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick'].includes(event.type)
  }

  toDOM() {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-local-image-wrapper'
    wrapper.style.display = 'block'
    wrapper.style.margin = '8px 0'
    wrapper.style.maxWidth = '100%'
    wrapper.setAttribute('tabindex', '-1')
    
    const img = document.createElement('img')
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    img.style.display = 'block'
    img.style.borderRadius = '4px'
    img.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)'
    img.draggable = false
    
    // Show loading state
    wrapper.innerHTML = `
      <div style="
        padding: 24px;
        background: var(--bg-secondary, #fbfbfa);
        border: 1px solid var(--border-color, #e9e9e7);
        border-radius: 4px;
        text-align: center;
        color: var(--text-secondary, #6b6b6b);
        font-size: 13px;
        font-family: 'Inter', sans-serif;
      ">
        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
        <div>Loading image...</div>
      </div>
    `
    
    // Only try to load as image if it has an image extension
    if (!this.isLikelyImage) {
      // Not an image file, show appropriate message
      wrapper.innerHTML = `
        <div style="
          padding: 16px;
          background: var(--bg-tertiary, #f1f1ef);
          border: 1px solid var(--border-color, #e9e9e7);
          border-radius: 4px;
          text-align: center;
          color: var(--text-secondary, #6b6b6b);
          font-size: 13px;
          font-family: 'Inter', sans-serif;
        ">
          <div style="font-size: 24px; margin-bottom: 8px;">📄</div>
          <div style="margin-bottom: 4px;">Cannot embed non-image file</div>
          <div style="font-size: 11px; opacity: 0.8;">
            ${this.filename}
          </div>
          <div style="font-size: 11px; opacity: 0.6; margin-top: 8px;">
            Use [[${this.filename}]] for note links instead
          </div>
        </div>
      `
      return wrapper
    }
    
    // Respect explicit vault-relative paths and only fall back to the configured
    // image location for bare filenames.
    const imagePath = resolveImageEmbedPath(this.filename, window.imageSaveLocation || 'Files/')
    
    invoke('read_image_as_base64', { filePath: imagePath })
      .then(base64Data => {
        img.src = base64Data
        wrapper.innerHTML = ''
        wrapper.appendChild(this.createResizableImageFrame(wrapper, img))
      })
      .catch(error => {
        console.error('Failed to load local image:', error)
        wrapper.innerHTML = `
          <div style="
            padding: 16px;
            background: var(--bg-tertiary, #f1f1ef);
            border: 1px solid var(--border-color, #e9e9e7);
            border-radius: 4px;
            text-align: center;
            color: var(--text-secondary, #6b6b6b);
            font-size: 13px;
            font-family: 'Inter', sans-serif;
          ">
            <div style="font-size: 24px; margin-bottom: 8px;">🖼️</div>
            <div style="margin-bottom: 4px;">Failed to load image</div>
            <div style="font-size: 11px; opacity: 0.8;">
              ${this.filename}
            </div>
            <div style="font-size: 11px; opacity: 0.6; margin-top: 8px;">
              ${error.toString()}
            </div>
          </div>
        `
      })
    
    return wrapper
  }

  createResizableImageFrame(wrapper, img) {
    const frame = document.createElement('div')
    frame.className = 'cm-local-image-widget'
    frame.style.position = 'relative'
    frame.style.display = 'inline-block'
    frame.style.maxWidth = '100%'
    frame.style.lineHeight = '0'

    if (this.width) {
      img.style.width = `${this.width}px`
    }

    const stopEditorFocus = (event) => {
      event.stopPropagation()
      wrapper.focus()
    }

    frame.addEventListener('mousedown', stopEditorFocus)
    frame.addEventListener('mouseup', (event) => event.stopPropagation())
    frame.addEventListener('click', (event) => event.stopPropagation())

    const resizeHandle = document.createElement('button')
    resizeHandle.className = 'cm-local-image-resize-handle'
    resizeHandle.type = 'button'
    resizeHandle.setAttribute('aria-label', 'Resize embedded image')
    resizeHandle.title = 'Drag to resize image'
    resizeHandle.style.position = 'absolute'
    resizeHandle.style.right = '8px'
    resizeHandle.style.bottom = '8px'
    resizeHandle.style.width = '14px'
    resizeHandle.style.height = '14px'
    resizeHandle.style.border = 'none'
    resizeHandle.style.borderRadius = '999px'
    resizeHandle.style.background = 'rgba(23, 23, 23, 0.72)'
    resizeHandle.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.24)'
    resizeHandle.style.cursor = 'ew-resize'
    resizeHandle.style.opacity = '0.78'
    resizeHandle.style.zIndex = '1'

    frame.addEventListener('mouseenter', () => {
      resizeHandle.style.opacity = '1'
    })
    frame.addEventListener('mouseleave', () => {
      resizeHandle.style.opacity = '0.78'
    })

    resizeHandle.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.startResize(event, img)
    })

    frame.appendChild(img)
    frame.appendChild(resizeHandle)
    return frame
  }

  startResize(event, img) {
    if (!this.view || this.from === null || this.to === null) {
      return
    }

    const startX = event.clientX
    const startWidth = this.getRenderedWidth(img)
    let nextWidth = startWidth

    const previousBodyCursor = document.body.style.cursor
    const previousBodyUserSelect = document.body.style.userSelect

    const applyWidth = (width) => {
      img.style.width = `${width}px`
    }

    const stopResize = () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('blur', onWindowBlur)
      document.body.style.cursor = previousBodyCursor
      document.body.style.userSelect = previousBodyUserSelect
    }

    const onMouseMove = (moveEvent) => {
      moveEvent.preventDefault()
      moveEvent.stopPropagation()

      nextWidth = clampImageEmbedWidth(startWidth + (moveEvent.clientX - startX)) || startWidth
      applyWidth(nextWidth)
    }

    const onMouseUp = (upEvent) => {
      upEvent.preventDefault()
      upEvent.stopPropagation()
      stopResize()
      this.persistWidth(nextWidth)
    }

    const onWindowBlur = () => {
      stopResize()
      this.persistWidth(nextWidth)
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('blur', onWindowBlur)
  }

  getRenderedWidth(img) {
    const explicitWidth = Number.parseInt(img.style.width, 10)
    if (Number.isFinite(explicitWidth)) {
      return explicitWidth
    }

    const boundsWidth = Math.round(img.getBoundingClientRect().width)
    if (boundsWidth > 0) {
      return boundsWidth
    }

    if (img.naturalWidth > 0) {
      return img.naturalWidth
    }

    return this.width || 480
  }

  persistWidth(width) {
    const nextMarkup = buildImageEmbedMarkup(this.filename, width)
    const currentMarkup = this.view.state.doc.sliceString(this.from, this.to)

    if (nextMarkup === currentMarkup) {
      return
    }

    this.view.dispatch({
      changes: {
        from: this.from,
        to: this.to,
        insert: nextMarkup
      }
    })
  }
}

// Create decorations for image embeds
function createImageDecorations(view) {
  const decorations = []
  const doc = view.state.doc
  const text = doc.toString()
  
  // Regex for markdown image syntax: ![](URL) or ![alt text](URL)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  
  // Regex syntax: ![[filename]] - matches any file, including those without extensions
  // This handles both image files and note references with embedded images
  const syntaxImageRegex = /!\[\[([^\]]+)\]\]/gi
  
  let match
  // Handle standard markdown images
  while ((match = imageRegex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const altText = match[1]
    const url = match[2]
    
    // Get the current line
    const line = doc.lineAt(from)
    const cursor = view.state.selection.main.head
    const isLineActive = cursor >= line.from && cursor <= line.to
    
    if (!isLineActive) {
      // Replace the markdown syntax with the image widget
      decorations.push(
        Decoration.replace({
          widget: new ImageWidget(url),
          inclusive: false
        }).range(from, to)
      )
    }
  }
  
  // Handle syntax-style images
  while ((match = syntaxImageRegex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const parsedEmbed = parseImageEmbedInnerContent(match[1])
    const filename = parsedEmbed.path || match[1]
    
    // Get the current line
    const line = doc.lineAt(from)
    const cursor = view.state.selection.main.head
    const isLineActive = cursor >= line.from && cursor <= line.to
    
    if (!isLineActive) {
      // For syntax, we need a special widget that loads local files
      decorations.push(
        Decoration.replace({
          widget: new LocalImageWidget({
            filename,
            width: parsedEmbed.width,
            view,
            from,
            to
          }),
          inclusive: false
        }).range(from, to)
      )
    }
  }
  
  return Decoration.set(decorations, true)
}

// View plugin to manage image decorations
export const imageEmbedPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = createImageDecorations(view)
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = createImageDecorations(update.view)
      }
    }
  },
  {
    decorations: v => v.decorations
  }
)
