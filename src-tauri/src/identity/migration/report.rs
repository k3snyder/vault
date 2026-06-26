use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Status of a file during migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileStatus {
    /// Successfully migrated (UUID added)
    Migrated,
    /// File already had a UUID
    AlreadyHasId,
    /// File was skipped (hidden, temporary, etc.)
    Skipped,
    /// Error occurred during processing
    Error(String),
}

/// Report of a migration operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationReport {
    /// Root path of the vault
    pub vault_root: PathBuf,
    /// When the migration started
    pub started_at: DateTime<Utc>,
    /// When the migration completed
    pub completed_at: Option<DateTime<Utc>>,
    /// Total number of files found
    pub total_files: usize,
    /// Number of files successfully migrated
    pub migrated_count: usize,
    /// Number of files that already had IDs
    pub already_had_id: usize,
    /// Number of files skipped
    pub skipped_count: usize,
    /// Number of files with errors
    pub error_count: usize,
    /// Detailed status for each file
    pub file_statuses: HashMap<PathBuf, FileStatus>,
    /// List of errors encountered
    pub errors: Vec<String>,
    /// Changes that would be made in dry-run mode
    pub dry_run_changes: Vec<String>,
    /// Statistics about the migration
    pub statistics: MigrationStatistics,
}

impl MigrationReport {
    pub fn new(vault_root: PathBuf) -> Self {
        Self {
            vault_root,
            started_at: Utc::now(),
            completed_at: None,
            total_files: 0,
            migrated_count: 0,
            already_had_id: 0,
            skipped_count: 0,
            error_count: 0,
            file_statuses: HashMap::new(),
            errors: Vec::new(),
            dry_run_changes: Vec::new(),
            statistics: MigrationStatistics::default(),
        }
    }

    /// Mark the migration as complete
    pub fn complete(&mut self) {
        self.completed_at = Some(Utc::now());
        self.calculate_statistics();
    }

    /// Calculate statistics for the migration
    pub fn calculate_statistics(&mut self) {
        let duration = if let Some(completed) = self.completed_at {
            completed.signed_duration_since(self.started_at)
        } else {
            Utc::now().signed_duration_since(self.started_at)
        };

        self.statistics = MigrationStatistics {
            duration_seconds: duration.num_seconds() as u64,
            files_per_second: if duration.num_seconds() > 0 {
                self.total_files as f64 / duration.num_seconds() as f64
            } else {
                0.0
            },
            success_rate: if self.total_files > 0 {
                ((self.migrated_count + self.already_had_id) as f64 / self.total_files as f64)
                    * 100.0
            } else {
                0.0
            },
            migration_needed_rate: if self.total_files > 0 {
                (self.migrated_count as f64 / self.total_files as f64) * 100.0
            } else {
                0.0
            },
        };
    }

    /// Generate a human-readable summary
    pub fn summary(&self) -> String {
        let mut summary = String::new();

        summary.push_str(&format!(
            "Migration Report for: {}\n",
            self.vault_root.display()
        ));
        summary.push_str(&format!(
            "Started: {}\n",
            self.started_at.format("%Y-%m-%d %H:%M:%S")
        ));

        if let Some(completed) = self.completed_at {
            summary.push_str(&format!(
                "Completed: {}\n",
                completed.format("%Y-%m-%d %H:%M:%S")
            ));
            summary.push_str(&format!(
                "Duration: {} seconds\n",
                self.statistics.duration_seconds
            ));
        }

        summary.push_str("\n=== File Statistics ===\n");
        summary.push_str(&format!("Total files found: {}\n", self.total_files));
        summary.push_str(&format!("Successfully migrated: {}\n", self.migrated_count));
        summary.push_str(&format!("Already had UUID: {}\n", self.already_had_id));
        summary.push_str(&format!("Skipped: {}\n", self.skipped_count));
        summary.push_str(&format!("Errors: {}\n", self.error_count));

        summary.push_str("\n=== Performance ===\n");
        summary.push_str(&format!(
            "Processing rate: {:.2} files/second\n",
            self.statistics.files_per_second
        ));
        summary.push_str(&format!(
            "Success rate: {:.1}%\n",
            self.statistics.success_rate
        ));
        summary.push_str(&format!(
            "Migration needed: {:.1}%\n",
            self.statistics.migration_needed_rate
        ));

        if !self.errors.is_empty() {
            summary.push_str("\n=== Errors ===\n");
            for (i, error) in self.errors.iter().enumerate().take(10) {
                summary.push_str(&format!("{}. {}\n", i + 1, error));
            }
            if self.errors.len() > 10 {
                summary.push_str(&format!("... and {} more errors\n", self.errors.len() - 10));
            }
        }

        if !self.dry_run_changes.is_empty() {
            summary.push_str("\n=== Dry Run Changes (Preview) ===\n");
            for (i, change) in self.dry_run_changes.iter().enumerate().take(10) {
                summary.push_str(&format!("{}. {}\n", i + 1, change));
            }
            if self.dry_run_changes.len() > 10 {
                summary.push_str(&format!(
                    "... and {} more changes\n",
                    self.dry_run_changes.len() - 10
                ));
            }
        }

        summary
    }

    /// Export report as JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Export report as CSV
    pub fn to_csv(&self) -> String {
        let mut csv = String::new();
        csv.push_str("File Path,Status,Error Message\n");

        for (path, status) in &self.file_statuses {
            let status_str = match status {
                FileStatus::Migrated => "Migrated",
                FileStatus::AlreadyHasId => "Already Has ID",
                FileStatus::Skipped => "Skipped",
                FileStatus::Error(msg) => "Error",
            };

            let error_msg = match status {
                FileStatus::Error(msg) => msg.as_str(),
                _ => "",
            };

            csv.push_str(&format!(
                "{},{},{}\n",
                path.display(),
                status_str,
                error_msg.replace(',', ";") // Escape commas in error messages
            ));
        }

        csv
    }

    /// Check if migration was successful
    pub fn is_successful(&self) -> bool {
        self.error_count == 0 && self.completed_at.is_some()
    }

    /// Get files that need manual attention
    pub fn get_problem_files(&self) -> Vec<&PathBuf> {
        self.file_statuses
            .iter()
            .filter(|(_, status)| matches!(status, FileStatus::Error(_)))
            .map(|(path, _)| path)
            .collect()
    }
}

/// Statistics about the migration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MigrationStatistics {
    /// Total duration in seconds
    pub duration_seconds: u64,
    /// Files processed per second
    pub files_per_second: f64,
    /// Percentage of files successfully processed
    pub success_rate: f64,
    /// Percentage of files that needed migration
    pub migration_needed_rate: f64,
}

/// Progress tracker for long-running migrations
pub struct MigrationProgress {
    total: usize,
    current: usize,
    started_at: DateTime<Utc>,
    last_update: DateTime<Utc>,
}

impl MigrationProgress {
    pub fn new(total: usize) -> Self {
        let now = Utc::now();
        Self {
            total,
            current: 0,
            started_at: now,
            last_update: now,
        }
    }

    /// Update progress
    pub fn increment(&mut self) {
        self.current += 1;
        self.last_update = Utc::now();
    }

    /// Get current progress as percentage
    pub fn percentage(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            (self.current as f64 / self.total as f64) * 100.0
        }
    }

    /// Estimate time remaining
    pub fn estimate_remaining(&self) -> Option<Duration> {
        if self.current == 0 {
            return None;
        }

        let elapsed = self.last_update.signed_duration_since(self.started_at);
        let rate = self.current as f64 / elapsed.num_seconds() as f64;

        if rate > 0.0 {
            let remaining_files = self.total - self.current;
            let remaining_seconds = remaining_files as f64 / rate;
            Some(Duration::seconds(remaining_seconds as i64))
        } else {
            None
        }
    }

    /// Get human-readable status
    pub fn status(&self) -> String {
        let percentage = self.percentage();
        let remaining = self
            .estimate_remaining()
            .map(|d| format!(" (ETA: {}s)", d.num_seconds()))
            .unwrap_or_default();

        format!(
            "[{}/{}] {:.1}%{}",
            self.current, self.total, percentage, remaining
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_report_new() {
        let report = MigrationReport::new(PathBuf::from("/test/vault"));

        assert_eq!(report.vault_root, PathBuf::from("/test/vault"));
        assert_eq!(report.total_files, 0);
        assert_eq!(report.migrated_count, 0);
        assert!(report.completed_at.is_none());
    }

    #[test]
    fn test_migration_report_complete() {
        let mut report = MigrationReport::new(PathBuf::from("/test/vault"));
        report.total_files = 100;
        report.migrated_count = 50;
        report.already_had_id = 30;
        report.skipped_count = 15;
        report.error_count = 5;

        report.complete();

        assert!(report.completed_at.is_some());
        assert!(report.statistics.success_rate > 0.0);
    }

    #[test]
    fn test_file_status() {
        let status = FileStatus::Migrated;
        assert!(matches!(status, FileStatus::Migrated));

        let error = FileStatus::Error("Test error".to_string());
        assert!(matches!(error, FileStatus::Error(_)));
    }

    #[test]
    fn test_migration_progress() {
        let mut progress = MigrationProgress::new(100);

        assert_eq!(progress.percentage(), 0.0);

        progress.increment();
        assert_eq!(progress.current, 1);
        assert_eq!(progress.percentage(), 1.0);

        for _ in 0..49 {
            progress.increment();
        }
        assert_eq!(progress.percentage(), 50.0);

        let status = progress.status();
        assert!(status.contains("[50/100]"));
        assert!(status.contains("50.0%"));
    }

    #[test]
    fn test_migration_statistics() {
        let mut report = MigrationReport::new(PathBuf::from("/test"));
        report.total_files = 100;
        report.migrated_count = 60;
        report.already_had_id = 20;
        report.error_count = 5;

        report.calculate_statistics();

        assert_eq!(report.statistics.success_rate, 80.0);
        assert_eq!(report.statistics.migration_needed_rate, 60.0);
    }

    #[test]
    fn test_report_summary() {
        let mut report = MigrationReport::new(PathBuf::from("/test/vault"));
        report.total_files = 10;
        report.migrated_count = 5;
        report.already_had_id = 3;
        report.skipped_count = 1;
        report.error_count = 1;
        report.errors.push("Failed to process file.txt".to_string());

        report.complete();

        let summary = report.summary();

        assert!(summary.contains("Migration Report"));
        assert!(summary.contains("Total files found: 10"));
        assert!(summary.contains("Successfully migrated: 5"));
        assert!(summary.contains("Already had UUID: 3"));
        assert!(summary.contains("Errors: 1"));
        assert!(summary.contains("Failed to process file.txt"));
    }

    #[test]
    fn test_get_problem_files() {
        let mut report = MigrationReport::new(PathBuf::from("/test"));

        report
            .file_statuses
            .insert(PathBuf::from("good.md"), FileStatus::Migrated);
        report.file_statuses.insert(
            PathBuf::from("bad1.md"),
            FileStatus::Error("Error 1".to_string()),
        );
        report.file_statuses.insert(
            PathBuf::from("bad2.md"),
            FileStatus::Error("Error 2".to_string()),
        );

        let problem_files = report.get_problem_files();
        assert_eq!(problem_files.len(), 2);
    }
}
