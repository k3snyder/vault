import { invoke } from '@tauri-apps/api/core';
import { MarkdownEditor } from './editor/markdown-editor.js';
import { PDFTab } from './pdf/PDFTab.js';
import { CsvEditor } from './csv/CsvEditor.js';
import { SketchTab } from './sketch/SketchTab.js';
import { BoxNoteViewer } from './boxnote/BoxNoteViewer.js';
import { HtmlViewer } from './html/HtmlViewer.js';

// Import CSV editor styles
import './csv/csv-editor.css';

/**
 * Check if the csv-support plugin is enabled
 * @returns {Promise<boolean>} True if CSV support is enabled
 */
async function isCsvSupportEnabled() {
    try {
        // csv-support is a bundled plugin - read from localStorage
        const key = 'bundled_plugin_csv-support';
        const rawValue = localStorage.getItem(key);
        console.log('🔧 [TabManager] CSV plugin localStorage raw:', rawValue);
        const settings = JSON.parse(rawValue || '{}');
        console.log('🔧 [TabManager] CSV plugin settings parsed:', settings);
        // If enabled is explicitly set, use that value
        // Default to true (enabled by default for free tier)
        if (settings.enabled !== undefined) {
            console.log('🔧 [TabManager] CSV enabled explicitly set to:', settings.enabled);
            return settings.enabled;
        }
        console.log('🔧 [TabManager] CSV enabled not set, defaulting to true');
        return true; // Default to enabled
    } catch (e) {
        console.log('🔧 [TabManager] CSV plugin settings error:', e);
        // If settings not found, default to enabled (free tier on by default)
        return true;
    }
}

/**
 * TabManager handles multiple editor tabs with support for future split views
 */
export class TabManager {
    constructor(paneId = 'main') {
        this.tabs = new Map(); // tabId -> Tab object
        this.activeTabId = null;
        this.tabOrder = []; // Array of tabIds in display order
        this.maxTabs = 5;
        this.nextTabId = 1;
        
        // Future-proofing for split views
        this.panes = [{
            id: paneId,
            tabIds: [], // Tabs in this pane
            activeTabId: null
        }];
        
        this.listeners = {
            'tab-changed': [],
            'tab-closed': [],
            'tab-created': [],
            'tabs-reordered': [],
            'tab-navigated': []
        };
        
        // Register with window context if available
        if (window.windowContext) {
            window.windowContext.registerComponent('tabManager', this);
        }
    }
    
    /**
     * Create a new tab
     * @param {string} filePath - Path to the file (null for new untitled tab)
     * @param {string} content - Initial content
     * @param {boolean} isPDF - Whether this is a PDF file
     * @param {boolean} openAsCsv - Whether to open as CSV editor (only for .csv files with plugin enabled)
     * @returns {string} tabId
     */
    createTab(filePath = null, content = '', isPDF = false, openAsCsv = false) {
        if (this.tabs.size >= this.maxTabs) {
            throw new Error(`Maximum ${this.maxTabs} tabs allowed`);
        }

        const tabId = `tab-${this.nextTabId++}`;
        const editorContainer = document.createElement('div');
        editorContainer.className = 'tab-editor-container';
        editorContainer.style.display = 'none';
        editorContainer.dataset.tabId = tabId;

        let editor = null;
        let pdfTab = null;
        let csvEditor = null;
        let sketchTab = null;
        let boxNoteViewer = null;
        let htmlViewer = null;

        // Determine if this is a CSV file (for type assignment, even if opening as plain text)
        const isCsvFile = filePath && filePath.toLowerCase().endsWith('.csv');
        const isExcalidraw = filePath && filePath.toLowerCase().endsWith('.excalidraw');
        const isBoxNoteFile = filePath && filePath.toLowerCase().endsWith('.boxnote');
        const isHtmlFile = filePath && /\.(html|htm)$/iu.test(filePath);

        // Check if this is a PDF file
        if (isPDF || (filePath && filePath.toLowerCase().endsWith('.pdf'))) {
            console.log('Creating PDF tab for:', filePath);
            // For PDF files, create a PDFTab instance
            pdfTab = new PDFTab(filePath, this, this.panes[0].id);
            // Store reference for cleanup
            editorContainer.__pdfTabInstance = pdfTab;

            // Create PDF content asynchronously
            pdfTab.createContent().then(pdfContainer => {
                editorContainer.appendChild(pdfContainer);
            }).catch(error => {
                console.error('Error creating PDF tab:', error);
                editorContainer.innerHTML = `<div class="error-state">Error loading PDF: ${error.message}</div>`;
            });
        } else if (isCsvFile && openAsCsv) {
            // CSV file with csv-support plugin enabled - open in tabular editor
            console.log('Creating CSV tab for:', filePath);
            // For CSV files, create a CsvEditor instance
            csvEditor = new CsvEditor(filePath, this, this.panes[0].id);
            // Store reference for cleanup
            editorContainer.__csvEditorInstance = csvEditor;

            // Mount CSV editor asynchronously
            csvEditor.mount().then(csvContainer => {
                editorContainer.appendChild(csvContainer);
            }).catch(error => {
                console.error('Error creating CSV tab:', error);
                editorContainer.innerHTML = `<div class="error-state">Error loading CSV: ${error.message}</div>`;
            });
        } else if (isExcalidraw) {
            // Excalidraw sketch file
            console.log('Creating Sketch tab for:', filePath);
            sketchTab = new SketchTab(filePath, this, this.panes[0].id);
            editorContainer.__sketchTabInstance = sketchTab;

            sketchTab.createContent().then(sketchContainer => {
                editorContainer.appendChild(sketchContainer);
            }).catch(error => {
                console.error('Error creating Sketch tab:', error);
                editorContainer.innerHTML = `<div class="error-state">Error loading sketch: ${error.message}</div>`;
            });
        } else if (isBoxNoteFile) {
            console.log('Creating Box Note viewer for:', filePath);
            boxNoteViewer = new BoxNoteViewer(filePath, this, this.panes[0].id);
            editor = boxNoteViewer;
            editorContainer.__boxNoteViewerInstance = boxNoteViewer;

            boxNoteViewer.mount().then(boxNoteContainer => {
                editorContainer.appendChild(boxNoteContainer);
            }).catch(error => {
                console.error('Error creating Box Note viewer:', error);
                editorContainer.innerHTML = `<div class="error-state">Error loading Box Note: ${error.message}</div>`;
            });
        } else if (isHtmlFile) {
            console.log('Creating HTML viewer for:', filePath);
            htmlViewer = new HtmlViewer(filePath, this, this.panes[0].id);
            editor = htmlViewer;
            editorContainer.__htmlViewerInstance = htmlViewer;

            htmlViewer.mount().then(htmlContainer => {
                editorContainer.appendChild(htmlContainer);
            }).catch(error => {
                console.error('Error creating HTML viewer:', error);
                editorContainer.innerHTML = `<div class="error-state">Error loading HTML: ${error.message}</div>`;
            });
        } else {
            // For regular files (including CSV with plugin disabled), create markdown editor
            if (isCsvFile && !openAsCsv) {
                console.log('Opening CSV as plain text (plugin disabled):', filePath);
            }
            editor = new MarkdownEditor(editorContainer);
        }

        // Determine tab type
        let tabType = 'markdown';
        if (isPDF || (filePath && filePath.toLowerCase().endsWith('.pdf'))) {
            tabType = 'pdf';
        } else if (isCsvFile && openAsCsv) {
            // Only set CSV type when actually using CSV editor
            tabType = 'csv';
        } else if (isExcalidraw) {
            tabType = 'sketch';
        } else if (isBoxNoteFile) {
            tabType = 'boxnote';
        } else if (isHtmlFile) {
            tabType = 'html';
        }
        // Note: CSV files with plugin disabled remain as 'markdown' type (plain text)

        const tab = {
            id: tabId,
            filePath,
            title: filePath ? filePath.split('/').pop() : 'Untitled',
            editor,
            pdfTab,
            csvEditor,
            sketchTab,
            boxNoteViewer,
            htmlViewer,
            editorContainer,
            isDirty: false,
            content: content,
            type: tabType,
            navigationHistory: {
                history: filePath ? [filePath] : [],
                currentIndex: 0
            }
        };

        // Set tabId on sketchTab for dirty state management
        if (sketchTab) {
            sketchTab.tabId = tabId;
        }

        this.tabs.set(tabId, tab);
        this.tabOrder.push(tabId);
        this.panes[0].tabIds.push(tabId);

        // Only set content for markdown tabs
        if (tabType === 'markdown') {
            if (content) {
                // Initial open: allow default cursor init
                editor.setContent(content, false, filePath, false);
                editor.currentFile = filePath;
            } else if (!filePath) {
                // Show new tab screen for untitled tabs
                import('./NewTabScreen.js').then(module => {
                    new module.NewTabScreen(editorContainer);
                });
            }
        }

        this.emit('tab-created', { tabId, tab });
        return tabId;
    }
    
    /**
     * Activate a tab
     * @param {string} tabId
     */
    activateTab(tabId) {
        if (!this.tabs.has(tabId)) {
            throw new Error(`Tab ${tabId} not found`);
        }
        
        const previousTabId = this.activeTabId;
        
        // Hide previous tab
        if (previousTabId && this.tabs.has(previousTabId)) {
            const prevTab = this.tabs.get(previousTabId);
            prevTab.editorContainer.style.display = 'none';
        }
        
        // Show new tab
        const tab = this.tabs.get(tabId);
        tab.editorContainer.style.display = 'block';
        
        this.activeTabId = tabId;
        this.panes[0].activeTabId = tabId;
        
        // Focus the editor, PDF viewer, CSV editor, or sketch tab
        setTimeout(() => {
            if (tab.type === 'pdf' && tab.pdfTab) {
                tab.pdfTab.focus();
            } else if (tab.type === 'csv' && tab.csvEditor) {
                tab.csvEditor.focus();
            } else if (tab.type === 'sketch' && tab.sketchTab) {
                tab.sketchTab.focus();
            } else if (tab.type === 'boxnote' && tab.editor) {
                tab.editor.focus();
            } else if (tab.type === 'html' && tab.editor) {
                tab.editor.focus();
            } else if (tab.editor) {
                tab.editor.focus();
            }
        }, 0);
        
        this.emit('tab-changed', { tabId, previousTabId });
    }
    
    /**
     * Close a tab
     * @param {string} tabId
     * @param {boolean} force - Force close without checking for unsaved changes
     * @returns {boolean} Whether the tab was closed
     */
    async closeTab(tabId, force = false) {
        if (!this.tabs.has(tabId)) {
            return false;
        }

        const tab = this.tabs.get(tabId);

        // Check for unsaved changes
        if (!force && tab.filePath) {
            let hasUnsavedChanges = tab.isDirty;

            // For CSV tabs, check the editor's internal dirty state
            if (tab.type === 'csv' && tab.csvEditor) {
                hasUnsavedChanges = tab.csvEditor.hasUnsavedChanges();
            }

            // For sketch tabs, check the sketchTab's dirty state
            if (tab.type === 'sketch' && tab.sketchTab) {
                hasUnsavedChanges = tab.sketchTab.hasUnsavedChanges();
            }

            if (hasUnsavedChanges) {
                const confirmed = confirm(`"${tab.title}" has unsaved changes. Close anyway?`);
                if (!confirmed) {
                    return false;
                }
            }
        }
        
        // Clean up PDF tab if needed
        if (tab.type === 'pdf' && tab.pdfTab) {
            tab.pdfTab.destroy();
        }

        // Clean up CSV editor if needed
        if (tab.type === 'csv' && tab.csvEditor) {
            console.log('Destroying CSV editor for tab:', tabId);
            tab.csvEditor.unmount();
        }

        // Clean up sketch tab if needed
        if (tab.type === 'sketch' && tab.sketchTab) {
            console.log('Destroying sketch tab for:', tabId);
            tab.sketchTab.destroy();
        }

        // Clean up Box Note viewer if needed
        if (tab.type === 'boxnote' && tab.editor) {
            console.log('Destroying Box Note viewer for tab:', tabId);
            tab.editor.destroy();
        }

        // Clean up HTML viewer if needed
        if (tab.type === 'html' && tab.editor) {
            console.log('Destroying HTML viewer for tab:', tabId);
            tab.editor.destroy();
        }

        // Clean up markdown editor if needed
        if (tab.type === 'markdown' && tab.editor) {
            console.log('Destroying markdown editor for tab:', tabId);
            tab.editor.destroy();
        }
        
        // Remove from DOM
        tab.editorContainer.remove();
        
        // Remove from data structures
        this.tabs.delete(tabId);
        this.tabOrder = this.tabOrder.filter(id => id !== tabId);
        this.panes[0].tabIds = this.panes[0].tabIds.filter(id => id !== tabId);
        
        // If this was the active tab, activate another
        if (this.activeTabId === tabId) {
            const newActiveIndex = Math.max(0, this.tabOrder.indexOf(tabId) - 1);
            if (this.tabOrder.length > 0) {
                this.activateTab(this.tabOrder[newActiveIndex]);
            } else {
                this.activeTabId = null;
                this.panes[0].activeTabId = null;
            }
        }
        
        this.emit('tab-closed', { tabId });
        return true;
    }
    
    /**
     * Get the active tab
     * @returns {Object|null}
     */
    getActiveTab() {
        return this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    }
    
    /**
     * Get all tabs in order
     * @returns {Array}
     */
    getTabs() {
        return this.tabOrder.map(id => this.tabs.get(id));
    }
    
    /**
     * Find tab by file path
     * @param {string} filePath
     * @returns {Object|null}
     */
    findTabByPath(filePath) {
        for (const tab of this.tabs.values()) {
            if (tab.filePath === filePath) {
                return tab;
            }
        }
        return null;
    }
    
    /**
     * Reorder tabs
     * @param {string} tabId - Tab to move
     * @param {number} newIndex - New position
     */
    reorderTabs(tabId, newIndex) {
        const oldIndex = this.tabOrder.indexOf(tabId);
        if (oldIndex === -1) return;
        
        this.tabOrder.splice(oldIndex, 1);
        this.tabOrder.splice(newIndex, 0, tabId);
        
        // Update pane tab order too
        const paneIndex = this.panes[0].tabIds.indexOf(tabId);
        if (paneIndex !== -1) {
            this.panes[0].tabIds.splice(paneIndex, 1);
            this.panes[0].tabIds.splice(newIndex, 0, tabId);
        }
        
        this.emit('tabs-reordered', { tabId, oldIndex, newIndex });
    }
    
    /**
     * Mark tab as dirty (has unsaved changes)
     * @param {string} tabId
     * @param {boolean} isDirty
     */
    setTabDirty(tabId, isDirty) {
        const tab = this.tabs.get(tabId);
        if (tab) {
            tab.isDirty = isDirty;
        }
    }
    
    /**
     * Update tab title
     * @param {string} tabId
     * @param {string} title
     */
    updateTabTitle(tabId, title) {
        const tab = this.tabs.get(tabId);
        if (tab) {
            tab.title = title;
        }
    }
    
    /**
     * Add event listener
     * @param {string} event
     * @param {Function} callback
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }
    
    /**
     * Remove event listener
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }
    
    /**
     * Emit event
     * @param {string} event
     * @param {Object} data
     */
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }
    
    /**
     * Find a tab by file path
     * @param {string} filePath
     * @returns {Object|null} Tab object or null
     */
    findTabByPath(filePath) {
        for (const [tabId, tab] of this.tabs) {
            if (tab.filePath === filePath) {
                return tab;
            }
        }
        return null;
    }
    
    /**
     * Open a file in a new tab
     * @param {string} filePath
     * @param {string} content - Content for non-PDF files
     * @returns {Promise<string>} tabId
     */
    async openFile(filePath, content = '') {
        console.log('🚀🚀🚀 TabManager.openFile called:', filePath);

        // Check if it's a PDF
        const isPDF = filePath && filePath.toLowerCase().endsWith('.pdf');

        // Check if it's a CSV and if CSV support is enabled
        const isCSV = filePath && filePath.toLowerCase().endsWith('.csv');
        let openAsCsv = false;

        if (isCSV) {
            console.log('🚀🚀🚀 Detected CSV file, checking plugin status...');
            // Check if csv-support plugin is enabled
            openAsCsv = await isCsvSupportEnabled();
            console.log('🚀🚀🚀 CSV file detected, CSV support enabled:', openAsCsv);
        }

        // Create the tab with appropriate type
        const tabId = this.createTab(filePath, content, isPDF, openAsCsv);

        // Activate it
        this.activateTab(tabId);

        return tabId;
    }
    
    /**
     * Navigate to a file within a tab, managing history
     * @param {string} tabId - Tab to navigate in
     * @param {string} filePath - File path to navigate to
     * @param {boolean} isHistoryNavigation - Whether this is from back/forward
     */
    async navigateToFile(tabId, filePath, isHistoryNavigation = false) {
        const tab = this.tabs.get(tabId);
        if (!tab) return;
        
        // If not a history navigation, update history
        if (!isHistoryNavigation) {
            const history = tab.navigationHistory;
            
            // If we're not at the end of history, truncate forward history
            if (history.currentIndex < history.history.length - 1) {
                history.history = history.history.slice(0, history.currentIndex + 1);
            }
            
            // Add new path if it's different from current
            if (history.history[history.currentIndex] !== filePath) {
                history.history.push(filePath);
                history.currentIndex = history.history.length - 1;
            }
        }
        
        // Update tab's current file path
        tab.filePath = filePath;
        tab.title = filePath.split('/').pop();
        
        // Emit navigation event for UI updates
        this.emit('tab-navigated', { tabId, filePath });
    }
    
    /**
     * Check if tab can go back in history
     * @param {string} tabId
     * @returns {boolean}
     */
    canGoBack(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab) return false;
        return tab.navigationHistory.currentIndex > 0;
    }
    
    /**
     * Check if tab can go forward in history
     * @param {string} tabId
     * @returns {boolean}
     */
    canGoForward(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab) return false;
        const history = tab.navigationHistory;
        return history.currentIndex < history.history.length - 1;
    }
    
    /**
     * Navigate back in tab history
     * @param {string} tabId
     * @returns {string|null} The file path navigated to
     */
    async goBack(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab || !this.canGoBack(tabId)) return null;
        
        const history = tab.navigationHistory;
        history.currentIndex--;
        const filePath = history.history[history.currentIndex];
        
        await this.navigateToFile(tabId, filePath, true);
        return filePath;
    }
    
    /**
     * Navigate forward in tab history
     * @param {string} tabId
     * @returns {string|null} The file path navigated to
     */
    async goForward(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab || !this.canGoForward(tabId)) return null;
        
        const history = tab.navigationHistory;
        history.currentIndex++;
        const filePath = history.history[history.currentIndex];
        
        await this.navigateToFile(tabId, filePath, true);
        return filePath;
    }
    
    /**
     * Get state for persistence
     * @returns {Object}
     */
    getState() {
        return {
            tabs: this.tabOrder.map(id => {
                const tab = this.tabs.get(id);
                return {
                    id: tab.id,
                    filePath: tab.filePath,
                    title: tab.title
                };
            }),
            activeTabId: this.activeTabId
        };
    }
    
    /**
     * Restore from saved state
     * @param {Object} state
     */
    async restoreState(state) {
        // Implementation for restoring tabs from saved state
        // Will be implemented when we add persistence
    }
    
    /**
     * Cleanup method for window shutdown
     */
    async cleanup() {
        console.log('🧹 Cleaning up TabManager');
        
        // Close all tabs
        const tabIds = [...this.tabs.keys()];
        for (const tabId of tabIds) {
            await this.closeTab(tabId, true);
        }
        
        // Clear listeners
        for (const event in this.listeners) {
            this.listeners[event] = [];
        }
        
        // Clear state
        this.tabs.clear();
        this.tabOrder = [];
        this.activeTabId = null;
    }
}
