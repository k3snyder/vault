// Tauri commands for plugin permission management

use super::permissions::{Capability, ConsentRequest, ConsentResponse, PermissionManager};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// Request permission from the user for a plugin capability
#[tauri::command]
pub async fn plugin_request_permission_v2(
    plugin_id: String,
    plugin_name: String,
    capability: String,
    reason: String,
    permission_manager: State<'_, Arc<RwLock<PermissionManager>>>,
) -> Result<bool, String> {
    // Parse capability string
    let parsed_capability =
        parse_capability_string(&capability).map_err(|e| format!("Invalid capability: {}", e))?;

    // Check if permission is already granted
    let manager = permission_manager.read().await;
    if manager.has_capability(&plugin_id, &parsed_capability).await {
        return Ok(true);
    }

    // Create consent request
    let consent_request = ConsentRequest {
        plugin_id: plugin_id.clone(),
        plugin_name,
        capability: parsed_capability.clone(),
        reason,
        consequences: get_capability_consequences(&parsed_capability),
    };

    // In production, this would trigger a UI dialog
    // For now, we'll auto-approve safe permissions and deny dangerous ones
    let response = if is_safe_capability(&parsed_capability) {
        ConsentResponse::GrantAlways
    } else {
        // In production, show UI and wait for user response
        ConsentResponse::Deny
    };

    // Process the response
    manager
        .simulate_user_consent_response(&consent_request, response)
        .await
        .map_err(|e| format!("Failed to process consent: {}", e))?;

    // Return whether permission was granted
    Ok(manager.has_capability(&plugin_id, &parsed_capability).await)
}

/// Get current permissions for a plugin
#[tauri::command]
pub async fn plugin_get_permissions(
    plugin_id: String,
    permission_manager: State<'_, Arc<RwLock<PermissionManager>>>,
) -> Result<Vec<PermissionInfo>, String> {
    let manager = permission_manager.read().await;
    let permissions = manager.get_plugin_permissions(&plugin_id).await;

    Ok(permissions
        .into_iter()
        .map(|p| PermissionInfo {
            capability: capability_to_string(&p.capability),
            granted: p.granted,
            granted_at: p.granted_at.map(|dt| dt.to_rfc3339()),
            expires_at: p.expires_at.map(|dt| dt.to_rfc3339()),
        })
        .collect())
}

/// Revoke a permission from a plugin
#[tauri::command]
pub async fn plugin_revoke_permission(
    plugin_id: String,
    capability: String,
    permission_manager: State<'_, Arc<RwLock<PermissionManager>>>,
) -> Result<(), String> {
    let parsed_capability =
        parse_capability_string(&capability).map_err(|e| format!("Invalid capability: {}", e))?;

    let manager = permission_manager.read().await;
    manager
        .revoke_permissions(&plugin_id, vec![parsed_capability])
        .await
        .map_err(|e| format!("Failed to revoke permission: {}", e))
}

/// Clear all permissions for a plugin
#[tauri::command]
pub async fn plugin_clear_permissions(
    plugin_id: String,
    permission_manager: State<'_, Arc<RwLock<PermissionManager>>>,
) -> Result<(), String> {
    let manager = permission_manager.read().await;
    manager.clear_plugin_permissions(&plugin_id).await;
    Ok(())
}

/// Check if a plugin has a specific capability
#[tauri::command]
pub async fn plugin_has_capability(
    plugin_id: String,
    capability: String,
    permission_manager: State<'_, Arc<RwLock<PermissionManager>>>,
) -> Result<bool, String> {
    let parsed_capability =
        parse_capability_string(&capability).map_err(|e| format!("Invalid capability: {}", e))?;

    let manager = permission_manager.read().await;
    Ok(manager.has_capability(&plugin_id, &parsed_capability).await)
}

/// Permission info for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionInfo {
    pub capability: String,
    pub granted: bool,
    pub granted_at: Option<String>,
    pub expires_at: Option<String>,
}

/// Parse a capability string into a Capability enum
fn parse_capability_string(capability: &str) -> Result<Capability, String> {
    match capability {
        "vault:read" => Ok(Capability::VaultRead {
            paths: vec!["*".to_string()],
        }),
        "vault:write" => Ok(Capability::VaultWrite {
            paths: vec!["*".to_string()],
        }),
        "vault:delete" => Ok(Capability::VaultDelete {
            paths: vec!["*".to_string()],
        }),
        "workspace:read" => Ok(Capability::WorkspaceRead),
        "workspace:write" => Ok(Capability::WorkspaceWrite),
        "workspace:create" => Ok(Capability::WorkspaceCreate),
        "settings:read" => Ok(Capability::SettingsRead {
            keys: vec!["*".to_string()],
        }),
        "settings:write" => Ok(Capability::SettingsWrite {
            keys: vec!["*".to_string()],
        }),
        "graph:read" => Ok(Capability::GraphRead),
        "graph:write" => Ok(Capability::GraphWrite),
        "graph:query" => Ok(Capability::GraphQuery),
        "clipboard:read" => Ok(Capability::ClipboardRead),
        "clipboard:write" => Ok(Capability::ClipboardWrite),
        "notifications" => Ok(Capability::NotificationShow),
        "wasm" => Ok(Capability::WebAssembly),
        "workers" => Ok(Capability::WebWorkers),
        "storage" => Ok(Capability::LocalStorage),
        cap if cap.starts_with("network:") => {
            let domain = cap.strip_prefix("network:").unwrap();
            Ok(Capability::NetworkAccess {
                domains: vec![domain.to_string()],
            })
        }
        cap if cap.starts_with("mcp:") => {
            let tool = cap.strip_prefix("mcp:").unwrap();
            Ok(Capability::McpInvoke {
                tools: vec![tool.to_string()],
            })
        }
        cap if cap.starts_with("vault:read:") => {
            let path = cap.strip_prefix("vault:read:").unwrap();
            Ok(Capability::VaultRead {
                paths: vec![path.to_string()],
            })
        }
        cap if cap.starts_with("vault:write:") => {
            let path = cap.strip_prefix("vault:write:").unwrap();
            Ok(Capability::VaultWrite {
                paths: vec![path.to_string()],
            })
        }
        _ => Err(format!("Unknown capability: {}", capability)),
    }
}

/// Convert a Capability to a string representation
fn capability_to_string(capability: &Capability) -> String {
    match capability {
        Capability::VaultRead { paths } => {
            if paths.len() == 1 && paths[0] == "*" {
                "vault:read".to_string()
            } else {
                format!("vault:read:{}", paths.join(","))
            }
        }
        Capability::VaultWrite { paths } => {
            if paths.len() == 1 && paths[0] == "*" {
                "vault:write".to_string()
            } else {
                format!("vault:write:{}", paths.join(","))
            }
        }
        Capability::VaultDelete { paths } => {
            if paths.len() == 1 && paths[0] == "*" {
                "vault:delete".to_string()
            } else {
                format!("vault:delete:{}", paths.join(","))
            }
        }
        Capability::WorkspaceRead => "workspace:read".to_string(),
        Capability::WorkspaceWrite => "workspace:write".to_string(),
        Capability::WorkspaceCreate => "workspace:create".to_string(),
        Capability::SettingsRead { keys } => {
            if keys.len() == 1 && keys[0] == "*" {
                "settings:read".to_string()
            } else {
                format!("settings:read:{}", keys.join(","))
            }
        }
        Capability::SettingsWrite { keys } => {
            if keys.len() == 1 && keys[0] == "*" {
                "settings:write".to_string()
            } else {
                format!("settings:write:{}", keys.join(","))
            }
        }
        Capability::GraphRead => "graph:read".to_string(),
        Capability::GraphWrite => "graph:write".to_string(),
        Capability::GraphQuery => "graph:query".to_string(),
        Capability::ClipboardRead => "clipboard:read".to_string(),
        Capability::ClipboardWrite => "clipboard:write".to_string(),
        Capability::NotificationShow => "notifications".to_string(),
        Capability::WebAssembly => "wasm".to_string(),
        Capability::WebWorkers => "workers".to_string(),
        Capability::LocalStorage => "storage".to_string(),
        Capability::NetworkAccess { domains } => {
            if domains.is_empty() || (domains.len() == 1 && domains[0] == "*") {
                "network:*".to_string()
            } else {
                format!("network:{}", domains.join(","))
            }
        }
        Capability::McpInvoke { tools } => {
            format!("mcp:{}", tools.join(","))
        }
    }
}

/// Get human-readable consequences for a capability
fn get_capability_consequences(capability: &Capability) -> Vec<String> {
    match capability {
        Capability::VaultRead { paths } => vec![
            format!("Read files from: {}", paths.join(", ")),
            "Access file contents and metadata".to_string(),
        ],
        Capability::VaultWrite { paths } => vec![
            format!("Write files to: {}", paths.join(", ")),
            "Create and modify files".to_string(),
            "Potentially overwrite existing content".to_string(),
        ],
        Capability::VaultDelete { paths } => vec![
            format!("Delete files from: {}", paths.join(", ")),
            "Permanently remove files".to_string(),
            "Data loss possible".to_string(),
        ],
        Capability::WorkspaceRead => vec![
            "Access current workspace state".to_string(),
            "Read active file information".to_string(),
        ],
        Capability::WorkspaceWrite => vec![
            "Modify workspace layout".to_string(),
            "Open and close files".to_string(),
        ],
        Capability::WorkspaceCreate => vec![
            "Create new workspace views".to_string(),
            "Add panels and tabs".to_string(),
        ],
        Capability::SettingsRead { keys } => vec![
            format!("Read settings: {}", keys.join(", ")),
            "Access configuration values".to_string(),
        ],
        Capability::SettingsWrite { keys } => vec![
            format!("Modify settings: {}", keys.join(", ")),
            "Change configuration values".to_string(),
        ],
        Capability::GraphRead => vec![
            "Query knowledge graph".to_string(),
            "Read node and edge data".to_string(),
        ],
        Capability::GraphWrite => vec![
            "Modify knowledge graph".to_string(),
            "Create and update connections".to_string(),
        ],
        Capability::GraphQuery => vec![
            "Execute graph queries".to_string(),
            "Perform complex graph operations".to_string(),
        ],
        Capability::ClipboardRead => vec![
            "Read clipboard contents".to_string(),
            "Access copied text and data".to_string(),
        ],
        Capability::ClipboardWrite => vec![
            "Write to clipboard".to_string(),
            "Replace clipboard contents".to_string(),
        ],
        Capability::NotificationShow => vec![
            "Show system notifications".to_string(),
            "Display alerts to user".to_string(),
        ],
        Capability::WebAssembly => vec![
            "Execute WebAssembly code".to_string(),
            "Run compiled binary modules".to_string(),
        ],
        Capability::WebWorkers => vec![
            "Create background workers".to_string(),
            "Run code in parallel threads".to_string(),
        ],
        Capability::LocalStorage => vec![
            "Store data locally".to_string(),
            "Persist plugin state".to_string(),
        ],
        Capability::NetworkAccess { domains } => vec![
            format!("Connect to: {}", domains.join(", ")),
            "Send and receive data over network".to_string(),
            "Potential data exfiltration risk".to_string(),
        ],
        Capability::McpInvoke { tools } => vec![
            format!("Use MCP tools: {}", tools.join(", ")),
            "Execute external server functions".to_string(),
        ],
    }
}

/// Check if a capability is considered safe for auto-approval
fn is_safe_capability(capability: &Capability) -> bool {
    matches!(
        capability,
        Capability::VaultRead { .. }
            | Capability::WorkspaceRead
            | Capability::SettingsRead { .. }
            | Capability::GraphRead
            | Capability::NotificationShow
            | Capability::LocalStorage
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_capability_string() {
        assert!(matches!(
            parse_capability_string("vault:read").unwrap(),
            Capability::VaultRead { .. }
        ));

        assert!(matches!(
            parse_capability_string("network:https://api.example.com").unwrap(),
            Capability::NetworkAccess { .. }
        ));

        assert!(matches!(
            parse_capability_string("vault:write:/Readwise/*").unwrap(),
            Capability::VaultWrite { paths } if paths[0] == "/Readwise/*"
        ));

        assert!(parse_capability_string("invalid:capability").is_err());
    }

    #[test]
    fn test_capability_to_string() {
        let cap = Capability::VaultRead {
            paths: vec!["*".to_string()],
        };
        assert_eq!(capability_to_string(&cap), "vault:read");

        let cap = Capability::NetworkAccess {
            domains: vec!["https://api.example.com".to_string()],
        };
        assert_eq!(
            capability_to_string(&cap),
            "network:https://api.example.com"
        );

        let cap = Capability::VaultWrite {
            paths: vec!["/Readwise/*".to_string()],
        };
        assert_eq!(capability_to_string(&cap), "vault:write:/Readwise/*");
    }

    #[test]
    fn test_is_safe_capability() {
        assert!(is_safe_capability(&Capability::VaultRead {
            paths: vec!["*".to_string()]
        }));
        assert!(is_safe_capability(&Capability::WorkspaceRead));
        assert!(is_safe_capability(&Capability::NotificationShow));

        assert!(!is_safe_capability(&Capability::VaultWrite {
            paths: vec!["*".to_string()]
        }));
        assert!(!is_safe_capability(&Capability::VaultDelete {
            paths: vec!["*".to_string()]
        }));
        assert!(!is_safe_capability(&Capability::NetworkAccess {
            domains: vec!["*".to_string()]
        }));
    }

    #[test]
    fn test_get_capability_consequences() {
        let cap = Capability::VaultWrite {
            paths: vec!["/Readwise/*".to_string()],
        };
        let consequences = get_capability_consequences(&cap);

        assert!(consequences.len() > 0);
        assert!(consequences[0].contains("/Readwise/*"));
        assert!(consequences.iter().any(|c| c.contains("Create and modify")));
    }
}
