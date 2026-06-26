import {
  navigateBack,
  navigateForward,
  toggleChatPanel,
  toggleSplitView,
  toggleZenMode,
} from './chrome.js';
import {
  openTaskDashboard as openTaskDashboardDefault,
  showCreateFileModal,
} from './file-modals.js';
import { exportToPDF, exportToWord } from './exporters.js';

const runtime = {
  documentRef: null,
  windowRef: null,
  log: console,
  invokeDevtools: async () => {},
  getActiveTextEditor: () => null,
  getActiveTabManager: () => null,
  getGlobalSearchPanel: () => null,
  getIsZenMode: () => false,
  globalSearch: null,
  openTaskDashboard: openTaskDashboardDefault,
};

let keyboardShortcutsInitialized = false;
let keydownHandler = null;

export function setupShortcuts({
  documentRef = document,
  windowRef = window,
  log = console,
  invokeDevtools = async () => {},
  getActiveTextEditor = () => null,
  getActiveTabManager = () => null,
  getGlobalSearchPanel = () => null,
  getIsZenMode = () => false,
  globalSearch = null,
  openTaskDashboard = openTaskDashboardDefault,
} = {}) {
  Object.assign(runtime, {
    documentRef,
    windowRef,
    log,
    invokeDevtools,
    getActiveTextEditor,
    getActiveTabManager,
    getGlobalSearchPanel,
    getIsZenMode,
    globalSearch,
    openTaskDashboard,
  });

  if (keyboardShortcutsInitialized) {
    log.debug?.('Keyboard shortcuts already initialized, skipping');
    return;
  }

  keyboardShortcutsInitialized = true;
  keydownHandler = handleShortcutKeydown;
  documentRef.addEventListener('keydown', keydownHandler);
}

export function resetShortcutsForTests() {
  if (keyboardShortcutsInitialized && runtime.documentRef && keydownHandler) {
    runtime.documentRef.removeEventListener('keydown', keydownHandler);
  }
  keyboardShortcutsInitialized = false;
  keydownHandler = null;
}

export function toggleGlobalSearchPanel() {
  const globalSearchPanel = runtime.getGlobalSearchPanel();
  if (!globalSearchPanel) {
    console.error('Global search panel not initialized');
    return;
  }

  const modalId = 'global-search-modal';
  let modal = runtime.documentRef.getElementById(modalId);
  if (modal) {
    modal.remove();
    return;
  }

  modal = runtime.documentRef.createElement('div');
  modal.id = modalId;
  modal.className = 'modal-overlay';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const modalContent = runtime.documentRef.createElement('div');
  modalContent.className = 'modal-content';
  modalContent.style.cssText = `
    background: var(--background);
    border-radius: 8px;
    padding: 20px;
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  `;

  const panelElement = globalSearchPanel.render();
  modalContent.appendChild(panelElement);
  modal.appendChild(modalContent);
  runtime.documentRef.body.appendChild(modal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.remove();
    }
  });

  const escapeHandler = (event) => {
    if (event.key === 'Escape') {
      modal.remove();
      runtime.documentRef.removeEventListener('keydown', escapeHandler);
    }
  };
  runtime.documentRef.addEventListener('keydown', escapeHandler);

  runtime.windowRef.setTimeout(() => {
    panelElement.querySelector('input.search-input')?.focus();
  }, 100);
}

async function handleShortcutKeydown(event) {
  if (event.shiftKey && event.metaKey) {
    runtime.log.debug?.('Shift+Cmd key pressed:', event.key, 'keyCode:', event.keyCode);
  }

  if (event.metaKey && event.altKey && event.key === 'i') {
    event.preventDefault();
    try {
      await runtime.invokeDevtools();
    } catch (error) {
      console.error('Failed to open devtools:', error);
    }
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'f' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const activeEditor = runtime.getActiveTextEditor();
    if (activeEditor && typeof activeEditor.openSearch === 'function') {
      activeEditor.openSearch();
      return;
    }

    try {
      runtime.globalSearch?.toggle?.();
    } catch (error) {
      console.error('Error calling globalSearch.toggle():', error);
    }
    return;
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    (event.key === 'f' || event.key === 'F')
  ) {
    event.preventDefault();
    if (runtime.getGlobalSearchPanel()) {
      toggleGlobalSearchPanel();
    } else {
      runtime.log.debug?.('Global search panel not initialized');
    }
    return;
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    (event.key === 'P' || event.key === 'p')
  ) {
    event.preventDefault();
    const pluginHub = runtime.windowRef.pluginHub;
    if (pluginHub) {
      pluginHub.open?.().catch?.((error) => {
        console.error('Error opening Plugin Hub:', error);
      });
    } else {
      console.warn('Plugin Hub not initialized');
    }
    return;
  }

  if (event.metaKey && event.altKey && (event.key === 't' || event.key === 'T')) {
    event.preventDefault();
    runtime.openTaskDashboard();
    return;
  }

  const tabManager = runtime.getActiveTabManager();
  if (!tabManager) {
    return;
  }

  if (event.metaKey && event.shiftKey && (event.key === 't' || event.key === 'T')) {
    event.preventDefault();
    if (tabManager.tabs.size < tabManager.maxTabs) {
      const tabId = tabManager.createTab();
      tabManager.activateTab(tabId);
    }
  }

  if (event.metaKey && !event.shiftKey && event.key === 't') {
    event.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab?.editor && activeTab.type === 'markdown') {
      const editor = activeTab.editor;
      const selection = editor.view.state.selection.main;
      const text = '- [ ] ';
      editor.view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text,
        },
        selection: { anchor: selection.from + text.length },
      });
    }
  }

  if (event.metaKey && event.key === 'w') {
    event.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      tabManager.closeTab(activeTab.id);
    }
  }

  if (event.metaKey && event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    activateRelativeTab(tabManager, 1);
  }

  if (event.metaKey && event.shiftKey && event.key === 'Tab') {
    event.preventDefault();
    activateRelativeTab(tabManager, -1);
  }

  if (event.metaKey && event.key >= '1' && event.key <= '5') {
    event.preventDefault();
    const tabIndex = parseInt(event.key, 10) - 1;
    const tabs = tabManager.getTabs();
    if (tabIndex < tabs.length) {
      tabManager.activateTab(tabs[tabIndex].id);
    }
  }

  if (event.metaKey && event.key === '\\') {
    event.preventDefault();
    toggleSplitView();
  }

  if ((event.metaKey && event.key === '[') || (event.altKey && event.key === 'ArrowLeft')) {
    event.preventDefault();
    navigateBack();
  }

  if ((event.metaKey && event.key === ']') || (event.altKey && event.key === 'ArrowRight')) {
    event.preventDefault();
    navigateForward();
  }

  if (event.metaKey && event.altKey && (event.key === 'z' || event.key === 'Ω')) {
    event.preventDefault();
    toggleZenMode();
  }

  if (event.key === 'Escape' && runtime.getIsZenMode()) {
    event.preventDefault();
    toggleZenMode();
  }

  if (event.metaKey && event.key === 'n') {
    event.preventDefault();
    showCreateFileModal('');
  }

  if (event.metaKey && event.key === 's') {
    event.preventDefault();
    saveActiveTab(tabManager);
  }

  if (event.metaKey && !event.shiftKey && (event.key === 'b' || event.key === 'B')) {
    invokeEditorCommand(event, 'toggleBold');
  }

  if (event.metaKey && !event.shiftKey && (event.key === 'j' || event.key === 'J')) {
    invokeEditorCommand(event, 'toggleUnderline');
  }

  if (event.metaKey && !event.shiftKey && (event.key === 'h' || event.key === 'H')) {
    invokeEditorCommand(event, 'toggleHighlight');
  }

  if (event.metaKey && !event.shiftKey && (event.key === 'k' || event.key === 'K')) {
    invokeEditorCommand(event, 'insertLink');
  }

  if (event.metaKey && event.shiftKey && (event.key === 'x' || event.key === 'X')) {
    invokeEditorCommand(event, 'toggleStrikethrough');
  }

  if (event.metaKey && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
    event.preventDefault();
    toggleChatPanel();
  }

  if (event.metaKey && event.shiftKey && event.key === 'E') {
    event.preventDefault();
    exportToPDF();
  }

  if (event.metaKey && event.shiftKey && event.key === 'W') {
    event.preventDefault();
    exportToWord();
  }
}

function activateRelativeTab(tabManager, direction) {
  const tabs = tabManager.getTabs();
  const activeTab = tabManager.getActiveTab();
  if (!activeTab || tabs.length <= 1) {
    return;
  }

  const currentIndex = tabs.findIndex((tab) => tab.id === activeTab.id);
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  tabManager.activateTab(tabs[nextIndex].id);
}

function saveActiveTab(tabManager) {
  const activeTab = tabManager.getActiveTab();
  if (
    activeTab?.editor &&
    typeof activeTab.editor.save === 'function' &&
    activeTab.type === 'markdown'
  ) {
    activeTab.editor.save();
  } else if (activeTab?.csvEditor?.save) {
    activeTab.csvEditor.save();
  } else if (activeTab?.sketchTab?.save) {
    activeTab.sketchTab.save();
  }
}

function invokeEditorCommand(event, commandName) {
  const activeEditor = runtime.getActiveTextEditor();
  if (activeEditor && typeof activeEditor[commandName] === 'function') {
    event.preventDefault();
    activeEditor[commandName]();
  }
}
