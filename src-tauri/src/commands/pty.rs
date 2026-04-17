use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct PtySpawnOptions {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Clone)]
struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn spawn_pty(
        &self,
        session_id: String,
        options: PtySpawnOptions,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();

        println!(
            "PTY: Creating pty with size {}x{}",
            options.rows, options.cols
        );

        let pty_pair = pty_system
            .openpty(PtySize {
                rows: options.rows,
                cols: options.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        println!(
            "PTY: Building command: {} {:?}",
            options.command, options.args
        );

        let mut cmd = CommandBuilder::new(&options.command);
        cmd.args(&options.args);

        // Ensure PATH is inherited from environment and includes common binary locations
        let mut path_components = vec![];

        // Add existing PATH if available
        if let Ok(existing_path) = std::env::var("PATH") {
            path_components.push(existing_path);
        }

        // Add common macOS binary locations
        let mut common_paths: Vec<String> = vec![
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
            "/opt/homebrew/sbin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            "/usr/sbin".to_string(),
            "/sbin".to_string(),
        ];

        // Add user-specific paths if HOME is set
        if let Ok(home) = std::env::var("HOME") {
            common_paths.push(format!("{}/.local/bin", home));
            common_paths.push(format!("{}/bin", home));
            // Add common Claude CLI installation location
            common_paths.push(format!("{}/.claude/bin", home));

            // Add NVM paths - check for various Node versions
            let nvm_base = format!("{}/.nvm/versions/node", home);
            if std::path::Path::new(&nvm_base).exists() {
                // Try to find any installed Node version
                if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                    for entry in entries.flatten() {
                        if let Some(version) = entry.file_name().to_str() {
                            if version.starts_with("v") {
                                common_paths.push(format!("{}/{}/bin", nvm_base, version));
                            }
                        }
                    }
                }
            }
        }

        for path in common_paths {
            if !path_components.contains(&path) {
                path_components.push(path);
            }
        }

        let full_path = path_components.join(":");
        println!("PTY: Using PATH: {}", &full_path);
        let path_for_cmd = full_path.clone();
        cmd.env("PATH", path_for_cmd);

        // GUI-launched app bundles often do not inherit TERM.
        // Set a sane default so full-screen/curses tools (tmux, CLI chat UIs) work.
        let term = std::env::var("TERM")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "xterm".to_string());
        cmd.env("TERM", term.clone());
        println!("PTY: Using TERM: {}", term);

        if let Some(cwd) = options.cwd {
            if !cwd.trim().is_empty() {
                cmd.cwd(cwd);
            }
        }

        if let Some(env) = options.env {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }

        println!("PTY: Spawning command...");

        let mut child = pty_pair.slave.spawn_command(cmd).map_err(|e| {
            eprintln!("PTY: Failed to spawn command '{}': {}", options.command, e);
            eprintln!("PTY: PATH was: {}", &full_path);

            // Check if command exists
            let which_result = std::process::Command::new("which")
                .arg(&options.command)
                .env("PATH", &full_path)
                .output();

            match which_result {
                Ok(output) => {
                    if output.status.success() {
                        let location = String::from_utf8_lossy(&output.stdout);
                        eprintln!("PTY: Command found at: {}", location.trim());
                    } else {
                        eprintln!("PTY: Command '{}' not found in PATH", options.command);
                    }
                }
                Err(e) => {
                    eprintln!("PTY: Could not run 'which': {}", e);
                }
            }

            format!(
                "Failed to spawn command '{}': {}. PATH: {}",
                options.command, e, full_path
            )
        })?;

        println!("PTY: Command spawned successfully");

        // Get reader and writer
        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        // Store session
        let session = PtySession {
            writer: Arc::new(Mutex::new(writer)),
        };

        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session);

        // Spawn reader thread
        let session_id_clone = session_id.clone();
        let app_handle_clone = app_handle.clone();

        thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 4096];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // EOF
                        let _ =
                            app_handle_clone.emit(&format!("pty:exit:{}", session_id_clone), ());
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ =
                            app_handle_clone.emit(&format!("pty:data:{}", session_id_clone), &data);
                    }
                    Err(e) => {
                        eprintln!("PTY read error: {}", e);
                        let _ = app_handle_clone
                            .emit(&format!("pty:error:{}", session_id_clone), &e.to_string());
                        break;
                    }
                }
            }
        });

        // Monitor child process
        let session_id_clone = session_id.clone();
        let app_handle_clone = app_handle.clone();

        thread::spawn(move || match child.wait() {
            Ok(status) => {
                let code = status.exit_code() as i32;
                let _ = app_handle_clone.emit(&format!("pty:exit:{}", session_id_clone), code);
            }
            Err(e) => {
                eprintln!("Failed to wait for child: {}", e);
            }
        });

        Ok(session_id)
    }

    pub async fn write_to_pty(&self, session_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;

        if let Some(session) = sessions.get(session_id) {
            let mut writer = session.writer.lock().await;
            writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("Failed to write to PTY: {}", e))?;
            writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY: {}", e))?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub async fn resize_pty(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        // Note: resize would require keeping the PtyPair master
        // For now, this is a placeholder
        Ok(())
    }

    pub async fn close_pty(&self, session_id: &str) -> Result<(), String> {
        self.sessions.lock().await.remove(session_id);
        Ok(())
    }
}

#[tauri::command]
pub async fn pty_spawn(
    session_id: String,
    options: PtySpawnOptions,
    app_handle: AppHandle,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<String, String> {
    pty_manager.spawn_pty(session_id, options, app_handle).await
}

#[tauri::command]
pub async fn pty_write(
    session_id: String,
    data: String,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    pty_manager.write_to_pty(&session_id, &data).await
}

#[tauri::command]
pub async fn pty_resize(
    session_id: String,
    rows: u16,
    cols: u16,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    pty_manager.resize_pty(&session_id, rows, cols).await
}

#[tauri::command]
pub async fn pty_close(
    session_id: String,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    pty_manager.close_pty(&session_id).await
}
