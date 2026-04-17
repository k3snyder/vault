use crate::refactored_app_state::RefactoredAppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{State, Window};

/// Response type for get_vault_notes command
#[derive(Debug, Serialize, Deserialize)]
pub struct VaultNote {
    pub name: String,  // Display name without extension
    pub path: String,  // Relative path from vault root
    pub title: String, // Note title (same as name for now)
}

/// Response type for resolve_wikilink command
#[derive(Debug, Serialize, Deserialize)]
pub struct WikiLinkResolution {
    pub exists: bool,
    pub path: Option<String>, // Relative path from vault root if exists
    pub name: String,         // Original WikiLink name
}

/// Normalize WikiLink name for file system matching
/// Handles case-insensitive matching and special characters
fn normalize_wikilink_name(name: &str) -> String {
    name.trim()
        .replace("  ", " ") // Replace double spaces with single
        .to_lowercase() // Case insensitive
}

/// Extract note title from file path
/// For "My Note.md" returns "My Note"
fn extract_note_title(file_path: &Path) -> String {
    file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("")
        .to_string()
}

/// Check if a file path represents a markdown note
fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase() == "md")
        .unwrap_or(false)
}

/// Find all markdown files in a directory recursively
fn find_markdown_files(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut markdown_files = Vec::new();

    if !dir.exists() || !dir.is_dir() {
        return Ok(markdown_files);
    }

    let entries = std::fs::read_dir(dir)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            // Recursively search subdirectories
            let mut sub_files = find_markdown_files(&path)?;
            markdown_files.append(&mut sub_files);
        } else if is_markdown_file(&path) {
            markdown_files.push(path);
        }
    }

    Ok(markdown_files)
}

/// Tauri command to get all notes in the current vault
#[tauri::command]
pub async fn get_vault_notes(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Vec<VaultNote>, String> {
    let window_id = crate::refactored_app_state::extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or_else(|| "No vault is currently open".to_string())?;

    // Find all markdown files in the vault
    let markdown_files = find_markdown_files(&vault_path)
        .map_err(|e| format!("Failed to scan vault directory: {}", e))?;

    let mut notes = Vec::new();

    for file_path in markdown_files {
        // Get relative path from vault root
        let relative_path = file_path
            .strip_prefix(&vault_path)
            .map_err(|_| "Failed to create relative path".to_string())?
            .to_string_lossy()
            .to_string();

        let note_title = extract_note_title(&file_path);

        notes.push(VaultNote {
            name: note_title.clone(),
            path: relative_path,
            title: note_title,
        });
    }

    // Sort notes by name for consistent ordering
    notes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(notes)
}

/// Tauri command to resolve a WikiLink name to a file path
#[tauri::command]
pub async fn resolve_wikilink(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    link_name: String,
) -> Result<WikiLinkResolution, String> {
    if link_name.trim().is_empty() {
        return Ok(WikiLinkResolution {
            exists: false,
            path: None,
            name: link_name,
        });
    }

    let window_id = crate::refactored_app_state::extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or_else(|| "No vault is currently open".to_string())?;

    // Get all notes in the vault
    let vault_notes = get_vault_notes(window, refactored_state).await?;

    let normalized_link_name = normalize_wikilink_name(&link_name);

    // Try to find exact match first, then case-insensitive match
    for note in vault_notes {
        let normalized_note_name = normalize_wikilink_name(&note.name);

        if normalized_note_name == normalized_link_name {
            return Ok(WikiLinkResolution {
                exists: true,
                path: Some(note.path),
                name: link_name,
            });
        }
    }

    // No match found
    Ok(WikiLinkResolution {
        exists: false,
        path: None,
        name: link_name,
    })
}

/// Response type for create_note_from_wikilink command
#[derive(Debug, Serialize, Deserialize)]
pub struct NoteCreationResult {
    pub path: String,    // Relative path from vault root
    pub name: String,    // Note name/title
    pub content: String, // Initial content
}

/// Convert WikiLink name to a safe filename
/// Handles special characters and ensures valid file naming
fn wikilink_name_to_filename(name: &str) -> String {
    name.trim()
        // Replace characters that aren't filename-safe
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-")
        // Replace multiple spaces with single space
        .replace("  ", " ")
        // Trim any remaining whitespace
        .trim()
        .to_string()
}

/// Generate initial content for a new note based on WikiLink name
fn generate_initial_content(note_name: &str) -> String {
    format!("# {}\n\n", note_name)
}

/// Tauri command to create a new note from WikiLink
#[tauri::command]
pub async fn create_note_from_wikilink(
    window: Window,
    refactored_state: State<'_, RefactoredAppState>,
    note_name: String,
) -> Result<NoteCreationResult, String> {
    if note_name.trim().is_empty() {
        return Err("Note name cannot be empty".to_string());
    }

    let window_id = crate::refactored_app_state::extract_window_id(&window);

    // Get vault path from window state
    let vault_path = refactored_state
        .get_window_vault_path(&window_id)
        .await
        .ok_or_else(|| "No vault is currently open".to_string())?;

    // Convert WikiLink name to safe filename
    let safe_filename = wikilink_name_to_filename(&note_name);
    if safe_filename.is_empty() {
        return Err("Cannot create filename from note name".to_string());
    }

    // Create filename with .md extension
    let filename = format!("{}.md", safe_filename);
    let file_path = vault_path.join(&filename);

    // Check if file already exists
    if file_path.exists() {
        return Err(format!("A note named '{}' already exists", safe_filename));
    }

    // Generate initial content
    let initial_content = generate_initial_content(&note_name);

    // Write the file
    std::fs::write(&file_path, &initial_content)
        .map_err(|e| format!("Failed to create note file: {}", e))?;

    // Return relative path from vault root
    let relative_path = filename; // Since we're creating in vault root

    Ok(NoteCreationResult {
        path: relative_path,
        name: note_name,
        content: initial_content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create a temporary test vault with sample notes
    fn create_test_vault() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let vault_path = temp_dir.path().to_path_buf();

        // Create some test notes
        fs::write(
            vault_path.join("Simple Note.md"),
            "# Simple Note\n\nContent here.",
        )
        .unwrap();
        fs::write(
            vault_path.join("Complex Note With Spaces.md"),
            "# Complex Note\n\nMore content.",
        )
        .unwrap();
        fs::write(
            vault_path.join("note-with-hyphens.md"),
            "# Note with Hyphens\n\nHyphenated content.",
        )
        .unwrap();
        fs::write(
            vault_path.join("UPPERCASE.md"),
            "# Uppercase Note\n\nAll caps.",
        )
        .unwrap();

        // Create a subdirectory with notes
        fs::create_dir(vault_path.join("subfolder")).unwrap();
        fs::write(
            vault_path.join("subfolder/Nested Note.md"),
            "# Nested Note\n\nNested content.",
        )
        .unwrap();

        // Create non-markdown files (should be ignored)
        fs::write(vault_path.join("not-markdown.txt"), "This is not markdown").unwrap();
        fs::write(vault_path.join("README"), "No extension").unwrap();

        (temp_dir, vault_path)
    }

    #[test]
    fn test_normalize_wikilink_name() {
        assert_eq!(normalize_wikilink_name("Simple Note"), "simple note");
        assert_eq!(normalize_wikilink_name("  Trimmed  "), "trimmed");
        assert_eq!(
            normalize_wikilink_name("Multiple  Spaces"),
            "multiple spaces"
        );
        assert_eq!(normalize_wikilink_name("UPPERCASE"), "uppercase");
        assert_eq!(normalize_wikilink_name(""), "");
    }

    #[test]
    fn test_extract_note_title() {
        assert_eq!(
            extract_note_title(Path::new("Simple Note.md")),
            "Simple Note"
        );
        assert_eq!(
            extract_note_title(Path::new("path/to/Complex Note.md")),
            "Complex Note"
        );
        assert_eq!(
            extract_note_title(Path::new("no-extension")),
            "no-extension"
        );
        assert_eq!(extract_note_title(Path::new("")), "");
    }

    #[test]
    fn test_is_markdown_file() {
        assert!(is_markdown_file(Path::new("test.md")));
        assert!(is_markdown_file(Path::new("test.MD")));
        assert!(!is_markdown_file(Path::new("test.txt")));
        assert!(!is_markdown_file(Path::new("test")));
        assert!(!is_markdown_file(Path::new("test.pdf")));
    }

    #[test]
    fn test_find_markdown_files() {
        let (_temp_dir, vault_path) = create_test_vault();

        let files = find_markdown_files(&vault_path).unwrap();

        // Should find 5 markdown files (4 in root, 1 in subfolder)
        assert_eq!(files.len(), 5);

        // Check that all files are markdown files
        for file in &files {
            assert!(is_markdown_file(file));
        }

        // Check that specific files exist
        let file_names: Vec<String> = files
            .iter()
            .map(|f| f.file_name().unwrap().to_str().unwrap().to_string())
            .collect();

        assert!(file_names.contains(&"Simple Note.md".to_string()));
        assert!(file_names.contains(&"Complex Note With Spaces.md".to_string()));
        assert!(file_names.contains(&"note-with-hyphens.md".to_string()));
        assert!(file_names.contains(&"UPPERCASE.md".to_string()));
        assert!(file_names.contains(&"Nested Note.md".to_string()));

        // Should not contain non-markdown files
        assert!(!file_names.contains(&"not-markdown.txt".to_string()));
        assert!(!file_names.contains(&"README".to_string()));
    }

    #[test]
    fn test_find_markdown_files_empty_directory() {
        let temp_dir = TempDir::new().unwrap();
        let empty_vault = temp_dir.path();

        let files = find_markdown_files(empty_vault).unwrap();
        assert_eq!(files.len(), 0);
    }

    #[test]
    fn test_find_markdown_files_nonexistent_directory() {
        let nonexistent = Path::new("/this/path/does/not/exist");
        let files = find_markdown_files(nonexistent).unwrap();
        assert_eq!(files.len(), 0);
    }

    // Note: Integration tests for the Tauri commands would require setting up
    // a mock Tauri application context, which is complex. These tests cover the
    // core logic functions that the commands rely on.

    #[test]
    fn test_wikilink_resolution_logic() {
        let (_temp_dir, vault_path) = create_test_vault();
        let files = find_markdown_files(&vault_path).unwrap();

        // Create mock vault notes for testing resolution logic
        let mut vault_notes = Vec::new();
        for file_path in files {
            let relative_path = file_path
                .strip_prefix(&vault_path)
                .unwrap()
                .to_string_lossy()
                .to_string();
            let note_title = extract_note_title(&file_path);

            vault_notes.push(VaultNote {
                name: note_title.clone(),
                path: relative_path,
                title: note_title,
            });
        }

        // Test exact matches
        assert!(vault_notes
            .iter()
            .any(|n| normalize_wikilink_name(&n.name) == normalize_wikilink_name("Simple Note")));
        assert!(vault_notes.iter().any(|n| normalize_wikilink_name(&n.name)
            == normalize_wikilink_name("Complex Note With Spaces")));

        // Test case-insensitive matches
        assert!(vault_notes
            .iter()
            .any(|n| normalize_wikilink_name(&n.name) == normalize_wikilink_name("simple note")));
        assert!(vault_notes
            .iter()
            .any(|n| normalize_wikilink_name(&n.name) == normalize_wikilink_name("SIMPLE NOTE")));
        assert!(vault_notes
            .iter()
            .any(|n| normalize_wikilink_name(&n.name) == normalize_wikilink_name("uppercase")));

        // Test non-matches
        assert!(!vault_notes.iter().any(
            |n| normalize_wikilink_name(&n.name) == normalize_wikilink_name("Nonexistent Note")
        ));
        assert!(!vault_notes
            .iter()
            .any(|n| normalize_wikilink_name(&n.name) == normalize_wikilink_name("")));
    }

    #[test]
    fn test_special_characters_in_wikilink_names() {
        // Test that special characters are handled properly
        assert_eq!(
            normalize_wikilink_name("Note with hyphens"),
            "note with hyphens"
        );
        assert_eq!(
            normalize_wikilink_name("Note_with_underscores"),
            "note_with_underscores"
        );
        assert_eq!(
            normalize_wikilink_name("Note123 with numbers"),
            "note123 with numbers"
        );
        assert_eq!(
            normalize_wikilink_name("Note (with parentheses)"),
            "note (with parentheses)"
        );
    }

    #[test]
    fn test_wikilink_name_to_filename() {
        // Test safe filename generation
        assert_eq!(wikilink_name_to_filename("Simple Note"), "Simple Note");
        assert_eq!(
            wikilink_name_to_filename("Note with spaces"),
            "Note with spaces"
        );
        assert_eq!(
            wikilink_name_to_filename("Note/with/slashes"),
            "Note-with-slashes"
        );
        assert_eq!(
            wikilink_name_to_filename("Note\\with\\backslashes"),
            "Note-with-backslashes"
        );
        assert_eq!(
            wikilink_name_to_filename("Note:with:colons"),
            "Note-with-colons"
        );
        assert_eq!(
            wikilink_name_to_filename("Note*with*asterisks"),
            "Note-with-asterisks"
        );
        assert_eq!(
            wikilink_name_to_filename("Note?with?questions"),
            "Note-with-questions"
        );
        assert_eq!(
            wikilink_name_to_filename("Note\"with\"quotes"),
            "Note-with-quotes"
        );
        assert_eq!(
            wikilink_name_to_filename("Note<with>brackets"),
            "Note-with-brackets"
        );
        assert_eq!(
            wikilink_name_to_filename("Note|with|pipes"),
            "Note-with-pipes"
        );
        assert_eq!(
            wikilink_name_to_filename("  Trimmed Note  "),
            "Trimmed Note"
        );
        assert_eq!(
            wikilink_name_to_filename("Multiple  Spaces"),
            "Multiple Spaces"
        );
    }

    #[test]
    fn test_wikilink_name_to_filename_edge_cases() {
        // Test edge cases
        assert_eq!(wikilink_name_to_filename(""), "");
        assert_eq!(wikilink_name_to_filename("   "), "");
        assert_eq!(wikilink_name_to_filename("///"), "---");
        assert_eq!(wikilink_name_to_filename("***"), "---");
    }

    #[test]
    fn test_generate_initial_content() {
        // Test content generation
        assert_eq!(generate_initial_content("Test Note"), "# Test Note\n\n");
        assert_eq!(
            generate_initial_content("Complex Note Name"),
            "# Complex Note Name\n\n"
        );
        assert_eq!(generate_initial_content(""), "# \n\n");
    }
}
