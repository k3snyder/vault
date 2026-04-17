import { describe, it, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../pdf-viewer.css', import.meta.url), 'utf8')

describe('pdf-viewer.css', () => {
  it('keeps markedContent wrappers visible for tagged PDFs', () => {
    expect(css).toMatch(/\.textLayer\s+\.markedContent\s*\{[\s\S]*display:\s*contents;/)
    expect(css).not.toMatch(/\.textLayer\s+\.endOfContent,\s*\.textLayer\s+\.markedContent\s*\{[\s\S]*display:\s*none/i)
  })

  it('preserves the PDF.js end-of-content sentinel for text dragging', () => {
    expect(css).toMatch(/\.textLayer\s+\.endOfContent\s*\{[\s\S]*display:\s*block;/)
    expect(css).toMatch(/\.textLayer\.selecting\s+\.endOfContent\s*\{[\s\S]*top:\s*0;/)
  })
})
