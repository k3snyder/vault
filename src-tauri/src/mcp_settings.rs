use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MCPServerConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: MCPTransportConfig,
    pub capabilities: MCPCapabilities,
    pub permissions: MCPPermissions,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum MCPTransportConfig {
    #[serde(rename = "stdio")]
    Stdio {
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        working_dir: Option<String>,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        headers: HashMap<String, String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MCPCapabilities {
    pub tools: bool,
    pub resources: bool,
    pub prompts: bool,
    pub sampling: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MCPPermissions {
    pub read: bool,
    pub write: bool,
    pub delete: bool,
    pub external_access: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct MCPSettings {
    pub enabled: bool,
    pub servers: HashMap<String, MCPServerConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcpServerRegistry: Option<serde_json::Value>,
}

impl Default for MCPSettings {
    fn default() -> Self {
        MCPSettings {
            enabled: true,
            servers: HashMap::new(),
            mcpServerRegistry: None,
        }
    }
}

#[tauri::command]
pub async fn save_mcp_settings(app: AppHandle, settings: MCPSettings) -> Result<(), String> {
    println!("Saving MCP settings...");

    // Clone settings and strip working_dir from all stdio transports
    // working_dir should always be set at runtime from the current vault, not persisted
    let mut clean_settings = settings;
    for (_id, config) in clean_settings.servers.iter_mut() {
        if let MCPTransportConfig::Stdio { working_dir, .. } = &mut config.transport {
            *working_dir = None;
        }
    }

    // Save to store
    let store = app
        .store("mcp_settings.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let value = serde_json::to_value(&clean_settings).map_err(|e| e.to_string())?;
    store.set("settings", value);

    store
        .save()
        .map_err(|e| format!("Failed to persist settings: {}", e))?;

    println!("MCP settings saved successfully (working_dir stripped from stdio transports)");
    Ok(())
}

#[tauri::command]
pub async fn get_mcp_settings(app: AppHandle) -> Result<MCPSettings, String> {
    println!("Loading MCP settings...");

    let store = app
        .store("mcp_settings.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let Some(value) = store.get("settings") else {
        println!("No MCP settings found, returning defaults");
        return Ok(MCPSettings::default());
    };

    let mut settings: MCPSettings = serde_json::from_value(value.clone())
        .map_err(|e| format!("Failed to parse settings: {}", e))?;

    // CRITICAL: Clear working_dir from all stdio transports
    // working_dir must be set at runtime from the current vault, not from stale saved settings
    for (id, config) in settings.servers.iter_mut() {
        if let MCPTransportConfig::Stdio { working_dir, .. } = &mut config.transport {
            if working_dir.is_some() {
                println!("⚠️  Clearing stale working_dir for server: {}", id);
                *working_dir = None;
            }
        }
    }

    Ok(settings)
}

#[tauri::command]
pub async fn save_mcp_server_config(
    app: AppHandle,
    server_id: String,
    config: MCPServerConfig,
) -> Result<(), String> {
    println!("Saving MCP server config for: {}", server_id);

    // Load existing settings
    let mut settings = get_mcp_settings(app.clone()).await?;

    // Update or add server config
    settings.servers.insert(server_id, config);

    // Save back
    save_mcp_settings(app, settings).await?;

    Ok(())
}

#[tauri::command]
pub async fn delete_mcp_server_config(app: AppHandle, server_id: String) -> Result<(), String> {
    println!("Deleting MCP server config: {}", server_id);

    // Load existing settings
    let mut settings = get_mcp_settings(app.clone()).await?;

    // Remove server config
    settings.servers.remove(&server_id);

    // Save back
    save_mcp_settings(app, settings).await?;

    Ok(())
}

#[tauri::command]
pub async fn get_mcp_server_config(
    app: AppHandle,
    server_id: String,
) -> Result<Option<MCPServerConfig>, String> {
    let settings = get_mcp_settings(app).await?;
    Ok(settings.servers.get(&server_id).cloned())
}

#[tauri::command]
pub async fn list_mcp_server_configs(app: AppHandle) -> Result<Vec<MCPServerConfig>, String> {
    let settings = get_mcp_settings(app).await?;
    Ok(settings.servers.into_values().collect())
}
