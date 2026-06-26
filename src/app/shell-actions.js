export const SHELL_ACTION_NAMES = [
  'toggle-sidebar',
  'toggle-split-view',
  'toggle-zen-mode',
  'navigate-back',
  'navigate-forward',
  'toggle-widget-sidebar',
  'toggle-chat-panel',
  'toggle-editor-menu',
  'show-editor-settings',
  'generate-highlights-summary',
  'export-pdf',
  'export-html',
  'export-word',
  'open-vault',
  'create-vault',
  'open-home-section',
  'open-tasks-section',
  'open-sketches-section',
  'show-create-file-modal',
  'show-create-folder-modal',
  'refresh-file-tree',
  'toggle-sort-menu',
  'set-sort-option',
  'toggle-folder',
  'open-file',
  'confirm-rename',
  'close-rename-modal',
  'close-move-modal',
  'close-dnd-test-harness',
  'create-new-note',
  'close-current-tab',
];

export function createShellActionRegistry({
  documentRef = document,
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
} = {}) {
  validateDependencies({
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

  const actionHandlers = {
    'toggle-sidebar': () => toggleSidebar(),
    'toggle-split-view': () => toggleSplitView(),
    'toggle-zen-mode': () => toggleZenMode(),
    'navigate-back': () => navigateBack(),
    'navigate-forward': () => navigateForward(),
    'toggle-widget-sidebar': () => toggleWidgetSidebar(),
    'toggle-chat-panel': () => toggleChatPanel(),
    'toggle-editor-menu': () => toggleEditorMenu(),
    'show-editor-settings': () => showEditorSettings(),
    'generate-highlights-summary': () => generateHighlightsSummary(),
    'export-pdf': () => exportToPDF(),
    'export-html': () => exportToHTML(),
    'export-word': () => exportToWord(),
    'open-vault': () => openVault(),
    'create-vault': () => createVault(),
    'open-home-section': () => openHomeSection(),
    'open-tasks-section': () => openTasksSection(),
    'open-sketches-section': () => openSketchesSection(),
    'show-create-file-modal': ({ element, event }) =>
      showCreateFileModal(getShellActionPath(element), event),
    'show-create-folder-modal': () => showCreateFolderModal(),
    'refresh-file-tree': () => refreshFileTree(),
    'toggle-sort-menu': () => toggleSortMenu(),
    'set-sort-option': ({ element }) => setSortOption(element?.dataset?.sortOption),
    'toggle-folder': ({ element, event }) => toggleFolder(getShellActionPath(element), event),
    'open-file': ({ element }) => handleFileClick(getShellActionPath(element), false),
    'confirm-rename': () => confirmRename(),
    'close-rename-modal': () => closeRenameModal(),
    'close-move-modal': () => closeMoveModal(),
    'close-dnd-test-harness': () => documentRef.getElementById('dnd-test-harness')?.remove(),
    'create-new-note': () => createNewNote({ showCreateFileModal }),
    'close-current-tab': () => closeCurrentTab({ tabManager: getActiveTabManager() }),
  };

  validateActionHandlers(actionHandlers);

  return {
    actionHandlers,
    handledActions: new Set(SHELL_ACTION_NAMES),
    handleShellAction(action, element, event) {
      actionHandlers[action]?.({ element, event });
    },
  };
}

function getShellActionPath(element) {
  return element?.dataset?.path || element?.dataset?.folderPath || '';
}

function validateActionHandlers(actionHandlers) {
  const missing = SHELL_ACTION_NAMES.filter(
    (action) => typeof actionHandlers[action] !== 'function',
  );
  if (missing.length > 0) {
    throw new Error(`Missing shell action handlers: ${missing.join(', ')}`);
  }
}

function validateDependencies(dependencies) {
  const missing = Object.entries(dependencies)
    .filter(([, dependency]) => typeof dependency !== 'function')
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing shell action dependencies: ${missing.join(', ')}`);
  }
}
