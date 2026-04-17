import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { applyTheme as applyTokenTheme } from '../tokens/css-generator.js'

export class ThemeManager {
  constructor(editor) {
    this.editor = editor
    this.themes = new Map()
    this.activeTheme = 'default'
    this.loadBuiltInThemes()
  }

  loadBuiltInThemes() {
    // default light theme
    this.themes.set('default', {
      name: 'Gaimplan Light',
      type: 'default',
      variables: {
        '--editor-text-color': '#1f2937',
        '--editor-bg-color': '#ffffff',
        '--editor-selection-bg': '#b3d4fc',
        '--editor-caret-color': '#5b47e0',
        '--editor-gutter-bg': '#fafbfc',
        '--editor-gutter-color': '#8a949e',
        '--editor-gutter-border': '#e8eaed',
        '--editor-active-line-bg': '#f8f9fa',
        '--editor-active-line-gutter-bg': '#f0f1f3',
        '--editor-font-family': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        '--editor-font-size': '16px',
        '--editor-line-height': '1.7',
        '--editor-padding': '24px 32px',
        
        // Enhanced markdown styling
        '--md-heading-color': '#1e1e1e',
        '--md-heading-weight': '600',
        '--md-heading-border': '#e8eaed',
        '--md-link-color': '#2563eb',
        '--md-link-hover-color': '#1d4ed8',
        '--md-code-bg': '#f6f8fa',
        '--md-code-color': '#d73a49',
        '--md-code-block-bg': '#f8f9fa',
        '--md-code-block-border': '#e1e4e8',
        '--md-quote-border': '#2563eb',
        '--md-quote-bg': 'rgba(37, 99, 235, 0.05)',
        '--md-quote-color': '#586e75'
      }
    })

    // Also add as 'light' for backwards compatibility
    this.themes.set('light', {
      name: 'Gaimplan Light',
      type: 'light',
      variables: {
        '--editor-text-color': '#1f2937',
        '--editor-bg-color': '#ffffff',
        '--editor-selection-bg': '#b3d4fc',
        '--editor-caret-color': '#5b47e0',
        '--editor-gutter-bg': '#fafbfc',
        '--editor-gutter-color': '#8a949e',
        '--editor-gutter-border': '#e8eaed',
        '--editor-active-line-bg': '#f8f9fa',
        '--editor-active-line-gutter-bg': '#f0f1f3',
        '--editor-font-family': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        '--editor-font-size': '16px',
        '--editor-line-height': '1.7',
        '--editor-padding': '24px 32px',
        
        // Enhanced markdown styling
        '--md-heading-color': '#1e1e1e',
        '--md-heading-weight': '600',
        '--md-heading-border': '#e8eaed',
        '--md-link-color': '#2563eb',
        '--md-link-hover-color': '#1d4ed8',
        '--md-code-bg': '#f6f8fa',
        '--md-code-color': '#d73a49',
        '--md-code-block-bg': '#f8f9fa',
        '--md-code-block-border': '#e1e4e8',
        '--md-quote-border': '#2563eb',
        '--md-quote-bg': 'rgba(37, 99, 235, 0.05)',
        '--md-quote-color': '#586e75'
      }
    })

    // dark theme
    this.themes.set('dark', {
      name: 'Gaimplan Dark',
      type: 'dark',
      variables: {
        '--editor-text-color': '#dcddde',
        '--editor-bg-color': '#202020',
        '--editor-selection-bg': '#404040',
        '--editor-caret-color': '#7c3aed',
        '--editor-gutter-bg': '#1a1a1a',
        '--editor-gutter-color': '#666666',
        '--editor-gutter-border': '#2a2a2a',
        '--editor-active-line-bg': '#2a2a2a',
        '--editor-active-line-gutter-bg': '#2a2a2a',
        '--editor-font-family': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        '--editor-font-size': '16px',
        '--editor-line-height': '1.7',
        '--editor-padding': '24px 32px',
        
        '--md-heading-color': '#ffffff',
        '--md-heading-weight': '600',
        '--md-heading-border': '#404040',
        '--md-link-color': '#60a5fa',
        '--md-link-hover-color': '#93c5fd',
        '--md-code-bg': '#2a2a2a',
        '--md-code-color': '#ff6b6b',
        '--md-code-block-bg': '#1a1a1a',
        '--md-code-block-border': '#404040',
        '--md-quote-border': '#60a5fa',
        '--md-quote-bg': 'rgba(96, 165, 250, 0.08)',
        '--md-quote-color': '#b3b3b3'
      }
    })

    // Solarized Light
    this.themes.set('solarized-light', {
      name: 'Solarized Light',
      type: 'light',
      variables: {
        '--editor-text-color': '#657b83',
        '--editor-bg-color': '#fdf6e3',
        '--editor-selection-bg': '#eee8d5',
        '--editor-caret-color': '#2aa198',
        '--editor-gutter-bg': '#eee8d5',
        '--editor-gutter-color': '#93a1a1',
        '--editor-gutter-border': '#eee8d5',
        '--editor-active-line-bg': '#eee8d5',
        '--editor-active-line-gutter-bg': '#eee8d5',
        '--editor-font-family': "'SF Mono', Monaco, 'Cascadia Code', monospace",
        '--editor-font-size': '14px',
        '--editor-line-height': '1.6',
        '--editor-padding': '12px 16px',
        '--editor-line-padding': '4px',
        '--md-heading-color': '#b58900',
        '--md-link-color': '#268bd2',
        '--md-code-bg': '#eee8d5',
        '--md-code-color': '#2aa198',
        '--md-quote-border': '#93a1a1',
        '--md-quote-bg': '#eee8d5'
      }
    })

    // Solarized Dark
    this.themes.set('solarized-dark', {
      name: 'Solarized Dark',
      type: 'dark',
      variables: {
        '--editor-text-color': '#839496',
        '--editor-bg-color': '#002b36',
        '--editor-selection-bg': '#073642',
        '--editor-caret-color': '#2aa198',
        '--editor-gutter-bg': '#073642',
        '--editor-gutter-color': '#586e75',
        '--editor-gutter-border': '#073642',
        '--editor-active-line-bg': '#073642',
        '--editor-active-line-gutter-bg': '#073642',
        '--editor-font-family': "'SF Mono', Monaco, 'Cascadia Code', monospace",
        '--editor-font-size': '14px',
        '--editor-line-height': '1.6',
        '--editor-padding': '12px 16px',
        '--editor-line-padding': '4px',
        '--md-heading-color': '#b58900',
        '--md-link-color': '#268bd2',
        '--md-code-bg': '#073642',
        '--md-code-color': '#2aa198',
        '--md-quote-border': '#586e75',
        '--md-quote-bg': '#073642'
      }
    })

    // Dracula theme
    this.themes.set('dracula', {
      name: 'Dracula',
      type: 'dark',
      variables: {
        '--editor-text-color': '#f8f8f2',
        '--editor-bg-color': '#282a36',
        '--editor-selection-bg': '#44475a',
        '--editor-caret-color': '#f8f8f0',
        '--editor-gutter-bg': '#44475a',
        '--editor-gutter-color': '#6272a4',
        '--editor-gutter-border': '#44475a',
        '--editor-active-line-bg': '#44475a',
        '--editor-active-line-gutter-bg': '#44475a',
        '--editor-font-family': "'SF Mono', Monaco, 'Cascadia Code', monospace",
        '--editor-font-size': '14px',
        '--editor-line-height': '1.6',
        '--editor-padding': '12px 16px',
        '--editor-line-padding': '4px',
        '--md-heading-color': '#bd93f9',
        '--md-link-color': '#8be9fd',
        '--md-code-bg': '#44475a',
        '--md-code-color': '#50fa7b',
        '--md-quote-border': '#6272a4',
        '--md-quote-bg': '#44475a'
      }
    })
  }

  async loadUserThemes() {
    try {
      const themes = await invoke('list_theme_files')
      
      for (const themeFile of themes) {
        // In a full implementation, we would read the theme files
        // For now, just log that we found theme files
        console.log('Found theme file:', themeFile)
      }
    } catch (error) {
      console.error('Failed to load user themes:', error)
    }
  }

  setEditor(editor) {
    this.editor = editor;
  }

  applyTheme(themeName) {
    console.log(`[ThemeManager] applyTheme called with: "${themeName}"`)
    const theme = this.themes.get(themeName)
    if (!theme) {
      console.warn(`[ThemeManager] Theme "${themeName}" not found, using default`)
      return this.applyTheme('default')
    }
    console.log(`[ThemeManager] Found theme:`, theme.name, `type:`, theme.type)

    // Apply token system for light and dark themes
    // This sets all semantic tokens (--bg-primary, --text-primary, etc.) and data-theme attribute
    if (themeName === 'light' || themeName === 'default') {
      console.log(`[ThemeManager] Calling applyTokenTheme('light')`)
      applyTokenTheme('light')
      // Update Tauri window background for light theme
      this.updateWindowBackground('#ffffff', 'light')
    } else if (themeName === 'dark') {
      console.log(`[ThemeManager] Calling applyTokenTheme('dark')`)
      applyTokenTheme('dark')
      // Update Tauri window background for dark theme
      this.updateWindowBackground('#1C1C1E', 'dark')
    } else {
      console.log(`[ThemeManager] Theme "${themeName}" is not light/dark, skipping token system`)
    }

    // Apply theme-specific CSS variables (editor-specific and theme overrides)
    // For Solarized and Dracula, these are complete theme definitions
    // For light/dark, these are editor-specific overrides that complement the token system
    const root = document.documentElement
    Object.entries(theme.variables).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })

    // Update CodeMirror theme compartment if editor exists
    if (this.editor && this.editor.view) {
      this.editor.view.dispatch({
        effects: this.editor.themeCompartment.reconfigure(
          this.editor.createTheme(theme.type)
        )
      })
      // Keep editor aware of the effective theme type for refresh logic
      this.editor.currentTheme = theme.type
    }

    this.activeTheme = themeName

    // Save preference
    this.saveThemePreference(themeName)

    // Synchronize theme type with other open editors (if any)
    try {
      if (window.paneManager && window.paneManager.panes) {
        for (const pane of window.paneManager.panes.values()) {
          const tabManager = pane.tabManager
          if (!tabManager || !tabManager.tabs) continue
          for (const tab of tabManager.tabs.values()) {
            if (tab.editor && tab.type === 'markdown') {
              tab.editor.currentTheme = theme.type
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to sync theme state across editors:', e)
    }
  }

  async saveThemePreference(themeName) {
    try {
      await invoke('save_editor_preference', {
        key: 'theme',
        value: themeName
      })
    } catch (error) {
      console.error('Failed to save theme preference:', error)
    }
  }

  /**
   * Update the Tauri window's background color and theme setting.
   * This ensures the native window matches the app's theme, preventing
   * macOS dark mode from bleeding through transparent window areas.
   */
  async updateWindowBackground(color, themeType) {
    try {
      const appWindow = getCurrentWindow()
      // Set window background color (prevents macOS dark mode bleed-through)
      await appWindow.setBackgroundColor(color)
      // Set window theme to match app theme
      await appWindow.setTheme(themeType === 'dark' ? 'dark' : 'light')
      console.log(`[ThemeManager] Updated window background to ${color}, theme to ${themeType}`)
    } catch (error) {
      // Window API may not be available in all contexts
      console.warn('[ThemeManager] Could not update window background:', error)
    }
  }

  async createCustomTheme(baseTheme, customizations) {
    const base = this.themes.get(baseTheme)
    if (!base) return

    const newTheme = {
      ...base,
      id: `custom-${Date.now()}`,
      name: customizations.name || 'Custom Theme',
      variables: {
        ...base.variables,
        ...customizations.variables
      }
    }

    this.themes.set(newTheme.id, newTheme)
    
    // In a full implementation, save to file via Tauri command
    console.log('Custom theme created:', newTheme.id)

    return newTheme.id
  }

  getThemes() {
    return Array.from(this.themes.values())
  }

  getActiveTheme() {
    return this.activeTheme
  }

  // Utility methods for dynamic theme switching
  setFontSize(size) {
    const root = document.documentElement
    root.style.setProperty('--editor-font-size', `${size}px`)
    
    this.editor.view.dispatch({
      effects: this.editor.fontSizeCompartment.reconfigure(
        this.editor.createFontSizeTheme(size)
      )
    })

    this.saveEditorPreference('font_size', size.toString())
  }

  setFontFamily(fontFamily) {
    const root = document.documentElement
    root.style.setProperty('--editor-font-family', fontFamily)
    
    this.saveEditorPreference('font_family', fontFamily)
  }

  setFontColor(fontColor) {
    const root = document.documentElement
    root.style.setProperty('--editor-text-color', fontColor)
    
    // Also update markdown colors to maintain readability
    root.style.setProperty('--md-heading-color', fontColor)
    
    // Scope complementary variables inside the active editor for immediate effect
    if (this.editor && this.editor.view && this.editor.view.dom) {
      try {
        this.editor.view.dom.style.setProperty('--editor-text-color', fontColor)
        // Some editor-scoped styles still rely on --text-primary; mirror to keep consistent
        this.editor.view.dom.style.setProperty('--text-primary', fontColor)
      } catch (e) {
        console.warn('Failed to scope font color vars to editor:', e)
      }
    }
    
    // Note: The actual theme refresh in editors is handled by the calling code
    // which has access to all editor instances
    
    this.saveEditorPreference('font_color', fontColor)
  }

  setLineHeight(lineHeight) {
    const root = document.documentElement
    root.style.setProperty('--editor-line-height', lineHeight.toString())
    
    this.saveEditorPreference('line_height', lineHeight.toString())
  }

  toggleLineWrapping() {
    const currentWrapping = this.editor.view.state.facet(EditorView.lineWrapping)
    const newWrapping = !currentWrapping
    
    this.editor.view.dispatch({
      effects: this.editor.lineWrappingCompartment.reconfigure(
        newWrapping ? EditorView.lineWrapping : []
      )
    })

    this.saveEditorPreference('line_wrapping', newWrapping.toString())
  }

  async saveEditorPreference(key, value) {
    try {
      await invoke('save_editor_preference', {
        key,
        value
      })
    } catch (error) {
      console.error('Failed to save editor preference:', error)
    }
  }

  // System theme detection
  detectSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'default'
  }

  // Listen for system theme changes
  setupSystemThemeListener() {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaQuery.addEventListener('change', (e) => {
        if (this.activeTheme === 'system') {
          this.applyTheme(e.matches ? 'dark' : 'default')
        }
      })
    }
  }
}
