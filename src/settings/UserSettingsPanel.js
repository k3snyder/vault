import { invoke } from '@tauri-apps/api/core';

import pluginSettingsPanel from './PluginSettingsPanel.js';
import EntitlementManager from '../services/entitlement-manager.js';
import { normalizeImageLocation } from '../utils/image-paths.js';
import {
    THEME_OVERRIDE_DEFAULTS,
    THEME_OVERRIDE_FIELDS,
    getThemeOverrideMode,
    normalizeHexColor,
    normalizeThemeOverrides
} from '../tokens/theme-overrides.js';

/**
 * Font color presets from the design token system
 * These provide curated options that work well in both light and dark themes
 */
const FONT_COLOR_PRESETS = {
    light: [
        { name: 'Default', value: '#32302c', description: 'Warm neutral default' },
        { name: 'Soft', value: '#404040', description: 'Secondary text (neutral-700)' },
        { name: 'Muted', value: '#525252', description: 'Tertiary text (neutral-600)' },
        { name: 'Slate', value: '#1f2937', description: 'Slate alternative' },
        { name: 'Neutral', value: '#171717', description: 'Primary text (neutral-900)' }
    ],
    dark: [
        { name: 'Default', value: '#eeece6', description: 'Soft charcoal primary text' },
        { name: 'Soft', value: '#c8c3b8', description: 'Warm secondary text' },
        { name: 'Muted', value: '#918b80', description: 'Muted warm neutral' },
        { name: 'Warm', value: '#e8e3da', description: 'Editor text default' },
        { name: 'Cool', value: '#d8dee8', description: 'Cool gray alternative' }
    ]
};

export class UserSettingsPanel {
    constructor() {
        this.state = {
            vaultPath: '',
            activeTab: 'editor', // 'editor' or 'plugins'
            editor: {
                fontSize: 16,
                fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                fontColor: '#32302c',
                theme: 'default',
                lineNumbers: false,
                lineWrapping: true,
                showStatusBar: true,
                wysiwygMode: true,
                themeOverrides: normalizeThemeOverrides()
            },
            files: {
                imageLocation: 'Files/',
                imageNamingPattern: 'Pasted image {timestamp}',
                dailyNotesFolder: 'Daily Notes'
            },
            isDirty: false,
            isSaving: false,
            isLoading: true,
            isSyncing: false
        };

        this.container = null;
        this.callbacks = {
            onSave: null,
            onClose: null
        };
        this.previewTimeout = null;
        this.committedEditorState = null;
        this.pluginSettingsPanel = null;
        this.listenersAttached = false;
        this.listenerContainer = null;
        this.boundClickHandler = this.handleContainerClick.bind(this);
        this.boundChangeHandler = this.handleContainerChange.bind(this);

        // Entitlement manager for license checks (kept for other uses)
        this.entitlementManager = null;
    }
    
    async mount(container, callbacks = {}) {
        console.log('Mounting User Settings Panel');
        this.container = container;
        this.callbacks = { ...this.callbacks, ...callbacks };
        this.attachEventListeners();
        
        // Get current vault path
        this.state.vaultPath = await this.getCurrentVaultPath();
        if (!this.state.vaultPath) {
            this.showError('No vault is currently open');
            return;
        }
        
        this.attachEventListeners();
        await this.loadSettings();
        this.render();
    }
    
    async getCurrentVaultPath() {
        // Check window global first
        if (window.currentVaultPath) {
            return window.currentVaultPath;
        }
        
        // Fallback to backend
        try {
            const vaultInfo = await invoke('get_vault_info');
            if (vaultInfo && vaultInfo.path) {
                return vaultInfo.path;
            }
        } catch (error) {
            console.error('Failed to get vault info:', error);
        }
        
        return null;
    }
    
    async loadSettings() {
        try {
            this.state.isLoading = true;
            const settings = await invoke('get_vault_settings', {
                vaultPath: this.state.vaultPath
            });

            console.log('Loaded vault settings:', settings);
            
            // Update state with loaded settings, converting snake_case to camelCase
            this.state.editor = {
                ...this.state.editor,
                fontSize: settings.editor.font_size || this.state.editor.fontSize,
                fontFamily: settings.editor.font_family || this.state.editor.fontFamily,
                fontColor: settings.editor.font_color || this.state.editor.fontColor,
                theme: settings.editor.theme || this.state.editor.theme,
                lineNumbers: settings.editor.line_numbers !== undefined ? settings.editor.line_numbers : this.state.editor.lineNumbers,
                lineWrapping: settings.editor.line_wrapping !== undefined ? settings.editor.line_wrapping : this.state.editor.lineWrapping,
                showStatusBar: settings.editor.show_status_bar !== undefined ? settings.editor.show_status_bar : this.state.editor.showStatusBar,
                wysiwygMode: settings.editor.wysiwyg_mode !== undefined ? settings.editor.wysiwyg_mode : this.state.editor.wysiwygMode,
                themeOverrides: normalizeThemeOverrides(settings.editor.theme_overrides || settings.editor.themeOverrides)
            };
            this.committedEditorState = this.cloneEditorState(this.state.editor);
            this.state.files = {
                ...this.state.files,
                imageLocation: normalizeImageLocation(settings.files.image_location || this.state.files.imageLocation),
                imageNamingPattern: settings.files.image_naming_pattern || this.state.files.imageNamingPattern,
                dailyNotesFolder: settings.files.daily_notes_folder || this.state.files.dailyNotesFolder
            };
            this.state.isDirty = false;
        } catch (error) {
            console.error('Failed to load vault settings:', error);
            // Use defaults on error
        } finally {
            this.state.isLoading = false;
        }
    }
    
    async saveSettings() {
        if (!this.state.isDirty || this.state.isSaving) return;
        let didSave = false;
        
        try {
            this.state.isSaving = true;
            this.render();
            this.state.files.imageLocation = normalizeImageLocation(this.state.files.imageLocation);
            
            const settings = {
                vault_path: this.state.vaultPath,
                editor: {
                    font_size: this.state.editor.fontSize,
                    font_family: this.state.editor.fontFamily,
                    font_color: this.state.editor.fontColor,
                    theme: this.state.editor.theme,
                    line_numbers: this.state.editor.lineNumbers,
                    line_wrapping: this.state.editor.lineWrapping,
                    show_status_bar: this.state.editor.showStatusBar,
                    wysiwyg_mode: this.state.editor.wysiwygMode,
                    theme_overrides: normalizeThemeOverrides(this.state.editor.themeOverrides)
                },
                files: {
                    image_location: this.state.files.imageLocation,
                    image_naming_pattern: this.state.files.imageNamingPattern,
                    daily_notes_folder: this.state.files.dailyNotesFolder
                }
            };
            
            console.log('Saving vault settings...');
            await invoke('save_vault_settings', { settings });
            
            this.state.isDirty = false;
            this.showNotification('Settings saved successfully', 'success');
            
            // Call callback if provided with camelCase properties
            if (this.callbacks.onSave) {
                await this.callbacks.onSave({
                    editor: this.state.editor,
                    files: this.state.files,
                    vault_path: this.state.vaultPath
                });
            }

            this.committedEditorState = this.cloneEditorState(this.state.editor);
            didSave = true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings: ' + error, 'error');
        } finally {
            this.state.isSaving = false;
            if (didSave) {
                this.close({ revertPreview: false });
            } else {
                this.render();
            }
        }
    }
    
    async resetSection(section) {
        const confirmReset = confirm(`Reset ${section} settings to defaults?`);
        if (!confirmReset) return;
        
        try {
            const settings = await invoke('reset_vault_settings', { 
                vaultPath: this.state.vaultPath 
            });
            
            // Update state with reset settings, converting snake_case to camelCase
            this.state.editor = {
                ...this.state.editor,
                fontSize: settings.editor.font_size || this.state.editor.fontSize,
                fontFamily: settings.editor.font_family || this.state.editor.fontFamily,
                fontColor: settings.editor.font_color || this.state.editor.fontColor,
                theme: settings.editor.theme || this.state.editor.theme,
                lineNumbers: settings.editor.line_numbers !== undefined ? settings.editor.line_numbers : this.state.editor.lineNumbers,
                lineWrapping: settings.editor.line_wrapping !== undefined ? settings.editor.line_wrapping : this.state.editor.lineWrapping,
                showStatusBar: settings.editor.show_status_bar !== undefined ? settings.editor.show_status_bar : this.state.editor.showStatusBar,
                wysiwygMode: settings.editor.wysiwyg_mode !== undefined ? settings.editor.wysiwyg_mode : this.state.editor.wysiwygMode,
                themeOverrides: normalizeThemeOverrides(settings.editor.theme_overrides || settings.editor.themeOverrides)
            };
            this.committedEditorState = this.cloneEditorState(this.state.editor);
            this.state.files = {
                ...this.state.files,
                imageLocation: normalizeImageLocation(settings.files.image_location || this.state.files.imageLocation),
                imageNamingPattern: settings.files.image_naming_pattern || this.state.files.imageNamingPattern,
                dailyNotesFolder: settings.files.daily_notes_folder || this.state.files.dailyNotesFolder
            };
            this.state.isDirty = false;
            
            this.showNotification(`${section} settings reset to defaults`, 'success');
            this.render();
            
            // Trigger preview update
            this.previewChanges();
        } catch (error) {
            console.error('Failed to reset settings:', error);
            this.showNotification('Failed to reset settings: ' + error, 'error');
        }
    }
    
    updateEditorSetting(key, value) {
        this.state.editor[key] = value;

        // When theme changes, update font color to match the new theme's default
        if (key === 'theme') {
            const isDarkTheme = value === 'dark';
            const defaultColor = isDarkTheme
                ? FONT_COLOR_PRESETS.dark[0].value   // '#eeece6'
                : FONT_COLOR_PRESETS.light[0].value; // '#32302c'
            this.state.editor.fontColor = defaultColor;
        }

        this.state.isDirty = true;
        this.render();
        this.previewChanges();
    }

    updateThemeOverrideEnabled(enabled) {
        this.state.editor.themeOverrides = normalizeThemeOverrides({
            ...this.state.editor.themeOverrides,
            enabled
        });
        this.state.isDirty = true;
        this.render();
        this.previewChanges();
    }

    updateThemeOverrideColor(themeMode, key, value) {
        const mode = themeMode === 'dark' ? 'dark' : 'light';
        const defaults = THEME_OVERRIDE_DEFAULTS[mode];
        const current = normalizeThemeOverrides(this.state.editor.themeOverrides);
        current[mode][key] = normalizeHexColor(value, current[mode][key] || defaults[key]);
        this.state.editor.themeOverrides = current;
        this.state.isDirty = true;
        this.render();
        this.previewChanges();
    }

    resetThemeOverrides(themeMode = this.getThemeOverrideMode()) {
        const mode = themeMode === 'dark' ? 'dark' : 'light';
        const current = normalizeThemeOverrides(this.state.editor.themeOverrides);
        current[mode] = { ...THEME_OVERRIDE_DEFAULTS[mode] };
        this.state.editor.themeOverrides = current;
        this.state.isDirty = true;
        this.render();
        this.previewChanges();
    }
    
    updateFileSetting(key, value) {
        this.state.files[key] = key === 'imageLocation'
            ? normalizeImageLocation(value)
            : value;
        this.state.isDirty = true;
        this.render();
    }
    
    previewChanges() {
        // Clear existing timeout
        if (this.previewTimeout) {
            clearTimeout(this.previewTimeout);
        }
        
        // Debounce preview updates
        this.previewTimeout = setTimeout(() => {
            // Apply preview to editor
            if (window.themeManager) {
                // IMPORTANT: Apply theme FIRST, then font color
                // applyTheme sets --editor-text-color from theme defaults,
                // so setFontColor must come AFTER to override with user's selection
                window.themeManager.setThemeOverrides?.(this.state.editor.themeOverrides);
                window.themeManager.applyTheme(this.state.editor.theme, this.state.editor.themeOverrides);
                window.themeManager.setFontSize(this.state.editor.fontSize);
                window.themeManager.setFontFamily(this.state.editor.fontFamily);
                window.themeManager.setFontColor(this.state.editor.fontColor);
                
                // Apply line numbers setting to current editor
                const activeTabManager = window.paneManager?.getActiveTabManager();
                const activeTab = activeTabManager?.getActiveTab();
                if (activeTab && activeTab.editor && activeTab.editor.setLineNumbers) {
                    activeTab.editor.setLineNumbers(this.state.editor.lineNumbers);
                }
                
                // Apply line wrapping setting to current editor
                if (activeTab && activeTab.editor && activeTab.editor.setLineWrapping) {
                    activeTab.editor.setLineWrapping(this.state.editor.lineWrapping);
                }
                
                // Apply status bar visibility
                if (window.toggleStatusBar) {
                    const currentVisible = document.getElementById('status-bar')?.style.display !== 'none';
                    if (currentVisible !== this.state.editor.showStatusBar) {
                        window.toggleStatusBar();
                    }
                }

                // Apply WYSIWYG mode
                if (window.currentEditor && typeof window.currentEditor.setWysiwygMode === 'function') {
                    window.currentEditor.setWysiwygMode(this.state.editor.wysiwygMode);
                }
                
                // Force refresh theme on all editors to pick up font color change
                // Use a small delay to ensure CSS variables have propagated
                if (this.state.editor.fontColor) {
                    setTimeout(() => {
                        // Apply to all editors in all panes
                        if (window.paneManager && window.paneManager.panes) {
                            for (const pane of window.paneManager.panes.values()) {
                                const tabManager = pane.tabManager;
                                if (tabManager && tabManager.tabs) {
                                    for (const tab of tabManager.tabs.values()) {
                                        if (tab.editor && tab.type === 'markdown' && tab.editor.refreshTheme) {
                                            console.log('Refreshing theme for font color preview');
                                            tab.editor.refreshTheme();
                                        }
                                    }
                                }
                            }
                        }
                    }, 50); // Small delay to ensure CSS variable is set
                }
            }
        }, 300);
    }
    
    async validateImageLocation() {
        try {
            const imageLocation = normalizeImageLocation(this.state.files.imageLocation);
            const isValid = await invoke('validate_image_location', {
                vaultPath: this.state.vaultPath,
                imageLocation
            });
            
            if (!isValid) {
                this.showNotification('Image location must be within the vault', 'error');
                return false;
            }
            return true;
        } catch (error) {
            console.error('Failed to validate image location:', error);
            return false;
        }
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    attachEventListeners() {
        if (!this.container) {
            return;
        }

        if (this.listenersAttached && this.listenerContainer === this.container) {
            return;
        }

        if (this.listenersAttached) {
            this.detachEventListeners();
        }

        this.container.addEventListener('click', this.boundClickHandler);
        this.container.addEventListener('change', this.boundChangeHandler);
        this.listenerContainer = this.container;
        this.listenersAttached = true;
    }

    detachEventListeners() {
        if (!this.listenersAttached || !this.listenerContainer) {
            this.listenerContainer = null;
            this.listenersAttached = false;
            return;
        }

        this.listenerContainer.removeEventListener('click', this.boundClickHandler);
        this.listenerContainer.removeEventListener('change', this.boundChangeHandler);
        this.listenerContainer = null;
        this.listenersAttached = false;
    }

    handleContainerClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target || !this.container.contains(target)) {
            return;
        }

        switch (target.dataset.action) {
            case 'close':
                this.close();
                break;
            case 'switch-tab':
                this.switchTab(target.dataset.tab);
                break;
            case 'reset-section':
                this.resetSection(target.dataset.section);
                break;
            case 'set-editor-setting':
                this.updateEditorSetting(target.dataset.setting, target.dataset.value);
                break;
            case 'reset-theme-overrides':
                this.resetThemeOverrides(target.dataset.themeMode);
                break;
            case 'save-settings':
                this.saveSettings();
                break;
        }
    }

    handleContainerChange(event) {
        const target = event.target;

        if (!target.matches('[data-action]')) {
            return;
        }

        switch (target.dataset.action) {
            case 'update-editor-setting':
                this.updateEditorSetting(
                    target.dataset.setting,
                    target.dataset.valueType === 'number'
                        ? parseInt(target.value, 10)
                        : target.type === 'checkbox'
                            ? target.checked
                            : target.value
                );
                break;
            case 'toggle-theme-overrides':
                this.updateThemeOverrideEnabled(target.checked);
                break;
            case 'update-theme-override':
                this.updateThemeOverrideColor(
                    target.dataset.themeMode,
                    target.dataset.overrideKey,
                    target.value
                );
                break;
            case 'update-file-setting':
                this.updateFileSetting(target.dataset.setting, target.value);
                break;
        }
    }
    
    showError(message) {
        this.container.innerHTML = `
            <div class="user-settings-panel">
                <div class="settings-error">
                    <h3>Error</h3>
                    <p>${message}</p>
                    <button type="button" data-action="close" class="primary-button">Close</button>
                </div>
            </div>
        `;
    }
    
    cloneEditorState(editor) {
        return {
            ...editor,
            themeOverrides: normalizeThemeOverrides(editor?.themeOverrides)
        };
    }

    getSettingsScrollTop() {
        const content = this.container?.querySelector('.settings-content');
        return content ? content.scrollTop : null;
    }

    restoreSettingsScrollTop(scrollTop) {
        if (typeof scrollTop !== 'number') {
            return;
        }

        const content = this.container?.querySelector('.settings-content');
        if (!content) {
            return;
        }

        content.scrollTop = scrollTop;
        const restore = () => {
            if (content.isConnected) {
                content.scrollTop = scrollTop;
            }
        };
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(restore);
        } else {
            window.setTimeout(restore, 0);
        }
    }

    refreshMarkdownEditorThemes() {
        if (!window.paneManager?.panes) {
            return;
        }

        for (const pane of window.paneManager.panes.values()) {
            const tabManager = pane.tabManager;
            if (!tabManager?.tabs) continue;
            for (const tab of tabManager.tabs.values()) {
                if (tab.editor && tab.type === 'markdown' && tab.editor.refreshTheme) {
                    tab.editor.refreshTheme();
                }
            }
        }
    }

    applyEditorPreview(editorState) {
        if (!editorState || !window.themeManager) {
            return;
        }

        window.themeManager.setThemeOverrides?.(editorState.themeOverrides);
        window.themeManager.applyTheme(editorState.theme, editorState.themeOverrides);
        window.themeManager.setFontSize(editorState.fontSize);
        window.themeManager.setFontFamily(editorState.fontFamily);
        window.themeManager.setFontColor(editorState.fontColor);

        const activeTabManager = window.paneManager?.getActiveTabManager?.();
        const activeTab = activeTabManager?.getActiveTab?.();
        if (activeTab?.editor?.setLineNumbers) {
            activeTab.editor.setLineNumbers(editorState.lineNumbers);
        }
        if (activeTab?.editor?.setLineWrapping) {
            activeTab.editor.setLineWrapping(editorState.lineWrapping);
        }

        const statusBar = document.getElementById('status-bar');
        if (statusBar) {
            statusBar.style.display = editorState.showStatusBar ? 'flex' : 'none';
        }

        if (window.currentEditor && typeof window.currentEditor.setWysiwygMode === 'function') {
            window.currentEditor.setWysiwygMode(editorState.wysiwygMode);
        }

        this.refreshMarkdownEditorThemes();
    }

    revertPreviewChanges() {
        if (!this.state.isDirty || !this.committedEditorState) {
            return;
        }

        this.applyEditorPreview(this.committedEditorState);
    }

    close({ revertPreview = true } = {}) {
        if (this.previewTimeout) {
            clearTimeout(this.previewTimeout);
            this.previewTimeout = null;
        }
        if (revertPreview) {
            this.revertPreviewChanges();
        }
        this.detachEventListeners();
        if (this.callbacks.onClose) {
            this.callbacks.onClose();
        }
        this.container = null;
    }

    /**
     * Get the current color presets based on the selected theme
     */
    getColorPresets() {
        const isDarkTheme = this.state.editor.theme === 'dark';
        return isDarkTheme ? FONT_COLOR_PRESETS.dark : FONT_COLOR_PRESETS.light;
    }

    /**
     * Render color preset buttons for the font color picker
     */
    renderColorPresets() {
        const presets = this.getColorPresets();
        return presets.map(preset => {
            const isActive = this.state.editor.fontColor.toLowerCase() === preset.value.toLowerCase();
            return `
                <button type="button"
                        class="color-preset ${isActive ? 'active' : ''}"
                        style="background-color: ${preset.value}"
                        data-action="set-editor-setting"
                        data-setting="fontColor"
                        data-value="${preset.value}"
                        title="${preset.name}: ${preset.description}"
                        aria-label="${preset.name} color preset">
                </button>
            `;
        }).join('');
    }

    getThemeOverrideMode() {
        return getThemeOverrideMode(this.state.editor.theme);
    }

    renderThemeOverrideControls() {
        const mode = this.getThemeOverrideMode();
        const overrides = normalizeThemeOverrides(this.state.editor.themeOverrides);
        const palette = overrides[mode];
        const themeLabel = mode === 'dark' ? 'Dark' : 'Light';

        return `
            <div class="theme-override-summary">
                <div>
                    <strong>${themeLabel} theme tuning</strong>
                    <p class="form-help">Override a small set of semantic colors after the default ${themeLabel.toLowerCase()} theme is applied.</p>
                </div>
                <button type="button"
                        class="secondary-button compact-button"
                        data-action="reset-theme-overrides"
                        data-theme-mode="${mode}">
                    Reset ${themeLabel}
                </button>
            </div>
            <div class="theme-override-grid">
                ${THEME_OVERRIDE_FIELDS.map(field => `
                    <div class="theme-override-row">
                        <label for="theme-override-${mode}-${field.key}">
                            <span>${field.label}</span>
                            <small>${field.description}</small>
                        </label>
                        <div class="theme-override-color-control">
                            <input type="color"
                                   id="theme-override-${mode}-${field.key}"
                                   value="${palette[field.key]}"
                                   data-action="update-theme-override"
                                   data-theme-mode="${mode}"
                                   data-override-key="${field.key}"
                                   class="color-input"
                                   ${overrides.enabled ? '' : 'disabled'}>
                            <input type="text"
                                   value="${palette[field.key]}"
                                   data-action="update-theme-override"
                                   data-theme-mode="${mode}"
                                   data-override-key="${field.key}"
                                   class="color-text-input"
                                   placeholder="${THEME_OVERRIDE_DEFAULTS[mode][field.key]}"
                                   ${overrides.enabled ? '' : 'disabled'}>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    switchTab(tab) {
        console.log('Switching to tab:', tab);

        // If switching to plugins tab, open Plugin Hub instead
        if (tab === 'plugins') {
            console.log('Opening Plugin Hub...');

            // Close the settings window
            this.close();

            // Open the Plugin Hub (same as Cmd+Shift+P)
            if (window.pluginHub) {
                window.pluginHub.open().then(() => {
                    console.log('Plugin Hub opened successfully');
                }).catch(err => {
                    console.error('Failed to open Plugin Hub:', err);
                });
            } else {
                console.warn('Plugin Hub not initialized');
            }
            return;
        }
        
        // Normal tab switching for other tabs
        this.state.activeTab = tab;
        this.render();
    }
    
    render() {
        if (!this.container) return;

        const scrollTop = this.getSettingsScrollTop();

        // Make this instance available globally for event handlers
        window.userSettingsPanel = this;
        this.attachEventListeners();
        
        if (this.state.isLoading) {
            this.container.innerHTML = `
                <div class="user-settings-panel">
                    <div class="settings-loading">Loading settings...</div>
                </div>
            `;
            return;
        }
        
        const fontSizes = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24];
        const themes = [
            { value: 'default', label: 'Light' },
            { value: 'dark', label: 'Dark' }
        ];
        const themeOverrides = normalizeThemeOverrides(this.state.editor.themeOverrides);
        
        this.container.innerHTML = `
            <div class="user-settings-panel">
                <div class="settings-header">
                    <h2>Settings</h2>
                    <button type="button" class="close-button" data-action="close">×</button>
                </div>
                
                <div class="settings-tabs">
                    <button class="settings-tab ${this.state.activeTab === 'editor' ? 'active' : ''}"
                            type="button"
                            data-action="switch-tab"
                            data-tab="editor">
                        Editor
                    </button>
                    <button class="settings-tab ${this.state.activeTab === 'plugins' ? 'active' : ''}"
                            type="button"
                            data-action="switch-tab"
                            data-tab="plugins">
                        Plugins
                    </button>
                </div>

                <div class="settings-content">

                    <!-- Editor Settings Section -->
                    <div class="settings-section" style="display: ${this.state.activeTab === 'editor' ? 'block' : 'none'}">
                        <div class="section-header">
                            <h3>Editor Appearance</h3>
                            <button type="button"
                                    data-action="reset-section"
                                    data-section="Editor"
                                    class="reset-button">Reset to Defaults</button>
                        </div>
                        
                        <div class="settings-group">
                            <div class="form-group">
                                <label>Font Size:</label>
                                <div class="font-size-control">
                                    <select value="${this.state.editor.fontSize}" 
                                            data-action="update-editor-setting"
                                            data-setting="fontSize"
                                            data-value-type="number">
                                        ${fontSizes.map(size => `
                                            <option value="${size}" ${size === this.state.editor.fontSize ? 'selected' : ''}>
                                                ${size}px
                                            </option>
                                        `).join('')}
                                    </select>
                                    <div class="font-size-preview">${this.state.editor.fontSize}px</div>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label>Font Color:</label>
                                <div class="color-picker-control">
                                    <input type="color"
                                           value="${this.state.editor.fontColor}"
                                           data-action="update-editor-setting"
                                           data-setting="fontColor"
                                           class="color-input">
                                    <input type="text"
                                           value="${this.state.editor.fontColor}"
                                           data-action="update-editor-setting"
                                           data-setting="fontColor"
                                           class="color-text-input"
                                           placeholder="#32302c">
                                </div>
                                <div class="color-presets">
                                    ${this.renderColorPresets()}
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label>Theme:</label>
                                <select value="${this.state.editor.theme}" 
                                        data-action="update-editor-setting"
                                        data-setting="theme">
                                    ${themes.map(theme => `
                                        <option value="${theme.value}" ${theme.value === this.state.editor.theme ? 'selected' : ''}>
                                            ${theme.label}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                            
                            <div class="form-group checkbox-group">
                                <label>
                                    <input type="checkbox" 
                                           ${this.state.editor.lineNumbers ? 'checked' : ''}
                                           data-action="update-editor-setting"
                                           data-setting="lineNumbers">
                                    Show Line Numbers
                                </label>
                            </div>
                            
                            <div class="form-group checkbox-group">
                                <label>
                                    <input type="checkbox" 
                                           ${this.state.editor.lineWrapping ? 'checked' : ''}
                                           data-action="update-editor-setting"
                                           data-setting="lineWrapping">
                                    Enable Line Wrapping
                                </label>
                            </div>
                            
                            <div class="form-group checkbox-group">
                                <label>
                                    <input type="checkbox"
                                           ${this.state.editor.showStatusBar ? 'checked' : ''}
                                           data-action="update-editor-setting"
                                           data-setting="showStatusBar">
                                    Show Status Bar
                                </label>
                            </div>

                            <div class="form-group checkbox-group">
                                <label>
                                    <input type="checkbox"
                                           ${this.state.editor.wysiwygMode ? 'checked' : ''}
                                           data-action="update-editor-setting"
                                           data-setting="wysiwygMode">
                                    WYSIWYG Mode
                                </label>
                                <p class="form-help">Hide markdown syntax and show rendered formatting</p>
                            </div>

                            <details class="advanced-theme-overrides" ${themeOverrides.enabled ? 'open' : ''}>
                                <summary>Custom theme settings</summary>
                                <div class="advanced-theme-overrides-body">
                                    <div class="form-group checkbox-group theme-override-toggle">
                                        <label>
                                            <input type="checkbox"
                                                   ${themeOverrides.enabled ? 'checked' : ''}
                                                   data-action="toggle-theme-overrides">
                                            Override default Light/Dark theme colors
                                        </label>
                                        <p class="form-help">Use this for custom adjustments.</p>
                                    </div>
                                    ${this.renderThemeOverrideControls()}
                                </div>
                            </details>
                        </div>
                    </div>
                    
                    <!-- File Settings Section -->
                    <div class="settings-section" style="display: ${this.state.activeTab === 'editor' ? 'block' : 'none'}">
                        <div class="section-header">
                            <h3>File Management</h3>
                        </div>
                        
                        <div class="settings-group">
                            <div class="form-group">
                                <label>Image Save Location:</label>
                                <input type="text" 
                                       value="${this.state.files.imageLocation}"
                                       placeholder="Files/"
                                       data-action="update-file-setting"
                                       data-setting="imageLocation"
                                       class="settings-input">
                                <p class="form-help">Relative to vault root. Default: Files/</p>
                            </div>
                            
                            <div class="form-group">
                                <label>Daily Notes Folder:</label>
                                <input type="text" 
                                       value="${this.state.files.dailyNotesFolder}"
                                       placeholder="Daily Notes"
                                       data-action="update-file-setting"
                                       data-setting="dailyNotesFolder"
                                       class="settings-input">
                                <p class="form-help">Folder where daily notes are created. Default: Daily Notes</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="settings-footer">
                    <button type="button" data-action="close" class="secondary-button">Cancel</button>
                    <button type="button" data-action="save-settings"
                            class="primary-button ${this.state.isDirty ? '' : 'disabled'}"
                            ${this.state.isDirty && !this.state.isSaving ? '' : 'disabled'}>
                        ${this.state.isSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
                
                ${this.state.isDirty ? '<div class="unsaved-indicator">Unsaved changes</div>' : ''}
            </div>
        `;
        this.restoreSettingsScrollTop(scrollTop);
    }
}

// Export a singleton instance
export const userSettingsPanel = new UserSettingsPanel();
