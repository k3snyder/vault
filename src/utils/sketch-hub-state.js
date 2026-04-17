export function getSketchDisplayName(fileName) {
  return (fileName || '').replace(/\.excalidraw$/i, '');
}

export function normalizeSketchFileName(name) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    return '';
  }

  return trimmedName.toLowerCase().endsWith('.excalidraw')
    ? trimmedName
    : `${trimmedName}.excalidraw`;
}

export function buildSketchHubItems(files, searchQuery = '') {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return files
    .filter((file) => !file.is_dir && file.name.toLowerCase().endsWith('.excalidraw'))
    .map((file) => ({
      path: file.path,
      fileName: file.name,
      displayName: getSketchDisplayName(file.name),
      modified: file.modified ?? null,
      created: file.created ?? null,
      parentPath: file.parent_path || ''
    }))
    .filter((file) => {
      if (!normalizedQuery) {
        return true;
      }

      return file.displayName.toLowerCase().includes(normalizedQuery)
        || file.path.toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => {
      const modifiedDiff = (b.modified || 0) - (a.modified || 0);
      if (modifiedDiff !== 0) {
        return modifiedDiff;
      }

      const createdDiff = (b.created || 0) - (a.created || 0);
      if (createdDiff !== 0) {
        return createdDiff;
      }

      return a.displayName.localeCompare(b.displayName);
    });
}
