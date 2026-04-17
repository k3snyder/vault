// Vault API - Secure file system operations for plugins
// Provides sandboxed access to vault files with permission checks

use notify::{Event as NotifyEvent, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;

use crate::identity::frontmatter::{FrontMatter, FrontMatterParser, FrontMatterWriter};
use crate::identity::uuid::UuidGenerator;
use crate::plugin_runtime::permissions::{Capability, Permission, PermissionManager};
use crate::vault::Vault;

#[cfg(test)]
mod tests;

/// Permissions for vault operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum VaultPermission {
    Read,
    Write,
    Delete,
    List,
    Watch,
}

/// File system entry information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub size: u64,
    pub modified: u64, // Unix timestamp
}

/// File event types for watching
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileEventKind {
    Created,
    Modified,
    Deleted,
    Renamed,
}

/// File system event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEvent {
    pub path: String,
    pub kind: FileEventKind,
    pub timestamp: u64,
}

/// Vault API errors
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Watch error: {0}")]
    WatchError(String),

    #[error("MCP error: {0}")]
    McpError(String),
}

/// Vault API implementation
pub struct VaultApi {
    vault_path: PathBuf,
    permission_manager: Arc<RwLock<PermissionManager>>,
    watchers: Arc<RwLock<HashMap<String, notify::RecommendedWatcher>>>,
    use_mcp: Arc<RwLock<bool>>,
}

impl VaultApi {
    /// Create a new Vault API instance
    pub fn new(vault_path: PathBuf, permission_manager: Arc<RwLock<PermissionManager>>) -> Self {
        Self {
            vault_path,
            permission_manager,
            watchers: Arc::new(RwLock::new(HashMap::new())),
            use_mcp: Arc::new(RwLock::new(false)),
        }
    }

    /// Grant a permission to a plugin (for testing)
    #[cfg(test)]
    pub async fn grant_permission(&self, plugin_id: &str, permission: VaultPermission) {
        let capability = match permission {
            VaultPermission::Read => Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            VaultPermission::Write => Capability::VaultWrite {
                paths: vec!["*".to_string()],
            },
            VaultPermission::Delete => Capability::VaultDelete {
                paths: vec!["*".to_string()],
            },
            VaultPermission::List => Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            VaultPermission::Watch => Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
        };

        let perm = Permission {
            capability,
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        let manager = self.permission_manager.read().await;
        manager
            .grant_permissions(plugin_id, vec![perm])
            .await
            .unwrap();
    }

    /// Set whether to use MCP filesystem server
    pub async fn set_mcp_mode(&self, use_mcp: bool) {
        let mut mcp = self.use_mcp.write().await;
        *mcp = use_mcp;
    }

    /// Validate and normalize a path
    fn validate_path(&self, path: &str) -> Result<PathBuf, VaultError> {
        // Allow root listing operations explicitly
        if path == "/" || path.is_empty() {
            return self.vault_path.canonicalize().map_err(|e| {
                VaultError::InvalidPath(format!("Failed to resolve vault root: {}", e))
            });
        }

        // Check for clearly invalid path payloads before filesystem resolution
        if path.contains("://") || path.contains('\0') {
            return Err(VaultError::InvalidPath(format!("Invalid path: {}", path)));
        }

        if Path::new(path).is_absolute() || path.starts_with('\\') {
            return Err(VaultError::InvalidPath(format!(
                "Absolute paths not allowed: {}",
                path
            )));
        }

        let vault = Vault::new(self.vault_path.clone())
            .map_err(|e| VaultError::InvalidPath(format!("Invalid vault root: {}", e)))?;

        vault
            .resolve_input_path(Path::new(path))
            .map_err(|e| VaultError::InvalidPath(e.to_string()))
    }

    /// Check if plugin has permission
    async fn check_permission(
        &self,
        plugin_id: &str,
        permission: VaultPermission,
    ) -> Result<(), VaultError> {
        let capability = match permission {
            VaultPermission::Read => Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            VaultPermission::Write => Capability::VaultWrite {
                paths: vec!["*".to_string()],
            },
            VaultPermission::Delete => Capability::VaultDelete {
                paths: vec!["*".to_string()],
            },
            VaultPermission::List => Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            VaultPermission::Watch => Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
        };

        let manager = self.permission_manager.read().await;
        if !manager.has_capability(plugin_id, &capability).await {
            return Err(VaultError::PermissionDenied(format!(
                "Plugin {} lacks permission: {:?}",
                plugin_id, permission
            )));
        }
        Ok(())
    }

    /// Read a text file
    pub async fn read(&self, plugin_id: &str, path: &str) -> Result<String, VaultError> {
        self.check_permission(plugin_id, VaultPermission::Read)
            .await?;
        let full_path = self.validate_path(path)?;

        // Check if we should use MCP
        let use_mcp = *self.use_mcp.read().await;
        if use_mcp {
            // TODO: Implement MCP filesystem call
            // For now, fall back to direct access
        }

        // Direct filesystem access
        fs::read_to_string(full_path)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// Read a binary file
    pub async fn read_binary(&self, plugin_id: &str, path: &str) -> Result<Vec<u8>, VaultError> {
        self.check_permission(plugin_id, VaultPermission::Read)
            .await?;
        let full_path = self.validate_path(path)?;

        fs::read(full_path)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// Write a text file
    pub async fn write(
        &self,
        plugin_id: &str,
        path: &str,
        content: &str,
    ) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Write)
            .await?;
        let full_path = self.validate_path(path)?;

        // Log the write operation for debugging
        println!("[VaultAPI] Plugin {} writing to: {}", plugin_id, path);

        // Create parent directory if needed
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| VaultError::IoError(e.to_string()))?;
        }

        // For markdown files, ensure they have a UUID
        let final_content = if path.ends_with(".md") {
            println!("[VaultAPI] Processing markdown file for UUID addition");
            let processed = self.ensure_uuid_in_content(content).await;
            // Check if UUID was added
            if !content.contains("uuid:") && processed.contains("uuid:") {
                println!("[VaultAPI] UUID added to file: {}", path);
            } else if content.contains("uuid:") {
                println!("[VaultAPI] File already has UUID: {}", path);
            }
            processed
        } else {
            content.to_string()
        };

        fs::write(full_path, final_content)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// Write a binary file
    pub async fn write_binary(
        &self,
        plugin_id: &str,
        path: &str,
        content: Vec<u8>,
    ) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Write)
            .await?;
        let full_path = self.validate_path(path)?;

        // Create parent directory if needed
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| VaultError::IoError(e.to_string()))?;
        }

        fs::write(full_path, content)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// Append to a file
    pub async fn append(
        &self,
        plugin_id: &str,
        path: &str,
        content: &str,
    ) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Write)
            .await?;
        let full_path = self.validate_path(path)?;

        // Read existing content
        let existing = fs::read_to_string(&full_path).await.unwrap_or_default();

        // Write combined content
        fs::write(full_path, format!("{}{}", existing, content))
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// Ensure content has a UUID in frontmatter
    async fn ensure_uuid_in_content(&self, content: &str) -> String {
        // Parse frontmatter
        let parse_result = FrontMatterParser::parse(content);

        // If parsing fails, return content as-is
        let (frontmatter, body) = match parse_result {
            Ok((fm, body)) => (fm, body),
            Err(_) => return content.to_string(),
        };

        // Check if UUID already exists
        if let Some(ref fm) = frontmatter {
            if fm.id.is_some() {
                return content.to_string();
            }
        }

        // Generate new UUID
        let uuid_generator = UuidGenerator::new();
        let new_uuid = uuid_generator.generate().unwrap_or_else(|_| {
            // Fallback to simple UUID generation
            uuid::Uuid::new_v4().to_string()
        });

        // Create or update frontmatter with UUID
        let mut fm = frontmatter.unwrap_or_else(|| FrontMatter::new());
        fm.id = Some(new_uuid);

        // Write back with frontmatter
        FrontMatterWriter::write(&fm, &body).unwrap_or_else(|_| content.to_string())
    }

    /// Delete a file
    pub async fn delete(&self, plugin_id: &str, path: &str) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Delete)
            .await?;
        let full_path = self.validate_path(path)?;

        fs::remove_file(full_path)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// List directory contents
    pub async fn list(&self, plugin_id: &str, path: &str) -> Result<Vec<FileEntry>, VaultError> {
        self.check_permission(plugin_id, VaultPermission::List)
            .await?;

        let dir_path = if path == "/" || path.is_empty() {
            self.vault_path.clone()
        } else {
            self.validate_path(path)?
        };

        let mut entries = Vec::new();
        let mut dir = fs::read_dir(dir_path)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))?;

        while let Some(entry) = dir
            .next_entry()
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))?
        {
            let metadata = entry
                .metadata()
                .await
                .map_err(|e| VaultError::IoError(e.to_string()))?;

            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry
                .path()
                .strip_prefix(&self.vault_path)
                .unwrap_or(&entry.path())
                .to_string_lossy()
                .to_string();

            entries.push(FileEntry {
                name,
                path,
                is_file: metadata.is_file(),
                size: metadata.len(),
                modified: metadata
                    .modified()
                    .map(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs()
                    })
                    .unwrap_or(0),
            });
        }

        Ok(entries)
    }

    /// Create a directory
    pub async fn create_folder(&self, plugin_id: &str, path: &str) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Write)
            .await?;
        let full_path = self.validate_path(path)?;

        fs::create_dir_all(full_path)
            .await
            .map_err(|e| VaultError::IoError(e.to_string()))
    }

    /// Delete a directory
    pub async fn delete_folder(
        &self,
        plugin_id: &str,
        path: &str,
        recursive: bool,
    ) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Delete)
            .await?;
        let full_path = self.validate_path(path)?;

        if recursive {
            fs::remove_dir_all(full_path)
                .await
                .map_err(|e| VaultError::IoError(e.to_string()))
        } else {
            fs::remove_dir(full_path)
                .await
                .map_err(|e| VaultError::IoError(e.to_string()))
        }
    }

    /// Watch a file or directory for changes
    pub async fn watch(
        &self,
        plugin_id: &str,
        path: &str,
        event_sender: tokio::sync::mpsc::Sender<FileEvent>,
    ) -> Result<(), VaultError> {
        self.check_permission(plugin_id, VaultPermission::Watch)
            .await?;
        let full_path = self.validate_path(path)?;

        // Create watcher
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |res: Result<NotifyEvent, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            })
            .map_err(|e| VaultError::WatchError(e.to_string()))?;

        // Start watching
        watcher
            .watch(&full_path, RecursiveMode::Recursive)
            .map_err(|e| VaultError::WatchError(e.to_string()))?;

        // Store watcher
        let watch_key = format!("{}:{}", plugin_id, path);
        let mut watchers = self.watchers.write().await;
        watchers.insert(watch_key.clone(), watcher);

        // Spawn event handler
        tokio::task::spawn_blocking(move || {
            while let Ok(event) = rx.recv() {
                let file_event = FileEvent {
                    path: event
                        .paths
                        .first()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    kind: match event.kind {
                        notify::EventKind::Create(_) => FileEventKind::Created,
                        notify::EventKind::Modify(_) => FileEventKind::Modified,
                        notify::EventKind::Remove(_) => FileEventKind::Deleted,
                        _ => FileEventKind::Modified,
                    },
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                };

                let _ = event_sender.blocking_send(file_event);
            }
        });

        Ok(())
    }

    /// Stop watching a file or directory
    pub async fn unwatch(&self, plugin_id: &str, path: &str) -> Result<(), VaultError> {
        let watch_key = format!("{}:{}", plugin_id, path);
        let mut watchers = self.watchers.write().await;

        if watchers.remove(&watch_key).is_some() {
            Ok(())
        } else {
            Err(VaultError::WatchError(format!(
                "No watcher found for {}",
                path
            )))
        }
    }
}
