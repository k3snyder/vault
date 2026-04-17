import { describe, expect, it } from '@jest/globals'

import {
  buildImageEmbedMarkup,
  clampImageEmbedWidth,
  parseImageEmbedInnerContent,
  parseImageEmbedMarkup
} from './image-embed-syntax.js'

describe('image-embed-syntax', () => {
  it('parses width suffixes from image embeds', () => {
    expect(parseImageEmbedInnerContent('Files/diagram.png|640')).toEqual({
      path: 'Files/diagram.png',
      width: 640,
      isImage: true
    })
  })

  it('accepts width x height suffixes and uses the width for rendering', () => {
    expect(parseImageEmbedMarkup('![[Files/diagram.png|640x320]]')).toEqual({
      markup: '![[Files/diagram.png|640x320]]',
      innerContent: 'Files/diagram.png|640x320',
      path: 'Files/diagram.png',
      width: 640,
      isImage: true
    })
  })

  it('does not treat note aliases as image widths', () => {
    expect(parseImageEmbedInnerContent('Project Note|Overview')).toEqual({
      path: 'Project Note|Overview',
      width: null,
      isImage: false
    })
  })

  it('builds resized image embed markup', () => {
    expect(buildImageEmbedMarkup('Files/diagram.png', 512)).toBe('![[Files/diagram.png|512]]')
    expect(buildImageEmbedMarkup('Files/diagram.png')).toBe('![[Files/diagram.png]]')
  })

  it('clamps image widths into a sane range', () => {
    expect(clampImageEmbedWidth(40)).toBe(120)
    expect(clampImageEmbedWidth(8192)).toBe(4096)
    expect(clampImageEmbedWidth('bad')).toBeNull()
  })
})
