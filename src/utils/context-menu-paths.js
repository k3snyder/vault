export function isAbsolutePath(path) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path || '')
}

export function getClipboardPath(targetPath, vaultPath, mode = 'relative') {
  if (!targetPath) {
    return targetPath
  }

  if (mode !== 'full' || isAbsolutePath(targetPath) || !vaultPath) {
    return targetPath
  }

  const normalizedVaultPath = vaultPath.replace(/[\\/]+$/, '')
  const separator = normalizedVaultPath.includes('\\') && !normalizedVaultPath.includes('/') ? '\\' : '/'
  const normalizedTargetPath = targetPath
    .replace(/^[/\\]+/, '')
    .replace(/[\\/]/g, separator)

  return normalizedTargetPath
    ? `${normalizedVaultPath}${separator}${normalizedTargetPath}`
    : normalizedVaultPath
}
