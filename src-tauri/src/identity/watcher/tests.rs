use super::*;
use notify::Event;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;
use tokio::sync::mpsc;

#[tokio::test]
async fn test_watcher_config_defaults() {
    let config = WatcherConfig::default();
    assert_eq!(config.debounce_ms, 100);
    assert_eq!(config.rename_window_ms, 500);
    assert_eq!(config.cache_size, 1000);
    assert_eq!(config.debug, false);
}

#[tokio::test]
async fn test_file_metadata_creation() {
    let metadata = FileMetadata {
        path: PathBuf::from("/test/file.md"),
        id: "test-uuid".to_string(),
        deleted_at: Utc::now(),
        size: Some(1024),
        fingerprint: Some("md-1024".to_string()),
    };

    assert_eq!(metadata.path, PathBuf::from("/test/file.md"));
    assert_eq!(metadata.id, "test-uuid");
    assert!(metadata.size.is_some());
    assert_eq!(metadata.size.unwrap(), 1024);
}

#[tokio::test]
async fn test_watcher_creation() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let config = WatcherConfig::default();
    let watcher =
        IdentityWatcher::new(identity_manager.clone(), vault_root.clone(), config.clone());

    assert_eq!(watcher.vault_root, vault_root);
    assert_eq!(watcher.config.debounce_ms, config.debounce_ms);
}

#[tokio::test]
async fn test_fingerprint_calculation() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.md");
    fs::write(&file_path, "test content").unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(
        temp_dir.path().to_path_buf(),
    )));

    let watcher = IdentityWatcher::new(
        identity_manager,
        temp_dir.path().to_path_buf(),
        WatcherConfig::default(),
    );

    let fingerprint = watcher.calculate_fingerprint(&file_path);
    assert!(fingerprint.is_some());
    assert!(fingerprint.unwrap().contains("md-"));
}

#[tokio::test]
async fn test_file_size_calculation() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.txt");
    let content = "Hello, World!";
    fs::write(&file_path, content).unwrap();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(
        temp_dir.path().to_path_buf(),
    )));

    let watcher = IdentityWatcher::new(
        identity_manager,
        temp_dir.path().to_path_buf(),
        WatcherConfig::default(),
    );

    let size = watcher.get_file_size(&file_path);
    assert!(size.is_some());
    assert_eq!(size.unwrap(), content.len() as u64);
}

#[tokio::test]
async fn test_deletion_cache_integration() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut config = WatcherConfig::default();
    config.debug = true;

    let mut watcher = IdentityWatcher::new(identity_manager.clone(), vault_root.clone(), config);

    // Create a test file
    let file_path = vault_root.join("test.md");
    fs::write(&file_path, "test content").unwrap();

    // Ensure it has an ID
    {
        let mut manager = identity_manager.write();
        manager.ensure_note_id(&file_path).unwrap();
    }

    // Simulate deletion event
    let deletion_event = DebouncedEvent {
        event: Event {
            paths: vec![file_path.clone()],
            kind: EventKind::Remove(notify::event::RemoveKind::File),
            attrs: Default::default(),
        },
        time: std::time::Instant::now(),
    };

    watcher.handle_deletion(&deletion_event).await.unwrap();

    // Check that it was added to cache
    let cache_size = watcher.deletion_cache.read().len();
    assert_eq!(cache_size, 1);
}

#[tokio::test]
async fn test_rename_detection_flow() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut watcher = IdentityWatcher::new(
        identity_manager.clone(),
        vault_root.clone(),
        WatcherConfig::default(),
    );

    // Create original file
    let old_path = vault_root.join("old.md");
    let new_path = vault_root.join("new.md");
    fs::write(&old_path, "content").unwrap();

    // Ensure it has an ID
    let original_id = {
        let mut manager = identity_manager.write();
        manager.ensure_note_id(&old_path).unwrap()
    };

    // Simulate direct rename event
    let rename_event = DebouncedEvent {
        event: Event {
            paths: vec![old_path.clone(), new_path.clone()],
            kind: EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            attrs: Default::default(),
        },
        time: std::time::Instant::now(),
    };

    watcher.handle_rename(&rename_event).await.unwrap();

    // Verify the ID is preserved at new path
    {
        let mut manager = identity_manager.write();
        let new_id = manager.get_note_id(&new_path).unwrap();
        assert!(new_id.is_some());
        assert_eq!(new_id.unwrap(), original_id);
    }
}

#[tokio::test]
async fn test_delete_create_rename_pattern() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let mut config = WatcherConfig::default();
    config.rename_window_ms = 1000; // Longer window for test

    let mut watcher = IdentityWatcher::new(identity_manager.clone(), vault_root.clone(), config);

    // Create original file
    let old_path = vault_root.join("document.md");
    let new_path = vault_root.join("renamed.md");
    fs::write(&old_path, "content").unwrap();

    // Ensure it has an ID
    let original_id = {
        let mut manager = identity_manager.write();
        manager.ensure_note_id(&old_path).unwrap()
    };

    // Simulate deletion
    let delete_event = DebouncedEvent {
        event: Event {
            paths: vec![old_path.clone()],
            kind: EventKind::Remove(notify::event::RemoveKind::File),
            attrs: Default::default(),
        },
        time: std::time::Instant::now(),
    };

    watcher.handle_deletion(&delete_event).await.unwrap();

    // Simulate creation
    let create_event = DebouncedEvent {
        event: Event {
            paths: vec![new_path.clone()],
            kind: EventKind::Create(notify::event::CreateKind::File),
            attrs: Default::default(),
        },
        time: std::time::Instant::now(),
    };

    fs::write(&new_path, "content").unwrap();
    watcher.handle_creation(&create_event).await.unwrap();

    // Verify the ID is preserved at new path
    {
        let mut manager = identity_manager.write();
        let new_id = manager.get_note_id(&new_path).unwrap();
        assert!(new_id.is_some());
        assert_eq!(new_id.unwrap(), original_id);
    }
}
