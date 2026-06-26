const runtime = {
  documentRef: typeof document === 'undefined' ? null : document,
  windowRef: typeof window === 'undefined' ? null : window,
  log: console,
  userSettingsPanel: null,
  normalizeImageLocation: (value) => value,
  normalizeThemeOverrides: (value) => value,
  ThemeManager: null,
  createWidgetSidebar: null,
  getPaneManager: () => null,
  getCurrentEditor: () => null,
  getCurrentThemeManager: () => null,
  setCurrentThemeManager: () => {},
  getChatPanel: () => null,
  getActiveContentSource: () => null,
  getStatusBarVisible: () => true,
  setStatusBarVisible: () => {},
  getIsZenMode: () => false,
  setIsZenMode: () => {},
};

let zenModeState = {
  wasRightSidebarVisible: false,
};

export function initChrome({
  documentRef = document,
  windowRef = window,
  log = console,
  userSettingsPanel = null,
  normalizeImageLocation = (value) => value,
  normalizeThemeOverrides = (value) => value,
  ThemeManager = null,
  createWidgetSidebar = null,
  getPaneManager = () => null,
  getCurrentEditor = () => null,
  getCurrentThemeManager = () => null,
  setCurrentThemeManager = () => {},
  getChatPanel = () => null,
  getActiveContentSource = () => null,
  getStatusBarVisible = () => true,
  setStatusBarVisible = () => {},
  getIsZenMode = () => false,
  setIsZenMode = () => {},
} = {}) {
  Object.assign(runtime, {
    documentRef,
    windowRef,
    log,
    userSettingsPanel,
    normalizeImageLocation,
    normalizeThemeOverrides,
    ThemeManager,
    createWidgetSidebar,
    getPaneManager,
    getCurrentEditor,
    getCurrentThemeManager,
    setCurrentThemeManager,
    getChatPanel,
    getActiveContentSource,
    getStatusBarVisible,
    setStatusBarVisible,
    getIsZenMode,
    setIsZenMode,
  });

  return {
    toggleChatPanel,
    toggleWidgetSidebar,
    toggleSplitView,
    toggleSidebar,
    toggleEditorMenu,
    updateWordCount,
    toggleStatusBar,
    showEditorSettings,
    navigateBack,
    navigateForward,
    updateNavigationButtons,
    toggleZenMode,
    applySettingsToAllEditors,
    toggleLineNumbers,
    setupSidebarResize,
    initializeChatResize,
  };
}

export function toggleChatPanel() {
  const chatPanel = runtime.getChatPanel();
  const rightSidebar = runtime.documentRef.getElementById('right-sidebar');
  const chatToggleButtons = runtime.documentRef.querySelectorAll('.chat-toggle-btn');

  if (!rightSidebar || !chatPanel) {
    console.error('Chat panel or sidebar not found');
    return;
  }

  chatPanel.toggle();
  rightSidebar.classList.toggle('visible', chatPanel.isVisible);
  chatToggleButtons.forEach((button) => {
    button.classList.toggle('active', chatPanel.isVisible);
  });

  if (chatPanel.isVisible) {
    const savedWidth = runtime.windowRef.localStorage?.getItem('chatPanelWidth');
    if (savedWidth) {
      rightSidebar.style.width = `${savedWidth}px`;
    }
  }
}

export function toggleWidgetSidebar() {
  let sidebar = runtime.windowRef.widgetSidebar;

  if (!sidebar) {
    const appContainer = runtime.documentRef.querySelector('.app-container');
    if (!appContainer || !runtime.createWidgetSidebar) {
      console.error('Widget sidebar not initialized');
      return;
    }

    sidebar = runtime.createWidgetSidebar();
    sidebar.mount(appContainer);
    runtime.windowRef.widgetSidebar = sidebar;

    const currentEditor = runtime.getCurrentEditor();
    if (currentEditor) {
      sidebar.updateActiveEditor(currentEditor);
    }
  }

  // WidgetSidebar.toggle() owns both its `visible` state and the
  // .widget-toggle-btn active class. Don't duplicate that here.
  sidebar.toggle();
}

export async function toggleSplitView() {
  const paneManager = runtime.getPaneManager();
  if (!paneManager) {
    return;
  }

  if (paneManager.isSplit) {
    const removed = await paneManager.unsplit();
    if (!removed) {
      return;
    }
    runtime.documentRef.getElementById('split-view-btn')?.classList.remove('active');
  } else {
    paneManager.split();
    runtime.documentRef.getElementById('split-view-btn')?.classList.add('active');
  }
}

export function toggleSidebar() {
  const sidebar = runtime.documentRef.querySelector('.sidebar');
  const editorContainer = runtime.documentRef.querySelector('.editor-container');
  if (!sidebar || !editorContainer) {
    return;
  }

  const isHidden = sidebar.style.display === 'none';
  sidebar.style.display = isHidden ? 'flex' : 'none';
  editorContainer.style.marginLeft = '0';
  editorContainer.classList.toggle('sidebar-hidden', !isHidden);
}

export function toggleEditorMenu() {
  runtime.documentRef.getElementById('editor-dropdown')?.classList.toggle('hidden');
}

export function updateWordCount() {
  if (!runtime.documentRef) {
    return;
  }
  const activeEditor = runtime.getActiveContentSource();
  const wordCountElement = runtime.documentRef.getElementById('word-count');
  const charCountElement = runtime.documentRef.getElementById('char-count');

  if (!activeEditor) {
    if (wordCountElement) wordCountElement.textContent = '0 words';
    if (charCountElement) charCountElement.textContent = '0 characters';
    return;
  }

  const plainText = activeEditor
    .getContent()
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*{1,3}|_{1,3})([^\*_]+)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
    .replace(/^(\*{3,}|-{3,}|_{3,})$/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[\*\-\+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words =
    plainText === '' ? 0 : plainText.split(/\s+/).filter((word) => word.length > 0).length;
  const characters = plainText.length;
  if (wordCountElement) {
    wordCountElement.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
  }
  if (charCountElement) {
    charCountElement.textContent = `${characters.toLocaleString()} character${characters === 1 ? '' : 's'}`;
  }
}

export function toggleStatusBar() {
  const statusBar = runtime.documentRef?.getElementById('editor-status-bar');
  if (!statusBar) {
    return;
  }

  const nextVisible = !runtime.getStatusBarVisible();
  runtime.setStatusBarVisible(nextVisible);
  statusBar.style.display = nextVisible ? 'flex' : 'none';

  const menuText = runtime.documentRef.getElementById('status-bar-text');
  if (menuText) {
    menuText.textContent = nextVisible ? 'Hide status bar' : 'Show status bar';
  }
  runtime.documentRef.getElementById('editor-dropdown')?.classList.add('hidden');
}

export function showEditorSettings() {
  runtime.documentRef.getElementById('editor-dropdown')?.classList.add('hidden');
  if (!runtime.userSettingsPanel) {
    return;
  }

  const overlay = runtime.documentRef.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.onclick = (event) => {
    if (event.target === overlay) {
      runtime.userSettingsPanel.close();
    }
  };

  const container = runtime.documentRef.createElement('div');
  overlay.appendChild(container);

  runtime.userSettingsPanel.mount(container, {
    onSave: async (settings) => {
      applySettingsToAllEditors(settings.editor);
      const currentEditor = runtime.getCurrentEditor();
      if (currentEditor) {
        currentEditor.setLineNumbers?.(settings.editor.lineNumbers);
        currentEditor.setLineWrapping?.(settings.editor.lineWrapping);
      }
      const statusBar = runtime.documentRef.getElementById('status-bar');
      if (statusBar) {
        statusBar.style.display = settings.editor.showStatusBar ? 'flex' : 'none';
        runtime.setStatusBarVisible(settings.editor.showStatusBar);
      }
      if (settings.files.imageLocation) {
        runtime.windowRef.imageSaveLocation = runtime.normalizeImageLocation(
          settings.files.imageLocation,
        );
      }
    },
    onClose: () => {
      overlay.classList.remove('show');
      runtime.windowRef.setTimeout(() => {
        overlay.remove();
      }, 300);
    },
  });

  runtime.documentRef.body.appendChild(overlay);
  runtime.windowRef.requestAnimationFrame(() => {
    overlay.classList.add('show');
  });
}

export async function navigateBack() {
  await navigateHistory('back');
}

export async function navigateForward() {
  await navigateHistory('forward');
}

export function updateNavigationButtons() {
  const backButton = runtime.documentRef.getElementById('nav-back-btn');
  const forwardButton = runtime.documentRef.getElementById('nav-forward-btn');
  const paneManager = runtime.getPaneManager();
  if (!backButton || !forwardButton || !paneManager) {
    return;
  }

  const tabManager = paneManager.getTabManager(paneManager.activePaneId);
  const activeTab = tabManager?.getActiveTab();
  if (!tabManager || tabManager.tabs.size === 0 || !activeTab) {
    backButton.style.display = 'none';
    forwardButton.style.display = 'none';
    return;
  }

  backButton.style.display = '';
  forwardButton.style.display = '';
  backButton.disabled = !tabManager.canGoBack(activeTab.id);
  forwardButton.disabled = !tabManager.canGoForward(activeTab.id);
}

export function toggleZenMode() {
  const appContainer = runtime.documentRef.querySelector('.app-container');
  const sidebar = runtime.documentRef.querySelector('.sidebar');
  const rightSidebar = runtime.documentRef.getElementById('right-sidebar');
  const editorHeader = runtime.documentRef.getElementById('editor-header');
  const statusBar = runtime.documentRef.getElementById('editor-status-bar');
  const editorContainer = runtime.documentRef.querySelector('.editor-container');
  const menuText = runtime.documentRef.getElementById('zen-mode-text');
  const dropdown = runtime.documentRef.getElementById('editor-dropdown');

  const nextZenMode = !runtime.getIsZenMode();
  runtime.setIsZenMode(nextZenMode);

  if (nextZenMode) {
    zenModeState.wasRightSidebarVisible = Boolean(rightSidebar?.classList.contains('visible'));
    if (sidebar) sidebar.style.display = 'none';
    if (rightSidebar) {
      rightSidebar.classList.remove('visible');
      rightSidebar.style.display = 'none';
    }
    if (editorHeader) editorHeader.style.display = 'none';
    if (statusBar) statusBar.style.display = 'none';
    if (editorContainer) {
      editorContainer.style.margin = '0';
      editorContainer.style.height = '100vh';
      editorContainer.style.width = '100vw';
      editorContainer.style.maxWidth = 'none';
      editorContainer.style.flex = 'none';
    }
    appContainer?.classList.add('zen-mode');
    if (menuText) menuText.textContent = 'Exit zen mode';
  } else {
    if (sidebar) sidebar.style.display = '';
    if (editorHeader) editorHeader.style.display = '';
    if (statusBar && runtime.getStatusBarVisible()) statusBar.style.display = '';
    if (rightSidebar) {
      rightSidebar.style.display = '';
      rightSidebar.classList.toggle(
        'visible',
        zenModeState.wasRightSidebarVisible || Boolean(runtime.getChatPanel()?.isVisible),
      );
    }
    if (editorContainer) {
      editorContainer.style.margin = '';
      editorContainer.style.height = '';
      editorContainer.style.width = '';
      editorContainer.style.maxWidth = '';
      editorContainer.style.flex = '';
    }
    appContainer?.classList.remove('zen-mode');
    if (menuText) menuText.textContent = 'Enter zen mode';
    runtime.windowRef.setTimeout(() => {
      if (editorContainer) void editorContainer.offsetHeight;
      runtime.getPaneManager()?.updateLayout?.();
      runtime.getCurrentEditor()?.view?.requestMeasure?.();
    }, 100);
  }

  dropdown?.classList.add('hidden');
}

export function applySettingsToAllEditors(editorSettings) {
  runtime.windowRef.pendingEditorSettings = {
    ...(runtime.windowRef.pendingEditorSettings || {}),
    ...(editorSettings.fontSize !== undefined ? { fontSize: editorSettings.fontSize } : {}),
    ...(editorSettings.fontFamily !== undefined ? { fontFamily: editorSettings.fontFamily } : {}),
    ...(editorSettings.fontColor !== undefined ? { fontColor: editorSettings.fontColor } : {}),
    ...(editorSettings.theme !== undefined ? { theme: editorSettings.theme } : {}),
    ...(editorSettings.themeOverrides !== undefined
      ? { themeOverrides: runtime.normalizeThemeOverrides(editorSettings.themeOverrides) }
      : {}),
    ...(editorSettings.lineNumbers !== undefined
      ? { lineNumbers: editorSettings.lineNumbers }
      : {}),
    ...(editorSettings.lineWrapping !== undefined
      ? { lineWrapping: editorSettings.lineWrapping }
      : {}),
    ...(editorSettings.showStatusBar !== undefined
      ? { showStatusBar: editorSettings.showStatusBar }
      : {}),
    ...(editorSettings.wysiwygMode !== undefined
      ? { wysiwygMode: editorSettings.wysiwygMode }
      : {}),
  };

  const root = runtime.documentRef.documentElement;
  if (editorSettings.fontSize) {
    root.style.setProperty('--editor-font-size', `${editorSettings.fontSize}px`);
  }
  if (editorSettings.fontFamily) {
    root.style.setProperty('--editor-font-family', editorSettings.fontFamily);
  }
  if (editorSettings.fontColor) {
    root.style.setProperty('--editor-text-color', editorSettings.fontColor);
    root.style.setProperty('--md-heading-color', editorSettings.fontColor);
  }

  if (editorSettings.theme && runtime.ThemeManager) {
    let themeManager = runtime.getCurrentThemeManager();
    if (!themeManager) {
      themeManager = new runtime.ThemeManager(null);
      runtime.setCurrentThemeManager(themeManager);
      runtime.windowRef.themeManager = themeManager;
    }
    themeManager.applyTheme(
      editorSettings.theme,
      runtime.normalizeThemeOverrides(editorSettings.themeOverrides),
    );
  }

  const paneManager = runtime.getPaneManager();
  if (paneManager?.panes) {
    for (const pane of paneManager.panes.values()) {
      for (const tab of pane.tabManager?.tabs?.values?.() || []) {
        applyEditorSettings(tab, editorSettings);
      }
    }
  }

  if (editorSettings.showStatusBar !== undefined) {
    const statusBar = runtime.documentRef.getElementById('status-bar');
    if (statusBar) {
      statusBar.style.display = editorSettings.showStatusBar ? 'flex' : 'none';
      runtime.setStatusBarVisible(editorSettings.showStatusBar);
    }
  }

  const themeManager = runtime.getCurrentThemeManager();
  if (themeManager) {
    themeManager.saveEditorPreference('font_size', editorSettings.fontSize?.toString() || '16');
    themeManager.saveEditorPreference('font_family', editorSettings.fontFamily || 'Inter');
    themeManager.saveEditorPreference('theme', editorSettings.theme || 'default');
  }
}

export function toggleLineNumbers() {
  const currentEditor = runtime.getCurrentEditor();
  if (!currentEditor?.toggleLineNumbers) {
    return;
  }

  const isEnabled = currentEditor.toggleLineNumbers();
  const menuText = runtime.documentRef.getElementById('line-numbers-text');
  if (menuText) {
    menuText.textContent = isEnabled ? 'Hide lines' : 'Show lines';
  }
  runtime.documentRef.getElementById('editor-dropdown')?.classList.add('hidden');
}

export function setupSidebarResize() {
  const sidebar = runtime.documentRef.querySelector('.sidebar');
  const resizeHandle = runtime.documentRef.getElementById('sidebar-resize-handle');
  if (!sidebar || !resizeHandle || resizeHandle.__sidebarResizeSetup) {
    return;
  }

  resizeHandle.__sidebarResizeSetup = true;
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (event) => {
    isResizing = true;
    startX = event.clientX;
    startWidth = sidebar.offsetWidth;
    resizeHandle.classList.add('resizing');
    runtime.documentRef.body.style.cursor = 'col-resize';
    event.preventDefault();
  });

  runtime.documentRef.addEventListener('mousemove', (event) => {
    if (!isResizing) return;
    const deltaX = event.clientX - startX;
    const newWidth = Math.min(Math.max(startWidth + deltaX, 180), 400);
    sidebar.style.width = `${newWidth}px`;
    runtime.windowRef.localStorage?.setItem(getSidebarWidthKey(), String(newWidth));
  });

  runtime.documentRef.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('resizing');
    runtime.documentRef.body.style.cursor = '';
  });

  const savedWidth = runtime.windowRef.localStorage?.getItem(getSidebarWidthKey());
  if (savedWidth) {
    sidebar.style.width = `${savedWidth}px`;
  }
}

export function initializeChatResize() {
  const resizeHandle = runtime.documentRef.getElementById('chat-resize-handle');
  const rightSidebar = runtime.documentRef.getElementById('right-sidebar');
  if (!resizeHandle || !rightSidebar || resizeHandle.__chatResizeSetup) {
    return;
  }

  resizeHandle.__chatResizeSetup = true;
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (event) => {
    isResizing = true;
    startX = event.clientX;
    startWidth = rightSidebar.offsetWidth;
    resizeHandle.classList.add('dragging');
    runtime.documentRef.body.style.cursor = 'col-resize';
    runtime.documentRef.body.classList.add('resizing-chat');
    event.preventDefault();
  });

  runtime.documentRef.addEventListener('mousemove', (event) => {
    if (!isResizing) return;
    const deltaX = startX - event.clientX;
    const newWidth = Math.min(Math.max(startWidth + deltaX, 250), 600);
    rightSidebar.style.width = `${newWidth}px`;
    if (rightSidebar.classList.contains('visible')) {
      runtime.windowRef.localStorage?.setItem('chatPanelWidth', String(newWidth));
    }
  });

  runtime.documentRef.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    runtime.documentRef.body.style.cursor = '';
    runtime.documentRef.body.classList.remove('resizing-chat');
  });

  const savedWidth = runtime.windowRef.localStorage?.getItem('chatPanelWidth');
  if (savedWidth && rightSidebar.classList.contains('visible')) {
    rightSidebar.style.width = `${savedWidth}px`;
  }
}

async function navigateHistory(direction) {
  const paneManager = runtime.getPaneManager();
  const tabManager = paneManager?.getTabManager?.(paneManager.activePaneId);
  const activeTab = tabManager?.getActiveTab?.();
  if (!tabManager || !activeTab) {
    return;
  }

  if (direction === 'back') {
    await tabManager.goBack(activeTab.id);
  } else {
    await tabManager.goForward(activeTab.id);
  }
}

function applyEditorSettings(tab, editorSettings) {
  if (!tab.editor || tab.type !== 'markdown') {
    return;
  }

  if (editorSettings.fontSize && tab.editor.setFontSize) {
    tab.editor.setFontSize(editorSettings.fontSize);
  }
  if (editorSettings.fontColor && tab.editor.view?.dom) {
    tab.editor.view.dom.style.setProperty('--editor-text-color', editorSettings.fontColor);
    tab.editor.view.dom.style.setProperty('--text-primary', editorSettings.fontColor);
  }
  if (editorSettings.lineNumbers !== undefined) {
    tab.editor.setLineNumbers?.(editorSettings.lineNumbers);
  }
  if (editorSettings.lineWrapping !== undefined) {
    tab.editor.setLineWrapping?.(editorSettings.lineWrapping);
  }
  if (editorSettings.wysiwygMode !== undefined) {
    tab.editor.setWysiwygMode?.(editorSettings.wysiwygMode);
  }
  if (tab.editor.refreshTheme) {
    runtime.windowRef.setTimeout(() => tab.editor.refreshTheme(), 50);
  }
}

function getSidebarWidthKey() {
  return `sidebar-width-${runtime.windowRef.currentVaultPath || 'default'}`;
}
