import { TaskDashboard } from '../tasks/TaskDashboard.js';
import { getClipboardPath } from '../utils/context-menu-paths.js';

const CREATE_FILE_MODAL_HTML = `
  <div id="file-name-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Create New File</h3>
      </div>
      <div class="modal-body">
        <p class="modal-description" id="file-name-modal-description"></p>
        <label for="file-name-input">File Name:</label>
        <input type="text" id="file-name-input" placeholder="My Note.md" value="Untitled.md" autofocus spellcheck="false">
      </div>
      <div class="modal-footer">
        <button id="file-cancel-btn" class="secondary-button">Cancel</button>
        <button id="file-create-btn" class="primary-button">Create File</button>
      </div>
    </div>
  </div>
`;

const CREATE_FOLDER_MODAL_HTML = `
  <div id="folder-name-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Create New Folder</h3>
      </div>
      <div class="modal-body">
        <p class="modal-description">Enter the name for your new folder:</p>
        <label for="folder-name-input">Folder Name:</label>
        <input type="text" id="folder-name-input" placeholder="My Folder" value="New Folder" autofocus spellcheck="false">
      </div>
      <div class="modal-footer">
        <button id="folder-cancel-btn" class="secondary-button">Cancel</button>
        <button id="folder-create-btn" class="primary-button">Create Folder</button>
      </div>
    </div>
  </div>
`;

const SKETCH_NAME_MODAL_HTML = `
  <div id="sketch-name-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Create Sketch</h3>
      </div>
      <div class="modal-body">
        <p class="modal-description">New sketches are saved in the Sketches folder.</p>
        <label for="sketch-name-input">Sketch Name:</label>
        <input type="text" id="sketch-name-input" placeholder="My Diagram" value="Untitled Sketch" autofocus spellcheck="false">
      </div>
      <div class="modal-footer">
        <button id="sketch-cancel-btn" class="secondary-button">Cancel</button>
        <button id="sketch-create-btn" class="primary-button">Create Sketch</button>
      </div>
    </div>
  </div>
`;

const runtime = {
  appContext: null,
  invoke: null,
  ask: async () => false,
  log: console,
  asCommandError: (error) => error,
  windowRef: null,
  documentRef: null,
  navigatorRef: null,
  TaskDashboardClass: TaskDashboard,
  displayFileTree: () => {},
  refreshFileTree: async () => {},
  handleFileClick: async () => {},
  showError: () => {},
  showNotification: () => {},
  getActiveTabManager: () => null,
  getPaneManager: () => null,
  getCurrentVaultPath: () => '',
};

let contextMenuTarget = null;
let moveContext = null;
let selectedFolderIndex = 0;
let availableFolders = [];
let renameContext = null;
let taskDashboard = null;

export function initFileModals(
  appContext,
  {
    invoke,
    ask,
    log = console,
    asCommandError = (error) => error,
    windowRef = window,
    documentRef = document,
    navigatorRef = navigator,
    TaskDashboardClass = TaskDashboard,
    displayFileTree = () => {},
    refreshFileTree = async () => {},
    handleFileClick = async () => {},
    showError = () => {},
    showNotification = () => {},
    getActiveTabManager = () => null,
    getPaneManager = () => null,
    getCurrentVaultPath = () => appContext?.vault?.path || '',
  } = {},
) {
  Object.assign(runtime, {
    appContext,
    invoke,
    ask,
    log,
    asCommandError,
    windowRef,
    documentRef,
    navigatorRef,
    TaskDashboardClass,
    displayFileTree,
    refreshFileTree,
    handleFileClick,
    showError,
    showNotification,
    getActiveTabManager,
    getPaneManager,
    getCurrentVaultPath,
  });

  return {
    showCreateFileModal,
    showCreateFolderModal,
    promptForSketchName,
    normalizeNewFileName,
    setupFileModalEventHandlers,
    showFileContextMenu,
    showFolderContextMenu,
    hideContextMenu,
    renameFile,
    confirmRename,
    closeRenameModal,
  };
}

export async function showCreateFileModal(folderPath = '', event = null) {
  event?.stopPropagation?.();
  runtime.log.debug?.('Opening create file modal for folder:', folderPath);

  try {
    const fileRequest = await promptForFileName(folderPath);
    if (!fileRequest?.fileName?.trim()) {
      return;
    }

    const fileName = fileRequest.fileName.trim();
    const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
    if (folderPath) {
      runtime.appContext?.vault?.expandedFolders?.add(folderPath);
    }

    await runtime.invoke('create_new_file', { fileName: fullPath });
    await runtime.refreshFileTree();
    runtime.windowRef.setTimeout(() => {
      runtime.handleFileClick(fullPath, false);
    }, 100);
  } catch (error) {
    console.error('Failed to create file:', error);
    runtime.showError('Failed to create file: ' + runtime.asCommandError(error).message);
  }
}

export async function showCreateFolderModal() {
  runtime.log.debug?.('Opening create folder modal');

  const folderName = await promptForFolderName();
  if (!folderName?.trim()) {
    return;
  }

  try {
    await runtime.invoke('create_new_folder', { folderName: folderName.trim() });
    const fileTree = await runtime.invoke('get_file_tree');
    runtime.displayFileTree(fileTree);
  } catch (error) {
    console.error('Failed to create folder:', error);
    runtime.showError('Failed to create folder: ' + runtime.asCommandError(error).message);
  }
}

export async function promptForSketchName() {
  return createNamePrompt({
    modalId: 'sketch-name-modal',
    inputId: 'sketch-name-input',
    cancelId: 'sketch-cancel-btn',
    confirmId: 'sketch-create-btn',
    html: SKETCH_NAME_MODAL_HTML,
    resolveValue: (input) => input.value.trim(),
  });
}

export function normalizeNewFileName(rawName = '') {
  const sanitized = rawName.trim().replace(/[\\/]+/g, '');
  if (!sanitized) {
    return '';
  }

  if (/\.[^./\\]+$/u.test(sanitized)) {
    return sanitized;
  }

  return `${sanitized}.md`;
}

export async function promptForFileName(folderPath = '') {
  return createNamePrompt({
    modalId: 'file-name-modal',
    inputId: 'file-name-input',
    cancelId: 'file-cancel-btn',
    confirmId: 'file-create-btn',
    html: CREATE_FILE_MODAL_HTML,
    beforeShow: () => {
      const description = runtime.documentRef.getElementById('file-name-modal-description');
      if (description) {
        description.textContent = folderPath
          ? `Create a markdown note in folder "${folderPath}".`
          : 'Create a markdown note in vault root.';
      }
    },
    resolveValue: (input) => ({
      fileName: normalizeNewFileName(input.value),
      fileType: 'markdown',
    }),
  });
}

export async function promptForFolderName() {
  return createNamePrompt({
    modalId: 'folder-name-modal',
    inputId: 'folder-name-input',
    cancelId: 'folder-cancel-btn',
    confirmId: 'folder-create-btn',
    html: CREATE_FOLDER_MODAL_HTML,
    beforeShow: (modal) => modal.classList.add('modal-show'),
    resolveValue: (input) => input.value.trim(),
  });
}

function createNamePrompt({
  modalId,
  inputId,
  cancelId,
  confirmId,
  html,
  beforeShow = () => {},
  resolveValue,
}) {
  return new Promise((resolve) => {
    runtime.documentRef.getElementById(modalId)?.remove();
    runtime.documentRef.body.insertAdjacentHTML('beforeend', html);

    const modal = runtime.documentRef.getElementById(modalId);
    const input = runtime.documentRef.getElementById(inputId);
    const cancelBtn = runtime.documentRef.getElementById(cancelId);
    const confirmBtn = runtime.documentRef.getElementById(confirmId);

    if (!modal || !input || !cancelBtn || !confirmBtn) {
      resolve(null);
      return;
    }

    beforeShow(modal);
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '10000001';

    runtime.windowRef.setTimeout(() => {
      input.focus();
      input.select();
    }, 100);

    confirmBtn.onclick = () => {
      const value = resolveValue(input);
      modal.remove();
      resolve(value);
    };

    cancelBtn.onclick = () => {
      modal.remove();
      resolve(null);
    };

    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmBtn.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelBtn.click();
      }
    };

    modal.onclick = (event) => {
      if (event.target === modal) {
        cancelBtn.click();
      }
    };
  });
}

export function setupFileModalEventHandlers() {
  setupRenameModalHandlers();
  setupMoveModalHandlers();
  setupContextMenuOpenHandlers();
  setupMenuActionHandlers('file-context-menu', {
    delete: deleteFile,
    move: moveFile,
    rename: renameFile,
  });
  setupMenuActionHandlers('folder-context-menu', {
    delete: deleteFolder,
    move: moveFolder,
    rename: renameFile,
  });
}

function setupRenameModalHandlers() {
  const renameInput = runtime.documentRef.getElementById('rename-input');
  if (!renameInput || renameInput.__fileModalsKeyHandlerSetup) {
    return;
  }

  renameInput.__fileModalsKeyHandlerSetup = true;
  renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeRenameModal();
    }
  });
}

function setupMoveModalHandlers() {
  const moveFilter = runtime.documentRef.getElementById('move-filter');
  if (!moveFilter || moveFilter.__fileModalsKeyHandlerSetup) {
    return;
  }

  moveFilter.__fileModalsKeyHandlerSetup = true;
  moveFilter.addEventListener('input', (event) => {
    displayFolders(event.target.value);
  });

  moveFilter.addEventListener('keydown', (event) => {
    const filtered = filterAvailableFolders(moveFilter.value);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedFolderIndex = Math.min(selectedFolderIndex + 1, filtered.length - 1);
      displayFolders(moveFilter.value);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedFolderIndex = Math.max(selectedFolderIndex - 1, 0);
      displayFolders(moveFilter.value);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        const newFolderName = moveFilter.value.trim();
        if (newFolderName) {
          createAndMoveToFolder(newFolderName);
        }
      } else if (filtered[selectedFolderIndex]) {
        confirmMove(filtered[selectedFolderIndex].path);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMoveModal();
    }
  });
}

function setupContextMenuOpenHandlers() {
  if (runtime.documentRef.__fileModalsContextOpenSetup) {
    return;
  }

  runtime.documentRef.__fileModalsContextOpenSetup = true;
  runtime.documentRef.addEventListener(
    'contextmenu',
    (event) => {
      const fileItem = event.target.closest('.tree-item.file');
      if (fileItem) {
        event.preventDefault();
        const filePath = fileItem.getAttribute('data-path');
        if (filePath) {
          showFileContextMenu(event, filePath);
        }
        return false;
      }

      const folderItem = event.target.closest('.tree-item.folder');
      if (folderItem) {
        event.preventDefault();
        const folderPath = folderItem.getAttribute('data-path');
        if (folderPath) {
          showFolderContextMenu(event, folderPath);
        }
        return false;
      }

      return undefined;
    },
    true,
  );
}

function setupMenuActionHandlers(menuId, localActions) {
  const menu = runtime.documentRef.getElementById(menuId);
  if (!menu || menu.__fileModalsActionHandlerSetup) {
    return;
  }

  menu.__fileModalsActionHandlerSetup = true;
  menu.addEventListener('click', (event) => {
    event.stopPropagation();

    const menuItem = event.target.closest('.context-menu-item');
    if (!menuItem || menuItem.dataset.handled) {
      return;
    }

    menuItem.dataset.handled = 'true';
    const action = menuItem.getAttribute('data-action');
    runtime.log.debug?.('Context menu action:', action);

    const handler =
      localActions[action] ||
      {
        'copy-relative-path': () => copyPathToClipboard('relative'),
        'copy-path': () => copyPathToClipboard('full'),
        reveal: revealInFinder,
        inspect: toggleDevtools,
      }[action];

    handler?.();

    runtime.windowRef.setTimeout(() => {
      delete menuItem.dataset.handled;
    }, 100);
  });
}

export function showFileContextMenu(event, filePath) {
  showContextMenu('file-context-menu', event, filePath);
}

export function showFolderContextMenu(event, folderPath) {
  showContextMenu('folder-context-menu', event, folderPath);
}

function showContextMenu(menuId, event, targetPath) {
  const menu = runtime.documentRef.getElementById(menuId);
  if (!menu) {
    return;
  }

  hideContextMenu();
  contextMenuTarget = targetPath;
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.classList.remove('hidden');

  if (!menu.__fileModalsStopPropagationSetup) {
    const stopPropagation = (innerEvent) => innerEvent.stopPropagation();
    menu.addEventListener('mousedown', stopPropagation);
    menu.addEventListener('mouseup', stopPropagation);
    menu.addEventListener('click', stopPropagation);
    menu.__fileModalsStopPropagationSetup = true;
  }

  runtime.windowRef.requestAnimationFrame(() => {
    const hideOnClick = (innerEvent) => {
      if (!menu.contains(innerEvent.target)) {
        hideContextMenu();
        runtime.documentRef.removeEventListener('mousedown', hideOnClick, true);
      }
    };
    runtime.documentRef.addEventListener('mousedown', hideOnClick, true);
  });
}

export function hideContextMenu() {
  runtime.documentRef.getElementById('file-context-menu')?.classList.add('hidden');
  runtime.documentRef.getElementById('folder-context-menu')?.classList.add('hidden');
}

export async function deleteFile() {
  if (!contextMenuTarget) {
    return;
  }

  const targetPath = contextMenuTarget;
  const fileName = targetPath.split('/').pop();
  const confirmed = await runtime.ask(`Are you sure you want to delete "${fileName}"?`, {
    title: 'Delete File',
    type: 'warning',
  });

  if (confirmed) {
    try {
      await runtime.invoke('delete_file', { filePath: targetPath });
      await closeOpenTabsForPath(targetPath);
      await refreshTreeFromBackend();
    } catch (error) {
      console.error('Error deleting file:', error);
      runtime.windowRef.alert('Error deleting file: ' + runtime.asCommandError(error).message);
    }
  }

  hideContextMenu();
  contextMenuTarget = null;
}

export async function deleteFolder() {
  if (!contextMenuTarget) {
    return;
  }

  const targetPath = contextMenuTarget;
  const folderName = targetPath.split('/').pop() || targetPath;
  const confirmed = await runtime.ask(`Delete folder "${folderName}" and all contents?`, {
    title: 'Delete Folder',
    type: 'warning',
  });

  if (confirmed) {
    try {
      await runtime.invoke('delete_folder', { folderPath: targetPath });
      await refreshTreeFromBackend();
    } catch (error) {
      console.error('Error deleting folder:', error);
      runtime.windowRef.alert('Error deleting folder: ' + runtime.asCommandError(error).message);
    }
  }

  hideContextMenu();
  contextMenuTarget = null;
}

export function moveFolder() {
  if (!contextMenuTarget) {
    return;
  }

  const folderName = contextMenuTarget.split('/').pop() || contextMenuTarget;
  moveContext = {
    targetPath: contextMenuTarget,
    fileName: folderName,
    isFolder: true,
  };
  showMoveModal();
}

export function moveFile() {
  if (!contextMenuTarget) {
    return;
  }

  moveContext = {
    targetPath: contextMenuTarget,
    fileName: contextMenuTarget.split('/').pop(),
  };
  showMoveModal();
}

function showMoveModal() {
  hideContextMenu();
  contextMenuTarget = null;

  const modal = runtime.documentRef.getElementById('move-modal');
  const filter = runtime.documentRef.getElementById('move-filter');
  if (!modal || !filter) {
    return;
  }

  loadFoldersForMove();
  modal.classList.remove('hidden');
  runtime.windowRef.setTimeout(() => {
    filter.focus();
  }, 50);
}

async function loadFoldersForMove() {
  try {
    const fileTree = await runtime.invoke('get_file_tree');
    availableFolders = [
      {
        path: '/',
        name: '/',
        display: '/',
      },
    ];

    const folderSet = new Set();
    fileTree.files.forEach((file) => {
      if (file.is_dir) {
        folderSet.add(file.path);
      }
      if (file.parent_path) {
        folderSet.add(file.parent_path);
      }
    });

    Array.from(folderSet)
      .sort()
      .forEach((folder) => {
        availableFolders.push({
          path: folder,
          name: folder.split('/').pop() || folder,
          display: folder,
        });
      });

    displayFolders('');
  } catch (error) {
    console.error('Error loading folders:', error);
  }
}

function filterAvailableFolders(filterText = '') {
  const query = filterText.toLowerCase();
  let filtered = query
    ? availableFolders.filter((folder) => folder.display.toLowerCase().includes(query))
    : availableFolders;

  if (moveContext?.isFolder && moveContext.targetPath) {
    const base = moveContext.targetPath.replace(/\/$/, '');
    filtered = filtered.filter((folder) => {
      const path = folder.path.replace(/\/$/, '');
      return path !== base && !path.startsWith(`${base}/`);
    });
  }

  return filtered;
}

export function displayFolders(filterText) {
  const listElement = runtime.documentRef.getElementById('move-folder-list');
  if (!listElement) {
    return;
  }

  const filtered = filterAvailableFolders(filterText);
  if (selectedFolderIndex >= filtered.length) {
    selectedFolderIndex = 0;
  }

  listElement.replaceChildren();
  filtered.forEach((folder, index) => {
    const item = runtime.documentRef.createElement('div');
    item.className = `move-folder-item${index === selectedFolderIndex ? ' selected' : ''}`;
    item.dataset.path = folder.path;
    item.dataset.index = String(index);

    const label = runtime.documentRef.createElement('span');
    label.textContent = folder.display;
    item.appendChild(label);
    item.addEventListener('click', () => {
      confirmMove(folder.path);
    });

    listElement.appendChild(item);
  });
}

export function closeMoveModal() {
  runtime.documentRef.getElementById('move-modal')?.classList.add('hidden');
  moveContext = null;
  selectedFolderIndex = 0;
}

export async function confirmMove(destinationPath) {
  if (!moveContext) {
    return;
  }

  const newPath =
    destinationPath === '/' ? moveContext.fileName : `${destinationPath}/${moveContext.fileName}`;

  try {
    await runtime.invoke('move_file', {
      oldPath: moveContext.targetPath,
      newPath,
    });
    await refreshTreeFromBackend();
  } catch (error) {
    console.error('Error moving file:', error);
    runtime.windowRef.alert('Error moving file: ' + runtime.asCommandError(error).message);
  }

  closeMoveModal();
}

export async function createAndMoveToFolder(folderName) {
  if (!moveContext) {
    return;
  }

  try {
    await runtime.invoke('create_new_folder', { folderName });
    await confirmMove(folderName);
  } catch (error) {
    console.error('Error creating folder:', error);
    runtime.windowRef.alert('Error creating folder: ' + runtime.asCommandError(error).message);
  }
}

export function renameFile() {
  runtime.log.debug?.('renameFile called, contextMenuTarget:', contextMenuTarget);
  if (!contextMenuTarget) {
    console.error('No contextMenuTarget set');
    return;
  }

  const pathParts = contextMenuTarget.split('/');
  const fileName = pathParts.pop();
  renameContext = {
    targetPath: contextMenuTarget,
    fileName,
    directory: pathParts.join('/'),
  };

  hideContextMenu();
  contextMenuTarget = null;

  const modal = runtime.documentRef.getElementById('rename-modal');
  const input = runtime.documentRef.getElementById('rename-input');
  if (!modal || !input) {
    return;
  }

  input.value = fileName;
  modal.classList.remove('hidden');
  runtime.windowRef.setTimeout(() => {
    input.focus();
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot > 0) {
      input.setSelectionRange(0, lastDot);
    } else {
      input.select();
    }
  }, 50);
}

export function closeRenameModal() {
  runtime.documentRef.getElementById('rename-modal')?.classList.add('hidden');
  renameContext = null;
}

export async function confirmRename() {
  if (!renameContext) {
    return;
  }

  const input = runtime.documentRef.getElementById('rename-input');
  const newName = input?.value.trim();

  if (newName && newName !== renameContext.fileName) {
    const newPath = renameContext.directory ? `${renameContext.directory}/${newName}` : newName;
    try {
      await runtime.invoke('rename_file', {
        oldPath: renameContext.targetPath,
        newPath,
      });
      await refreshTreeFromBackend();
    } catch (error) {
      console.error('Error renaming file:', error);
      runtime.windowRef.alert('Error renaming file: ' + runtime.asCommandError(error).message);
    }
  }

  closeRenameModal();
}

export async function openTaskDashboard() {
  runtime.log.debug?.('Opening Task Dashboard');

  try {
    if (!taskDashboard) {
      taskDashboard = new runtime.TaskDashboardClass();
    }
    await taskDashboard.open();
  } catch (error) {
    console.error('Failed to open Task Dashboard:', error);
  }
}

export async function revealInFinder() {
  if (!contextMenuTarget) {
    return;
  }

  const targetPath = contextMenuTarget;
  try {
    await runtime.invoke('reveal_in_finder', { path: targetPath });
    runtime.log.debug?.('File revealed in Finder:', targetPath);
  } catch (error) {
    console.error('Failed to reveal file in Finder:', error);
  }

  hideContextMenu();
  contextMenuTarget = null;
}

export async function copyPathToClipboard(mode = 'relative') {
  if (!contextMenuTarget) {
    return;
  }

  const targetPath = getClipboardPath(contextMenuTarget, runtime.getCurrentVaultPath(), mode);
  const label = mode === 'full' ? 'Path' : 'Relative path';

  try {
    await runtime.navigatorRef.clipboard.writeText(targetPath);
    runtime.log.debug?.('Path copied to clipboard:', targetPath);
    runtime.showNotification(`${label} copied to clipboard`, 'success');
  } catch (error) {
    console.error('Failed to copy path to clipboard:', error);
    runtime.showNotification(`Failed to copy ${label.toLowerCase()}`, 'error');
  }

  hideContextMenu();
  contextMenuTarget = null;
}

async function toggleDevtools() {
  try {
    await runtime.invoke('toggle_devtools');
  } catch (error) {
    console.error(error);
  }
}

async function closeOpenTabsForPath(targetPath) {
  const paneManager = runtime.getPaneManager();
  const panes = paneManager?.panes?.values ? [...paneManager.panes.values()] : [];
  if (panes.length > 0) {
    for (const pane of panes) {
      await closeMatchingTab(pane.tabManager, targetPath);
    }
    return;
  }

  await closeMatchingTab(runtime.getActiveTabManager(), targetPath);
}

async function closeMatchingTab(tabManager, targetPath) {
  if (!tabManager?.findTabByPath || !tabManager?.closeTab) {
    return;
  }

  const tab = tabManager.findTabByPath(targetPath);
  if (tab) {
    await tabManager.closeTab(tab.id, true);
  }
}

async function refreshTreeFromBackend() {
  try {
    const fileTree = await runtime.invoke('get_file_tree');
    runtime.displayFileTree(fileTree);
  } catch (error) {
    console.error('Error refreshing file tree:', error);
  }
}
