// Identity Module - Note/task identity management with UUID tracking
// Note: Some submodules (watcher, migration, sidecar) are scaffolding for future features.
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

pub mod api_updates;
pub mod cache;
pub mod frontmatter;
pub mod migration;
pub mod sidecar;
pub mod tasks;
pub mod uuid;
pub mod watcher;

use anyhow::Result;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::identity::cache::IdentityCache;
use crate::identity::frontmatter::{FrontMatter, FrontMatterParser, FrontMatterWriter, Priority};
use crate::identity::sidecar::{SidecarData, SidecarManager};
use crate::identity::tasks::{ParsedTask, TaskIdentity, TaskParser, TaskStatus};
use crate::identity::uuid::UuidGenerator;
use crate::tasks::{TaskIndex, TaskRecord};
use chrono::NaiveDate;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteIdentity {
    pub id: String,
    pub path: PathBuf,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct IdentityManager {
    generator: Arc<UuidGenerator>,
    cache: Arc<RwLock<IdentityCache>>,
    vault_root: PathBuf,
    task_identity: TaskIdentity,
    task_index: Arc<TaskIndex>,
}

impl IdentityManager {
    pub fn new(vault_root: PathBuf) -> Self {
        println!(
            "🔄 IdentityManager::new called with vault_root: {:?}",
            vault_root
        );
        let manager = Self {
            generator: Arc::new(UuidGenerator::new()),
            cache: Arc::new(RwLock::new(IdentityCache::new(10000))),
            vault_root: vault_root.clone(),
            task_identity: TaskIdentity::new(),
            task_index: Arc::new(TaskIndex::new()),
        };

        // TEMPORARY: Disable vault scanning during initialization to avoid async runtime deadlock
        // TODO: Make this async-safe or move scanning to a separate initialization step
        println!("  ⏭️ Skipping vault scan during initialization (avoiding runtime deadlock)");

        /* Commented out to fix deadlock - needs async refactor
        // Only scan vault if it exists and is valid
        if vault_root.exists() && vault_root.is_dir() {
            println!("  📂 Vault exists, starting scan for tasks...");
            // Scan vault and populate task index on initialization
            if let Err(e) = manager.scan_vault_for_tasks() {
                eprintln!("  ⚠️ Warning: Failed to scan vault for tasks: {}", e);
            } else {
                println!("  ✅ Vault scan complete");
            }
        } else {
            println!("  ⏭️ Skipping vault scan - vault not ready: {:?}", vault_root);
        }
        */

        println!("✅ IdentityManager::new complete");
        manager
    }

    /// Get a reference to the task index for querying
    pub fn task_index(&self) -> Arc<TaskIndex> {
        Arc::clone(&self.task_index)
    }

    pub fn ensure_note_id(&mut self, path: &Path) -> Result<String> {
        let canonical_path = self.canonicalize_path(path)?;

        // Check cache first
        {
            let mut cache = self.cache.write();
            if let Some(identity) = cache.get(&canonical_path) {
                return Ok(identity.id);
            }
        }

        // Try to read from persistent storage
        let mut existing_frontmatter = None;
        let existing_id = if SidecarManager::should_use_sidecar(path) {
            // Read from sidecar for non-markdown files
            SidecarManager::read(path)?.map(|data| data.id)
        } else if path.exists() {
            // Read from front matter for markdown files
            let content = std::fs::read_to_string(path)?;
            let (fm, _) = FrontMatterParser::parse(&content)?;
            existing_frontmatter = fm.clone();
            fm.and_then(|f| f.id)
        } else {
            None
        };

        // Use existing ID or generate new one
        let id = existing_id.unwrap_or_else(|| self.generator.generate().unwrap());
        let now = Utc::now();

        // Write to persistent storage
        if path.exists() {
            if SidecarManager::should_use_sidecar(path) {
                // Write to sidecar
                let data = SidecarData::new(id.clone(), path.to_string_lossy().to_string());
                SidecarManager::write(path, &data)?;
            } else {
                // Write to front matter, preserving any existing fields.
                let mut fm = existing_frontmatter.unwrap_or_else(FrontMatter::new);
                let now = Utc::now();
                fm.id = Some(id.clone());
                if fm.created_at.is_none() {
                    fm.created_at = Some(now);
                }
                fm.updated_at = Some(now);
                FrontMatterWriter::write_atomic(path, &fm, "")?;
            }
        }

        // Update cache
        let identity = NoteIdentity {
            id: id.clone(),
            path: canonical_path.clone(),
            created_at: now,
            updated_at: now,
        };

        self.cache.write().insert(canonical_path, identity);

        Ok(id)
    }

    pub fn get_note_id(&mut self, path: &Path) -> Result<Option<String>> {
        let canonical_path = self.canonicalize_path(path)?;

        // Check cache first
        {
            let mut cache = self.cache.write();
            if let Some(identity) = cache.get(&canonical_path) {
                return Ok(Some(identity.id));
            }
        }

        // Try to read from persistent storage
        let id = if SidecarManager::should_use_sidecar(path) {
            SidecarManager::read(path)?.map(|data| data.id)
        } else if path.exists() {
            let content = std::fs::read_to_string(path)?;
            let (fm, _) = FrontMatterParser::parse(&content)?;
            fm.and_then(|f| f.id)
        } else {
            None
        };

        // Update cache if found
        if let Some(ref id_str) = id {
            let identity = NoteIdentity {
                id: id_str.clone(),
                path: canonical_path.clone(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            };
            self.cache.write().insert(canonical_path, identity);
        }

        Ok(id)
    }

    pub async fn update_note_path(&mut self, old_path: &Path, new_path: &Path) -> Result<()> {
        let old_canonical = self.canonicalize_path(old_path)?;
        let new_canonical = self.canonicalize_path(new_path)?;

        // Update persistent storage
        if SidecarManager::should_use_sidecar(old_path) {
            // Rename sidecar file
            SidecarManager::rename(old_path, new_path)?;
        }
        // Note: Front matter travels with the file automatically

        // Update cache
        let mut cache = self.cache.write();
        if let Some(mut identity) = cache.remove(&old_canonical) {
            identity.path = new_canonical.clone();
            identity.updated_at = Utc::now();
            cache.insert(new_canonical, identity);
        }

        Ok(())
    }

    // Task-specific methods

    /// Ensure a task at the given line has a UUID and update the index
    /// Generate a new task ID without persisting it
    pub fn generate_task_id(&mut self) -> Result<String> {
        self.task_identity.generate_id()
    }

    pub fn ensure_task_id(&mut self, file_path: &Path, line_number: usize) -> Result<String> {
        // For task operations, we need the absolute path for file I/O
        let absolute_path = if file_path.is_absolute() {
            file_path.to_path_buf()
        } else {
            self.vault_root.join(file_path)
        };
        let task_id = self
            .task_identity
            .ensure_task_id(&absolute_path, line_number)?;

        // Update the task index with the new/updated task
        self.sync_file_tasks_to_index(&absolute_path)?;

        Ok(task_id)
    }

    /// Get a task by its ID from a specific file
    pub fn get_task_by_id(&self, file_path: &Path, task_id: &str) -> Result<Option<ParsedTask>> {
        // For task operations, we need the absolute path for file I/O
        let absolute_path = if file_path.is_absolute() {
            file_path.to_path_buf()
        } else {
            self.vault_root.join(file_path)
        };
        self.task_identity.get_task_by_id(&absolute_path, task_id)
    }

    /// Batch ensure all tasks in a file have IDs
    pub fn batch_ensure_task_ids(&mut self, file_path: &Path) -> Result<Vec<String>> {
        // For task operations, we need the absolute path for file I/O
        let absolute_path = if file_path.is_absolute() {
            file_path.to_path_buf()
        } else {
            self.vault_root.join(file_path)
        };
        self.task_identity.batch_ensure_task_ids(&absolute_path)
    }

    /// Find duplicate task IDs across the vault
    pub fn find_duplicate_task_ids(
        &self,
    ) -> Result<std::collections::HashMap<String, Vec<PathBuf>>> {
        self.task_identity.find_duplicate_task_ids(&self.vault_root)
    }

    /// Get cached task location
    pub fn get_cached_task_location(&self, task_id: &str) -> Option<(PathBuf, usize)> {
        self.task_identity.get_cached_location(task_id)
    }

    /// Clear the task cache
    pub fn clear_task_cache(&self) {
        self.task_identity.clear_cache();
    }

    /// Sync all tasks from a file to the index (async version to avoid deadlocks)
    pub async fn sync_file_tasks_to_index_async(&self, file_path: &Path) -> Result<()> {
        // Debug log the path being processed
        eprintln!(
            "[sync_file_tasks_to_index_async] Processing file path: {:?}",
            file_path
        );
        eprintln!(
            "[sync_file_tasks_to_index_async] Path exists: {}",
            file_path.exists()
        );
        eprintln!(
            "[sync_file_tasks_to_index_async] Path is absolute: {}",
            file_path.is_absolute()
        );

        // Read and parse all tasks from the file
        let content = std::fs::read_to_string(file_path).map_err(|e| {
            eprintln!(
                "[sync_file_tasks_to_index_async] Failed to read file: {:?}, error: {}",
                file_path, e
            );
            anyhow::anyhow!("Failed to read file at {:?}: {}", file_path, e)
        })?;
        let tasks = TaskParser::extract_all_tasks(&content);

        // Parse front matter for task metadata
        let (front_matter, _) = FrontMatterParser::parse(&content)?;
        let fm_tasks = if let Some(fm) = front_matter {
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
                .unwrap_or_default()
        } else {
            HashMap::new()
        };

        // Convert to TaskRecords and update index
        let task_records: Vec<TaskRecord> = tasks
            .into_iter()
            .filter_map(|task| {
                let task_id = task.id?;
                let fm_props = fm_tasks.get(&task_id);

                Some(TaskRecord {
                    id: task_id.clone(),
                    file_path: file_path.to_path_buf(),
                    line_number: task.line_number,
                    status: task.status,
                    text: task.content.clone(),
                    project: task
                        .properties
                        .get("project")
                        .cloned()
                        .or_else(|| fm_props.and_then(|p| p.project.clone())),
                    due_date: task
                        .properties
                        .get("due")
                        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                        .or_else(|| fm_props.and_then(|p| p.due.map(|dt| dt.date_naive()))),
                    priority: task
                        .properties
                        .get("priority")
                        .and_then(|p| match p.as_str() {
                            "high" => Some(Priority::High),
                            "medium" => Some(Priority::Medium),
                            "low" => Some(Priority::Low),
                            _ => None,
                        })
                        .or_else(|| fm_props.and_then(|p| p.priority)),
                    tags: task
                        .properties
                        .get("tags")
                        .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
                        .or_else(|| fm_props.and_then(|p| p.tags.clone())),
                    created_at: fm_props.map(|p| p.created_at).unwrap_or_else(Utc::now),
                    updated_at: fm_props.map(|p| p.updated_at).unwrap_or_else(Utc::now),
                    completed_at: if task.status == TaskStatus::Done {
                        fm_props
                            .and_then(|p| p.completed_at)
                            .or_else(|| Some(Utc::now()))
                    } else {
                        None
                    },
                    properties: task.properties,
                })
            })
            .collect();

        // Update the index with all tasks from this file - now async safe
        let task_index = self.task_index();
        task_index
            .update_file_tasks(file_path, task_records)
            .await?;

        Ok(())
    }

    /// Sync all tasks from a file to the index (blocking version - DO NOT use in async context)
    pub fn sync_file_tasks_to_index(&self, file_path: &Path) -> Result<()> {
        // Read and parse all tasks from the file
        let content = std::fs::read_to_string(file_path)?;
        let tasks = TaskParser::extract_all_tasks(&content);

        // Parse front matter for task metadata
        let (front_matter, _) = FrontMatterParser::parse(&content)?;
        let fm_tasks = if let Some(fm) = front_matter {
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
                .unwrap_or_default()
        } else {
            HashMap::new()
        };

        // Convert to TaskRecords and update index
        let task_records: Vec<TaskRecord> = tasks
            .into_iter()
            .filter_map(|task| {
                let task_id = task.id?;
                let fm_props = fm_tasks.get(&task_id);

                Some(TaskRecord {
                    id: task_id.clone(),
                    file_path: file_path.to_path_buf(),
                    line_number: task.line_number,
                    status: task.status,
                    text: task.content.clone(),
                    project: task
                        .properties
                        .get("project")
                        .cloned()
                        .or_else(|| fm_props.and_then(|p| p.project.clone())),
                    due_date: task
                        .properties
                        .get("due")
                        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                        .or_else(|| fm_props.and_then(|p| p.due.map(|dt| dt.date_naive()))),
                    priority: task
                        .properties
                        .get("priority")
                        .and_then(|p| match p.as_str() {
                            "high" => Some(Priority::High),
                            "medium" => Some(Priority::Medium),
                            "low" => Some(Priority::Low),
                            _ => None,
                        })
                        .or_else(|| fm_props.and_then(|p| p.priority)),
                    tags: task
                        .properties
                        .get("tags")
                        .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
                        .or_else(|| fm_props.and_then(|p| p.tags.clone())),
                    created_at: fm_props.map(|p| p.created_at).unwrap_or_else(Utc::now),
                    updated_at: fm_props.map(|p| p.updated_at).unwrap_or_else(Utc::now),
                    completed_at: if task.status == TaskStatus::Done {
                        fm_props
                            .and_then(|p| p.completed_at)
                            .or_else(|| Some(Utc::now()))
                    } else {
                        None
                    },
                    properties: task.properties,
                })
            })
            .collect();

        // Update the index with all tasks from this file
        let task_index = self.task_index();
        let runtime = tokio::runtime::Handle::try_current()
            .or_else(|_| tokio::runtime::Runtime::new().map(|rt| rt.handle().clone()))?;

        runtime.block_on(async { task_index.update_file_tasks(file_path, task_records).await })?;

        Ok(())
    }

    fn canonicalize_path(&self, path: &Path) -> Result<PathBuf> {
        // Handle absolute vs relative paths
        let full_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.vault_root.join(path)
        };

        // Normalize path by removing . and .. components
        let mut components = vec![];
        for component in full_path.components() {
            match component {
                std::path::Component::ParentDir => {
                    components.pop();
                }
                std::path::Component::CurDir => {}
                c => components.push(c),
            }
        }
        let normalized: PathBuf = components.iter().collect();

        // Get relative path from vault root
        if let Ok(relative) = normalized.strip_prefix(&self.vault_root) {
            Ok(relative.to_path_buf())
        } else {
            // Return as-is if not under vault root
            Ok(normalized)
        }
    }

    /// Get the vault root path
    pub fn vault_root(&self) -> &Path {
        &self.vault_root
    }

    /// Scan the entire vault for tasks and populate the task index (async version)
    pub async fn scan_vault_for_tasks_async(&self) -> Result<()> {
        use walkdir::WalkDir;

        // Check if vault root exists before scanning
        if !self.vault_root.exists() {
            println!(
                "    📁 Vault root does not exist yet: {:?}",
                self.vault_root
            );
            return Ok(());
        }

        println!("    🔍 Scanning vault for tasks: {:?}", self.vault_root);
        let mut task_count = 0;
        let mut file_count = 0;

        // Collect all markdown files first
        let markdown_files: Vec<_> = WalkDir::new(&self.vault_root)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|entry| entry.path().extension().and_then(|s| s.to_str()) == Some("md"))
            .map(|entry| entry.path().to_path_buf())
            .collect();

        // Process files asynchronously
        for path in markdown_files {
            file_count += 1;
            if file_count % 10 == 0 {
                println!("      📄 Processed {} files...", file_count);
            }

            // Skip files we can't read
            let Ok(_content) = std::fs::read_to_string(&path) else {
                continue;
            };

            // Extract tasks from the file using async version
            if let Ok(_) = self.sync_file_tasks_to_index_async(&path).await {
                task_count += 1;
            }
        }

        println!(
            "    ✅ Scanned {} markdown files: found tasks in {} files",
            file_count, task_count
        );
        Ok(())
    }

    /// Scan the entire vault for tasks and populate the task index (blocking version - DO NOT use in async context)
    pub fn scan_vault_for_tasks(&self) -> Result<()> {
        use walkdir::WalkDir;

        // Check if vault root exists before scanning
        if !self.vault_root.exists() {
            println!(
                "    📁 Vault root does not exist yet: {:?}",
                self.vault_root
            );
            return Ok(());
        }

        println!("    🔍 Scanning vault for tasks: {:?}", self.vault_root);
        let mut task_count = 0;
        let mut file_count = 0;

        for entry in WalkDir::new(&self.vault_root)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            // Only process markdown files
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }

            file_count += 1;
            if file_count % 10 == 0 {
                println!("      📄 Processed {} files...", file_count);
            }

            // Skip files we can't read
            let Ok(_content) = std::fs::read_to_string(path) else {
                continue;
            };

            // Extract tasks from the file
            if let Ok(_) = self.sync_file_tasks_to_index(path) {
                task_count += 1;
            }
        }

        println!(
            "    ✅ Scanned {} markdown files: found tasks in {} files",
            file_count, task_count
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests;
