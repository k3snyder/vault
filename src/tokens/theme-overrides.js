/**
 * User theme override utilities.
 *
 * These overrides intentionally target a small semantic surface so users can
 * make subtle light/dark adjustments without editing the full token system.
 */

export const THEME_OVERRIDE_FIELDS = [
  {
    key: 'background',
    label: 'Window',
    description: 'Main app background',
    variables: ['--bg-primary', '--bg-reading', '--editor-gutter', '--editor-gutter-bg']
  },
  {
    key: 'surface',
    label: 'Panels',
    description: 'Sidebars, cards, and modal groups',
    variables: ['--bg-secondary', '--chrome-primary-bg']
  },
  {
    key: 'control',
    label: 'Controls',
    description: 'Inputs, dropdowns, and nested surfaces',
    variables: ['--bg-tertiary', '--chrome-secondary-bg', '--md-code-bg']
  },
  {
    key: 'editor',
    label: 'Editor',
    description: 'Editor page/canvas background',
    variables: ['--editor-bg', '--editor-bg-color', '--content-bg', '--bg-writing', '--bg-preview']
  },
  {
    key: 'text',
    label: 'Text',
    description: 'Primary app and editor text',
    variables: ['--text-primary', '--editor-text', '--editor-text-color', '--content-text', '--md-heading-color']
  },
  {
    key: 'mutedText',
    label: 'Muted text',
    description: 'Secondary labels and supporting text',
    variables: ['--text-secondary', '--content-text-secondary', '--chrome-primary-text']
  },
  {
    key: 'accent',
    label: 'Accent',
    description: 'Links, selected tabs, focus, and primary actions',
    variables: ['--accent-primary', '--border-focus', '--editor-cursor', '--editor-caret-color', '--link-color', '--md-link-color', '--md-quote-border']
  },
  {
    key: 'activeLine',
    label: 'Active line',
    description: 'Subtle editor active-line highlight',
    variables: ['--editor-active-line', '--editor-active-line-bg', '--editor-active-line-gutter-bg']
  }
]

export const THEME_OVERRIDE_DEFAULTS = {
  light: {
    background: '#ffffff',
    surface: '#fafafa',
    control: '#f5f5f5',
    editor: '#ffffff',
    text: '#171717',
    mutedText: '#525252',
    accent: '#2563eb',
    activeLine: '#f8f9fa'
  },
  dark: {
    background: '#12110F',
    surface: '#181816',
    control: '#20201D',
    editor: '#141412',
    text: '#EEECE6',
    mutedText: '#918B80',
    accent: '#7FA6D6',
    activeLine: '#1B1A17'
  }
}

export function getThemeOverrideMode(themeName) {
  return themeName === 'dark' || themeName === 'solarized-dark' || themeName === 'dracula'
    ? 'dark'
    : 'light'
}

export function normalizeHexColor(value, fallback = '#000000') {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/i)
  if (shortHex) {
    return `#${shortHex[1].split('').map(char => char + char).join('')}`.toUpperCase()
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  return fallback
}

export function normalizeThemeOverridePalette(palette = {}, mode = 'light') {
  const defaults = THEME_OVERRIDE_DEFAULTS[mode] || THEME_OVERRIDE_DEFAULTS.light
  return THEME_OVERRIDE_FIELDS.reduce((normalized, field) => {
    normalized[field.key] = normalizeHexColor(palette?.[field.key], defaults[field.key])
    return normalized
  }, {})
}

export function normalizeThemeOverrides(overrides = {}) {
  return {
    enabled: Boolean(overrides?.enabled),
    light: normalizeThemeOverridePalette(overrides?.light, 'light'),
    dark: normalizeThemeOverridePalette(overrides?.dark, 'dark')
  }
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex)
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  }
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function getThemeOverridePalette(themeName, overrides = {}) {
  const normalized = normalizeThemeOverrides(overrides)
  return normalized[getThemeOverrideMode(themeName)]
}

export function getThemeOverrideColor(themeName, overrides = {}, key) {
  if (!overrides?.enabled || !key) {
    return null
  }
  const palette = getThemeOverridePalette(themeName, overrides)
  return palette?.[key] || null
}

export function applyThemeOverrides(
  themeName,
  overrides = {},
  root = typeof document !== 'undefined' ? document.documentElement : null
) {
  const normalized = normalizeThemeOverrides(overrides)
  if (!normalized.enabled || !root) {
    return
  }

  const palette = normalized[getThemeOverrideMode(themeName)]

  for (const field of THEME_OVERRIDE_FIELDS) {
    const color = palette[field.key]
    for (const variable of field.variables) {
      root.style.setProperty(variable, color)
    }
  }

  root.style.setProperty('--text-tertiary', palette.mutedText)
  root.style.setProperty('--chrome-primary-text-muted', palette.mutedText)
  root.style.setProperty('--chrome-secondary-text', palette.mutedText)
  root.style.setProperty('--editor-line-number', palette.mutedText)

  root.style.setProperty('--accent-hover', rgba(palette.accent, 0.9))
  root.style.setProperty('--accent-active', rgba(palette.accent, 0.78))
  root.style.setProperty('--accent-bg', rgba(palette.accent, 0.1))
  root.style.setProperty('--bg-active', rgba(palette.accent, 0.08))
  root.style.setProperty('--border-input-focus', rgba(palette.accent, 0.32))
  root.style.setProperty('--focus-ring', palette.accent)

  root.style.setProperty('--editor-selection', rgba(palette.accent, 0.24))
  root.style.setProperty('--editor-selection-bg', rgba(palette.accent, 0.24))
  root.style.setProperty('--editor-selection-match', rgba(palette.accent, 0.14))
  root.style.setProperty('--md-wikilink-bg', rgba(palette.accent, 0.12))
  root.style.setProperty('--md-wikilink-hover-bg', rgba(palette.accent, 0.2))
  root.style.setProperty('--md-blockref-bg', rgba(palette.accent, 0.12))
  root.style.setProperty('--md-quote-bg', rgba(palette.accent, 0.08))
}
