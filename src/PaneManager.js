import { TabManager } from './TabManager.js';
import { TabBar } from './TabBar.js';
import { updateWordCount } from './app/chrome.js';

/**
 * PaneManager handles split view functionality with up to 2 panes
 */
export class PaneManager {
  constructor() {
    console.log('🔲 Initializing PaneManager');

    // State
    this.panes = new Map(); // paneId -> pane object
    this.activePaneId = null;
    this.isSplit = false;

    // DOM references
    this.container = null;
    this.paneContainer = null;
    this.divider = null;
    this.onDividerMouseDown = null;
    this.onDividerMouseMove = null;
    this.onDividerMouseUp = null;
    this.isDividerDragging = false;
    this.dividerDocumentListenersAttached = false;
    this.dividerDragState = null;

    // Event listeners
    this.listeners = {
      'pane-activated': [],
      'split-created': [],
      'split-removed': [],
    };

    // Initialize with single pane
    this.initializeSinglePane();

    // Register with window context if available
    if (window.windowContext) {
      window.windowContext.registerComponent('paneManager', this);
    }
  }

  /**
   * Initialize with a single pane
   */
  initializeSinglePane() {
    console.log('📋 Creating initial single pane');

    // Create container structure
    this.container = document.createElement('div');
    this.container.className = 'pane-manager-container';

    this.paneContainer = document.createElement('div');
    this.paneContainer.className = 'pane-container';
    this.container.appendChild(this.paneContainer);

    // Create first pane
    const paneId = 'pane-1';
    const firstPane = this.createPane(paneId);
    this.activePaneId = paneId;

    // Set up event listeners for the first pane
    this.setupPaneTabListeners(firstPane);
  }

  /**
   * Create a new pane
   * @param {string} paneId
   * @returns {Object} pane object
   */
  createPane(paneId) {
    console.log(`📄 Creating pane: ${paneId}`);

    // Create pane DOM structure
    const paneElement = document.createElement('div');
    paneElement.className = 'pane';
    paneElement.dataset.paneId = paneId;

    // Create tab bar container
    const tabBarContainer = document.createElement('div');
    tabBarContainer.className = 'pane-tab-bar';
    paneElement.appendChild(tabBarContainer);

    // Create editor wrapper
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'pane-editor-wrapper';
    paneElement.appendChild(editorWrapper);

    // Create TabManager and TabBar for this pane
    const tabManager = new TabManager(paneId);
    const tabBar = new TabBar(tabManager, tabBarContainer);

    // Listen for tab creation to attach editors to this pane's wrapper
    const attachTabToPane = ({ tab }) => {
      console.log(`📎 Attaching tab ${tab.id} to pane ${paneId}`);
      editorWrapper.appendChild(tab.editorContainer);
    };
    tabManager.on('tab-created', attachTabToPane);

    // Create pane object
    const paneClickHandler = (e) => {
      const target = e.target;
      // Skip activation if clicking inside CodeMirror's search panel or tooltips
      if (
        target &&
        target.closest &&
        (target.closest('.cm-search') || target.closest('.cm-tooltip'))
      ) {
        return;
      }
      // Skip activation when clicking on interactive form controls
      const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
        return;
      }
      this.activatePane(paneId);
    };

    const pane = {
      id: paneId,
      element: paneElement,
      tabManager,
      tabBar,
      editorWrapper,
      tabBarContainer,
      activationClickHandler: paneClickHandler,
      tabAttachmentListeners: [['tab-created', attachTabToPane]],
      paneTabListeners: [],
    };

    this.panes.set(paneId, pane);
    this.paneContainer.appendChild(paneElement);

    // Add click handler to activate pane
    // Do not steal focus when interacting with CodeMirror search panel or other inputs
    paneElement.addEventListener('click', paneClickHandler);

    return pane;
  }

  /**
   * Split the view into two panes
   */
  split() {
    if (this.isSplit) {
      console.log('⚠️ View already split');
      return;
    }

    console.log('✂️ Splitting view');

    // Add split class for styling
    this.paneContainer.classList.add('split');

    // Create divider
    this.divider = document.createElement('div');
    this.divider.className = 'pane-divider';

    // Create second pane
    const secondPaneId = 'pane-2';
    const secondPane = this.createPane(secondPaneId);

    // Insert divider before second pane
    this.paneContainer.insertBefore(this.divider, secondPane.element);

    // Set up resizable divider
    this.setupResizableDivider();

    // Set up event listeners for the second pane's TabManager
    this.setupPaneTabListeners(secondPane);

    // Create initial tab in second pane
    const newTabId = secondPane.tabManager.createTab(null, '');

    // Activate the tab
    secondPane.tabManager.activateTab(newTabId);

    // Activate the second pane
    this.activatePane(secondPaneId);

    this.isSplit = true;
    this.emit('split-created', { paneId: secondPaneId });
  }

  /**
   * Set up tab event listeners for a pane
   * @param {Object} pane
   */
  setupPaneTabListeners(pane) {
    const tabManager = pane.tabManager;
    this.teardownPaneTabListeners(pane);

    // Listen for tab changes
    const onTabChanged = ({ tabId }) => {
      const tab = tabManager.getActiveTab();
      if (tab && tab.editor) {
        // Update global references if this is the active pane
        if (this.activePaneId === pane.id) {
          window.currentEditor = tab.type === 'markdown' ? tab.editor : null;
          window.currentFile = tab.filePath;
          updateWordCount();
        }
      }
    };

    // Listen for tab creation
    const onTabCreated = ({ tabId, tab }) => {
      if (tab.editor) {
        // Apply theme if available
        const themeManager = window.currentThemeManager;
        if (themeManager && this.activePaneId === pane.id) {
          themeManager.setEditor(tab.editor);
        }
      }
    };

    pane.paneTabListeners = [
      ['tab-changed', onTabChanged],
      ['tab-created', onTabCreated],
    ];

    for (const [event, handler] of pane.paneTabListeners) {
      tabManager.on(event, handler);
    }
  }

  teardownPaneTabListeners(pane) {
    if (!pane?.tabManager || !pane.paneTabListeners) {
      return;
    }

    for (const [event, handler] of pane.paneTabListeners) {
      pane.tabManager.off(event, handler);
    }
    pane.paneTabListeners = [];
  }

  teardownPaneAttachmentListeners(pane) {
    if (!pane?.tabManager || !pane.tabAttachmentListeners) {
      return;
    }

    for (const [event, handler] of pane.tabAttachmentListeners) {
      pane.tabManager.off(event, handler);
    }
    pane.tabAttachmentListeners = [];
  }

  teardownPaneDomListeners(pane) {
    if (pane?.element && pane.activationClickHandler) {
      pane.element.removeEventListener('click', pane.activationClickHandler);
      pane.activationClickHandler = null;
    }
  }

  teardownPaneListeners(pane) {
    this.teardownPaneTabListeners(pane);
    this.teardownPaneAttachmentListeners(pane);
    this.teardownPaneDomListeners(pane);
  }

  /**
   * Remove split and return to single pane
   */
  async unsplit() {
    if (!this.isSplit) {
      console.log('⚠️ View not split');
      return false;
    }

    console.log('🔗 Removing split');

    const secondPane = this.panes.get('pane-2');
    if (secondPane) {
      // Check for unsaved changes
      const hasUnsavedChanges = Array.from(secondPane.tabManager.tabs.values()).some(
        (tab) => tab.isDirty,
      );

      if (hasUnsavedChanges) {
        const confirmed = confirm('The second pane has unsaved changes. Close anyway?');
        if (!confirmed) return false;
      }

      const tabIds = [...secondPane.tabManager.tabs.keys()];
      for (const tabId of tabIds) {
        await secondPane.tabManager.closeTab(tabId, true);
      }

      this.teardownPaneListeners(secondPane);

      // Remove second pane
      secondPane.element.remove();
      this.panes.delete('pane-2');

      // Remove divider
      if (this.divider) {
        this.teardownResizableDivider();
        this.divider.remove();
        this.divider = null;
      }

      // Remove split class
      this.paneContainer.classList.remove('split');

      // Activate first pane
      this.activatePane('pane-1');

      this.isSplit = false;
      this.emit('split-removed', {});
      return true;
    }

    return false;
  }

  /**
   * Set up resizable divider functionality
   */
  setupResizableDivider() {
    const pane1 = this.panes.get('pane-1').element;
    const pane2 = this.panes.get('pane-2').element;
    this.dividerDragState = {
      pane1,
      pane2,
      startX: 0,
      startWidths: [],
    };

    this.onDividerMouseMove = (e) => {
      if (!this.isDividerDragging || !this.dividerDragState || !this.divider) return;

      const { pane1, pane2, startX, startWidths } = this.dividerDragState;
      const deltaX = e.clientX - startX;
      const containerWidth = this.paneContainer.offsetWidth;
      const dividerWidth = this.divider.offsetWidth;

      // Calculate new widths
      const newWidth1 = startWidths[0] + deltaX;
      const newWidth2 = startWidths[1] - deltaX;

      // Set minimum pane width (200px)
      const minPaneWidth = 200;

      if (newWidth1 >= minPaneWidth && newWidth2 >= minPaneWidth) {
        // Calculate percentages
        const availableWidth = containerWidth - dividerWidth;
        const percent1 = (newWidth1 / availableWidth) * 100;
        const percent2 = (newWidth2 / availableWidth) * 100;

        // Apply new widths
        pane1.style.flex = `0 0 ${percent1}%`;
        pane2.style.flex = `0 0 ${percent2}%`;
      }
    };

    this.onDividerMouseUp = () => {
      this.removeDividerDragListeners();
    };

    this.onDividerMouseDown = (e) => {
      this.removeDividerDragListeners();
      this.isDividerDragging = true;
      this.dividerDragState.startX = e.clientX;
      this.dividerDragState.startWidths = [pane1.offsetWidth, pane2.offsetWidth];

      // Add resizing class for visual feedback
      document.body.style.cursor = 'col-resize';
      this.divider.classList.add('resizing');
      document.addEventListener('mousemove', this.onDividerMouseMove);
      document.addEventListener('mouseup', this.onDividerMouseUp);
      this.dividerDocumentListenersAttached = true;

      // Prevent text selection while dragging
      e.preventDefault();
    };

    this.divider.addEventListener('mousedown', this.onDividerMouseDown);
  }

  removeDividerDragListeners() {
    if (this.dividerDocumentListenersAttached && this.onDividerMouseMove) {
      document.removeEventListener('mousemove', this.onDividerMouseMove);
    }
    if (this.dividerDocumentListenersAttached && this.onDividerMouseUp) {
      document.removeEventListener('mouseup', this.onDividerMouseUp);
    }
    this.dividerDocumentListenersAttached = false;
    this.isDividerDragging = false;
    document.body.style.cursor = '';
    this.divider?.classList.remove('resizing');
  }

  teardownResizableDivider() {
    this.removeDividerDragListeners();
    if (this.divider && this.onDividerMouseDown) {
      this.divider.removeEventListener('mousedown', this.onDividerMouseDown);
    }
    this.onDividerMouseDown = null;
    this.onDividerMouseMove = null;
    this.onDividerMouseUp = null;
    this.dividerDragState = null;
  }

  /**
   * Activate a pane
   * @param {string} paneId
   */
  activatePane(paneId) {
    if (!this.panes.has(paneId)) {
      console.error(`❌ Pane ${paneId} not found`);
      return;
    }

    console.log(`🎯 Activating pane: ${paneId}`);

    // Remove active class from all panes
    this.panes.forEach((pane) => {
      pane.element.classList.remove('active');
    });

    // Add active class to selected pane
    const pane = this.panes.get(paneId);
    pane.element.classList.add('active');

    this.activePaneId = paneId;

    // Update current editor if the pane has an active tab
    const activeTab = pane.tabManager.getActiveTab();
    if (activeTab && activeTab.editor) {
      window.currentEditor = activeTab.type === 'markdown' ? activeTab.editor : null;
      window.currentFile = activeTab.filePath;
      updateWordCount();
      // Focus the editor
      setTimeout(() => {
        if (!this.panes.has(paneId) || this.activePaneId !== paneId) {
          return;
        }
        if (pane.tabManager.getActiveTab() !== activeTab) {
          return;
        }
        activeTab.editor.focus();
      }, 0);
    }

    this.emit('pane-activated', { paneId });
  }

  /**
   * Get the active pane's TabManager
   * @returns {TabManager|null}
   */
  getActiveTabManager() {
    if (!this.activePaneId) return null;
    const pane = this.panes.get(this.activePaneId);
    return pane ? pane.tabManager : null;
  }

  /**
   * Find which pane contains a tab with the given file path
   * @param {string} filePath
   * @returns {Object|null} pane object
   */
  findPaneByFilePath(filePath) {
    for (const pane of this.panes.values()) {
      const tab = pane.tabManager.findTabByPath(filePath);
      if (tab) {
        return pane;
      }
    }
    return null;
  }

  /**
   * Get a specific pane's TabManager
   * @param {string} paneId
   * @returns {TabManager|null}
   */
  getTabManager(paneId) {
    const pane = this.panes.get(paneId);
    return pane ? pane.tabManager : null;
  }

  /**
   * Get the number of panes
   * @returns {number}
   */
  getPaneCount() {
    return this.panes.size;
  }

  /**
   * Mount the PaneManager to a DOM element
   * @param {HTMLElement} parentElement
   */
  mount(parentElement) {
    console.log('🔧 Mounting PaneManager');
    parentElement.appendChild(this.container);
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
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }
  }

  /**
   * Emit event
   * @param {string} event
   * @param {Object} data
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => callback(data));
    }
  }

  /**
   * Update layout after window resize or zen mode toggle
   */
  updateLayout() {
    console.log('📐 Updating PaneManager layout');

    // Force all editors to recalculate their sizes
    for (const [paneId, pane] of this.panes) {
      if (pane.tabManager) {
        const activeTab = pane.tabManager.getActiveTab();
        if (activeTab && activeTab.editor && activeTab.editor.view) {
          // Request CodeMirror to remeasure
          activeTab.editor.view.requestMeasure();
        }
      }
    }

    // If we have split panes, ensure the divider is positioned correctly
    if (this.panes.size > 1 && this.divider) {
      // Force recalculation of pane widths
      const container = this.paneContainer;
      if (container) {
        const pane1 = container.querySelector('.pane:first-child');
        const pane2 = container.querySelector('.pane:last-child');
        if (pane1 && pane2) {
          // Trigger resize observer if needed
          void pane1.offsetHeight;
          void pane2.offsetHeight;
        }
      }
    }
  }

  /**
   * Cleanup method for window shutdown
   */
  async cleanup() {
    console.log('🧹 Cleaning up PaneManager');

    // Close all tabs in all panes
    for (const [paneId, pane] of this.panes) {
      if (pane.tabManager) {
        const tabIds = [...pane.tabManager.tabs.keys()];
        for (const tabId of tabIds) {
          await pane.tabManager.closeTab(tabId, true);
        }
        this.teardownPaneListeners(pane);
        await pane.tabManager.cleanup();
      }
    }

    this.teardownResizableDivider();

    // Clear listeners
    for (const event in this.listeners) {
      this.listeners[event] = [];
    }

    // Clear references
    this.panes.clear();
    this.container = null;
    this.paneContainer = null;
    this.divider = null;
  }
}
