use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::State;

use crate::identity::{
    api_updates::ApiUpdateHelper,
    migration::{MigrationConfig, MigrationManager},
    IdentityManager,
};
use crate::RefactoredAppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct IdConversionResult {
    pub path: String,
    pub uuid: String,
    pub legacy_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkUuidResult {
    pub total_files: usize,
    pub processed: usize,
    pub added_uuids: usize,
    pub already_had_uuids: usize,
    pub errors: usize,
    pub error_files: Vec<String>,
}

/// Get UUID for a note by path
#[tauri::command]
pub async fn get_note_uuid(
    path: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> Result<Option<String>, String> {
    let path = Path::new(&path);
    let helper = ApiUpdateHelper::new(identity_manager.inner().clone());

    helper
        .get_note_id(path)
        .await
        .map_err(|e| format!("Failed to get note UUID: {}", e))
}

/// Ensure a note has a UUID (create if missing)
#[tauri::command]
pub async fn ensure_note_uuid(
    path: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> Result<String, String> {
    let path = Path::new(&path);
    let helper = ApiUpdateHelper::new(identity_manager.inner().clone());

    helper
        .ensure_note_id(path)
        .await
        .map_err(|e| format!("Failed to ensure note UUID: {}", e))
}

/// Convert a legacy ID to UUID
#[tauri::command]
pub async fn convert_legacy_id_to_uuid(
    legacy_id: String,
    vault_root: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> Result<String, String> {
    let vault_root = Path::new(&vault_root);
    let helper = ApiUpdateHelper::new(identity_manager.inner().clone());

    helper
        .resolve_id(&legacy_id, vault_root)
        .await
        .map_err(|e| format!("Failed to resolve ID: {}", e))
}

/// Batch convert legacy IDs to UUIDs
#[tauri::command]
pub async fn batch_convert_ids(
    paths: Vec<String>,
    vault_id: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> Result<Vec<IdConversionResult>, String> {
    let helper = ApiUpdateHelper::new(identity_manager.inner().clone());
    let mut results = Vec::new();

    for path_str in paths {
        let path = Path::new(&path_str);

        // Calculate legacy ID
        let legacy_id = ApiUpdateHelper::calculate_legacy_id(&vault_id, path);

        // Get or create UUID
        match helper.ensure_note_id(path).await {
            Ok(uuid) => {
                results.push(IdConversionResult {
                    path: path_str,
                    uuid,
                    legacy_id: Some(legacy_id),
                });
            }
            Err(e) => {
                eprintln!("Failed to convert ID for {}: {}", path_str, e);
            }
        }
    }

    Ok(results)
}

/// Check if an ID is a legacy path-based ID
#[tauri::command]
pub fn is_legacy_id(id: String) -> bool {
    use crate::identity::migration::mapper::LegacyIdMapper;
    LegacyIdMapper::is_legacy_id(&id)
}

/// Check if an ID is a UUID
#[tauri::command]
pub fn is_uuid(id: String) -> bool {
    super::super::identity::api_updates::is_uuid(&id)
}

/// Add UUIDs to all files in the vault that don't have them
#[tauri::command]
pub async fn add_uuids_to_vault(
    window_id: String,
    skip_existing: Option<bool>,
    refactored_state: State<'_, RefactoredAppState>,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> Result<BulkUuidResult, String> {
    println!("Starting bulk UUID addition for vault");

    // Get the vault for this window
    let window_state = refactored_state
        .get_window_state(&window_id)
        .await
        .ok_or("Window state not found")?;

    let vault_lock = window_state.vault.lock().await;
    let vault = vault_lock.as_ref().ok_or("No vault open for this window")?;

    let vault_root = vault.path().to_path_buf();
    drop(vault_lock); // Release the lock

    println!("Vault path: {:?}", vault_root);

    // Configure migration
    let config = MigrationConfig {
        dry_run: false,
        show_progress: false,      // We'll handle progress reporting ourselves
        include_legacy_ids: false, // Just focus on UUIDs
        parallel_limit: 4,
        skip_existing: skip_existing.unwrap_or(true),
    };

    // Create migration manager
    let mut migration_manager =
        MigrationManager::new(identity_manager.inner().clone(), vault_root, config);

    // Run the migration
    match migration_manager.migrate().await {
        Ok(report) => {
            println!("Bulk UUID addition completed");
            println!("   Total files: {}", report.total_files);
            println!("   Already had UUIDs: {}", report.already_had_id);
            println!("   Added UUIDs: {}", report.migrated_count);
            println!("   Errors: {}", report.error_count);

            Ok(BulkUuidResult {
                total_files: report.total_files,
                processed: report.total_files,
                added_uuids: report.migrated_count,
                already_had_uuids: report.already_had_id,
                errors: report.error_count,
                error_files: report.errors.clone(),
            })
        }
        Err(e) => {
            eprintln!("Failed to add UUIDs to vault: {}", e);
            Err(format!("Failed to add UUIDs to vault: {}", e))
        }
    }
}
