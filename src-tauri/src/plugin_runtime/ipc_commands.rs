// Tauri Commands for Plugin IPC Communication
use super::apis::ApiManager;
use super::ipc::plugin_api_handler::PluginApiHandler;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// State holder for the API handler
pub struct IpcState {
    pub handler: Arc<PluginApiHandler>,
}

/// Initialize the IPC state with API manager
pub fn create_ipc_state(vault_path: PathBuf, settings_path: PathBuf) -> IpcState {
    let permission_manager = Arc::new(RwLock::new(
        crate::plugin_runtime::permissions::PermissionManager::new(),
    ));

    let mut api_manager = ApiManager::new(vault_path, settings_path, permission_manager);

    // Create and connect resource monitor to NetworkApi
    let resource_monitor = Arc::new(crate::plugin_runtime::resources::ResourceMonitor::new());
    api_manager.set_resource_monitor(resource_monitor);

    let api_manager_arc = Arc::new(RwLock::new(api_manager));
    let handler = Arc::new(PluginApiHandler::new(api_manager_arc));

    IpcState { handler }
}

/// Handle a plugin API call through IPC
#[tauri::command]
pub async fn plugin_ipc_call(
    plugin_id: String,
    method: String,
    params: Value,
    state: State<'_, IpcState>,
) -> Result<Value, String> {
    state
        .handler
        .handle_api_call(&plugin_id, &method, params)
        .await
        .map_err(|e| format!("IPC error: {} (code: {})", e.message, e.code))
}

/// Send a message to a plugin (for events/notifications)
#[tauri::command]
pub async fn plugin_ipc_send(plugin_id: String, message: Value) -> Result<(), String> {
    // This will be used to send events to plugins
    // For now, just acknowledge receipt
    println!("Sending message to plugin {}: {:?}", plugin_id, message);
    Ok(())
}

/// Register a plugin for IPC communication
#[tauri::command]
pub async fn plugin_ipc_register(plugin_id: String) -> Result<(), String> {
    // Register the plugin with the IPC system
    // This will create channels and set up routing
    println!("Registering plugin {} for IPC", plugin_id);
    Ok(())
}

/// Unregister a plugin from IPC communication
#[tauri::command]
pub async fn plugin_ipc_unregister(plugin_id: String) -> Result<(), String> {
    // Unregister the plugin and clean up resources
    println!("Unregistering plugin {} from IPC", plugin_id);
    Ok(())
}

// Specific API commands for easier frontend integration

/// Vault API: Read a file
#[tauri::command]
pub async fn plugin_vault_read(
    plugin_id: String,
    path: String,
    state: State<'_, IpcState>,
) -> Result<String, String> {
    let params = json!({ "path": path });
    let result = state
        .handler
        .handle_api_call(&plugin_id, "vault.read", params)
        .await
        .map_err(|e| format!("Failed to read file: {}", e.message))?;

    result["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid response format".to_string())
}

/// Vault API: Write a file
#[tauri::command]
pub async fn plugin_vault_write(
    plugin_id: String,
    path: String,
    content: String,
    state: State<'_, IpcState>,
) -> Result<(), String> {
    let params = json!({ "path": path, "content": content });
    state
        .handler
        .handle_api_call(&plugin_id, "vault.write", params)
        .await
        .map_err(|e| format!("Failed to write file: {}", e.message))?;
    Ok(())
}

/// Vault API: List files
#[tauri::command]
pub async fn plugin_vault_list(
    plugin_id: String,
    path: Option<String>,
    state: State<'_, IpcState>,
) -> Result<Vec<String>, String> {
    let params = json!({ "path": path.unwrap_or_default() });
    let result = state
        .handler
        .handle_api_call(&plugin_id, "vault.list", params)
        .await
        .map_err(|e| format!("Failed to list files: {}", e.message))?;

    result["entries"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .ok_or_else(|| "Invalid response format".to_string())
}

/// Workspace API: Show notice
#[tauri::command]
pub async fn plugin_workspace_notice(
    plugin_id: String,
    message: String,
    timeout: Option<u64>,
    notice_type: Option<String>,
    state: State<'_, IpcState>,
) -> Result<(), String> {
    let params = json!({
        "message": message,
        "timeout": timeout.unwrap_or(5000),
        "type": notice_type.unwrap_or_else(|| "info".to_string())
    });

    state
        .handler
        .handle_api_call(&plugin_id, "workspace.showNotice", params)
        .await
        .map_err(|e| format!("Failed to show notice: {}", e.message))?;
    Ok(())
}

/// Settings API: Get a setting
#[tauri::command]
pub async fn plugin_settings_get(
    plugin_id: String,
    key: String,
    state: State<'_, IpcState>,
) -> Result<Value, String> {
    let params = json!({ "key": key });
    let result = state
        .handler
        .handle_api_call(&plugin_id, "settings.get", params)
        .await
        .map_err(|e| format!("Failed to get setting: {}", e.message))?;

    Ok(result["value"].clone())
}

/// Settings API: Set a setting
#[tauri::command]
pub async fn plugin_settings_set(
    plugin_id: String,
    key: String,
    value: Value,
    state: State<'_, IpcState>,
) -> Result<(), String> {
    let params = json!({ "key": key, "value": value });
    state
        .handler
        .handle_api_call(&plugin_id, "settings.set", params)
        .await
        .map_err(|e| format!("Failed to set setting: {}", e.message))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_create_ipc_state() {
        let state = create_ipc_state(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
        );

        // State should be created successfully
        assert!(Arc::strong_count(&state.handler) > 0);
    }

    #[tokio::test]
    async fn test_plugin_ipc_call_structure() {
        let ipc_state = create_ipc_state(
            PathBuf::from("/tmp/test-vault"),
            PathBuf::from("/tmp/test-settings"),
        );

        // We can't create a real State in tests, so we test the handler directly
        let params = json!({
            "path": "test.md"
        });

        let result = ipc_state
            .handler
            .handle_api_call("test-plugin", "vault.read", params)
            .await;

        // Will fail due to permission check, but structure is correct
        assert!(result.is_err());
    }
}
