use std::io;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct Vault {
    path: PathBuf,
}

impl Vault {
    pub fn new(path: PathBuf) -> io::Result<Self> {
        if !path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Vault path does not exist",
            ));
        }

        if !path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Vault path is not a directory",
            ));
        }

        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn resolve_path(&self, relative_path: &Path) -> io::Result<PathBuf> {
        let normalized = normalize_relative_path(relative_path)?;
        let vault_root = self.path.canonicalize().map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("Failed to resolve vault root {:?}: {}", self.path, error),
            )
        })?;

        let mut candidate = vault_root.clone();
        let mut resolved_prefix = vault_root.clone();
        let mut missing_tail = PathBuf::new();
        let mut missing = false;

        let mut components = normalized.components().peekable();
        while let Some(component) = components.next() {
            let is_last = components.peek().is_none();

            if missing {
                missing_tail.push(component.as_os_str());
                continue;
            }

            candidate.push(component.as_os_str());

            match std::fs::symlink_metadata(&candidate) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            format!(
                                "Symlinks are not allowed in vault paths: {:?}",
                                relative_path
                            ),
                        ));
                    }

                    if metadata.is_file() && !is_last {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            format!("Path traverses through a file: {:?}", relative_path),
                        ));
                    }

                    if !candidate.starts_with(&vault_root) {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            format!("Path escapes vault: {:?}", relative_path),
                        ));
                    }

                    resolved_prefix = candidate.clone();
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    missing = true;
                    missing_tail.push(component.as_os_str());
                }
                Err(error) => {
                    return Err(io::Error::new(
                        error.kind(),
                        format!(
                            "Failed to inspect vault path {:?}: {}",
                            relative_path, error
                        ),
                    ));
                }
            }
        }

        if missing {
            Ok(resolved_prefix.join(missing_tail))
        } else {
            Ok(resolved_prefix)
        }
    }

    pub fn resolve_input_path(&self, input_path: &Path) -> io::Result<PathBuf> {
        if looks_like_absolute_path(input_path) {
            let vault_root = self.path.canonicalize().map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!("Failed to resolve vault root {:?}: {}", self.path, error),
                )
            })?;

            if let Ok(relative) = input_path.strip_prefix(&self.path) {
                return self.resolve_path(relative);
            }

            if let Ok(relative) = input_path.strip_prefix(&vault_root) {
                return self.resolve_path(relative);
            }

            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("Absolute path {:?} is outside the active vault", input_path),
            ));
        }

        self.resolve_path(input_path)
    }

    pub fn list_markdown_files(&self) -> io::Result<Vec<PathBuf>> {
        let mut items = Vec::new();

        // Scanning vault directory

        for entry in WalkDir::new(&self.path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let file_type = entry.file_type();

            // Skip the root directory itself
            if path == self.path {
                // Skip root directory
                continue;
            }

            if file_type.is_symlink() {
                continue;
            }

            // Include directories, markdown files, and images
            if file_type.is_dir() {
                // Found directory
                items.push(path.to_path_buf());
            } else if file_type.is_file() {
                let ext = path.extension().and_then(|s| s.to_str());
                // Processing file
                if ext == Some("md") {
                    // Adding markdown file
                    items.push(path.to_path_buf());
                } else if matches!(ext, Some("png") | Some("jpg") | Some("jpeg") | Some("gif")) {
                    // Adding image file
                    items.push(path.to_path_buf());
                } else if ext == Some("pdf") {
                    // Adding PDF file
                    items.push(path.to_path_buf());
                } else if ext == Some("csv") {
                    // Adding CSV file
                    items.push(path.to_path_buf());
                } else if ext == Some("json") {
                    // Adding JSON file
                    items.push(path.to_path_buf());
                } else if ext == Some("excalidraw") {
                    // Adding Excalidraw sketch file
                    items.push(path.to_path_buf());
                } else if ext == Some("boxnote") {
                    // Adding Box Note file
                    items.push(path.to_path_buf());
                } else if matches!(ext, Some("html") | Some("htm")) {
                    // Adding HTML file
                    items.push(path.to_path_buf());
                }
            }
        }

        // Total items found
        items.sort();
        Ok(items)
    }

    pub fn read_file(&self, relative_path: &Path) -> io::Result<String> {
        let full_path = self.resolve_path(relative_path)?;
        std::fs::read_to_string(full_path)
    }

    pub fn write_file(&self, relative_path: &Path, content: &str) -> io::Result<()> {
        let full_path = self.resolve_path(relative_path)?;

        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(full_path, content)
    }
}

fn normalize_relative_path(relative_path: &Path) -> io::Result<PathBuf> {
    let raw_path = relative_path.to_string_lossy();
    let separator_normalized = raw_path.replace('\\', "/");

    if separator_normalized.split('/').any(|part| part == "..") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Path must stay relative to the vault: {:?}", relative_path),
        ));
    }

    if looks_like_absolute_path(relative_path) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Path must stay relative to the vault: {:?}", relative_path),
        ));
    }

    let mut normalized = PathBuf::new();

    for component in relative_path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("Path must stay relative to the vault: {:?}", relative_path),
                ));
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path cannot be empty",
        ));
    }

    Ok(normalized)
}

fn looks_like_absolute_path(path: &Path) -> bool {
    if path.is_absolute() {
        return true;
    }

    let raw_path = path.to_string_lossy();
    if raw_path.starts_with('\\') {
        return true;
    }

    let bytes = raw_path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

#[cfg(test)]
mod tests {
    use super::Vault;
    use std::{io, path::Path};
    use tempfile::TempDir;

    fn create_vault() -> (TempDir, Vault) {
        let temp_dir = TempDir::new().expect("temp dir");
        let vault = Vault::new(temp_dir.path().to_path_buf()).expect("vault");
        (temp_dir, vault)
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let (_temp_dir, vault) = create_vault();

        assert!(vault.resolve_path(Path::new("../escape.md")).is_err());
        assert!(vault.resolve_path(Path::new("..\\escape.md")).is_err());
        assert!(vault.resolve_path(Path::new("/escape.md")).is_err());
        assert!(vault.resolve_path(Path::new(r"C:\escape.md")).is_err());
    }

    #[test]
    fn writes_and_reads_files_inside_the_vault() {
        let (temp_dir, vault) = create_vault();
        let relative = Path::new("notes/todo.md");

        vault
            .write_file(relative, "hello vault")
            .expect("write within vault");

        assert_eq!(
            std::fs::read_to_string(temp_dir.path().join("notes/todo.md")).unwrap(),
            "hello vault"
        );
        assert_eq!(vault.read_file(relative).unwrap(), "hello vault");
    }

    #[test]
    fn allows_missing_destination_paths_for_writes_and_moves() {
        let (temp_dir, vault) = create_vault();

        let source = Path::new("notes/source.md");
        vault.write_file(source, "move me").expect("source write");

        let destination = vault
            .resolve_path(Path::new("archive/2026/moved.md"))
            .expect("resolve missing destination");

        assert_eq!(
            destination,
            temp_dir
                .path()
                .canonicalize()
                .unwrap()
                .join("archive/2026/moved.md")
        );

        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::rename(temp_dir.path().join("notes/source.md"), &destination).unwrap();

        assert_eq!(std::fs::read_to_string(destination).unwrap(), "move me");
    }

    #[test]
    fn accepts_absolute_paths_inside_the_vault() {
        let (temp_dir, vault) = create_vault();
        let relative = Path::new("notes/todo.md");

        vault
            .write_file(relative, "hello vault")
            .expect("write within vault");

        let resolved = vault
            .resolve_input_path(&temp_dir.path().join(relative))
            .expect("resolve absolute path inside vault");

        assert_eq!(
            resolved,
            temp_dir.path().canonicalize().unwrap().join(relative)
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_traversal_in_resolve_path() {
        use std::os::unix::fs::symlink;

        let (temp_dir, vault) = create_vault();
        let outside_dir = TempDir::new().expect("outside temp dir");
        std::fs::create_dir_all(temp_dir.path().join("links")).unwrap();
        symlink(outside_dir.path(), temp_dir.path().join("links/external")).unwrap();

        let error = vault
            .resolve_path(Path::new("links/external/escape.md"))
            .expect_err("symlink traversal should be rejected");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_absolute_symlink_paths_inside_the_vault() {
        use std::os::unix::fs::symlink;

        let (temp_dir, vault) = create_vault();
        let target_dir = temp_dir.path().join("notes");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(target_dir.join("todo.md"), "hello vault").unwrap();
        symlink(&target_dir, temp_dir.path().join("linked-notes")).unwrap();

        let error = vault
            .resolve_input_path(&temp_dir.path().join("linked-notes/todo.md"))
            .expect_err("absolute symlink path should be rejected");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks_when_listing_markdown_files() {
        use std::os::unix::fs::symlink;

        let (temp_dir, vault) = create_vault();
        std::fs::write(temp_dir.path().join("note.md"), "note").unwrap();
        symlink(
            temp_dir.path().join("note.md"),
            temp_dir.path().join("note-link.md"),
        )
        .unwrap();
        symlink(
            temp_dir.path().join("notes"),
            temp_dir.path().join("notes-link"),
        )
        .unwrap();

        let items = vault.list_markdown_files().expect("list markdown files");

        assert!(items.contains(&temp_dir.path().join("note.md")));
        assert!(!items.contains(&temp_dir.path().join("note-link.md")));
        assert!(!items.contains(&temp_dir.path().join("notes-link")));
    }
}
