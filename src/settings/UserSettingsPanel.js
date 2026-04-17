import { invoke } from '@tauri-apps/api/core';

import pluginSettingsPanel from './PluginSettingsPanel.js';
import EntitlementManager from '../services/entitlement-manager.js';
import { normalizeImageLocation } from '../utils/image-paths.js';

/**
 * Font color presets from the design token system
 * These provide curated options that work well in both light and dark themes
 */
const FONT_COLOR_PRESETS = {
    light: [
        { name: 'Default', value: '#1f2937', description: 'Slate text default' },
        { name: 'Soft', value: '#404040', description: 'Secondary text (neutral-700)' },
        { name: 'Muted', value: '#525252', description: 'Tertiary text (neutral-600)' },
        { name: 'Warm', value: '#32302c', description: 'Warm neutral' },
        { name: 'Neutral', value: '#171717', description: 'Primary text (neutral-900)' }
    ],
    dark: [
        { name: 'Default', value: '#fafafa', description: 'Primary text (neutral-50)' },
        { name: 'Soft', value: '#d4d4d4', description: 'Secondary text (neutral-300)' },
        { name: 'Muted', value: '#a3a3a3', description: 'Tertiary text (neutral-400)' },
        { name: 'Warm', value: '#e5e5e5', description: 'Warm neutral' },
        { name: 'Cool', value: '#e2e8f0', description: 'Cool gray' }
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
                fontColor: '#1f2937',
                theme: 'default',
                lineNumbers: false,
                lineWrapping: true,
                showStatusBar: true,
                wysiwygMode: true
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
        this.pluginSettingsPanel = null;
        this.listenersAttached = false;
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
                wysiwygMode: settings.editor.wysiwyg_mode !== undefined ? settings.editor.wysiwyg_mode : this.state.editor.wysiwygMode
            };
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
                    wysiwyg_mode: this.state.editor.wysiwygMode
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
                this.callbacks.onSave({
                    editor: this.state.editor,
                    files: this.state.files,
                    vault_path: this.state.vaultPath
                });
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings: ' + error, 'error');
        } finally {
            this.state.isSaving = false;
            this.render();
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
                wysiwygMode: settings.editor.wysiwyg_mode !== undefined ? settings.editor.wysiwyg_mode : this.state.editor.wysiwygMode
            };
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
                ? FONT_COLOR_PRESETS.dark[0].value   // '#fafafa'
                : FONT_COLOR_PRESETS.light[0].value; // '#1f2937'
            this.state.editor.fontColor = defaultColor;
        }

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
                window.themeManager.applyTheme(this.state.editor.theme);
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
        if (!this.container || this.listenersAttached) {
            return;
        }

        this.container.addEventListener('click', this.boundClickHandler);
        this.container.addEventListener('change', this.boundChangeHandler);
        this.listenersAttached = true;
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
    
    close() {
        if (this.callbacks.onClose) {
            this.callbacks.onClose();
        }
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
                                           placeholder="#1f2937">
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
    }
}

// Export a singleton instance
export const userSettingsPanel = new UserSettingsPanel();
