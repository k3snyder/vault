use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SidecarData {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub legacy_ids: Option<Vec<String>>,
    pub file_path: String,
    pub file_hash: Option<String>,
}

impl SidecarData {
    pub fn new(id: String, file_path: String) -> Self {
        let now = Utc::now();
        SidecarData {
            id,
            created_at: now,
            updated_at: now,
            legacy_ids: None,
            file_path,
            file_hash: None,
        }
    }
}

pub struct SidecarManager;

impl SidecarManager {
    /// Calculate the sidecar file path for a given file
    /// For file.ext, returns .file.ext.meta.json in the same directory
    pub fn sidecar_path(file_path: &Path) -> PathBuf {
        let parent = file_path.parent().unwrap_or_else(|| Path::new(""));
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        let sidecar_name = format!(".{}.meta.json", file_name);
        parent.join(sidecar_name)
    }

    /// Check if a file should use sidecar storage (non-markdown files)
    pub fn should_use_sidecar(file_path: &Path) -> bool {
        match file_path.extension().and_then(|e| e.to_str()) {
            Some("md") | Some("markdown") => false,
            _ => true,
        }
    }

    /// Read sidecar data for a file
    pub fn read(file_path: &Path) -> Result<Option<SidecarData>> {
        let sidecar_path = Self::sidecar_path(file_path);

        if !sidecar_path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&sidecar_path).context("Failed to read sidecar file")?;

        // Try to parse JSON
        match serde_json::from_str::<SidecarData>(&content) {
            Ok(data) => Ok(Some(data)),
            Err(e) => {
                // Log error but don't fail - return None for corrupted sidecar
                eprintln!(
                    "Warning: Corrupted sidecar file at {:?}: {}",
                    sidecar_path, e
                );
                Ok(None)
            }
        }
    }

    /// Write sidecar data atomically
    pub fn write(file_path: &Path, data: &SidecarData) -> Result<()> {
        let sidecar_path = Self::sidecar_path(file_path);

        // Serialize to JSON with pretty printing
        let json =
            serde_json::to_string_pretty(data).context("Failed to serialize sidecar data")?;

        // Create temp file in same directory for atomic rename
        let parent = sidecar_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid sidecar path"))?;

        let mut temp_file = NamedTempFile::new_in(parent)?;
        temp_file.write_all(json.as_bytes())?;
        temp_file.flush()?;

        // Sync to disk
        temp_file.as_file().sync_all()?;

        // Atomic rename
        temp_file.persist(&sidecar_path)?;

        Ok(())
    }

    /// Update sidecar data, preserving existing fields
    pub fn update<F>(file_path: &Path, updater: F) -> Result<()>
    where
        F: FnOnce(&mut SidecarData),
    {
        // Read existing or create new
        let mut data = Self::read(file_path)?.unwrap_or_else(|| {
            SidecarData::new(String::new(), file_path.to_string_lossy().to_string())
        });

        // Apply updates
        updater(&mut data);
        data.updated_at = Utc::now();

        // Write back
        Self::write(file_path, &data)
    }

    /// Delete sidecar file when main file is deleted
    pub fn delete(file_path: &Path) -> Result<()> {
        let sidecar_path = Self::sidecar_path(file_path);

        if sidecar_path.exists() {
            fs::remove_file(&sidecar_path).context("Failed to delete sidecar file")?;
        }

        Ok(())
    }

    /// Rename sidecar when file is renamed
    pub fn rename(old_path: &Path, new_path: &Path) -> Result<()> {
        let old_sidecar = Self::sidecar_path(old_path);
        let new_sidecar = Self::sidecar_path(new_path);

        if old_sidecar.exists() {
            fs::rename(&old_sidecar, &new_sidecar).context("Failed to rename sidecar file")?;

            // Update file_path in sidecar data
            if let Some(mut data) = Self::read(new_path)? {
                data.file_path = new_path.to_string_lossy().to_string();
                data.updated_at = Utc::now();

                // Use blocking write for simplicity in rename
                let json = serde_json::to_string_pretty(&data)?;
                fs::write(&new_sidecar, json)?;
            }
        }

        Ok(())
    }

    /// Calculate file hash for integrity checking
    pub fn calculate_file_hash(file_path: &Path) -> Result<String> {
        use sha2::{Digest, Sha256};
        use std::io::Read;

        let mut file = fs::File::open(file_path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0; 8192];

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Clean up orphaned sidecar files in a directory
    pub fn cleanup_orphans(directory: &Path) -> Result<Vec<PathBuf>> {
        let mut orphans = Vec::new();

        if !directory.is_dir() {
            return Ok(orphans);
        }

        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();

            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // Check if this is a sidecar file
                if name.starts_with('.') && name.ends_with(".meta.json") {
                    // Extract original filename
                    let original_name = &name[1..name.len() - 10]; // Remove . prefix and .meta.json suffix
                    let original_path = directory.join(original_name);

                    // If original file doesn't exist, it's an orphan
                    if !original_path.exists() {
                        fs::remove_file(&path)?;
                        orphans.push(path);
                    }
                }
            }
        }

        Ok(orphans)
    }
}

#[cfg(test)]
mod tests;
