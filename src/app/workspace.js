const runtime = {
  appContext: null,
  windowRef: typeof window === 'undefined' ? null : window,
  getPaneManager: () =>
    runtime.appContext?.workspace?.paneManager ?? runtime.windowRef?.paneManager ?? null,
  getCurrentVaultPath: () => null,
  setLegacyEditorState: () => {},
};

export function initWorkspace(
  appContext,
  {
    windowRef = window,
    getPaneManager = () => appContext.workspace.paneManager,
    getCurrentVaultPath = () => appContext.vault.path,
    setLegacyEditorState = () => {},
  } = {},
) {
  Object.assign(runtime, {
    appContext,
    windowRef,
    getPaneManager,
    getCurrentVaultPath,
    setLegacyEditorState,
  });

  return {
    getActiveTabManager,
    getActiveTab,
    getActiveTextEditor,
    getActiveContentSource,
    getActiveMarkdownExportTarget,
    getExportDefaultDirectory,
    syncGlobalEditorState,
    setPaneManager,
    clearPaneManager,
  };
}

export function setPaneManager(paneManager) {
  runtime.appContext.workspace.paneManager = paneManager || null;
}

export function clearPaneManager() {
  setPaneManager(null);
  syncGlobalEditorState(null);
}

export function getPaneManager() {
  return runtime.getPaneManager() || null;
}

export function getCurrentFile() {
  return runtime.appContext?.workspace?.currentFile ?? runtime.windowRef?.currentFile ?? null;
}

export function getActiveTabManager() {
  return runtime.getPaneManager()?.getActiveTabManager?.() || null;
}

export function getActiveTab() {
  return getActiveTabManager()?.getActiveTab?.() || null;
}

export function getActiveTextEditor() {
  const activeTab = getActiveTab();
  if (activeTab?.editor && activeTab.type === 'markdown') {
    return activeTab.editor;
  }

  return runtime.appContext?.workspace?.currentEditor || runtime.windowRef?.currentEditor || null;
}

export function getActiveContentSource() {
  const activeTab = getActiveTab();
  if (activeTab?.editor && typeof activeTab.editor.getContent === 'function') {
    return activeTab.editor;
  }

  return getActiveTextEditor();
}

export function getActiveMarkdownExportTarget() {
  const activeTab = getActiveTab();
  if (activeTab?.type === 'markdown' && activeTab.editor && activeTab.filePath) {
    return {
      editor: activeTab.editor,
      filePath: activeTab.filePath,
    };
  }

  const fallbackEditor =
    runtime.appContext?.workspace?.currentEditor || runtime.windowRef?.currentEditor || null;
  const fallbackFilePath =
    runtime.appContext?.workspace?.currentFile ||
    runtime.windowRef?.currentFile ||
    fallbackEditor?.currentFile ||
    null;

  if (fallbackEditor && fallbackFilePath) {
    return {
      editor: fallbackEditor,
      filePath: fallbackFilePath,
    };
  }

  return null;
}

export function getExportDefaultDirectory(filePath) {
  if (!filePath) {
    return runtime.getCurrentVaultPath() || null;
  }

  const normalizedPath = String(filePath).replace(/\\/g, '/');
  const isAbsolutePath = normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath);

  if (isAbsolutePath) {
    const lastSlash = normalizedPath.lastIndexOf('/');
    return lastSlash > 0 ? normalizedPath.slice(0, lastSlash) : normalizedPath;
  }

  const vaultRoot = runtime.getCurrentVaultPath()
    ? String(runtime.getCurrentVaultPath()).replace(/\\/g, '/').replace(/\/$/, '')
    : '';
  if (!vaultRoot) {
    return null;
  }

  const lastSlash = normalizedPath.lastIndexOf('/');
  if (lastSlash === -1) {
    return vaultRoot;
  }

  return `${vaultRoot}/${normalizedPath.slice(0, lastSlash)}`;
}

export function syncGlobalEditorState(tab = null) {
  const currentFile = tab?.filePath || null;
  const currentEditor = tab?.type === 'markdown' ? tab.editor : null;

  runtime.appContext.workspace.currentFile = currentFile;
  runtime.appContext.workspace.currentEditor = currentEditor;
  runtime.setLegacyEditorState({ currentFile, currentEditor });

  runtime.windowRef.currentFile = currentFile;
  runtime.windowRef.currentEditor = currentEditor;
}
