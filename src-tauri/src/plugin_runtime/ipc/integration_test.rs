// Integration tests for plugin IPC and API bridge
#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::plugin_runtime::apis::ApiManager;
    use crate::plugin_runtime::ipc::plugin_api_handler::PluginApiHandler;
    use crate::plugin_runtime::permissions::PermissionManager;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    /// Test the full IPC flow from plugin to API
    #[tokio::test]
    async fn test_full_ipc_flow() {
        // Create permission manager and grant permissions
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));

        // Grant vault read permission for testing
        {
            let capability = crate::plugin_runtime::permissions::Capability::VaultRead {
                paths: vec!["*".to_string()],
            };
            let permission = crate::plugin_runtime::permissions::Permission {
                capability,
                granted: true,
                granted_at: None,
                expires_at: None,
            };
            permission_manager
                .write()
                .await
                .grant_permissions("test-plugin", vec![permission])
                .await
                .unwrap();
        }

        // Create API manager with test paths
        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        // Create plugin API handler
        let handler = PluginApiHandler::new(api_manager.clone());

        // Simulate a vault.list call from a plugin
        let params = json!({
            "path": ""
        });

        let result = handler
            .handle_api_call("test-plugin", "vault.list", params)
            .await;

        // Should succeed with the granted permission
        assert!(result.is_ok());
        let response = result.unwrap();
        assert!(response["entries"].is_array());
    }

    /// Test IPC message routing
    #[tokio::test]
    async fn test_ipc_message_routing() {
        let bridge = IpcBridge::new();

        // Create a channel for test plugin
        bridge.create_channel("test-plugin").await.unwrap();

        // Register a test handler
        bridge
            .register_handler("test.method", |params| Ok(json!({ "received": params })))
            .await;

        // Create a request message
        let request = IpcMessage::Request {
            id: "123".to_string(),
            method: "test.method".to_string(),
            params: json!({ "data": "test" }),
        };

        // Process the message
        let response = bridge.process_message(request).await.unwrap();

        // Verify response
        match response {
            IpcMessage::Response { id, result, error } => {
                assert_eq!(id, "123");
                assert!(result.is_some());
                assert!(error.is_none());
                let result_val = result.unwrap();
                assert_eq!(result_val["received"]["data"], "test");
            }
            _ => panic!("Expected Response message"),
        }
    }

    /// Test plugin JavaScript API bridge injection
    #[test]
    fn test_javascript_api_bridge() {
        // Read the JavaScript API bridge file
        let api_bridge_js = std::fs::read_to_string("src/plugin_runtime/js/plugin-api-bridge.js")
            .unwrap_or_else(|_| String::from("// File not found"));

        // Verify it contains the expected API functions
        assert!(api_bridge_js.contains("window.vault"));
        assert!(api_bridge_js.contains("window.workspace"));
        assert!(api_bridge_js.contains("window.settings"));

        // Verify vault API methods
        assert!(api_bridge_js.contains("vault.read"));
        assert!(api_bridge_js.contains("vault.write"));
        assert!(api_bridge_js.contains("vault.list"));
        assert!(api_bridge_js.contains("vault.delete"));

        // Verify workspace API methods
        assert!(api_bridge_js.contains("workspace.showNotice"));
        assert!(api_bridge_js.contains("workspace.getActiveFile"));
        assert!(api_bridge_js.contains("workspace.openFile"));

        // Verify settings API methods
        assert!(api_bridge_js.contains("settings.get"));
        assert!(api_bridge_js.contains("settings.set"));
        assert!(api_bridge_js.contains("settings.getAll"));
    }

    /// Test error handling in IPC
    #[tokio::test]
    async fn test_ipc_error_handling() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));

        // Don't grant any permissions

        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        let handler = PluginApiHandler::new(api_manager.clone());

        // Try to read without permission
        let params = json!({
            "path": "test.md"
        });

        let result = handler
            .handle_api_call("test-plugin", "vault.read", params)
            .await;

        // Should fail with permission denied
        assert!(result.is_err());
        let error = result.unwrap_err();
        assert_eq!(error.code, -32001);
        assert!(error.message.contains("Permission denied"));
    }

    /// Test concurrent IPC calls
    #[tokio::test]
    async fn test_concurrent_ipc_calls() {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));

        // Grant permissions
        {
            let capability1 = crate::plugin_runtime::permissions::Capability::VaultRead {
                paths: vec!["*".to_string()],
            };
            let capability2 = crate::plugin_runtime::permissions::Capability::VaultRead {
                paths: vec!["*".to_string()],
            };
            let permission1 = crate::plugin_runtime::permissions::Permission {
                capability: capability1,
                granted: true,
                granted_at: None,
                expires_at: None,
            };
            let permission2 = crate::plugin_runtime::permissions::Permission {
                capability: capability2,
                granted: true,
                granted_at: None,
                expires_at: None,
            };
            permission_manager
                .write()
                .await
                .grant_permissions("plugin-1", vec![permission1])
                .await
                .unwrap();
            permission_manager
                .write()
                .await
                .grant_permissions("plugin-2", vec![permission2])
                .await
                .unwrap();
        }

        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager.clone(),
        )));

        let handler = Arc::new(PluginApiHandler::new(api_manager.clone()));

        // Simulate concurrent calls from different plugins
        let handler1 = handler.clone();
        let handler2 = handler.clone();

        let task1 = tokio::spawn(async move {
            let params = json!({ "path": "" });
            handler1
                .handle_api_call("plugin-1", "vault.list", params)
                .await
        });

        let task2 = tokio::spawn(async move {
            let params = json!({ "path": "" });
            handler2
                .handle_api_call("plugin-2", "vault.list", params)
                .await
        });

        // Both should succeed
        let result1 = task1.await.unwrap();
        let result2 = task2.await.unwrap();

        assert!(result1.is_ok());
        assert!(result2.is_ok());
    }
}
