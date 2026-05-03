/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals'

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: jest.fn()
}))

let UserSettingsPanel
let invoke

function makeVaultSettings(wysiwygMode = true) {
  return {
    vault_path: '/vault',
    editor: {
      font_size: 16,
      font_family: "'SF Mono', Monaco, 'Cascadia Code', monospace",
      font_color: '#1f2937',
      theme: 'default',
      line_numbers: false,
      line_wrapping: true,
      show_status_bar: true,
      wysiwyg_mode: wysiwygMode,
      theme_overrides: {
        enabled: false,
        light: {},
        dark: {}
      }
    },
    files: {
      image_location: 'Files/',
      image_naming_pattern: 'Pasted image {timestamp}',
      daily_notes_folder: 'Daily Notes'
    }
  }
}

beforeAll(async () => {
  ({ invoke } = await import('@tauri-apps/api/core'))
  ;({ UserSettingsPanel } = await import('./UserSettingsPanel.js'))
})

beforeEach(() => {
  document.body.innerHTML = ''
  window.currentVaultPath = '/vault'
  window.themeManager = null
  window.currentEditor = null
  invoke.mockReset()
})

afterEach(() => {
  delete window.currentVaultPath
  delete window.themeManager
  delete window.currentEditor
  jest.clearAllTimers()
})

describe('UserSettingsPanel lifecycle', () => {
  test('reattaches delegated change listeners when the settings panel is remounted', async () => {
    const loadedSettings = [makeVaultSettings(true), makeVaultSettings(false)]
    invoke.mockImplementation(async (command) => {
      if (command === 'get_vault_settings') {
        return loadedSettings.shift() || makeVaultSettings(false)
      }
      if (command === 'save_vault_settings') {
        return makeVaultSettings(true)
      }
      throw new Error(`Unexpected invoke command: ${command}`)
    })

    const panel = new UserSettingsPanel()

    const firstContainer = document.createElement('div')
    document.body.appendChild(firstContainer)
    await panel.mount(firstContainer)

    const firstWysiwygCheckbox = firstContainer.querySelector('[data-setting="wysiwygMode"]')
    firstWysiwygCheckbox.checked = false
    firstWysiwygCheckbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(panel.state.editor.wysiwygMode).toBe(false)
    expect(panel.state.isDirty).toBe(true)

    const secondContainer = document.createElement('div')
    document.body.appendChild(secondContainer)
    await panel.mount(secondContainer)

    const secondWysiwygCheckbox = secondContainer.querySelector('[data-setting="wysiwygMode"]')
    expect(secondWysiwygCheckbox.checked).toBe(false)

    secondWysiwygCheckbox.checked = true
    secondWysiwygCheckbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(panel.state.editor.wysiwygMode).toBe(true)
    expect(panel.state.isDirty).toBe(true)
    expect(secondContainer.querySelector('[data-action="save-settings"]').disabled).toBe(false)
  })

  test('persists advanced theme override colors with vault settings', async () => {
    const savedPayloads = []
    invoke.mockImplementation(async (command, payload) => {
      if (command === 'get_vault_settings') {
        return makeVaultSettings(true)
      }
      if (command === 'save_vault_settings') {
        savedPayloads.push(payload.settings)
        return makeVaultSettings(true)
      }
      throw new Error(`Unexpected invoke command: ${command}`)
    })

    const panel = new UserSettingsPanel()
    const container = document.createElement('div')
    document.body.appendChild(container)
    await panel.mount(container)

    const themeSelect = container.querySelector('[data-setting="theme"]')
    themeSelect.value = 'dark'
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }))

    const toggle = container.querySelector('[data-action="toggle-theme-overrides"]')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    const accentInput = container.querySelector('[data-action="update-theme-override"][data-override-key="accent"]')
    accentInput.value = '#88aadd'
    accentInput.dispatchEvent(new Event('change', { bubbles: true }))

    await panel.saveSettings()

    expect(savedPayloads).toHaveLength(1)
    expect(savedPayloads[0].editor.theme_overrides.enabled).toBe(true)
    expect(savedPayloads[0].editor.theme_overrides.dark.accent).toBe('#88AADD')
  })
})
