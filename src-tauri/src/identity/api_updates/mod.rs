use anyhow::Result;
use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;

use crate::identity::migration::mapper::LegacyIdMapper;
use crate::identity::IdentityManager;

/// API update helper for transitioning from path-based IDs to UUIDs
pub struct ApiUpdateHelper {
    identity_manager: Arc<RwLock<IdentityManager>>,
}

impl ApiUpdateHelper {
    pub fn new(identity_manager: Arc<RwLock<IdentityManager>>) -> Self {
        Self { identity_manager }
    }

    /// Generate a note ID - uses UUID if available, otherwise generates one
    pub async fn ensure_note_id(&self, path: &Path) -> Result<String> {
        let mut manager = self.identity_manager.write();
        manager.ensure_note_id(path)
    }

    /// Get existing note ID without creating one
    pub async fn get_note_id(&self, path: &Path) -> Result<Option<String>> {
        let mut manager = self.identity_manager.write();
        manager.get_note_id(path)
    }

    /// Resolve an ID that might be either a UUID or a legacy path hash
    pub async fn resolve_id(&self, id: &str, vault_root: &Path) -> Result<String> {
        // Check if it's already a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
        if is_uuid(id) {
            return Ok(id.to_string());
        }

        // Check if it's a legacy ID (64-character hex string)
        if LegacyIdMapper::is_legacy_id(id) {
            // Try to find the corresponding UUID
            if let Some(uuid) = self.lookup_legacy_id(id, vault_root).await? {
                log_deprecation_warning(id, &uuid);
                return Ok(uuid);
            }
        }

        // If we can't resolve it, return the original ID
        // This allows for graceful degradation
        Ok(id.to_string())
    }

    /// Look up a UUID by legacy ID
    async fn lookup_legacy_id(&self, legacy_id: &str, vault_root: &Path) -> Result<Option<String>> {
        // This would query the migration mappings or scan vault for the mapping
        // For now, we'll implement a basic search

        // Try to reverse-engineer the path from the hash (not always possible)
        // In a real implementation, we'd maintain a mapping database

        Ok(None) // Placeholder - would implement actual lookup
    }

    /// Update a path-based ID to UUID
    pub async fn update_to_uuid(&self, path: &Path, old_id: &str) -> Result<String> {
        let new_id = self.ensure_note_id(path).await?;

        if old_id != new_id {
            println!("Updated ID from {} to {}", old_id, new_id);
        }

        Ok(new_id)
    }

    /// Calculate legacy ID for backward compatibility
    pub fn calculate_legacy_id(vault_id: &str, path: &Path) -> String {
        let mut hasher = Sha256::new();
        hasher.update(vault_id.as_bytes());
        hasher.update(path.to_string_lossy().as_bytes());
        format!("{:x}", hasher.finalize())
    }
}

/// Check if a string is a valid UUID
pub fn is_uuid(s: &str) -> bool {
    // Basic UUID format check
    let parts: Vec<&str> = s.split('-').collect();

    if parts.len() != 5 {
        return false;
    }

    // Check lengths: 8-4-4-4-12
    let expected_lengths = [8, 4, 4, 4, 12];

    for (i, part) in parts.iter().enumerate() {
        if part.len() != expected_lengths[i] {
            return false;
        }

        // Check if all characters are hex
        if !part.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
    }

    true
}

/// Log a deprecation warning when legacy IDs are used
fn log_deprecation_warning(legacy_id: &str, new_uuid: &str) {
    eprintln!(
        "⚠️  DEPRECATION WARNING: Legacy path-based ID '{}' is deprecated. \
        Please update to use UUID '{}' instead.",
        legacy_id, new_uuid
    );
}

/// Trait for backward-compatible ID operations
pub trait BackwardCompatibleId {
    /// Get the ID, resolving legacy IDs if necessary
    fn get_compatible_id(&self) -> String;

    /// Check if this is using a legacy ID
    fn is_legacy_id(&self) -> bool;
}

#[cfg(test)]
mod tests;
