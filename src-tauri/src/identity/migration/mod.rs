pub mod mapper;
pub mod report;
pub mod scanner;

use anyhow::Result;
use indicatif::{ProgressBar, ProgressStyle};
use parking_lot::RwLock;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use self::mapper::LegacyIdMapper;
use self::report::{FileStatus, MigrationReport};
use self::scanner::VaultScanner;
use crate::identity::IdentityManager;

/// Configuration for the migration process
#[derive(Debug, Clone)]
pub struct MigrationConfig {
    /// Whether to run in dry-run mode (no actual changes)
    pub dry_run: bool,
    /// Whether to show progress bar
    pub show_progress: bool,
    /// Whether to calculate and store legacy IDs
    pub include_legacy_ids: bool,
    /// Maximum number of files to process in parallel
    pub parallel_limit: usize,
    /// Whether to skip files that already have UUIDs
    pub skip_existing: bool,
}

impl Default for MigrationConfig {
    fn default() -> Self {
        Self {
            dry_run: false,
            show_progress: true,
            include_legacy_ids: true,
            parallel_limit: 4,
            skip_existing: true,
        }
    }
}

/// Main migration orchestrator
pub struct MigrationManager {
    identity_manager: Arc<RwLock<IdentityManager>>,
    config: MigrationConfig,
    vault_root: PathBuf,
}

impl MigrationManager {
    pub fn new(
        identity_manager: Arc<RwLock<IdentityManager>>,
        vault_root: PathBuf,
        config: MigrationConfig,
    ) -> Self {
        Self {
            identity_manager,
            config,
            vault_root,
        }
    }

    /// Run the migration process
    pub async fn migrate(&mut self) -> Result<MigrationReport> {
        let mut report = MigrationReport::new(self.vault_root.clone());

        // Phase 1: Scan vault for files
        let scanner = VaultScanner::new(self.vault_root.clone());
        let files = scanner.scan_vault()?;
        report.total_files = files.len();

        // Create progress bar if needed
        let progress = if self.config.show_progress {
            let pb = ProgressBar::new(files.len() as u64);
            pb.set_style(
                ProgressStyle::default_bar()
                    .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})")
                    .unwrap()
                    .progress_chars("#>-")
            );
            Some(pb)
        } else {
            None
        };

        // Phase 2: Process each file
        for file_path in files {
            if let Some(ref pb) = progress {
                pb.set_message(format!("Processing: {}", file_path.display()));
            }

            match self.process_file(&file_path, &mut report).await {
                Ok(status) => {
                    match status {
                        FileStatus::Migrated => report.migrated_count += 1,
                        FileStatus::AlreadyHasId => report.already_had_id += 1,
                        FileStatus::Skipped => report.skipped_count += 1,
                        FileStatus::Error(_) => report.error_count += 1,
                    }
                    report.file_statuses.insert(file_path, status);
                }
                Err(e) => {
                    report.error_count += 1;
                    report
                        .file_statuses
                        .insert(file_path.clone(), FileStatus::Error(e.to_string()));
                    report
                        .errors
                        .push(format!("{}: {}", file_path.display(), e));
                }
            }

            if let Some(ref pb) = progress {
                pb.inc(1);
            }
        }

        if let Some(pb) = progress {
            pb.finish_with_message("Migration complete");
        }

        // Phase 3: Generate final report
        report.calculate_statistics();

        Ok(report)
    }

    /// Process a single file
    async fn process_file(
        &mut self,
        path: &Path,
        report: &mut MigrationReport,
    ) -> Result<FileStatus> {
        // Check if file already has an ID
        let existing_id = {
            let mut manager = self.identity_manager.write();
            manager.get_note_id(path)?
        };

        if existing_id.is_some() && self.config.skip_existing {
            return Ok(FileStatus::AlreadyHasId);
        }

        // Skip certain file types
        if self.should_skip_file(path) {
            return Ok(FileStatus::Skipped);
        }

        // Calculate legacy IDs if needed
        let legacy_ids = if self.config.include_legacy_ids {
            Some(LegacyIdMapper::calculate_legacy_ids(
                path,
                &self.vault_root,
            )?)
        } else {
            None
        };

        // In dry-run mode, just record what would be done
        if self.config.dry_run {
            report.dry_run_changes.push(format!(
                "Would add UUID to: {}{}",
                path.display(),
                if legacy_ids.is_some() {
                    " (with legacy ID mapping)"
                } else {
                    ""
                }
            ));
            return Ok(FileStatus::Migrated);
        }

        // Actually assign the UUID
        let new_id = {
            let mut manager = self.identity_manager.write();
            manager.ensure_note_id(path)?
        };

        // Store legacy IDs if calculated
        if let Some(legacy) = legacy_ids {
            self.store_legacy_ids(path, &new_id, &legacy).await?;
        }

        Ok(FileStatus::Migrated)
    }

    /// Check if a file should be skipped
    fn should_skip_file(&self, path: &Path) -> bool {
        // Skip hidden files and directories
        if let Some(name) = path.file_name() {
            if name.to_string_lossy().starts_with('.') {
                return true;
            }
        }

        // Skip certain extensions
        let skip_extensions = vec!["tmp", "bak", "swp", "swo", "lock"];
        if let Some(ext) = path.extension() {
            if skip_extensions.contains(&ext.to_str().unwrap_or("")) {
                return true;
            }
        }

        false
    }

    /// Store legacy IDs in the file's metadata
    async fn store_legacy_ids(
        &self,
        path: &Path,
        uuid: &str,
        legacy_ids: &mapper::LegacyIds,
    ) -> Result<()> {
        use crate::identity::frontmatter::{FrontMatter, FrontMatterParser, FrontMatterWriter};
        use crate::identity::sidecar::{SidecarData, SidecarManager};

        if SidecarManager::should_use_sidecar(path) {
            // For non-markdown files, update the sidecar
            let mut data = SidecarManager::read(path)?.unwrap_or_else(|| {
                SidecarData::new(uuid.to_string(), path.to_string_lossy().to_string())
            });

            // Add legacy IDs
            data.legacy_ids = Some(vec![
                legacy_ids.absolute_path_hash.clone(),
                legacy_ids.relative_path_hash.clone(),
            ]);

            // Store file hash if needed
            data.file_hash = Some(format!(
                "{}|{}",
                legacy_ids.original_absolute_path, legacy_ids.original_relative_path
            ));

            SidecarManager::write(path, &data)?;
        } else if path.exists() {
            // For markdown files, update front matter
            let content = std::fs::read_to_string(path)?;
            let (fm, body) = FrontMatterParser::parse(&content)?;

            let mut front_matter = fm.unwrap_or_else(|| FrontMatter::with_id(uuid.to_string()));

            // Add legacy IDs array
            front_matter.legacy_ids = Some(vec![
                legacy_ids.absolute_path_hash.clone(),
                legacy_ids.relative_path_hash.clone(),
            ]);

            // Store original paths for reference
            front_matter.other.insert(
                "original_absolute_path".to_string(),
                yaml_rust::Yaml::String(legacy_ids.original_absolute_path.clone()),
            );
            front_matter.other.insert(
                "original_relative_path".to_string(),
                yaml_rust::Yaml::String(legacy_ids.original_relative_path.clone()),
            );

            FrontMatterWriter::write_atomic(path, &front_matter, &body)?;
        }

        Ok(())
    }

    /// Run migration in dry-run mode
    pub async fn dry_run(&mut self) -> Result<MigrationReport> {
        let mut config = self.config.clone();
        config.dry_run = true;
        self.config = config;
        self.migrate().await
    }
}

#[cfg(test)]
mod tests;
