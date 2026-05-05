/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const invoke = jest.fn()
const setBackgroundColor = jest.fn()
const setTheme = jest.fn()

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke
}))

jest.unstable_mockModule('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setBackgroundColor,
    setTheme
  })
}))

let ThemeManager

beforeEach(async () => {
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  invoke.mockResolvedValue(undefined)
  invoke.mockClear()
  setBackgroundColor.mockResolvedValue(undefined)
  setBackgroundColor.mockClear()
  setTheme.mockResolvedValue(undefined)
  setTheme.mockClear()

  if (!ThemeManager) {
    ;({ ThemeManager } = await import('./theme-manager.js'))
  }
})

describe('ThemeManager', () => {
  test('previews font size without an active editor', () => {
    const manager = new ThemeManager(null)

    expect(() => manager.setFontSize(18)).not.toThrow()

    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')
    expect(invoke).toHaveBeenCalledWith('save_editor_preference', {
      key: 'font_size',
      value: '18'
    })
  })

  test('updates native window theme when applying dark theme', async () => {
    const manager = new ThemeManager(null)

    manager.applyTheme('dark')
    await Promise.resolve()

    expect(setBackgroundColor).toHaveBeenCalledWith('#12110F')
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  test('keeps inline markdown code color distinct from markdown link color', () => {
    const manager = new ThemeManager(null)

    manager.applyTheme('dark', {
      enabled: true,
      dark: {
        accent: '#88aadd'
      }
    })

    expect(document.documentElement.style.getPropertyValue('--md-link-color')).toBe('#88AADD')
    expect(document.documentElement.style.getPropertyValue('--md-code-color')).toBe('#03bbbb')
  })
})
