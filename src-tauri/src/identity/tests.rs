use super::*;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use tempfile::TempDir;

#[test]
fn test_identity_manager_creation() {
    let temp_dir = TempDir::new().unwrap();
    let manager = IdentityManager::new(temp_dir.path().to_path_buf());

    assert_eq!(manager.vault_root, temp_dir.path());
}

#[test]
fn test_ensure_note_id_generates_new() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let test_file = temp_dir.path().join("test.md");
    fs::write(&test_file, "test content").unwrap();

    let id1 = manager.ensure_note_id(&test_file).unwrap();
    assert!(!id1.is_empty());
    assert_eq!(id1.len(), 36); // Standard UUID length

    // Ensure same file gets same ID
    let id2 = manager.ensure_note_id(&test_file).unwrap();
    assert_eq!(id1, id2);
}

#[test]
fn test_get_note_id() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let test_file = temp_dir.path().join("test.md");
    fs::write(&test_file, "test content").unwrap();

    // Should return None for new file
    assert!(manager.get_note_id(&test_file).unwrap().is_none());

    // Generate ID
    let id = manager.ensure_note_id(&test_file).unwrap();

    // Should return the ID
    assert_eq!(manager.get_note_id(&test_file).unwrap(), Some(id));
}

#[test]
fn test_ensure_note_id_preserves_existing_frontmatter_fields() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let test_file = temp_dir.path().join("existing-frontmatter.md");
    let original = concat!(
        "---\n",
        "title: Existing Note\n",
        "tags:\n",
        "  - inbox\n",
        "custom_flag: true\n",
        "---\n",
        "# Existing Note\n"
    );
    fs::write(&test_file, original).unwrap();

    let id = manager.ensure_note_id(&test_file).unwrap();
    let updated = fs::read_to_string(&test_file).unwrap();

    assert!(updated.contains(&format!("id: {}", id)));
    assert!(updated.contains("title: Existing Note"));
    assert!(updated.contains("custom_flag: true"));
    assert!(updated.contains("- inbox"));
    assert!(updated.contains("# Existing Note"));
}

#[tokio::test]
async fn test_update_note_path() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let old_path = temp_dir.path().join("old.md");
    let new_path = temp_dir.path().join("new.md");

    fs::write(&old_path, "test content").unwrap();

    // Generate ID for old path
    let id = manager.ensure_note_id(&old_path).unwrap();

    // Rename file
    fs::rename(&old_path, &new_path).unwrap();

    // Update path in manager
    manager
        .update_note_path(&old_path, &new_path)
        .await
        .unwrap();

    // Old path should no longer have ID
    assert!(manager.get_note_id(&old_path).unwrap().is_none());

    // New path should have same ID
    assert_eq!(manager.get_note_id(&new_path).unwrap(), Some(id));
}

#[test]
fn test_path_canonicalization() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    // Create nested directory
    let nested_dir = temp_dir.path().join("folder1").join("folder2");
    fs::create_dir_all(&nested_dir).unwrap();

    let file_path = nested_dir.join("test.md");
    fs::write(&file_path, "test content").unwrap();

    // Test with absolute path
    let id1 = manager.ensure_note_id(&file_path).unwrap();

    // Test with relative path from vault root
    let relative_path = Path::new("folder1/folder2/test.md");
    let id2 = manager.ensure_note_id(&relative_path).unwrap();

    assert_eq!(id1, id2);
}

#[test]
fn test_concurrent_id_generation() {
    let temp_dir = TempDir::new().unwrap();
    let manager = Arc::new(RwLock::new(IdentityManager::new(
        temp_dir.path().to_path_buf(),
    )));

    // Create test files
    let mut files = vec![];
    for i in 0..10 {
        let file_path = temp_dir.path().join(format!("test{}.md", i));
        fs::write(&file_path, format!("content {}", i)).unwrap();
        files.push(file_path);
    }

    let mut handles = vec![];
    let mut all_ids = vec![];

    for file_path in files {
        let manager_clone = manager.clone();
        let handle = thread::spawn(move || {
            let mut mgr = manager_clone.write();
            mgr.ensure_note_id(&file_path).unwrap()
        });
        handles.push(handle);
    }

    for handle in handles {
        all_ids.push(handle.join().unwrap());
    }

    // Check all IDs are unique
    let unique_ids: std::collections::HashSet<_> = all_ids.iter().collect();
    assert_eq!(unique_ids.len(), all_ids.len());
}

#[test]
fn test_cache_functionality() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let test_file = temp_dir.path().join("test.md");
    fs::write(&test_file, "test content").unwrap();

    // First call generates and caches
    let id1 = manager.ensure_note_id(&test_file).unwrap();

    // Second call should hit cache (verified by same ID)
    let id2 = manager.ensure_note_id(&test_file).unwrap();
    assert_eq!(id1, id2);

    // Cache should contain the entry
    assert!(manager.cache.read().len() > 0);
}

#[test]
fn test_unique_ids_for_different_files() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let file1 = temp_dir.path().join("file1.md");
    let file2 = temp_dir.path().join("file2.md");

    fs::write(&file1, "content 1").unwrap();
    fs::write(&file2, "content 2").unwrap();

    let id1 = manager.ensure_note_id(&file1).unwrap();
    let id2 = manager.ensure_note_id(&file2).unwrap();

    assert_ne!(id1, id2);
}

#[test]
fn test_handle_nonexistent_file() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let nonexistent = temp_dir.path().join("nonexistent.md");

    // Should still generate ID for nonexistent file
    let id = manager.ensure_note_id(&nonexistent).unwrap();
    assert!(!id.is_empty());
}

#[test]
fn test_path_with_special_characters() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    let special_file = temp_dir
        .path()
        .join("test file with spaces & special@chars!.md");
    fs::write(&special_file, "test content").unwrap();

    let id = manager.ensure_note_id(&special_file).unwrap();
    assert!(!id.is_empty());

    // Should handle the path correctly
    let retrieved_id = manager.get_note_id(&special_file).unwrap();
    assert_eq!(retrieved_id, Some(id));
}

#[test]
fn test_deeply_nested_paths() {
    let temp_dir = TempDir::new().unwrap();
    let mut manager = IdentityManager::new(temp_dir.path().to_path_buf());

    // Create deeply nested structure
    let deep_path = temp_dir
        .path()
        .join("level1")
        .join("level2")
        .join("level3")
        .join("level4")
        .join("level5");

    fs::create_dir_all(&deep_path).unwrap();

    let file_path = deep_path.join("deep_file.md");
    fs::write(&file_path, "deep content").unwrap();

    let id = manager.ensure_note_id(&file_path).unwrap();
    assert!(!id.is_empty());

    // Verify retrieval works
    assert_eq!(manager.get_note_id(&file_path).unwrap(), Some(id));
}
