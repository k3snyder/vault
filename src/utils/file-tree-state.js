export function areAncestorFoldersExpanded(parentPath, expandedFolders) {
  if (!parentPath) {
    return true
  }

  const parts = parentPath.split('/').filter(Boolean)
  let currentPath = ''

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part
    if (!expandedFolders.has(currentPath)) {
      return false
    }
  }

  return true
}

export function expandFolderState(expandedFolders, folderPath) {
  const nextExpandedFolders = new Set(expandedFolders)

  if (!folderPath) {
    return nextExpandedFolders
  }

  const parts = folderPath.split('/').filter(Boolean)
  let currentPath = ''

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part
    nextExpandedFolders.add(currentPath)
  }

  return nextExpandedFolders
}

export function collapseFolderState(expandedFolders, folderPath) {
  const nextExpandedFolders = new Set(expandedFolders)
  const descendantPrefix = `${folderPath}/`

  nextExpandedFolders.delete(folderPath)

  for (const expandedPath of expandedFolders) {
    if (expandedPath.startsWith(descendantPrefix)) {
      nextExpandedFolders.delete(expandedPath)
    }
  }

  return nextExpandedFolders
}

export function findFolderPathByName(files, folderName) {
  if (!folderName) {
    return null
  }

  const normalizedFolderName = folderName.trim().toLowerCase()
  const matches = files
    .filter((file) => file.is_dir && file.name.toLowerCase() === normalizedFolderName)
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))

  return matches[0]?.path ?? null
}

export function findSketchNavigationTarget(files) {
  const sketchesFolderPath = findFolderPathByName(files, 'Sketches')
  if (sketchesFolderPath) {
    return { type: 'folder', path: sketchesFolderPath }
  }

  const sketchFiles = files
    .filter((file) => !file.is_dir && file.name.toLowerCase().endsWith('.excalidraw'))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))

  const nestedSketchFile = sketchFiles.find((file) => Boolean(file.parent_path))
  if (nestedSketchFile) {
    return { type: 'folder', path: nestedSketchFile.parent_path }
  }

  const rootSketchFile = sketchFiles[0]
  if (rootSketchFile) {
    return { type: 'file', path: rootSketchFile.path }
  }

  return null
}
