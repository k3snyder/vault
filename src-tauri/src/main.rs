#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use parking_lot::RwLock;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use walkdir::WalkDir;

mod ai_settings;
mod ai_settings_multi;
mod ai_stream;
mod botcky;
mod command_error;
mod commands;
mod csv;
mod editor;
mod identity;
mod image_fetch;
mod license;
mod logging;
mod pdf_export;
mod pdf_intelligence;
mod plugin_runtime;
mod plugins;
mod refactored_app_state;
mod secrets;
mod tasks;
mod vault;
mod vault_agent_commands;
mod vault_id;
mod vault_settings;
mod widget_settings;
mod window_commands_basic;
mod window_factory;
mod window_lifecycle;
mod window_state;

use ai_settings::test_ai_connection;
use ai_settings_multi::{
    get_active_ai_provider, get_ai_settings, get_ai_settings_for_provider, migrate_ai_settings,
    save_ai_settings, save_ai_settings_for_provider, set_active_ai_provider,
};
use ai_stream::{
    check_ollama_status, debug_send_ai_chat, search_notes_by_name, send_ai_chat,
    send_ai_chat_stream, send_ai_chat_with_functions, send_ai_chat_with_functions_stream,
    test_messages,
};
use command_error::{CommandError, CommandResult};
use commands::ghostty::{
    ghostty_installation_status, ghostty_spawn, ghostty_status, ghostty_stop, ghostty_write,
    register_ghostty_commands, GhosttyManager,
};
use commands::pty::{pty_close, pty_resize, pty_spawn, pty_write, PtyManager};
use commands::util::{check_command_exists, get_bundle_path};
use editor::EditorManager;
use identity::IdentityManager;
use pdf_export::{ExportOptions, PdfExporter};
use pdf_intelligence::commands::{
    export_intelligence_markdown, extract_pdf_intelligence, extract_pdf_intelligence_v2,
    load_intelligence_result, save_intelligence_result, save_intelligence_result_v2,
};
use refactored_app_state::{extract_window_id, RefactoredAppState};
use vault::Vault;
use vault_settings::{
    get_vault_settings, list_all_vault_settings, reset_vault_settings, save_vault_settings,
    validate_image_location,
};
use widget_settings::{get_widget_settings, save_widget_settings};
use window_commands_basic::{
    get_recent_vaults_basic, manage_vaults_basic, open_vault_in_new_window_basic,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteSearchResult {
    pub name: String,
    pub path: String,
}

#[allow(dead_code)]
pub struct AppState {
    vault: Arc<Mutex<Option<Vault>>>,
    editor: EditorManager,
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
    plugin_runtime: Arc<Mutex<plugin_runtime::PluginRuntime>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VaultInfo {
    path: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    path: String,
    name: String,
    is_dir: bool,
    extension: Option<String>,
    depth: usize,
    parent_path: Option<String>,
    created: Option<i64>,  // Unix timestamp
    modified: Option<i64>, // Unix timestamp
}

#[derive(Debug, Serialize, Deserialize)]
struct FileTree {
    files: Vec<FileInfo>,
}

fn resolve_vault_path(vault: &Vault, relative_path: impl AsRef<Path>) -> CommandResult<PathBuf> {
    let relative_path = relative_path.as_ref();
    vault
        .resolve_path(relative_path)
        .map_err(|error| CommandError::InvalidPath {
            path: relative_path.to_string_lossy().to_string(),
            reason: error.to_string(),
        })
}

fn resolve_vault_input_path(vault: &Vault, input_path: impl AsRef<Path>) -> CommandResult<PathBuf> {
    let input_path = input_path.as_ref();
    vault
        .resolve_input_path(input_path)
        .map_err(|error| CommandError::InvalidPath {
            path: input_path.to_string_lossy().to_string(),
            reason: error.to_string(),
        })
}

async fn spawn_blocking_command<T, F>(task: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| CommandError::Other {
            message: format!("blocking task failed: {error}"),
        })?
}

async fn spawn_blocking_string<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("blocking task failed: {error}"))?
}

fn is_file_tree_entry(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("md")
            | Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("pdf")
            | Some("csv")
            | Some("json")
            | Some("excalidraw")
            | Some("boxnote")
            | Some("html")
            | Some("htm")
    )
}

fn build_file_tree(vault_root: &Path) -> CommandResult<FileTree> {
    let mut file_infos = Vec::new();

    for entry in WalkDir::new(vault_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        let file_type = entry.file_type();

        if path == vault_root || file_type.is_symlink() {
            continue;
        }

        if !(file_type.is_dir() || file_type.is_file() && is_file_tree_entry(path)) {
            continue;
        }

        let relative_path = path
            .strip_prefix(vault_root)
            .map_err(|error| CommandError::Other {
                message: format!("failed to strip vault prefix from {path:?}: {error}"),
            })?;
        let components: Vec<_> = relative_path.components().collect();
        let parent_path = if components.len() > 1 {
            relative_path
                .parent()
                .map(|parent| parent.to_string_lossy().to_string())
        } else {
            None
        };

        let (created, modified) = match entry.metadata() {
            Ok(metadata) => {
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs() as i64);
                let created = metadata
                    .created()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs() as i64);

                (created, modified)
            }
            Err(error) => {
                println!("⚠️ Failed to get metadata for {path:?}: {error}");
                (None, None)
            }
        };

        file_infos.push(FileInfo {
            path: relative_path.to_string_lossy().to_string(),
            name: relative_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string(),
            is_dir: file_type.is_dir(),
            extension: path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.to_string()),
            depth: components.len(),
            parent_path,
            created,
            modified,
        });
    }

    file_infos.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(FileTree { files: file_infos })
}

fn strip_leading_frontmatter(s: String) -> String {
    let starts_with_yaml = s.starts_with("---\n") || s.starts_with("---\r\n");
    if !starts_with_yaml {
        return s;
    }

    let has_crlf = s.contains("\r\n");
    let search_start = if s.starts_with("---\r\n") { 5 } else { 4 };
    let pattern_start = if has_crlf { "\r\n---" } else { "\n---" };
    let closing_pattern = if has_crlf { "\r\n---\r\n" } else { "\n---\n" };
    if let Some(end_pos) = s[search_start..].find(pattern_start) {
        let end_index = search_start + end_pos + closing_pattern.len();
        if end_index <= s.len() {
            return s[end_index..].to_string();
        }
    }

    s
}

fn prepare_file_content_for_write(full_path: &Path, content: String) -> (String, Option<String>) {
    if full_path
        .extension()
        .and_then(|extension| extension.to_str())
        != Some("md")
    {
        return (content, None);
    }

    use identity::frontmatter::{FrontMatterParser, FrontMatterWriter};

    let (existing_fm, raw_body) =
        FrontMatterParser::parse(&content).unwrap_or((None, content.clone()));
    let body = strip_leading_frontmatter(raw_body);

    if let Some(mut fm) = existing_fm {
        if fm.id.is_some() {
            let new_time = chrono::Utc::now();
            fm.updated_at = Some(new_time);
            let updated = FrontMatterWriter::write(&fm, &body).unwrap_or(content);
            return (updated, Some(new_time.to_rfc3339()));
        }
    }

    (content, None)
}

fn write_file_content_sync(
    full_path: PathBuf,
    content: String,
    identity_manager: Arc<RwLock<IdentityManager>>,
) -> CommandResult<Option<String>> {
    let (updated_content, new_timestamp) = prepare_file_content_for_write(&full_path, content);

    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CommandError::io(parent, e))?;
    }

    std::fs::write(&full_path, &updated_content).map_err(|e| CommandError::io(&full_path, e))?;

    if full_path.extension().and_then(|e| e.to_str()) == Some("md") {
        let mut manager = identity_manager.write();
        let _ = manager.get_note_id(&full_path);
    }

    Ok(new_timestamp)
}

static APPROVED_EXPORT_PATHS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();

fn approved_export_paths() -> &'static StdMutex<HashSet<PathBuf>> {
    APPROVED_EXPORT_PATHS.get_or_init(|| StdMutex::new(HashSet::new()))
}

fn normalize_export_target(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("Export path must be absolute: {path:?}"));
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Export path is missing a filename: {path:?}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("Export path is missing a parent directory: {path:?}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve export directory {parent:?}: {error}"))?;

    Ok(canonical_parent.join(file_name))
}

fn approve_export_path(path: &Path) -> Result<(), String> {
    let normalized = normalize_export_target(path)?;
    approved_export_paths()
        .lock()
        .map_err(|_| "Failed to lock export approval state".to_string())?
        .insert(normalized);
    Ok(())
}

fn consume_approved_export_path(path: &Path) -> Result<PathBuf, String> {
    let normalized = normalize_export_target(path)?;
    let removed = approved_export_paths()
        .lock()
        .map_err(|_| "Failed to lock export approval state".to_string())?
        .remove(&normalized);

    if !removed {
        return Err(format!(
            "Write access denied for unapproved export path {normalized:?}"
        ));
    }

    Ok(normalized)
}

#[tauri::command]
async fn get_window_state(
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Option<VaultInfo>, String> {
    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let path = vault.path();
                    Ok(Some(VaultInfo {
                        path: path.to_string_lossy().to_string(),
                        name: path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Untitled")
                            .to_string(),
                    }))
                }
                None => Ok(None),
            }
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn window_closing(
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<(), String> {
    let window_id = extract_window_id(&window);
    println!("Window {window_id} is closing");

    // Perform any cleanup needed
    if let Err(e) = refactored_state.unregister_window_vault(&window_id).await {
        eprintln!("Warning: Failed to unregister window vault during close: {e}");
    }

    Ok(())
}

#[tauri::command]
async fn open_vault(
    path: String,
    window: tauri::Window,
    app: tauri::AppHandle,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<VaultInfo> {
    println!("🔓 open_vault called with path: {path}");
    let vault_path = PathBuf::from(&path);

    if !vault_path.exists() {
        println!("❌ Vault directory does not exist: {path}");
        return Err(CommandError::NotFound { path });
    }

    if !vault_path.is_dir() {
        println!("❌ Path is not a directory: {path}");
        return Err(CommandError::InvalidPath {
            path,
            reason: "path is not a directory".to_string(),
        });
    }

    let vault_info = VaultInfo {
        path: path.clone(),
        name: vault_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
            .to_string(),
    };

    println!("📁 Vault info: {vault_info:?}");

    // Get window ID and register with vault
    let window_id = extract_window_id(&window);
    println!("🪟 Window ID: {window_id}");

    // Register window if not already registered
    if refactored_state
        .get_window_state(&window_id)
        .await
        .is_none()
    {
        println!("📝 Registering window with ID: {window_id}");
        refactored_state
            .register_window_with_id(window_id.clone(), app.clone())
            .await
            .map_err(CommandError::other)?;
    }

    // Register the window with the vault
    println!("🔗 Registering window with vault...");
    refactored_state
        .register_window_vault(&window_id, vault_path.clone())
        .await
        .map_err(CommandError::other)?;
    println!("✅ Window registered with vault");

    // Reinitialize IdentityManager to use this vault path so task index and UUID ops target the right vault
    println!("🔄 Starting IdentityManager reinitialization...");
    if let Some(state) = app.try_state::<Arc<RwLock<IdentityManager>>>() {
        println!("  📝 Found IdentityManager state");
        let mut mgr = state.write();
        *mgr = IdentityManager::new(vault_path.clone());
        println!(
            "  ✅ IdentityManager reinitialized for vault: {}",
            vault_path.display()
        );
    } else {
        println!("  ⚠️ IdentityManager state not found");
    }
    println!("✅ IdentityManager reinitialization complete");

    // Manually trigger task scanning after vault is open (avoiding deadlock)
    {
        println!("📚 Triggering manual task index population...");
        let vault_path_for_scan = vault_path.clone();
        if let Some(identity_mgr) = app.try_state::<Arc<RwLock<IdentityManager>>>() {
            let manager_snapshot = { identity_mgr.read().clone() };

            // Spawn scanning task to avoid blocking
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await; // Small delay to ensure vault is fully ready
                println!("🔍 Starting background task scan for vault: {vault_path_for_scan:?}");
                if let Err(e) = manager_snapshot.scan_vault_for_tasks_async().await {
                    eprintln!("⚠️ Failed to scan vault for tasks: {e}");
                } else {
                    println!("✅ Background task scan completed");
                }
            });
        } else {
            println!("⚠️ Could not get IdentityManager state for task scanning");
        }
    }

    // Update recent vaults
    println!("📝 Updating recent vaults...");
    let mut persistence = crate::window_lifecycle::AppPersistenceState::load().unwrap_or_default();
    persistence.add_recent_vault(path.clone());
    let _ = persistence.save();

    println!("🎉 open_vault completed successfully, returning vault_info");
    Ok(vault_info)
}

#[tauri::command]
async fn read_file_base64(
    path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let window_id = extract_window_id(&window);
    let window_state = refactored_state
        .get_window_state(&window_id)
        .await
        .ok_or("Window not found".to_string())?;
    let vault_lock = window_state.vault.lock().await;
    let vault = vault_lock.as_ref().ok_or("No vault opened".to_string())?;
    let file_path = resolve_vault_input_path(vault, Path::new(&path))?;
    drop(vault_lock);

    spawn_blocking_string(move || {
        let file_data =
            std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {e}"))?;
        Ok(general_purpose::STANDARD.encode(file_data))
    })
    .await
}

#[tauri::command]
async fn create_new_sketch(
    file_name: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<String, String> {
    let window_id = extract_window_id(&window);

    let window_state = refactored_state
        .get_window_state(&window_id)
        .await
        .ok_or("Window not found")?;

    let vault_lock = window_state.vault.lock().await;
    let vault = vault_lock.as_ref().ok_or("No vault opened")?;

    let sketches_path = resolve_vault_path(vault, Path::new("Sketches"))?;
    if !sketches_path.exists() {
        tokio::fs::create_dir_all(&sketches_path)
            .await
            .map_err(|e| format!("Failed to create Sketches folder: {e}"))?;
    }

    let sketch_file = resolve_vault_path(vault, Path::new("Sketches").join(&file_name))?;
    let empty_sketch = serde_json::json!({
        "type": "excalidraw",
        "version": 2,
        "source": "vault-desktop",
        "elements": [],
        "appState": { "viewBackgroundColor": "#ffffff" },
        "files": {}
    });

    tokio::fs::write(&sketch_file, empty_sketch.to_string())
        .await
        .map_err(|e| format!("Failed to create sketch: {e}"))?;

    Ok(format!("Sketches/{file_name}"))
}

#[tauri::command]
async fn write_binary_file(path: String, data: String) -> Result<(), String> {
    use base64::{engine::general_purpose, Engine as _};

    let bytes = general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {e}"))?;
    let approved_path = consume_approved_export_path(Path::new(&path))?;

    tokio::fs::write(&approved_path, bytes)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
async fn start_file_watcher(
    vault_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<(), String> {
    let window_id = extract_window_id(&window);
    let path = PathBuf::from(&vault_path);

    // Register the window with the vault (which sets up file watching)
    refactored_state
        .register_window_vault(&window_id, path)
        .await?;
    println!("✅ File watcher started for: {vault_path}");

    Ok(())
}

#[tauri::command]
async fn create_vault(
    path: String,
    window: tauri::Window,
    app: tauri::AppHandle,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<VaultInfo> {
    let vault_path = PathBuf::from(&path);

    if vault_path.exists() {
        return Err(CommandError::InvalidPath {
            path,
            reason: "path already exists".to_string(),
        });
    }

    std::fs::create_dir_all(&vault_path).map_err(|e| CommandError::io(&vault_path, e))?;

    open_vault(path, window, app, refactored_state).await
}

#[tauri::command]
async fn get_vault_info(
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Option<VaultInfo>, String> {
    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let path = vault.path();
                    Ok(Some(VaultInfo {
                        path: path.to_string_lossy().to_string(),
                        name: path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Untitled")
                            .to_string(),
                    }))
                }
                None => Ok(None),
            }
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn select_folder_for_vault(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri_plugin_dialog::DialogExt;

    println!("🔍 Starting folder selection for vault...");

    let (tx, rx) = mpsc::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));

    app.dialog()
        .file()
        .set_title("Select Vault Folder")
        .pick_folder(move |result| {
            println!("📁 Dialog callback received: {result:?}");
            if let Some(sender) = tx.lock().unwrap().take() {
                let send_result = sender.send(result);
                println!("📤 Send result: {send_result:?}");
            }
        });

    println!("⏳ Waiting for dialog response...");
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Some(path)) => {
            let path_str = path.to_string();
            println!("✅ Received path: {path_str}");
            Ok(Some(path_str))
        }
        Ok(None) => {
            println!("❌ User cancelled dialog");
            Ok(None)
        }
        Err(e) => {
            println!("❌ Dialog timeout or error: {e:?}");
            Err("Dialog timed out or failed".to_string())
        }
    }
}

#[tauri::command]
async fn select_folder_for_create(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri_plugin_dialog::DialogExt;

    println!("🔍 Starting folder selection for create...");

    let (tx, rx) = mpsc::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));

    app.dialog()
        .file()
        .set_title("Select Location for New Vault")
        .pick_folder(move |result| {
            println!("📁 Create dialog callback received: {result:?}");
            if let Some(sender) = tx.lock().unwrap().take() {
                let send_result = sender.send(result);
                println!("📤 Create send result: {send_result:?}");
            }
        });

    println!("⏳ Waiting for create dialog response...");
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Some(path)) => {
            let path_str = path.to_string();
            println!("✅ Create received path: {path_str}");
            Ok(Some(path_str))
        }
        Ok(None) => {
            println!("❌ Create user cancelled dialog");
            Ok(None)
        }
        Err(e) => {
            println!("❌ Create dialog timeout or error: {e:?}");
            Err("Dialog timed out or failed".to_string())
        }
    }
}

#[tauri::command]
async fn create_new_vault(
    parent_path: String,
    vault_name: String,
    window: tauri::Window,
    app: tauri::AppHandle,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<VaultInfo> {
    if vault_name.trim().is_empty() {
        return Err(CommandError::invalid_input("vault name cannot be empty"));
    }

    let vault_path = PathBuf::from(parent_path).join(vault_name.trim());

    if vault_path.exists() {
        return Err(CommandError::InvalidPath {
            path: vault_path.to_string_lossy().to_string(),
            reason: format!("folder '{}' already exists", vault_name.trim()),
        });
    }

    // Create the vault directory
    std::fs::create_dir_all(&vault_path).map_err(|e| CommandError::io(&vault_path, e))?;

    // Create a welcome note
    let welcome_content = format!(
        "# Welcome to {}\n\nThis is your new gaimplan vault! Start taking notes by creating new markdown files.\n\n## Getting Started\n\n- Create new notes by clicking the + button\n- Organize your thoughts in folders\n- All your notes are stored as plain markdown files\n\nHappy note-taking! ✨\n",
        vault_name.trim()
    );

    let welcome_path = vault_path.join("Welcome.md");
    std::fs::write(&welcome_path, welcome_content)
        .map_err(|e| CommandError::io(&welcome_path, e))?;

    // Now open the vault
    let vault_path_str = vault_path.to_string_lossy().to_string();
    open_vault(vault_path_str, window, app, refactored_state).await
}

#[tauri::command]
async fn get_file_tree(
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<FileTree> {
    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let vault_root = vault.path().to_path_buf();
                    drop(vault_lock);
                    spawn_blocking_command(move || build_file_tree(&vault_root)).await
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn read_file_content(
    file_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<String> {
    println!("📖 read_file_content called with path: {file_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let input_path = std::path::Path::new(&file_path);
                    let full_path = resolve_vault_input_path(vault, input_path)?;
                    println!("📁 Vault path: {:?}", vault.path());
                    println!("📄 Reading path: {full_path:?}");
                    drop(vault_lock);

                    let identity_manager = identity_manager.inner().clone();
                    spawn_blocking_command(move || {
                        if full_path.extension().and_then(|e| e.to_str()) == Some("md") {
                            let mut manager = identity_manager.write();
                            manager.ensure_note_id(&full_path).map_err(|e| {
                                CommandError::Identity(e.context("Failed to ensure note UUID"))
                            })?;
                        }

                        std::fs::read_to_string(&full_path).map_err(|e| {
                            println!("❌ Failed to read file: {e}");
                            CommandError::io(&full_path, e)
                        })
                    })
                    .await
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn file_exists(
    file_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<bool> {
    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let path = resolve_vault_input_path(vault, Path::new(&file_path))?;
                    Ok(path.exists())
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn write_file_content(
    file_path: String,
    content: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<Option<String>> {
    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let input_path = std::path::Path::new(&file_path);
                    let full_path = resolve_vault_input_path(vault, input_path)?;
                    drop(vault_lock);

                    let identity_manager = identity_manager.inner().clone();
                    spawn_blocking_command(move || {
                        write_file_content_sync(full_path, content, identity_manager)
                    })
                    .await
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn fetch_image_as_base64(
    app: tauri::AppHandle,
    url: String,
    vault_path: Option<String>,
) -> Result<String, String> {
    let policy = match vault_path {
        Some(vault_path) => match vault_settings::get_vault_settings(app, vault_path).await {
            Ok(settings) => image_fetch::ImageFetchPolicy {
                allow_http: settings.network.allow_http_images,
                allow_private_network: settings.network.allow_private_network_images,
            },
            Err(_) => image_fetch::ImageFetchPolicy::default(),
        },
        None => image_fetch::ImageFetchPolicy::default(),
    };

    image_fetch::fetch_image(&url, &policy).await
}

#[tauri::command]
async fn create_new_file(
    file_name: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<()> {
    println!("📝 create_new_file called with name: {file_name}");
    eprintln!("📝 create_new_file called with name: {file_name}");

    let window_id = extract_window_id(&window);
    println!("🪟 Window ID: {window_id}");

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let path = Path::new(&file_name);
                    let full_path = resolve_vault_path(vault, path)?;
                    println!("📁 Vault path: {:?}", vault.path());
                    println!("📄 Creating file: {path:?}");
                    println!("📄 Full path: {full_path:?}");

                    // Generate UUID for the new file (but don't write to file yet as it doesn't exist)
                    let uuid = {
                        use identity::uuid::UuidGenerator;
                        let generator = UuidGenerator::new();
                        match generator.generate() {
                            Ok(id) => {
                                println!("🆔 Generated UUID for new file: {id}");
                                id
                            }
                            Err(e) => {
                                println!("⚠️ Failed to generate UUID: {e}, continuing without it");
                                String::new()
                            }
                        }
                    };

                    // Create default content with frontmatter if UUID was generated
                    let default_content = if !uuid.is_empty() {
                        use crate::identity::frontmatter::{FrontMatter, FrontMatterWriter};
                        let now = chrono::Utc::now();
                        let mut front_matter = FrontMatter::new();
                        front_matter.id = Some(uuid.clone());
                        front_matter.created_at = Some(now);
                        front_matter.updated_at = Some(now);

                        let title = format!(
                            "# {}",
                            path.file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("Untitled")
                        );

                        match FrontMatterWriter::write(&front_matter, &title) {
                            Ok(content) => content,
                            Err(e) => {
                                println!("⚠️ Failed to generate frontmatter: {e}, using fallback");
                                format!(
                                    "---\nid: {}\ncreated_at: {}\nupdated_at: {}\n---\n# {}",
                                    front_matter.id.unwrap_or_default(),
                                    now.to_rfc3339(),
                                    now.to_rfc3339(),
                                    path.file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("Untitled")
                                )
                            }
                        }
                    } else {
                        format!(
                            "# {}",
                            path.file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("Untitled")
                        )
                    };

                    match vault.write_file(path, &default_content) {
                        Ok(()) => {
                            println!("✅ File created successfully with UUID: {path:?}");

                            // Update the identity manager cache with the new UUID
                            if !uuid.is_empty() {
                                let mut manager = identity_manager.inner().write();
                                // The file now exists with frontmatter, so cache the UUID
                                let _ = manager.get_note_id(&full_path);
                            }

                            Ok(())
                        }
                        Err(e) => {
                            println!("❌ Failed to create file: {e}");
                            eprintln!("❌ Failed to create file: {e}");
                            Err(CommandError::other(format!("Failed to create file: {e}")))
                        }
                    }
                }
                None => {
                    println!("❌ No vault opened");
                    Err(CommandError::VaultNotOpen)
                }
            }
        }
        None => {
            println!("❌ Window not found for ID: {window_id}");
            Err(CommandError::WindowNotFound)
        }
    }
}

fn find_box_drive_mount(full_path: &Path) -> Option<PathBuf> {
    let home_dir = dirs::home_dir()?;
    let cloud_storage_root = home_dir.join("Library").join("CloudStorage");

    full_path.ancestors().find_map(|ancestor| {
        let parent = ancestor.parent()?;
        if parent == cloud_storage_root {
            let name = ancestor.file_name()?.to_str()?;
            if name.starts_with("Box-") {
                return Some(ancestor.to_path_buf());
            }
        }
        None
    })
}

fn copy_box_sync_db_snapshot() -> Result<tempfile::TempDir, String> {
    let home_dir =
        dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let source_dir = home_dir
        .join("Library")
        .join("Application Support")
        .join("Box")
        .join("Box")
        .join("data");
    let sync_db = source_dir.join("sync.db");

    if !sync_db.exists() {
        return Err("Box Drive sync database was not found.".to_string());
    }

    let snapshot_dir =
        tempfile::tempdir().map_err(|error| format!("Failed to create temp dir: {error}"))?;

    for file_name in ["sync.db", "sync.db-wal", "sync.db-shm"] {
        let source = source_dir.join(file_name);
        if source.exists() {
            let destination = snapshot_dir.path().join(file_name);
            std::fs::copy(&source, &destination)
                .map_err(|error| format!("Failed to copy {file_name}: {error}"))?;
        }
    }

    Ok(snapshot_dir)
}

fn resolve_local_item_segments(
    connection: &Connection,
    starting_local_id: i64,
) -> Result<Vec<String>, String> {
    let mut segments = Vec::new();
    let mut current_local_id = Some(starting_local_id);
    let mut statement = connection
        .prepare("SELECT parent_item_id, name FROM local_item WHERE local_id = ?1")
        .map_err(|error| format!("Failed to prepare local_item lookup: {error}"))?;

    while let Some(local_id) = current_local_id {
        let row = statement
            .query_row(params![local_id], |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })
            .optional()
            .map_err(|error| format!("Failed to query local_item path: {error}"))?;

        match row {
            Some((parent_item_id, Some(name))) => {
                segments.push(name);
                current_local_id = parent_item_id.filter(|parent| *parent > 0);
            }
            Some((parent_item_id, None)) => {
                current_local_id = parent_item_id.filter(|parent| *parent > 0);
            }
            None => break,
        }
    }

    segments.reverse();
    Ok(segments)
}

#[tauri::command]
async fn resolve_box_file_id(
    file_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<Option<String>, String> {
    let window_id = extract_window_id(&window);

    let full_path = match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => resolve_vault_input_path(vault, Path::new(&file_path))?,
                None => return Err("No vault opened".to_string()),
            }
        }
        None => return Err("Window not found".to_string()),
    };

    let box_mount = match find_box_drive_mount(&full_path) {
        Some(mount) => mount,
        None => return Ok(None),
    };

    let relative_segments: Vec<String> = full_path
        .strip_prefix(&box_mount)
        .map_err(|error| format!("Failed to derive Box-relative path: {error}"))?
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();

    if relative_segments.is_empty() {
        return Ok(None);
    }

    let file_name = relative_segments
        .last()
        .cloned()
        .ok_or_else(|| "Could not derive Box Note filename".to_string())?;
    let parent_name = relative_segments.iter().rev().nth(1).cloned();

    let snapshot_dir = copy_box_sync_db_snapshot()?;
    let connection = Connection::open(snapshot_dir.path().join("sync.db"))
        .map_err(|error| format!("Failed to open Box sync database snapshot: {error}"))?;

    let mut candidate_statement = connection
        .prepare("SELECT local_id FROM local_item WHERE name = ?1 AND native_item_type = 0")
        .map_err(|error| format!("Failed to prepare candidate lookup: {error}"))?;
    let candidate_rows = candidate_statement
        .query_map(params![file_name], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("Failed to query candidate Box items: {error}"))?;

    let mut exact_match: Option<i64> = None;
    let mut parent_match: Option<i64> = None;

    for candidate_row in candidate_rows {
        let local_id =
            candidate_row.map_err(|error| format!("Failed to read candidate row: {error}"))?;
        let candidate_segments = resolve_local_item_segments(&connection, local_id)?;

        if candidate_segments == relative_segments {
            exact_match = Some(local_id);
            break;
        }

        if parent_match.is_none()
            && parent_name.is_some()
            && candidate_segments.last() == relative_segments.last()
            && candidate_segments.iter().rev().nth(1) == parent_name.as_ref()
        {
            parent_match = Some(local_id);
        }
    }

    let target_local_id = exact_match.or(parent_match);
    let Some(local_id) = target_local_id else {
        return Ok(None);
    };

    let box_id = connection
        .query_row(
            "SELECT box_id FROM item_mapping_between_fs WHERE local_id = ?1 AND box_item_type = 0",
            params![local_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to resolve Box file mapping: {error}"))?;

    Ok(box_id)
}

#[tauri::command]
async fn create_new_folder(
    folder_name: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<()> {
    println!("📂 create_new_folder called with name: {folder_name}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let folder_path = resolve_vault_path(vault, Path::new(&folder_name))?;
                    println!("📁 Creating folder at: {folder_path:?}");

                    std::fs::create_dir_all(&folder_path).map_err(|e| {
                        println!("❌ Failed to create folder: {e}");
                        CommandError::io(&folder_path, e)
                    })
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn delete_file(
    file_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<()> {
    println!("🗑️ delete_file called with path: {file_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let path = resolve_vault_path(vault, Path::new(&file_path))?;
                    println!("📁 Deleting file at: {path:?}");

                    if path.is_file() {
                        std::fs::remove_file(&path).map_err(|e| {
                            println!("❌ Failed to delete file: {e}");
                            CommandError::io(&path, e)
                        })
                    } else {
                        Err(CommandError::InvalidPath {
                            path: path.to_string_lossy().to_string(),
                            reason: "path is not a file".to_string(),
                        })
                    }
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn delete_folder(
    folder_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<()> {
    println!("🗑️ delete_folder called with path: {folder_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let path = resolve_vault_path(vault, Path::new(&folder_path))?;
                    println!("📁 Deleting folder at: {path:?}");

                    if path.is_dir() {
                        std::fs::remove_dir_all(&path).map_err(|e| {
                            println!("❌ Failed to delete folder: {e}");
                            CommandError::io(&path, e)
                        })
                    } else {
                        Err(CommandError::InvalidPath {
                            path: path.to_string_lossy().to_string(),
                            reason: "path is not a folder".to_string(),
                        })
                    }
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn move_file(
    old_path: String,
    new_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<()> {
    println!("📦 move_file called: {old_path} -> {new_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let old_full_path = resolve_vault_path(vault, Path::new(&old_path))?;
                    let new_full_path = resolve_vault_path(vault, Path::new(&new_path))?;

                    println!("📁 Moving file: {old_full_path:?} -> {new_full_path:?}");

                    // Create parent directories if they don't exist
                    if let Some(parent) = new_full_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| CommandError::io(parent, e))?;
                    }

                    std::fs::rename(&old_full_path, &new_full_path).map_err(|e| {
                        println!("❌ Failed to move file: {e}");
                        CommandError::io(&old_full_path, e)
                    })
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn rename_file(
    old_path: String,
    new_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> CommandResult<()> {
    println!("✏️ rename_file called: {old_path} -> {new_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let old_full_path = resolve_vault_path(vault, Path::new(&old_path))?;
                    let new_full_path = resolve_vault_path(vault, Path::new(&new_path))?;

                    println!("📁 Renaming file: {old_full_path:?} -> {new_full_path:?}");

                    // Create parent directories if they don't exist
                    if let Some(parent) = new_full_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| CommandError::io(parent, e))?;
                    }

                    std::fs::rename(&old_full_path, &new_full_path).map_err(|e| {
                        println!("❌ Failed to rename file: {e}");
                        CommandError::io(&old_full_path, e)
                    })
                }
                None => Err(CommandError::VaultNotOpen),
            }
        }
        None => Err(CommandError::WindowNotFound),
    }
}

#[tauri::command]
async fn toggle_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    // In Tauri v2, open_devtools is on WebviewWindow
    window.open_devtools();
    Ok(())
}

#[tauri::command]
async fn reveal_in_finder(
    path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<(), String> {
    println!("🔍 reveal_in_finder called with path: {path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let full_path = resolve_vault_path(vault, Path::new(&path))?;
                    println!("📁 Revealing file in Finder: {full_path:?}");

                    // Use the shell to open the file location
                    #[cfg(target_os = "macos")]
                    {
                        std::process::Command::new("open")
                            .arg("-R")
                            .arg(&full_path)
                            .spawn()
                            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
                    }

                    #[cfg(target_os = "windows")]
                    {
                        std::process::Command::new("explorer")
                            .arg("/select,")
                            .arg(&full_path)
                            .spawn()
                            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
                    }

                    #[cfg(target_os = "linux")]
                    {
                        // Try different file managers
                        let file_managers = vec![
                            (
                                "xdg-open",
                                vec![full_path.parent().unwrap().to_str().unwrap()],
                            ),
                            ("nautilus", vec!["--select", full_path.to_str().unwrap()]),
                            ("nemo", vec![full_path.to_str().unwrap()]),
                            ("thunar", vec![full_path.to_str().unwrap()]),
                        ];

                        let mut success = false;
                        for (cmd, args) in file_managers {
                            if std::process::Command::new(cmd).args(&args).spawn().is_ok() {
                                success = true;
                                break;
                            }
                        }

                        if !success {
                            return Err("Failed to open file manager".to_string());
                        }
                    }

                    Ok(())
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn get_last_vault(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config_dir = match app.path().app_config_dir() {
        Ok(dir) => dir,
        Err(e) => return Err(format!("Failed to get config directory: {e}")),
    };

    let last_vault_file = config_dir.join(".vault").join("last_vault.txt");

    if last_vault_file.exists() {
        match std::fs::read_to_string(&last_vault_file) {
            Ok(path) => {
                // Check if the vault still exists
                if PathBuf::from(&path).exists() {
                    Ok(Some(path))
                } else {
                    // Vault no longer exists, remove the file
                    let _ = std::fs::remove_file(&last_vault_file);
                    Ok(None)
                }
            }
            Err(_) => Ok(None),
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn save_last_vault(app: tauri::AppHandle, vault_path: String) -> Result<(), String> {
    let config_dir = match app.path().app_config_dir() {
        Ok(dir) => dir,
        Err(e) => return Err(format!("Failed to get config directory: {e}")),
    };

    let vault_dir = config_dir.join(".vault");

    // Create .vault directory if it doesn't exist
    if !vault_dir.exists() {
        std::fs::create_dir_all(&vault_dir)
            .map_err(|e| format!("Failed to create .vault directory: {e}"))?;
    }

    let last_vault_file = vault_dir.join("last_vault.txt");

    std::fs::write(&last_vault_file, vault_path)
        .map_err(|e| format!("Failed to save last vault: {e}"))
}

#[tauri::command]
async fn save_pasted_image(
    app: AppHandle,
    image_data: String, // Base64 encoded
    extension: String,  // png, jpg, or gif
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use chrono::Local;

    println!("📸 save_pasted_image called with extension: {extension}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let vault_root = vault.path().to_path_buf();
                    let vault_path = vault_root.to_string_lossy().to_string();
                    drop(vault_lock);

                    let image_location =
                        match vault_settings::get_vault_settings(app, vault_path).await {
                            Ok(settings) => vault_settings::normalize_image_location(
                                &settings.files.image_location,
                            ),
                            Err(_) => vault_settings::normalize_image_location("Files/"),
                        };

                    spawn_blocking_string(move || {
                        let vault = Vault::new(vault_root)
                            .map_err(|e| format!("Failed to open vault path: {e}"))?;
                        let image_dir = resolve_vault_path(&vault, Path::new(&image_location))?;
                        std::fs::create_dir_all(&image_dir)
                            .map_err(|e| format!("Failed to create image directory: {e}"))?;

                        let timestamp = Local::now().format("%Y%m%d%H%M%S").to_string();
                        let filename = format!("Pasted image {timestamp}.{extension}");
                        let file_path =
                            resolve_vault_path(&vault, Path::new(&image_location).join(&filename))?;

                        println!("💾 Saving image to: {file_path:?}");

                        let image_bytes = general_purpose::STANDARD
                            .decode(&image_data)
                            .map_err(|e| format!("Failed to decode base64: {e}"))?;

                        std::fs::write(&file_path, image_bytes)
                            .map_err(|e| format!("Failed to write image file: {e}"))?;

                        let relative_path = format!("{image_location}{filename}");
                        println!("✅ Image saved successfully: {relative_path}");
                        Ok(relative_path)
                    })
                    .await
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn read_image_as_base64(
    file_path: String,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    println!("🖼️ read_image_as_base64 called with path: {file_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;
            match &*vault_lock {
                Some(vault) => {
                    let cleaned_path = vault_settings::normalize_image_reference(&file_path);

                    let full_path = resolve_vault_path(vault, Path::new(&cleaned_path))?;
                    println!("📁 Reading image from: {full_path:?}");
                    drop(vault_lock);

                    spawn_blocking_string(move || {
                        let image_bytes = std::fs::read(&full_path)
                            .map_err(|e| format!("Failed to read image file: {e}"))?;

                        let extension = full_path
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .unwrap_or("png")
                            .to_lowercase();

                        let content_type = match extension.as_str() {
                            "jpg" | "jpeg" => "image/jpeg",
                            "png" => "image/png",
                            "gif" => "image/gif",
                            _ => "image/png",
                        };

                        let base64_string = general_purpose::STANDARD.encode(&image_bytes);

                        Ok(format!("data:{content_type};base64,{base64_string}"))
                    })
                    .await
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn create_directory(vault_path: String, dir_path: String) -> Result<(), String> {
    println!("📁 create_directory called with path: {dir_path}");

    let vault_path_buf = PathBuf::from(&vault_path);
    let vault = Vault::new(vault_path_buf).map_err(|e| format!("Failed to create vault: {e}"))?;
    let full_path = resolve_vault_path(&vault, Path::new(&dir_path))?;

    // Create directory and all parent directories if they don't exist
    std::fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create directory: {e}"))?;

    println!("✅ Directory created successfully: {full_path:?}");
    Ok(())
}

#[tauri::command]
async fn export_to_pdf(
    markdown_content: String,
    output_path: String,
    options: Option<ExportOptions>,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<(), String> {
    println!("📄 export_to_pdf called with output path: {output_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;

            match &*vault_lock {
                Some(vault) => {
                    let exporter = PdfExporter::new(vault.path().to_path_buf());
                    let export_options = options.unwrap_or_default();

                    exporter
                        .export_to_pdf(
                            &markdown_content,
                            &PathBuf::from(&output_path),
                            export_options,
                        )
                        .await
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn export_to_html(
    markdown_content: String,
    output_path: String,
    options: Option<ExportOptions>,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<(), String> {
    println!("📄 export_to_html called with output path: {output_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;

            match &*vault_lock {
                Some(vault) => {
                    let export_options = options.unwrap_or_default();

                    pdf_export::export_to_html(
                        &markdown_content,
                        &PathBuf::from(&output_path),
                        vault.path(),
                        export_options,
                    )
                    .await
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn export_to_word(
    markdown_content: String,
    output_path: String,
    options: Option<ExportOptions>,
    window: tauri::Window,
    refactored_state: State<'_, RefactoredAppState>,
) -> Result<(), String> {
    println!("📄 export_to_word called with output path: {output_path}");

    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;

            match &*vault_lock {
                Some(vault) => {
                    let export_options = options.unwrap_or_default();

                    pdf_export::export_to_word(
                        &markdown_content,
                        &PathBuf::from(&output_path),
                        vault.path(),
                        export_options,
                    )
                    .await
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn export_chat_to_vault(
    refactored_state: State<'_, RefactoredAppState>,
    content: String,
    filename: Option<String>,
    window: tauri::Window,
) -> Result<String, String> {
    let window_id = extract_window_id(&window);

    match refactored_state.get_window_state(&window_id).await {
        Some(window_state) => {
            let vault_lock = window_state.vault.lock().await;

            match &*vault_lock {
                Some(vault) => {
                    let chat_history_dir = resolve_vault_path(vault, Path::new("Chat History"))?;

                    // Create Chat History directory if it doesn't exist
                    if !chat_history_dir.exists() {
                        std::fs::create_dir_all(&chat_history_dir)
                            .map_err(|e| format!("Failed to create Chat History directory: {e}"))?;
                    }

                    // Generate filename with timestamp if not provided
                    let file_name = filename.unwrap_or_else(|| {
                        let now = chrono::Local::now();
                        format!("chat-{}.md", now.format("%Y-%m-%d_%H-%M-%S"))
                    });

                    let file_path =
                        resolve_vault_path(vault, Path::new("Chat History").join(&file_name))?;

                    // Write the chat content to the file
                    std::fs::write(&file_path, content)
                        .map_err(|e| format!("Failed to write chat file: {e}"))?;

                    Ok(file_path.to_string_lossy().to_string())
                }
                None => Err("No vault opened".to_string()),
            }
        }
        None => Err("Window not found".to_string()),
    }
}

#[tauri::command]
async fn select_export_location(
    app: tauri::AppHandle,
    file_name: String,
    extension: String,
    default_directory: Option<String>,
) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri_plugin_dialog::DialogExt;

    println!("🔍 Starting file save dialog for export...");

    let (tx, rx) = mpsc::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));

    let mut dialog = app
        .dialog()
        .file()
        .set_title(format!("Export as {}", extension.to_uppercase()))
        .set_file_name(format!("{file_name}.{extension}"));

    if let Some(directory) = default_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
    {
        dialog = dialog.set_directory(PathBuf::from(directory));
    }

    dialog.save_file(move |result| {
        println!("📁 Export dialog callback received: {result:?}");
        if let Some(sender) = tx.lock().unwrap().take() {
            let send_result = sender.send(result);
            println!("📤 Export send result: {send_result:?}");
        }
    });

    println!("⏳ Waiting for export dialog response...");
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Some(path)) => {
            let path_str = path.to_string();
            approve_export_path(Path::new(&path_str))?;
            println!("✅ Export location selected: {path_str}");
            Ok(Some(path_str))
        }
        Ok(None) => {
            println!("❌ User cancelled export dialog");
            Ok(None)
        }
        Err(e) => {
            println!("❌ Export dialog timeout or error: {e:?}");
            Err("Dialog timed out or failed".to_string())
        }
    }
}

/// Migrate settings from old com.gaimplan.app location to new com.vault.app location
fn migrate_settings_if_needed() {
    use std::fs;
    use std::path::Path;

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home_path = Path::new(&home);
            let old_dir = home_path.join("Library/Application Support/com.gaimplan.app");
            let new_dir = home_path.join("Library/Application Support/com.vault.app");

            // If old directory exists and new directory doesn't, migrate
            if old_dir.exists() && !new_dir.exists() {
                println!("Migrating settings from com.gaimplan.app to com.vault.app...");

                // Create parent directory if needed
                if let Some(parent) = new_dir.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                // Try to rename (move) the directory
                match fs::rename(&old_dir, &new_dir) {
                    Ok(_) => println!("Settings migrated successfully"),
                    Err(e) => {
                        eprintln!("Failed to migrate settings: {e}. Attempting copy instead...");
                        // If rename fails, try copying
                        if let Err(e) = copy_dir_recursive(&old_dir, &new_dir) {
                            eprintln!("Failed to copy settings: {e}");
                        } else {
                            println!("Settings copied successfully");
                            // Optionally, you could delete the old directory here
                            // let _ = fs::remove_dir_all(&old_dir);
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let appdata_path = Path::new(&appdata);
            let old_dir = appdata_path.join("com.gaimplan.app");
            let new_dir = appdata_path.join("com.vault.app");

            if old_dir.exists() && !new_dir.exists() {
                println!("Migrating settings from com.gaimplan.app to com.vault.app...");

                match fs::rename(&old_dir, &new_dir) {
                    Ok(_) => println!("Settings migrated successfully"),
                    Err(e) => {
                        eprintln!("Failed to migrate settings: {}", e);
                        if let Err(e) = copy_dir_recursive(&old_dir, &new_dir) {
                            eprintln!("Failed to copy settings: {}", e);
                        } else {
                            println!("Settings copied successfully");
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home_path = Path::new(&home);
            let old_dir = home_path.join(".config/com.gaimplan.app");
            let new_dir = home_path.join(".config/com.vault.app");

            if old_dir.exists() && !new_dir.exists() {
                println!("Migrating settings from com.gaimplan.app to com.vault.app...");

                if let Some(parent) = new_dir.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                match fs::rename(&old_dir, &new_dir) {
                    Ok(_) => println!("Settings migrated successfully"),
                    Err(e) => {
                        eprintln!("Failed to migrate settings: {}", e);
                        if let Err(e) = copy_dir_recursive(&old_dir, &new_dir) {
                            eprintln!("Failed to copy settings: {}", e);
                        } else {
                            println!("Settings copied successfully");
                        }
                    }
                }
            }
        }
    }
}

/// Helper function to recursively copy a directory
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    use std::fs;

    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

fn main() {
    // Load .env file if it exists (silently ignore errors to avoid leaking secrets)
    let _ = dotenvy::dotenv();

    // Migrate settings from old location if needed
    migrate_settings_if_needed();

    tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            create_vault,
            get_vault_info,
            get_window_state,
            window_closing,
            start_file_watcher,
            select_folder_for_vault,
            select_folder_for_create,
            create_new_vault,
            get_file_tree,
            read_file_content,
            file_exists,
            write_file_content,
            resolve_box_file_id,
            fetch_image_as_base64,
            create_new_file,
            create_new_folder,
            delete_file,
            delete_folder,
            move_file,
            rename_file,
            reveal_in_finder,
            toggle_devtools,
            get_last_vault,
            save_last_vault,
            save_pasted_image,
            read_image_as_base64,
            read_file_base64,
            create_new_sketch,
            write_binary_file,
            editor::save_editor_preference,
            editor::get_editor_preferences,
            editor::list_theme_files,
            editor::open_note,
            editor::search_by_tag,
            editor::get_embedded_block,
            editor::create_theme_directory,
            editor::update_editor_state,
            editor::get_editor_state,
            export_to_pdf,
            export_to_html,
            export_to_word,
            export_chat_to_vault,
            select_export_location,
            // PDF intelligence commands
            extract_pdf_intelligence,
            extract_pdf_intelligence_v2,
            save_intelligence_result,
            save_intelligence_result_v2,
            load_intelligence_result,
            export_intelligence_markdown,
            save_ai_settings,
            get_ai_settings,
            test_ai_connection,
            save_ai_settings_for_provider,
            get_ai_settings_for_provider,
            get_active_ai_provider,
            set_active_ai_provider,
            migrate_ai_settings,
            send_ai_chat,
            send_ai_chat_with_functions,
            send_ai_chat_stream,
            send_ai_chat_with_functions_stream,
            search_notes_by_name,
            test_messages,
            debug_send_ai_chat,
            check_ollama_status,
            get_vault_settings,
            save_vault_settings,
            reset_vault_settings,
            validate_image_location,
            list_all_vault_settings,
            create_directory,
            get_widget_settings,
            save_widget_settings,
            commands::task_index_commands::query_tasks,
            commands::task_index_commands::query_tasks_by_status,
            commands::task_index_commands::query_tasks_today,
            commands::task_index_commands::query_tasks_overdue,
            commands::task_index_commands::query_tasks_by_date_range,
            commands::task_index_commands::get_task_source_by_id,
            commands::task_index_commands::sync_file_tasks_to_index,
            commands::task_commands::toggle_task_by_id,
            commands::task_commands::open_file_at_line,
            commands::sync::calculate_note_id,
            commands::sync::get_vault_id,
            commands::wikilink::get_vault_notes,
            commands::wikilink::resolve_wikilink,
            commands::wikilink::create_note_from_wikilink,
            // UUID identity commands
            commands::uuid_commands::get_note_uuid,
            commands::uuid_commands::ensure_note_uuid,
            commands::uuid_commands::convert_legacy_id_to_uuid,
            commands::uuid_commands::batch_convert_ids,
            commands::uuid_commands::is_legacy_id,
            commands::uuid_commands::is_uuid,
            commands::uuid_commands::add_uuids_to_vault,
            // Task commands
            commands::task_commands::ensure_task_uuid,
            commands::task_commands::get_tasks_for_note,
            commands::task_commands::toggle_task_status,
            commands::task_commands::update_task_properties,
            commands::task_commands::batch_ensure_task_uuids,
            commands::task_commands::get_task_by_id,
            commands::task_commands::find_duplicate_task_ids,
            commands::task_commands::add_task_uuids_to_vault,
            commands::task_commands::rollback_task_migration,
            // Ghostty terminal commands
            register_ghostty_commands,
            ghostty_spawn,
            ghostty_stop,
            ghostty_write,
            ghostty_status,
            ghostty_installation_status,
            // License commands
            commands::license::get_license_status,
            commands::license::start_trial_cmd,
            commands::license::activate_license,
            commands::license::deactivate_license,
            check_command_exists,
            get_bundle_path,
            // PTY commands
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            // Window management commands
            open_vault_in_new_window_basic,
            get_recent_vaults_basic,
            manage_vaults_basic,
            // Plugin management commands (new real filesystem implementation)
            plugins::commands::plugin_list,
            plugins::commands::plugin_install,
            plugins::commands::plugin_enable,
            plugins::commands::plugin_disable,
            plugins::commands::plugin_uninstall,
            plugins::commands::plugin_get_settings,
            plugins::commands::plugin_update_settings,
            plugins::commands::plugin_get_resources,
            plugins::commands::plugin_request_permission,
            plugins::commands::plugin_get_logs,
            plugins::commands::plugin_clear_data,
            plugins::commands::plugin_refresh,
            plugins::commands::plugin_get,
            plugins::commands::plugin_get_all_resources,
            plugins::commands::plugin_list_all_permissions,
            plugins::commands::plugin_get_categories,
            plugins::commands::plugin_get_system_status,
            // Plugin IPC commands
            plugin_runtime::ipc_commands::plugin_ipc_call,
            plugin_runtime::ipc_commands::plugin_ipc_send,
            plugin_runtime::ipc_commands::plugin_ipc_register,
            plugin_runtime::ipc_commands::plugin_ipc_unregister,
            plugin_runtime::ipc_commands::plugin_vault_read,
            plugin_runtime::ipc_commands::plugin_vault_write,
            plugin_runtime::ipc_commands::plugin_vault_list,
            plugin_runtime::ipc_commands::plugin_workspace_notice,
            plugin_runtime::ipc_commands::plugin_settings_get,
            plugin_runtime::ipc_commands::plugin_settings_set,
            // Native Botcky bridge commands (Vault-root-safe, no MCP/PTY path)
            botcky::context::botcky_validate_context,
            botcky::direct_tools::botcky_read_file,
            botcky::direct_tools::botcky_search_files,
            botcky::direct_tools::botcky_create_file,
            botcky::direct_tools::botcky_update_file,
            botcky::direct_tools::botcky_append_file,
            botcky::shell_allowlist::botcky_run_allowed_command,
            botcky::tasks::botcky_build_executor_task_request,
            // Vault agent commands (secure path validation in Rust)
            vault_agent_commands::agent_read_note,
            vault_agent_commands::agent_write_note,
            vault_agent_commands::agent_update_note,
            vault_agent_commands::agent_append_to_note,
            vault_agent_commands::agent_list_tags,
            vault_agent_commands::agent_notes_by_tag,
            vault_agent_commands::agent_semantic_search,
            // CSV Editor Pro commands
            csv::list_csv_files,
            csv::read_csv_data,
            csv::save_csv_data,
            csv::get_csv_schema,
            csv::infer_csv_schema,
            csv::save_csv_schema,
            csv::get_csv_ai_context,
            csv::get_csv_statistics,
            csv::export_to_file,
            logging::frontend_log,
        ])
        .setup(|app| {
            match logging::init(app) {
                Ok(guard) => {
                    app.manage(guard);
                }
                Err(error) => {
                    eprintln!("Failed to initialize file logging: {error}");
                }
            }

            // Create Ghostty manager
            let ghostty_manager = Arc::new(GhosttyManager::new());

            // Create PTY manager
            let pty_manager = Arc::new(PtyManager::new());

            // Create plugin runtime with app handle for WebView creation
            let plugin_runtime = Arc::new(Mutex::new(
                plugin_runtime::PluginRuntime::new_with_handle(app.handle().clone()),
            ));

            // Create IPC state for plugin API communication
            let vault_path = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir")
                .join("vault");
            let settings_path = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir")
                .join("plugin-storage");
            let ipc_state =
                plugin_runtime::ipc_commands::create_ipc_state(vault_path.clone(), settings_path);

            // Create app state
            // Initialize IdentityManager with the vault path
            let identity_manager = Arc::new(RwLock::new(IdentityManager::new(vault_path.clone())));
            let app_state = AppState {
                vault: Arc::new(Mutex::new(None)),
                editor: EditorManager::new(),
                watcher: Arc::new(Mutex::new(None)),
                plugin_runtime: plugin_runtime.clone(),
            };

            // Manage the state
            app.manage(app_state);

            // Manage the shared IdentityManager for UUID and task commands
            app.manage(identity_manager);

            // Also manage Ghostty manager for Ghostty commands
            app.manage(ghostty_manager);

            // Also manage PTY manager for PTY commands
            app.manage(pty_manager);

            // Also manage Plugin runtime for plugin commands
            app.manage(plugin_runtime);

            // Also manage IPC state for plugin API calls
            app.manage(ipc_state);

            // Initialize the new plugin manager
            let plugin_manager_state =
                plugins::commands::PluginManagerState::new(app.handle().clone());
            app.manage(plugin_manager_state);

            // Create and manage RefactoredAppState for the new window system
            let refactored_app_state =
                crate::refactored_app_state::RefactoredAppState::new(app.handle().clone())
                    .expect("Failed to create RefactoredAppState");
            app.manage(refactored_app_state);

            // Run AI settings migration on startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match migrate_ai_settings(app_handle).await {
                    Ok(migrated) => {
                        if migrated {
                            println!("✅ AI settings migrated successfully");
                        }
                    }
                    Err(e) => {
                        println!("❌ AI settings migration error: {e}");
                    }
                }
            });

            // Defer window state restoration to avoid WebKit displayID race condition
            // The window needs to be fully attached to a display before we can safely resize/reposition
            if let Some(main_window) = app.get_webview_window("main") {
                // Set up macOS traffic lights position
                #[cfg(target_os = "macos")]
                {
                    use tauri_plugin_decorum::WebviewWindowExt;
                    // Position traffic lights within the sidebar ribbon area
                    let _ = main_window.set_traffic_lights_inset(16.0, 12.0);
                }

                let window_clone = main_window.clone();

                // Spawn async task to restore window state AFTER setup completes
                // This gives macOS time to assign the window to a display
                tauri::async_runtime::spawn(async move {
                    // Wait for window to be fully initialized and attached to display
                    // This small delay prevents the "page has no displayID" WebKit error
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

                    if let Ok(saved_state) = crate::window_lifecycle::AppPersistenceState::load() {
                        if let Some(window_state) = saved_state.last_active_window {
                            // Get screen dimensions for validation
                            let (screen_width, screen_height) = window_clone
                                .primary_monitor()
                                .ok()
                                .flatten()
                                .map(|m| {
                                    let size = m.size();
                                    let scale = m.scale_factor();
                                    // Convert physical to logical pixels
                                    (
                                        (size.width as f64 / scale) as u32,
                                        (size.height as f64 / scale) as u32,
                                    )
                                })
                                .unwrap_or((1920, 1080)); // Fallback to common resolution

                            // Clamp window size to screen bounds (with min size from tauri.conf.json)
                            let min_width = 800u32;
                            let min_height = 600u32;
                            let width = window_state.bounds.width.clamp(min_width, screen_width);
                            let height =
                                window_state.bounds.height.clamp(min_height, screen_height);

                            // Clamp position to ensure window is visible on screen
                            // Allow window to be partially off-screen but at least 100px visible
                            let min_visible = 100i32;
                            let x = window_state.bounds.x.clamp(
                                -(width as i32) + min_visible,
                                (screen_width as i32) - min_visible,
                            );
                            let y = window_state.bounds.y.clamp(
                                0, // Don't allow window above screen (menu bar)
                                (screen_height as i32) - min_visible,
                            );

                            println!(
                                "🪟 Restoring window: {width}x{height} at ({x}, {y}) [screen: {screen_width}x{screen_height}]"
                            );

                            // Apply validated position and size
                            let _ = window_clone.set_size(tauri::Size::Logical(
                                tauri::LogicalSize::new(width as f64, height as f64),
                            ));
                            let _ = window_clone.set_position(tauri::Position::Logical(
                                tauri::LogicalPosition::new(x as f64, y as f64),
                            ));
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    // Save window state whenever it's resized or moved
                    let window_clone = window.clone();

                    // Debounce saves by using a delayed task
                    tauri::async_runtime::spawn(async move {
                        // Small delay to debounce multiple resize events
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                        if let Err(e) =
                            crate::window_lifecycle::save_window_state(&window_clone).await
                        {
                            eprintln!("Failed to save window state: {e}");
                        }
                    });
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::frontmatter::FrontMatterParser;
    use futures::future::join_all;
    use std::time::{Duration, Instant};

    #[test]
    fn get_file_tree_returns_complete_listing_for_synthetic_vault() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");

        for dir_index in 0..50 {
            let dir_path = temp_dir.path().join(format!("dir_{dir_index:02}"));
            std::fs::create_dir_all(&dir_path).expect("create nested dir");

            for file_index in 0..10 {
                std::fs::write(
                    dir_path.join(format!("note_{file_index:02}.md")),
                    format!("# Note {dir_index}-{file_index}\n"),
                )
                .expect("write markdown file");
            }

            std::fs::write(dir_path.join("ignored.txt"), "ignored").expect("write ignored file");
        }

        let tree = build_file_tree(temp_dir.path()).expect("build file tree");
        assert_eq!(tree.files.len(), 550);

        let mut sorted_paths: Vec<_> = tree.files.iter().map(|info| info.path.clone()).collect();
        let original_paths = sorted_paths.clone();
        sorted_paths.sort();
        assert_eq!(original_paths, sorted_paths);

        let first_dir = tree
            .files
            .iter()
            .find(|info| info.path == "dir_00")
            .expect("dir_00 entry");
        assert!(first_dir.is_dir);
        assert_eq!(first_dir.depth, 1);
        assert_eq!(first_dir.parent_path, None);

        let nested_note = tree
            .files
            .iter()
            .find(|info| info.path == "dir_00/note_00.md")
            .expect("nested note entry");
        assert!(!nested_note.is_dir);
        assert_eq!(nested_note.depth, 2);
        assert_eq!(nested_note.parent_path.as_deref(), Some("dir_00"));
        assert_eq!(nested_note.extension.as_deref(), Some("md"));

        assert!(tree
            .files
            .iter()
            .all(|info| !info.path.ends_with("ignored.txt")));
    }

    #[test]
    fn read_write_roundtrip_preserves_frontmatter_timestamps() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let note_path = temp_dir.path().join("notes").join("roundtrip.md");
        let original_content = "\
---
id: note-1
created_at: 2024-01-01T00:00:00+00:00
updated_at: 2024-01-02T00:00:00+00:00
---
# Roundtrip

Body stays intact.
";

        let identity_manager = Arc::new(RwLock::new(IdentityManager::new(
            temp_dir.path().to_path_buf(),
        )));
        let timestamp = write_file_content_sync(
            note_path.clone(),
            original_content.to_string(),
            identity_manager,
        )
        .expect("write note")
        .expect("updated timestamp");
        let written = std::fs::read_to_string(&note_path).expect("read written note");
        let (frontmatter, body) = FrontMatterParser::parse(&written).expect("parse frontmatter");
        let frontmatter = frontmatter.expect("frontmatter exists");

        assert_eq!(frontmatter.id.as_deref(), Some("note-1"));
        assert_eq!(
            frontmatter
                .created_at
                .expect("created_at exists")
                .to_rfc3339(),
            "2024-01-01T00:00:00+00:00"
        );
        assert_eq!(
            frontmatter
                .updated_at
                .expect("updated_at exists")
                .to_rfc3339(),
            timestamp
        );
        assert!(timestamp.as_str() > "2024-01-02T00:00:00+00:00");
        assert_eq!(body, "# Roundtrip\n\nBody stays intact.\n");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn file_tree_walk_does_not_block_concurrent_reads() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let mut read_paths = Vec::new();

        for dir_index in 0..50 {
            let dir_path = temp_dir.path().join(format!("dir_{dir_index:02}"));
            std::fs::create_dir_all(&dir_path).expect("create nested dir");

            for file_index in 0..10 {
                let file_path = dir_path.join(format!("note_{file_index:02}.md"));
                std::fs::write(&file_path, format!("# Note {dir_index}-{file_index}\n"))
                    .expect("write markdown file");

                if read_paths.len() < 50 {
                    read_paths.push(file_path);
                }
            }
        }

        let vault_root = temp_dir.path().to_path_buf();
        let started = Instant::now();
        let tree_handle =
            tauri::async_runtime::spawn_blocking(move || build_file_tree(&vault_root));
        let read_handles = read_paths.into_iter().map(|path| {
            tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(path))
        });

        let read_results = tokio::time::timeout(Duration::from_secs(5), join_all(read_handles))
            .await
            .expect("concurrent reads timed out");
        for result in read_results {
            let content = result.expect("read join").expect("read note");
            assert!(content.starts_with("# Note"));
        }

        let tree = tokio::time::timeout(Duration::from_secs(5), tree_handle)
            .await
            .expect("tree walk timed out")
            .expect("tree join")
            .expect("tree result");
        assert_eq!(tree.files.len(), 550);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
