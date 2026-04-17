pub mod deletion_cache;
pub mod rename_detector;

use anyhow::Result;
use chrono::{DateTime, Utc};
use notify_debouncer_full::{
    new_debouncer,
    notify::{
        event::{ModifyKind, RenameMode},
        EventKind, RecursiveMode, Watcher,
    },
    DebounceEventResult, DebouncedEvent,
};
use parking_lot::RwLock;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use self::deletion_cache::DeletionCache;
use self::rename_detector::RenameDetector;
use crate::identity::IdentityManager;

/// Configuration for the identity watcher
#[derive(Debug, Clone)]
pub struct WatcherConfig {
    /// Time window for debouncing events (milliseconds)
    pub debounce_ms: u64,
    /// Time window for detecting delete+create as rename (milliseconds)
    pub rename_window_ms: u64,
    /// Maximum entries in deletion cache
    pub cache_size: usize,
    /// Enable debug logging
    pub debug: bool,
}

impl Default for WatcherConfig {
    fn default() -> Self {
        WatcherConfig {
            debounce_ms: 100,
            rename_window_ms: 500,
            cache_size: 1000,
            debug: false,
        }
    }
}

/// Enhanced file watcher with rename detection
pub struct IdentityWatcher {
    identity_manager: Arc<RwLock<IdentityManager>>,
    rename_detector: RenameDetector,
    deletion_cache: Arc<RwLock<DeletionCache>>,
    config: WatcherConfig,
    vault_root: PathBuf,
}

impl IdentityWatcher {
    pub fn new(
        identity_manager: Arc<RwLock<IdentityManager>>,
        vault_root: PathBuf,
        config: WatcherConfig,
    ) -> Self {
        Self {
            identity_manager,
            rename_detector: RenameDetector::new(config.rename_window_ms),
            deletion_cache: Arc::new(RwLock::new(DeletionCache::new(
                config.cache_size,
                config.rename_window_ms,
            ))),
            config,
            vault_root,
        }
    }

    /// Start watching the vault directory for file changes
    pub async fn watch(&mut self) -> Result<()> {
        let (tx, mut rx) = mpsc::channel(100);

        // Create debouncer with our configuration
        let mut debouncer = new_debouncer(
            Duration::from_millis(self.config.debounce_ms),
            None,
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    for event in events {
                        let _ = tx.blocking_send(event);
                    }
                }
            },
        )?;

        // Start watching the vault root
        debouncer
            .watcher()
            .watch(&self.vault_root, RecursiveMode::Recursive)?;

        // Process events
        while let Some(event) = rx.recv().await {
            if let Err(e) = self.handle_event(event).await {
                eprintln!("Error handling event: {}", e);
            }
        }

        Ok(())
    }

    /// Handle a single debounced event
    async fn handle_event(&mut self, event: DebouncedEvent) -> Result<()> {
        if self.config.debug {
            println!("Event: {:?}", event);
        }

        match &event.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                // Direct rename detected by notify
                self.handle_rename(&event).await?;
            }
            EventKind::Remove(_) => {
                // File deleted - add to cache for potential rename detection
                self.handle_deletion(&event).await?;
            }
            EventKind::Create(_) => {
                // File created - check if it's a rename from deletion cache
                self.handle_creation(&event).await?;
            }
            _ => {
                // Other events we don't need to handle for identity
            }
        }

        Ok(())
    }

    /// Handle a rename event
    async fn handle_rename(&mut self, event: &DebouncedEvent) -> Result<()> {
        // Notify provides both old and new paths for rename events
        if event.event.paths.len() == 2 {
            let old_path = &event.event.paths[0];
            let new_path = &event.event.paths[1];

            if self.config.debug {
                println!("Rename detected: {:?} -> {:?}", old_path, new_path);
            }

            // Update identity manager
            let mut manager = self.identity_manager.write();
            manager.update_note_path(old_path, new_path).await?;
        }

        Ok(())
    }

    /// Handle a deletion event
    async fn handle_deletion(&mut self, event: &DebouncedEvent) -> Result<()> {
        if let Some(path) = event.event.paths.first() {
            // Get the file's identity before it's deleted
            let identity = {
                let mut manager = self.identity_manager.write();
                manager.get_note_id(path)?
            };

            if let Some(id) = identity {
                // Add to deletion cache with metadata for potential rename detection
                let metadata = FileMetadata {
                    path: path.clone(),
                    id,
                    deleted_at: Utc::now(),
                    size: self.get_file_size(path),
                    fingerprint: self.calculate_fingerprint(path),
                };

                self.deletion_cache.write().add(metadata);

                if self.config.debug {
                    println!("Added to deletion cache: {:?}", path);
                }
            }
        }

        Ok(())
    }

    /// Handle a creation event
    async fn handle_creation(&mut self, event: &DebouncedEvent) -> Result<()> {
        if let Some(path) = event.event.paths.first() {
            // Check if this might be a rename from a recently deleted file
            let possible_rename = self
                .deletion_cache
                .write()
                .find_possible_rename(path, self.get_file_size(path));

            if let Some(old_metadata) = possible_rename {
                if self.config.debug {
                    println!(
                        "Possible rename detected: {:?} -> {:?}",
                        old_metadata.path, path
                    );
                }

                // Verify with additional heuristics
                if self.rename_detector.is_likely_rename(&old_metadata, path) {
                    // Update identity manager with the rename
                    let mut manager = self.identity_manager.write();
                    manager.update_note_path(&old_metadata.path, path).await?;

                    // Remove from deletion cache
                    self.deletion_cache.write().remove(&old_metadata.path);

                    if self.config.debug {
                        println!("Rename confirmed via heuristics");
                    }
                }
            }
        }

        Ok(())
    }

    /// Get file size for fingerprinting
    fn get_file_size(&self, path: &Path) -> Option<u64> {
        std::fs::metadata(path).ok().map(|m| m.len())
    }

    /// Calculate a simple fingerprint for the file
    fn calculate_fingerprint(&self, path: &Path) -> Option<String> {
        // For now, just use file extension and approximate size
        // Could be enhanced with partial content hash
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        self.get_file_size(path)
            .map(|size| format!("{}-{}", ext, size / 1000)) // Round to KB
    }
}

/// Metadata for a deleted file
#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub path: PathBuf,
    pub id: String,
    pub deleted_at: DateTime<Utc>,
    pub size: Option<u64>,
    pub fingerprint: Option<String>,
}

#[cfg(test)]
mod tests;
