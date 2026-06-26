use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

pub const MAX_BOTCKY_RELATIVE_PATH_LEN: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BotckyPathError {
    EmptyPath,
    NullByte,
    TooLong,
    AbsolutePath,
    PathTraversal,
    CurrentFolderOutsideVault,
    TargetOutsideVault,
    TargetOutsideCurrentFolder,
    ParentMissing,
    SymlinkEscape,
    CanonicalizeFailed(String),
}

impl std::fmt::Display for BotckyPathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyPath => write!(f, "path cannot be empty"),
            Self::NullByte => write!(f, "path contains a null byte"),
            Self::TooLong => write!(f, "path exceeds maximum length"),
            Self::AbsolutePath => write!(f, "absolute target paths are not allowed"),
            Self::PathTraversal => write!(f, "path traversal is not allowed"),
            Self::CurrentFolderOutsideVault => write!(f, "current folder is outside vault root"),
            Self::TargetOutsideVault => write!(f, "target path is outside vault root"),
            Self::TargetOutsideCurrentFolder => write!(f, "target path is outside current folder"),
            Self::ParentMissing => write!(f, "target parent directory does not exist"),
            Self::SymlinkEscape => write!(
                f,
                "path resolves through a symlink outside the allowed folder"
            ),
            Self::CanonicalizeFailed(err) => write!(f, "failed to canonicalize path: {err}"),
        }
    }
}

impl std::error::Error for BotckyPathError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BotckyPathScope {
    pub vault_root: PathBuf,
    pub current_folder: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetMode {
    MustExist,
    ParentMustExist,
}

pub fn validate_relative_target(target_path: &str) -> Result<PathBuf, BotckyPathError> {
    let trimmed = target_path.trim();
    if trimmed.is_empty() {
        return Err(BotckyPathError::EmptyPath);
    }
    if trimmed.len() > MAX_BOTCKY_RELATIVE_PATH_LEN {
        return Err(BotckyPathError::TooLong);
    }
    if trimmed.contains('\0') {
        return Err(BotckyPathError::NullByte);
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || trimmed.starts_with('~')
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
    {
        return Err(BotckyPathError::AbsolutePath);
    }
    for component in path.components() {
        match component {
            Component::ParentDir => return Err(BotckyPathError::PathTraversal),
            Component::Normal(part) if part.to_string_lossy().contains('\0') => {
                return Err(BotckyPathError::NullByte)
            }
            _ => {}
        }
    }
    Ok(path.to_path_buf())
}

pub fn canonical_scope(
    vault_root: impl AsRef<Path>,
    current_folder: Option<&str>,
) -> Result<BotckyPathScope, BotckyPathError> {
    let vault_root = canonicalize(vault_root.as_ref())?;
    let current_folder_path = match current_folder
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(folder) => {
            if folder.contains('\0') {
                return Err(BotckyPathError::NullByte);
            }
            let folder_path = Path::new(folder);
            let joined = if folder_path.is_absolute() {
                folder_path.to_path_buf()
            } else {
                let relative = validate_relative_target(folder)?;
                vault_root.join(relative)
            };
            canonicalize(&joined)?
        }
        None => vault_root.clone(),
    };
    if !current_folder_path.starts_with(&vault_root) {
        return Err(BotckyPathError::CurrentFolderOutsideVault);
    }
    Ok(BotckyPathScope {
        vault_root,
        current_folder: current_folder_path,
    })
}

pub fn resolve_target(
    scope: &BotckyPathScope,
    target_path: &str,
    mode: TargetMode,
) -> Result<PathBuf, BotckyPathError> {
    let relative = validate_relative_target(target_path)?;
    let candidate = scope.current_folder.join(relative);
    let resolved = match mode {
        TargetMode::MustExist => canonicalize(&candidate)?,
        TargetMode::ParentMustExist => {
            let parent = candidate.parent().ok_or(BotckyPathError::ParentMissing)?;
            let canonical_parent = parent.canonicalize().map_err(|err| match err.kind() {
                std::io::ErrorKind::NotFound => BotckyPathError::ParentMissing,
                _ => BotckyPathError::CanonicalizeFailed(err.to_string()),
            })?;
            if !canonical_parent.starts_with(&scope.vault_root) {
                return Err(BotckyPathError::TargetOutsideVault);
            }
            if !canonical_parent.starts_with(&scope.current_folder) {
                return Err(BotckyPathError::TargetOutsideCurrentFolder);
            }
            canonical_parent.join(candidate.file_name().ok_or(BotckyPathError::EmptyPath)?)
        }
    };
    ensure_inside_scope(scope, &resolved)?;
    Ok(resolved)
}

pub fn ensure_inside_scope(
    scope: &BotckyPathScope,
    resolved_path: &Path,
) -> Result<(), BotckyPathError> {
    if !resolved_path.starts_with(&scope.vault_root) {
        return Err(BotckyPathError::TargetOutsideVault);
    }
    if !resolved_path.starts_with(&scope.current_folder) {
        return Err(BotckyPathError::TargetOutsideCurrentFolder);
    }
    Ok(())
}

pub fn path_relative_to_vault(scope: &BotckyPathScope, path: &Path) -> String {
    path.strip_prefix(&scope.vault_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn canonicalize(path: &Path) -> Result<PathBuf, BotckyPathError> {
    path.canonicalize()
        .map_err(|err| BotckyPathError::CanonicalizeFailed(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_traversal_absolute_null_and_overlong_paths() {
        assert_eq!(
            validate_relative_target("../secret").unwrap_err(),
            BotckyPathError::PathTraversal
        );
        assert_eq!(
            validate_relative_target("/tmp/secret").unwrap_err(),
            BotckyPathError::AbsolutePath
        );
        assert_eq!(
            validate_relative_target("bad\0path").unwrap_err(),
            BotckyPathError::NullByte
        );
        assert_eq!(
            validate_relative_target(&"a".repeat(MAX_BOTCKY_RELATIVE_PATH_LEN + 1)).unwrap_err(),
            BotckyPathError::TooLong
        );
    }

    #[test]
    fn accepts_existing_path_inside_current_folder() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes/today")).unwrap();
        fs::write(dir.path().join("notes/today/a.md"), "hello").unwrap();
        let scope = canonical_scope(dir.path(), Some("notes/today")).unwrap();
        let path = resolve_target(&scope, "a.md", TargetMode::MustExist).unwrap();
        assert!(path.ends_with("a.md"));
    }

    #[test]
    fn enforces_current_folder_scope() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes/today")).unwrap();
        fs::create_dir_all(dir.path().join("notes/other")).unwrap();
        fs::write(dir.path().join("notes/other/a.md"), "hello").unwrap();
        let scope = canonical_scope(dir.path(), Some("notes/today")).unwrap();
        let err = resolve_target(&scope, "../other/a.md", TargetMode::MustExist).unwrap_err();
        assert_eq!(err, BotckyPathError::PathTraversal);
    }

    #[cfg(unix)]
    #[test]
    fn denies_symlink_file_escape() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        symlink(
            outside.path().join("secret.md"),
            dir.path().join("notes/link.md"),
        )
        .unwrap();
        let scope = canonical_scope(dir.path(), Some("notes")).unwrap();
        assert_eq!(
            resolve_target(&scope, "link.md", TargetMode::MustExist).unwrap_err(),
            BotckyPathError::TargetOutsideVault
        );
    }

    #[cfg(unix)]
    #[test]
    fn denies_symlink_parent_escape_for_create() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        symlink(outside.path(), dir.path().join("notes/out")).unwrap();
        let scope = canonical_scope(dir.path(), Some("notes")).unwrap();
        assert_eq!(
            resolve_target(&scope, "out/new.md", TargetMode::ParentMustExist).unwrap_err(),
            BotckyPathError::TargetOutsideVault
        );
    }
}
