import {
  handleFileDragStart,
  handleFileDrag,
  handleFileDragEnd,
  handleFolderDragEnter,
  handleFolderDragOver,
  handleFolderDragLeave,
  handleFolderDrop,
} from './file-tree-view.js';

const runtime = {
  appContext: null,
  documentRef: null,
  windowRef: null,
  navigatorRef: null,
  log: console,
  performMoveToFolder: async () => {},
};

export function initDragDrop(
  appContext,
  {
    documentRef = document,
    windowRef = window,
    navigatorRef = navigator,
    log = console,
    performMoveToFolder = async () => {},
  } = {},
) {
  Object.assign(runtime, {
    appContext,
    documentRef,
    windowRef,
    navigatorRef,
    log,
    performMoveToFolder,
  });

  windowRef.__dndDebug = true;
  appContext.debug.dndDebug = windowRef.__dndDebug;

  windowRef.enableDnDDebug = () => {
    windowRef.__dndDebug = true;
    appContext.debug.dndDebug = true;
    log.debug('[DnD] debug enabled');
  };
  windowRef.disableDnDDebug = () => {
    windowRef.__dndDebug = false;
    appContext.debug.dndDebug = false;
    log.debug('[DnD] debug disabled');
  };
  windowRef.enableSyntheticDrag = enableSyntheticDrag;
  windowRef.disableSyntheticDrag = disableSyntheticDrag;

  autoEnableSyntheticDrag();

  return {
    dndLog,
    setupFileTreeDragDelegation,
    setupFileTreeDnDDelegates,
    setupGlobalDnDFallbacks,
    initSyntheticDragHandlers,
  };
}

export function dndLog(...args) {
  if (runtime.appContext?.debug?.dndDebug) {
    runtime.log.debug('[DnD]', ...args);
  }
}

export function enableSyntheticDrag() {
  runtime.windowRef.__useSyntheticDrag = true;
  runtime.log.debug('[DnD] Synthetic drag mode ENABLED - using press-hold-drop fallback');
  initSyntheticDragHandlers();
}

export function disableSyntheticDrag() {
  runtime.windowRef.__useSyntheticDrag = false;
  runtime.log.debug('[DnD] Synthetic drag mode DISABLED');
}

export function initSyntheticDragHandlers() {
  if (runtime.windowRef.__syntheticDragInitialized) return;
  runtime.windowRef.__syntheticDragInitialized = true;

  let draggedElement = null;
  let dragGhost = null;
  let dropTarget = null;

  const createDragGhost = (element) => {
    const ghost = element.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '0.5';
    ghost.style.zIndex = '99999';
    ghost.style.transition = 'none';
    ghost.classList.add('synthetic-dragging');
    runtime.documentRef.body.appendChild(ghost);
    return ghost;
  };

  const updateGhostPosition = (x, y) => {
    if (dragGhost) {
      dragGhost.style.left = `${x + 10}px`;
      dragGhost.style.top = `${y - 10}px`;
    }
  };

  const findDropTarget = (x, y) => {
    if (dragGhost) dragGhost.style.display = 'none';
    const elements = runtime.documentRef.elementsFromPoint(x, y);
    if (dragGhost) dragGhost.style.display = '';

    for (const element of elements) {
      const folder = element.closest?.('.tree-item.folder');
      if (folder && folder !== draggedElement) {
        return folder;
      }
    }
    for (const element of elements) {
      const fileRow = element.closest?.('.tree-item.file');
      if (!fileRow) continue;
      const path = fileRow.getAttribute('data-path') || '';
      if (!path.includes('/')) {
        return fileRow.closest('.file-tree-content');
      }
      return null;
    }
    for (const element of elements) {
      const tree = element.classList?.contains('file-tree-content')
        ? element
        : element.closest?.('.file-tree-content');
      if (tree) return tree;
    }
    return null;
  };

  runtime.documentRef.addEventListener(
    'mousedown',
    (event) => {
      if (!runtime.windowRef.__useSyntheticDrag) return;
      const file = event.target.closest('.tree-item.file[draggable="true"]');
      if (!file) return;

      event.preventDefault();
      draggedElement = file;
      const path = file.getAttribute('data-path');
      runtime.windowRef.__dragSourcePath = path;

      dragGhost = createDragGhost(file);
      updateGhostPosition(event.clientX, event.clientY);
      file.classList.add('dragging');
      dndLog('synthetic drag start', { path });
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'dragstart',
    (event) => {
      if (runtime.windowRef.__useSyntheticDrag) {
        event.preventDefault();
        dndLog('suppressed native dragstart (synthetic mode)');
      }
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'mousemove',
    (event) => {
      if (!draggedElement || !runtime.windowRef.__useSyntheticDrag) return;
      updateGhostPosition(event.clientX, event.clientY);

      const newTarget = findDropTarget(event.clientX, event.clientY);
      if (newTarget === dropTarget) return;
      if (isFolderTreeItem(dropTarget)) {
        dropTarget.classList.remove('drag-over');
      }
      if (isFolderTreeItem(newTarget)) {
        newTarget.classList.add('drag-over');
      }
      dropTarget = newTarget;
      dndLog('synthetic drag over', { target: dropTarget?.getAttribute('data-path') });
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'mouseup',
    async () => {
      if (!draggedElement || !runtime.windowRef.__useSyntheticDrag) return;

      const sourcePath = runtime.windowRef.__dragSourcePath;
      const destinationPath = dropTarget?.getAttribute('data-path') ?? '';
      dragGhost?.remove();
      dragGhost = null;
      draggedElement.classList.remove('dragging');
      if (isFolderTreeItem(dropTarget)) {
        dropTarget.classList.remove('drag-over');
      }

      if (sourcePath && dropTarget) {
        dndLog('synthetic drop', { sourcePath, destinationPath });
        await runtime.performMoveToFolder(sourcePath, destinationPath);
      } else {
        dndLog('synthetic drag cancelled');
      }

      draggedElement = null;
      dropTarget = null;
      runtime.windowRef.__dragSourcePath = null;
    },
    true,
  );

  runtime.log.debug('[DnD] Synthetic drag handlers initialized');
}

export function setupFileTreeDnDDelegates() {
  const tree = runtime.documentRef.getElementById('file-tree');
  if (!tree || tree.__dndDelegatesSetup) return;
  tree.__dndDelegatesSetup = true;
  dndLog('delegates: attaching on #file-tree');

  tree.addEventListener(
    'dragenter',
    (event) => {
      const folder = event.target.closest?.('.tree-item.folder');
      if (!folder) return;
      event.preventDefault();
      event.stopPropagation();
      folder.classList.add('drag-over');
      dndLog('tree dragenter', { dest: folder.getAttribute('data-path') });
    },
    true,
  );

  tree.addEventListener(
    'dragover',
    (event) => {
      const folder = event.target.closest?.('.tree-item.folder');
      if (!folder) return;
      event.preventDefault();
      event.stopPropagation();
      setDropEffect(event);
      if (!folder.classList.contains('drag-over')) folder.classList.add('drag-over');
      dndLog('tree dragover', { dest: folder.getAttribute('data-path') });
    },
    true,
  );

  tree.addEventListener(
    'dragleave',
    (event) => {
      const folder = event.target.closest?.('.tree-item.folder');
      if (!folder) return;
      event.stopPropagation();
      folder.classList.remove('drag-over');
      dndLog('tree dragleave', { dest: folder.getAttribute('data-path') });
    },
    true,
  );

  tree.addEventListener(
    'drop',
    async (event) => {
      const folder = event.target.closest?.('.tree-item.folder');
      if (!folder) return;
      event.preventDefault();
      event.stopPropagation();
      folder.classList.remove('drag-over');
      const destinationPath = folder.getAttribute('data-path') || '';
      const sourcePath =
        event.dataTransfer?.getData('text/plain') || runtime.windowRef.__dragSourcePath || '';
      dndLog('tree drop', { destinationPath, sourcePath });
      if (!sourcePath) return;
      runtime.windowRef.__dndDropProcessed = true;
      await runtime.performMoveToFolder(sourcePath, destinationPath);
    },
    true,
  );
}

export function setupFileTreeDragDelegation() {
  const fileTreeElement = runtime.documentRef.getElementById('file-tree');
  if (!fileTreeElement || fileTreeElement.dataset.dragHandlersBound === 'true') {
    return;
  }

  fileTreeElement.dataset.dragHandlersBound = 'true';

  const dragEvents = {
    dragstart: handleFileDragStart,
    drag: handleFileDrag,
    dragend: handleFileDragEnd,
    dragenter: handleFolderDragEnter,
    dragover: handleFolderDragOver,
    dragleave: handleFolderDragLeave,
    drop: handleFolderDrop,
  };

  Object.entries(dragEvents).forEach(([eventName, handler]) => {
    fileTreeElement.addEventListener(eventName, (event) => {
      const target = event.target.closest('.tree-item.file, .tree-item.folder');
      if (!target || !fileTreeElement.contains(target)) {
        return;
      }

      handler(event);
    });
  });
}

export function setupGlobalDnDFallbacks() {
  setupGlobalDnDFallback();
  setupUnconditionalWindowCapture();
  setupDragMouseTracking();
}

function setupGlobalDnDFallback() {
  if (runtime.documentRef.__globalDnDSetup) return;
  runtime.documentRef.__globalDnDSetup = true;
  let lastHoverElement = null;

  runtime.documentRef.addEventListener(
    'dragover',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDropEffect(event);

      if (!runtime.windowRef.__dragSourcePath) return;
      const folder = findFolderAtPoint(event.clientX, event.clientY);
      if (folder !== lastHoverElement) {
        lastHoverElement?.classList.remove('drag-over');
        folder?.classList.add('drag-over');
        lastHoverElement = folder;
      }
      dndLog('doc dragover (fallback)', {
        dest: folder?.getAttribute('data-path'),
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'drop',
    async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const sourcePath =
        runtime.windowRef.__dragSourcePath ||
        event.dataTransfer?.getData('text/plain') ||
        event.dataTransfer?.getData('application/x-vault-file') ||
        '';
      if (!sourcePath) {
        dndLog('doc drop - no source path');
        return;
      }

      const folder = findFolderAtPoint(event.clientX, event.clientY);
      const destinationPath = folder?.getAttribute('data-path') || '';
      lastHoverElement?.classList.remove('drag-over');
      lastHoverElement = null;

      dndLog('doc drop (fallback)', {
        destinationPath,
        sourcePath,
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (!destinationPath) {
        dndLog('doc drop - no destination folder');
        return;
      }

      runtime.windowRef.__dndDropProcessed = true;
      await runtime.performMoveToFolder(sourcePath, destinationPath);
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'dragend',
    () => {
      lastHoverElement?.classList.remove('drag-over');
      lastHoverElement = null;
    },
    true,
  );
}

function setupUnconditionalWindowCapture() {
  if (runtime.windowRef.__unconditionalCaptureSetup) return;
  runtime.windowRef.__unconditionalCaptureSetup = true;

  runtime.windowRef.addEventListener(
    'dragover',
    (event) => {
      event.preventDefault();
      setDropEffect(event);
      dndLog('window dragover (unconditional)', {
        x: event.clientX,
        y: event.clientY,
        types: event.dataTransfer ? Array.from(event.dataTransfer.types) : [],
      });
    },
    true,
  );

  runtime.windowRef.addEventListener(
    'drop',
    (event) => {
      event.preventDefault();
      dndLog('window drop (unconditional)', {
        x: event.clientX,
        y: event.clientY,
        types: event.dataTransfer ? Array.from(event.dataTransfer.types) : [],
        hasSource: Boolean(runtime.windowRef.__dragSourcePath),
      });
    },
    true,
  );
}

function setupDragMouseTracking() {
  let isDragging = false;

  runtime.documentRef.addEventListener(
    'dragstart',
    () => {
      isDragging = true;
      dndLog('drag mouse tracking started');
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'dragend',
    () => {
      isDragging = false;
      dndLog('drag mouse tracking stopped');
    },
    true,
  );

  runtime.documentRef.addEventListener(
    'mousemove',
    (event) => {
      if (isDragging && event.clientX && event.clientY) {
        runtime.windowRef.__dragLastPt = { x: event.clientX, y: event.clientY };
      }
    },
    true,
  );
}

function findFolderAtPoint(x, y) {
  const elements = runtime.documentRef.elementsFromPoint(x, y) || [];
  for (const element of elements) {
    const folder = element.closest?.('.tree-item.folder');
    if (folder) return folder;
  }
  return null;
}

function autoEnableSyntheticDrag() {
  try {
    const isWebKit =
      Boolean(runtime.windowRef.webkit) ||
      /AppleWebKit/i.test(runtime.navigatorRef.userAgent || '');
    if (isWebKit) {
      runtime.log.debug('[DnD] WebKit detected - enabling synthetic drag mode');
      enableSyntheticDrag();
    }
  } catch (error) {
    runtime.log.swallow?.('suppressed error', error);
  }
}

function setDropEffect(event) {
  try {
    event.dataTransfer.dropEffect = 'move';
  } catch (error) {
    runtime.log.swallow?.('suppressed error', error);
  }
}

function isFolderTreeItem(element) {
  return element?.classList?.contains('tree-item') && element.classList.contains('folder');
}
