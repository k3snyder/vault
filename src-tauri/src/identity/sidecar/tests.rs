use super::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_sidecar_path_calculation() {
    let file_path = Path::new("/home/user/documents/file.pdf");
    let sidecar = SidecarManager::sidecar_path(file_path);

    assert_eq!(
        sidecar,
        Path::new("/home/user/documents/.file.pdf.meta.json")
    );
}

#[test]
fn test_sidecar_path_no_extension() {
    let file_path = Path::new("/home/user/README");
    let sidecar = SidecarManager::sidecar_path(file_path);

    assert_eq!(sidecar, Path::new("/home/user/.README.meta.json"));
}

#[test]
fn test_should_use_sidecar() {
    assert!(!SidecarManager::should_use_sidecar(Path::new("file.md")));
    assert!(!SidecarManager::should_use_sidecar(Path::new(
        "file.markdown"
    )));
    assert!(SidecarManager::should_use_sidecar(Path::new("file.pdf")));
    assert!(SidecarManager::should_use_sidecar(Path::new("file.txt")));
    assert!(SidecarManager::should_use_sidecar(Path::new("file")));
}

#[test]
fn test_read_nonexistent_sidecar() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");

    let result = SidecarManager::read(&file_path).unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn test_write_and_read_sidecar() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");

    // Create the actual file
    fs::write(&file_path, b"PDF content").unwrap();

    let data = SidecarData::new(
        "test-uuid-123".to_string(),
        file_path.to_string_lossy().to_string(),
    );

    // Write sidecar
    SidecarManager::write(&file_path, &data).unwrap();

    // Verify sidecar file exists
    let sidecar_path = SidecarManager::sidecar_path(&file_path);
    assert!(sidecar_path.exists());

    // Read back
    let read_data = SidecarManager::read(&file_path).unwrap();
    assert!(read_data.is_some());

    let read_data = read_data.unwrap();
    assert_eq!(read_data.id, "test-uuid-123");
    assert_eq!(read_data.file_path, file_path.to_string_lossy());
}

#[tokio::test]
async fn test_update_sidecar() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");
    fs::write(&file_path, b"PDF content").unwrap();

    // Initial write
    let data = SidecarData::new(
        "test-uuid-123".to_string(),
        file_path.to_string_lossy().to_string(),
    );
    SidecarManager::write(&file_path, &data).unwrap();

    // Update
    SidecarManager::update(&file_path, |data| {
        data.legacy_ids = Some(vec!["old-id-1".to_string()]);
        data.file_hash = Some("hash123".to_string());
    })
    .unwrap();

    // Read and verify
    let updated = SidecarManager::read(&file_path).unwrap().unwrap();
    assert_eq!(updated.id, "test-uuid-123");
    assert_eq!(updated.legacy_ids, Some(vec!["old-id-1".to_string()]));
    assert_eq!(updated.file_hash, Some("hash123".to_string()));
    assert!(updated.updated_at > data.created_at);
}

#[test]
fn test_delete_sidecar() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");
    let sidecar_path = SidecarManager::sidecar_path(&file_path);

    // Create sidecar file
    let data = SidecarData::new(
        "test-uuid-123".to_string(),
        file_path.to_string_lossy().to_string(),
    );
    let json = serde_json::to_string(&data).unwrap();
    fs::write(&sidecar_path, json).unwrap();

    assert!(sidecar_path.exists());

    // Delete
    SidecarManager::delete(&file_path).unwrap();
    assert!(!sidecar_path.exists());
}

#[test]
fn test_rename_sidecar() {
    let temp_dir = TempDir::new().unwrap();
    let old_path = temp_dir.path().join("old.pdf");
    let new_path = temp_dir.path().join("new.pdf");

    // Create original file and sidecar
    fs::write(&old_path, b"PDF content").unwrap();
    let data = SidecarData::new(
        "test-uuid-123".to_string(),
        old_path.to_string_lossy().to_string(),
    );
    let json = serde_json::to_string_pretty(&data).unwrap();
    let old_sidecar = SidecarManager::sidecar_path(&old_path);
    fs::write(&old_sidecar, json).unwrap();

    // Rename file and sidecar
    fs::rename(&old_path, &new_path).unwrap();
    SidecarManager::rename(&old_path, &new_path).unwrap();

    // Verify
    let new_sidecar = SidecarManager::sidecar_path(&new_path);
    assert!(!old_sidecar.exists());
    assert!(new_sidecar.exists());

    let updated = SidecarManager::read(&new_path).unwrap().unwrap();
    assert_eq!(updated.id, "test-uuid-123");
    assert_eq!(updated.file_path, new_path.to_string_lossy());
}

#[test]
fn test_corrupted_sidecar_recovery() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");
    let sidecar_path = SidecarManager::sidecar_path(&file_path);

    // Write corrupted JSON
    fs::write(&sidecar_path, b"{ invalid json }").unwrap();

    // Should return None instead of erroring
    let result = SidecarManager::read(&file_path).unwrap();
    assert!(result.is_none());
}

#[test]
fn test_calculate_file_hash() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.txt");

    fs::write(&file_path, b"Hello, World!").unwrap();

    let hash = SidecarManager::calculate_file_hash(&file_path).unwrap();

    // SHA256 of "Hello, World!"
    assert_eq!(
        hash,
        "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"
    );
}

#[test]
fn test_cleanup_orphans() {
    let temp_dir = TempDir::new().unwrap();

    // Create orphaned sidecar
    let orphan_sidecar = temp_dir.path().join(".deleted.pdf.meta.json");
    fs::write(&orphan_sidecar, r#"{"id": "orphan"}"#).unwrap();

    // Create valid file and sidecar
    let valid_file = temp_dir.path().join("valid.pdf");
    let valid_sidecar = temp_dir.path().join(".valid.pdf.meta.json");
    fs::write(&valid_file, b"content").unwrap();
    fs::write(&valid_sidecar, r#"{"id": "valid"}"#).unwrap();

    // Clean up orphans
    let orphans = SidecarManager::cleanup_orphans(temp_dir.path()).unwrap();

    assert_eq!(orphans.len(), 1);
    assert!(orphans[0].ends_with(".deleted.pdf.meta.json"));
    assert!(!orphan_sidecar.exists());
    assert!(valid_sidecar.exists());
}

#[test]
fn test_unicode_in_sidecar() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("文档.pdf");

    let mut data = SidecarData::new(
        "test-uuid-123".to_string(),
        file_path.to_string_lossy().to_string(),
    );
    data.legacy_ids = Some(vec!["旧的-ID-🦀".to_string()]);

    let json = serde_json::to_string_pretty(&data).unwrap();
    assert!(json.contains("文档.pdf"));
    assert!(json.contains("旧的-ID-🦀"));
}
