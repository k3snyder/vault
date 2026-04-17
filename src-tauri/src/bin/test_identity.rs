use std::env;
use vault::identity::{uuid::UuidGenerator, IdentityManager};

#[tokio::main]
async fn main() {
    println!("Testing Identity Module...\n");

    // Test UUID generation
    println!("Testing UUID Generation:");
    let generator = UuidGenerator::new();
    let uuid1 = generator.generate().unwrap();
    let uuid2 = generator.generate().unwrap();
    println!("  Generated UUID 1: {}", uuid1);
    println!("  Generated UUID 2: {}", uuid2);
    assert_ne!(uuid1, uuid2, "UUIDs should be unique");
    println!("  ✓ UUIDs are unique");

    // Test timestamp extraction
    let timestamp = generator.extract_timestamp(&uuid1).unwrap();
    println!("  Extracted timestamp: {}", timestamp);
    println!("  ✓ Timestamp extraction works\n");

    // Test Identity Manager
    println!("Testing Identity Manager:");
    let temp_dir = env::temp_dir().join(format!("vault_test_{}", uuid1));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let mut manager = IdentityManager::new(temp_dir.clone());

    // Create test files
    let file1 = temp_dir.join("note1.md");
    let file2 = temp_dir.join("note2.md");
    std::fs::write(&file1, "content 1").unwrap();
    std::fs::write(&file2, "content 2").unwrap();

    // Test ensure_note_id
    let id1 = manager.ensure_note_id(&file1).unwrap();
    let id2 = manager.ensure_note_id(&file2).unwrap();
    println!("  File 1 ID: {}", id1);
    println!("  File 2 ID: {}", id2);
    assert_ne!(id1, id2, "Different files should have different IDs");
    println!("  ✓ Different files have unique IDs");

    // Test ID persistence
    let id1_again = manager.ensure_note_id(&file1).unwrap();
    assert_eq!(id1, id1_again, "Same file should return same ID");
    println!("  ✓ IDs are persistent for same file");

    // Test get_note_id
    let retrieved_id = manager.get_note_id(&file1).unwrap();
    assert_eq!(retrieved_id, Some(id1.clone()));
    println!("  ✓ get_note_id returns correct ID");

    // Test update_note_path
    let new_path = temp_dir.join("renamed.md");

    println!(
        "  Before rename - ID for file1: {:?}",
        manager.get_note_id(&file1).unwrap()
    );

    std::fs::rename(&file1, &new_path).unwrap();
    manager.update_note_path(&file1, &new_path).await.unwrap();

    let old_id = manager.get_note_id(&file1).unwrap();
    println!("  After update - ID for old path: {:?}", old_id);

    let new_id = manager.get_note_id(&new_path).unwrap();
    println!("  After update - ID for new path: {:?}", new_id);

    assert!(old_id.is_none(), "Old path should have no ID");
    assert_eq!(
        new_id,
        Some(id1.clone()),
        "New path should have original ID"
    );
    println!("  ✓ Path updates work correctly\n");

    // Test front matter persistence
    println!("Testing Front Matter Persistence:");
    let md_file = temp_dir.join("note_with_fm.md");
    std::fs::write(&md_file, "# Test Note\n\nContent here").unwrap();

    let fm_id = manager.ensure_note_id(&md_file).unwrap();
    println!("  Generated ID for markdown: {}", fm_id);

    // Read file and verify front matter was added
    let content = std::fs::read_to_string(&md_file).unwrap();
    assert!(content.starts_with("---\n"), "Should have front matter");
    assert!(content.contains(&fm_id), "Should contain the UUID");
    println!("  ✓ Front matter written to markdown file");

    // Test sidecar persistence
    println!("\nTesting Sidecar Persistence:");
    let pdf_file = temp_dir.join("document.pdf");
    std::fs::write(&pdf_file, b"PDF content").unwrap();

    let sidecar_id = manager.ensure_note_id(&pdf_file).unwrap();
    println!("  Generated ID for PDF: {}", sidecar_id);

    // Check sidecar file exists
    let sidecar_path = temp_dir.join(".document.pdf.meta.json");
    assert!(sidecar_path.exists(), "Sidecar file should exist");

    let sidecar_content = std::fs::read_to_string(&sidecar_path).unwrap();
    assert!(
        sidecar_content.contains(&sidecar_id),
        "Sidecar should contain UUID"
    );
    println!("  ✓ Sidecar file created for non-markdown file");

    // Cleanup
    std::fs::remove_dir_all(&temp_dir).ok();

    println!("\nAll tests passed! ✅");
}
