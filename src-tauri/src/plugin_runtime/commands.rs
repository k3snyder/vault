// Tauri Commands for Plugin Management
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

// Simple in-memory store for enabled plugins (in production, this would be persisted)
static ENABLED_PLUGINS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

// Note: State and PluginRuntime will be used once we connect to the actual runtime
// use tauri::State;
// use tokio::sync::Mutex;
// use std::sync::Arc;
// use super::PluginRuntime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub enabled: bool,
    pub permissions: Vec<String>,
    pub resource_usage: ResourceUsage,
    pub settings: HashMap<String, serde_json::Value>,
    pub status: PluginStatus,
    pub icon: Option<String>,
    pub homepage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub memory_mb: f64,
    pub cpu_percent: f64,
    pub storage_mb: f64,
    pub network_requests: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginStatus {
    Active,
    Inactive,
    Installing,
    Updating,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallOptions {
    pub path: PathBuf,
    pub auto_enable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSettings {
    pub plugin_id: String,
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub plugin_id: String,
    pub permission: String,
    pub reason: String,
}

// Note: This will be used once we connect to the actual runtime
// pub type PluginRuntimeState = Arc<Mutex<PluginRuntime>>;

// Get list of all installed plugins
// DEPRECATED: Using new implementation in plugins/commands.rs
// #[tauri::command]
pub async fn _old_plugin_list() -> Result<Vec<PluginInfo>, String> {
    println!("plugin_list command called");

    let mut plugins = Vec::new();

    // Try parent directory first (when running from src-tauri)
    let mut plugins_dir = PathBuf::from("../plugins");
    if !plugins_dir.exists() {
        // Try absolute path as fallback
        plugins_dir = PathBuf::from("/Users/ksnyder/code/aura-dev/plugins");
        if !plugins_dir.exists() {
            println!("Plugins directory not found");
            return Ok(plugins);
        }
    }

    println!("Looking for plugins in: {:?}", plugins_dir);

    // Scan plugins directory
    if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    // Check for manifest.json
                    let manifest_path = path.join("manifest.json");
                    if manifest_path.exists() {
                        // Read and parse manifest
                        if let Ok(manifest_content) = std::fs::read_to_string(&manifest_path) {
                            if let Ok(manifest) =
                                serde_json::from_str::<serde_json::Value>(&manifest_content)
                            {
                                // Extract plugin info from manifest
                                // Check if plugin is enabled (for now, we'll use a simple static check)
                                let plugin_id = manifest["id"].as_str().unwrap_or("unknown");
                                let is_enabled = ENABLED_PLUGINS
                                    .lock()
                                    .unwrap()
                                    .contains(&plugin_id.to_string());

                                let plugin_info = PluginInfo {
                                    id: plugin_id.to_string(),
                                    name: manifest["name"]
                                        .as_str()
                                        .unwrap_or("Unknown Plugin")
                                        .to_string(),
                                    version: manifest["version"]
                                        .as_str()
                                        .unwrap_or("0.0.0")
                                        .to_string(),
                                    author: manifest["author"]
                                        .as_str()
                                        .unwrap_or("Unknown")
                                        .to_string(),
                                    description: manifest["description"]
                                        .as_str()
                                        .unwrap_or("")
                                        .to_string(),
                                    enabled: is_enabled,
                                    permissions: manifest["permissions"]
                                        .as_array()
                                        .map(|arr| {
                                            arr.iter()
                                                .filter_map(|v| v.as_str().map(String::from))
                                                .collect()
                                        })
                                        .unwrap_or_default(),
                                    resource_usage: ResourceUsage {
                                        memory_mb: 0.0,
                                        cpu_percent: 0.0,
                                        storage_mb: 0.0,
                                        network_requests: 0,
                                    },
                                    settings: HashMap::new(),
                                    status: if is_enabled {
                                        PluginStatus::Active
                                    } else {
                                        PluginStatus::Inactive
                                    },
                                    icon: None,
                                    homepage: manifest["repository"].as_str().map(String::from),
                                };

                                plugins.push(plugin_info);
                                println!(
                                    "Found plugin: {}",
                                    manifest["name"].as_str().unwrap_or("Unknown")
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    println!("Found {} plugins", plugins.len());
    Ok(plugins)
}

// Install a plugin from local file
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_install(options: InstallOptions) -> Result<PluginInfo, String> {
    // let mut runtime = runtime.lock().await;

    // Validate plugin package
    if !options.path.exists() {
        return Err("Plugin file not found".to_string());
    }

    // Extract and validate manifest
    // TODO: Implement actual installation logic

    // Mock response for now
    Ok(PluginInfo {
        id: "new-plugin".to_string(),
        name: "New Plugin".to_string(),
        version: "1.0.0".to_string(),
        author: "Unknown".to_string(),
        description: "Newly installed plugin".to_string(),
        enabled: options.auto_enable,
        permissions: vec![],
        resource_usage: ResourceUsage {
            memory_mb: 0.0,
            cpu_percent: 0.0,
            storage_mb: 0.0,
            network_requests: 0,
        },
        settings: HashMap::new(),
        status: if options.auto_enable {
            PluginStatus::Active
        } else {
            PluginStatus::Inactive
        },
        icon: None,
        homepage: None,
    })
}

// Enable a plugin
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_enable(plugin_id: String) -> Result<(), String> {
    println!("Enabling plugin: {}", plugin_id);

    // Add to enabled plugins set
    ENABLED_PLUGINS.lock().unwrap().insert(plugin_id.clone());

    // In production, this would:
    // - Load plugin manifest
    // - Initialize plugin sandbox
    // - Start plugin WebView
    // - Register plugin commands

    Ok(())
}

// Disable a plugin
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_disable(plugin_id: String) -> Result<(), String> {
    println!("Disabling plugin: {}", plugin_id);

    // Remove from enabled plugins set
    ENABLED_PLUGINS.lock().unwrap().remove(&plugin_id);

    // In production, this would:
    // - Stop plugin WebView
    // - Clean up resources
    // - Unregister plugin commands
    // - Save state

    Ok(())
}

// Uninstall a plugin
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_uninstall(plugin_id: String) -> Result<(), String> {
    // let mut runtime = runtime.lock().await;

    // Stop plugin if running
    // Remove plugin files
    // Clean up settings

    // TODO: Implement actual uninstall logic
    println!("Uninstalling plugin: {}", plugin_id);

    Ok(())
}

// Get plugin settings
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_get_settings(
    plugin_id: String,
) -> Result<HashMap<String, serde_json::Value>, String> {
    // let runtime = runtime.lock().await;

    // Load settings from storage
    // TODO: Implement actual settings retrieval

    // Mock settings for Readwise plugin
    if plugin_id == "readwise" {
        let mut settings = HashMap::new();
        settings.insert(
            "apiToken".to_string(),
            serde_json::Value::String("".to_string()),
        );
        settings.insert(
            "syncFrequency".to_string(),
            serde_json::Value::Number(60.into()),
        );
        settings.insert("autoSync".to_string(), serde_json::Value::Bool(false));
        settings.insert(
            "highlightsFolder".to_string(),
            serde_json::Value::String("Readwise".to_string()),
        );
        settings.insert(
            "groupBy".to_string(),
            serde_json::Value::String("book".to_string()),
        );
        return Ok(settings);
    }

    Ok(HashMap::new())
}

// Update plugin settings
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_update_settings(settings: PluginSettings) -> Result<(), String> {
    // let mut runtime = runtime.lock().await;

    // Validate settings
    // Save to storage
    // Notify plugin of changes

    // TODO: Implement actual settings update
    println!("Updating settings for plugin: {}", settings.plugin_id);

    Ok(())
}

// Get plugin resource usage
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_get_resources(plugin_id: String) -> Result<ResourceUsage, String> {
    // let runtime = runtime.lock().await;

    // Get resource monitor data
    // TODO: Implement actual resource monitoring

    Ok(ResourceUsage {
        memory_mb: 42.5,
        cpu_percent: 2.3,
        storage_mb: 15.2,
        network_requests: 127,
    })
}

// Request permission for a plugin
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_request_permission(request: PermissionRequest) -> Result<bool, String> {
    // let mut runtime = runtime.lock().await;

    // Show permission dialog to user
    // Save user decision
    // Update plugin permissions

    // TODO: Implement actual permission request
    println!(
        "Permission request for {}: {}",
        request.plugin_id, request.permission
    );

    // Mock approval
    Ok(true)
}

// Get plugin logs
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_get_logs(
    plugin_id: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    // let runtime = runtime.lock().await;

    // Retrieve plugin logs
    // TODO: Implement actual log retrieval

    Ok(vec![
        format!("[INFO] Plugin {} initialized", plugin_id),
        format!("[DEBUG] Loading settings for {}", plugin_id),
        format!("[INFO] Plugin {} ready", plugin_id),
    ])
}

// Clear plugin data
// #[tauri::command] // DEPRECATED
pub async fn _old_plugin_clear_data(plugin_id: String) -> Result<(), String> {
    // let mut runtime = runtime.lock().await;

    // Clear plugin storage
    // Reset settings to defaults
    // Clear cache

    // TODO: Implement actual data clearing
    println!("Clearing data for plugin: {}", plugin_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests commented out as they reference deprecated functions
    // TODO: Update tests to use new plugin management API

    // #[tokio::test]
    // async fn test_plugin_list() {
    //     let result = _old_plugin_list().await;
    //     assert!(result.is_ok());
    //
    //     let plugins = result.unwrap();
    //     assert!(plugins.len() > 0);
    //     assert_eq!(plugins[0].id, "readwise");
    // }

    // #[tokio::test]
    // async fn test_plugin_enable_disable() {
    //     let enable_result = _old_plugin_enable("readwise".to_string()).await;
    //     assert!(enable_result.is_ok());
    //
    //     let disable_result = _old_plugin_disable("readwise".to_string()).await;
    //     assert!(disable_result.is_ok());
    // }

    // #[tokio::test]
    // async fn test_plugin_settings() {
    //     let settings = _old_plugin_get_settings("readwise".to_string()).await;
    //     assert!(settings.is_ok());
    //
    //     let settings_map = settings.unwrap();
    //     assert!(settings_map.contains_key("apiToken"));
    //     assert!(settings_map.contains_key("syncFrequency"));
    //
    //     let update_settings = PluginSettings {
    //         plugin_id: "readwise".to_string(),
    //         settings: settings_map,
    //     };
    //
    //     let update_result = _old_plugin_update_settings(update_settings).await;
    //     assert!(update_result.is_ok());
    // }
}
