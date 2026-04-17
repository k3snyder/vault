// Plugin Manager - Manages plugin lifecycle and operations

use super::scanner::PluginScanner;
use super::types::{
    InstallOptions, InstallSource, Plugin, PluginError, PluginManifest, PluginMetadata,
    PluginStatus,
};
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct PluginManager {
    scanner: Arc<PluginScanner>,
    plugins: Arc<RwLock<HashMap<String, Plugin>>>,
    enabled_plugins: Arc<RwLock<HashMap<String, bool>>>,
    plugins_dir: PathBuf,
    app_data_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugins_dir: PathBuf, app_data_dir: PathBuf) -> Self {
        let scanner = Arc::new(PluginScanner::new(
            plugins_dir.clone(),
            app_data_dir.clone(),
        ));

        Self {
            scanner,
            plugins: Arc::new(RwLock::new(HashMap::new())),
            enabled_plugins: Arc::new(RwLock::new(HashMap::new())),
            plugins_dir,
            app_data_dir,
        }
    }

    /// Initialize the plugin manager and load all plugins
    pub async fn initialize(&self) -> Result<(), PluginError> {
        // Ensure directories exist
        std::fs::create_dir_all(&self.plugins_dir)?;
        std::fs::create_dir_all(&self.app_data_dir)?;

        // Scan and load all plugins
        self.refresh_plugins().await?;

        Ok(())
    }

    /// Refresh the list of plugins from disk
    pub async fn refresh_plugins(&self) -> Result<Vec<Plugin>, PluginError> {
        let discovered_plugins = self.scanner.scan_plugins().await?;

        let mut plugins = self.plugins.write().await;
        let mut enabled = self.enabled_plugins.write().await;

        plugins.clear();
        enabled.clear();

        for plugin in &discovered_plugins {
            plugins.insert(plugin.id.clone(), plugin.clone());
            enabled.insert(plugin.id.clone(), plugin.enabled);
        }

        Ok(discovered_plugins)
    }

    /// Get all plugins
    pub async fn list_plugins(&self) -> Vec<Plugin> {
        let plugins = self.plugins.read().await;
        plugins.values().cloned().collect()
    }

    /// Get a specific plugin
    pub async fn get_plugin(&self, plugin_id: &str) -> Option<Plugin> {
        let plugins = self.plugins.read().await;
        plugins.get(plugin_id).cloned()
    }

    /// Install a plugin
    pub async fn install_plugin(&self, options: InstallOptions) -> Result<Plugin, PluginError> {
        let plugin_path = match options.source {
            InstallSource::Local { path } => self.install_from_local(path, options.force).await?,
            InstallSource::Url { url } => self.install_from_url(url, options.force).await?,
            InstallSource::Registry { package_id } => {
                return Err(PluginError::InstallationFailed(
                    "Registry installation not yet implemented".to_string(),
                ));
            }
        };

        // Load the installed plugin
        let enabled_plugins = self.enabled_plugins.read().await;
        let plugin = self
            .scanner
            .load_plugin_from_dir(&plugin_path, &enabled_plugins)
            .await?;

        // Save metadata
        let metadata = PluginMetadata {
            install_date: Utc::now().to_rfc3339(),
            update_date: None,
            last_enabled: if options.auto_enable {
                Some(Utc::now().to_rfc3339())
            } else {
                None
            },
            last_disabled: None,
            usage_count: 0,
            error_count: 0,
        };
        self.scanner
            .save_plugin_metadata(&plugin.id, &metadata)
            .await?;

        // Add to plugins map
        let mut plugins = self.plugins.write().await;
        plugins.insert(plugin.id.clone(), plugin.clone());

        // Auto-enable if requested
        if options.auto_enable {
            drop(plugins);
            drop(enabled_plugins);
            self.enable_plugin(&plugin.id).await?;
        }

        Ok(plugin)
    }

    /// Install from local directory or archive
    async fn install_from_local(
        &self,
        source_path: PathBuf,
        force: bool,
    ) -> Result<PathBuf, PluginError> {
        if !source_path.exists() {
            return Err(PluginError::NotFound(
                "Source path does not exist".to_string(),
            ));
        }

        // Check if it's a directory or archive
        if source_path.is_dir() {
            // Validate manifest
            let manifest_path = source_path.join("manifest.json");
            if !manifest_path.exists() {
                return Err(PluginError::InvalidManifest(
                    "manifest.json not found".to_string(),
                ));
            }

            let manifest_content = std::fs::read_to_string(&manifest_path)?;
            let manifest: PluginManifest = serde_json::from_str(&manifest_content)?;
            self.scanner.validate_manifest(&manifest)?;

            // Check if already installed
            let target_dir = self.plugins_dir.join(&manifest.id);
            if target_dir.exists() && !force {
                return Err(PluginError::AlreadyInstalled(manifest.id));
            }

            // Copy plugin to plugins directory
            if target_dir.exists() {
                std::fs::remove_dir_all(&target_dir)?;
            }

            self.copy_dir_recursive(&source_path, &target_dir)?;

            Ok(target_dir)
        } else {
            // Handle archive files (.zip, .tar.gz)
            // For now, return error
            Err(PluginError::InstallationFailed(
                "Archive installation not yet implemented".to_string(),
            ))
        }
    }

    /// Install from URL
    async fn install_from_url(&self, url: String, force: bool) -> Result<PathBuf, PluginError> {
        // TODO: Download and install from URL
        Err(PluginError::InstallationFailed(
            "URL installation not yet implemented".to_string(),
        ))
    }

    /// Enable a plugin
    pub async fn enable_plugin(&self, plugin_id: &str) -> Result<(), PluginError> {
        let mut plugins = self.plugins.write().await;
        let plugin = plugins
            .get_mut(plugin_id)
            .ok_or_else(|| PluginError::NotFound(plugin_id.to_string()))?;

        if plugin.enabled {
            return Ok(()); // Already enabled
        }

        plugin.enabled = true;
        plugin.status = PluginStatus::Active;

        // Update enabled plugins map
        let mut enabled = self.enabled_plugins.write().await;
        enabled.insert(plugin_id.to_string(), true);

        // Save to disk
        self.scanner.save_enabled_plugins(&enabled).await?;

        // Update metadata
        if let Ok(mut metadata) = self.load_plugin_metadata(plugin_id).await {
            metadata.last_enabled = Some(Utc::now().to_rfc3339());
            self.scanner
                .save_plugin_metadata(plugin_id, &metadata)
                .await?;
        }

        Ok(())
    }

    /// Disable a plugin
    pub async fn disable_plugin(&self, plugin_id: &str) -> Result<(), PluginError> {
        let mut plugins = self.plugins.write().await;
        let plugin = plugins
            .get_mut(plugin_id)
            .ok_or_else(|| PluginError::NotFound(plugin_id.to_string()))?;

        if !plugin.enabled {
            return Ok(()); // Already disabled
        }

        plugin.enabled = false;
        plugin.status = PluginStatus::Inactive;

        // Update enabled plugins map
        let mut enabled = self.enabled_plugins.write().await;
        enabled.insert(plugin_id.to_string(), false);

        // Save to disk
        self.scanner.save_enabled_plugins(&enabled).await?;

        // Update metadata
        if let Ok(mut metadata) = self.load_plugin_metadata(plugin_id).await {
            metadata.last_disabled = Some(Utc::now().to_rfc3339());
            self.scanner
                .save_plugin_metadata(plugin_id, &metadata)
                .await?;
        }

        Ok(())
    }

    /// Uninstall a plugin
    pub async fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), PluginError> {
        // First disable if enabled
        if let Some(plugin) = self.get_plugin(plugin_id).await {
            if plugin.enabled {
                self.disable_plugin(plugin_id).await?;
            }
        }

        // Remove from plugins map
        let mut plugins = self.plugins.write().await;
        plugins.remove(plugin_id);

        // Remove from enabled map
        let mut enabled = self.enabled_plugins.write().await;
        enabled.remove(plugin_id);
        self.scanner.save_enabled_plugins(&enabled).await?;

        // Delete plugin directory
        let plugin_dir = self.plugins_dir.join(plugin_id);
        if plugin_dir.exists() {
            std::fs::remove_dir_all(&plugin_dir)?;
        }

        // Delete metadata and settings
        let metadata_file = self
            .app_data_dir
            .join("metadata")
            .join(format!("{}.json", plugin_id));
        if metadata_file.exists() {
            std::fs::remove_file(&metadata_file)?;
        }

        let settings_file = self
            .app_data_dir
            .join("settings")
            .join(format!("{}.json", plugin_id));
        if settings_file.exists() {
            std::fs::remove_file(&settings_file)?;
        }

        Ok(())
    }

    /// Get plugin settings
    pub async fn get_plugin_settings(
        &self,
        plugin_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, PluginError> {
        let plugins = self.plugins.read().await;
        let plugin = plugins
            .get(plugin_id)
            .ok_or_else(|| PluginError::NotFound(plugin_id.to_string()))?;

        Ok(plugin.settings.clone())
    }

    /// Update plugin settings
    pub async fn update_plugin_settings(
        &self,
        plugin_id: &str,
        settings: HashMap<String, serde_json::Value>,
    ) -> Result<(), PluginError> {
        let mut plugins = self.plugins.write().await;
        let plugin = plugins
            .get_mut(plugin_id)
            .ok_or_else(|| PluginError::NotFound(plugin_id.to_string()))?;

        plugin.settings = settings.clone();

        // Save to disk
        self.scanner
            .save_plugin_settings(plugin_id, &settings)
            .await?;

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

    /// Recursively copy directory
    fn copy_dir_recursive(&self, src: &Path, dst: &Path) -> Result<(), PluginError> {
        std::fs::create_dir_all(dst)?;

        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if src_path.is_dir() {
                self.copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                std::fs::copy(&src_path, &dst_path)?;
            }
        }

        Ok(())
    }
}
