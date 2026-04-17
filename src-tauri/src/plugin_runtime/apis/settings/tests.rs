// Settings/Storage API Tests - Test-driven development for plugin data persistence
// Tests all Settings API methods for plugin configuration and data storage

use super::*;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::RwLock;

#[cfg(test)]
mod settings_api_tests {
    use super::*;

    // Helper function to create a test settings API with temporary storage
    async fn create_test_settings() -> (SettingsApi, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let settings_api = SettingsApi::new(storage_path, permission_manager);

        (settings_api, temp_dir)
    }

    // Helper to grant permissions for testing
    async fn grant_settings_permission(
        api: &SettingsApi,
        plugin_id: &str,
        permission: SettingsPermission,
    ) {
        api.grant_permission(plugin_id, permission).await;
    }

    mod basic_storage {
        use super::*;

        #[tokio::test]
        async fn test_set_and_get_value() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Set a value
            let result = settings.set("test-plugin", "key1", "value1").await;
            assert!(result.is_ok());

            // Get the value
            let value = settings.get("test-plugin", "key1").await;
            assert!(value.is_ok());
            assert_eq!(value.unwrap(), Some("value1".to_string()));
        }

        #[tokio::test]
        async fn test_get_nonexistent_key() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            let value = settings.get("test-plugin", "nonexistent").await;
            assert!(value.is_ok());
            assert_eq!(value.unwrap(), None);
        }

        #[tokio::test]
        async fn test_delete_value() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Set and then delete
            settings
                .set("test-plugin", "temp", "temporary")
                .await
                .unwrap();
            let result = settings.delete("test-plugin", "temp").await;
            assert!(result.is_ok());

            // Verify it's gone
            let value = settings.get("test-plugin", "temp").await.unwrap();
            assert_eq!(value, None);
        }

        #[tokio::test]
        async fn test_permission_denial() {
            let (settings, _temp) = create_test_settings().await;

            // Try to write without permission
            let result = settings.set("test-plugin", "key", "value").await;
            assert!(result.is_err());
            assert!(matches!(
                result.unwrap_err(),
                SettingsError::PermissionDenied(_)
            ));
        }
    }

    mod namespaced_storage {
        use super::*;

        #[tokio::test]
        async fn test_plugin_isolation() {
            let (settings, _temp) = create_test_settings().await;

            // Grant permissions to both plugins
            grant_settings_permission(&settings, "plugin-a", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "plugin-a", SettingsPermission::Read).await;
            grant_settings_permission(&settings, "plugin-b", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "plugin-b", SettingsPermission::Read).await;

            // Each plugin sets the same key
            settings
                .set("plugin-a", "shared-key", "value-a")
                .await
                .unwrap();
            settings
                .set("plugin-b", "shared-key", "value-b")
                .await
                .unwrap();

            // Each gets their own value
            let value_a = settings.get("plugin-a", "shared-key").await.unwrap();
            let value_b = settings.get("plugin-b", "shared-key").await.unwrap();

            assert_eq!(value_a, Some("value-a".to_string()));
            assert_eq!(value_b, Some("value-b".to_string()));
        }

        #[tokio::test]
        async fn test_cross_plugin_access_denied() {
            let (settings, _temp) = create_test_settings().await;

            // Plugin A writes data
            grant_settings_permission(&settings, "plugin-a", SettingsPermission::Write).await;
            settings
                .set("plugin-a", "secret", "plugin-a-secret")
                .await
                .unwrap();

            // Plugin B tries to read Plugin A's data - should fail
            grant_settings_permission(&settings, "plugin-b", SettingsPermission::Read).await;
            let result = settings.get_raw("plugin-b", "plugin-a", "secret").await;
            assert!(result.is_err());
        }
    }

    mod complex_data_types {
        use super::*;
        use serde_json::json;

        #[tokio::test]
        async fn test_json_storage() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Store JSON object
            let json_data = json!({
                "name": "Test",
                "count": 42,
                "enabled": true,
                "items": ["a", "b", "c"]
            });

            let result = settings
                .set_json("test-plugin", "config", json_data.clone())
                .await;
            assert!(result.is_ok());

            // Retrieve JSON object
            let retrieved = settings.get_json("test-plugin", "config").await;
            assert!(retrieved.is_ok());
            assert_eq!(retrieved.unwrap(), Some(json_data));
        }

        #[tokio::test]
        async fn test_bulk_operations() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Set multiple values
            let items = vec![("key1", "value1"), ("key2", "value2"), ("key3", "value3")];

            for (key, value) in &items {
                settings.set("test-plugin", key, value).await.unwrap();
            }

            // Get all keys
            let keys = settings.list_keys("test-plugin").await.unwrap();
            assert_eq!(keys.len(), 3);
            assert!(keys.contains(&"key1".to_string()));
            assert!(keys.contains(&"key2".to_string()));
            assert!(keys.contains(&"key3".to_string()));

            // Get all as map
            let all = settings.get_all("test-plugin").await.unwrap();
            assert_eq!(all.len(), 3);
            assert_eq!(all.get("key1"), Some(&"value1".to_string()));
        }
    }

    mod storage_quota {
        use super::*;

        #[tokio::test]
        async fn test_quota_enforcement() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;

            // Set a small quota (1KB)
            let _ = settings.set_quota("test-plugin", 1024).await;

            // Try to store data exceeding quota
            let large_value = "x".repeat(2000); // 2KB
            let result = settings.set("test-plugin", "large", &large_value).await;

            assert!(result.is_err());
            assert!(matches!(
                result.unwrap_err(),
                SettingsError::QuotaExceeded(_)
            ));
        }

        #[tokio::test]
        async fn test_quota_calculation() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Store some data
            settings.set("test-plugin", "key1", "value1").await.unwrap();
            settings.set("test-plugin", "key2", "value2").await.unwrap();

            // Check storage usage
            let usage = settings.get_storage_usage("test-plugin").await.unwrap();
            assert!(usage > 0);
            assert!(usage < 1024); // Should be small
        }

        #[tokio::test]
        async fn test_quota_cleanup() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;

            // Set quota and fill it
            let _ = settings.set_quota("test-plugin", 100).await;
            settings
                .set("test-plugin", "key1", "x".repeat(30).as_str())
                .await
                .unwrap();
            settings
                .set("test-plugin", "key2", "y".repeat(30).as_str())
                .await
                .unwrap();

            // Delete one key to free space
            settings.delete("test-plugin", "key1").await.unwrap();

            // Should now have space for new data
            let result = settings
                .set("test-plugin", "key3", "z".repeat(20).as_str())
                .await;
            assert!(result.is_ok());
        }
    }

    mod migration_system {
        use super::*;

        #[tokio::test]
        async fn test_version_migration() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Set initial version and data
            settings.set_version("test-plugin", 1).await.unwrap();
            settings
                .set("test-plugin", "old_key", "old_value")
                .await
                .unwrap();

            // Define migration
            let migration = Migration {
                from_version: 1,
                to_version: 2,
                transform: Box::new(|data| {
                    let mut new_data = data;
                    if let Some(old_value) = new_data.remove("old_key") {
                        new_data.insert("new_key".to_string(), format!("migrated_{}", old_value));
                    }
                    new_data
                }),
            };

            // Apply migration
            settings
                .apply_migration("test-plugin", migration)
                .await
                .unwrap();

            // Check results
            let version = settings.get_version("test-plugin").await.unwrap();
            assert_eq!(version, 2);

            let old = settings.get("test-plugin", "old_key").await.unwrap();
            assert_eq!(old, None);

            let new = settings.get("test-plugin", "new_key").await.unwrap();
            assert_eq!(new, Some("migrated_old_value".to_string()));
        }

        #[tokio::test]
        async fn test_migration_chain() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;

            // Set initial version
            settings.set_version("test-plugin", 1).await.unwrap();
            settings.set("test-plugin", "value", "1").await.unwrap();

            // Define migration chain
            let migrations = vec![
                Migration {
                    from_version: 1,
                    to_version: 2,
                    transform: Box::new(|mut data| {
                        if let Some(val) = data.get_mut("value") {
                            *val = format!("v2_{}", val);
                        }
                        data
                    }),
                },
                Migration {
                    from_version: 2,
                    to_version: 3,
                    transform: Box::new(|mut data| {
                        if let Some(val) = data.get_mut("value") {
                            *val = format!("v3_{}", val);
                        }
                        data
                    }),
                },
            ];

            // Apply migrations
            for migration in migrations {
                settings
                    .apply_migration("test-plugin", migration)
                    .await
                    .unwrap();
            }

            // Check final state
            let version = settings.get_version("test-plugin").await.unwrap();
            assert_eq!(version, 3);

            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;
            let value = settings.get("test-plugin", "value").await.unwrap();
            assert_eq!(value, Some("v3_v2_1".to_string()));
        }
    }

    mod encryption {
        use super::*;

        #[tokio::test]
        async fn test_encrypted_storage() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Store sensitive data encrypted
            let secret = "super-secret-api-key";
            let result = settings
                .set_encrypted("test-plugin", "api_key", secret)
                .await;
            assert!(result.is_ok());

            // Retrieve and decrypt
            let decrypted = settings.get_encrypted("test-plugin", "api_key").await;
            assert!(decrypted.is_ok());
            assert_eq!(decrypted.unwrap(), Some(secret.to_string()));

            // Verify it's actually encrypted on disk
            let raw = settings
                .get_raw_internal("test-plugin", "api_key")
                .await
                .unwrap();
            assert_ne!(raw, Some(secret.to_string()));
        }

        #[tokio::test]
        async fn test_encryption_key_rotation() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Store encrypted data
            settings
                .set_encrypted("test-plugin", "secret", "my-secret")
                .await
                .unwrap();

            // Rotate encryption key
            settings.rotate_encryption_key("test-plugin").await.unwrap();

            // Should still be able to decrypt
            let decrypted = settings
                .get_encrypted("test-plugin", "secret")
                .await
                .unwrap();
            assert_eq!(decrypted, Some("my-secret".to_string()));
        }
    }

    mod cleanup {
        use super::*;

        #[tokio::test]
        async fn test_plugin_cleanup() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;

            // Store some data
            settings.set("test-plugin", "key1", "value1").await.unwrap();
            settings.set("test-plugin", "key2", "value2").await.unwrap();
            settings
                .set_json("test-plugin", "config", serde_json::json!({"test": true}))
                .await
                .unwrap();

            // Clean up all plugin data
            let result = settings.cleanup_plugin_data("test-plugin").await;
            assert!(result.is_ok());

            // Verify all data is gone
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;
            let keys = settings.list_keys("test-plugin").await.unwrap();
            assert_eq!(keys.len(), 0);
        }

        #[tokio::test]
        async fn test_garbage_collection() {
            let (settings, _temp) = create_test_settings().await;

            // Simulate multiple plugins with data
            for i in 0..5 {
                let plugin_id = format!("plugin-{}", i);
                grant_settings_permission(&settings, &plugin_id, SettingsPermission::Write).await;
                settings.set(&plugin_id, "data", "value").await.unwrap();
            }

            // Mark some plugins as uninstalled
            let _ = settings.mark_plugin_uninstalled("plugin-1").await;
            let _ = settings.mark_plugin_uninstalled("plugin-3").await;

            // Run garbage collection
            let cleaned = settings.garbage_collect().await.unwrap();
            assert_eq!(cleaned, 2);

            // Verify uninstalled plugin data is gone
            grant_settings_permission(&settings, "plugin-1", SettingsPermission::Read).await;
            let keys = settings.list_keys("plugin-1").await.unwrap();
            assert_eq!(keys.len(), 0);
        }
    }

    mod persistence {
        use super::*;

        #[tokio::test]
        async fn test_persistence_across_restarts() {
            let temp_dir = TempDir::new().unwrap();
            let storage_path = temp_dir.path().to_path_buf();

            // First session
            {
                let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
                let settings = SettingsApi::new(storage_path.clone(), permission_manager);

                grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write)
                    .await;
                settings
                    .set("test-plugin", "persistent", "value")
                    .await
                    .unwrap();
                settings.flush().await.unwrap();
            }

            // Second session - data should persist
            {
                let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
                let settings = SettingsApi::new(storage_path, permission_manager);

                grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;
                let value = settings.get("test-plugin", "persistent").await.unwrap();
                assert_eq!(value, Some("value".to_string()));
            }
        }

        #[tokio::test]
        async fn test_atomic_writes() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;

            // Perform multiple concurrent writes
            let mut handles = vec![];
            for i in 0..10 {
                let settings_clone = settings.clone_internal();
                let handle = tokio::spawn(async move {
                    settings_clone
                        .set("test-plugin", &format!("key{}", i), &format!("value{}", i))
                        .await
                });
                handles.push(handle);
            }

            // Wait for all writes
            for handle in handles {
                assert!(handle.await.unwrap().is_ok());
            }

            // Verify all writes succeeded
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;
            let keys = settings.list_keys("test-plugin").await.unwrap();
            assert_eq!(keys.len(), 10);
        }
    }

    mod performance {
        use super::*;
        use std::time::Instant;

        #[tokio::test]
        async fn test_write_performance() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;

            let start = Instant::now();

            // Write 100 key-value pairs
            for i in 0..100 {
                settings
                    .set("test-plugin", &format!("key{}", i), &format!("value{}", i))
                    .await
                    .unwrap();
            }

            let duration = start.elapsed();

            // Should complete in under 1 second
            assert!(duration.as_secs() < 1);
        }

        #[tokio::test]
        async fn test_read_performance() {
            let (settings, _temp) = create_test_settings().await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Write).await;
            grant_settings_permission(&settings, "test-plugin", SettingsPermission::Read).await;

            // Prepare data
            for i in 0..100 {
                settings
                    .set("test-plugin", &format!("key{}", i), &format!("value{}", i))
                    .await
                    .unwrap();
            }

            let start = Instant::now();

            // Read all values
            for i in 0..100 {
                settings
                    .get("test-plugin", &format!("key{}", i))
                    .await
                    .unwrap();
            }

            let duration = start.elapsed();

            // Should complete in under 100ms
            assert!(duration.as_millis() < 100);
        }
    }
}
