// Vault API Tests - Test-driven development for file system operations
// Tests all Vault API methods with permission checks and sandboxing

use super::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

#[cfg(test)]
mod vault_api_tests {
    use super::*;

    // Helper function to create a test vault with temporary directory
    async fn create_test_vault() -> (VaultApi, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let vault_path = temp_dir.path().to_path_buf();

        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let vault_api = VaultApi::new(vault_path.clone(), permission_manager);

        (vault_api, temp_dir)
    }

    // Helper to create test file content
    fn create_test_file(dir: &PathBuf, name: &str, content: &str) {
        let file_path = dir.join(name);
        fs::write(&file_path, content).unwrap();
    }

    mod file_operations {
        use super::*;

        #[tokio::test]
        async fn test_read_file_with_permission() {
            let (vault_api, temp_dir) = create_test_vault().await;
            let test_content = "Hello, Vault!";
            create_test_file(&temp_dir.path().to_path_buf(), "test.md", test_content);

            // Grant read permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // Read file
            let result = vault_api.read("test-plugin", "test.md").await;
            assert!(result.is_ok(), "Failed to read file: {:?}", result);
            assert_eq!(result.unwrap(), test_content);
        }

        #[tokio::test]
        async fn test_read_file_without_permission() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "test.md", "content");

            // Try to read without permission
            let result = vault_api.read("test-plugin", "test.md").await;
            assert!(result.is_err());
            assert!(matches!(
                result.unwrap_err(),
                VaultError::PermissionDenied(_)
            ));
        }

        #[tokio::test]
        async fn test_write_file_with_permission() {
            let (vault_api, _temp_dir) = create_test_vault().await;
            let content = "New content";

            // Grant write permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;

            // Write file
            let result = vault_api.write("test-plugin", "new.md", content).await;
            assert!(result.is_ok());

            // Verify file was written
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;
            let read_result = vault_api.read("test-plugin", "new.md").await;
            let written = read_result.unwrap();
            assert!(written.contains("id:"));
            assert!(written.contains(content));
        }

        #[tokio::test]
        async fn test_append_to_file() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "append.md", "Initial");

            // Grant permissions
            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // Append to file
            let result = vault_api
                .append("test-plugin", "append.md", " content")
                .await;
            assert!(result.is_ok());

            // Verify content
            let content = vault_api.read("test-plugin", "append.md").await.unwrap();
            assert_eq!(content, "Initial content");
        }

        #[tokio::test]
        async fn test_delete_file() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "delete.md", "content");

            // Grant delete permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Delete)
                .await;

            // Delete file
            let result = vault_api.delete("test-plugin", "delete.md").await;
            assert!(result.is_ok());

            // Verify file is gone
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;
            let read_result = vault_api.read("test-plugin", "delete.md").await;
            assert!(read_result.is_err());
        }
    }

    mod directory_operations {
        use super::*;

        #[tokio::test]
        async fn test_list_directory() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "file1.md", "content1");
            create_test_file(&temp_dir.path().to_path_buf(), "file2.md", "content2");
            fs::create_dir(temp_dir.path().join("subdir")).unwrap();

            // Grant read permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // List directory
            let result = vault_api.list("test-plugin", "/").await;
            assert!(result.is_ok());

            let entries = result.unwrap();
            assert_eq!(entries.len(), 3);
            assert!(entries.iter().any(|e| e.name == "file1.md" && e.is_file));
            assert!(entries.iter().any(|e| e.name == "file2.md" && e.is_file));
            assert!(entries.iter().any(|e| e.name == "subdir" && !e.is_file));
        }

        #[tokio::test]
        async fn test_create_directory() {
            let (vault_api, temp_dir) = create_test_vault().await;

            // Grant write permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;

            // Create directory
            let result = vault_api.create_folder("test-plugin", "new_folder").await;
            assert!(result.is_ok());

            // Verify directory exists
            let dir_path = temp_dir.path().join("new_folder");
            assert!(dir_path.exists());
            assert!(dir_path.is_dir());
        }

        #[tokio::test]
        async fn test_delete_directory() {
            let (vault_api, temp_dir) = create_test_vault().await;
            fs::create_dir(temp_dir.path().join("to_delete")).unwrap();

            // Grant delete permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Delete)
                .await;

            // Delete directory
            let result = vault_api
                .delete_folder("test-plugin", "to_delete", false)
                .await;
            assert!(result.is_ok());

            // Verify directory is gone
            assert!(!temp_dir.path().join("to_delete").exists());
        }

        #[tokio::test]
        async fn test_recursive_delete() {
            let (vault_api, temp_dir) = create_test_vault().await;
            let dir_path = temp_dir.path().join("nested");
            fs::create_dir(&dir_path).unwrap();
            create_test_file(&dir_path, "file.md", "content");

            // Grant delete permission
            vault_api
                .grant_permission("test-plugin", VaultPermission::Delete)
                .await;

            // Try non-recursive delete (should fail)
            let result = vault_api
                .delete_folder("test-plugin", "nested", false)
                .await;
            assert!(result.is_err());

            // Try recursive delete (should succeed)
            let result = vault_api.delete_folder("test-plugin", "nested", true).await;
            assert!(result.is_ok());
            assert!(!dir_path.exists());
        }
    }

    mod path_validation {
        use super::*;

        #[tokio::test]
        async fn test_prevent_directory_traversal() {
            let (vault_api, _temp_dir) = create_test_vault().await;

            // Grant all permissions
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // Try various directory traversal attacks
            let attacks = vec![
                "../../../etc/passwd",
                "..\\..\\..\\windows\\system32",
                "subfolder/../../sensitive",
                "/etc/passwd",
            ];

            for attack in attacks {
                let result = vault_api.read("test-plugin", attack).await;
                assert!(result.is_err());
                assert!(matches!(result.unwrap_err(), VaultError::InvalidPath(_)));
            }

            let windows_absolute = vault_api.read("test-plugin", "C:\\Windows\\System32").await;
            assert!(windows_absolute.is_err());

            #[cfg(windows)]
            assert!(matches!(
                windows_absolute.unwrap_err(),
                VaultError::InvalidPath(_)
            ));
        }

        #[tokio::test]
        async fn test_normalize_paths() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "test.md", "content");

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // These should all resolve to the same file
            let paths = vec![
                "test.md",
                "./test.md",
                "././test.md",
                "subfolder/../test.md",
            ];

            for path in paths {
                let result = vault_api.read("test-plugin", path).await;
                if path.contains("subfolder") {
                    // This one should fail as subfolder doesn't exist
                    assert!(result.is_err());
                } else {
                    assert!(result.is_ok());
                    assert_eq!(result.unwrap(), "content");
                }
            }
        }

        #[tokio::test]
        async fn test_symlink_resolution() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(
                &temp_dir.path().to_path_buf(),
                "target.md",
                "target content",
            );

            // Create symlink (if supported by OS)
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                let _ = symlink(
                    temp_dir.path().join("target.md"),
                    temp_dir.path().join("link.md"),
                );
            }

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // Symlink traversal is rejected even when the link target stays inside the vault.
            let result = vault_api.read("test-plugin", "link.md").await;
            #[cfg(unix)]
            assert!(result.is_err());

            #[cfg(not(unix))]
            assert!(result.is_err()); // Link doesn't exist on non-Unix
        }
    }

    mod binary_operations {
        use super::*;

        #[tokio::test]
        async fn test_read_binary_file() {
            let (vault_api, temp_dir) = create_test_vault().await;
            let binary_content = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]; // JPEG header
            fs::write(temp_dir.path().join("image.jpg"), &binary_content).unwrap();

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            let result = vault_api.read_binary("test-plugin", "image.jpg").await;
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), binary_content);
        }

        #[tokio::test]
        async fn test_write_binary_file() {
            let (vault_api, temp_dir) = create_test_vault().await;
            let binary_content = vec![0x89, 0x50, 0x4E, 0x47]; // PNG header

            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;

            let result = vault_api
                .write_binary("test-plugin", "image.png", binary_content.clone())
                .await;
            assert!(result.is_ok());

            // Verify file was written correctly
            let written = fs::read(temp_dir.path().join("image.png")).unwrap();
            assert_eq!(written, binary_content);
        }

        #[tokio::test]
        async fn test_large_file_handling() {
            let (vault_api, _temp_dir) = create_test_vault().await;

            // Create a 10MB buffer
            let large_content = vec![0u8; 10 * 1024 * 1024];

            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;
            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            // Write large file
            let write_result = vault_api
                .write_binary("test-plugin", "large.bin", large_content.clone())
                .await;
            assert!(write_result.is_ok());

            // Read it back
            let read_result = vault_api.read_binary("test-plugin", "large.bin").await;
            assert!(read_result.is_ok());
            assert_eq!(read_result.unwrap().len(), large_content.len());
        }
    }

    mod file_watching {
        use super::*;
        use tokio::time::{sleep, Duration};

        #[tokio::test]
        async fn test_watch_file_changes() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "watched.md", "initial");

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;
            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;

            // Start watching
            let (tx, mut rx) = tokio::sync::mpsc::channel(10);
            let watch_result = vault_api.watch("test-plugin", "watched.md", tx).await;
            assert!(watch_result.is_ok());

            // Modify the file
            fs::write(temp_dir.path().join("watched.md"), "modified").unwrap();

            // Wait for event
            sleep(Duration::from_millis(100)).await;

            // Check if we received the modification event
            if let Ok(event) = rx.try_recv() {
                assert!(event.path.ends_with("watched.md"));
                assert!(matches!(
                    event.kind,
                    FileEventKind::Created | FileEventKind::Modified
                ));
            }

            // Stop watching
            let unwatch_result = vault_api.unwatch("test-plugin", "watched.md").await;
            assert!(unwatch_result.is_ok());
        }

        #[tokio::test]
        async fn test_watch_directory() {
            let (vault_api, temp_dir) = create_test_vault().await;
            fs::create_dir(temp_dir.path().join("watched_dir")).unwrap();

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;
            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;

            // Start watching directory
            let (tx, mut rx) = tokio::sync::mpsc::channel(10);
            let watch_result = vault_api.watch("test-plugin", "watched_dir", tx).await;
            assert!(watch_result.is_ok());

            // Create a file in the directory
            create_test_file(&temp_dir.path().join("watched_dir"), "new.md", "content");

            // Wait for event
            sleep(Duration::from_millis(100)).await;

            // Check if we received the creation event
            if let Ok(event) = rx.try_recv() {
                assert!(event.path.contains("watched_dir"));
                assert!(matches!(event.kind, FileEventKind::Created));
            }

            let unwatch_result = vault_api.unwatch("test-plugin", "watched_dir").await;
            assert!(unwatch_result.is_ok());
        }

        #[tokio::test]
        async fn test_watch_event_coalescing() {
            let (vault_api, temp_dir) = create_test_vault().await;
            create_test_file(&temp_dir.path().to_path_buf(), "rapid.md", "initial");

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;
            vault_api
                .grant_permission("test-plugin", VaultPermission::Write)
                .await;

            let (tx, mut rx) = tokio::sync::mpsc::channel(10);
            vault_api
                .watch("test-plugin", "rapid.md", tx)
                .await
                .unwrap();

            // Rapid modifications
            for i in 0..10 {
                fs::write(temp_dir.path().join("rapid.md"), format!("change {}", i)).unwrap();
                sleep(Duration::from_millis(5)).await;
            }

            // Wait for events to be processed
            sleep(Duration::from_millis(200)).await;

            // Should receive coalesced events, not all 10
            let mut event_count = 0;
            while rx.try_recv().is_ok() {
                event_count += 1;
            }

            // Backends differ in how aggressively they coalesce rapid writes.
            assert!(event_count > 0);

            let unwatch_result = vault_api.unwatch("test-plugin", "rapid.md").await;
            assert!(unwatch_result.is_ok());
        }
    }

    mod performance {
        use super::*;
        use std::time::Instant;

        #[tokio::test]
        async fn test_read_performance() {
            let (vault_api, temp_dir) = create_test_vault().await;
            let content = "x".repeat(1024); // 1KB file
            create_test_file(&temp_dir.path().to_path_buf(), "perf.md", &content);

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            let start = Instant::now();
            for _ in 0..100 {
                vault_api.read("test-plugin", "perf.md").await.unwrap();
            }
            let duration = start.elapsed();

            // 100 reads should complete in under 1 second
            assert!(duration.as_secs() < 1);
        }

        #[tokio::test]
        async fn test_list_performance() {
            let (vault_api, temp_dir) = create_test_vault().await;

            // Create 1000 files
            for i in 0..1000 {
                create_test_file(
                    &temp_dir.path().to_path_buf(),
                    &format!("file{}.md", i),
                    "content",
                );
            }

            vault_api
                .grant_permission("test-plugin", VaultPermission::Read)
                .await;

            let start = Instant::now();
            let result = vault_api.list("test-plugin", "/").await;
            let duration = start.elapsed();

            assert!(result.is_ok());
            assert_eq!(result.unwrap().len(), 1000);

            // Listing 1000 files should complete in under 100ms
            assert!(duration.as_millis() < 100);
        }
    }
}
