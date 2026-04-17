use super::*;
use std::fs;
use tempfile::TempDir;
use tokio;

#[tokio::test]
async fn test_migration_empty_vault() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = MigrationConfig::default();
    let mut migrator = MigrationManager::new(identity_manager, vault_root.clone(), config);

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 0);
    assert_eq!(report.migrated_count, 0);
    assert!(report.is_successful());
}

#[tokio::test]
async fn test_migration_with_markdown_files() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create some markdown files without UUIDs
    fs::write(vault_root.join("note1.md"), "# Note 1\nContent").unwrap();
    fs::write(vault_root.join("note2.md"), "# Note 2\nContent").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = MigrationConfig::default();
    let mut migrator = MigrationManager::new(identity_manager.clone(), vault_root.clone(), config);

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 2);
    assert_eq!(report.migrated_count, 2);
    assert_eq!(report.error_count, 0);

    // Verify UUIDs were added
    let content1 = fs::read_to_string(vault_root.join("note1.md")).unwrap();
    assert!(content1.contains("id:"));

    let content2 = fs::read_to_string(vault_root.join("note2.md")).unwrap();
    assert!(content2.contains("id:"));
}

#[tokio::test]
async fn test_migration_skip_existing_uuids() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create a file with existing UUID
    let existing_content = r#"---
id: existing-uuid-12345
---
# Note with UUID"#;
    fs::write(vault_root.join("existing.md"), existing_content).unwrap();

    // Create a file without UUID
    fs::write(vault_root.join("new.md"), "# New Note").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = MigrationConfig {
        skip_existing: true,
        ..Default::default()
    };

    let mut migrator = MigrationManager::new(identity_manager, vault_root.clone(), config);

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 2);
    assert_eq!(report.migrated_count, 1);
    assert_eq!(report.already_had_id, 1);
}

#[tokio::test]
async fn test_migration_dry_run() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create test files
    fs::write(vault_root.join("note1.md"), "# Note 1").unwrap();
    fs::write(vault_root.join("note2.md"), "# Note 2").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = MigrationConfig {
        dry_run: true,
        ..Default::default()
    };

    let mut migrator = MigrationManager::new(identity_manager, vault_root.clone(), config);

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 2);
    assert!(!report.dry_run_changes.is_empty());

    // Verify files were not actually modified
    let content1 = fs::read_to_string(vault_root.join("note1.md")).unwrap();
    assert!(!content1.contains("id:"));
}

#[tokio::test]
async fn test_migration_with_subdirectories() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create nested structure
    let subdir1 = vault_root.join("folder1");
    let subdir2 = vault_root.join("folder1/folder2");
    fs::create_dir_all(&subdir2).unwrap();

    fs::write(vault_root.join("root.md"), "Root note").unwrap();
    fs::write(subdir1.join("sub1.md"), "Sub 1").unwrap();
    fs::write(subdir2.join("sub2.md"), "Sub 2").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut migrator = MigrationManager::new(
        identity_manager,
        vault_root.clone(),
        MigrationConfig::default(),
    );

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 3);
    assert_eq!(report.migrated_count, 3);
}

#[tokio::test]
async fn test_migration_skip_hidden_files() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create visible and hidden files
    fs::write(vault_root.join("visible.md"), "Visible").unwrap();
    fs::write(vault_root.join(".hidden.md"), "Hidden").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut migrator = MigrationManager::new(
        identity_manager,
        vault_root.clone(),
        MigrationConfig::default(),
    );

    let report = migrator.migrate().await.unwrap();

    // Hidden file should not be in the scan results
    assert_eq!(report.total_files, 1);
}

#[tokio::test]
async fn test_migration_with_non_markdown_files() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create various file types
    fs::write(vault_root.join("note.md"), "Markdown").unwrap();
    fs::write(vault_root.join("text.txt"), "Text file").unwrap();
    fs::write(vault_root.join("image.png"), vec![0u8; 100]).unwrap();
    fs::write(vault_root.join("document.pdf"), vec![0u8; 200]).unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut migrator = MigrationManager::new(
        identity_manager,
        vault_root.clone(),
        MigrationConfig::default(),
    );

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 4);
    assert_eq!(report.migrated_count, 4);

    // Check that sidecar files were created for non-markdown
    assert!(vault_root.join(".text.txt.meta.json").exists());
    assert!(vault_root.join(".image.png.meta.json").exists());
    assert!(vault_root.join(".document.pdf.meta.json").exists());
}

#[tokio::test]
async fn test_migration_with_legacy_ids() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    fs::write(vault_root.join("note.md"), "# Note").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = MigrationConfig {
        include_legacy_ids: true,
        ..Default::default()
    };

    let mut migrator = MigrationManager::new(identity_manager, vault_root.clone(), config);

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.migrated_count, 1);
    // Legacy IDs should be calculated but implementation of storage is pending
}

#[tokio::test]
async fn test_migration_error_handling() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create a read-only file (simulate permission error)
    let readonly_file = vault_root.join("readonly.md");
    fs::write(&readonly_file, "Read only").unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&readonly_file).unwrap().permissions();
        perms.set_mode(0o444); // Read-only
        fs::set_permissions(&readonly_file, perms).unwrap();
    }

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut migrator = MigrationManager::new(
        identity_manager,
        vault_root.clone(),
        MigrationConfig::default(),
    );

    let report = migrator.migrate().await.unwrap();

    // Should handle the error gracefully
    assert!(report.error_count > 0 || report.migrated_count > 0);
}

#[tokio::test]
async fn test_migration_report_generation() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    fs::write(vault_root.join("test.md"), "Test").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut migrator = MigrationManager::new(
        identity_manager,
        vault_root.clone(),
        MigrationConfig::default(),
    );

    let mut report = migrator.migrate().await.unwrap();
    report.complete();

    // Test summary generation
    let summary = report.summary();
    assert!(summary.contains("Migration Report"));
    assert!(summary.contains("Total files found"));

    // Test JSON export
    let json = report.to_json().unwrap();
    assert!(json.contains("\"total_files\""));

    // Test CSV export
    let csv = report.to_csv();
    assert!(csv.contains("File Path,Status"));
}

#[tokio::test]
async fn test_migration_concurrent_processing() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    // Create multiple files
    for i in 0..10 {
        fs::write(
            vault_root.join(format!("note{}.md", i)),
            format!("Note {}", i),
        )
        .unwrap();
    }

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = MigrationConfig {
        parallel_limit: 4,
        ..Default::default()
    };

    let mut migrator = MigrationManager::new(identity_manager, vault_root.clone(), config);

    let report = migrator.migrate().await.unwrap();

    assert_eq!(report.total_files, 10);
    assert_eq!(report.migrated_count, 10);
}
