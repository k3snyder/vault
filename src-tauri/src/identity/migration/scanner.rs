use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use walkdir::{DirEntry, WalkDir};

/// Scanner for discovering files in a vault
pub struct VaultScanner {
    vault_root: PathBuf,
    supported_extensions: Vec<String>,
}

impl VaultScanner {
    pub fn new(vault_root: PathBuf) -> Self {
        Self {
            vault_root,
            supported_extensions: vec![
                "md".to_string(),
                "txt".to_string(),
                "pdf".to_string(),
                "png".to_string(),
                "jpg".to_string(),
                "jpeg".to_string(),
                "gif".to_string(),
                "svg".to_string(),
                "webp".to_string(),
            ],
        }
    }

    /// Scan the vault and return all eligible files
    pub fn scan_vault(&self) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();

        let walker = WalkDir::new(&self.vault_root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| self.should_process_entry(e));

        for entry in walker {
            let entry = entry.context("Failed to read directory entry")?;
            let path = entry.path();

            if path.is_file() && self.is_supported_file(path) {
                files.push(path.to_path_buf());
            }
        }

        Ok(files)
    }

    /// Check if a directory entry should be processed
    fn should_process_entry(&self, entry: &DirEntry) -> bool {
        // Skip hidden directories
        if entry
            .file_name()
            .to_str()
            .map(|s| s.starts_with('.') && s != ".")
            .unwrap_or(false)
        {
            return false;
        }

        // Skip common non-content directories
        let skip_dirs = vec![
            "node_modules",
            "target",
            "dist",
            "build",
            ".git",
            ".obsidian",
        ];
        if entry.file_type().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                if skip_dirs.contains(&name) {
                    return false;
                }
            }
        }

        true
    }

    /// Check if a file is supported for migration
    fn is_supported_file(&self, path: &Path) -> bool {
        // Check if it's a regular file
        if !path.is_file() {
            return false;
        }

        // Check extension
        if let Some(ext) = path.extension() {
            if let Some(ext_str) = ext.to_str() {
                return self.supported_extensions.contains(&ext_str.to_lowercase());
            }
        }

        false
    }

    /// Get count of files in vault (for progress estimation)
    pub fn count_files(&self) -> Result<usize> {
        Ok(self.scan_vault()?.len())
    }

    /// Scan with a filter predicate
    pub fn scan_with_filter<F>(&self, filter: F) -> Result<Vec<PathBuf>>
    where
        F: Fn(&Path) -> bool,
    {
        let all_files = self.scan_vault()?;
        Ok(all_files.into_iter().filter(|p| filter(p)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_scan_empty_vault() {
        let temp_dir = TempDir::new().unwrap();
        let scanner = VaultScanner::new(temp_dir.path().to_path_buf());

        let files = scanner.scan_vault().unwrap();
        assert_eq!(files.len(), 0);
    }

    #[test]
    fn test_scan_with_markdown_files() {
        let temp_dir = TempDir::new().unwrap();

        // Create some markdown files
        fs::write(temp_dir.path().join("note1.md"), "# Note 1").unwrap();
        fs::write(temp_dir.path().join("note2.md"), "# Note 2").unwrap();

        // Create a subdirectory with more files
        let subdir = temp_dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("note3.md"), "# Note 3").unwrap();

        let scanner = VaultScanner::new(temp_dir.path().to_path_buf());
        let files = scanner.scan_vault().unwrap();

        assert_eq!(files.len(), 3);
    }

    #[test]
    fn test_skip_hidden_files() {
        let temp_dir = TempDir::new().unwrap();

        // Create visible and hidden files
        fs::write(temp_dir.path().join("visible.md"), "visible").unwrap();
        fs::write(temp_dir.path().join(".hidden.md"), "hidden").unwrap();

        let scanner = VaultScanner::new(temp_dir.path().to_path_buf());
        let files = scanner.scan_vault().unwrap();

        assert_eq!(files.len(), 1);
        assert!(files[0].file_name().unwrap() == "visible.md");
    }

    #[test]
    fn test_skip_unsupported_extensions() {
        let temp_dir = TempDir::new().unwrap();

        // Create files with various extensions
        fs::write(temp_dir.path().join("note.md"), "markdown").unwrap();
        fs::write(temp_dir.path().join("text.txt"), "text").unwrap();
        fs::write(temp_dir.path().join("image.png"), "").unwrap();
        fs::write(temp_dir.path().join("binary.exe"), "").unwrap();
        fs::write(temp_dir.path().join("temp.tmp"), "").unwrap();

        let scanner = VaultScanner::new(temp_dir.path().to_path_buf());
        let files = scanner.scan_vault().unwrap();

        assert_eq!(files.len(), 3); // md, txt, png
    }

    #[test]
    fn test_skip_system_directories() {
        let temp_dir = TempDir::new().unwrap();

        // Create files in root
        fs::write(temp_dir.path().join("root.md"), "root").unwrap();

        // Create files in .git directory (should be skipped)
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir(&git_dir).unwrap();
        fs::write(git_dir.join("config.md"), "git config").unwrap();

        // Create files in node_modules (should be skipped)
        let node_dir = temp_dir.path().join("node_modules");
        fs::create_dir(&node_dir).unwrap();
        fs::write(node_dir.join("package.md"), "package").unwrap();

        let scanner = VaultScanner::new(temp_dir.path().to_path_buf());
        let files = scanner.scan_vault().unwrap();

        assert_eq!(files.len(), 1);
        assert!(files[0].file_name().unwrap() == "root.md");
    }

    #[test]
    fn test_scan_with_filter() {
        let temp_dir = TempDir::new().unwrap();

        // Create various files
        fs::write(temp_dir.path().join("small.md"), "x").unwrap();
        fs::write(temp_dir.path().join("large.md"), "x".repeat(1000)).unwrap();

        let scanner = VaultScanner::new(temp_dir.path().to_path_buf());

        // Filter for files larger than 100 bytes
        let files = scanner
            .scan_with_filter(|path| path.metadata().map(|m| m.len() > 100).unwrap_or(false))
            .unwrap();

        assert_eq!(files.len(), 1);
        assert!(files[0].file_name().unwrap() == "large.md");
    }
}
