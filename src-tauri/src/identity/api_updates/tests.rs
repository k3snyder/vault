use super::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_is_uuid() {
    // Valid UUIDs
    assert!(is_uuid("550e8400-e29b-41d4-a716-446655440000"));
    assert!(is_uuid("123e4567-e89b-12d3-a456-426614174000"));
    assert!(is_uuid("01989bc3-9e68-7da0-bc92-a11ea799a03f"));

    // Invalid UUIDs
    assert!(!is_uuid("not-a-uuid"));
    assert!(!is_uuid("550e8400-e29b-41d4-a716")); // Too short
    assert!(!is_uuid("550e8400-e29b-41d4-a716-446655440000-extra")); // Too long
    assert!(!is_uuid("550e8400e29b41d4a716446655440000")); // No dashes
    assert!(!is_uuid("gggggggg-e29b-41d4-a716-446655440000")); // Invalid hex

    // Legacy IDs (SHA256 hashes) should not be recognized as UUIDs
    let legacy_id = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";
    assert!(!is_uuid(legacy_id));
}

#[test]
fn test_calculate_legacy_id() {
    let vault_id = "test-vault";
    let path = Path::new("/test/path/note.md");

    let id1 = ApiUpdateHelper::calculate_legacy_id(vault_id, path);
    let id2 = ApiUpdateHelper::calculate_legacy_id(vault_id, path);

    // Should be consistent
    assert_eq!(id1, id2);

    // Should be 64 characters (SHA256 hex)
    assert_eq!(id1.len(), 64);

    // Should be valid hex
    assert!(id1.chars().all(|c| c.is_ascii_hexdigit()));

    // Different paths should produce different IDs
    let path2 = Path::new("/test/path/other.md");
    let id3 = ApiUpdateHelper::calculate_legacy_id(vault_id, path2);
    assert_ne!(id1, id3);
}

#[tokio::test]
async fn test_ensure_note_id() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let helper = ApiUpdateHelper::new(identity_manager.clone());

    // Create a test file
    let note_path = vault_root.join("test.md");
    fs::write(&note_path, "# Test Note").unwrap();

    // Ensure ID is created
    let id1 = helper.ensure_note_id(&note_path).await.unwrap();

    // Should be a valid UUID
    assert!(is_uuid(&id1));

    // Should be consistent
    let id2 = helper.ensure_note_id(&note_path).await.unwrap();
    assert_eq!(id1, id2);
}

#[tokio::test]
async fn test_get_note_id() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let helper = ApiUpdateHelper::new(identity_manager.clone());

    // Create a test file
    let note_path = vault_root.join("test.md");
    fs::write(&note_path, "# Test Note").unwrap();

    // Initially should have no ID
    let id_opt = helper.get_note_id(&note_path).await.unwrap();
    assert!(id_opt.is_none());

    // Create an ID
    let id = helper.ensure_note_id(&note_path).await.unwrap();

    // Now should return the ID
    let id_opt = helper.get_note_id(&note_path).await.unwrap();
    assert_eq!(id_opt, Some(id));
}

#[tokio::test]
async fn test_resolve_id() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let helper = ApiUpdateHelper::new(identity_manager.clone());

    // UUID should be returned as-is
    let uuid = "550e8400-e29b-41d4-a716-446655440000";
    let resolved = helper.resolve_id(uuid, &vault_root).await.unwrap();
    assert_eq!(resolved, uuid);

    // Legacy ID (for now) returns as-is since we don't have mapping
    let legacy_id = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";
    let resolved = helper.resolve_id(legacy_id, &vault_root).await.unwrap();
    assert_eq!(resolved, legacy_id);

    // Unknown format returns as-is
    let unknown = "some-other-id";
    let resolved = helper.resolve_id(unknown, &vault_root).await.unwrap();
    assert_eq!(resolved, unknown);
}

#[tokio::test]
async fn test_update_to_uuid() {
    let temp_dir = TempDir::new().unwrap();
    let vault_root = temp_dir.path().to_path_buf();

    let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_root.clone())));

    let helper = ApiUpdateHelper::new(identity_manager.clone());

    // Create a test file
    let note_path = vault_root.join("test.md");
    fs::write(&note_path, "# Test Note").unwrap();

    // Old ID (path-based)
    let old_id = ApiUpdateHelper::calculate_legacy_id("test-vault", &note_path);

    // Update to UUID
    let new_id = helper.update_to_uuid(&note_path, &old_id).await.unwrap();

    // Should be a UUID
    assert!(is_uuid(&new_id));

    // Should be different from old ID
    assert_ne!(old_id, new_id);
}

#[test]
fn test_deprecation_warning() {
    // This test just ensures the deprecation warning compiles
    // In a real test environment, we'd capture stderr
    let legacy_id = "abc123";
    let new_uuid = "550e8400-e29b-41d4-a716-446655440000";

    // This should compile and run without panic
    log_deprecation_warning(legacy_id, new_uuid);
}
