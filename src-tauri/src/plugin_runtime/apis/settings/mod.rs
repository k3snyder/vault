// Settings/Storage API - Persistent data storage for plugins
// Provides namespaced, quota-enforced, encrypted storage with migration support

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::Digest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;

use crate::plugin_runtime::permissions::{Capability, Permission, PermissionManager};

#[cfg(test)]
mod tests;

/// Permissions for settings operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SettingsPermission {
    Read,
    Write,
}

/// Settings API errors
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Quota exceeded: {0}")]
    QuotaExceeded(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Encryption error: {0}")]
    EncryptionError(String),

    #[error("Migration error: {0}")]
    MigrationError(String),

    #[error("Invalid key: {0}")]
    InvalidKey(String),
}

/// Migration definition for upgrading settings
pub struct Migration {
    pub from_version: u32,
    pub to_version: u32,
    pub transform: Box<dyn Fn(HashMap<String, String>) -> HashMap<String, String> + Send + Sync>,
}

/// Plugin storage metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StorageMetadata {
    version: u32,
    quota_bytes: usize,
    used_bytes: usize,
    encryption_enabled: bool,
    created_at: u64,
    modified_at: u64,
    is_uninstalled: bool,
}

impl Default for StorageMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            quota_bytes: 10 * 1024 * 1024, // 10MB default
            used_bytes: 0,
            encryption_enabled: false,
            created_at: chrono::Utc::now().timestamp() as u64,
            modified_at: chrono::Utc::now().timestamp() as u64,
            is_uninstalled: false,
        }
    }
}

/// Plugin storage container
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PluginStorage {
    metadata: StorageMetadata,
    data: HashMap<String, String>,
    encrypted_data: HashMap<String, Vec<u8>>,
}

impl Default for PluginStorage {
    fn default() -> Self {
        Self {
            metadata: StorageMetadata::default(),
            data: HashMap::new(),
            encrypted_data: HashMap::new(),
        }
    }
}

/// Settings API implementation
pub struct SettingsApi {
    storage_path: PathBuf,
    permission_manager: Arc<RwLock<PermissionManager>>,
    storage_cache: Arc<RwLock<HashMap<String, PluginStorage>>>,
    encryption_keys: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl SettingsApi {
    /// Create a new Settings API instance
    pub fn new(storage_path: PathBuf, permission_manager: Arc<RwLock<PermissionManager>>) -> Self {
        Self {
            storage_path,
            permission_manager,
            storage_cache: Arc::new(RwLock::new(HashMap::new())),
            encryption_keys: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Grant a permission to a plugin (for testing)
    #[cfg(test)]
    pub async fn grant_permission(&self, plugin_id: &str, permission: SettingsPermission) {
        let capability = match permission {
            SettingsPermission::Read => Capability::SettingsRead {
                keys: vec!["*".to_string()],
            },
            SettingsPermission::Write => Capability::SettingsWrite {
                keys: vec!["*".to_string()],
            },
        };

        let perm = Permission {
            capability,
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        let manager = self.permission_manager.read().await;
        manager
            .grant_permissions(plugin_id, vec![perm])
            .await
            .unwrap();
    }

    /// Check if plugin has permission
    async fn check_permission(
        &self,
        plugin_id: &str,
        permission: SettingsPermission,
    ) -> Result<(), SettingsError> {
        let capability = match permission {
            SettingsPermission::Read => Capability::SettingsRead {
                keys: vec!["*".to_string()],
            },
            SettingsPermission::Write => Capability::SettingsWrite {
                keys: vec!["*".to_string()],
            },
        };

        let manager = self.permission_manager.read().await;
        if !manager.has_capability(plugin_id, &capability).await {
            return Err(SettingsError::PermissionDenied(format!(
                "Plugin {} lacks permission: {:?}",
                plugin_id, permission
            )));
        }
        Ok(())
    }

    /// Get storage path for a plugin
    fn get_plugin_storage_path(&self, plugin_id: &str) -> PathBuf {
        self.storage_path.join(format!("{}.json", plugin_id))
    }

    /// Load plugin storage from disk
    async fn load_storage(&self, plugin_id: &str) -> Result<PluginStorage, SettingsError> {
        let mut cache = self.storage_cache.write().await;

        // Check cache first
        if let Some(storage) = cache.get(plugin_id) {
            return Ok(storage.clone());
        }

        // Load from disk
        let path = self.get_plugin_storage_path(plugin_id);
        let storage = if path.exists() {
            let content = fs::read_to_string(&path)
                .await
                .map_err(|e| SettingsError::IoError(e.to_string()))?;
            serde_json::from_str(&content)
                .map_err(|e| SettingsError::SerializationError(e.to_string()))?
        } else {
            PluginStorage::default()
        };

        cache.insert(plugin_id.to_string(), storage.clone());
        Ok(storage)
    }

    /// Save plugin storage to disk
    async fn save_storage(
        &self,
        plugin_id: &str,
        storage: &PluginStorage,
    ) -> Result<(), SettingsError> {
        // Update cache
        let mut cache = self.storage_cache.write().await;
        cache.insert(plugin_id.to_string(), storage.clone());

        // Ensure directory exists
        if let Some(parent) = self.storage_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| SettingsError::IoError(e.to_string()))?;
        }

        // Write to disk (atomic write with temp file)
        let path = self.get_plugin_storage_path(plugin_id);
        let temp_path = path.with_extension("tmp");

        let content = serde_json::to_string_pretty(storage)
            .map_err(|e| SettingsError::SerializationError(e.to_string()))?;

        fs::write(&temp_path, content)
            .await
            .map_err(|e| SettingsError::IoError(e.to_string()))?;

        fs::rename(temp_path, path)
            .await
            .map_err(|e| SettingsError::IoError(e.to_string()))?;

        Ok(())
    }

    /// Calculate storage size for quota enforcement
    fn calculate_storage_size(&self, storage: &PluginStorage) -> usize {
        let mut size = 0;

        // Calculate data size
        for (key, value) in &storage.data {
            size += key.len() + value.len();
        }

        // Calculate encrypted data size
        for (key, value) in &storage.encrypted_data {
            size += key.len() + value.len();
        }

        size
    }

    // Basic key-value operations

    /// Set a value
    pub async fn set(&self, plugin_id: &str, key: &str, value: &str) -> Result<(), SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Write)
            .await?;

        if key.is_empty() {
            return Err(SettingsError::InvalidKey("Key cannot be empty".to_string()));
        }

        let mut storage = self.load_storage(plugin_id).await?;

        // Check quota
        let new_size = self.calculate_storage_size(&storage) + key.len() + value.len();
        if new_size > storage.metadata.quota_bytes {
            return Err(SettingsError::QuotaExceeded(format!(
                "Storage quota exceeded: {} > {} bytes",
                new_size, storage.metadata.quota_bytes
            )));
        }

        // Update storage
        storage.data.insert(key.to_string(), value.to_string());
        storage.metadata.used_bytes = new_size;
        storage.metadata.modified_at = chrono::Utc::now().timestamp() as u64;

        self.save_storage(plugin_id, &storage).await
    }

    /// Get a value
    pub async fn get(&self, plugin_id: &str, key: &str) -> Result<Option<String>, SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Read)
            .await?;

        let storage = self.load_storage(plugin_id).await?;
        Ok(storage.data.get(key).cloned())
    }

    /// Delete a value
    pub async fn delete(&self, plugin_id: &str, key: &str) -> Result<(), SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Write)
            .await?;

        let mut storage = self.load_storage(plugin_id).await?;
        storage.data.remove(key);
        storage.metadata.used_bytes = self.calculate_storage_size(&storage);
        storage.metadata.modified_at = chrono::Utc::now().timestamp() as u64;

        self.save_storage(plugin_id, &storage).await
    }

    /// List all keys
    pub async fn list_keys(&self, plugin_id: &str) -> Result<Vec<String>, SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Read)
            .await?;

        let storage = self.load_storage(plugin_id).await?;
        Ok(storage.data.keys().cloned().collect())
    }

    /// Get all key-value pairs
    pub async fn get_all(&self, plugin_id: &str) -> Result<HashMap<String, String>, SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Read)
            .await?;

        let storage = self.load_storage(plugin_id).await?;
        Ok(storage.data.clone())
    }

    // JSON operations

    /// Set a JSON value
    pub async fn set_json(
        &self,
        plugin_id: &str,
        key: &str,
        value: JsonValue,
    ) -> Result<(), SettingsError> {
        let json_str = serde_json::to_string(&value)
            .map_err(|e| SettingsError::SerializationError(e.to_string()))?;
        self.set(plugin_id, key, &json_str).await
    }

    /// Get a JSON value
    pub async fn get_json(
        &self,
        plugin_id: &str,
        key: &str,
    ) -> Result<Option<JsonValue>, SettingsError> {
        if let Some(json_str) = self.get(plugin_id, key).await? {
            let value = serde_json::from_str(&json_str)
                .map_err(|e| SettingsError::SerializationError(e.to_string()))?;
            Ok(Some(value))
        } else {
            Ok(None)
        }
    }

    // Encrypted storage

    /// Get or create encryption key for plugin
    async fn get_encryption_key(&self, plugin_id: &str) -> Vec<u8> {
        let mut keys = self.encryption_keys.write().await;

        keys.entry(plugin_id.to_string())
            .or_insert_with(|| {
                let mut key = vec![0u8; 32];
                OsRng.fill_bytes(&mut key);
                key
            })
            .clone()
    }

    /// Set an encrypted value
    pub async fn set_encrypted(
        &self,
        plugin_id: &str,
        key: &str,
        value: &str,
    ) -> Result<(), SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Write)
            .await?;

        let mut storage = self.load_storage(plugin_id).await?;

        // Get encryption key
        let key_bytes = self.get_encryption_key(plugin_id).await;
        let cipher_key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(cipher_key);

        // Generate nonce
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt value
        let encrypted = cipher
            .encrypt(nonce, value.as_bytes())
            .map_err(|e| SettingsError::EncryptionError(e.to_string()))?;

        // Store with nonce prepended
        let mut stored = nonce_bytes.to_vec();
        stored.extend(encrypted);

        storage.encrypted_data.insert(key.to_string(), stored);
        storage.metadata.encryption_enabled = true;
        storage.metadata.modified_at = chrono::Utc::now().timestamp() as u64;

        self.save_storage(plugin_id, &storage).await
    }

    /// Get an encrypted value
    pub async fn get_encrypted(
        &self,
        plugin_id: &str,
        key: &str,
    ) -> Result<Option<String>, SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Read)
            .await?;

        let storage = self.load_storage(plugin_id).await?;

        if let Some(stored) = storage.encrypted_data.get(key) {
            if stored.len() < 12 {
                return Err(SettingsError::EncryptionError(
                    "Invalid encrypted data".to_string(),
                ));
            }

            // Extract nonce and ciphertext
            let (nonce_bytes, ciphertext) = stored.split_at(12);
            let nonce = Nonce::from_slice(nonce_bytes);

            // Get encryption key
            let key_bytes = self.get_encryption_key(plugin_id).await;
            let cipher_key = Key::<Aes256Gcm>::from_slice(&key_bytes);
            let cipher = Aes256Gcm::new(cipher_key);

            // Decrypt
            let decrypted = cipher
                .decrypt(nonce, ciphertext)
                .map_err(|e| SettingsError::EncryptionError(e.to_string()))?;

            String::from_utf8(decrypted)
                .map(Some)
                .map_err(|e| SettingsError::EncryptionError(e.to_string()))
        } else {
            Ok(None)
        }
    }

    /// Rotate encryption key
    pub async fn rotate_encryption_key(&self, plugin_id: &str) -> Result<(), SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Write)
            .await?;

        let storage = self.load_storage(plugin_id).await?;

        // Decrypt all data with old key
        let mut decrypted_data = HashMap::new();
        for (key, _) in &storage.encrypted_data {
            if let Some(value) = self.get_encrypted(plugin_id, key).await? {
                decrypted_data.insert(key.clone(), value);
            }
        }

        // Generate new key
        let mut keys = self.encryption_keys.write().await;
        let mut new_key = vec![0u8; 32];
        OsRng.fill_bytes(&mut new_key);
        keys.insert(plugin_id.to_string(), new_key);
        drop(keys);

        // Re-encrypt with new key
        for (key, value) in decrypted_data {
            self.set_encrypted(plugin_id, &key, &value).await?;
        }

        Ok(())
    }

    // Quota management

    /// Set storage quota for a plugin
    pub async fn set_quota(&self, plugin_id: &str, bytes: usize) -> Result<(), SettingsError> {
        let mut storage = self.load_storage(plugin_id).await?;
        storage.metadata.quota_bytes = bytes;
        self.save_storage(plugin_id, &storage).await
    }

    /// Get storage usage
    pub async fn get_storage_usage(&self, plugin_id: &str) -> Result<usize, SettingsError> {
        let storage = self.load_storage(plugin_id).await?;
        Ok(storage.metadata.used_bytes)
    }

    // Migration system

    /// Get plugin version
    pub async fn get_version(&self, plugin_id: &str) -> Result<u32, SettingsError> {
        let storage = self.load_storage(plugin_id).await?;
        Ok(storage.metadata.version)
    }

    /// Set plugin version
    pub async fn set_version(&self, plugin_id: &str, version: u32) -> Result<(), SettingsError> {
        let mut storage = self.load_storage(plugin_id).await?;
        storage.metadata.version = version;
        self.save_storage(plugin_id, &storage).await
    }

    /// Apply a migration
    pub async fn apply_migration(
        &self,
        plugin_id: &str,
        migration: Migration,
    ) -> Result<(), SettingsError> {
        self.check_permission(plugin_id, SettingsPermission::Write)
            .await?;

        let mut storage = self.load_storage(plugin_id).await?;

        if storage.metadata.version != migration.from_version {
            return Err(SettingsError::MigrationError(format!(
                "Version mismatch: expected {}, got {}",
                migration.from_version, storage.metadata.version
            )));
        }

        // Apply transformation
        storage.data = (migration.transform)(storage.data);
        storage.metadata.version = migration.to_version;
        storage.metadata.modified_at = chrono::Utc::now().timestamp() as u64;

        self.save_storage(plugin_id, &storage).await
    }

    // Cleanup operations

    /// Clean up all plugin data
    pub async fn cleanup_plugin_data(&self, plugin_id: &str) -> Result<(), SettingsError> {
        // Clear cache
        let mut cache = self.storage_cache.write().await;
        cache.remove(plugin_id);

        // Clear encryption keys
        let mut keys = self.encryption_keys.write().await;
        keys.remove(plugin_id);

        // Delete file
        let path = self.get_plugin_storage_path(plugin_id);
        if path.exists() {
            fs::remove_file(path)
                .await
                .map_err(|e| SettingsError::IoError(e.to_string()))?;
        }

        Ok(())
    }

    /// Mark plugin as uninstalled
    pub async fn mark_plugin_uninstalled(&self, plugin_id: &str) -> Result<(), SettingsError> {
        let mut storage = self.load_storage(plugin_id).await?;
        storage.metadata.is_uninstalled = true;
        self.save_storage(plugin_id, &storage).await
    }

    /// Garbage collect uninstalled plugin data
    pub async fn garbage_collect(&self) -> Result<usize, SettingsError> {
        let mut cleaned = 0;

        // Read all storage files
        let mut entries = fs::read_dir(&self.storage_path)
            .await
            .map_err(|e| SettingsError::IoError(e.to_string()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| SettingsError::IoError(e.to_string()))?
        {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    let plugin_id = name.trim_end_matches(".json");
                    let storage = self.load_storage(plugin_id).await?;

                    if storage.metadata.is_uninstalled {
                        self.cleanup_plugin_data(plugin_id).await?;
                        cleaned += 1;
                    }
                }
            }
        }

        Ok(cleaned)
    }

    /// Flush cache to disk
    pub async fn flush(&self) -> Result<(), SettingsError> {
        let cache = self.storage_cache.read().await;

        for (plugin_id, storage) in cache.iter() {
            self.save_storage(plugin_id, storage).await?;
        }

        Ok(())
    }

    // Internal helpers for testing

    #[cfg(test)]
    pub async fn get_raw(
        &self,
        _requestor: &str,
        plugin_id: &str,
        key: &str,
    ) -> Result<Option<String>, SettingsError> {
        // Cross-plugin access is denied
        if _requestor != plugin_id {
            return Err(SettingsError::PermissionDenied(
                "Cross-plugin access denied".to_string(),
            ));
        }
        self.get(plugin_id, key).await
    }

    #[cfg(test)]
    pub async fn get_raw_internal(
        &self,
        plugin_id: &str,
        key: &str,
    ) -> Result<Option<String>, SettingsError> {
        let storage = self.load_storage(plugin_id).await?;

        // Return raw encrypted data as base64 if it exists
        if let Some(encrypted) = storage.encrypted_data.get(key) {
            use base64::{engine::general_purpose, Engine as _};

            Ok(Some(general_purpose::STANDARD.encode(encrypted)))
        } else {
            Ok(storage.data.get(key).cloned())
        }
    }

    #[cfg(test)]
    pub fn clone_internal(&self) -> Self {
        Self {
            storage_path: self.storage_path.clone(),
            permission_manager: self.permission_manager.clone(),
            storage_cache: self.storage_cache.clone(),
            encryption_keys: self.encryption_keys.clone(),
        }
    }
}
