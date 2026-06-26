import { areAncestorFoldersExpanded } from '../utils/file-tree-state.js';
import { escapeHtml } from '../utils/escape-html.js';

export const FILE_TREE_VIRTUAL_THRESHOLD = 500;
export const FILE_TREE_ROW_HEIGHT = 32;
export const FILE_TREE_BUFFER_ROWS = 20;

export function computeVisibleRows(
  files = [],
  { expandedFolders = new Set(), sortOption = 'alphabetical' } = {},
) {
  return sortFileTree(files, sortOption)
    .filter((file) => !isHiddenFileTreeEntry(file))
    .filter(
      (file) => !file.parent_path || areAncestorFoldersExpanded(file.parent_path, expandedFolders),
    );
}

export function sortFileTree(files = [], sortOption = 'alphabetical') {
  const tree = new Map();

  files.forEach((file) => {
    const parent = file.parent_path || '';
    if (!tree.has(parent)) {
      tree.set(parent, []);
    }
    tree.get(parent).push(file);
  });

  tree.forEach((children) => {
    children.sort((a, b) => compareFileTreeEntries(a, b, sortOption));
  });

  const result = [];
  const addToResult = (parentPath) => {
    const children = tree.get(parentPath) || [];
    children.forEach((child) => {
      result.push(child);
      if (child.is_dir) {
        addToResult(child.path);
      }
    });
  };

  addToResult('');
  return result;
}

export function compareFileTreeEntries(a, b, sortOption = 'alphabetical') {
  if (a.is_dir !== b.is_dir) {
    return a.is_dir ? -1 : 1;
  }

  switch (sortOption) {
    case 'created':
      return compareNullableTimestampDesc(a.created, b.created) || compareNames(a, b);

    case 'modified':
      return compareNullableTimestampDesc(a.modified, b.modified) || compareNames(a, b);

    case 'alphabetical':
    default:
      return compareNames(a, b);
  }
}

export function isHiddenFileTreeEntry(file) {
  return (
    file.name === '.obsidian' ||
    file.path === '.obsidian' ||
    file.path?.startsWith('.obsidian/') ||
    file.path?.includes('/.obsidian/')
  );
}

export function createFileTreeVirtualWindow(
  rows,
  {
    scrollTop = 0,
    containerHeight = 0,
    rowHeight = FILE_TREE_ROW_HEIGHT,
    bufferRows = FILE_TREE_BUFFER_ROWS,
    threshold = FILE_TREE_VIRTUAL_THRESHOLD,
  } = {},
) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length <= threshold) {
    return {
      enabled: false,
      rows: safeRows,
      visibleRows: safeRows,
      startIndex: 0,
      endIndex: safeRows.length,
      offsetY: 0,
      totalHeight: safeRows.length * rowHeight,
      rowHeight,
    };
  }

  const visibleCount = Math.max(1, Math.ceil(containerHeight / rowHeight));
  const firstVisibleIndex = Math.max(0, Math.floor(scrollTop / rowHeight));
  const startIndex = Math.max(0, firstVisibleIndex - bufferRows);
  const endIndex = Math.min(safeRows.length, firstVisibleIndex + visibleCount + bufferRows);

  return {
    enabled: true,
    rows: safeRows,
    visibleRows: safeRows.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    offsetY: startIndex * rowHeight,
    totalHeight: safeRows.length * rowHeight,
    rowHeight,
  };
}

export function renderFileTreeHtml(
  rows,
  { expandedFolders = new Set(), icons, virtualWindow = null } = {},
) {
  const windowState = virtualWindow?.enabled
    ? virtualWindow
    : createFileTreeVirtualWindow(rows, { threshold: Number.POSITIVE_INFINITY });
  const rowsToRender = windowState.visibleRows || rows;
  const contentClass = windowState.enabled
    ? 'file-tree-content file-tree-content-virtualized'
    : 'file-tree-content';
  const virtualStyle = windowState.enabled ? ` style="height: ${windowState.totalHeight}px;"` : '';

  let html = `
    <div class="${contentClass}" data-path=""${virtualStyle}>
  `;

  if (windowState.enabled) {
    html += `<div class="file-tree-virtual-window" style="transform: translateY(${windowState.offsetY}px);">`;
  }

  rowsToRender.forEach((file, visibleIndex) => {
    const rowIndex = windowState.enabled ? windowState.startIndex + visibleIndex : visibleIndex;
    const indent = file.depth * 20;
    const isExpanded = expandedFolders.has(file.path);
    const escapedPath = escapeHtml(file.path);
    const escapedName = escapeHtml(file.name);

    if (file.is_dir) {
      const expandIcon = isExpanded ? '▼' : '▶';
      const folderIcon = isExpanded ? icons.folderOpen({ size: 16 }) : icons.folder({ size: 16 });

      html += `
        <div class="tree-item folder" data-action="toggle-folder" data-path="${escapedPath}" data-row-index="${rowIndex}" style="padding-left: ${indent + 8}px;" title="${escapedName}" draggable="true">
          <span class="expand-icon">${expandIcon}</span>
          <span class="tree-icon folder-icon">${folderIcon}</span>
          <span class="tree-label">${escapedName}</span>
          <span class="folder-actions">
            <button class="folder-action-btn" data-action="show-create-file-modal" data-folder-path="${escapedPath}" title="New File in Folder">${icons.filePlus({ size: 14 })}</button>
          </span>
        </div>
      `;
      return;
    }

    const fileIndent = indent + 24;
    const fileIcon = renderFileIcon(file.name, icons);
    const displayName = file.name.replace(
      /\.(md|markdown|txt|doc|docx|pdf|csv|json|html|htm|excalidraw|boxnote)$/i,
      '',
    );
    const escapedDisplayName = escapeHtml(displayName);

    html += `
        <div class="tree-item file" data-action="open-file" data-path="${escapedPath}" data-row-index="${rowIndex}" style="padding-left: ${fileIndent}px;" data-file-path="${escapedPath}" draggable="true" title="${escapedName}">
          ${fileIcon}
          <span class="tree-label">${escapedDisplayName}</span>
        </div>
      `;
  });

  if (windowState.enabled) {
    html += '</div>';
  }

  html += '</div>';
  return html;
}

export function renderFileIcon(fileName, icons) {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    return '<span class="file-type-badge pdf">PDF</span>';
  }
  if (ext === 'csv') {
    return '<span class="file-type-badge csv">CSV</span>';
  }
  if (ext === 'json') {
    return '<span class="file-type-badge json">JSON</span>';
  }
  if (ext === 'html' || ext === 'htm') {
    return '<span class="file-type-badge html">HTML</span>';
  }
  if (ext === 'boxnote') {
    return '<span class="file-type-badge boxnote">BOX</span>';
  }
  if (ext === 'excalidraw') {
    return '<span class="file-type-badge sketch">Sketch</span>';
  }
  if (ext === 'md' || ext === 'markdown') {
    return `<span class="tree-icon file-icon">${icons.fileText({ size: 16 })}</span>`;
  }
  return `<span class="tree-icon file-icon">${icons.file({ size: 16 })}</span>`;
}

function compareNullableTimestampDesc(a, b) {
  if (a !== null && a !== undefined && b !== null && b !== undefined) {
    return b - a;
  }
  if (a !== null && a !== undefined) {
    return -1;
  }
  if (b !== null && b !== undefined) {
    return 1;
  }
  return 0;
}

function compareNames(a, b) {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}
