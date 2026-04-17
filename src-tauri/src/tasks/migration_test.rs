#[cfg(test)]
mod task_migration_tests {
    use super::*;
    use crate::identity::IdentityManager;
    use crate::tasks::migration::{
        TaskFileStatus, TaskMigrationConfig, TaskMigrationManager, TaskMigrationReport,
    };
    use parking_lot::RwLock;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use tempfile::TempDir;

    fn setup_test_vault() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let vault_path = temp_dir.path().to_path_buf();

        // Create test files with tasks
        let files = vec![
            ("note1.md", "# Note 1\n- [ ] Task without ID\n- [ ] Another task\nSome content"),
            ("note2.md", "# Note 2\n- [ ] Task with ID <!-- tid: 01234567-89ab-cdef-0123-456789abcdef -->\n- [ ] New task"),
            ("folder/note3.md", "# Note 3\n- [x] Completed task\n- [ ] Open task @due(2025-01-20) +project #tag"),
            ("empty.md", "# Empty\n\nNo tasks here"),
        ];

        for (path, content) in files {
            let full_path = vault_path.join(path);
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(full_path, content).unwrap();
        }

        (temp_dir, vault_path)
    }

    #[tokio::test]
    async fn test_task_migration_dry_run() {
        let (_temp_dir, vault_path) = setup_test_vault();
        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: true,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: true,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();

        // Verify dry-run report
        assert_eq!(report.total_files, 4);
        assert_eq!(report.total_tasks, 6);
        assert_eq!(report.tasks_needing_ids, 5);
        assert_eq!(report.tasks_with_ids, 1);
        assert!(report.is_dry_run);
        assert_eq!(report.tasks_migrated, 0); // No actual migrations in dry-run

        // Check that files haven't been modified
        let content = fs::read_to_string(vault_path.join("note1.md")).unwrap();
        assert!(!content.contains("<!-- tid:"));
    }

    #[tokio::test]
    async fn test_task_migration_actual() {
        let (_temp_dir, vault_path) = setup_test_vault();
        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: true,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();

        // Verify actual migration report
        assert_eq!(report.total_files, 4);
        assert_eq!(report.total_tasks, 6);
        assert_eq!(report.tasks_migrated, 5);
        assert_eq!(report.tasks_skipped, 1); // One already has ID
        assert_eq!(report.files_modified, 3); // 3 files had tasks to migrate

        // Verify task IDs were added
        let content = fs::read_to_string(vault_path.join("note1.md")).unwrap();
        assert!(content.contains("<!-- tid:"));
        assert_eq!(content.matches("<!-- tid:").count(), 2);

        // Verify existing IDs weren't changed
        let content2 = fs::read_to_string(vault_path.join("note2.md")).unwrap();
        assert!(content2.contains("<!-- tid: 01234567-89ab-cdef-0123-456789abcdef -->"));
    }

    #[tokio::test]
    async fn test_task_migration_idempotency() {
        let (_temp_dir, vault_path) = setup_test_vault();
        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: true,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config.clone());

        // First migration
        let report1 = manager.migrate().await.unwrap();
        assert_eq!(report1.tasks_migrated, 5);

        // Second migration - should be idempotent
        let mut manager2 =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);
        let report2 = manager2.migrate().await.unwrap();
        assert_eq!(report2.tasks_migrated, 0);
        assert_eq!(report2.tasks_skipped, 6); // All tasks now have IDs
    }

    #[tokio::test]
    async fn test_task_property_extraction() {
        let temp_dir = TempDir::new().unwrap();
        let vault_path = temp_dir.path().to_path_buf();

        // Create file with task containing properties
        let content = "- [ ] Task with properties @due(2025-01-20) @project(MyProject) #tag !high";
        fs::write(vault_path.join("test.md"), content).unwrap();

        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: true,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();
        assert_eq!(report.tasks_migrated, 1);
        assert_eq!(report.properties_extracted.get("due"), Some(&1));
        assert_eq!(report.properties_extracted.get("project"), Some(&1));
        assert_eq!(report.properties_extracted.get("tags"), Some(&1));
        assert_eq!(report.properties_extracted.get("priority"), Some(&1));

        // Verify task ID was added
        let content = fs::read_to_string(vault_path.join("test.md")).unwrap();
        assert!(content.contains("<!-- tid:"));
    }

    #[tokio::test]
    async fn test_parallel_processing() {
        let (_temp_dir, vault_path) = setup_test_vault();

        // Create many files to test parallel processing
        for i in 0..20 {
            let content = format!("# File {}\n- [ ] Task {}\n- [ ] Another task", i, i);
            fs::write(vault_path.join(format!("file{}.md", i)), content).unwrap();
        }

        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 4,
            skip_existing: true,
            include_properties: false,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let start = std::time::Instant::now();
        let report = manager.migrate().await.unwrap();
        let duration = start.elapsed();

        assert_eq!(report.total_files, 24);
        assert!(report.tasks_migrated > 40);

        // Parallel processing should be faster than serial
        // With 4 parallel workers, should complete faster
        assert!(
            duration.as_secs() < 5,
            "Migration took too long: {:?}",
            duration
        );
    }

    #[tokio::test]
    async fn test_rollback_capability() {
        let (_temp_dir, vault_path) = setup_test_vault();
        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: true,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        // Get original content
        let original = fs::read_to_string(vault_path.join("note1.md")).unwrap();

        // Perform migration with backup
        let report = manager.migrate_with_backup().await.unwrap();
        assert!(report.backup_created);
        assert!(report.backup_path.is_some());

        // Content should be modified
        let modified = fs::read_to_string(vault_path.join("note1.md")).unwrap();
        assert_ne!(original, modified);
        assert!(modified.contains("<!-- tid:"));

        // Rollback
        manager.rollback(&report).await.unwrap();

        // Content should be restored
        let restored = fs::read_to_string(vault_path.join("note1.md")).unwrap();
        assert_eq!(original, restored);
    }

    #[tokio::test]
    async fn test_migration_report_statistics() {
        let (_temp_dir, vault_path) = setup_test_vault();
        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: true,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: true,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();

        // Check report statistics
        assert_eq!(report.total_files, 4);
        assert_eq!(report.total_tasks, 6);
        assert_eq!(report.tasks_with_ids, 1);
        assert_eq!(report.tasks_needing_ids, 5);
        assert_eq!(report.completed_tasks, 1); // One [x] task
        assert_eq!(report.open_tasks, 5); // Five [ ] tasks

        // Check file status details
        assert_eq!(report.file_statuses.len(), 4);

        // Generate summary
        let summary = report.generate_summary();
        assert!(summary.contains("Total files scanned: 4"));
        assert!(summary.contains("Total tasks found: 6"));
        assert!(summary.contains("Tasks needing IDs: 5"));
    }

    #[tokio::test]
    async fn test_skip_hidden_and_temp_files() {
        let temp_dir = TempDir::new().unwrap();
        let vault_path = temp_dir.path().to_path_buf();

        // Create various files
        fs::write(vault_path.join("normal.md"), "- [ ] Task").unwrap();
        fs::write(vault_path.join(".hidden.md"), "- [ ] Hidden task").unwrap();
        fs::write(vault_path.join("file.tmp"), "- [ ] Temp task").unwrap();
        fs::write(vault_path.join("file.bak"), "- [ ] Backup task").unwrap();

        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: false,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();

        // Should only process normal.md
        assert_eq!(report.total_files, 1);
        assert_eq!(report.tasks_migrated, 1);
        assert_eq!(report.files_skipped, 0);
    }

    #[tokio::test]
    async fn test_error_handling_and_recovery() {
        let temp_dir = TempDir::new().unwrap();
        let vault_path = temp_dir.path().to_path_buf();

        // Create a file with read-only permissions after initial creation
        let file_path = vault_path.join("readonly.md");
        fs::write(&file_path, "- [ ] Task").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = fs::metadata(&file_path).unwrap();
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o444); // Read-only
            fs::set_permissions(&file_path, permissions).unwrap();
        }

        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));

        let config = TaskMigrationConfig {
            dry_run: false,
            show_progress: false,
            parallel_limit: 1,
            skip_existing: true,
            include_properties: false,
        };

        let mut manager =
            TaskMigrationManager::new(identity_manager.clone(), vault_path.clone(), config);

        let report = manager.migrate().await.unwrap();

        // Should handle error gracefully
        assert_eq!(report.error_count, 1);
        assert_eq!(report.errors.len(), 1);
        assert!(report.errors[0].contains("readonly.md"));
    }
}
