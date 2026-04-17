import { describe, expect, it } from '@jest/globals'

import {
  normalizeImageEmbedPath,
  normalizeImageLocation,
  resolveImageEmbedPath
} from './image-paths.js'

describe('image-paths', () => {
  it('normalizes the default image location casing and trailing slash', () => {
    expect(normalizeImageLocation('files')).toBe('Files/')
    expect(normalizeImageLocation('Files')).toBe('Files/')
    expect(normalizeImageLocation('files/subdir')).toBe('Files/subdir/')
  })

  it('preserves custom image locations while normalizing separators', () => {
    expect(normalizeImageLocation('Assets\\Screens')).toBe('Assets/Screens/')
  })

  it('normalizes embedded image paths for the default Files folder', () => {
    expect(normalizeImageEmbedPath('files/Pasted image.png')).toBe('Files/Pasted image.png')
    expect(normalizeImageEmbedPath('Files/files/Pasted image.png')).toBe('Files/Pasted image.png')
  })

  it('resolves bare filenames against the configured image location', () => {
    expect(resolveImageEmbedPath('Pasted image.png', 'files')).toBe('Files/Pasted image.png')
    expect(resolveImageEmbedPath('Pasted image.png', 'Assets/Screens')).toBe('Assets/Screens/Pasted image.png')
  })

  it('keeps explicit vault-relative image paths intact', () => {
    expect(resolveImageEmbedPath('Admin Operations/diagram.png', 'Files/')).toBe('Admin Operations/diagram.png')
  })
})
