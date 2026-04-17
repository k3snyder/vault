export function normalizeImageLocation(imageLocation) {
  const normalized = (imageLocation || '').trim().replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  if (!segments.length) {
    return 'Files/'
  }

  if (segments[0].toLowerCase() === 'files') {
    segments[0] = 'Files'
  }

  return `${segments.join('/')}/`
}

export function normalizeImageEmbedPath(filePath) {
  const normalized = (filePath || '').trim().replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  if (!segments.length) {
    return normalized
  }

  while (
    segments.length > 1 &&
    segments[0].toLowerCase() === 'files' &&
    segments[1].toLowerCase() === 'files'
  ) {
    segments.shift()
  }

  if (segments[0].toLowerCase() === 'files') {
    segments[0] = 'Files'
  }

  return segments.join('/')
}

export function resolveImageEmbedPath(filePath, imageLocation = 'Files/') {
  const normalizedPath = normalizeImageEmbedPath(filePath)

  if (!normalizedPath) {
    return normalizedPath
  }

  if (/^[a-z]+:\/\//i.test(normalizedPath)) {
    return normalizedPath
  }

  if (normalizedPath.includes('/')) {
    return normalizedPath
  }

  return `${normalizeImageLocation(imageLocation)}${normalizedPath}`
}
