/// Filesystem operations handler

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::warn;

pub struct FileSystemHandler {
    vault_path: PathBuf,
}

impl FileSystemHandler {
    pub fn new(vault_path: PathBuf) -> Self {
        Self { vault_path }
    }

    /// Ensure a path is within the vault directory
    fn ensure_in_vault(&self, path: &str) -> Result<PathBuf> {
        // Clean the path first
        let cleaned_path = Path::new(path);
        
        // Check for path traversal attempts
        for component in cleaned_path.components() {
            match component {
                std::path::Component::ParentDir => {
                    // Check if this would escape the vault
                    let test_path = self.vault_path.join(cleaned_path);
                    if let Ok(canonical) = test_path.canonicalize() {
                        if !canonical.starts_with(&self.vault_path) {
                            return Err(anyhow!("Path is outside vault directory"));
                        }
                    }
                }
                std::path::Component::Normal(_) => {}
                _ => {}
            }
        }
        
        // Build the full path
        let target_path = self.vault_path.join(cleaned_path);
        
        // For operations that create new files/directories, we just need to ensure
        // the path would be within the vault when created
        if target_path.exists() {
            let canonical_target = target_path.canonicalize()?;
            let canonical_vault = self.vault_path.canonicalize()?;
            
            if !canonical_target.starts_with(&canonical_vault) {
                return Err(anyhow!("Path is outside vault directory"));
            }
            Ok(canonical_target)
        } else {
            // For non-existent paths, ensure all parent components stay within vault
            let mut current = PathBuf::new();
            for component in cleaned_path.components() {
                match component {
                    std::path::Component::Normal(name) => {
                        current.push(name);
                    }
                    std::path::Component::ParentDir => {
                        if !current.pop() {
                            return Err(anyhow!("Path is outside vault directory"));
                        }
                    }
                    _ => {}
                }
            }
            
            Ok(self.vault_path.join(current))
        }
    }

    pub async fn list_files(&self, args: Value) -> Result<String> {
        let path = args["path"].as_str().unwrap_or(".");
        let include_hidden = args["include_hidden"].as_bool().unwrap_or(false);
        
        let dir_path = self.ensure_in_vault(path)?;
        
        let mut entries = fs::read_dir(&dir_path).await?;
        let mut files = Vec::new();
        
        while let Some(entry) = entries.next_entry().await? {
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();
            
            if !include_hidden && file_name_str.starts_with('.') {
                continue;
            }
            
            let metadata = entry.metadata().await?;
            let file_type = if metadata.is_dir() {
                "directory"
            } else {
                "file"
            };
            
            let relative_path = entry.path()
                .strip_prefix(&self.vault_path)
                .unwrap_or(&entry.path())
                .to_string_lossy()
                .to_string();
            
            files.push(json!({
                "name": file_name_str,
                "path": relative_path,
                "type": file_type,
                "size": metadata.len(),
                "modified": metadata.modified()
                    .map(|t| {
                        let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap();
                        let secs = duration.as_secs() as i64;
                        let nanos = duration.subsec_nanos() as u32;
                        chrono::DateTime::<chrono::Utc>::from_timestamp(secs, nanos)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_else(|| "unknown".to_string())
                    })
                    .unwrap_or_else(|_| "unknown".to_string())
            }));
        }
        
        Ok(serde_json::to_string_pretty(&files)?)
    }

    pub async fn read_file(&self, args: Value) -> Result<String> {
        let path = args["path"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: path"))?;
        
        let file_path = self.ensure_in_vault(path)?;
        let content = fs::read_to_string(file_path).await?;
        
        Ok(content)
    }

    pub async fn write_file(&self, args: Value) -> Result<String> {
        let path = args["path"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: path"))?;
        let content = args["content"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: content"))?;
        
        let file_path = self.ensure_in_vault(path)?;
        
        // Create parent directory if it doesn't exist
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        
        fs::write(&file_path, content).await?;
        
        Ok(format!("File written successfully: {}", path))
    }

    pub async fn create_directory(&self, args: Value) -> Result<String> {
        let path = args["path"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: path"))?;
        
        let dir_path = self.ensure_in_vault(path)?;
        fs::create_dir_all(&dir_path).await?;
        
        Ok(format!("Directory created: {}", path))
    }

    pub async fn delete_file(&self, args: Value) -> Result<String> {
        let path = args["path"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: path"))?;
        
        let file_path = self.ensure_in_vault(path)?;
        let metadata = fs::metadata(&file_path).await?;
        
        if metadata.is_dir() {
            fs::remove_dir(&file_path).await?;
        } else {
            fs::remove_file(&file_path).await?;
        }
        
        Ok(format!("Deleted: {}", path))
    }

    pub async fn move_file(&self, args: Value) -> Result<String> {
        let source = args["source"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: source"))?;
        let destination = args["destination"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: destination"))?;
        
        let source_path = self.ensure_in_vault(source)?;
        let dest_path = self.ensure_in_vault(destination)?;
        
        // Create destination directory if needed
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        
        fs::rename(&source_path, &dest_path).await?;
        
        Ok(format!("Moved {} to {}", source, destination))
    }

    pub async fn search_files(&self, args: Value) -> Result<String> {
        let pattern = args["pattern"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing required parameter: pattern"))?;
        let path = args["path"].as_str().unwrap_or(".");
        
        let search_path = self.ensure_in_vault(path)?;
        
        // Convert wildcard pattern to regex
        let regex_pattern = pattern
            .replace(".", r"\.")
            .replace("*", ".*")
            .replace("?", ".");
        let regex = regex::Regex::new(&format!("(?i){}", regex_pattern))?;
        
        let mut results = Vec::new();
        self.search_dir(&search_path, &regex, &mut results).await?;
        
        Ok(serde_json::to_string_pretty(&results)?)
    }

    fn search_dir<'a>(&'a self, dir: &'a Path, regex: &'a regex::Regex, results: &'a mut Vec<Value>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
        let mut entries = fs::read_dir(dir).await?;
        
        while let Some(entry) = entries.next_entry().await? {
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();
            
            if regex.is_match(&file_name_str) {
                let metadata = entry.metadata().await?;
                let file_type = if metadata.is_dir() {
                    "directory"
                } else {
                    "file"
                };
                
                let relative_path = entry.path()
                    .strip_prefix(&self.vault_path)
                    .unwrap_or(&entry.path())
                    .to_string_lossy()
                    .to_string();
                
                results.push(json!({
                    "name": file_name_str,
                    "path": relative_path,
                    "type": file_type
                }));
            }
            
            // Recursively search subdirectories
            if entry.metadata().await?.is_dir() && !file_name_str.starts_with('.') {
                if let Err(e) = self.search_dir(&entry.path(), regex, results).await {
                    warn!("Error searching directory {:?}: {}", entry.path(), e);
                }
            }
        }
        
        Ok(())
        })
    }

    pub async fn get_vault_info(&self) -> Result<String> {
        let metadata = fs::metadata(&self.vault_path).await?;
        let entries = fs::read_dir(&self.vault_path).await?;
        let file_count = entries.count().await;
        
        let info = json!({
            "path": self.vault_path.to_string_lossy(),
            "created": metadata.created()
                .map(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap();
                    let secs = duration.as_secs() as i64;
                    let nanos = duration.subsec_nanos() as u32;
                    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, nanos)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_else(|| "unknown".to_string())
                })
                .unwrap_or_else(|_| "unknown".to_string()),
            "modified": metadata.modified()
                .map(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap();
                    let secs = duration.as_secs() as i64;
                    let nanos = duration.subsec_nanos() as u32;
                    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, nanos)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_else(|| "unknown".to_string())
                })
                .unwrap_or_else(|_| "unknown".to_string()),
            "totalFiles": file_count,
            "isWritable": true
        });
        
        Ok(serde_json::to_string_pretty(&info)?)
    }
}

// Extension trait to count entries in ReadDir
trait ReadDirExt {
    async fn count(self) -> usize;
}

impl ReadDirExt for fs::ReadDir {
    async fn count(mut self) -> usize {
        let mut count = 0;
        while self.next_entry().await.unwrap().is_some() {
            count += 1;
        }
        count
    }
}