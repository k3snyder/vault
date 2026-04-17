// vault_agent_commands.rs - Secure vault operations for AI agent tools
//
// SECURITY: All path operations are validated in Rust before any file I/O.
// The frontend should NOT perform path validation - rely on this module.

use crate::refactored_app_state::{extract_window_id, RefactoredAppState};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{State, Window};

/// Maximum number of tool calls allowed per turn in agent loop
/// Note: This constant is enforced in the frontend (ClaudeAgentSDK.js)
/// Kept here for documentation and potential future Rust-side enforcement
#[allow(dead_code)]
pub const MAX_TOOL_CALLS_PER_TURN: usize = 10;

/// Result type for vault agent operations
#[derive(Debug, Serialize, Deserialize)]
pub struct VaultOperationResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<usize>,
}

/// Tag information with usage count
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
}

/// Note result for tag searches
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteInfo {
    pub path: String,
    pub title: String,
}

/// Path validation errors
#[derive(Debug)]
pub enum PathValidationError {
    EmptyPath,
    PathTraversal,
    AbsolutePath,
    InvalidCharacters,
    TooLong,
    OutsideVault,
}

impl std::fmt::Display for PathValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PathValidationError::EmptyPath => write!(f, "Path cannot be empty"),
            PathValidationError::PathTraversal => {
                write!(f, "Path traversal attack detected: '..' not allowed")
            }
            PathValidationError::AbsolutePath => {
                write!(
                    f,
                    "Absolute paths not allowed - use relative paths from vault root"
                )
            }
            PathValidationError::InvalidCharacters => {
                write!(f, "Path contains invalid characters")
            }
            PathValidationError::TooLong => {
                write!(f, "Path exceeds maximum length (1024 characters)")
            }
            PathValidationError::OutsideVault => {
                write!(f, "Resolved path is outside vault directory")
            }
        }
    }
}

/// Validate a relative path for security
///
/// SECURITY CHECKS:
/// 1. Not empty
/// 2. No path traversal (.. components)
/// 3. Not absolute path
/// 4. No null bytes or other dangerous characters
/// 5. Reasonable length
/// 6. When joined with vault path, still within vault
pub fn validate_relative_path(path: &str) -> Result<PathBuf, PathValidationError> {
    // Check empty
    if path.is_empty() || path.trim().is_empty() {
        return Err(PathValidationError::EmptyPath);
    }

    // Check length (prevent DoS)
    if path.len() > 1024 {
        return Err(PathValidationError::TooLong);
    }

    // Check for null bytes and other dangerous characters
    if path.contains('\0') {
        return Err(PathValidationError::InvalidCharacters);
    }

    let path_obj = Path::new(path);

    // Check if absolute (starts with / or Windows drive letter)
    if path_obj.is_absolute() || path.starts_with('/') || path.starts_with('\\') {
        return Err(PathValidationError::AbsolutePath);
    }

    // Check for path traversal - look for .. in any component
    // This catches: .., ../, ..\, foo/../bar, etc.
    for component in path_obj.components() {
        if let std::path::Component::ParentDir = component {
            return Err(PathValidationError::PathTraversal);
        }
    }

    // Additional string-based checks for edge cases like encoded traversal
    // Normalize the path string and check again
    let normalized = path
        .replace('\\', "/") // Normalize separators
        .replace("//", "/"); // Remove double separators

    if normalized.contains("..") {
        return Err(PathValidationError::PathTraversal);
    }

    Ok(PathBuf::from(path))
}

/// Validate and resolve a path against a vault root
/// Returns the full path if valid, error otherwise
pub fn validate_and_resolve_path(
    vault_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, PathValidationError> {
    // First validate the relative path
    let relative = validate_relative_path(relative_path)?;

    // Join with vault root
    let full_path = vault_root.join(&relative);

    // Canonicalize to resolve any remaining tricks (symlinks, etc.)
    // Note: The file doesn't need to exist for this security check
    // We normalize the vault root and check the prefix
    let vault_canonical = vault_root
        .canonicalize()
        .unwrap_or_else(|_| vault_root.to_path_buf());

    // For the full path, we can't canonicalize if it doesn't exist
    // So we use a normalized comparison approach
    let normalized_full = normalize_path(&full_path);
    let normalized_vault = normalize_path(&vault_canonical);

    // Check that the resolved path starts with the vault path
    if !normalized_full.starts_with(&normalized_vault) {
        return Err(PathValidationError::OutsideVault);
    }

    Ok(full_path)
}

/// Normalize a path for comparison (without requiring it to exist)
fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized
}

// ============================================================================
// TAURI COMMANDS - Secure vault operations for AI agent
// ============================================================================

/// Read a note's content with secure path validation
#[tauri::command]
pub async fn agent_read_note(
    file_path: String,
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<VaultOperationResult, String> {
    println!("📖 agent_read_note called with path: {}", file_path);

    // Validate path in Rust BEFORE any file operations
    if let Err(e) = validate_relative_path(&file_path) {
        println!("❌ Path validation failed: {}", e);
        return Ok(VaultOperationResult {
            success: false,
            message: format!("Security error: {}", e),
            path: Some(file_path),
            content: None,
            length: None,
        });
    }

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    // Double-check with vault root
                    match validate_and_resolve_path(vault.path(), &file_path) {
                        Ok(_resolved_path) => {
                            let path = std::path::Path::new(&file_path);
                            match vault.read_file(path) {
                                Ok(content) => {
                                    let len = content.len();
                                    println!("✅ agent_read_note read {} characters", len);
                                    Ok(VaultOperationResult {
                                        success: true,
                                        message: "Note read successfully".to_string(),
                                        path: Some(file_path),
                                        content: Some(content),
                                        length: Some(len),
                                    })
                                }
                                Err(e) => Ok(VaultOperationResult {
                                    success: false,
                                    message: format!("Failed to read note: {}", e),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                }),
                            }
                        }
                        Err(e) => Ok(VaultOperationResult {
                            success: false,
                            message: format!("Security error: {}", e),
                            path: Some(file_path),
                            content: None,
                            length: None,
                        }),
                    }
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

/// Write a new note with secure path validation
#[tauri::command]
pub async fn agent_write_note(
    file_path: String,
    content: String,
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<VaultOperationResult, String> {
    println!("📝 agent_write_note called with path: {}", file_path);

    // Validate path in Rust BEFORE any file operations
    if let Err(e) = validate_relative_path(&file_path) {
        println!("❌ Path validation failed: {}", e);
        return Ok(VaultOperationResult {
            success: false,
            message: format!("Security error: {}", e),
            path: Some(file_path),
            content: None,
            length: None,
        });
    }

    // Ensure .md extension
    let file_path = if !file_path.ends_with(".md") {
        format!("{}.md", file_path)
    } else {
        file_path
    };

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    // Validate with vault root
                    match validate_and_resolve_path(vault.path(), &file_path) {
                        Ok(resolved_path) => {
                            // Check if file already exists
                            if resolved_path.exists() {
                                return Ok(VaultOperationResult {
                                    success: false,
                                    message: "Note already exists. Use agent_update_note to modify existing notes.".to_string(),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                });
                            }

                            let path = std::path::Path::new(&file_path);
                            match vault.write_file(path, &content) {
                                Ok(()) => {
                                    println!("✅ agent_write_note created: {}", file_path);
                                    Ok(VaultOperationResult {
                                        success: true,
                                        message: "Note created successfully".to_string(),
                                        path: Some(file_path),
                                        content: None,
                                        length: Some(content.len()),
                                    })
                                }
                                Err(e) => Ok(VaultOperationResult {
                                    success: false,
                                    message: format!("Failed to create note: {}", e),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                }),
                            }
                        }
                        Err(e) => Ok(VaultOperationResult {
                            success: false,
                            message: format!("Security error: {}", e),
                            path: Some(file_path),
                            content: None,
                            length: None,
                        }),
                    }
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

/// Update an existing note with secure path validation
#[tauri::command]
pub async fn agent_update_note(
    file_path: String,
    content: String,
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<VaultOperationResult, String> {
    println!("📝 agent_update_note called with path: {}", file_path);

    // Validate path in Rust BEFORE any file operations
    if let Err(e) = validate_relative_path(&file_path) {
        println!("❌ Path validation failed: {}", e);
        return Ok(VaultOperationResult {
            success: false,
            message: format!("Security error: {}", e),
            path: Some(file_path),
            content: None,
            length: None,
        });
    }

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    // Validate with vault root
                    match validate_and_resolve_path(vault.path(), &file_path) {
                        Ok(resolved_path) => {
                            // Check if file exists
                            if !resolved_path.exists() {
                                return Ok(VaultOperationResult {
                                    success: false,
                                    message: "Note does not exist. Use agent_write_note to create new notes.".to_string(),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                });
                            }

                            let path = std::path::Path::new(&file_path);
                            match vault.write_file(path, &content) {
                                Ok(()) => {
                                    println!("✅ agent_update_note updated: {}", file_path);
                                    Ok(VaultOperationResult {
                                        success: true,
                                        message: "Note updated successfully".to_string(),
                                        path: Some(file_path),
                                        content: None,
                                        length: Some(content.len()),
                                    })
                                }
                                Err(e) => Ok(VaultOperationResult {
                                    success: false,
                                    message: format!("Failed to update note: {}", e),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                }),
                            }
                        }
                        Err(e) => Ok(VaultOperationResult {
                            success: false,
                            message: format!("Security error: {}", e),
                            path: Some(file_path),
                            content: None,
                            length: None,
                        }),
                    }
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

/// Append content to an existing note with secure path validation
#[tauri::command]
pub async fn agent_append_to_note(
    file_path: String,
    content: String,
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<VaultOperationResult, String> {
    println!("📝 agent_append_to_note called with path: {}", file_path);

    // Validate path in Rust BEFORE any file operations
    if let Err(e) = validate_relative_path(&file_path) {
        println!("❌ Path validation failed: {}", e);
        return Ok(VaultOperationResult {
            success: false,
            message: format!("Security error: {}", e),
            path: Some(file_path),
            content: None,
            length: None,
        });
    }

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    // Validate with vault root
                    match validate_and_resolve_path(vault.path(), &file_path) {
                        Ok(resolved_path) => {
                            // Check if file exists
                            if !resolved_path.exists() {
                                return Ok(VaultOperationResult {
                                    success: false,
                                    message: "Note does not exist. Use agent_write_note to create new notes.".to_string(),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                });
                            }

                            // Read existing content
                            let path = std::path::Path::new(&file_path);
                            let existing_content = match vault.read_file(path) {
                                Ok(c) => c,
                                Err(e) => {
                                    return Ok(VaultOperationResult {
                                        success: false,
                                        message: format!("Failed to read existing note: {}", e),
                                        path: Some(file_path),
                                        content: None,
                                        length: None,
                                    });
                                }
                            };

                            // Append new content (with newline separator if needed)
                            let new_content = if existing_content.ends_with('\n') {
                                format!("{}{}", existing_content, content)
                            } else {
                                format!("{}\n{}", existing_content, content)
                            };

                            match vault.write_file(path, &new_content) {
                                Ok(()) => {
                                    println!("✅ agent_append_to_note appended to: {}", file_path);
                                    Ok(VaultOperationResult {
                                        success: true,
                                        message: "Content appended successfully".to_string(),
                                        path: Some(file_path),
                                        content: None,
                                        length: Some(content.len()),
                                    })
                                }
                                Err(e) => Ok(VaultOperationResult {
                                    success: false,
                                    message: format!("Failed to append to note: {}", e),
                                    path: Some(file_path),
                                    content: None,
                                    length: None,
                                }),
                            }
                        }
                        Err(e) => Ok(VaultOperationResult {
                            success: false,
                            message: format!("Security error: {}", e),
                            path: Some(file_path),
                            content: None,
                            length: None,
                        }),
                    }
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

/// List all tags in the vault
#[tauri::command]
pub async fn agent_list_tags(
    limit: Option<usize>,
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Vec<TagInfo>, String> {
    println!("🏷️ agent_list_tags called");

    let window_id = extract_window_id(&window);
    let limit = limit.unwrap_or(50);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let files = vault
                        .list_markdown_files()
                        .map_err(|e| format!("Failed to list files: {}", e))?;

                    let mut tag_counts: HashMap<String, usize> = HashMap::new();

                    // Regex for finding tags: #tag-name (but not ## headers or # at end of URL)
                    let tag_regex =
                        Regex::new(r"(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)(?:\s|$|[.,!?;:])")
                            .map_err(|e| format!("Regex error: {}", e))?;

                    for file_path in files {
                        if file_path.is_dir() {
                            continue;
                        }

                        // Only process .md files
                        if file_path.extension().and_then(|e| e.to_str()) != Some("md") {
                            continue;
                        }

                        // Read file content
                        if let Ok(content) = std::fs::read_to_string(&file_path) {
                            for cap in tag_regex.captures_iter(&content) {
                                if let Some(tag) = cap.get(1) {
                                    let tag_name = tag.as_str().to_string();
                                    *tag_counts.entry(tag_name).or_insert(0) += 1;
                                }
                            }
                        }
                    }

                    // Convert to sorted list
                    let mut tags: Vec<TagInfo> = tag_counts
                        .into_iter()
                        .map(|(name, count)| TagInfo { name, count })
                        .collect();

                    // Sort by count descending, then by name
                    tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));

                    // Apply limit
                    tags.truncate(limit);

                    println!("✅ agent_list_tags found {} tags", tags.len());
                    Ok(tags)
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

/// Find notes by tag
#[tauri::command]
pub async fn agent_notes_by_tag(
    tag: String,
    limit: Option<usize>,
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Vec<NoteInfo>, String> {
    println!("🏷️ agent_notes_by_tag called for tag: {}", tag);

    let window_id = extract_window_id(&window);
    let limit = limit.unwrap_or(20);

    // Normalize tag (remove leading # if present)
    let tag_normalized = if tag.starts_with('#') {
        &tag[1..]
    } else {
        &tag
    };

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let files = vault
                        .list_markdown_files()
                        .map_err(|e| format!("Failed to list files: {}", e))?;

                    let mut results: Vec<NoteInfo> = Vec::new();

                    // Pattern to find specific tag
                    let pattern = format!(
                        r"(?:^|\s)#{}(?:\s|$|[.,!?;:])",
                        regex::escape(tag_normalized)
                    );
                    let tag_regex =
                        Regex::new(&pattern).map_err(|e| format!("Regex error: {}", e))?;

                    for file_path in files {
                        if file_path.is_dir() {
                            continue;
                        }

                        // Only process .md files
                        if file_path.extension().and_then(|e| e.to_str()) != Some("md") {
                            continue;
                        }

                        // Read file content
                        if let Ok(content) = std::fs::read_to_string(&file_path) {
                            if tag_regex.is_match(&content) {
                                // Get relative path from vault
                                let relative_path = file_path
                                    .strip_prefix(vault.path())
                                    .unwrap_or(&file_path)
                                    .to_string_lossy()
                                    .to_string();

                                // Extract title from filename or first heading
                                let title = file_path
                                    .file_stem()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or("Untitled")
                                    .to_string();

                                results.push(NoteInfo {
                                    path: relative_path,
                                    title,
                                });

                                if results.len() >= limit {
                                    break;
                                }
                            }
                        }
                    }

                    println!("✅ agent_notes_by_tag found {} notes", results.len());
                    Ok(results)
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

/// Semantic search (placeholder - requires premium/embeddings)
#[tauri::command]
pub async fn agent_semantic_search(
    query: String,
    limit: Option<usize>,
    _window: Window,
    _refactored_state: State<'_, RefactoredAppState>,
) -> Result<Vec<NoteInfo>, String> {
    println!("🧠 agent_semantic_search called for query: {}", query);
    let _limit = limit.unwrap_or(10);

    // For now, return an error indicating this requires premium
    // In a full implementation, this would:
    // 1. Check premium status
    // 2. Generate embeddings for the query
    // 3. Search against pre-computed embeddings
    // 4. Return ranked results

    Err("Semantic search requires premium subscription. Please upgrade or use search_notes instead.".to_string())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_relative_path_empty() {
        assert!(matches!(
            validate_relative_path(""),
            Err(PathValidationError::EmptyPath)
        ));
        assert!(matches!(
            validate_relative_path("   "),
            Err(PathValidationError::EmptyPath)
        ));
    }

    #[test]
    fn test_validate_relative_path_traversal() {
        assert!(matches!(
            validate_relative_path(".."),
            Err(PathValidationError::PathTraversal)
        ));
        assert!(matches!(
            validate_relative_path("../secret.txt"),
            Err(PathValidationError::PathTraversal)
        ));
        assert!(matches!(
            validate_relative_path("foo/../../../etc/passwd"),
            Err(PathValidationError::PathTraversal)
        ));
        assert!(matches!(
            validate_relative_path("foo/bar/../../../etc/passwd"),
            Err(PathValidationError::PathTraversal)
        ));
    }

    #[test]
    fn test_validate_relative_path_absolute() {
        assert!(matches!(
            validate_relative_path("/etc/passwd"),
            Err(PathValidationError::AbsolutePath)
        ));
        assert!(matches!(
            validate_relative_path("\\Windows\\System32"),
            Err(PathValidationError::AbsolutePath)
        ));
    }

    #[test]
    fn test_validate_relative_path_valid() {
        assert!(validate_relative_path("notes/my-note.md").is_ok());
        assert!(validate_relative_path("folder/subfolder/file.md").is_ok());
        assert!(validate_relative_path("simple.md").is_ok());
        assert!(validate_relative_path("folder with spaces/note.md").is_ok());
    }

    #[test]
    fn test_validate_relative_path_null_byte() {
        assert!(matches!(
            validate_relative_path("file\0name.md"),
            Err(PathValidationError::InvalidCharacters)
        ));
    }

    #[test]
    fn test_validate_relative_path_too_long() {
        let long_path = "a".repeat(1025);
        assert!(matches!(
            validate_relative_path(&long_path),
            Err(PathValidationError::TooLong)
        ));
    }
}
