use anyhow::Result;
use futures::stream::StreamExt;
use parking_lot::RwLock;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::identity::tasks::parser::TaskParser;
use crate::identity::IdentityManager;

/// Configuration for task migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMigrationConfig {
    /// Run in dry-run mode (no actual changes)
    pub dry_run: bool,
    /// Show progress during migration
    pub show_progress: bool,
    /// Maximum files to process in parallel
    pub parallel_limit: usize,
    /// Skip tasks that already have IDs
    pub skip_existing: bool,
    /// Extract and store task properties in front matter
    pub include_properties: bool,
}

impl Default for TaskMigrationConfig {
    fn default() -> Self {
        Self {
            dry_run: false,
            show_progress: true,
            parallel_limit: 4,
            skip_existing: true,
            include_properties: true,
        }
    }
}

/// Status of a file during migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TaskFileStatus {
    Migrated { tasks_updated: usize },
    Skipped { reason: String },
    AlreadyComplete,
    Error { message: String },
}

/// Migration report with detailed statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMigrationReport {
    /// Total files scanned
    pub total_files: usize,
    /// Files that were modified
    pub files_modified: usize,
    /// Files skipped
    pub files_skipped: usize,
    /// Total tasks found
    pub total_tasks: usize,
    /// Tasks that needed IDs
    pub tasks_needing_ids: usize,
    /// Tasks that already had IDs
    pub tasks_with_ids: usize,
    /// Tasks actually migrated
    pub tasks_migrated: usize,
    /// Tasks skipped
    pub tasks_skipped: usize,
    /// Open tasks ([ ])
    pub open_tasks: usize,
    /// Completed tasks ([x])
    pub completed_tasks: usize,
    /// Properties extracted (property name -> count)
    pub properties_extracted: HashMap<String, usize>,
    /// Whether this was a dry-run
    pub is_dry_run: bool,
    /// Errors encountered
    pub errors: Vec<String>,
    /// Error count
    pub error_count: usize,
    /// Detailed file statuses
    pub file_statuses: HashMap<PathBuf, TaskFileStatus>,
    /// Changes that would be made (dry-run only)
    pub dry_run_changes: Vec<String>,
    /// Backup created
    pub backup_created: bool,
    /// Backup path if created
    pub backup_path: Option<PathBuf>,
    /// Migration duration in milliseconds
    pub duration_ms: u128,
}

impl TaskMigrationReport {
    fn new(is_dry_run: bool) -> Self {
        Self {
            total_files: 0,
            files_modified: 0,
            files_skipped: 0,
            total_tasks: 0,
            tasks_needing_ids: 0,
            tasks_with_ids: 0,
            tasks_migrated: 0,
            tasks_skipped: 0,
            open_tasks: 0,
            completed_tasks: 0,
            properties_extracted: HashMap::new(),
            is_dry_run,
            errors: Vec::new(),
            error_count: 0,
            file_statuses: HashMap::new(),
            dry_run_changes: Vec::new(),
            backup_created: false,
            backup_path: None,
            duration_ms: 0,
        }
    }

    /// Generate a human-readable summary
    pub fn generate_summary(&self) -> String {
        let mut summary = String::new();

        summary.push_str(&format!(
            "=== Task Migration Report{} ===\n",
            if self.is_dry_run { " (DRY RUN)" } else { "" }
        ));
        summary.push_str(&format!("Total files scanned: {}\n", self.total_files));
        summary.push_str(&format!("Total tasks found: {}\n", self.total_tasks));
        summary.push_str(&format!("  - Open tasks: {}\n", self.open_tasks));
        summary.push_str(&format!("  - Completed tasks: {}\n", self.completed_tasks));
        summary.push_str(&format!(
            "\nTasks needing IDs: {}\n",
            self.tasks_needing_ids
        ));
        summary.push_str(&format!(
            "Tasks with existing IDs: {}\n",
            self.tasks_with_ids
        ));

        if !self.is_dry_run {
            summary.push_str(&format!("\nTasks migrated: {}\n", self.tasks_migrated));
            summary.push_str(&format!("Files modified: {}\n", self.files_modified));
        } else {
            summary.push_str(&format!(
                "\nTasks that would be migrated: {}\n",
                self.tasks_needing_ids
            ));
            summary.push_str(&format!(
                "Files that would be modified: {}\n",
                self.file_statuses
                    .values()
                    .filter(|s| matches!(s, TaskFileStatus::Migrated { .. }))
                    .count()
            ));
        }

        if !self.properties_extracted.is_empty() {
            summary.push_str("\nProperties extracted:\n");
            for (prop, count) in &self.properties_extracted {
                summary.push_str(&format!("  - {}: {}\n", prop, count));
            }
        }

        if self.error_count > 0 {
            summary.push_str(&format!("\nErrors encountered: {}\n", self.error_count));
            for error in &self.errors {
                summary.push_str(&format!("  - {}\n", error));
            }
        }

        if self.backup_created {
            summary.push_str(&format!("\nBackup created at: {:?}\n", self.backup_path));
        }

        summary.push_str(&format!("\nDuration: {}ms\n", self.duration_ms));

        summary
    }
}

/// Task migration manager
pub struct TaskMigrationManager {
    identity_manager: Arc<RwLock<IdentityManager>>,
    vault_root: PathBuf,
    config: TaskMigrationConfig,
    backup_dir: Option<PathBuf>,
}

impl TaskMigrationManager {
    pub fn new(
        identity_manager: Arc<RwLock<IdentityManager>>,
        vault_root: PathBuf,
        config: TaskMigrationConfig,
    ) -> Self {
        Self {
            identity_manager,
            vault_root,
            config,
            backup_dir: None,
        }
    }

    /// Run the migration
    pub async fn migrate(&mut self) -> Result<TaskMigrationReport> {
        let start = std::time::Instant::now();
        let mut report = TaskMigrationReport::new(self.config.dry_run);

        // Scan for markdown files
        let files = self.scan_vault().await?;
        report.total_files = files.len();

        // Process files in parallel
        let semaphore = Arc::new(Semaphore::new(self.config.parallel_limit));
        let mut tasks = vec![];

        for file_path in files {
            let sem = semaphore.clone();
            let path = file_path.clone();
            let config = self.config.clone();
            let vault_root = self.vault_root.clone();
            let identity_manager = self.identity_manager.clone();

            let task = tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                Self::process_file_static(path, config, vault_root, identity_manager).await
            });

            tasks.push((file_path, task));
        }

        // Collect results
        for (file_path, task) in tasks {
            match task.await {
                Ok(Ok((status, file_report))) => {
                    // Update report statistics
                    Self::update_report(&mut report, &status, &file_report);
                    report.file_statuses.insert(file_path, status);
                }
                Ok(Err(e)) => {
                    report.error_count += 1;
                    report
                        .errors
                        .push(format!("{}: {}", file_path.display(), e));
                    report.file_statuses.insert(
                        file_path.clone(),
                        TaskFileStatus::Error {
                            message: e.to_string(),
                        },
                    );
                }
                Err(e) => {
                    report.error_count += 1;
                    report
                        .errors
                        .push(format!("{}: Join error: {}", file_path.display(), e));
                }
            }
        }

        report.duration_ms = start.elapsed().as_millis();
        Ok(report)
    }

    /// Run migration with backup capability
    pub async fn migrate_with_backup(&mut self) -> Result<TaskMigrationReport> {
        // Create backup directory
        let backup_dir = self
            .vault_root
            .join(".migration_backup")
            .join(chrono::Local::now().format("%Y%m%d_%H%M%S").to_string());
        fs::create_dir_all(&backup_dir).await?;
        self.backup_dir = Some(backup_dir.clone());

        // Set environment variable for backup directory so process_file creates backups
        std::env::set_var("MIGRATION_BACKUP_DIR", &backup_dir);

        let mut report = self.migrate().await?;
        report.backup_created = true;
        report.backup_path = Some(backup_dir);

        // Clean up environment variable
        std::env::remove_var("MIGRATION_BACKUP_DIR");

        Ok(report)
    }

    /// Rollback a migration using backup
    pub async fn rollback(&self, report: &TaskMigrationReport) -> Result<()> {
        if let Some(ref backup_path) = report.backup_path {
            for (file_path, _status) in &report.file_statuses {
                let backup_file = backup_path.join(file_path.strip_prefix(&self.vault_root)?);
                if backup_file.exists() {
                    fs::copy(&backup_file, file_path).await?;
                }
            }
        } else {
            anyhow::bail!("No backup available for rollback");
        }
        Ok(())
    }

    /// Scan vault for markdown files
    async fn scan_vault(&self) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        self.scan_directory(&self.vault_root, &mut files).await?;
        Ok(files)
    }

    /// Recursively scan directory
    fn scan_directory<'a>(
        &'a self,
        dir: &'a Path,
        files: &'a mut Vec<PathBuf>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let mut entries = fs::read_dir(dir).await?;

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                let file_name = entry.file_name();
                let file_name_str = file_name.to_string_lossy();

                // Skip hidden files and directories
                if file_name_str.starts_with('.') {
                    continue;
                }

                if path.is_dir() {
                    self.scan_directory(&path, files).await?;
                } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    // Skip temp/backup files
                    if !file_name_str.ends_with(".tmp")
                        && !file_name_str.ends_with(".bak")
                        && !file_name_str.ends_with(".swp")
                    {
                        files.push(path);
                    }
                }
            }

            Ok(())
        })
    }

    /// Process a single file (static method for parallel processing)
    async fn process_file_static(
        file_path: PathBuf,
        config: TaskMigrationConfig,
        vault_root: PathBuf,
        identity_manager: Arc<RwLock<IdentityManager>>,
    ) -> Result<(TaskFileStatus, FileReport)> {
        let mut file_report = FileReport::default();

        // Read file content
        let content = fs::read_to_string(&file_path).await?;
        let lines: Vec<&str> = content.lines().collect();

        // Find all tasks in the file
        let task_regex = Regex::new(r"^\s*- \[([ x])\]").unwrap();
        let tid_regex = Regex::new(r"<!-- tid: ([a-f0-9-]+) -->").unwrap();
        let mut tasks_to_migrate = Vec::new();

        for (line_num, line) in lines.iter().enumerate() {
            if task_regex.is_match(line) {
                file_report.total_tasks += 1;

                let has_id = tid_regex.is_match(line);
                if has_id {
                    file_report.tasks_with_ids += 1;
                } else {
                    file_report.tasks_needing_ids += 1;
                    if !config.skip_existing || !has_id {
                        tasks_to_migrate.push((line_num, line.to_string()));
                    }
                }

                // Count completed vs open
                if line.contains("[x]") {
                    file_report.completed_tasks += 1;
                } else {
                    file_report.open_tasks += 1;
                }
            }
        }

        // If no tasks need migration, skip
        if tasks_to_migrate.is_empty() {
            if file_report.total_tasks == 0 {
                return Ok((
                    TaskFileStatus::Skipped {
                        reason: "No tasks found".to_string(),
                    },
                    file_report,
                ));
            } else {
                return Ok((TaskFileStatus::AlreadyComplete, file_report));
            }
        }

        // In dry-run mode, just return what would be done
        if config.dry_run {
            return Ok((
                TaskFileStatus::Migrated {
                    tasks_updated: tasks_to_migrate.len(),
                },
                file_report,
            ));
        }

        // Create backup if backup directory is set
        if let Some(backup_dir) = std::env::var("MIGRATION_BACKUP_DIR").ok() {
            let backup_path = PathBuf::from(backup_dir).join(file_path.strip_prefix(&vault_root)?);
            if let Some(parent) = backup_path.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(&file_path, backup_path).await?;
        }

        // Migrate tasks
        let mut modified_lines = lines.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let mut tasks_updated = 0;
        let mut front_matter_tasks = HashMap::new();

        for (line_num, _original_line) in tasks_to_migrate {
            // Generate new UUID
            let task_id = Uuid::now_v7().to_string();

            // Add tid comment to the line
            let line = &mut modified_lines[line_num];
            if !line.ends_with("-->") {
                line.push_str(&format!(" <!-- tid: {} -->", task_id));
                tasks_updated += 1;
            }

            // Parse task for properties if configured
            if config.include_properties {
                if let Some(parsed_task) = TaskParser::parse_line(line, line_num + 1) {
                    if !parsed_task.properties.is_empty() {
                        // Update property counts before moving parsed_task
                        if parsed_task.properties.contains_key("due") {
                            *file_report
                                .properties_extracted
                                .entry("due".to_string())
                                .or_insert(0) += 1;
                        }
                        if parsed_task.properties.contains_key("project") {
                            *file_report
                                .properties_extracted
                                .entry("project".to_string())
                                .or_insert(0) += 1;
                        }
                        if parsed_task.properties.contains_key("tags") {
                            *file_report
                                .properties_extracted
                                .entry("tags".to_string())
                                .or_insert(0) += 1;
                        }
                        if parsed_task.properties.contains_key("priority") {
                            *file_report
                                .properties_extracted
                                .entry("priority".to_string())
                                .or_insert(0) += 1;
                        }

                        // Store task properties for front matter (moves parsed_task)
                        front_matter_tasks.insert(task_id.clone(), parsed_task);
                    }
                }
            }
        }

        // Write updated content back to file
        if tasks_updated > 0 {
            let new_content = modified_lines.join("\n");

            // For now, just write the content with task IDs added
            // Front matter task properties can be handled separately
            fs::write(&file_path, new_content).await?;
        }

        file_report.tasks_migrated = tasks_updated;
        // Tasks that already had IDs in this file are considered skipped
        file_report.tasks_skipped = file_report.tasks_with_ids;

        Ok((TaskFileStatus::Migrated { tasks_updated }, file_report))
    }

    /// Update the main report with file-level statistics
    fn update_report(
        report: &mut TaskMigrationReport,
        status: &TaskFileStatus,
        file_report: &FileReport,
    ) {
        report.total_tasks += file_report.total_tasks;
        report.tasks_with_ids += file_report.tasks_with_ids;
        report.tasks_needing_ids += file_report.tasks_needing_ids;
        report.open_tasks += file_report.open_tasks;
        report.completed_tasks += file_report.completed_tasks;

        match status {
            TaskFileStatus::Migrated { tasks_updated } => {
                // Only count as modified/migrated if not in dry-run mode
                if !report.is_dry_run {
                    report.files_modified += 1;
                    report.tasks_migrated += tasks_updated;
                    // Add skipped tasks from files that were modified
                    report.tasks_skipped += file_report.tasks_skipped;
                }
            }
            TaskFileStatus::Skipped { .. } => {
                report.files_skipped += 1;
            }
            TaskFileStatus::AlreadyComplete => {
                report.tasks_skipped += file_report.tasks_with_ids;
            }
            TaskFileStatus::Error { .. } => {
                report.error_count += 1;
            }
        }

        // Merge property counts
        for (prop, count) in &file_report.properties_extracted {
            *report.properties_extracted.entry(prop.clone()).or_insert(0) += count;
        }
    }
}

/// Statistics for a single file
#[derive(Debug, Default)]
struct FileReport {
    total_tasks: usize,
    tasks_with_ids: usize,
    tasks_needing_ids: usize,
    tasks_migrated: usize,
    tasks_skipped: usize,
    open_tasks: usize,
    completed_tasks: usize,
    properties_extracted: HashMap<String, usize>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_basic_migration() {
        let temp_dir = TempDir::new().unwrap();
        let vault_path = temp_dir.path().to_path_buf();

        // Create test file
        let content = "# Test\n- [ ] Task 1\n- [x] Task 2";
        tokio::fs::write(vault_path.join("test.md"), content)
            .await
            .unwrap();

        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: false,
        };

        let mut manager = TaskMigrationManager::new(identity_manager, vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();

        assert_eq!(report.total_files, 1);
        assert_eq!(report.total_tasks, 2);
        assert_eq!(report.tasks_migrated, 2);

        // Verify file was updated
        let updated = tokio::fs::read_to_string(vault_path.join("test.md"))
            .await
            .unwrap();
        assert!(updated.contains("<!-- tid:"));
    }
}
