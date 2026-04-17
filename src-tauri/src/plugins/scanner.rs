// Plugin Scanner - Discovers and validates plugins from filesystem

use super::types::{Plugin, PluginError, PluginManifest, PluginMetadata, PluginStatus};
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub struct PluginScanner {
    plugins_dir: PathBuf,
    app_data_dir: PathBuf,
}

impl PluginScanner {
    pub fn new(plugins_dir: PathBuf, app_data_dir: PathBuf) -> Self {
        Self {
            plugins_dir,
            app_data_dir,
        }
    }

    /// Scan plugins directory for all available plugins
    pub async fn scan_plugins(&self) -> Result<Vec<Plugin>, PluginError> {
        let mut plugins = Vec::new();

        println!(
            "PluginScanner: Scanning plugins directory: {:?}",
            self.plugins_dir
        );

        // Ensure plugins directory exists
        if !self.plugins_dir.exists() {
            println!(
                "PluginScanner: Plugins directory does not exist, creating: {:?}",
                self.plugins_dir
            );
            std::fs::create_dir_all(&self.plugins_dir)?;
            return Ok(plugins);
        }

        // Load enabled plugins list
        let enabled_plugins = match self.load_enabled_plugins().await {
            Ok(enabled) => {
                println!(
                    "PluginScanner: Loaded enabled plugins: {:?}",
                    enabled.keys().collect::<Vec<_>>()
                );
                enabled
            }
            Err(e) => {
                println!(
                    "PluginScanner: Failed to load enabled plugins: {}, using empty map",
                    e
                );
                HashMap::new()
            }
        };

        // Scan each subdirectory in plugins folder
        let entries = std::fs::read_dir(&self.plugins_dir)?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            println!("PluginScanner: Checking path: {:?}", path);

            if path.is_dir() {
                match self.load_plugin_from_dir(&path, &enabled_plugins).await {
                    Ok(plugin) => {
                        println!(
                            "PluginScanner: Successfully loaded plugin: {} v{}",
                            plugin.name, plugin.version
                        );
                        plugins.push(plugin);
                    }
                    Err(e) => {
                        eprintln!(
                            "PluginScanner: Failed to load plugin from {:?}: {}",
                            path, e
                        );
                    }
                }
            }
        }

        println!("PluginScanner: Found {} plugins total", plugins.len());
        Ok(plugins)
    }

    /// Load a single plugin from a directory
    pub async fn load_plugin_from_dir(
        &self,
        dir: &Path,
        enabled_plugins: &HashMap<String, bool>,
    ) -> Result<Plugin, PluginError> {
        let manifest_path = dir.join("manifest.json");

        if !manifest_path.exists() {
            return Err(PluginError::InvalidManifest(
                "manifest.json not found".to_string(),
            ));
        }

        // Read and parse manifest
        let manifest_content = std::fs::read_to_string(&manifest_path)?;
        let manifest: PluginManifest = serde_json::from_str(&manifest_content)?;

        // Load plugin metadata if exists
        let metadata = self
            .load_plugin_metadata(&manifest.id)
            .await
            .unwrap_or_else(|_| PluginMetadata {
                install_date: Utc::now().to_rfc3339(),
                update_date: None,
                last_enabled: None,
                last_disabled: None,
                usage_count: 0,
                error_count: 0,
            });

        // Load plugin settings if exists
        let settings = self
            .load_plugin_settings(&manifest.id)
            .await
            .unwrap_or_default();

        // Check if plugin is enabled
        let enabled = enabled_plugins.get(&manifest.id).copied().unwrap_or(false);

        // Determine plugin status
        let status = if enabled {
            PluginStatus::Active
        } else {
            PluginStatus::Inactive
        };

        Ok(Plugin {
            id: manifest.id.clone(),
            name: manifest.name,
            version: manifest.version,
            author: manifest.author,
            description: manifest.description,
            enabled,
            installed: true,
            path: dir.to_path_buf(),
            manifest_path: manifest_path.clone(),
            entry_point: manifest.entry_point,
            permissions: manifest.permissions,
            dependencies: manifest.dependencies,
            settings,
            settings_schema: manifest.settings_schema,
            status,
            icon: manifest.icon,
            homepage: manifest.homepage,
            repository: manifest.repository,
            category: manifest.category,
            tags: manifest.tags,
            min_app_version: manifest.min_app_version,
            max_app_version: manifest.max_app_version,
        })
    }

    /// Validate a plugin manifest
    pub fn validate_manifest(&self, manifest: &PluginManifest) -> Result<(), PluginError> {
        // Check required fields
        if manifest.id.is_empty() {
            return Err(PluginError::InvalidManifest(
                "Plugin ID is required".to_string(),
            ));
        }

        if manifest.name.is_empty() {
            return Err(PluginError::InvalidManifest(
                "Plugin name is required".to_string(),
            ));
        }

        if manifest.version.is_empty() {
            return Err(PluginError::InvalidManifest(
                "Plugin version is required".to_string(),
            ));
        }

        // Validate version format (basic semver check)
        if !self.is_valid_semver(&manifest.version) {
            return Err(PluginError::InvalidManifest(
                "Invalid version format".to_string(),
            ));
        }

        // Check for dangerous permissions
        for permission in &manifest.permissions {
            if permission == "system:*" || permission == "fs:write:*" {
                // These would need user confirmation
                eprintln!(
                    "Warning: Plugin {} requests dangerous permission: {}",
                    manifest.id, permission
                );
            }
        }

        Ok(())
    }

    /// Check if a plugin exists
    pub fn plugin_exists(&self, plugin_id: &str) -> bool {
        let plugin_dir = self.plugins_dir.join(plugin_id);
        plugin_dir.exists() && plugin_dir.join("manifest.json").exists()
    }

    /// Get plugin directory path
    pub fn get_plugin_dir(&self, plugin_id: &str) -> PathBuf {
        self.plugins_dir.join(plugin_id)
    }

    /// Load enabled plugins from storage
    async fn load_enabled_plugins(&self) -> Result<HashMap<String, bool>, PluginError> {
        let enabled_file = self.app_data_dir.join("enabled_plugins.json");

        if !enabled_file.exists() {
            return Ok(HashMap::new());
        }

        let content = std::fs::read_to_string(&enabled_file)?;
        let enabled: HashMap<String, bool> = serde_json::from_str(&content)?;
        Ok(enabled)
    }

    /// Save enabled plugins to storage
    pub async fn save_enabled_plugins(
        &self,
        enabled: &HashMap<String, bool>,
    ) -> Result<(), PluginError> {
        let enabled_file = self.app_data_dir.join("enabled_plugins.json");

        // Ensure directory exists
        if let Some(parent) = enabled_file.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let content = serde_json::to_string_pretty(enabled)?;
        std::fs::write(&enabled_file, content)?;
        Ok(())
    }

    /// Load plugin metadata
    async fn load_plugin_metadata(&self, plugin_id: &str) -> Result<PluginMetadata, PluginError> {
        let metadata_file = self
            .app_data_dir
            .join("metadata")
            .join(format!("{}.json", plugin_id));

        if !metadata_file.exists() {
            return Err(PluginError::NotFound("Metadata not found".to_string()));
        }

        let content = std::fs::read_to_string(&metadata_file)?;
        let metadata: PluginMetadata = serde_json::from_str(&content)?;
        Ok(metadata)
    }

    /// Save plugin metadata
    pub async fn save_plugin_metadata(
        &self,
        plugin_id: &str,
        metadata: &PluginMetadata,
    ) -> Result<(), PluginError> {
        let metadata_dir = self.app_data_dir.join("metadata");
        std::fs::create_dir_all(&metadata_dir)?;

        let metadata_file = metadata_dir.join(format!("{}.json", plugin_id));
        let content = serde_json::to_string_pretty(metadata)?;
        std::fs::write(&metadata_file, content)?;
        Ok(())
    }

    /// Load plugin settings
    async fn load_plugin_settings(
        &self,
        plugin_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, PluginError> {
        let settings_file = self
            .app_data_dir
            .join("settings")
            .join(format!("{}.json", plugin_id));

        if !settings_file.exists() {
            return Ok(HashMap::new());
        }

        let content = std::fs::read_to_string(&settings_file)?;
        let settings: HashMap<String, serde_json::Value> = serde_json::from_str(&content)?;
        Ok(settings)
    }

    /// Save plugin settings
    pub async fn save_plugin_settings(
        &self,
        plugin_id: &str,
        settings: &HashMap<String, serde_json::Value>,
    ) -> Result<(), PluginError> {
        let settings_dir = self.app_data_dir.join("settings");
        std::fs::create_dir_all(&settings_dir)?;

        let settings_file = settings_dir.join(format!("{}.json", plugin_id));
        let content = serde_json::to_string_pretty(settings)?;
        std::fs::write(&settings_file, content)?;
        Ok(())
    }

    /// Basic semver validation
    fn is_valid_semver(&self, version: &str) -> bool {
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() != 3 {
            return false;
        }

        for part in parts {
            if part.parse::<u32>().is_err() {
                return false;
            }
        }

        true
    }
}
