const IMAGE_EMBED_EXTENSION_REGEX = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i
const EMBED_MARKUP_REGEX = /^!\[\[([^\]]+)\]\]$/
const IMAGE_EMBED_WIDTH_REGEX = /\|(\d+)(?:x(\d+))?$/
const MIN_IMAGE_EMBED_WIDTH = 120
const MAX_IMAGE_EMBED_WIDTH = 4096

export function isImageEmbedPath(path) {
  return IMAGE_EMBED_EXTENSION_REGEX.test((path || '').trim())
}

export function clampImageEmbedWidth(width) {
  if (width === null || width === undefined || width === '') {
    return null
  }

  const numericWidth = Number(width)

  if (!Number.isFinite(numericWidth)) {
    return null
  }

  return Math.min(
    MAX_IMAGE_EMBED_WIDTH,
    Math.max(MIN_IMAGE_EMBED_WIDTH, Math.round(numericWidth))
  )
}

export function parseImageEmbedInnerContent(innerContent) {
  const normalized = `${innerContent || ''}`.trim()

  if (!normalized) {
    return {
      path: '',
      width: null,
      isImage: false
    }
  }

  const widthMatch = normalized.match(IMAGE_EMBED_WIDTH_REGEX)
  if (widthMatch) {
    const candidatePath = normalized.slice(0, widthMatch.index).trim()

    if (isImageEmbedPath(candidatePath)) {
      return {
        path: candidatePath,
        width: clampImageEmbedWidth(widthMatch[1]),
        isImage: true
      }
    }
  }

  return {
    path: normalized,
    width: null,
    isImage: isImageEmbedPath(normalized)
  }
}

export function parseImageEmbedMarkup(markup) {
  const match = `${markup || ''}`.trim().match(EMBED_MARKUP_REGEX)

  if (!match) {
    return null
  }

  return {
    markup: match[0],
    innerContent: match[1],
    ...parseImageEmbedInnerContent(match[1])
  }
}

export function buildImageEmbedMarkup(path, width = null) {
  const normalizedPath = `${path || ''}`.trim()
  const normalizedWidth = clampImageEmbedWidth(width)

  if (!normalizedWidth) {
    return `![[${normalizedPath}]]`
  }

  return `![[${normalizedPath}|${normalizedWidth}]]`
}
