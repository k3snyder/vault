// Integration tests for permission enforcement system
use super::*;
use crate::plugin_runtime::apis::{ApiManager, VaultApi};
use crate::plugin_runtime::ipc::plugin_api_handler::PluginApiHandler;
use crate::plugin_runtime::sandbox::csp;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(test)]
mod integration_tests {
    use super::*;

    /// Test complete permission flow from request to API access
    #[tokio::test]
    async fn test_complete_permission_flow() {
        // Setup
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        let handler = PluginApiHandler::new(api_manager.clone());
        let plugin_id = "test-plugin";

        // Step 1: Initial API call should fail without permission
        let params = json!({ "path": "test.md" });
        let result = handler
            .handle_api_call(plugin_id, "vault.read", params.clone())
            .await;
        assert!(result.is_err());

        // Step 2: Request permission
        let manager = permission_manager.read().await;
        let consent_request = ConsentRequest {
            plugin_id: plugin_id.to_string(),
            plugin_name: "Test Plugin".to_string(),
            capability: Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            reason: "Need to read vault files".to_string(),
            consequences: vec!["Read all vault files".to_string()],
        };

        // Step 3: Grant permission
        manager
            .simulate_user_consent_response(&consent_request, ConsentResponse::GrantAlways)
            .await
            .unwrap();

        // Step 4: Verify permission was granted
        assert!(
            manager
                .has_capability(plugin_id, &consent_request.capability)
                .await
        );

        // Step 5: API call should now succeed (would succeed if file existed)
        // In a real test, we'd create the file first
        let result = handler
            .handle_api_call(plugin_id, "vault.read", params)
            .await;
        // The call will fail due to missing file, but not due to permissions
        if let Err(error) = result {
            assert_ne!(error.code, -32001); // Not a permission error
        }
    }

    /// Test CSP generation updates with permissions
    #[tokio::test]
    async fn test_csp_updates_with_permissions() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        // Initial CSP without permissions
        let manager = permission_manager.read().await;
        let initial_csp = manager.generate_csp_for_plugin(plugin_id).await.unwrap();
        assert!(!initial_csp.contains("https://api.example.com"));

        // Grant network permission
        let permission = Permission {
            capability: Capability::NetworkAccess {
                domains: vec!["https://api.example.com".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // CSP should now include the domain
        let updated_csp = manager.generate_csp_for_plugin(plugin_id).await.unwrap();
        assert!(updated_csp.contains("connect-src"));
        assert!(updated_csp.contains("https://api.example.com"));
    }

    /// Test permission persistence across manager instances
    #[tokio::test]
    async fn test_permission_persistence_integration() {
        let plugin_id = "persistence-test-plugin";

        // Create first manager and grant permissions
        {
            let manager = PermissionManager::new();
            let permission = Permission {
                capability: Capability::GraphWrite,
                granted: true,
                granted_at: Some(chrono::Utc::now()),
                expires_at: None,
            };

            manager
                .grant_permissions(plugin_id, vec![permission.clone()])
                .await
                .unwrap();
            manager.persist_permissions(plugin_id).await.unwrap();

            // Verify permission exists
            assert!(
                manager
                    .has_capability(plugin_id, &permission.capability)
                    .await
            );
        }

        // Create new manager and load permissions
        {
            let new_manager = PermissionManager::new();
            new_manager.load_permissions(plugin_id).await.unwrap();

            // Verify permission was loaded
            assert!(
                new_manager
                    .has_capability(plugin_id, &Capability::GraphWrite)
                    .await
            );
        }
    }

    /// Test granular path permissions with API integration
    #[tokio::test]
    async fn test_granular_path_permissions_with_api() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let vault_api = VaultApi::new(PathBuf::from("/tmp/test-vault"), permission_manager.clone());

        let plugin_id = "path-test-plugin";

        // Grant permission for specific path only
        let manager = permission_manager.read().await;
        let permission = Permission {
            capability: Capability::VaultRead {
                paths: vec!["/allowed/*".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // Check path permissions
        let allowed = manager
            .check_path_permission(plugin_id, "/allowed/file.md", VaultPermission::Read)
            .await;
        assert!(allowed.is_ok());

        let denied = manager
            .check_path_permission(plugin_id, "/private/secret.md", VaultPermission::Read)
            .await;
        assert!(denied.is_err());
    }

    /// Test permission expiration with API calls
    #[tokio::test]
    async fn test_permission_expiration_with_api() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        let handler = PluginApiHandler::new(api_manager);
        let plugin_id = "expiry-test-plugin";

        // Grant permission that expires immediately
        let manager = permission_manager.read().await;
        let permission = Permission {
            capability: Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: Some(chrono::Utc::now() - chrono::Duration::seconds(1)),
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // API call should fail due to expired permission
        let params = json!({ "path": "test.md" });
        let result = handler
            .handle_api_call(plugin_id, "vault.read", params)
            .await;
        assert!(result.is_err());
        if let Err(error) = result {
            assert_eq!(error.code, -32001); // Permission denied
        }
    }

    /// Test network permission domain validation
    #[tokio::test]
    async fn test_network_permission_domain_validation() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "network-test-plugin";

        let manager = permission_manager.read().await;

        // Grant permission for specific domains
        let permission = Permission {
            capability: Capability::NetworkAccess {
                domains: vec![
                    "https://api.allowed.com".to_string(),
                    "https://cdn.allowed.com".to_string(),
                ],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // Test allowed domains
        assert!(manager
            .check_network_permission(plugin_id, "https://api.allowed.com/endpoint")
            .await
            .is_ok());

        assert!(manager
            .check_network_permission(plugin_id, "https://cdn.allowed.com/resource")
            .await
            .is_ok());

        // Test blocked domain
        assert!(manager
            .check_network_permission(plugin_id, "https://evil.com/malware")
            .await
            .is_err());
    }

    /// Test permission UI consent flow with different responses
    #[tokio::test]
    async fn test_consent_flow_responses() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "consent-test-plugin";

        let manager = permission_manager.read().await;

        // Test Deny response
        let consent_request = ConsentRequest {
            plugin_id: plugin_id.to_string(),
            plugin_name: "Test Plugin".to_string(),
            capability: Capability::VaultDelete {
                paths: vec!["*".to_string()],
            },
            reason: "Need to delete files".to_string(),
            consequences: vec!["Delete any file".to_string()],
        };

        manager
            .simulate_user_consent_response(&consent_request, ConsentResponse::Deny)
            .await
            .unwrap();

        assert!(
            !manager
                .has_capability(plugin_id, &consent_request.capability)
                .await
        );

        // Test GrantOnce response (temporary permission)
        let consent_request = ConsentRequest {
            plugin_id: plugin_id.to_string(),
            plugin_name: "Test Plugin".to_string(),
            capability: Capability::ClipboardWrite,
            reason: "Copy data to clipboard".to_string(),
            consequences: vec!["Write to clipboard".to_string()],
        };

        manager
            .simulate_user_consent_response(&consent_request, ConsentResponse::GrantOnce)
            .await
            .unwrap();

        let permissions = manager.get_plugin_permissions(plugin_id).await;
        let clipboard_perm = permissions
            .iter()
            .find(|p| matches!(p.capability, Capability::ClipboardWrite))
            .unwrap();

        assert!(clipboard_perm.granted);
        assert!(clipboard_perm.expires_at.is_some()); // Should have expiry

        // Test GrantAlways response (permanent permission)
        let consent_request = ConsentRequest {
            plugin_id: plugin_id.to_string(),
            plugin_name: "Test Plugin".to_string(),
            capability: Capability::NotificationShow,
            reason: "Show notifications".to_string(),
            consequences: vec!["Display system notifications".to_string()],
        };

        manager
            .simulate_user_consent_response(&consent_request, ConsentResponse::GrantAlways)
            .await
            .unwrap();

        let permissions = manager.get_plugin_permissions(plugin_id).await;
        let notification_perm = permissions
            .iter()
            .find(|p| matches!(p.capability, Capability::NotificationShow))
            .unwrap();

        assert!(notification_perm.granted);
        assert!(notification_perm.expires_at.is_none()); // Should not expire
    }

    /// Test permission enforcement in multiple API types
    #[tokio::test]
    async fn test_multi_api_permission_enforcement() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        let handler = PluginApiHandler::new(api_manager);
        let plugin_id = "multi-api-test";

        // Test vault API without permission
        let vault_params = json!({ "path": "test.md", "content": "test" });
        let result = handler
            .handle_api_call(plugin_id, "vault.write", vault_params)
            .await;
        assert!(result.is_err());

        // Test workspace API without permission
        let workspace_params = json!({ "message": "test", "type": "info" });
        let result = handler
            .handle_api_call(plugin_id, "workspace.showNotice", workspace_params)
            .await;
        assert!(result.is_err());

        // Test settings API without permission
        let settings_params = json!({ "key": "test-key", "value": "test-value" });
        let result = handler
            .handle_api_call(plugin_id, "settings.set", settings_params)
            .await;
        assert!(result.is_err());

        // Grant permissions and retry
        let manager = permission_manager.read().await;
        let permissions = vec![
            Permission {
                capability: Capability::VaultWrite {
                    paths: vec!["*".to_string()],
                },
                granted: true,
                granted_at: Some(chrono::Utc::now()),
                expires_at: None,
            },
            Permission {
                capability: Capability::NotificationShow,
                granted: true,
                granted_at: Some(chrono::Utc::now()),
                expires_at: None,
            },
            Permission {
                capability: Capability::SettingsWrite {
                    keys: vec!["*".to_string()],
                },
                granted: true,
                granted_at: Some(chrono::Utc::now()),
                expires_at: None,
            },
        ];

        manager
            .grant_permissions(plugin_id, permissions)
            .await
            .unwrap();

        // Now calls should not fail due to permissions
        // (they may fail for other reasons like missing files, but not permissions)
        let vault_params = json!({ "path": "test.md", "content": "test" });
        let result = handler
            .handle_api_call(plugin_id, "vault.write", vault_params)
            .await;
        // Check that if it fails, it's not due to permissions
        if let Err(error) = result {
            assert_ne!(error.code, -32001);
        }
    }
}
