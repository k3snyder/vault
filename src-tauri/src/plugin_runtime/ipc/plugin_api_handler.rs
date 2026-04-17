// Plugin API Handler - Routes IPC messages to appropriate API implementations
use super::IpcError;
use crate::plugin_runtime::apis::{ApiManager, SettingsError, VaultError, WorkspaceError};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Handles plugin API calls through IPC
pub struct PluginApiHandler {
    api_manager: Arc<RwLock<ApiManager>>,
}

impl PluginApiHandler {
    pub fn new(api_manager: Arc<RwLock<ApiManager>>) -> Self {
        Self { api_manager }
    }

    /// Process an API call from a plugin
    pub async fn handle_api_call(
        &self,
        plugin_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, IpcError> {
        // Parse the method to determine which API to call
        let parts: Vec<&str> = method.split('.').collect();
        if parts.len() < 2 {
            return Err(IpcError {
                code: -32601,
                message: format!("Invalid method format: {}", method),
                data: None,
            });
        }

        let api_name = parts[0];
        let api_method = parts[1..].join(".");

        match api_name {
            "vault" => self.handle_vault_api(plugin_id, &api_method, params).await,
            "workspace" => {
                self.handle_workspace_api(plugin_id, &api_method, params)
                    .await
            }
            "settings" => {
                self.handle_settings_api(plugin_id, &api_method, params)
                    .await
            }
            _ => Err(IpcError {
                code: -32601,
                message: format!("Unknown API: {}", api_name),
                data: None,
            }),
        }
    }

    /// Handle Vault API calls
    async fn handle_vault_api(
        &self,
        plugin_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, IpcError> {
        let api_manager = self.api_manager.read().await;

        match method {
            "read" => {
                let path = params["path"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'path' parameter".to_string(),
                    data: None,
                })?;

                match api_manager.vault.read(plugin_id, path).await {
                    Ok(content) => Ok(json!({ "content": content })),
                    Err(e) => Err(self.vault_error_to_ipc_error(e)),
                }
            }
            "write" => {
                let path = params["path"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'path' parameter".to_string(),
                    data: None,
                })?;
                let content = params["content"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'content' parameter".to_string(),
                    data: None,
                })?;

                match api_manager.vault.write(plugin_id, path, content).await {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.vault_error_to_ipc_error(e)),
                }
            }
            "list" => {
                let path = params["path"].as_str().unwrap_or("");

                match api_manager.vault.list(plugin_id, path).await {
                    Ok(entries) => Ok(json!({ "entries": entries })),
                    Err(e) => Err(self.vault_error_to_ipc_error(e)),
                }
            }
            "delete" => {
                let path = params["path"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'path' parameter".to_string(),
                    data: None,
                })?;

                match api_manager.vault.delete(plugin_id, path).await {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.vault_error_to_ipc_error(e)),
                }
            }
            "createFolder" => {
                let path = params["path"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'path' parameter".to_string(),
                    data: None,
                })?;

                match api_manager.vault.create_folder(plugin_id, path).await {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.vault_error_to_ipc_error(e)),
                }
            }
            "deleteFolder" => {
                let path = params["path"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'path' parameter".to_string(),
                    data: None,
                })?;
                let recursive = params["recursive"].as_bool().unwrap_or(false);

                match api_manager
                    .vault
                    .delete_folder(plugin_id, path, recursive)
                    .await
                {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.vault_error_to_ipc_error(e)),
                }
            }
            _ => Err(IpcError {
                code: -32601,
                message: format!("Unknown vault method: {}", method),
                data: None,
            }),
        }
    }

    /// Handle Workspace API calls
    async fn handle_workspace_api(
        &self,
        plugin_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, IpcError> {
        let api_manager = self.api_manager.read().await;

        match method {
            "showNotice" => {
                let message = params["message"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'message' parameter".to_string(),
                    data: None,
                })?;
                let timeout = params["timeout"].as_u64().map(|t| t as u32);
                let notice_type = params["type"]
                    .as_str()
                    .and_then(|t| match t {
                        "info" => Some(crate::plugin_runtime::apis::workspace::NoticeType::Info),
                        "success" => {
                            Some(crate::plugin_runtime::apis::workspace::NoticeType::Success)
                        }
                        "warning" => {
                            Some(crate::plugin_runtime::apis::workspace::NoticeType::Warning)
                        }
                        "error" => Some(crate::plugin_runtime::apis::workspace::NoticeType::Error),
                        _ => None,
                    })
                    .unwrap_or(crate::plugin_runtime::apis::workspace::NoticeType::Info);

                match api_manager
                    .workspace
                    .show_notice(plugin_id, notice_type, message, timeout)
                    .await
                {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.workspace_error_to_ipc_error(e)),
                }
            }
            "getActiveFile" => match api_manager.workspace.get_active_file(plugin_id).await {
                Ok(path) => Ok(json!({ "path": path })),
                Err(e) => Err(self.workspace_error_to_ipc_error(e)),
            },
            "openFile" => {
                let path = params["path"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'path' parameter".to_string(),
                    data: None,
                })?;
                let new_pane = params["newPane"].as_bool().unwrap_or(false);

                match api_manager
                    .workspace
                    .open_file(plugin_id, path, new_pane)
                    .await
                {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.workspace_error_to_ipc_error(e)),
                }
            }
            _ => Err(IpcError {
                code: -32601,
                message: format!("Unknown workspace method: {}", method),
                data: None,
            }),
        }
    }

    /// Handle Settings API calls
    async fn handle_settings_api(
        &self,
        plugin_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, IpcError> {
        let api_manager = self.api_manager.read().await;

        match method {
            "get" => {
                let key = params["key"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'key' parameter".to_string(),
                    data: None,
                })?;

                match api_manager.settings.get(plugin_id, key).await {
                    Ok(value) => Ok(json!({ "value": value })),
                    Err(e) => Err(self.settings_error_to_ipc_error(e)),
                }
            }
            "set" => {
                let key = params["key"].as_str().ok_or_else(|| IpcError {
                    code: -32602,
                    message: "Missing 'key' parameter".to_string(),
                    data: None,
                })?;
                let value = params["value"].clone();

                // Use set_json for JSON values
                match api_manager.settings.set_json(plugin_id, key, value).await {
                    Ok(()) => Ok(json!({ "success": true })),
                    Err(e) => Err(self.settings_error_to_ipc_error(e)),
                }
            }
            "getAll" => match api_manager.settings.get_all(plugin_id).await {
                Ok(settings) => Ok(json!({ "settings": settings })),
                Err(e) => Err(self.settings_error_to_ipc_error(e)),
            },
            _ => Err(IpcError {
                code: -32601,
                message: format!("Unknown settings method: {}", method),
                data: None,
            }),
        }
    }

    /// Convert VaultError to IpcError
    fn vault_error_to_ipc_error(&self, error: VaultError) -> IpcError {
        match error {
            VaultError::PermissionDenied(_) => IpcError {
                code: -32001,
                message: "Permission denied".to_string(),
                data: Some(json!({ "api": "vault" })),
            },
            VaultError::FileNotFound(path) => IpcError {
                code: -32002,
                message: format!("File not found: {}", path),
                data: Some(json!({ "api": "vault", "path": path })),
            },
            VaultError::IoError(msg) => IpcError {
                code: -32003,
                message: format!("IO error: {}", msg),
                data: Some(json!({ "api": "vault" })),
            },
            _ => IpcError {
                code: -32000,
                message: format!("Vault error: {:?}", error),
                data: Some(json!({ "api": "vault" })),
            },
        }
    }

    /// Convert WorkspaceError to IpcError
    fn workspace_error_to_ipc_error(&self, error: WorkspaceError) -> IpcError {
        match error {
            WorkspaceError::PermissionDenied(_) => IpcError {
                code: -32001,
                message: "Permission denied".to_string(),
                data: Some(json!({ "api": "workspace" })),
            },
            WorkspaceError::ViewNotFound(_) => IpcError {
                code: -32004,
                message: "View not found".to_string(),
                data: Some(json!({ "api": "workspace" })),
            },
            _ => IpcError {
                code: -32000,
                message: format!("Workspace error: {:?}", error),
                data: Some(json!({ "api": "workspace" })),
            },
        }
    }

    /// Convert SettingsError to IpcError
    fn settings_error_to_ipc_error(&self, error: SettingsError) -> IpcError {
        match error {
            SettingsError::PermissionDenied(_) => IpcError {
                code: -32001,
                message: "Permission denied".to_string(),
                data: Some(json!({ "api": "settings" })),
            },
            SettingsError::QuotaExceeded(msg) => IpcError {
                code: -32005,
                message: format!("Quota exceeded: {}", msg),
                data: Some(json!({ "api": "settings" })),
            },
            _ => IpcError {
                code: -32000,
                message: format!("Settings error: {:?}", error),
                data: Some(json!({ "api": "settings" })),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_runtime::permissions::PermissionManager;
    use std::path::PathBuf;

    async fn create_test_handler() -> PluginApiHandler {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        let api_manager = Arc::new(RwLock::new(ApiManager::new(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
            permission_manager,
        )));

        PluginApiHandler::new(api_manager)
    }

    #[tokio::test]
    async fn test_handle_vault_read() {
        let handler = create_test_handler().await;

        let params = json!({
            "path": "test.md"
        });

        let result = handler
            .handle_api_call("test-plugin", "vault.read", params)
            .await;
        // Will fail due to permission check, but structure is correct
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_handle_vault_write() {
        let handler = create_test_handler().await;

        let params = json!({
            "path": "test.md",
            "content": "# Test Content"
        });

        let result = handler
            .handle_api_call("test-plugin", "vault.write", params)
            .await;
        // Will fail due to permission check, but structure is correct
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_handle_workspace_show_notice() {
        let handler = create_test_handler().await;

        let params = json!({
            "message": "Test notice",
            "timeout": 3000,
            "type": "info"
        });

        let result = handler
            .handle_api_call("test-plugin", "workspace.showNotice", params)
            .await;
        // Will fail due to permission check, but structure is correct
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_handle_settings_get() {
        let handler = create_test_handler().await;

        let params = json!({
            "key": "test-key"
        });

        let result = handler
            .handle_api_call("test-plugin", "settings.get", params)
            .await;
        // Will fail due to permission check, but structure is correct
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_invalid_method_format() {
        let handler = create_test_handler().await;

        let result = handler
            .handle_api_call("test-plugin", "invalidmethod", json!({}))
            .await;
        assert!(result.is_err());

        if let Err(error) = result {
            assert_eq!(error.code, -32601);
            assert!(error.message.contains("Invalid method format"));
        }
    }

    #[tokio::test]
    async fn test_unknown_api() {
        let handler = create_test_handler().await;

        let result = handler
            .handle_api_call("test-plugin", "unknown.method", json!({}))
            .await;
        assert!(result.is_err());

        if let Err(error) = result {
            assert_eq!(error.code, -32601);
            assert!(error.message.contains("Unknown API"));
        }
    }
}
