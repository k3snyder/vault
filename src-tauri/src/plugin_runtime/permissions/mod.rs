// Permission System - Manages plugin capabilities and user consent

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Represents a plugin permission
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Permission {
    pub capability: Capability,
    pub granted: bool,
    pub granted_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Available plugin capabilities
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type")]
pub enum Capability {
    // Vault access
    VaultRead { paths: Vec<String> },
    VaultWrite { paths: Vec<String> },
    VaultDelete { paths: Vec<String> },

    // Workspace access
    WorkspaceRead,
    WorkspaceWrite,
    WorkspaceCreate,

    // Settings access
    SettingsRead { keys: Vec<String> },
    SettingsWrite { keys: Vec<String> },

    // Graph access
    GraphRead,
    GraphWrite,
    GraphQuery,

    // MCP access
    McpInvoke { tools: Vec<String> },

    // Network access
    NetworkAccess { domains: Vec<String> },

    // System capabilities
    ClipboardRead,
    ClipboardWrite,
    NotificationShow,

    // Advanced capabilities
    WebAssembly,
    WebWorkers,
    LocalStorage,
}

/// Manages permissions for all plugins
pub struct PermissionManager {
    permissions: Arc<RwLock<HashMap<String, HashSet<Permission>>>>,
    consent_cache: Arc<RwLock<HashMap<String, ConsentDecision>>>,
}

#[derive(Debug, Clone)]
struct ConsentDecision {
    plugin_id: String,
    capability: Capability,
    granted: bool,
    timestamp: DateTime<Utc>,
    remember: bool,
}

impl PermissionManager {
    pub fn new() -> Self {
        Self {
            permissions: Arc::new(RwLock::new(HashMap::new())),
            consent_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Check if a plugin has specific permissions
    pub async fn check_permissions(&self, requested: &[String]) -> Result<(), PermissionError> {
        // Parse requested permissions
        let capabilities = self.parse_permission_strings(requested)?;

        // Check each capability
        for capability in capabilities {
            if !self.is_capability_allowed(&capability) {
                return Err(PermissionError::Denied(format!("{:?}", capability)));
            }
        }

        Ok(())
    }

    /// Grant permissions to a plugin
    pub async fn grant_permissions(
        &self,
        plugin_id: &str,
        permissions: Vec<Permission>,
    ) -> Result<(), PermissionError> {
        let mut plugin_perms = self.permissions.write().await;

        let entry = plugin_perms
            .entry(plugin_id.to_string())
            .or_insert_with(HashSet::new);

        for mut permission in permissions {
            permission.granted = true;
            permission.granted_at = Some(Utc::now());
            entry.insert(permission);
        }

        Ok(())
    }

    /// Revoke permissions from a plugin
    pub async fn revoke_permissions(
        &self,
        plugin_id: &str,
        capabilities: Vec<Capability>,
    ) -> Result<(), PermissionError> {
        let mut plugin_perms = self.permissions.write().await;

        if let Some(permissions) = plugin_perms.get_mut(plugin_id) {
            permissions.retain(|perm| !capabilities.contains(&perm.capability));
        }

        Ok(())
    }

    /// Check if a plugin has a specific capability
    pub async fn has_capability(&self, plugin_id: &str, capability: &Capability) -> bool {
        let plugin_perms = self.permissions.read().await;

        if let Some(permissions) = plugin_perms.get(plugin_id) {
            permissions.iter().any(|perm| {
                perm.capability == *capability && perm.granted && !self.is_expired(perm)
            })
        } else {
            false
        }
    }

    /// Request user consent for a capability
    pub async fn request_consent(
        &self,
        plugin_id: &str,
        capability: Capability,
    ) -> Result<bool, PermissionError> {
        // Check consent cache first
        let cache_key = format!("{}:{:?}", plugin_id, capability);
        let cache = self.consent_cache.read().await;

        if let Some(decision) = cache.get(&cache_key) {
            if decision.remember {
                return Ok(decision.granted);
            }
        }

        // In a real implementation, this would show a UI dialog
        // For now, we'll simulate consent based on capability type
        let granted = self.simulate_user_consent(&capability);

        // Store decision in cache
        drop(cache);
        let mut cache = self.consent_cache.write().await;
        cache.insert(
            cache_key,
            ConsentDecision {
                plugin_id: plugin_id.to_string(),
                capability: capability.clone(),
                granted,
                timestamp: Utc::now(),
                remember: true,
            },
        );

        Ok(granted)
    }

    /// Get all permissions for a plugin
    pub async fn get_plugin_permissions(&self, plugin_id: &str) -> Vec<Permission> {
        let plugin_perms = self.permissions.read().await;

        plugin_perms
            .get(plugin_id)
            .map(|perms| perms.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Clear all permissions for a plugin
    pub async fn clear_plugin_permissions(&self, plugin_id: &str) {
        let mut plugin_perms = self.permissions.write().await;
        plugin_perms.remove(plugin_id);

        // Also clear consent cache
        let mut cache = self.consent_cache.write().await;
        cache.retain(|key, _| !key.starts_with(&format!("{}:", plugin_id)));
    }

    /// Parse permission strings into capabilities
    fn parse_permission_strings(
        &self,
        permissions: &[String],
    ) -> Result<Vec<Capability>, PermissionError> {
        let mut capabilities = Vec::new();

        for perm_str in permissions {
            let capability = match perm_str.as_str() {
                "vault:read" => Capability::VaultRead {
                    paths: vec!["*".to_string()],
                },
                "vault:write" => Capability::VaultWrite {
                    paths: vec!["*".to_string()],
                },
                "vault:delete" => Capability::VaultDelete {
                    paths: vec!["*".to_string()],
                },
                "workspace:read" => Capability::WorkspaceRead,
                "workspace:write" => Capability::WorkspaceWrite,
                "workspace:create" => Capability::WorkspaceCreate,
                "settings:read" => Capability::SettingsRead {
                    keys: vec!["*".to_string()],
                },
                "settings:write" => Capability::SettingsWrite {
                    keys: vec!["*".to_string()],
                },
                "graph:read" => Capability::GraphRead,
                "graph:write" => Capability::GraphWrite,
                "graph:query" => Capability::GraphQuery,
                "clipboard:read" => Capability::ClipboardRead,
                "clipboard:write" => Capability::ClipboardWrite,
                "notifications" => Capability::NotificationShow,
                "wasm" => Capability::WebAssembly,
                "workers" => Capability::WebWorkers,
                "storage" => Capability::LocalStorage,
                perm if perm.starts_with("network:") => {
                    let domain = perm.strip_prefix("network:").unwrap();
                    Capability::NetworkAccess {
                        domains: vec![domain.to_string()],
                    }
                }
                perm if perm.starts_with("mcp:") => {
                    let tool = perm.strip_prefix("mcp:").unwrap();
                    Capability::McpInvoke {
                        tools: vec![tool.to_string()],
                    }
                }
                _ => return Err(PermissionError::InvalidPermission(perm_str.clone())),
            };

            capabilities.push(capability);
        }

        Ok(capabilities)
    }

    /// Check if a capability is allowed by default
    fn is_capability_allowed(&self, capability: &Capability) -> bool {
        // Some capabilities might be allowed by default
        // Most require explicit user consent
        matches!(
            capability,
            Capability::VaultRead { .. }
                | Capability::WorkspaceRead
                | Capability::SettingsRead { .. }
        )
    }

    /// Check if a permission has expired
    fn is_expired(&self, permission: &Permission) -> bool {
        if let Some(expires_at) = permission.expires_at {
            Utc::now() > expires_at
        } else {
            false
        }
    }

    /// Simulate user consent (for testing)
    fn simulate_user_consent(&self, capability: &Capability) -> bool {
        // In a real implementation, this would show a UI dialog
        // For testing, grant safe permissions and deny dangerous ones
        match capability {
            Capability::VaultRead { .. } => true,
            Capability::WorkspaceRead => true,
            Capability::SettingsRead { .. } => true,
            Capability::NotificationShow => true,
            Capability::VaultWrite { .. } => false,
            Capability::VaultDelete { .. } => false,
            Capability::NetworkAccess { .. } => false,
            _ => false,
        }
    }

    /// Persist permissions to storage
    pub async fn persist_permissions(&self, plugin_id: &str) -> Result<(), PermissionError> {
        use std::fs;
        use std::path::PathBuf;

        // Create permissions directory if it doesn't exist
        let permissions_dir = PathBuf::from("/tmp/vault-permissions");
        fs::create_dir_all(&permissions_dir).map_err(|e| {
            PermissionError::Denied(format!("Failed to create permissions directory: {}", e))
        })?;

        // Get plugin permissions
        let permissions = self.get_plugin_permissions(plugin_id).await;

        // Serialize permissions to JSON
        let json = serde_json::to_string_pretty(&permissions).map_err(|e| {
            PermissionError::Denied(format!("Failed to serialize permissions: {}", e))
        })?;

        // Write to file
        let file_path = permissions_dir.join(format!("{}.json", plugin_id));
        fs::write(file_path, json)
            .map_err(|e| PermissionError::Denied(format!("Failed to write permissions: {}", e)))?;

        Ok(())
    }

    /// Load permissions from storage
    pub async fn load_permissions(&self, plugin_id: &str) -> Result<(), PermissionError> {
        use std::fs;
        use std::path::PathBuf;

        let permissions_dir = PathBuf::from("/tmp/vault-permissions");
        let file_path = permissions_dir.join(format!("{}.json", plugin_id));

        // Check if file exists
        if !file_path.exists() {
            return Ok(()); // No permissions to load
        }

        // Read file
        let json = fs::read_to_string(file_path)
            .map_err(|e| PermissionError::Denied(format!("Failed to read permissions: {}", e)))?;

        // Deserialize permissions
        let permissions: Vec<Permission> = serde_json::from_str(&json).map_err(|e| {
            PermissionError::Denied(format!("Failed to deserialize permissions: {}", e))
        })?;

        // Grant loaded permissions
        if !permissions.is_empty() {
            self.grant_permissions(plugin_id, permissions).await?;
        }

        Ok(())
    }

    /// Generate CSP policy for a plugin based on its permissions
    pub async fn generate_csp_for_plugin(
        &self,
        plugin_id: &str,
    ) -> Result<String, PermissionError> {
        use crate::plugin_runtime::sandbox::csp;

        let permissions = self.get_plugin_permissions(plugin_id).await;
        let permission_strings: Vec<String> = permissions
            .iter()
            .filter(|p| p.granted && !self.is_expired(p))
            .map(|p| self.capability_to_permission_string(&p.capability))
            .collect();

        Ok(csp::generate_csp_for_permissions(&permission_strings))
    }

    /// Convert capability to permission string for CSP
    fn capability_to_permission_string(&self, capability: &Capability) -> String {
        match capability {
            Capability::NetworkAccess { domains } => {
                if domains.is_empty() {
                    "network:*".to_string()
                } else {
                    // Return the first domain with network: prefix
                    format!("network:{}", domains[0])
                }
            }
            Capability::WebWorkers => "workers".to_string(),
            Capability::WebAssembly => "wasm".to_string(),
            _ => String::new(),
        }
    }

    /// Check if a path is allowed by permissions
    pub async fn check_path_permission(
        &self,
        plugin_id: &str,
        path: &str,
        permission_type: VaultPermission,
    ) -> Result<(), PermissionError> {
        let capability = match permission_type {
            VaultPermission::Read => Capability::VaultRead { paths: vec![] },
            VaultPermission::Write => Capability::VaultWrite { paths: vec![] },
            VaultPermission::Delete => Capability::VaultDelete { paths: vec![] },
        };

        let permissions = self.get_plugin_permissions(plugin_id).await;

        for perm in permissions {
            if !perm.granted || self.is_expired(&perm) {
                continue;
            }

            match &perm.capability {
                Capability::VaultRead { paths }
                    if matches!(permission_type, VaultPermission::Read) =>
                {
                    if self.path_matches_patterns(path, paths) {
                        return Ok(());
                    }
                }
                Capability::VaultWrite { paths }
                    if matches!(permission_type, VaultPermission::Write) =>
                {
                    if self.path_matches_patterns(path, paths) {
                        return Ok(());
                    }
                }
                Capability::VaultDelete { paths }
                    if matches!(permission_type, VaultPermission::Delete) =>
                {
                    if self.path_matches_patterns(path, paths) {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }

        Err(PermissionError::Denied(format!(
            "Plugin {} lacks {:?} permission for path: {}",
            plugin_id, permission_type, path
        )))
    }

    /// Check if a path matches any of the allowed patterns
    fn path_matches_patterns(&self, path: &str, patterns: &[String]) -> bool {
        for pattern in patterns {
            if pattern == "*" {
                return true;
            }

            if pattern.ends_with("/*") {
                let prefix = &pattern[..pattern.len() - 2];
                if path.starts_with(prefix) {
                    return true;
                }
            }

            if path == pattern {
                return true;
            }
        }

        false
    }

    /// Check if a network request is allowed
    pub async fn check_network_permission(
        &self,
        plugin_id: &str,
        url: &str,
    ) -> Result<(), PermissionError> {
        let permissions = self.get_plugin_permissions(plugin_id).await;

        for perm in permissions {
            if !perm.granted || self.is_expired(&perm) {
                continue;
            }

            if let Capability::NetworkAccess { domains } = &perm.capability {
                for domain in domains {
                    if domain == "*" || url.starts_with(domain) {
                        return Ok(());
                    }
                }
            }
        }

        Err(PermissionError::Denied(format!(
            "Plugin {} lacks network permission for URL: {}",
            plugin_id, url
        )))
    }

    /// Simulate user consent response (for testing)
    pub async fn simulate_user_consent_response(
        &self,
        request: &ConsentRequest,
        response: ConsentResponse,
    ) -> Result<(), PermissionError> {
        match response {
            ConsentResponse::Deny => {
                // Do nothing, permission remains denied
                Ok(())
            }
            ConsentResponse::GrantOnce => {
                // Grant permission temporarily (1 hour)
                let permission = Permission {
                    capability: request.capability.clone(),
                    granted: true,
                    granted_at: Some(Utc::now()),
                    expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
                };
                self.grant_permissions(&request.plugin_id, vec![permission])
                    .await
            }
            ConsentResponse::GrantAlways => {
                // Grant permission permanently
                let permission = Permission {
                    capability: request.capability.clone(),
                    granted: true,
                    granted_at: Some(Utc::now()),
                    expires_at: None,
                };
                self.grant_permissions(&request.plugin_id, vec![permission])
                    .await
            }
        }
    }
}

/// Vault permission types for path checking
#[derive(Debug, Clone, PartialEq)]
pub enum VaultPermission {
    Read,
    Write,
    Delete,
}

/// Consent request structure for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsentRequest {
    pub plugin_id: String,
    pub plugin_name: String,
    pub capability: Capability,
    pub reason: String,
    pub consequences: Vec<String>,
}

/// User's consent response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConsentResponse {
    Deny,
    GrantOnce,
    GrantAlways,
}

#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    #[error("Permission denied: {0}")]
    Denied(String),

    #[error("Invalid permission string: {0}")]
    InvalidPermission(String),

    #[error("Consent required for: {0}")]
    ConsentRequired(String),

    #[error("Permission expired")]
    Expired,
}

#[cfg(test)]
mod enforcement_tests;

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_permission_manager_creation() {
        let manager = PermissionManager::new();
        let perms = manager.get_plugin_permissions("test").await;
        assert_eq!(perms.len(), 0);
    }

    #[tokio::test]
    async fn test_grant_and_revoke_permissions() {
        let manager = PermissionManager::new();

        // Grant permissions
        let permissions = vec![
            Permission {
                capability: Capability::VaultRead {
                    paths: vec!["*".to_string()],
                },
                granted: false,
                granted_at: None,
                expires_at: None,
            },
            Permission {
                capability: Capability::WorkspaceRead,
                granted: false,
                granted_at: None,
                expires_at: None,
            },
        ];

        manager
            .grant_permissions("test_plugin", permissions)
            .await
            .unwrap();

        // Check permissions were granted
        let perms = manager.get_plugin_permissions("test_plugin").await;
        assert_eq!(perms.len(), 2);
        assert!(perms.iter().all(|p| p.granted));

        // Revoke one permission
        manager
            .revoke_permissions(
                "test_plugin",
                vec![Capability::VaultRead {
                    paths: vec!["*".to_string()],
                }],
            )
            .await
            .unwrap();

        let perms = manager.get_plugin_permissions("test_plugin").await;
        assert_eq!(perms.len(), 1);
    }

    #[tokio::test]
    async fn test_capability_checking() {
        let manager = PermissionManager::new();

        let permission = Permission {
            capability: Capability::WorkspaceWrite,
            granted: true,
            granted_at: Some(Utc::now()),
            expires_at: None,
        };

        manager
            .grant_permissions("test_plugin", vec![permission])
            .await
            .unwrap();

        // Check has capability
        let has_cap = manager
            .has_capability("test_plugin", &Capability::WorkspaceWrite)
            .await;
        assert!(has_cap);

        let has_cap = manager
            .has_capability("test_plugin", &Capability::WorkspaceCreate)
            .await;
        assert!(!has_cap);
    }

    #[test]
    fn test_parse_permission_strings() {
        let manager = PermissionManager::new();

        let permissions = vec![
            "vault:read".to_string(),
            "workspace:write".to_string(),
            "network:https://api.example.com".to_string(),
            "mcp:readwise".to_string(),
        ];

        let capabilities = manager.parse_permission_strings(&permissions).unwrap();
        assert_eq!(capabilities.len(), 4);

        // Test invalid permission
        let invalid = vec!["invalid:permission".to_string()];
        let result = manager.parse_permission_strings(&invalid);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_consent_caching() {
        let manager = PermissionManager::new();

        // First request should simulate consent
        let granted = manager
            .request_consent(
                "test_plugin",
                Capability::VaultRead {
                    paths: vec!["*".to_string()],
                },
            )
            .await
            .unwrap();
        assert!(granted); // VaultRead is allowed in simulation

        // Second request should use cache
        let granted2 = manager
            .request_consent(
                "test_plugin",
                Capability::VaultRead {
                    paths: vec!["*".to_string()],
                },
            )
            .await
            .unwrap();
        assert_eq!(granted, granted2);
    }
}
