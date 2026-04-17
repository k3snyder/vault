// Plugin Lifecycle Manager - Handles plugin installation, activation, and removal

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Plugin manifest structure with support for multiple field formats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(alias = "main", alias = "entry_point", alias = "entryPoint")]
    pub entry_point: String,
    #[serde(default, deserialize_with = "normalize_permissions")]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
    #[serde(default)]
    pub metadata: PluginMetadata,
    // Support for additional fields from different manifest formats
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_api_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_api_version: Option<String>,
}

/// Normalize permissions from dot-separated to colon-separated format
fn normalize_permissions<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let permissions: Vec<String> = Vec::deserialize(deserializer)?;
    Ok(permissions
        .into_iter()
        .map(|p| p.replace('.', ":")) // Convert vault.read to vault:read
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginMetadata {
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub license: Option<String>,
    pub min_vault_version: Option<String>,
    pub max_vault_version: Option<String>,
}

/// Plugin state that persists across restarts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginState {
    pub plugin_id: String,
    pub enabled: bool,
    pub settings: HashMap<String, Value>,
    pub last_activated: Option<chrono::DateTime<chrono::Utc>>,
    pub activation_count: u32,
}

/// Manages plugin lifecycle operations
pub struct LifecycleManager {
    manifests: Arc<RwLock<HashMap<String, PluginManifest>>>,
    states: Arc<RwLock<HashMap<String, PluginState>>>,
    plugin_dir: PathBuf,
}

impl LifecycleManager {
    pub fn new() -> Self {
        Self {
            manifests: Arc::new(RwLock::new(HashMap::new())),
            states: Arc::new(RwLock::new(HashMap::new())),
            plugin_dir: Self::default_plugin_dir(),
        }
    }

    /// Get the default plugin directory
    fn default_plugin_dir() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("vault")
            .join("plugins")
    }

    /// Validate a plugin manifest
    pub async fn validate_manifest(
        &self,
        manifest_path: &str,
    ) -> Result<PluginManifest, LifecycleError> {
        let path = Path::new(manifest_path);

        if !path.exists() {
            return Err(LifecycleError::ManifestNotFound(manifest_path.to_string()));
        }

        // Read manifest file
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| LifecycleError::ManifestReadError(e.to_string()))?;

        // Parse manifest
        let manifest: PluginManifest = serde_json::from_str(&content)
            .map_err(|e| LifecycleError::ManifestParseError(e.to_string()))?;

        // Validate required fields
        if manifest.name.is_empty() {
            return Err(LifecycleError::InvalidManifest(
                "Name is required".to_string(),
            ));
        }

        if manifest.version.is_empty() {
            return Err(LifecycleError::InvalidManifest(
                "Version is required".to_string(),
            ));
        }

        if manifest.entry_point.is_empty() {
            return Err(LifecycleError::InvalidManifest(
                "Entry point is required".to_string(),
            ));
        }

        // Validate version format (semantic versioning)
        if !self.is_valid_version(&manifest.version) {
            return Err(LifecycleError::InvalidManifest(format!(
                "Invalid version format: {}",
                manifest.version
            )));
        }

        Ok(manifest)
    }

    /// Install a plugin from a local directory
    pub async fn install_plugin(&self, source_dir: &Path) -> Result<String, LifecycleError> {
        // Look for manifest file
        let manifest_path = source_dir.join("manifest.json");
        let manifest = self
            .validate_manifest(manifest_path.to_str().unwrap())
            .await?;

        // Generate plugin ID
        let plugin_id = format!("{}@{}", manifest.name, manifest.version);

        // Create plugin directory
        let plugin_install_dir = self.plugin_dir.join(&plugin_id);
        tokio::fs::create_dir_all(&plugin_install_dir)
            .await
            .map_err(|e| LifecycleError::InstallError(e.to_string()))?;

        // Copy plugin files
        self.copy_plugin_files(source_dir, &plugin_install_dir)
            .await?;

        // Store manifest
        let mut manifests = self.manifests.write().await;
        manifests.insert(plugin_id.clone(), manifest);

        // Initialize plugin state
        let mut states = self.states.write().await;
        states.insert(
            plugin_id.clone(),
            PluginState {
                plugin_id: plugin_id.clone(),
                enabled: false,
                settings: HashMap::new(),
                last_activated: None,
                activation_count: 0,
            },
        );

        Ok(plugin_id)
    }

    /// Uninstall a plugin
    pub async fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), LifecycleError> {
        // Remove from manifests
        let mut manifests = self.manifests.write().await;
        manifests.remove(plugin_id);

        // Remove from states
        let mut states = self.states.write().await;
        states.remove(plugin_id);

        // Remove plugin directory
        let plugin_dir = self.plugin_dir.join(plugin_id);
        if plugin_dir.exists() {
            tokio::fs::remove_dir_all(&plugin_dir)
                .await
                .map_err(|e| LifecycleError::UninstallError(e.to_string()))?;
        }

        Ok(())
    }

    /// Activate a plugin
    pub async fn activate_plugin(&self, plugin_id: &str) -> Result<(), LifecycleError> {
        let mut states = self.states.write().await;

        let state = states
            .get_mut(plugin_id)
            .ok_or(LifecycleError::PluginNotFound)?;

        state.enabled = true;
        state.last_activated = Some(chrono::Utc::now());
        state.activation_count += 1;

        Ok(())
    }

    /// Deactivate a plugin
    pub async fn deactivate_plugin(&self, plugin_id: &str) -> Result<(), LifecycleError> {
        let mut states = self.states.write().await;

        let state = states
            .get_mut(plugin_id)
            .ok_or(LifecycleError::PluginNotFound)?;

        state.enabled = false;

        Ok(())
    }

    /// Get plugin state
    pub async fn get_plugin_state(&self, plugin_id: &str) -> Option<PluginState> {
        let states = self.states.read().await;
        states.get(plugin_id).cloned()
    }

    /// Update plugin settings
    pub async fn update_plugin_settings(
        &self,
        plugin_id: &str,
        settings: HashMap<String, Value>,
    ) -> Result<(), LifecycleError> {
        let mut states = self.states.write().await;

        let state = states
            .get_mut(plugin_id)
            .ok_or(LifecycleError::PluginNotFound)?;

        state.settings = settings;

        Ok(())
    }

    /// List all installed plugins
    pub async fn list_plugins(&self) -> Vec<(String, PluginManifest, PluginState)> {
        let manifests = self.manifests.read().await;
        let states = self.states.read().await;

        manifests
            .iter()
            .filter_map(|(id, manifest)| {
                states
                    .get(id)
                    .map(|state| (id.clone(), manifest.clone(), state.clone()))
            })
            .collect()
    }

    /// Check if a version string is valid semantic versioning
    fn is_valid_version(&self, version: &str) -> bool {
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() != 3 {
            return false;
        }

        parts.iter().all(|part| part.parse::<u32>().is_ok())
    }

    /// Copy plugin files from source to destination
    async fn copy_plugin_files(&self, source: &Path, dest: &Path) -> Result<(), LifecycleError> {
        // In a real implementation, this would recursively copy files
        // For now, just ensure the directory exists
        tokio::fs::create_dir_all(dest)
            .await
            .map_err(|e| LifecycleError::InstallError(e.to_string()))?;

        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error("Manifest not found: {0}")]
    ManifestNotFound(String),

    #[error("Failed to read manifest: {0}")]
    ManifestReadError(String),

    #[error("Failed to parse manifest: {0}")]
    ManifestParseError(String),

    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),

    #[error("Plugin not found")]
    PluginNotFound,

    #[error("Installation failed: {0}")]
    InstallError(String),

    #[error("Uninstall failed: {0}")]
    UninstallError(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_manifest_parsing_runtime_format() {
        // Test runtime format with entry_point and colon-separated permissions
        let manifest_json = json!({
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "Test plugin",
            "author": "Test Author",
            "entry_point": "index.js",
            "permissions": ["vault:read", "vault:write", "workspace:read"]
        });

        let manifest: PluginManifest = serde_json::from_value(manifest_json).unwrap();
        assert_eq!(manifest.name, "test-plugin");
        assert_eq!(manifest.entry_point, "index.js");
        assert_eq!(
            manifest.permissions,
            vec!["vault:read", "vault:write", "workspace:read"]
        );
    }

    #[tokio::test]
    async fn test_manifest_parsing_typescript_format() {
        // Test TypeScript format with entryPoint (camelCase) and minApiVersion
        let manifest_json = json!({
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "Test plugin",
            "author": "Test Author",
            "entryPoint": "main.ts",
            "permissions": ["vault:read"],
            "minApiVersion": "0.1.0"
        });

        let manifest: PluginManifest = serde_json::from_value(manifest_json).unwrap();
        assert_eq!(manifest.name, "test-plugin");
        assert_eq!(manifest.entry_point, "main.ts");
        assert_eq!(manifest.permissions, vec!["vault:read"]);
        assert_eq!(manifest.min_api_version, Some("0.1.0".to_string()));
    }

    #[tokio::test]
    async fn test_manifest_parsing_readwise_format() {
        // Test Readwise format with main and dot-separated permissions
        let manifest_json = json!({
            "name": "readwise-official",
            "version": "1.0.5",
            "description": "Official Readwise plugin",
            "author": "Readwise",
            "main": "main.js",
            "permissions": ["vault.read", "vault.write", "workspace.read", "network.request"]
        });

        let manifest: PluginManifest = serde_json::from_value(manifest_json).unwrap();
        assert_eq!(manifest.name, "readwise-official");
        assert_eq!(manifest.entry_point, "main.js");
        // Permissions should be normalized from dot to colon
        assert_eq!(
            manifest.permissions,
            vec![
                "vault:read",
                "vault:write",
                "workspace:read",
                "network:request"
            ]
        );
    }

    #[tokio::test]
    async fn test_manifest_with_metadata() {
        let manifest_json = json!({
            "name": "advanced-plugin",
            "version": "2.0.0",
            "main": "plugin.js",
            "metadata": {
                "icon": "icon.png",
                "homepage": "https://example.com",
                "repository": "https://github.com/example/plugin",
                "license": "MIT",
                "minVaultVersion": "1.0.0",
                "maxVaultVersion": "2.0.0"
            }
        });

        let manifest: PluginManifest = serde_json::from_value(manifest_json).unwrap();
        assert_eq!(manifest.name, "advanced-plugin");
        assert_eq!(manifest.metadata.icon, Some("icon.png".to_string()));
        assert_eq!(
            manifest.metadata.homepage,
            Some("https://example.com".to_string())
        );
        assert_eq!(manifest.metadata.license, Some("MIT".to_string()));
    }

    #[tokio::test]
    async fn test_manifest_minimal() {
        // Test minimal manifest with only required fields
        let manifest_json = json!({
            "name": "minimal-plugin",
            "version": "0.1.0",
            "main": "index.js"
        });

        let manifest: PluginManifest = serde_json::from_value(manifest_json).unwrap();
        assert_eq!(manifest.name, "minimal-plugin");
        assert_eq!(manifest.version, "0.1.0");
        assert_eq!(manifest.entry_point, "index.js");
        assert!(manifest.permissions.is_empty());
        assert!(manifest.dependencies.is_empty());
    }

    #[tokio::test]
    async fn test_lifecycle_manager_creation() {
        let manager = LifecycleManager::new();
        let plugins = manager.list_plugins().await;
        assert_eq!(plugins.len(), 0);
    }

    #[test]
    fn test_version_validation() {
        let manager = LifecycleManager::new();

        assert!(manager.is_valid_version("1.0.0"));
        assert!(manager.is_valid_version("0.1.0"));
        assert!(manager.is_valid_version("10.20.30"));

        assert!(!manager.is_valid_version("1.0"));
        assert!(!manager.is_valid_version("1.0.0.0"));
        assert!(!manager.is_valid_version("v1.0.0"));
        assert!(!manager.is_valid_version("1.a.0"));
    }

    #[tokio::test]
    async fn test_plugin_state_management() {
        let manager = LifecycleManager::new();

        // Manually insert a test state
        let mut states = manager.states.write().await;
        states.insert(
            "test_plugin".to_string(),
            PluginState {
                plugin_id: "test_plugin".to_string(),
                enabled: false,
                settings: HashMap::new(),
                last_activated: None,
                activation_count: 0,
            },
        );
        drop(states);

        // Activate plugin
        manager.activate_plugin("test_plugin").await.unwrap();

        let state = manager.get_plugin_state("test_plugin").await;
        assert!(state.is_some());

        let state = state.unwrap();
        assert!(state.enabled);
        assert_eq!(state.activation_count, 1);
        assert!(state.last_activated.is_some());

        // Deactivate plugin
        manager.deactivate_plugin("test_plugin").await.unwrap();

        let state = manager.get_plugin_state("test_plugin").await.unwrap();
        assert!(!state.enabled);
    }
}
