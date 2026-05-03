/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from '@jest/globals'

import {
  applyThemeOverrides,
  normalizeHexColor,
  normalizeThemeOverrides
} from './theme-overrides.js'

describe('theme override utilities', () => {
  test('normalizes missing palettes to safe defaults', () => {
    const overrides = normalizeThemeOverrides({ enabled: true })

    expect(overrides.enabled).toBe(true)
    expect(overrides.dark.background).toBe('#12110F')
    expect(overrides.dark.accent).toBe('#7FA6D6')
    expect(overrides.light.background).toBe('#ffffff')
  })

  test('normalizes short and invalid hex colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC')
    expect(normalizeHexColor('not-a-color', '#123456')).toBe('#123456')
  })

  test('applies enabled overrides to semantic and editor variables', () => {
    const root = document.documentElement

    applyThemeOverrides('dark', {
      enabled: true,
      dark: {
        background: '#101010',
        surface: '#181818',
        control: '#202020',
        editor: '#141414',
        text: '#eeeeee',
        mutedText: '#999999',
        accent: '#88aadd',
        activeLine: '#1c1c1c'
      }
    }, root)

    expect(root.style.getPropertyValue('--bg-primary')).toBe('#101010')
    expect(root.style.getPropertyValue('--editor-bg-color')).toBe('#141414')
    expect(root.style.getPropertyValue('--editor-text-color')).toBe('#EEEEEE')
    expect(root.style.getPropertyValue('--accent-primary')).toBe('#88AADD')
    expect(root.style.getPropertyValue('--editor-active-line-bg')).toBe('#1C1C1C')
    expect(root.style.getPropertyValue('--accent-bg')).toBe('rgba(136, 170, 221, 0.1)')
  })
})
