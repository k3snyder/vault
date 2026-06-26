// Plugin Scanner - Discovers and validates plugins from filesystem

use super::types::{Plugin, PluginError, PluginManifest, PluginMetadata, PluginStatus};
use crate::secrets::{decrypt_string, derive_key, encrypt_string};
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// Secrets are stored AES-GCM-encrypted inside the plugin's settings JSON.
// Vault deliberately never touches the OS keychain; the legacy sentinel below
// marks records from the brief keychain era and resolves to "re-enter the key".
const PLUGIN_SECRET_SALT: &[u8] = b"vault_plugin_secrets_v1";
const LEGACY_KEYRING_SENTINEL_KEY: &str = "__keyring__";
const ENCRYPTED_SENTINEL_KEY: &str = "__encrypted__";

pub struct PluginScanner {
    plugins_dir: PathBuf,
    app_data_dir: PathBuf,
}

pub fn secret_keys(schema: Option<&serde_json::Value>) -> Vec<String> {
    schema
        .and_then(|schema| schema.as_object())
        .map(|fields| {
            fields
                .iter()
                .filter(|&(key, definition)| {
                    definition.get("secret").and_then(|value| value.as_bool()) == Some(true)
                })
                .map(|(key, definition)| key.clone())
                .collect()
        })
        .unwrap_or_default()
}

fn plugin_secret_encryption_key(plugin_id: &str) -> [u8; 32] {
    derive_key(PLUGIN_SECRET_SALT, plugin_id)
}

fn is_legacy_keyring_sentinel(value: &serde_json::Value) -> bool {
    value
        .as_object()
        .and_then(|object| object.get(LEGACY_KEYRING_SENTINEL_KEY))
        .and_then(|value| value.as_bool())
        == Some(true)
}

fn encrypted_envelope(blob: String) -> serde_json::Value {
    serde_json::json!({ ENCRYPTED_SENTINEL_KEY: blob })
}

fn envelope_blob(value: &serde_json::Value) -> Option<&str> {
    value.as_object()?.get(ENCRYPTED_SENTINEL_KEY)?.as_str()
}

fn redact_secret_settings(
    plugin_id: &str,
    settings: &HashMap<String, serde_json::Value>,
    secret_keys: &[String],
) -> Result<HashMap<String, serde_json::Value>, PluginError> {
    let mut persisted = settings.clone();

    for key in secret_keys {
        let Some(value) = settings.get(key) else {
            continue;
        };

        // Already-redacted values round-trip unchanged.
        if envelope_blob(value).is_some() || is_legacy_keyring_sentinel(value) {
            continue;
        }

        if let Some(secret) = value.as_str().filter(|secret| !secret.is_empty()) {
            let blob =
                encrypt_string(secret, &plugin_secret_encryption_key(plugin_id)).map_err(|e| {
                    PluginError::InstallationFailed(format!(
                        "Failed to encrypt plugin secret {plugin_id}.{key}: {e}"
                    ))
                })?;
            persisted.insert(key.clone(), encrypted_envelope(blob));
        }
    }

    Ok(persisted)
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
                println!("PluginScanner: Failed to load enabled plugins: {e}, using empty map");
                HashMap::new()
            }
        };

        // Scan each subdirectory in plugins folder
        let entries = std::fs::read_dir(&self.plugins_dir)?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            println!("PluginScanner: Checking path: {path:?}");

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
                        eprintln!("PluginScanner: Failed to load plugin from {path:?}: {e}");
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
        let mut settings = self
            .load_plugin_settings(&manifest.id)
            .await
            .unwrap_or_default();
        settings = self
            .resolve_secret_settings(&manifest.id, &settings, manifest.settings_schema.as_ref())
            .await?;

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
            .join(format!("{plugin_id}.json"));

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

        let metadata_file = metadata_dir.join(format!("{plugin_id}.json"));
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
            .join(format!("{plugin_id}.json"));

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

        let settings_file = settings_dir.join(format!("{plugin_id}.json"));
        let content = serde_json::to_string_pretty(settings)?;
        std::fs::write(&settings_file, content)?;
        Ok(())
    }

    pub async fn save_plugin_settings_with_schema(
        &self,
        plugin_id: &str,
        settings: &HashMap<String, serde_json::Value>,
        schema: Option<&serde_json::Value>,
    ) -> Result<(), PluginError> {
        let keys = secret_keys(schema);
        let persisted = redact_secret_settings(plugin_id, settings, &keys)?;
        self.save_plugin_settings(plugin_id, &persisted).await
    }

    async fn resolve_secret_settings(
        &self,
        plugin_id: &str,
        settings: &HashMap<String, serde_json::Value>,
        schema: Option<&serde_json::Value>,
    ) -> Result<HashMap<String, serde_json::Value>, PluginError> {
        let keys = secret_keys(schema);
        if keys.is_empty() {
            return Ok(settings.clone());
        }

        let encryption_key = plugin_secret_encryption_key(plugin_id);
        let mut resolved = settings.clone();
        let mut rewritten = settings.clone();
        let mut should_rewrite = false;

        for key in keys {
            let Some(value) = settings.get(&key) else {
                continue;
            };

            if let Some(blob) = envelope_blob(value) {
                match decrypt_string(blob, &encryption_key) {
                    Ok(secret) => {
                        resolved.insert(key, serde_json::Value::String(secret));
                    }
                    Err(e) => {
                        eprintln!(
                            "Warning: failed to decrypt plugin secret {plugin_id}.{key}: {e}"
                        );
                        resolved.remove(&key);
                    }
                }
                continue;
            }

            if is_legacy_keyring_sentinel(value) {
                eprintln!(
                    "Note: plugin secret {plugin_id}.{key} was previously stored in the system \
                     keychain. Vault no longer reads the keychain; please re-enter it in the \
                     plugin settings."
                );
                resolved.remove(&key);
                continue;
            }

            if let Some(secret) = value.as_str().filter(|secret| !secret.is_empty()) {
                // Legacy plaintext secret: encrypt it at rest.
                let blob = encrypt_string(secret, &encryption_key).map_err(|e| {
                    PluginError::InstallationFailed(format!(
                        "Failed to encrypt plugin secret {plugin_id}.{key}: {e}"
                    ))
                })?;
                rewritten.insert(key.clone(), encrypted_envelope(blob));
                should_rewrite = true;
            }
        }

        if should_rewrite {
            self.save_plugin_settings(plugin_id, &rewritten).await?;
        }

        Ok(resolved)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_keys_extracts_flagged_fields() {
        let schema = serde_json::json!({
            "apiToken": { "type": "string", "secret": true },
            "syncFrequency": { "type": "number", "secret": false },
            "folder": { "type": "string" }
        });

        assert_eq!(secret_keys(Some(&schema)), vec!["apiToken".to_string()]);
    }

    #[test]
    fn secret_keys_returns_empty_for_missing_schema() {
        assert!(secret_keys(None).is_empty());
    }

    #[test]
    fn plaintext_secret_is_encrypted_in_persisted_settings() {
        let mut settings = HashMap::new();
        settings.insert(
            "apiToken".to_string(),
            serde_json::Value::String("readwise-token".to_string()),
        );
        settings.insert(
            "syncFrequency".to_string(),
            serde_json::Value::Number(60.into()),
        );

        let persisted = redact_secret_settings("readwise", &settings, &["apiToken".to_string()])
            .expect("redact settings");

        let envelope = persisted.get("apiToken").expect("envelope exists");
        let blob = envelope_blob(envelope).expect("encrypted envelope");
        assert_eq!(
            decrypt_string(blob, &plugin_secret_encryption_key("readwise")).expect("decrypt"),
            "readwise-token"
        );
        // Non-secret values are untouched; raw token never persisted.
        assert_eq!(
            persisted.get("syncFrequency"),
            Some(&serde_json::Value::Number(60.into()))
        );
        assert!(!serde_json::to_string(&persisted)
            .expect("serialize")
            .contains("readwise-token"));
    }

    #[test]
    fn encrypted_envelope_round_trips_redaction_unchanged() {
        let key = plugin_secret_encryption_key("readwise");
        let blob = encrypt_string("readwise-token", &key).expect("encrypt");
        let mut settings = HashMap::new();
        settings.insert("apiToken".to_string(), encrypted_envelope(blob.clone()));

        let persisted = redact_secret_settings("readwise", &settings, &["apiToken".to_string()])
            .expect("redact settings");

        assert_eq!(
            envelope_blob(persisted.get("apiToken").expect("envelope exists")),
            Some(blob.as_str())
        );
    }

    #[test]
    fn legacy_keyring_sentinel_round_trips_redaction_unchanged() {
        let sentinel = serde_json::json!({ LEGACY_KEYRING_SENTINEL_KEY: true });
        let mut settings = HashMap::new();
        settings.insert("apiToken".to_string(), sentinel.clone());

        let persisted = redact_secret_settings("readwise", &settings, &["apiToken".to_string()])
            .expect("redact settings");

        assert_eq!(persisted.get("apiToken"), Some(&sentinel));
        assert!(is_legacy_keyring_sentinel(&sentinel));
    }

    #[test]
    fn secrets_use_per_plugin_keys() {
        assert_ne!(
            plugin_secret_encryption_key("readwise"),
            plugin_secret_encryption_key("other-plugin")
        );
    }
}
