// Tauri v2 Modern Approach with CodeMirror Editor Integration

// Initialize Node.js shims for browser compatibility (must be first!)
import './shims/process-shim.js';

// Import Tauri v2 APIs and editor components
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ask } from '@tauri-apps/plugin-dialog';
import { ThemeManager } from './editor/theme-manager.js';
import { normalizeThemeOverrides } from './tokens/theme-overrides.js';
import { markdownExtensions, markdownStyles } from './editor/markdown-extensions.js';
import { PaneManager } from './PaneManager.js';
import { EnhancedChatPanel } from './chat/EnhancedChatPanel.js';
import { userSettingsPanel } from './settings/UserSettingsPanel.js';
import { WidgetSidebar } from './widgets/WidgetSidebar.js';
import { perfMonitor } from './performance/PerformanceMonitor.js';
import { perfTestSuite } from './performance/PerformanceTestSuite.js';
import { globalSearch } from './search/GlobalSearch.js';
import windowContext from './contexts/WindowContext.js';
import { VaultPicker } from './components/VaultPicker.js';
import pluginHub from './plugin-hub/PluginHub.js';
import './utils/uuid-utils.js';
import './utils/readwise-uuid-fix.js';
import { icons } from './icons/icon-utils.js';
import { asCommandError } from './utils/command-error.js';
import './plugin-hub/components/Toast.css';
import EntitlementManager from './services/entitlement-manager.js';
import GlobalSearchPanel from './components/GlobalSearchPanel.js';
import PACASDBClient from './services/pacasdb-client.js';
import VaultSync from './services/vault-sync.js';
import { normalizeImageLocation } from './utils/image-paths.js';
import { escapeHtml } from './utils/escape-html.js';
import { createLogger } from './utils/logger.js';
import { bindWindowVaultState, createAppContext, exposeAppContext } from './app/AppContext.js';
import { showCopyNotification, showNotification, showSuccess } from './app/notifications.js';
import {
  displayFileTree,
  initFileTreeView,
  performMoveToFolder,
  refreshFileTree,
  showFileTreeError,
  setSortOption,
  toggleFolder,
  toggleSortMenu,
} from './app/file-tree-view.js';
import {
  createVault,
  initTauri,
  initVaultLifecycle,
  openVault,
  showWelcomeScreen,
  syncVaultPickerInstances,
  updateUIWithVault,
} from './app/vault-lifecycle.js';
import {
  applyPendingFileLineNavigation,
  handleFileClick,
  initFileOpen,
  openFile,
  queueFileLineNavigation,
  saveCurrentFile,
} from './app/file-open.js';
import {
  closeMoveModal,
  closeRenameModal,
  confirmRename,
  initFileModals,
  promptForSketchName,
  setupFileModalEventHandlers,
  showCreateFileModal,
  showCreateFolderModal,
} from './app/file-modals.js';
import {
  clearPaneManager,
  getActiveContentSource,
  getActiveMarkdownExportTarget,
  getActiveTab,
  getActiveTabManager,
  getActiveTextEditor,
  getExportDefaultDirectory,
  initWorkspace,
  setPaneManager,
  syncGlobalEditorState,
} from './app/workspace.js';
import { setupShortcuts } from './app/shortcuts.js';
import {
  exportToHTML,
  exportToPDF,
  exportToWord,
  generateHighlightsSummary,
  initExporters,
} from './app/exporters.js';
import { initDragDrop } from './app/drag-drop.js';
import {
  applySettingsToAllEditors,
  initChrome,
  initializeChatResize,
  navigateBack,
  navigateForward,
  setupSidebarResize,
  showEditorSettings,
  toggleChatPanel,
  toggleEditorMenu,
  toggleSidebar,
  toggleSplitView,
  toggleWidgetSidebar,
  toggleZenMode,
  updateNavigationButtons,
  updateWordCount,
} from './app/chrome.js';
import {
  hideSectionHubs,
  initSections,
  openHomeSection,
  openSketchesSection,
  openTasksSection,
  setSidebarAppSection,
  showEditorWorkspace,
  updateSidebarAppNav,
} from './app/sections.js';
import { closeCurrentTab, createNewNote } from './NewTabScreen.js';
import { createShellActionRegistry } from './app/shell-actions.js';
import { renderAppShell, setupDropdownDismissHandlers } from './app/app-shell.js';
import {
  exposePerformanceDebug,
  initializePremiumFeatures,
  initializeVaultPicker,
  initializeWindowComponents,
  setupGraphSyncListeners,
} from './app/boot-services.js';
import {
  initEditorUi,
  rebuildEditorHeader,
  showError,
  updateEditorHeader,
} from './app/editor-ui.js';
import { initializeChatPanel } from './app/chat-panel.js';

const log = createLogger('main');

log.debug('✅ Tauri v2 APIs and editor components imported successfully!');
log.debug('🔍 EnhancedChatPanel class:', EnhancedChatPanel);

const appContext = exposeAppContext(createAppContext({ windowContext }), window);
bindWindowVaultState(appContext, window);

// Premium features
let entitlementManager = null;
let pacasdbClient = null;
let globalSearchPanel = null;
let vaultSync = null;

const { dndLog, setupFileTreeDragDelegation, setupFileTreeDnDDelegates, setupGlobalDnDFallbacks } =
  initDragDrop(appContext, {
    log,
    performMoveToFolder,
  });

initFileTreeView(appContext, {
  invoke,
  icons,
  log,
  asCommandError,
  dndLog,
});

initEditorUi({
  icons,
  escapeHtml,
  getPaneManager: () => paneManager,
  getChatPanel: () => chatPanel,
  getWidgetSidebar: () => window.widgetSidebar,
  getCurrentEditor: () => currentEditor,
});

initSections({
  invoke,
  displayFileTree,
  promptForSketchName,
  rebuildEditorHeader,
  showWelcomeScreen,
  getStatusBarVisible: () => statusBarVisible,
  clearEditorState: () => {
    currentEditor = null;
    currentFile = null;
    syncGlobalEditorState(null);
  },
});

let currentEditor = null;
let currentThemeManager = null;
let currentFile = null;
let appInitialized = false;
let paneManager = null;
let statusBarVisible = true; // Global status bar visibility state
let isZenMode = false;
let chatPanel = null; // Enhanced chat panel

// Import event listener from Tauri
import { listen } from '@tauri-apps/api/event';

initWorkspace(appContext, {
  getPaneManager: () => paneManager,
  getCurrentVaultPath: () => window.currentVaultPath,
  setLegacyEditorState: ({ currentFile: nextFile, currentEditor: nextEditor }) => {
    currentFile = nextFile;
    currentEditor = nextEditor;
  },
});

initFileOpen(appContext, {
  invoke,
  log,
  asCommandError,
  getPaneManager: () => paneManager,
  getActiveTabManager,
  getCurrentEditor: () => currentEditor,
  setCurrentEditorState: syncGlobalEditorState,
  loadEditorPreferences,
  setupEditorChangeTracking,
  hideSectionHubs,
  updateSidebarAppNav,
  rebuildEditorHeader,
  updateEditorHeader,
  updateNavigationButtons,
  updateWordCount,
  showEditorWorkspace,
  showError,
  refreshFileTree,
  getStatusBarVisible: () => statusBarVisible,
});

initVaultLifecycle(appContext, {
  invoke,
  openDialog: open,
  log,
  asCommandError,
  windowContext,
  VaultPicker,
  setSidebarAppSection,
  hideSectionHubs,
  updateSidebarAppNav,
  rebuildEditorHeader,
  updateNavigationButtons,
  displayFileTree,
  showFileTreeError,
  applySettingsToAllEditors,
  normalizeThemeOverrides,
  normalizeImageLocation,
  getPaneManager: () => paneManager,
  getFallbackTabManager: getActiveTabManager,
  getCurrentEditor: () => currentEditor,
  setCurrentEditorState: syncGlobalEditorState,
  showError,
});

initFileModals(appContext, {
  invoke,
  ask,
  log,
  asCommandError,
  displayFileTree,
  refreshFileTree,
  handleFileClick,
  showError,
  showNotification,
  getActiveTabManager,
  getPaneManager: () => paneManager,
  getCurrentVaultPath: () => appContext.vault.path,
});

initExporters({
  invoke,
  log,
  showNotification,
  showSuccess,
  showCopyNotification,
  getActiveContentSource,
  getActiveMarkdownExportTarget,
  getExportDefaultDirectory,
  getPaneManager: () => paneManager,
  getCurrentEditor: () => currentEditor,
});

initChrome({
  log,
  userSettingsPanel,
  normalizeImageLocation,
  normalizeThemeOverrides,
  ThemeManager,
  createWidgetSidebar: () => new WidgetSidebar(),
  getPaneManager: () => paneManager,
  getCurrentEditor: () => currentEditor,
  getCurrentThemeManager: () => currentThemeManager,
  setCurrentThemeManager: (themeManager) => {
    currentThemeManager = themeManager;
  },
  getChatPanel: () => chatPanel,
  getActiveContentSource,
  getStatusBarVisible: () => statusBarVisible,
  setStatusBarVisible: (visible) => {
    statusBarVisible = visible;
  },
  getIsZenMode: () => isZenMode,
  setIsZenMode: (active) => {
    isZenMode = active;
  },
});

// Listen for navigation to a file and line from backend commands
listen('open-file-at-line', async (event) => {
  try {
    const { filePath, lineNumber } = event.payload || {};
    if (!filePath) return;
    const activePane = paneManager?.panes?.get?.(paneManager?.activePaneId);
    const hadActiveTab = Boolean(activePane?.tabManager?.getActiveTab?.());
    queueFileLineNavigation(filePath, lineNumber);

    // Open file (or activate if open)
    await openFile(filePath);

    // New-tab path does not emit tab-navigated, so apply after open completes.
    if (!hadActiveTab && paneManager) {
      const tabManager = getActiveTabManager();
      const activeTab = tabManager?.getActiveTab();
      if (activeTab?.filePath === filePath) {
        applyPendingFileLineNavigation(filePath, activeTab.editor);
      }
    }
  } catch (e) {
    console.warn('Failed to handle open-file-at-line event:', e);
  }
});

// Initialize CodeMirror editor with panes
async function initializeEditor() {
  const editorWrapper = document.getElementById('editor-wrapper');
  if (!editorWrapper) {
    console.error('❌ Editor wrapper not found');
    return;
  }

  try {
    log.debug('🔲 Creating PaneManager...');
    paneManager = new PaneManager();
    setPaneManager(paneManager);
    log.debug('✅ PaneManager created');

    // Clear editor wrapper and mount PaneManager
    editorWrapper.innerHTML = '';
    paneManager.mount(editorWrapper);

    const tabManager = paneManager.getActiveTabManager();

    paneManager.on('pane-activated', ({ paneId }) => {
      const activeTabManager = paneManager.getTabManager(paneId);
      syncGlobalEditorState(activeTabManager?.getActiveTab() || null);
      updateNavigationButtons(); // Update nav button states
      updateSidebarAppNav();
    });

    // Set up navigation listeners when new panes are created
    paneManager.on('split-created', ({ paneId }) => {
      const pane = paneManager.panes.get(paneId);
      if (pane && pane.tabManager) {
        setupTabNavigationListeners(pane.tabManager);
      }
    });

    // Listen for tab changes to update editor reference
    tabManager.on('tab-changed', ({ tabId }) => {
      const tab = tabManager.getActiveTab();
      if (tab) {
        syncGlobalEditorState(tab);
        updateEditorHeader(tab.title);
        updateWordCount();
        updateNavigationButtons(); // Update nav button states

        // Apply theme to new editor
        if (currentThemeManager && tab.type === 'markdown' && currentEditor) {
          currentThemeManager.setEditor(currentEditor);
        }

        // Update widget sidebar with new editor
        if (window.widgetSidebar) {
          window.widgetSidebar.updateActiveEditor(tab.type === 'markdown' ? currentEditor : null);
        }

        // Show editor wrapper
        const editorWrapper = document.getElementById('editor-wrapper');
        if (editorWrapper) {
          editorWrapper.style.display = 'block';
        }
        hideSectionHubs();
        const welcomeContainer = document.querySelector('.welcome-container');
        if (welcomeContainer) {
          welcomeContainer.style.display = 'none';
        }
        updateSidebarAppNav();

        // Apply global status bar visibility when switching tabs
        const statusBar = document.getElementById('editor-status-bar');
        if (statusBar) {
          statusBar.style.display = statusBarVisible ? 'flex' : 'none';
        }

        // Update menu text to match current state
        const menuText = document.getElementById('status-bar-text');
        if (menuText) {
          menuText.textContent = statusBarVisible ? 'Hide status bar' : 'Show status bar';
        }
      } else {
        // No tabs, show welcome screen
        showWelcomeScreen();
      }
    });

    // Set up navigation listeners for this tab manager
    setupTabNavigationListeners(tabManager);

    // Listen for tab closed to show welcome when no tabs
    tabManager.on('tab-closed', () => {
      if (tabManager.tabs.size === 0) {
        showWelcomeScreen();
      }
    });

    // Listen for editor changes to update dirty state
    tabManager.on('tab-created', ({ tabId, tab }) => {
      setupEditorChangeTracking(tabId, tab);
    });

    // Show welcome screen initially
    showWelcomeScreen();

    // Hide navigation buttons initially since no tabs are open
    updateNavigationButtons();

    // Listen for file events for PACASDB sync
    window.addEventListener('file-created', async (event) => {
      const filePath = event.detail.filePath;
      if (vaultSync && filePath.endsWith('.md')) {
        vaultSync.handleFileEvent(filePath, 'create');
      }
    });

    window.addEventListener('file-deleted', async (event) => {
      const filePath = event.detail.filePath;
      if (vaultSync && filePath.endsWith('.md')) {
        vaultSync.handleFileEvent(filePath, 'remove');
      }
    });

    // Listen for file updates to reload open tabs
    window.addEventListener('file-updated', async (event) => {
      const updatedFilePath = event.detail.filePath;
      log.debug('📝 File updated event received:', updatedFilePath);

      // Trigger PACASDB sync for markdown files
      if (vaultSync && updatedFilePath.endsWith('.md')) {
        vaultSync.handleFileEvent(updatedFilePath, 'modify');
      }

      // Check all panes for tabs showing this file
      for (const [paneId, pane] of paneManager.panes) {
        const tabManager = pane.tabManager;

        // Find any tabs showing this file
        for (const [tabId, tab] of tabManager.tabs) {
          if (tab.filePath === updatedFilePath && tab.editor) {
            log.debug(`🔄 Reloading tab ${tabId} in pane ${paneId}`);

            try {
              // Read the updated content
              const content = await invoke('read_file_content', { filePath: updatedFilePath });

              // Update the editor
              tab.editor.setContent(content, false, updatedFilePath, false);
              tab.editor.currentFile = updatedFilePath;

              // Mark as not dirty since we just loaded from disk
              tabManager.setTabDirty(tabId, false);
              pane.tabBar.updateTabDirtyState(tabId, false);

              log.debug(`✅ Reloaded ${updatedFilePath} in tab ${tabId}`);
            } catch (error) {
              console.error('Error reloading file:', error);
            }
          }
        }
      }
    });

    log.debug('✅ Pane system initialized');

    setupShortcuts({
      log,
      invokeDevtools: () => invoke('toggle_devtools'),
      getActiveTextEditor,
      getActiveTabManager,
      getGlobalSearchPanel: () => globalSearchPanel,
      getIsZenMode: () => isZenMode,
      globalSearch,
    });
  } catch (error) {
    console.error('❌ Error initializing editor:', error);
    throw error;
  }
}

// Set up keyboard shortcuts for tab navigation
// Helper function to set up navigation listeners for a TabManager
function setupTabNavigationListeners(tabManager) {
  // Listen for tab navigation to load file content
  tabManager.on('tab-navigated', async ({ tabId, filePath }) => {
    const tab = tabManager.tabs.get(tabId);
    if (!tab || !filePath) return;

    try {
      // Load the file content
      const content = await invoke('read_file_content', { filePath });

      // Update editor with new content
      if (tab.editor) {
        tab.editor.setContent(content, false, filePath, false);
        tab.editor.currentFile = filePath;
      }

      // Update tab title - find the pane that owns this TabManager
      let owningPane = null;
      for (const [paneId, pane] of paneManager.panes) {
        if (pane.tabManager === tabManager) {
          owningPane = pane;
          break;
        }
      }

      if (owningPane && owningPane.tabBar) {
        owningPane.tabBar.updateTabTitle(tab.id, tab.title);
      }

      // Update global references if this is the active tab in the active pane
      if (
        paneManager.activePaneId &&
        owningPane &&
        owningPane.id === paneManager.activePaneId &&
        tabManager.activeTabId === tabId
      ) {
        syncGlobalEditorState(tab);
        showEditorWorkspace(tab.title);
        updateEditorHeader(tab.title);
        updateNavigationButtons();

        // Update widget sidebar with new editor
        if (window.widgetSidebar) {
          window.widgetSidebar.updateActiveEditor(tab.type === 'markdown' ? currentEditor : null);
        }
      }

      applyPendingFileLineNavigation(filePath, tab.editor);
    } catch (error) {
      console.error('Error loading file during navigation:', error);
      showError(`Failed to load ${filePath}: ${error}`);
    }
  });
}

// Helper function to set up change tracking for an editor
function setupEditorChangeTracking(tabId, tab) {
  if (tab.type === 'markdown' && tab.editor && tab.editor.view) {
    // Use the editor's built-in change tracking
    const originalSetContent = tab.editor.setContent.bind(tab.editor);
    tab.editor.setContent = function (...args) {
      // Forward all args so selection/scroll preservation flags continue to work
      originalSetContent(...args);
      // Reset dirty state when content is set
      const tabManager = paneManager ? paneManager.getActiveTabManager() : null;
      if (tabManager) {
        tabManager.setTabDirty(tabId, false);
        // Update TabBar through the active pane
        const activePane = paneManager.panes.get(paneManager.activePaneId);
        if (activePane && activePane.tabBar) {
          activePane.tabBar.updateTabDirtyState(tabId, false);
        }
      }
    };

    // Mark as dirty on any edit
    const originalDispatch = tab.editor.view.dispatch.bind(tab.editor.view);
    tab.editor.view.dispatch = function (tr) {
      originalDispatch(tr);
      if (tr.docChanged && tab.filePath) {
        const tabManager = paneManager ? paneManager.getActiveTabManager() : null;
        if (tabManager) {
          tabManager.setTabDirty(tabId, true);
          // Update TabBar through the active pane
          const activePane = paneManager.panes.get(paneManager.activePaneId);
          if (activePane && activePane.tabBar) {
            activePane.tabBar.updateTabDirtyState(tabId, true);
          }
        }
      }
    };
  }
}

async function loadEditorPreferences(editor) {
  try {
    const prefs = await invoke('get_editor_preferences');
    const vaultOverrides = {};
    if (window.pendingEditorSettings) {
      if (window.pendingEditorSettings.theme !== undefined) {
        vaultOverrides.theme = window.pendingEditorSettings.theme;
      }
      if (window.pendingEditorSettings.themeOverrides !== undefined) {
        vaultOverrides.theme_overrides = window.pendingEditorSettings.themeOverrides;
      }
      if (window.pendingEditorSettings.fontColor !== undefined) {
        vaultOverrides.font_color = window.pendingEditorSettings.fontColor;
      }
      if (window.pendingEditorSettings.fontSize !== undefined) {
        vaultOverrides.font_size = window.pendingEditorSettings.fontSize;
      }
      if (window.pendingEditorSettings.lineWrapping !== undefined) {
        vaultOverrides.line_wrapping = window.pendingEditorSettings.lineWrapping;
      }
      if (window.pendingEditorSettings.lineNumbers !== undefined) {
        vaultOverrides.line_numbers = window.pendingEditorSettings.lineNumbers;
      }
    }
    const effectivePrefs = { ...prefs, ...vaultOverrides };

    log.debug('[loadEditorPreferences] Loaded prefs:', effectivePrefs);
    log.debug('[loadEditorPreferences] Theme from prefs:', effectivePrefs.theme);

    // Create theme manager if needed
    if (!currentThemeManager) {
      log.debug('[loadEditorPreferences] Creating new ThemeManager');
      currentThemeManager = new ThemeManager(editor);
      window.themeManager = currentThemeManager; // Expose to window for settings panel
    } else {
      log.debug('[loadEditorPreferences] Reusing existing ThemeManager');
      currentThemeManager.setEditor(editor);
      window.themeManager = currentThemeManager; // Update window reference
    }

    // Apply theme (default to 'default' if not set)
    const themeToUse = effectivePrefs.theme || 'default';
    const themeOverrides = normalizeThemeOverrides(
      effectivePrefs.theme_overrides || effectivePrefs.themeOverrides,
    );
    log.debug('[loadEditorPreferences] Applying theme:', themeToUse);
    currentThemeManager.applyTheme(themeToUse, themeOverrides);

    // Apply font color if provided and refresh editors to pick up CSS vars
    if (effectivePrefs.font_color) {
      try {
        currentThemeManager.setFontColor(effectivePrefs.font_color);
        // Allow CSS variables to propagate before reconfiguring themes
        setTimeout(() => {
          refreshAllEditors();
        }, 100);
      } catch (e) {
        console.error('Failed to apply saved font color:', e);
      }
    }

    // Apply font size (default to 16 if not set)
    const fontSize = effectivePrefs.font_size || 16;
    editor.view.dispatch({
      effects: editor.fontSizeCompartment.reconfigure(editor.createFontSizeTheme(fontSize)),
    });

    // Apply line wrapping (default to true if not set)
    const lineWrapping = effectivePrefs.line_wrapping !== false;
    if (!lineWrapping) {
      editor.view.dispatch({
        effects: editor.lineWrappingCompartment.reconfigure([]),
      });
    }

    if (effectivePrefs.line_numbers !== undefined && editor.setLineNumbers) {
      editor.setLineNumbers(effectivePrefs.line_numbers);
    }

    log.debug('✅ Editor preferences loaded');
  } catch (error) {
    log.debug('⚠️ No editor preferences found, using defaults');
    // Create default theme manager
    if (!currentThemeManager) {
      currentThemeManager = new ThemeManager(editor);
      window.themeManager = currentThemeManager; // Expose to window for settings panel
      currentThemeManager.applyTheme('default');
    }
  }
}

// Helper to refresh all open editors' themes (used after CSS variable changes)
function refreshAllEditors() {
  if (!paneManager?.panes) return;
  for (const pane of paneManager.panes.values()) {
    const tabManager = pane.tabManager;
    if (!tabManager || !tabManager.tabs) continue;
    for (const tab of tabManager.tabs.values()) {
      if (tab.editor && tab.type === 'markdown' && typeof tab.editor.refreshTheme === 'function') {
        try {
          tab.editor.refreshTheme();
        } catch (e) {
          console.warn('Theme refresh failed for an editor:', e);
        }
      }
    }
  }
}

const { handledActions: APP_SHELL_HANDLED_ACTIONS, handleShellAction } = createShellActionRegistry({
  documentRef: document,
  toggleSidebar,
  toggleSplitView,
  toggleZenMode,
  navigateBack,
  navigateForward,
  toggleWidgetSidebar,
  toggleChatPanel,
  toggleEditorMenu,
  showEditorSettings,
  generateHighlightsSummary,
  exportToPDF,
  exportToHTML,
  exportToWord,
  openVault,
  createVault,
  openHomeSection,
  openTasksSection,
  openSketchesSection,
  showCreateFileModal,
  showCreateFolderModal,
  refreshFileTree,
  toggleSortMenu,
  setSortOption,
  toggleFolder,
  handleFileClick,
  confirmRename,
  closeRenameModal,
  closeMoveModal,
  createNewNote,
  closeCurrentTab,
  getActiveTabManager,
});

function setupAppShellEventDelegation() {
  const appElement = document.querySelector('#app');
  if (!appElement || appElement.dataset.shellHandlersBound === 'true') {
    return;
  }

  appElement.dataset.shellHandlersBound = 'true';

  appElement.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement || !appElement.contains(actionElement)) {
      return;
    }

    const action = actionElement.dataset.action;
    if (!action || !APP_SHELL_HANDLED_ACTIONS.has(action)) {
      return;
    }

    event.preventDefault();
    handleShellAction(action, actionElement, event);
  });
}

// Initialize everything
async function initializeApp() {
  if (appInitialized) {
    log.debug('⚠️ App already initialized, skipping...');
    return;
  }

  log.debug('🎯 Starting app initialization...');
  appInitialized = true;

  await initTauri();

  const appElement = document.querySelector('#app');

  if (appElement) {
    log.debug('📝 Rendering app shell...');
    renderAppShell({
      appElement,
      icons,
      isChatVisible: Boolean(chatPanel?.isVisible),
      isSplit: Boolean(paneManager?.isSplit),
    });

    setupAppShellEventDelegation();
    setupFileTreeDragDelegation();
    updateSidebarAppNav();

    log.debug('✅ UI HTML set successfully');

    // Initialize CodeMirror editor
    await initializeEditor();

    // Initialize Enhanced Chat Panel
    await initializeChatPanel({
      PanelClass: EnhancedChatPanel,
      appContext,
      setChatPanel: (panel) => {
        chatPanel = panel;
      },
      log,
    });

    // NOTE: vault opening is intentionally NOT done here. The shell must be
    // rendered (above) and the `vault-opened` listener registered (in boot())
    // BEFORE any vault is opened, otherwise the file-tree-loading listener
    // misses the open and the tree never populates. See openInitialVault().

    setupFileModalEventHandlers();

    setupFileTreeDnDDelegates();
    setupGlobalDnDFallbacks();

    // Set up auto-save on window before unload
    window.addEventListener('beforeunload', async (e) => {
      const activeTab = getActiveTab();
      if (activeTab?.isDirty && activeTab?.filePath) {
        e.preventDefault();
        await saveCurrentFile();
      }

      // Stop vault sync
      if (vaultSync) {
        vaultSync.stop();
      }
    });

    // Set up sidebar resize functionality
    setupSidebarResize();
  } else {
    console.error('❌ No #app element found');
  }
}

// Open the saved vault (window state first, then last-vault fallback), or show
// the welcome screen. MUST run after the `vault-opened` listener is registered
// so the file-tree-loading listener actually fires on open.
async function openInitialVault() {
  try {
    // Reads URL params / saved window state and opens if found.
    await windowContext.checkInitialVault();

    if (!windowContext.hasVault) {
      const lastVault = await invoke('get_last_vault');
      if (lastVault) {
        log.debug('🔄 Found last vault:', lastVault);
        await windowContext.openVault(lastVault);
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to load initial vault:', error);
  }

  if (!windowContext.hasVault) {
    showWelcomeScreen();
  }
}

// Single, idempotent boot sequence with a deterministic order:
//   render shell + editor/chat  →  register vault-opened listener  →  open vault.
// The ordering is load-bearing: opening the vault before the listener is
// registered leaves the file tree unpopulated (the listener does refreshFileTree).
let appBooted = false;
async function boot() {
  if (appBooted) {
    log.debug('⚠️ Boot already ran, skipping...');
    return;
  }
  appBooted = true;

  log.debug('🎯 Booting Vault...');

  // Wait for a frame to ensure WebView is attached to display
  // This prevents the "page has no displayID" WebKit error on macOS
  await new Promise((resolve) =>
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    }),
  );
  log.debug('🖼️ First paint complete, proceeding with initialization...');

  perfMonitor.startMeasure('app_initialization');

  // 1. Render shell + editor + chat. Must happen before any vault open so the
  //    #file-tree element exists for refreshFileTree() to populate.
  await initializeApp();

  // 2. Initialize premium features (entitlement, search, sync).
  log.debug('💎 Initializing premium features...');
  ({ entitlementManager, pacasdbClient, globalSearchPanel, vaultSync } =
    await initializePremiumFeatures(appContext, {
      EntitlementManager,
      PACASDBClient,
      GlobalSearchPanel,
      VaultSync,
      log,
    }));

  // 3. Initialize window context and register the vault-opened listener
  //    BEFORE opening any vault.
  try {
    log.debug('🪟 Initializing WindowContext...');
    await windowContext.initialize();

    windowContext.on('vault-opened', async (vaultInfo) => {
      log.debug('📁 Vault opened in window:', vaultInfo);

      await initializeWindowComponents({
        windowContext,
        invoke,
        refreshFileTree,
        getPaneManager: () => paneManager,
        getActiveTabManager,
        globalSearch,
        resetPaneManager: () => {
          paneManager = null;
          clearPaneManager();
        },
        initializeEditor,
        log,
      });

      await updateUIWithVault(vaultInfo);
      syncVaultPickerInstances(vaultInfo);

      if (window.graphSyncStatus) {
        log.debug('🔄 Refreshing GraphSync status for new vault');
        await window.graphSyncStatus.fetchStatus();
      }
    });

    // 4. Now (and only now) open the initial vault.
    await openInitialVault();
  } catch (error) {
    console.error('❌ Failed to initialize WindowContext:', error);
  }

  // Sync chat button active state after all initialization is complete.
  if (appContext.chat.panel && appContext.chat.panel.isVisible) {
    const chatToggleBtns = document.querySelectorAll('.chat-toggle-btn');
    chatToggleBtns.forEach((btn) => btn.classList.add('active'));
    log.debug('✅ Synced chat button active state for', chatToggleBtns.length, 'buttons');
  }

  initializeVaultPicker({ VaultPicker, log });
  initializeChatResize();
  setupGraphSyncListeners({ listen, invoke, log });

  perfMonitor.endMeasure('app_initialization');
  exposePerformanceDebug(appContext, { perfMonitor, perfTestSuite, log });

  setTimeout(() => {
    const metrics = perfMonitor.getCurrentMetrics();
    log.debug('📊 Initial performance metrics:', metrics);
  }, 1000);

  setupDropdownDismissHandlers({ documentRef: document });
}

// Plugin Hub global
window.pluginHub = pluginHub;
log.debug('🔌 Plugin Hub initialized and available at window.pluginHub');

// Single entry: run boot() once, whether or not DOMContentLoaded has fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  log.debug('⚡ DOM already ready, booting immediately...');
  boot();
}
