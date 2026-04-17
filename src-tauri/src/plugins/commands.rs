// Tauri Commands for Plugin Management using real filesystem operations

use super::manager::PluginManager;
use super::types::{InstallOptions, Plugin, PluginError, PluginSettings};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::RwLock;

// Global plugin manager instance
pub struct PluginManagerState {
    manager: Arc<RwLock<Option<Arc<PluginManager>>>>,
    app_handle: AppHandle,
}

impl PluginManagerState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            manager: Arc::new(RwLock::new(None)),
            app_handle,
        }
    }

    pub async fn get_or_init(&self) -> Result<Arc<PluginManager>, PluginError> {
        let mut manager_lock = self.manager.write().await;

        if let Some(manager) = manager_lock.as_ref() {
            return Ok(Arc::clone(manager));
        }

        // Initialize the manager
        let app_data_dir = self.app_handle.path().app_data_dir().map_err(|e| {
            PluginError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })?;

        // Try to find plugins directory
        let mut plugins_dir = PathBuf::from("../plugins");
        if !plugins_dir.exists() {
            // Try from project root
            plugins_dir = PathBuf::from("/Users/ksnyder/code/aura-dev/plugins");
            if !plugins_dir.exists() {
                // Try from current directory
                if let Ok(current_dir) = std::env::current_dir() {
                    let parent_plugins = current_dir
                        .parent()
                        .map(|p| p.join("plugins"))
                        .unwrap_or_else(|| current_dir.join("plugins"));
                    if parent_plugins.exists() {
                        plugins_dir = parent_plugins;
                    } else {
                        // Use app data directory as fallback
                        plugins_dir = app_data_dir.join("plugins");
                    }
                }
            }
        }

        println!("Initializing plugin manager with:");
        println!("  Plugins dir: {:?}", plugins_dir);
        println!("  App data dir: {:?}", app_data_dir);

        let manager = Arc::new(PluginManager::new(plugins_dir, app_data_dir));
        manager.initialize().await?;

        *manager_lock = Some(Arc::clone(&manager));
        Ok(manager)
    }
}

// Get list of all installed plugins
#[tauri::command]
pub async fn plugin_list(state: State<'_, PluginManagerState>) -> Result<Vec<Plugin>, String> {
    println!("plugin_list command called");

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    let plugins = manager.list_plugins().await;
    println!("Found {} plugins", plugins.len());

    Ok(plugins)
}

// Install a plugin
#[tauri::command]
pub async fn plugin_install(
    options: InstallOptions,
    state: State<'_, PluginManagerState>,
) -> Result<Plugin, String> {
    println!("plugin_install command called");

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .install_plugin(options)
        .await
        .map_err(|e| format!("Failed to install plugin: {}", e))
}

// Enable a plugin
#[tauri::command]
pub async fn plugin_enable(
    plugin_id: String,
    state: State<'_, PluginManagerState>,
) -> Result<(), String> {
    println!("Enabling plugin: {}", plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .enable_plugin(&plugin_id)
        .await
        .map_err(|e| format!("Failed to enable plugin: {}", e))
}

// Disable a plugin
#[tauri::command]
pub async fn plugin_disable(
    plugin_id: String,
    state: State<'_, PluginManagerState>,
) -> Result<(), String> {
    println!("Disabling plugin: {}", plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .disable_plugin(&plugin_id)
        .await
        .map_err(|e| format!("Failed to disable plugin: {}", e))
}

// Uninstall a plugin
#[tauri::command]
pub async fn plugin_uninstall(
    plugin_id: String,
    state: State<'_, PluginManagerState>,
) -> Result<(), String> {
    println!("Uninstalling plugin: {}", plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .uninstall_plugin(&plugin_id)
        .await
        .map_err(|e| format!("Failed to uninstall plugin: {}", e))
}

// Get plugin settings
#[tauri::command]
pub async fn plugin_get_settings(
    plugin_id: String,
    state: State<'_, PluginManagerState>,
) -> Result<HashMap<String, serde_json::Value>, String> {
    println!("Getting settings for plugin: {}", plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .get_plugin_settings(&plugin_id)
        .await
        .map_err(|e| format!("Failed to get plugin settings: {}", e))
}

// Update plugin settings
#[tauri::command]
pub async fn plugin_update_settings(
    settings: PluginSettings,
    state: State<'_, PluginManagerState>,
) -> Result<(), String> {
    println!("Updating settings for plugin: {}", settings.plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .update_plugin_settings(&settings.plugin_id, settings.settings)
        .await
        .map_err(|e| format!("Failed to update plugin settings: {}", e))
}

// Refresh plugins list from filesystem
#[tauri::command]
pub async fn plugin_refresh(state: State<'_, PluginManagerState>) -> Result<Vec<Plugin>, String> {
    println!("Refreshing plugins list");

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    manager
        .refresh_plugins()
        .await
        .map_err(|e| format!("Failed to refresh plugins: {}", e))
}

// Get a specific plugin
#[tauri::command]
pub async fn plugin_get(
    plugin_id: String,
    state: State<'_, PluginManagerState>,
) -> Result<Option<Plugin>, String> {
    println!("Getting plugin: {}", plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    Ok(manager.get_plugin(&plugin_id).await)
}

// Get plugin resources (compatibility with old API)
#[tauri::command]
pub async fn plugin_get_resources(
    plugin_id: String,
) -> Result<super::super::plugin_runtime::commands::ResourceUsage, String> {
    // Return mock data for now - this would integrate with actual resource monitoring
    Ok(super::super::plugin_runtime::commands::ResourceUsage {
        memory_mb: 42.5,
        cpu_percent: 2.3,
        storage_mb: 15.2,
        network_requests: 127,
    })
}

// Request permission for a plugin (compatibility with old API)
#[tauri::command]
pub async fn plugin_request_permission(
    request: super::super::plugin_runtime::commands::PermissionRequest,
) -> Result<bool, String> {
    println!(
        "Permission request for {}: {}",
        request.plugin_id, request.permission
    );
    // Mock approval for now
    Ok(true)
}

// Get plugin logs (compatibility with old API)
#[tauri::command]
pub async fn plugin_get_logs(
    plugin_id: String,
    _limit: Option<usize>,
) -> Result<Vec<String>, String> {
    Ok(vec![
        format!("[INFO] Plugin {} initialized", plugin_id),
        format!("[DEBUG] Loading settings for {}", plugin_id),
        format!("[INFO] Plugin {} ready", plugin_id),
    ])
}

// Clear plugin data (compatibility with old API)
#[tauri::command]
pub async fn plugin_clear_data(
    plugin_id: String,
    state: State<'_, PluginManagerState>,
) -> Result<(), String> {
    println!("Clearing data for plugin: {}", plugin_id);

    let manager = state
        .get_or_init()
        .await
        .map_err(|e| format!("Failed to initialize plugin manager: {}", e))?;

    // Clear settings
    manager
        .update_plugin_settings(&plugin_id, HashMap::new())
        .await
        .map_err(|e| format!("Failed to clear plugin data: {}", e))
}

// Get all plugin resources (for compatibility)
#[tauri::command]
pub async fn plugin_get_all_resources(
) -> Result<HashMap<String, super::super::plugin_runtime::commands::ResourceUsage>, String> {
    // Return empty map for now - would aggregate all plugin resources
    Ok(HashMap::new())
}

// List all permissions (for compatibility)
#[tauri::command]
pub async fn plugin_list_all_permissions() -> Result<HashMap<String, Vec<String>>, String> {
    // Return empty map for now - would list all plugin permissions
    Ok(HashMap::new())
}

// Get plugin categories
#[tauri::command]
pub async fn plugin_get_categories() -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    // Return basic categories
    Ok(vec![{
        let mut cat = HashMap::new();
        cat.insert("id".to_string(), serde_json::json!("integration"));
        cat.insert("name".to_string(), serde_json::json!("Integration"));
        cat.insert("count".to_string(), serde_json::json!(1));
        cat
    }])
}

// Get system status
#[tauri::command]
pub async fn plugin_get_system_status() -> Result<HashMap<String, serde_json::Value>, String> {
    // Return basic system status
    let mut status = HashMap::new();
    status.insert("healthy".to_string(), serde_json::json!(true));
    status.insert("version".to_string(), serde_json::json!("1.0.0"));
    status.insert("plugins_enabled".to_string(), serde_json::json!(true));
    Ok(status)
}
