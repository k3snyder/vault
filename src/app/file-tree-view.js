import {
  FILE_TREE_ROW_HEIGHT,
  computeVisibleRows,
  createFileTreeVirtualWindow,
  renderFileTreeHtml,
} from './file-tree.js';
import { collapseFolderState } from '../utils/file-tree-state.js';

const SORT_STORAGE_KEY = 'gaimplan-sort-option';

const runtime = {
  appContext: null,
  invoke: null,
  icons: null,
  log: console,
  asCommandError: (error) => error,
  dndLog: () => {},
  windowRef: null,
  documentRef: null,
  scrollRafId: null,
  sortOption: 'alphabetical',
  frontendListenerBound: false,
};

export function initFileTreeView(
  appContext,
  {
    invoke,
    icons,
    log = console,
    asCommandError = (error) => error,
    dndLog = () => {},
    windowRef = window,
    documentRef = document,
  } = {},
) {
  runtime.appContext = appContext;
  runtime.invoke = invoke;
  runtime.icons = icons;
  runtime.log = log;
  runtime.asCommandError = asCommandError;
  runtime.dndLog = dndLog;
  runtime.windowRef = windowRef;
  runtime.documentRef = documentRef;
  runtime.sortOption = windowRef.localStorage?.getItem(SORT_STORAGE_KEY) || 'alphabetical';
  runtime.appContext.vault.sortOption = runtime.sortOption;

  bindFrontendVaultChangeListener();
  setupFileSystemWatcher();

  return {
    displayFileTree,
    refreshFileTree,
    toggleFolder,
    setSortOption,
    setupFileSystemWatcher,
    scrollTreeItemIntoView,
  };
}

export function displayFileTree(fileTree, { preserveScroll = true } = {}) {
  const { appContext, documentRef, icons, log } = runtime;
  appContext.vault.fileTree = fileTree;
  log.debug?.('🌲 Displaying file tree with', fileTree.files.length, 'items');
  log.debug?.('📂 Currently expanded folders:', Array.from(appContext.vault.expandedFolders));
  log.debug?.('📊 Sample file tree items:', fileTree.files.slice(0, 5));

  const rootItems = fileTree.files.filter((file) => !file.parent_path);
  log.debug?.(
    '🌳 Root level items:',
    rootItems.map((file) => file.name),
  );

  const fileTreeElement = documentRef.getElementById('file-tree');
  if (!fileTreeElement) {
    console.error('❌ File tree element not found');
    return;
  }

  if (fileTree.files.length === 0) {
    fileTreeElement.innerHTML = `
      <div class="empty-vault">
        <p>📁 Vault is empty</p>
        <p><em>Create your first note to get started!</em></p>
      </div>
    `;
    return;
  }

  const previousScrollTop = preserveScroll ? fileTreeElement.scrollTop : 0;
  const visibleRows = getVisibleRows(fileTree.files);
  const virtualWindow = createFileTreeVirtualWindow(visibleRows, {
    scrollTop: previousScrollTop,
    containerHeight: fileTreeElement.clientHeight || 0,
  });

  fileTreeElement.innerHTML = renderFileTreeHtml(visibleRows, {
    expandedFolders: appContext.vault.expandedFolders,
    icons,
    virtualWindow,
  });

  setupFileTreeScrollHandler(fileTreeElement);
  if (preserveScroll) {
    fileTreeElement.scrollTop = previousScrollTop;
  }
}

export function showFileTreeError(error) {
  runtime.appContext.vault.fileTree = null;
  const fileTreeElement = runtime.documentRef.getElementById('file-tree');
  if (fileTreeElement) {
    const errorState = runtime.documentRef.createElement('div');
    errorState.className = 'error-state';

    const title = runtime.documentRef.createElement('p');
    title.textContent = '❌ Failed to load files';

    const detail = runtime.documentRef.createElement('p');
    const emphasis = runtime.documentRef.createElement('em');
    emphasis.textContent = String(error);
    detail.appendChild(emphasis);

    errorState.append(title, detail);
    fileTreeElement.replaceChildren(errorState);
  }
}

export function toggleFolder(folderPath, event = null) {
  event?.stopPropagation?.();
  runtime.log.debug?.('🔽 Toggling folder:', folderPath);

  const expandedFolders = runtime.appContext.vault.expandedFolders;
  if (expandedFolders.has(folderPath)) {
    runtime.appContext.vault.expandedFolders = collapseFolderState(expandedFolders, folderPath);
  } else {
    expandedFolders.add(folderPath);
  }

  refreshFileTree();
}

export function expandFolder(folderPath) {
  runtime.appContext?.vault?.expandedFolders?.add(folderPath);
}

export function handleFolderClick(folderPath, event = null) {
  event?.stopPropagation?.();
  runtime.log.debug?.('📁 Folder clicked:', folderPath);
  toggleFolder(folderPath, event);
}

export function handleFileDragStart(event) {
  const item = event.target.closest('.tree-item.file');
  const path = item?.getAttribute('data-path');
  if (path) {
    event.dataTransfer.setData('text/plain', path);
    event.dataTransfer.setData('text/uri-list', `file://${path}`);
    event.dataTransfer.setData('application/x-vault-file', path);
    runtime.windowRef.__dragSourcePath = path;
  }
  runtime.windowRef.__dndDropProcessed = false;
  try {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
  } catch (error) {
    runtime.log.swallow?.('suppressed error', error);
  }
  runtime.dndLog('dragstart', {
    path,
    types: Array.from(event.dataTransfer?.types || []),
    effectAllowed: event.dataTransfer?.effectAllowed,
  });
  if (item) item.classList.add('dragging');
}

export function handleFileDrag(event) {
  if (
    typeof event.clientX === 'number' &&
    typeof event.clientY === 'number' &&
    (event.clientX !== 0 || event.clientY !== 0)
  ) {
    runtime.windowRef.__dragLastPt = { x: event.clientX, y: event.clientY };
    runtime.dndLog('drag', runtime.windowRef.__dragLastPt);
  }
}

export function handleFileDragEnd(event) {
  const item = event.target.closest('.tree-item.file');
  if (item) item.classList.remove('dragging');
  runtime.documentRef
    .querySelectorAll('.tree-item.folder.drag-over')
    .forEach((element) => element.classList.remove('drag-over'));

  if (runtime.windowRef.__dragSourcePath && !runtime.windowRef.__dndDropProcessed) {
    let point = null;
    if (
      runtime.windowRef.__dragLastPt &&
      runtime.windowRef.__dragLastPt.x &&
      runtime.windowRef.__dragLastPt.y
    ) {
      point = runtime.windowRef.__dragLastPt;
      runtime.dndLog('dragend using last tracked pt', point);
    } else if (
      typeof event.clientX === 'number' &&
      typeof event.clientY === 'number' &&
      (event.clientX !== 0 || event.clientY !== 0)
    ) {
      point = { x: event.clientX, y: event.clientY };
      runtime.dndLog('dragend using event coordinates', point);
    } else if (event.pageX && event.pageY) {
      point = { x: event.pageX, y: event.pageY };
      runtime.dndLog('dragend using page coordinates', point);
    }

    if (point && point.x && point.y) {
      const elements = runtime.documentRef.elementsFromPoint(point.x, point.y) || [];
      let folderElement = null;
      for (const element of elements) {
        if (element.classList && element.classList.contains('folder')) {
          folderElement = element;
          break;
        }
        const parent = element.closest?.('.tree-item.folder');
        if (parent) {
          folderElement = parent;
          break;
        }
      }

      const destinationPath = folderElement?.getAttribute('data-path') || '';
      if (destinationPath && destinationPath !== runtime.windowRef.__dragSourcePath) {
        performMoveToFolder(runtime.windowRef.__dragSourcePath, destinationPath);
      }
    } else {
      runtime.dndLog('dragend - no valid coordinates available for fallback');
    }
  }

  runtime.windowRef.__dragSourcePath = null;
  runtime.windowRef.__dragLastPt = null;
  runtime.windowRef.__dndDropProcessed = false;
  runtime.dndLog('dragend complete');
}

export function handleFolderDragEnter(event) {
  event.preventDefault();
  event.stopPropagation();
  const folderElement = event.target.closest('.tree-item.folder');
  if (folderElement) folderElement.classList.add('drag-over');
  runtime.dndLog('dragenter', {
    dest: folderElement?.getAttribute('data-path'),
    types: event.dataTransfer?.types,
    effectAllowed: event.dataTransfer?.effectAllowed,
  });
}

export function handleFolderDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  try {
    event.dataTransfer.dropEffect = 'move';
  } catch (error) {
    runtime.log.swallow?.('suppressed error', error);
  }
  const folderElement = event.target.closest('.tree-item.folder');
  if (folderElement) folderElement.classList.add('drag-over');
  runtime.dndLog('dragover', {
    dest: folderElement?.getAttribute('data-path'),
    dropEffect: event.dataTransfer?.dropEffect,
  });
}

export function handleFolderDragLeave(event) {
  event.stopPropagation();
  const folderElement = event.target.closest('.tree-item.folder');
  if (folderElement) folderElement.classList.remove('drag-over');
  runtime.dndLog('dragleave', { dest: folderElement?.getAttribute('data-path') });
}

export async function handleFolderDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const folderElement = event.target.closest('.tree-item.folder');
  if (folderElement) folderElement.classList.remove('drag-over');
  const destinationPath = folderElement?.getAttribute('data-path') || '';
  const sourcePath =
    event.dataTransfer?.getData('text/plain') || runtime.windowRef?.__dragSourcePath || '';
  runtime.dndLog('drop', {
    destinationPath,
    sourcePath,
    types: event.dataTransfer?.types,
    dropEffect: event.dataTransfer?.dropEffect,
  });
  if (!sourcePath) return;

  await performMoveToFolder(sourcePath, destinationPath);
}

export async function performMoveToFolder(sourcePath, destinationPath) {
  const sourceParent = sourcePath.includes('/')
    ? sourcePath.slice(0, sourcePath.lastIndexOf('/'))
    : '';
  if (sourceParent === destinationPath) {
    runtime.dndLog('noop: same parent');
    return;
  }

  const fileName = sourcePath.split('/').pop();
  const newPath = destinationPath ? `${destinationPath}/${fileName}` : fileName;
  runtime.dndLog('move_file invoke', { oldPath: sourcePath, newPath });

  try {
    await runtime.invoke('move_file', { oldPath: sourcePath, newPath });
    runtime.dndLog('move_file success', { oldPath: sourcePath, newPath });
    const fileTree = await runtime.invoke('get_file_tree');
    displayFileTree(fileTree);
  } catch (error) {
    console.error('Error moving file via drag-and-drop:', error);
    runtime.dndLog('move_file error', { error });
    runtime.windowRef.alert?.('Error moving file: ' + runtime.asCommandError(error).message);
  } finally {
    runtime.windowRef.__dragSourcePath = null;
  }
}

export async function refreshFileTree() {
  try {
    const fileTree = await runtime.invoke('get_file_tree');
    displayFileTree(fileTree, { preserveScroll: true });
  } catch (error) {
    console.error('❌ Failed to refresh file tree:', error);
  }
}

export function toggleSortMenu() {
  runtime.log.debug?.('🔽 Toggling sort menu...');
  const dropdown = runtime.documentRef.getElementById('sort-dropdown');
  const vaultDropdown = runtime.documentRef.getElementById('vault-dropdown');

  if (dropdown) {
    dropdown.classList.toggle('hidden');
    runtime.log.debug?.('📋 Sort menu visibility:', !dropdown.classList.contains('hidden'));

    if (vaultDropdown && !vaultDropdown.classList.contains('hidden')) {
      vaultDropdown.classList.add('hidden');
    }
  }
}

export function setSortOption(option) {
  runtime.log.debug?.('📊 Setting sort option:', option);
  runtime.sortOption = option;
  runtime.appContext.vault.sortOption = option;

  const dropdown = runtime.documentRef.getElementById('sort-dropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
  }

  runtime.windowRef.localStorage?.setItem(SORT_STORAGE_KEY, option);
  refreshFileTree();
}

export function scrollTreeItemIntoView(targetPath) {
  const fileTreeElement = runtime.documentRef.getElementById('file-tree');
  const fileTree = runtime.appContext.vault.fileTree;
  if (!fileTreeElement || !fileTree) {
    return;
  }

  const visibleRows = getVisibleRows(fileTree.files);
  const targetIndex = visibleRows.findIndex((row) => row.path === targetPath);
  if (targetIndex === -1) {
    return;
  }

  const virtualWindow = createFileTreeVirtualWindow(visibleRows, {
    scrollTop: fileTreeElement.scrollTop,
    containerHeight: fileTreeElement.clientHeight || 0,
  });

  if (virtualWindow.enabled) {
    fileTreeElement.scrollTop = targetIndex * FILE_TREE_ROW_HEIGHT;
    displayFileTree(fileTree, { preserveScroll: true });
  }

  const targetItem = runtime.documentRef.querySelector(
    `.tree-item[data-path="${cssEscape(targetPath)}"]`,
  );
  if (!targetItem) {
    return;
  }

  targetItem.scrollIntoView({ block: 'nearest' });
  targetItem.classList.add('tree-item-pulse');
  runtime.windowRef.clearTimeout(runtime.windowRef.__treeItemPulseTimeout);
  runtime.windowRef.__treeItemPulseTimeout = runtime.windowRef.setTimeout(() => {
    targetItem.classList.remove('tree-item-pulse');
  }, 1200);
}

async function setupFileSystemWatcher() {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen('vault-files-changed', (event) => {
      runtime.log.debug?.('📁 File system changed (backend event), refreshing file tree...');
      refreshFileTree();

      if (event.payload && event.payload.path) {
        const eventType = event.payload.type || 'file-updated';
        const customEvent = new CustomEvent(eventType, {
          detail: {
            path: event.payload.path,
            oldPath: event.payload.oldPath,
            newPath: event.payload.newPath,
          },
        });
        runtime.documentRef.dispatchEvent(customEvent);
      }
    });

    runtime.appContext.vault.fileWatcherUnlisten = unlisten;
  } catch (error) {
    console.error('Failed to setup file system watcher:', error);
  }
}

function bindFrontendVaultChangeListener() {
  if (runtime.frontendListenerBound) {
    return;
  }

  runtime.frontendListenerBound = true;
  runtime.windowRef.addEventListener('vault-files-changed', () => {
    runtime.log.debug?.('📁 Vault files changed (frontend event), refreshing file tree...');
    refreshFileTree();

    const fileChangeEvent = new CustomEvent('file-updated', {
      detail: { path: 'vault-changed' },
    });
    runtime.documentRef.dispatchEvent(fileChangeEvent);
  });
}

function setupFileTreeScrollHandler(fileTreeElement) {
  if (fileTreeElement.dataset.virtualScrollBound === 'true') {
    return;
  }

  fileTreeElement.dataset.virtualScrollBound = 'true';
  fileTreeElement.addEventListener('scroll', () => {
    if (!runtime.appContext?.vault?.fileTree) {
      return;
    }

    const raf = runtime.windowRef.requestAnimationFrame || ((callback) => callback());
    if (runtime.scrollRafId) {
      runtime.windowRef.cancelAnimationFrame?.(runtime.scrollRafId);
    }

    runtime.scrollRafId = raf(() => {
      runtime.scrollRafId = null;
      displayFileTree(runtime.appContext.vault.fileTree, { preserveScroll: true });
    });
  });
}

function getVisibleRows(files) {
  return computeVisibleRows(files, {
    expandedFolders: runtime.appContext.vault.expandedFolders,
    sortOption: runtime.sortOption,
  });
}

function cssEscape(value) {
  if (runtime.windowRef.CSS?.escape) {
    return runtime.windowRef.CSS.escape(value);
  }
  return String(value).replace(/"/g, '\\"');
}
