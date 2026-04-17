import { describe, expect, it } from '@jest/globals'

import { getClipboardPath, isAbsolutePath } from './context-menu-paths.js'

describe('context-menu-paths', () => {
  it('detects absolute unix and windows paths', () => {
    expect(isAbsolutePath('/vault/Prompt.md')).toBe(true)
    expect(isAbsolutePath('C:\\Vault\\Prompt.md')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\Prompt.md')).toBe(true)
    expect(isAbsolutePath('Prompts/Prompt.md')).toBe(false)
  })

  it('returns the relative path unchanged by default', () => {
    expect(getClipboardPath('Prompts/Prompt.md', '/vault')).toBe('Prompts/Prompt.md')
  })

  it('builds a full unix path from vault and relative path', () => {
    expect(getClipboardPath('Prompts/Prompt.md', '/vault/root', 'full')).toBe('/vault/root/Prompts/Prompt.md')
  })

  it('builds a full windows path and normalizes separators', () => {
    expect(getClipboardPath('Prompts/Sub/Prompt.md', 'C:\\Vault', 'full')).toBe('C:\\Vault\\Prompts\\Sub\\Prompt.md')
  })

  it('keeps absolute targets unchanged when copying the full path', () => {
    expect(getClipboardPath('/vault/root/Prompt.md', '/vault/root', 'full')).toBe('/vault/root/Prompt.md')
  })

  it('falls back to the target path when no vault path is available', () => {
    expect(getClipboardPath('Prompts/Prompt.md', '', 'full')).toBe('Prompts/Prompt.md')
  })
})
