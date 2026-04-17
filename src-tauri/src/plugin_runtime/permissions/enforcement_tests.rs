// Comprehensive permission enforcement tests
use super::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(test)]
mod permission_enforcement_tests {
    use super::*;
    use crate::plugin_runtime::apis::{ApiManager, SettingsApi, VaultApi, WorkspaceApi};
    use crate::plugin_runtime::ipc::plugin_api_handler::PluginApiHandler;
    use serde_json::json;
    use std::path::PathBuf;

    /// Test that API calls fail without permissions
    #[tokio::test]
    async fn test_api_calls_blocked_without_permission() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        let handler = PluginApiHandler::new(api_manager);
        let plugin_id = "test-plugin";

        // Try to read a file without permission
        let params = json!({ "path": "test.md" });
        let result = handler
            .handle_api_call(plugin_id, "vault.read", params)
            .await;

        assert!(result.is_err());
        if let Err(error) = result {
            assert_eq!(error.code, -32001); // Permission denied code
            assert!(error.message.contains("Permission denied"));
        }
    }

    /// Test that permissions must be granted before API access
    #[tokio::test]
    async fn test_permission_required_before_api_access() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        // Initially no permissions
        let manager = permission_manager.read().await;
        let has_read = manager
            .has_capability(
                plugin_id,
                &Capability::VaultRead {
                    paths: vec!["*".to_string()],
                },
            )
            .await;
        assert!(!has_read);

        // Grant permission
        let permission = Permission {
            capability: Capability::VaultRead {
                paths: vec!["*".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // Now should have permission
        let has_read = manager
            .has_capability(
                plugin_id,
                &Capability::VaultRead {
                    paths: vec!["*".to_string()],
                },
            )
            .await;
        assert!(has_read);
    }

    /// Test consent dialog triggers for first-time permission request
    #[tokio::test]
    async fn test_consent_dialog_triggered_on_first_request() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        let manager = permission_manager.read().await;

        // Request consent for a dangerous operation
        let capability = Capability::VaultWrite {
            paths: vec!["*".to_string()],
        };
        let result = manager.request_consent(plugin_id, capability.clone()).await;

        assert!(result.is_ok());
        // In test mode, VaultWrite should be denied by default
        assert!(!result.unwrap());

        // Check consent was cached
        let cache_key = format!("{}:{:?}", plugin_id, capability);
        let cache = manager.consent_cache.read().await;
        assert!(cache.contains_key(&cache_key));
    }

    /// Test permission persistence across sessions
    #[tokio::test]
    async fn test_permission_persistence() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        // Grant and persist permissions
        let manager = permission_manager.read().await;
        let permission = Permission {
            capability: Capability::NetworkAccess {
                domains: vec!["https://api.example.com".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission.clone()])
            .await
            .unwrap();

        // Persist to storage
        let persisted = manager.persist_permissions(plugin_id).await;
        assert!(persisted.is_ok());

        // Create new manager and load permissions
        let new_manager = PermissionManager::new();
        let loaded = new_manager.load_permissions(plugin_id).await;
        assert!(loaded.is_ok());

        // Check permission was loaded
        let has_network = new_manager
            .has_capability(plugin_id, &permission.capability)
            .await;
        assert!(has_network);
    }

    /// Test CSP generation based on granted permissions
    #[tokio::test]
    async fn test_csp_generation_from_permissions() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        // Grant network permission
        let manager = permission_manager.read().await;
        let permission = Permission {
            capability: Capability::NetworkAccess {
                domains: vec!["https://api.readwise.io".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // Generate CSP
        let csp = manager.generate_csp_for_plugin(plugin_id).await;
        assert!(csp.is_ok());

        let policy = csp.unwrap();
        assert!(policy.contains("connect-src"));
        assert!(policy.contains("https://api.readwise.io"));
    }

    /// Test permission expiration
    #[tokio::test]
    async fn test_permission_expiration() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        // Grant permission that expires immediately
        let manager = permission_manager.read().await;
        let permission = Permission {
            capability: Capability::VaultWrite {
                paths: vec!["*".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: Some(chrono::Utc::now() - chrono::Duration::seconds(1)),
        };

        manager
            .grant_permissions(plugin_id, vec![permission.clone()])
            .await
            .unwrap();

        // Check permission is expired
        let has_write = manager
            .has_capability(plugin_id, &permission.capability)
            .await;
        assert!(!has_write);
    }

    /// Test permission revocation
    #[tokio::test]
    async fn test_permission_revocation() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        let manager = permission_manager.read().await;

        // Grant permission
        let capability = Capability::ClipboardRead;
        let permission = Permission {
            capability: capability.clone(),
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();
        assert!(manager.has_capability(plugin_id, &capability).await);

        // Revoke permission
        manager
            .revoke_permissions(plugin_id, vec![capability.clone()])
            .await
            .unwrap();
        assert!(!manager.has_capability(plugin_id, &capability).await);
    }

    /// Test granular path permissions
    #[tokio::test]
    async fn test_granular_path_permissions() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        let manager = permission_manager.read().await;

        // Grant permission for specific path only
        let permission = Permission {
            capability: Capability::VaultRead {
                paths: vec!["/Readwise/*".to_string()],
            },
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions(plugin_id, vec![permission])
            .await
            .unwrap();

        // Check permission for allowed path
        let allowed = manager
            .check_path_permission(plugin_id, "/Readwise/highlights.md", VaultPermission::Read)
            .await;
        assert!(allowed.is_ok());

        // Check permission for disallowed path
        let disallowed = manager
            .check_path_permission(plugin_id, "/Private/secrets.md", VaultPermission::Read)
            .await;
        assert!(disallowed.is_err());
    }

    /// Test multiple domain network permissions
    #[tokio::test]
    async fn test_multiple_domain_permissions() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        let manager = permission_manager.read().await;

        // Grant permissions for multiple domains
        let permission = Permission {
            capability: Capability::NetworkAccess {
                domains: vec![
                    "https://api.readwise.io".to_string(),
                    "https://readwise.io".to_string(),
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

        // Check both domains are allowed
        let allowed1 = manager
            .check_network_permission(plugin_id, "https://api.readwise.io/v2/highlights")
            .await;
        assert!(allowed1.is_ok());

        let allowed2 = manager
            .check_network_permission(plugin_id, "https://readwise.io/api/auth")
            .await;
        assert!(allowed2.is_ok());

        // Check other domain is blocked
        let blocked = manager
            .check_network_permission(plugin_id, "https://evil.com/steal-data")
            .await;
        assert!(blocked.is_err());
    }

    /// Test permission UI consent flow integration
    #[tokio::test]
    async fn test_permission_ui_consent_flow() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let plugin_id = "test-plugin";

        let manager = permission_manager.read().await;

        // Simulate UI consent request
        let consent_request = ConsentRequest {
            plugin_id: plugin_id.to_string(),
            plugin_name: "Readwise Importer".to_string(),
            capability: Capability::VaultWrite {
                paths: vec!["*".to_string()],
            },
            reason: "Import highlights from Readwise".to_string(),
            consequences: vec![
                "Create and modify files in your vault".to_string(),
                "Organize highlights into folders".to_string(),
            ],
        };

        // This would normally show UI and wait for user response
        let user_response = manager
            .simulate_user_consent_response(&consent_request, ConsentResponse::GrantOnce)
            .await;

        assert!(user_response.is_ok());

        // Check permission was granted temporarily
        let has_permission = manager
            .has_capability(plugin_id, &consent_request.capability)
            .await;
        assert!(has_permission);
    }
}

// The implementations are now in the main mod.rs file
