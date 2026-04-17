//! Tauri command handlers for CSV operations
//!
//! Exposes CSV functionality to the frontend via Tauri commands.

use super::processor;
use super::schema_store;
use super::types::{
    CsvAiContext, CsvData, CsvError, CsvFileInfo, CsvSchema, CsvStatistics, FREE_ROW_LIMIT,
};
use crate::license::{
    get_machine_fingerprint, load_license, FEATURE_CSV_AI_CONTEXT, FEATURE_CSV_PRO,
    FEATURE_CSV_SCHEMA, FEATURE_CSV_UNLIMITED_ROWS,
};
use crate::refactored_app_state::{extract_window_id, RefactoredAppState};
use std::path::PathBuf;
use tauri::{State, Window};

/// Lists all CSV files in the current vault.
///
/// Recursively scans the vault directory for CSV files and returns
/// information about each, including whether it has an associated schema.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
///
/// # Returns
/// * `Ok(Vec<CsvFileInfo>)` - List of CSV files found in the vault
/// * `Err(CsvError)` - If no vault is open or scanning fails
#[tauri::command]
pub async fn list_csv_files(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Vec<CsvFileInfo>, CsvError> {
    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Call the schema_store function to list CSV files
    schema_store::list_csv_files(&vault_path).await
}

/// Checks if the user has premium CSV features (unlimited rows).
///
/// Returns true if the user has either FEATURE_CSV_UNLIMITED_ROWS or FEATURE_CSV_PRO.
fn has_premium_csv_features() -> bool {
    let machine_id = match get_machine_fingerprint() {
        Ok(id) => id,
        Err(_) => return false,
    };

    match load_license(&machine_id) {
        Ok(Some(license_info)) => {
            // Check if license is still valid (not expired)
            if let Some(expires_at) = license_info.expires_at {
                if chrono::Utc::now() > expires_at {
                    return false;
                }
            }
            // Check for CSV unlimited rows or CSV Pro feature
            license_info
                .features
                .iter()
                .any(|f| f == FEATURE_CSV_UNLIMITED_ROWS || f == FEATURE_CSV_PRO)
        }
        _ => false,
    }
}

/// Checks if the user has a specific premium CSV feature.
///
/// Returns true if the user has a valid license.
///
/// CSV Editor Pro features are bundled with any valid license (lifetime, licensed, or trial).
/// This means any paying customer gets access to all CSV features.
///
/// # Arguments
/// * `_feature` - The feature constant (currently unused - all CSV features granted to any license)
fn has_csv_premium(_feature: &str) -> bool {
    let machine_id = match get_machine_fingerprint() {
        Ok(id) => id,
        Err(e) => {
            eprintln!("[CSV Premium] Failed to get machine fingerprint: {}", e);
            return false;
        }
    };

    match load_license(&machine_id) {
        Ok(Some(license_info)) => {
            // Check if license is still valid (not expired)
            if let Some(expires_at) = license_info.expires_at {
                let now = chrono::Utc::now();
                if now > expires_at {
                    eprintln!("[CSV Premium] License expired");
                    return false;
                }
            }

            // CSV features are bundled with any valid license type
            // (lifetime, licensed, trial all get full CSV access)
            let valid_license_types = ["lifetime", "licensed", "trial"];
            let has_valid_license =
                valid_license_types.contains(&license_info.license_type.as_str());

            if !has_valid_license {
                eprintln!(
                    "[CSV Premium] Unknown license type: {}",
                    license_info.license_type
                );
            }

            has_valid_license
        }
        Ok(None) => false,
        Err(e) => {
            eprintln!("[CSV Premium] Failed to load license: {}", e);
            false
        }
    }
}

/// Requires a specific premium CSV feature, returning an error if not available.
///
/// # Arguments
/// * `feature` - The feature constant to check for (e.g., FEATURE_CSV_SCHEMA)
///
/// # Returns
/// * `Ok(())` - If the user has the required feature
/// * `Err(CsvError::PremiumRequired)` - If the user doesn't have the feature
fn require_csv_premium(feature: &str) -> Result<(), CsvError> {
    if has_csv_premium(feature) {
        Ok(())
    } else {
        Err(CsvError::PremiumRequired {
            feature: feature.to_string(),
        })
    }
}

/// Validates that a path is within the vault boundary.
///
/// # Arguments
/// * `path` - The path to validate (relative to vault)
/// * `vault_path` - The vault root path
///
/// # Returns
/// * `Ok(PathBuf)` - The canonicalized absolute path if valid
/// * `Err(CsvError::PathViolation)` - If path attempts to escape vault boundary
fn validate_path_within_vault(
    path: &str,
    vault_path: &std::path::Path,
) -> Result<PathBuf, CsvError> {
    // Construct the full path
    let full_path = vault_path.join(path);

    // Canonicalize both paths to resolve symlinks and .. components
    let canonical_vault = vault_path.canonicalize().map_err(|e| CsvError::ReadError {
        message: format!("Failed to resolve vault path: {}", e),
    })?;

    let canonical_path = full_path.canonicalize().map_err(|e| CsvError::ReadError {
        message: format!("Failed to resolve file path '{}': {}", path, e),
    })?;

    // Check that the file path starts with the vault path
    if !canonical_path.starts_with(&canonical_vault) {
        return Err(CsvError::PathViolation {
            path: path.to_string(),
        });
    }

    Ok(canonical_path)
}

/// Reads CSV data from a file within the vault.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
/// * `path` - Relative path to the CSV file within the vault
/// * `max_rows` - Optional maximum number of rows to return (premium users can request unlimited)
///
/// # Returns
/// * `Ok(CsvData)` - The parsed CSV data with headers, rows, total count, and truncation flag
/// * `Err(CsvError)` - If no vault is open, path is invalid, or reading fails
///
/// # Behavior
/// - Free users are limited to FREE_ROW_LIMIT (10,000) rows
/// - Premium users can request unlimited rows via max_rows parameter
/// - Path validation prevents access outside the vault boundary
#[tauri::command]
pub async fn read_csv_data(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    path: String,
    max_rows: Option<usize>,
) -> Result<CsvData, CsvError> {
    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Validate path is within vault boundary
    let full_path = validate_path_within_vault(&path, &vault_path)?;

    // Determine row limit based on premium status
    let row_limit = if has_premium_csv_features() {
        // Premium users get unlimited rows (or their specified max_rows)
        max_rows
    } else {
        // Free users are limited to FREE_ROW_LIMIT
        Some(max_rows.unwrap_or(FREE_ROW_LIMIT).min(FREE_ROW_LIMIT))
    };

    // Read and parse the CSV file
    processor::read_csv(&full_path, row_limit).await
}

/// Escapes a CSV field according to RFC 4180.
///
/// Fields are quoted if they contain:
/// - Commas
/// - Double quotes (which are escaped by doubling)
/// - Newlines (CR or LF)
///
/// # Arguments
/// * `field` - The field value to escape
///
/// # Returns
/// * The properly escaped field string
fn escape_csv_field(field: &str) -> String {
    // Check if quoting is needed
    let needs_quoting =
        field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r');

    if needs_quoting {
        // Escape double quotes by doubling them, then wrap in quotes
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Validates a path for saving (creates parent directories if needed).
///
/// Unlike validate_path_within_vault, this doesn't require the file to exist,
/// only that the path stays within the vault boundary.
///
/// # Arguments
/// * `path` - The relative path to validate
/// * `vault_path` - The vault root path
///
/// # Returns
/// * `Ok(PathBuf)` - The full path if valid
/// * `Err(CsvError::PathViolation)` - If path attempts to escape vault boundary
fn validate_save_path_within_vault(
    path: &str,
    vault_path: &std::path::Path,
) -> Result<PathBuf, CsvError> {
    // Construct the full path
    let full_path = vault_path.join(path);

    // Canonicalize the vault path
    let canonical_vault = vault_path.canonicalize().map_err(|e| CsvError::ReadError {
        message: format!("Failed to resolve vault path: {}", e),
    })?;

    // For save operations, we need to check the parent directory exists
    // and that the final path would be within the vault
    let parent = full_path.parent().ok_or_else(|| CsvError::WriteError {
        message: "Invalid file path: no parent directory".to_string(),
    })?;

    // Canonicalize the parent to resolve any .. components
    let canonical_parent = parent.canonicalize().map_err(|e| CsvError::WriteError {
        message: format!(
            "Parent directory does not exist or cannot be resolved: {}",
            e
        ),
    })?;

    // Check that the parent is within the vault
    if !canonical_parent.starts_with(&canonical_vault) {
        return Err(CsvError::PathViolation {
            path: path.to_string(),
        });
    }

    // Return the full path (parent + filename)
    let file_name = full_path.file_name().ok_or_else(|| CsvError::WriteError {
        message: "Invalid file path: no filename".to_string(),
    })?;

    Ok(canonical_parent.join(file_name))
}

/// Saves CSV data to a file within the vault.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
/// * `path` - Relative path to the CSV file within the vault
/// * `headers` - Column headers for the CSV
/// * `rows` - Data rows to write
///
/// # Returns
/// * `Ok(())` - If the file was saved successfully
/// * `Err(CsvError)` - If saving fails
///
/// # Behavior
/// - Validates path is within vault boundary
/// - Free users are limited to FREE_ROW_LIMIT rows
/// - Fields containing commas, quotes, or newlines are automatically escaped
/// - Uses atomic write pattern (write to temp file, then rename)
#[tauri::command]
pub async fn save_csv_data(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    path: String,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Result<(), CsvError> {
    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Validate path is within vault boundary
    let full_path = validate_save_path_within_vault(&path, &vault_path)?;

    // Check row limit for free users
    let row_count = rows.len();
    if !has_premium_csv_features() && row_count > FREE_ROW_LIMIT {
        return Err(CsvError::WriteError {
            message: format!(
                "Free users are limited to {} rows. You have {} rows. Upgrade to premium for unlimited rows.",
                FREE_ROW_LIMIT, row_count
            ),
        });
    }

    // Build CSV content with proper escaping
    let mut csv_content = String::new();

    // Write headers
    let escaped_headers: Vec<String> = headers.iter().map(|h| escape_csv_field(h)).collect();
    csv_content.push_str(&escaped_headers.join(","));
    csv_content.push('\n');

    // Write rows
    for row in &rows {
        let escaped_row: Vec<String> = row.iter().map(|cell| escape_csv_field(cell)).collect();
        csv_content.push_str(&escaped_row.join(","));
        csv_content.push('\n');
    }

    // Atomic write pattern: write to temp file, then rename
    let temp_path = full_path.with_extension("csv.tmp");

    // Write to temp file
    tokio::fs::write(&temp_path, &csv_content)
        .await
        .map_err(|e| CsvError::WriteError {
            message: format!("Failed to write temp file: {}", e),
        })?;

    // Rename temp file to final destination (atomic on most filesystems)
    tokio::fs::rename(&temp_path, &full_path)
        .await
        .map_err(|e| {
            // Clean up temp file if rename fails
            let _ = std::fs::remove_file(&temp_path);
            CsvError::WriteError {
                message: format!("Failed to save CSV file: {}", e),
            }
        })?;

    Ok(())
}

/// Gets the schema for a CSV file, optionally creating it if missing.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
/// * `path` - Relative path to the CSV file within the vault
/// * `create_if_missing` - If true and no schema exists, infer and create one (premium required)
///
/// # Returns
/// * `Ok(CsvSchema)` - The schema for the CSV file
/// * `Err(CsvError)` - If schema doesn't exist and create_if_missing is false, or premium required
///
/// # Behavior
/// - Free users can read existing schemas (marked read_only: true)
/// - Premium users can create new schemas when create_if_missing is true
/// - Newly created schemas are automatically saved to companion .vault.json file
#[tauri::command]
pub async fn get_csv_schema(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    path: String,
    create_if_missing: bool,
) -> Result<CsvSchema, CsvError> {
    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Validate path is within vault boundary
    let full_path = validate_path_within_vault(&path, &vault_path)?;

    // Check if schema exists
    let schema_exists = schema_store::schema_exists(&full_path).await;

    if schema_exists {
        // Load existing schema
        let mut schema = schema_store::load_schema(&full_path).await?;

        // Free users can read existing schemas, but they're marked read_only
        if !has_csv_premium(FEATURE_CSV_SCHEMA) {
            schema.read_only = true;
        }

        Ok(schema)
    } else if create_if_missing {
        // Creating a new schema requires premium
        require_csv_premium(FEATURE_CSV_SCHEMA)?;

        // Read CSV data to infer schema
        let csv_data = processor::read_csv(&full_path, None).await?;

        // Infer schema from data
        let schema = processor::infer_schema(&path, &csv_data, None);

        // Save the schema
        schema_store::save_schema(&full_path, &schema).await?;

        Ok(schema)
    } else {
        // No schema exists and not creating one
        Err(CsvError::SchemaNotFound {
            path: path.to_string(),
        })
    }
}

/// Infers a schema from a CSV file without saving it to disk.
///
/// This command analyzes the CSV data and returns an inferred schema
/// that the user can review and edit before explicitly saving.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
/// * `path` - Relative path to the CSV file within the vault
///
/// # Returns
/// * `Ok(CsvSchema)` - The inferred schema (not persisted to disk)
/// * `Err(CsvError)` - If reading the CSV fails or premium is required
#[tauri::command]
pub async fn infer_csv_schema(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    path: String,
) -> Result<CsvSchema, CsvError> {
    // Inferring schema requires premium
    require_csv_premium(FEATURE_CSV_SCHEMA)?;

    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Validate path is within vault boundary
    let full_path = validate_path_within_vault(&path, &vault_path)?;

    // Read CSV data to infer schema
    let csv_data = processor::read_csv(&full_path, None).await?;

    // Infer schema from data (does NOT save to disk)
    let schema = processor::infer_schema(&path, &csv_data, None);

    Ok(schema)
}

/// Saves a schema to the companion .vault.json file.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
/// * `path` - Relative path to the CSV file within the vault
/// * `schema` - The schema to save
///
/// # Returns
/// * `Ok(())` - If the schema was saved successfully
/// * `Err(CsvError)` - If saving fails or premium is required
///
/// # Behavior
/// - Requires premium (FEATURE_CSV_SCHEMA)
/// - Uses atomic write (temp file + rename) for data safety
/// - Overwrites any existing schema file
#[tauri::command]
pub async fn save_csv_schema(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    path: String,
    schema: CsvSchema,
) -> Result<(), CsvError> {
    // Saving schema requires premium
    require_csv_premium(FEATURE_CSV_SCHEMA)?;

    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Validate path is within vault boundary
    let full_path = validate_save_path_within_vault(&path, &vault_path)?;

    // Save the schema
    schema_store::save_schema(&full_path, &schema).await
}

/// Generates AI context for a CSV file.
///
/// Creates a rich context object containing schema information, sample data,
/// and relationship metadata optimized for LLM consumption.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
/// * `path` - Relative path to the CSV file within the vault
/// * `max_sample_rows` - Optional maximum number of sample rows to include (default: 10)
///
/// # Returns
/// * `Ok(CsvAiContext)` - AI-optimized context for the CSV file
/// * `Err(CsvError)` - If premium is required, file not found, or processing fails
///
/// # Behavior
/// - Requires premium (FEATURE_CSV_AI_CONTEXT)
/// - Loads existing schema or infers one if missing
/// - Includes sample data as markdown table
/// - Includes relationship context for cross-file understanding
#[tauri::command]
pub async fn get_csv_ai_context(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    path: String,
    max_sample_rows: Option<usize>,
) -> Result<CsvAiContext, CsvError> {
    // AI context requires premium
    require_csv_premium(FEATURE_CSV_AI_CONTEXT)?;

    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Validate path is within vault boundary
    let full_path = validate_path_within_vault(&path, &vault_path)?;

    // Load or infer schema
    let schema = if schema_store::schema_exists(&full_path).await {
        schema_store::load_schema(&full_path).await?
    } else {
        // Read CSV data to infer schema
        let csv_data = processor::read_csv(&full_path, None).await?;
        processor::infer_schema(&path, &csv_data, None)
    };

    // Read CSV data for sample rows
    let csv_data = processor::read_csv(&full_path, max_sample_rows).await?;

    // Generate AI context
    let ai_context = processor::generate_ai_context(&path, &schema, &csv_data, max_sample_rows);

    Ok(ai_context)
}

/// Gets statistics about CSV files in the vault.
///
/// Provides aggregate statistics about all CSV files in the vault.
/// Basic stats (total_files, files_with_schemas) are available to all users.
/// Extended stats (total_rows, largest_file) require premium.
///
/// # Arguments
/// * `window` - The Tauri window making the request
/// * `refactored_state` - Application state containing window-vault mappings
///
/// # Returns
/// * `Ok(CsvStatistics)` - Statistics about CSV files in the vault
/// * `Err(CsvError)` - If no vault is open or scanning fails
///
/// # Behavior
/// - total_files and files_with_schemas are always populated
/// - total_rows and largest_file are only populated for premium users
/// - Scans all CSV files to compute row counts (premium only)
#[tauri::command]
pub async fn get_csv_statistics(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<CsvStatistics, CsvError> {
    let window_id = extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or(CsvError::NoVaultSelected)?;

    // Get list of all CSV files
    let csv_files = schema_store::list_csv_files(&vault_path).await?;

    // Basic stats available to all users
    let total_files = csv_files.len();
    let files_with_schemas = csv_files.iter().filter(|f| f.has_schema).count();

    // Extended stats for premium users only
    let (total_rows, largest_file) = if has_premium_csv_features() {
        let mut total_row_count: usize = 0;
        let mut largest_file_path: Option<String> = None;
        let mut largest_file_size: u64 = 0;

        for file_info in &csv_files {
            // Track largest file by size
            if file_info.size > largest_file_size {
                largest_file_size = file_info.size;
                largest_file_path = Some(file_info.path.clone());
            }

            // Count rows in each file
            let full_path = vault_path.join(&file_info.path);
            if let Ok(csv_data) = processor::read_csv(&full_path, None).await {
                total_row_count += csv_data.total_rows;
            }
        }

        (Some(total_row_count), largest_file_path)
    } else {
        (None, None)
    };

    Ok(CsvStatistics {
        total_files,
        files_with_schemas,
        total_rows,
        largest_file,
    })
}

/// Exports content to an absolute file path.
///
/// This is used for exporting CSV/JSON files to user-selected locations
/// (via the save dialog). The path must be absolute.
///
/// # Arguments
/// * `path` - Absolute path to write to
/// * `content` - Content to write
///
/// # Returns
/// * `Ok(())` - If the file was written successfully
/// * `Err(CsvError)` - If writing fails
#[tauri::command]
pub async fn export_to_file(path: String, content: String) -> Result<(), CsvError> {
    use std::path::Path;

    let file_path = Path::new(&path);

    // Ensure it's an absolute path
    if !file_path.is_absolute() {
        return Err(CsvError::WriteError {
            message: "Export path must be absolute".to_string(),
        });
    }

    // Write the file
    tokio::fs::write(file_path, content.as_bytes())
        .await
        .map_err(|e| CsvError::WriteError {
            message: format!("Failed to write export file: {}", e),
        })?;

    Ok(())
}
