const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif']);

function getFileExtension(filePath = '') {
  const lastSegment = String(filePath).split('/').pop() || '';
  const parts = lastSegment.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function getFileOpenKind(filePath = '') {
  const extension = getFileExtension(filePath);

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (extension === 'pdf') {
    return 'pdf';
  }

  if (extension === 'csv') {
    return 'csv';
  }

  if (extension === 'excalidraw') {
    return 'sketch';
  }

  if (extension === 'boxnote') {
    return 'boxnote';
  }

  if (extension === 'html' || extension === 'htm') {
    return 'html';
  }

  return 'markdown';
}

export function shouldReuseExistingFileTab({ openKind, existingTabType, csvEnabled = true }) {
  if (!existingTabType) {
    return false;
  }

  if (openKind === 'pdf') {
    return existingTabType === 'pdf';
  }

  if (openKind === 'csv') {
    return csvEnabled ? existingTabType === 'csv' : existingTabType === 'markdown';
  }

  if (openKind === 'sketch') {
    return existingTabType === 'sketch';
  }

  if (openKind === 'boxnote') {
    return existingTabType === 'boxnote';
  }

  if (openKind === 'html') {
    return existingTabType === 'html';
  }

  return true;
}
