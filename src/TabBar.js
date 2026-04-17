import { NewTabScreen } from './NewTabScreen.js';
import { icons } from './icons/icon-utils.js';

/**
 * TabBar UI component for managing editor tabs
 */
export class TabBar {
    constructor(tabManager, container) {
        this.tabManager = tabManager;
        this.container = container;
        this.tabElements = new Map(); // tabId -> DOM element
        
        this.draggedTab = null;
        this.draggedIndex = null;
        
        this.init();
        this.bindEvents();
    }
    
    init() {
        // Create tab bar structure
        // New Tab button is inside tab-list to flow dynamically after last tab
        this.container.innerHTML = `
            <div class="tab-bar">
                <div class="tab-list" id="tab-list">
                    <button class="tab-add-button" id="tab-add-button" title="New Tab">
                        ${icons.plus({ size: 12 })}
                    </button>
                </div>
                <div class="tab-bar-spacer"></div>
                <button class="highlights-summary-button" id="highlights-summary-button" title="Generate Highlights Summary (Cmd+Shift+H)" style="display: none;">
                    ${icons.star()}
                </button>
                <button class="copy-text-button" id="copy-text-button" title="Copy All Text" style="display: none;">
                    ${icons.copy()}
                </button>
            </div>
        `;
        
        this.tabList = this.container.querySelector('#tab-list');
        this.addButton = this.container.querySelector('#tab-add-button');
        this.highlightsButton = this.container.querySelector('#highlights-summary-button');
        this.copyButton = this.container.querySelector('#copy-text-button');
    }
    
    bindEvents() {
        // Tab manager events
        this.tabManager.on('tab-created', ({ tabId, tab }) => {
            this.addTabElement(tabId, tab);
        });
        
        this.tabManager.on('tab-closed', ({ tabId }) => {
            this.removeTabElement(tabId);
        });
        
        this.tabManager.on('tab-changed', ({ tabId }) => {
            this.setActiveTab(tabId);
        });
        
        this.tabManager.on('tabs-reordered', () => {
            this.reorderTabElements();
        });
        
        // Add button click
        this.addButton.addEventListener('click', () => {
            this.handleNewTab();
        });
        
        // Highlights button click
        this.highlightsButton.addEventListener('click', () => {
            if (window.generateHighlightsSummary) {
                window.generateHighlightsSummary();
            }
        });
        
        // Copy button click
        this.copyButton.addEventListener('click', () => {
            if (window.copyAllText) {
                window.copyAllText();
            }
        });
        
        // Tab list drag events for reordering
        this.tabList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(e.clientX);
            const dragged = document.querySelector('.dragging');
            if (afterElement == null) {
                this.tabList.appendChild(dragged);
            } else {
                this.tabList.insertBefore(dragged, afterElement);
            }
        });
    }
    
    /**
     * Get the appropriate icon for a tab based on its type
     * @param {Object} tab - Tab object with type property
     * @returns {string} Icon HTML string
     */
    getTabIcon(tab) {
        switch (tab.type) {
            case 'csv':
                // Use layout-grid icon for CSV files (tabular data)
                return icons.layoutGrid({ size: 14 });
            case 'boxnote':
                return icons.fileLock({ size: 14 });
            case 'html':
                return icons.eye({ size: 14 });
            case 'pdf':
                // Use file icon for PDF
                return icons.file({ size: 14 });
            default:
                // Default to fileText for markdown/text files
                return icons.fileText({ size: 14 });
        }
    }

    addTabElement(tabId, tab) {
        const tabElement = document.createElement('div');
        tabElement.className = 'tab';
        tabElement.dataset.tabId = tabId;
        tabElement.draggable = true;

        // Get appropriate icon based on tab type
        const tabIcon = this.getTabIcon(tab);

        tabElement.innerHTML = `
            <span class="tab-icon">${tabIcon}</span>
            <span class="tab-title">${this.escapeHtml(tab.title)}</span>
            <button class="tab-close" title="Close">
                ${icons.x({ size: 12 })}
            </button>
        `;
        
        // Click to activate
        tabElement.addEventListener('click', (e) => {
            if (!e.target.closest('.tab-close')) {
                this.tabManager.activateTab(tabId);
            }
        });
        
        // Close button
        const closeButton = tabElement.querySelector('.tab-close');
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.tabManager.closeTab(tabId);
        });
        
        // Drag events
        tabElement.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            tabElement.classList.add('dragging');
            this.draggedTab = tabId;
            this.draggedIndex = Array.from(this.tabList.children).indexOf(tabElement);
        });
        
        tabElement.addEventListener('dragend', (e) => {
            tabElement.classList.remove('dragging');
            const newIndex = Array.from(this.tabList.children).indexOf(tabElement);
            if (this.draggedIndex !== newIndex) {
                this.tabManager.reorderTabs(this.draggedTab, newIndex);
            }
            this.draggedTab = null;
            this.draggedIndex = null;
        });
        
        // Insert before the add button so tabs appear before it
        this.tabList.insertBefore(tabElement, this.addButton);
        this.tabElements.set(tabId, tabElement);
        
        // Update dirty indicator
        this.updateTabDirtyState(tabId, tab.isDirty);
    }
    
    removeTabElement(tabId) {
        const element = this.tabElements.get(tabId);
        if (element) {
            element.remove();
            this.tabElements.delete(tabId);
        }
    }
    
    setActiveTab(tabId) {
        // Remove active class from all tabs
        this.tabElements.forEach(element => {
            element.classList.remove('active');
        });
        
        // Add active class to current tab
        const activeElement = this.tabElements.get(tabId);
        if (activeElement) {
            activeElement.classList.add('active');
        }
        
        // Update highlights button visibility
        this.updateHighlightsButtonVisibility(tabId);
    }
    
    updateHighlightsButtonVisibility(tabId) {
        const tabs = this.tabManager.getTabs();
        const tab = tabs.find(t => t.id === tabId);
        
        // Show highlights only for markdown, but allow copy for Box Notes too.
        if (tab && tab.filePath && tab.filePath.endsWith('.md')) {
            this.highlightsButton.style.display = 'flex';
            this.copyButton.style.display = 'flex';
        } else if (tab && (tab.type === 'boxnote' || tab.type === 'html')) {
            this.highlightsButton.style.display = 'none';
            this.copyButton.style.display = 'flex';
        } else {
            this.highlightsButton.style.display = 'none';
            this.copyButton.style.display = 'none';
        }
    }
    
    updateTabTitle(tabId, title) {
        const element = this.tabElements.get(tabId);
        if (element) {
            const titleSpan = element.querySelector('.tab-title');
            titleSpan.textContent = title;
        }
    }
    
    updateTabDirtyState(tabId, isDirty) {
        const element = this.tabElements.get(tabId);
        if (element) {
            if (isDirty) {
                element.classList.add('dirty');
            } else {
                element.classList.remove('dirty');
            }
        }
    }
    
    reorderTabElements() {
        // Re-add all tabs in the correct order, keeping add button last
        const tabs = this.tabManager.getTabs();
        tabs.forEach(tab => {
            const element = this.tabElements.get(tab.id);
            if (element) {
                this.tabList.insertBefore(element, this.addButton);
            }
        });
    }
    
    getDragAfterElement(x) {
        const draggableElements = [...this.tabList.querySelectorAll('.tab:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    handleNewTab() {
        if (this.tabManager.tabs.size >= this.tabManager.maxTabs) {
            alert(`Maximum ${this.tabManager.maxTabs} tabs allowed`);
            return;
        }
        
        const tabId = this.tabManager.createTab();
        this.tabManager.activateTab(tabId);
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
