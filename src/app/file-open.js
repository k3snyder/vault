import { MarkdownEditor } from '../editor/markdown-editor.js';
import {
  applyLineNavigation,
  createPendingLineNavigation,
  takeMatchingLineNavigation,
} from '../utils/file-line-navigation.js';
import { getFileOpenKind, shouldReuseExistingFileTab } from '../utils/file-open-rules.js';

let pendingFileLineNavigation = null;

const runtime = {
  appContext: null,
  invoke: null,
  log: console,
  asCommandError: (error) => error,
  windowRef: null,
  documentRef: null,
  getPaneManager: () => null,
  getActiveTabManager: () => null,
  getCurrentEditor: () => null,
  setCurrentEditorState: () => {},
  loadEditorPreferences: async () => {},
  setupEditorChangeTracking: () => {},
  hideSectionHubs: () => {},
  updateSidebarAppNav: () => {},
  rebuildEditorHeader: () => {},
  updateEditorHeader: () => {},
  updateNavigationButtons: () => {},
  updateWordCount: () => {},
  showEditorWorkspace: () => {},
  showError: () => {},
  refreshFileTree: async () => {},
  getStatusBarVisible: () => true,
};

export function initFileOpen(
  appContext,
  {
    invoke,
    log = console,
    asCommandError = (error) => error,
    windowRef = window,
    documentRef = document,
    getPaneManager = () => null,
    getActiveTabManager = () => null,
    getCurrentEditor = () => null,
    setCurrentEditorState = () => {},
    loadEditorPreferences = async () => {},
    setupEditorChangeTracking = () => {},
    hideSectionHubs = () => {},
    updateSidebarAppNav = () => {},
    rebuildEditorHeader = () => {},
    updateEditorHeader = () => {},
    updateNavigationButtons = () => {},
    updateWordCount = () => {},
    showEditorWorkspace = () => {},
    showError = () => {},
    refreshFileTree = async () => {},
    getStatusBarVisible = () => true,
  } = {},
) {
  Object.assign(runtime, {
    appContext,
    invoke,
    log,
    asCommandError,
    windowRef,
    documentRef,
    getPaneManager,
    getActiveTabManager,
    getCurrentEditor,
    setCurrentEditorState,
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
    getStatusBarVisible,
  });

  return {
    handleFileClick,
    openFile,
    openFileInNewTab,
    createAndOpenFile,
    saveCurrentFile,
    onFileSaved,
    queueFileLineNavigation,
    applyPendingFileLineNavigation,
  };
}

export function queueFileLineNavigation(filePath, lineNumber) {
  pendingFileLineNavigation = createPendingLineNavigation(filePath, lineNumber);
}

export function applyPendingFileLineNavigation(filePath, editor) {
  const { nextRequest, lineNumber } = takeMatchingLineNavigation(
    pendingFileLineNavigation,
    filePath,
  );
  pendingFileLineNavigation = nextRequest;

  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    return false;
  }

  return applyLineNavigation(editor, lineNumber);
}

export function isCsvSupportEnabled() {
  try {
    const key = 'bundled_plugin_csv-support';
    const rawValue = runtime.windowRef.localStorage?.getItem(key);
    runtime.log.debug?.('🔧 CSV plugin localStorage raw value:', rawValue);
    const settings = JSON.parse(rawValue || '{}');
    runtime.log.debug?.('🔧 CSV plugin settings parsed:', settings);
    if (settings.enabled !== undefined) {
      runtime.log.debug?.('🔧 CSV plugin enabled explicitly set to:', settings.enabled);
      return settings.enabled;
    }
    runtime.log.debug?.('🔧 CSV plugin enabled not set, defaulting to true');
    return true;
  } catch (error) {
    runtime.log.debug?.('🔧 CSV plugin settings error:', error);
    return true;
  }
}

export async function handleFileClick(filePath, isDir) {
  runtime.log.debug?.('🔍 File clicked:', filePath, 'isDir:', isDir);

  if (isDir) {
    runtime.log.debug?.('📁 Directory clicked - not implemented yet');
    return;
  }

  const openKind = getFileOpenKind(filePath);
  const isImage = openKind === 'image';
  const isPDF = openKind === 'pdf';
  const isCSV = openKind === 'csv';
  const isSketch = openKind === 'sketch';
  const isBoxNote = openKind === 'boxnote';
  const isHTML = openKind === 'html';

  try {
    runtime.hideSectionHubs();

    const paneManager = runtime.getPaneManager();
    const tabManager = paneManager ? paneManager.getActiveTabManager() : null;
    if (!tabManager) {
      console.error('❌ No active TabManager found');
      return;
    }

    const existingPane = paneManager.findPaneByFilePath(filePath);
    if (existingPane) {
      const existingTab = existingPane.tabManager.findTabByPath(filePath);
      const needsTypedTab = isPDF || isCSV || isSketch || isBoxNote || isHTML;

      if (needsTypedTab && existingTab) {
        const csvEnabled = isCSV ? isCsvSupportEnabled() : true;
        const shouldReuseTab = shouldReuseExistingFileTab({
          openKind,
          existingTabType: existingTab.type,
          csvEnabled,
        });

        if (!shouldReuseTab) {
          runtime.log.debug?.(
            '📑 File tab type mismatch - closing and reopening with correct type',
          );
          await existingPane.tabManager.closeTab(existingTab.id, true);
        } else {
          runtime.log.debug?.('📑 File already open in pane, switching to it');
          paneManager.activatePane(existingPane.id);
          existingPane.tabManager.activateTab(existingTab.id);
          return;
        }
      } else {
        runtime.log.debug?.('📑 File already open in pane, switching to it');
        paneManager.activatePane(existingPane.id);
        if (existingTab) {
          existingPane.tabManager.activateTab(existingTab.id);
        }
        return;
      }
    }

    if (isPDF || isSketch || isBoxNote || isHTML) {
      await tabManager.openFile(filePath);
      showActiveFileChrome(filePath.split('/').pop());
      return;
    }

    runtime.log.debug?.('📖 Reading file:', filePath);
    let content;

    if (isImage) {
      const filename = filePath.split('/').pop();
      content = `# ${filename}\n\n![[${filename}]]`;
    } else {
      content = await runtime.invoke('read_file_content', { filePath });
      runtime.log.debug?.('📄 File content loaded, length:', content.length);
    }

    let activeTab = tabManager.getActiveTab();

    if (isCSV) {
      runtime.log.debug?.('📊 Opening CSV file via openFile():', filePath);
      const tabId = await tabManager.openFile(filePath, content);
      activeTab = tabManager.tabs.get(tabId);
      if (activeTab?.editor) {
        await runtime.loadEditorPreferences(activeTab.editor);
      }
      showActiveFileChrome(filePath.split('/').pop());
      return;
    }

    if (!activeTab || tabManager.tabs.size === 0) {
      const tabId = tabManager.createTab(filePath, content);
      activeTab = tabManager.tabs.get(tabId);
      await runtime.loadEditorPreferences(activeTab.editor);
      tabManager.activateTab(tabId);
    } else {
      if (activeTab.isDirty && activeTab.filePath) {
        const confirmed = runtime.windowRef.confirm(
          `"${activeTab.title}" has unsaved changes. Continue without saving?`,
        );
        if (!confirmed) {
          return;
        }
      }

      await tabManager.navigateToFile(activeTab.id, filePath);
      activeTab.isDirty = false;

      const hasNewTabScreen = activeTab.editorContainer.querySelector('.new-tab-screen');
      if (hasNewTabScreen || !activeTab.editor || !activeTab.editor.view) {
        if (activeTab.editor && activeTab.editor.destroy) {
          runtime.log.debug?.('🧹 Destroying existing editor before recreating');
          activeTab.editor.destroy();
        }

        activeTab.editorContainer.innerHTML = '';
        activeTab.editor = new MarkdownEditor(activeTab.editorContainer);
        await runtime.loadEditorPreferences(activeTab.editor);
        runtime.setupEditorChangeTracking(activeTab.id, activeTab);
      }

      activeTab.editor.setContent(content);
      activeTab.editor.currentFile = filePath;

      const activePane = paneManager.panes.get(paneManager.activePaneId);
      if (activePane && activePane.tabBar) {
        activePane.tabBar.updateTabTitle(activeTab.id, activeTab.title);
        activePane.tabBar.updateTabDirtyState(activeTab.id, false);
      }

      runtime.setCurrentEditorState(activeTab);
      runtime.updateEditorHeader(activeTab.title);

      if (runtime.windowRef.widgetSidebar) {
        runtime.windowRef.widgetSidebar.updateActiveEditor(
          activeTab.type === 'markdown' ? activeTab.editor : null,
        );
      }

      tabManager.emit('tab-changed', { tabId: activeTab.id });
    }

    showActiveFileChrome(activeTab.title);

    const statusBar = runtime.documentRef.getElementById('editor-status-bar');
    if (statusBar) {
      statusBar.style.display = runtime.getStatusBarVisible() ? 'flex' : 'none';
    }

    runtime.updateWordCount();
  } catch (error) {
    console.error('❌ Failed to read file:', error);
    runtime.showError('Failed to load file: ' + runtime.asCommandError(error).message);
  }
}

export async function saveCurrentFile() {
  const tabManager = runtime.getActiveTabManager();
  if (!tabManager) return;

  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !activeTab.filePath) {
    return;
  }

  if (
    activeTab.editor &&
    typeof activeTab.editor.save === 'function' &&
    activeTab.type === 'markdown'
  ) {
    await activeTab.editor.save();
    return;
  }

  if (activeTab.type === 'boxnote' || activeTab.type === 'html') {
    runtime.log.debug?.('📘 Skipping save for read-only preview');
    return;
  }

  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif'];
  const fileExtension = activeTab.filePath.split('.').pop().toLowerCase();
  if (imageExtensions.includes(fileExtension) || fileExtension === 'pdf') {
    runtime.log.debug?.('🖼️ Skipping save for image/PDF file');
    return;
  }

  try {
    runtime.log.debug?.('💾 Saving file:', activeTab.filePath);
    const content = activeTab.editor.getSerializableContent
      ? activeTab.editor.getSerializableContent()
      : activeTab.editor.getContent();
    const newTimestamp = await runtime.invoke('write_file_content', {
      filePath: activeTab.filePath,
      content,
    });

    if (newTimestamp && activeTab.editor) {
      updateEditorTimestamp(activeTab.editor, newTimestamp);
    }

    activeTab.editor.hasUnsavedChanges = false;
    tabManager.setTabDirty(activeTab.id, false);

    const paneManager = runtime.getPaneManager();
    const activePane = paneManager?.panes?.get(paneManager.activePaneId);
    if (activePane && activePane.tabBar) {
      activePane.tabBar.updateTabDirtyState(activeTab.id, false);
    }

    runtime.log.debug?.('✅ File saved successfully');
  } catch (error) {
    console.error('❌ Failed to save file:', error);
    runtime.showError('Failed to save file: ' + runtime.asCommandError(error).message);
  }
}

export function onFileSaved(filePath) {
  runtime.log.debug?.('🔍 onFileSaved called with:', filePath);
  const paneManager = runtime.getPaneManager();
  if (!paneManager) {
    runtime.log.debug?.('❌ No paneManager available');
    return;
  }

  for (const [paneId, pane] of paneManager.panes) {
    runtime.log.debug?.('🔍 Checking pane:', paneId);
    const tab = pane.tabManager.findTabByPath(filePath);
    if (tab) {
      runtime.log.debug?.('✅ Found tab:', tab.id, 'with path:', tab.filePath);
      pane.tabManager.setTabDirty(tab.id, false);
      if (pane.tabBar) {
        pane.tabBar.updateTabDirtyState(tab.id, false);
      }
      break;
    }
  }
}

export async function openFile(filePath) {
  runtime.log.debug?.('📂 Opening file:', filePath);
  await handleFileClick(filePath, false);
}

export async function openFileInNewTab(filePath) {
  runtime.log.debug?.('📂 Opening file in new tab:', filePath);

  const tabManager = runtime.getActiveTabManager();
  if (!tabManager) {
    throw new Error('No active TabManager found');
  }

  const openKind = getFileOpenKind(filePath);
  const isImage = openKind === 'image';
  const isTypedTab =
    openKind === 'pdf' ||
    openKind === 'csv' ||
    openKind === 'sketch' ||
    openKind === 'boxnote' ||
    openKind === 'html';
  let tabId;

  if (isTypedTab) {
    tabId = await tabManager.openFile(filePath);
  } else {
    let content;
    if (isImage) {
      const filename = filePath.split('/').pop();
      content = `# ${filename}\n\n![[${filename}]]`;
    } else {
      content = await runtime.invoke('read_file_content', { filePath });
    }

    tabId = await tabManager.openFile(filePath, content);
    const tab = tabManager.tabs.get(tabId);
    if (tab?.editor) {
      await runtime.loadEditorPreferences(tab.editor);
    }
  }

  const activeTab = tabManager.tabs.get(tabId);
  if (activeTab) {
    runtime.setCurrentEditorState(activeTab);
  }

  runtime.showEditorWorkspace(filePath.split('/').pop());
  runtime.updateNavigationButtons();
  return tabId;
}

export async function createAndOpenFile(filePath, content = '') {
  runtime.log.debug?.('📝 Creating new file:', filePath);

  try {
    await runtime.invoke('write_file_content', { filePath, content });
    await openFile(filePath);
    await runtime.refreshFileTree();
  } catch (error) {
    console.error('Error creating file:', error);
    runtime.showError(`Failed to create ${filePath}: ${error}`);
  }
}

function showActiveFileChrome(fileName) {
  const welcomeContainer = runtime.documentRef.querySelector('.welcome-container');
  if (welcomeContainer) {
    welcomeContainer.style.display = 'none';
  }
  runtime.updateSidebarAppNav();

  const editorHeader = runtime.documentRef.getElementById('editor-header');
  if (editorHeader) {
    editorHeader.style.display = 'flex';
    runtime.rebuildEditorHeader(fileName);
  }

  runtime.updateNavigationButtons();
}

function updateEditorTimestamp(editor, newTimestamp) {
  const currentContent = editor.getContent();
  const lines = currentContent.split('\n');
  let inFrontmatter = false;
  let frontmatterCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      frontmatterCount += 1;
      if (frontmatterCount === 1) {
        inFrontmatter = true;
      } else if (frontmatterCount === 2) {
        break;
      }
    } else if (inFrontmatter && lines[index].startsWith('updated_at:')) {
      lines[index] = `updated_at: ${newTimestamp}`;
      const newContent = lines.join('\n');
      const view = editor.view;
      if (view) {
        const cursorPos = view.state.selection.main.head;
        const transaction = view.state.update({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: newContent,
          },
        });

        view.dispatch(transaction);

        const newDocLength = view.state.doc.length;
        const validCursorPos = Math.min(cursorPos, newDocLength);
        if (validCursorPos >= 0) {
          view.dispatch({
            selection: { anchor: validCursorPos, head: validCursorPos },
          });
        }
      }
      break;
    }
  }
}
