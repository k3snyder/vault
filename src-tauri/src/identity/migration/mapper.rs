use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Legacy ID information for backward compatibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyIds {
    /// SHA256 hash of the absolute path
    pub absolute_path_hash: String,
    /// SHA256 hash of the vault-relative path
    pub relative_path_hash: String,
    /// The original absolute path (for reference)
    pub original_absolute_path: String,
    /// The original relative path (for reference)
    pub original_relative_path: String,
}

/// Mapper for calculating legacy IDs
pub struct LegacyIdMapper;

impl LegacyIdMapper {
    /// Calculate legacy IDs for a file
    pub fn calculate_legacy_ids(file_path: &Path, vault_root: &Path) -> Result<LegacyIds> {
        // Get absolute path
        let absolute_path = file_path
            .canonicalize()
            .context("Failed to canonicalize file path")?;

        // Get relative path from vault root
        let relative_path = if absolute_path.starts_with(vault_root) {
            absolute_path
                .strip_prefix(vault_root)
                .context("Failed to get relative path")?
                .to_path_buf()
        } else {
            // If file is outside vault, use the full path as relative
            absolute_path.clone()
        };

        // Calculate hashes
        let absolute_hash = Self::calculate_path_hash(&absolute_path)?;
        let relative_hash = Self::calculate_path_hash(&relative_path)?;

        Ok(LegacyIds {
            absolute_path_hash: absolute_hash,
            relative_path_hash: relative_hash,
            original_absolute_path: absolute_path.to_string_lossy().to_string(),
            original_relative_path: relative_path.to_string_lossy().to_string(),
        })
    }

    /// Calculate SHA256 hash of a path
    pub fn calculate_path_hash(path: &Path) -> Result<String> {
        let path_str = path.to_string_lossy();
        let mut hasher = Sha256::new();
        hasher.update(path_str.as_bytes());
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }

    /// Create a mapping table from legacy IDs to new UUIDs
    pub fn create_mapping_table(legacy_ids: &LegacyIds, new_uuid: &str) -> LegacyMapping {
        LegacyMapping {
            uuid: new_uuid.to_string(),
            absolute_path_hash: legacy_ids.absolute_path_hash.clone(),
            relative_path_hash: legacy_ids.relative_path_hash.clone(),
            original_paths: OriginalPaths {
                absolute: legacy_ids.original_absolute_path.clone(),
                relative: legacy_ids.original_relative_path.clone(),
            },
        }
    }

    /// Check if a string is a valid legacy ID (SHA256 hash)
    pub fn is_legacy_id(id: &str) -> bool {
        // SHA256 produces 64 character hex strings
        id.len() == 64 && id.chars().all(|c| c.is_ascii_hexdigit())
    }
}

/// Mapping from legacy IDs to new UUID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyMapping {
    /// The new UUID
    pub uuid: String,
    /// Legacy absolute path hash
    pub absolute_path_hash: String,
    /// Legacy relative path hash
    pub relative_path_hash: String,
    /// Original paths for debugging
    pub original_paths: OriginalPaths,
}

/// Original path information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OriginalPaths {
    pub absolute: String,
    pub relative: String,
}

/// Database for storing legacy ID mappings
pub struct LegacyIdDatabase {
    mappings: Vec<LegacyMapping>,
}

impl LegacyIdDatabase {
    pub fn new() -> Self {
        Self {
            mappings: Vec::new(),
        }
    }

    /// Add a mapping
    pub fn add_mapping(&mut self, mapping: LegacyMapping) {
        self.mappings.push(mapping);
    }

    /// Look up UUID by legacy ID
    pub fn lookup_by_legacy_id(&self, legacy_id: &str) -> Option<&str> {
        self.mappings
            .iter()
            .find(|m| m.absolute_path_hash == legacy_id || m.relative_path_hash == legacy_id)
            .map(|m| m.uuid.as_str())
    }

    /// Get all mappings
    pub fn get_mappings(&self) -> &[LegacyMapping] {
        &self.mappings
    }

    /// Export mappings to JSON
    pub fn export_json(&self) -> Result<String> {
        serde_json::to_string_pretty(&self.mappings).context("Failed to serialize mappings to JSON")
    }

    /// Import mappings from JSON
    pub fn import_json(&mut self, json: &str) -> Result<()> {
        let mappings: Vec<LegacyMapping> =
            serde_json::from_str(json).context("Failed to deserialize mappings from JSON")?;
        self.mappings = mappings;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_calculate_legacy_ids() {
        let temp_dir = TempDir::new().unwrap();
        let vault_root = temp_dir.path();

        // Create a test file
        let file_path = vault_root.join("test.md");
        fs::write(&file_path, "test content").unwrap();

        let legacy_ids = LegacyIdMapper::calculate_legacy_ids(&file_path, vault_root).unwrap();

        // Check that hashes are valid
        assert_eq!(legacy_ids.absolute_path_hash.len(), 64);
        assert_eq!(legacy_ids.relative_path_hash.len(), 64);
        assert!(LegacyIdMapper::is_legacy_id(&legacy_ids.absolute_path_hash));
        assert!(LegacyIdMapper::is_legacy_id(&legacy_ids.relative_path_hash));

        // Absolute and relative should be different (unless file is at root)
        assert_ne!(legacy_ids.absolute_path_hash, legacy_ids.relative_path_hash);
    }

    #[test]
    fn test_path_hash_consistency() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.md");

        // Calculate hash multiple times
        let hash1 = LegacyIdMapper::calculate_path_hash(&path).unwrap();
        let hash2 = LegacyIdMapper::calculate_path_hash(&path).unwrap();

        // Should be identical
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64);
    }

    #[test]
    fn test_is_legacy_id() {
        // Valid SHA256 hash
        let valid_hash = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";
        assert!(LegacyIdMapper::is_legacy_id(valid_hash));

        // Invalid - too short
        assert!(!LegacyIdMapper::is_legacy_id("abc123"));

        // Invalid - too long
        let too_long = format!("{}00", valid_hash);
        assert!(!LegacyIdMapper::is_legacy_id(&too_long));

        // Invalid - non-hex characters
        let invalid_chars = "g665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";
        assert!(!LegacyIdMapper::is_legacy_id(invalid_chars));

        // UUID is not a legacy ID
        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        assert!(!LegacyIdMapper::is_legacy_id(uuid));
    }

    #[test]
    fn test_create_mapping_table() {
        let legacy_ids = LegacyIds {
            absolute_path_hash: "abcd1234".to_string(),
            relative_path_hash: "efgh5678".to_string(),
            original_absolute_path: "/home/user/vault/note.md".to_string(),
            original_relative_path: "note.md".to_string(),
        };

        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        let mapping = LegacyIdMapper::create_mapping_table(&legacy_ids, uuid);

        assert_eq!(mapping.uuid, uuid);
        assert_eq!(mapping.absolute_path_hash, "abcd1234");
        assert_eq!(mapping.relative_path_hash, "efgh5678");
        assert_eq!(mapping.original_paths.absolute, "/home/user/vault/note.md");
        assert_eq!(mapping.original_paths.relative, "note.md");
    }

    #[test]
    fn test_legacy_id_database() {
        let mut db = LegacyIdDatabase::new();

        // Add some mappings
        let mapping1 = LegacyMapping {
            uuid: "uuid1".to_string(),
            absolute_path_hash: "hash1".to_string(),
            relative_path_hash: "hash2".to_string(),
            original_paths: OriginalPaths {
                absolute: "/path1".to_string(),
                relative: "path1".to_string(),
            },
        };

        let mapping2 = LegacyMapping {
            uuid: "uuid2".to_string(),
            absolute_path_hash: "hash3".to_string(),
            relative_path_hash: "hash4".to_string(),
            original_paths: OriginalPaths {
                absolute: "/path2".to_string(),
                relative: "path2".to_string(),
            },
        };

        db.add_mapping(mapping1);
        db.add_mapping(mapping2);

        // Test lookup
        assert_eq!(db.lookup_by_legacy_id("hash1"), Some("uuid1"));
        assert_eq!(db.lookup_by_legacy_id("hash2"), Some("uuid1"));
        assert_eq!(db.lookup_by_legacy_id("hash3"), Some("uuid2"));
        assert_eq!(db.lookup_by_legacy_id("hash4"), Some("uuid2"));
        assert_eq!(db.lookup_by_legacy_id("nonexistent"), None);

        // Test export/import
        let json = db.export_json().unwrap();
        let mut db2 = LegacyIdDatabase::new();
        db2.import_json(&json).unwrap();

        assert_eq!(db2.get_mappings().len(), 2);
        assert_eq!(db2.lookup_by_legacy_id("hash1"), Some("uuid1"));
    }
}
