use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct GhosttyInstallationStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub valid: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhosttyProcessInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime: u64,
    pub start_time: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhosttyStatus {
    pub installation: GhosttyInstallationStatus,
    pub process: GhosttyProcessInfo,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhosttySpawnOptions {
    pub cwd: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
}

pub struct GhosttyManager {
    process: Arc<Mutex<Option<Child>>>,
    start_time: Arc<Mutex<Option<std::time::Instant>>>,
}

impl GhosttyManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            start_time: Arc::new(Mutex::new(None)),
        }
    }

    async fn detect_ghostty_binary(&self) -> Option<String> {
        // Check common installation paths on macOS
        let home = std::env::var("HOME").unwrap_or_default();
        let paths = vec![
            // Standard macOS app locations
            "/Applications/Ghostty.app/Contents/MacOS/ghostty".to_string(),
            format!("{}/Applications/Ghostty.app/Contents/MacOS/ghostty", home),
            // Development/build locations
            format!("{}/code/ghostty/zig-out/bin/ghostty", home),
            format!("{}/dev/ghostty/zig-out/bin/ghostty", home),
            format!("{}/projects/ghostty/zig-out/bin/ghostty", home),
            // Homebrew installations
            "/opt/homebrew/bin/ghostty".to_string(),
            "/usr/local/bin/ghostty".to_string(),
            // Direct binary in common locations
            format!("{}/.local/bin/ghostty", home),
            format!("{}/bin/ghostty", home),
        ];

        for path in paths {
            if std::path::Path::new(&path).exists() {
                println!("Found Ghostty at: {}", path);
                return Some(path);
            }
        }

        // Check if ghostty is in PATH
        match Command::new("which").arg("ghostty").output() {
            Ok(output) if output.status.success() => {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    println!("Found Ghostty in PATH: {}", path);
                    return Some(path);
                }
            }
            _ => {}
        }

        println!("Ghostty not found in any known location");
        None
    }

    async fn get_ghostty_version(&self, path: &str) -> Option<String> {
        match Command::new(path).arg("--version").output() {
            Ok(output) if output.status.success() => {
                let version_str = String::from_utf8_lossy(&output.stdout);
                // Extract version number from output like "ghostty 1.0.0"
                version_str
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1).map(|v| v.to_string()))
            }
            _ => None,
        }
    }

    pub async fn get_installation_status(&self) -> GhosttyInstallationStatus {
        if let Some(path) = self.detect_ghostty_binary().await {
            let version = self.get_ghostty_version(&path).await;
            let valid = version.is_some();
            GhosttyInstallationStatus {
                installed: true,
                path: Some(path),
                version,
                valid,
            }
        } else {
            GhosttyInstallationStatus {
                installed: false,
                path: None,
                version: None,
                valid: false,
            }
        }
    }

    pub async fn spawn_process(
        &self,
        options: GhosttySpawnOptions,
        app_handle: AppHandle,
    ) -> Result<bool, String> {
        let mut process_lock = self.process.lock().await;

        // Check if a process is already running
        if process_lock.is_some() {
            return Err("Ghostty process is already running".to_string());
        }

        // Detect Ghostty binary
        let binary_path = self
            .detect_ghostty_binary()
            .await
            .ok_or("Ghostty binary not found")?;

        // Debug print before consuming options
        println!("Spawning Ghostty:");
        println!("  Binary path: {}", binary_path);
        println!("  Working directory: {:?}", &options.cwd);
        println!("  Args: {:?}", &options.args);
        println!("  Env: {:?}", &options.env);

        // Build the command
        let mut cmd = Command::new(&binary_path);

        // Set working directory if provided and not empty
        if let Some(cwd) = options.cwd {
            if !cwd.trim().is_empty() {
                cmd.current_dir(cwd);
            }
        }

        // Add arguments if provided
        if let Some(args) = options.args {
            cmd.args(args);
        }

        // Set environment variables if provided
        if let Some(env) = options.env {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }

        // Let Ghostty handle its own window and I/O
        // We'll monitor the process but not pipe its I/O
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        println!("Full command: {:?}", cmd);

        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id();
                println!("Ghostty spawned with PID: {}", pid);

                // Since we're not piping I/O, we don't need stdout/stderr handlers
                // Ghostty will handle its own window and terminal I/O

                // Emit spawn event
                let _ = app_handle.emit(
                    "ghostty:spawned",
                    serde_json::json!({
                        "success": true,
                        "pid": pid
                    }),
                );

                // Store the process
                *process_lock = Some(child);

                // Update start time
                let mut start_time_lock = self.start_time.lock().await;
                *start_time_lock = Some(std::time::Instant::now());

                Ok(true)
            }
            Err(e) => Err(format!("Failed to spawn Ghostty: {}", e)),
        }
    }

    pub async fn stop_process(&self, force: bool) -> Result<bool, String> {
        let mut process_lock = self.process.lock().await;

        if let Some(mut child) = process_lock.take() {
            // Try to terminate gracefully first
            if !force {
                // On Unix, this sends SIGTERM
                match child.kill() {
                    Ok(_) => {
                        // Wait a bit for graceful shutdown
                        thread::sleep(Duration::from_millis(500));

                        // Check if process exited
                        match child.try_wait() {
                            Ok(Some(_)) => {
                                let mut start_time_lock = self.start_time.lock().await;
                                *start_time_lock = None;
                                return Ok(true);
                            }
                            _ => {}
                        }
                    }
                    Err(e) => return Err(format!("Failed to stop process: {}", e)),
                }
            }

            // Force kill if requested or graceful termination failed
            match child.kill() {
                Ok(_) => {
                    let mut start_time_lock = self.start_time.lock().await;
                    *start_time_lock = None;
                    Ok(true)
                }
                Err(e) => Err(format!("Failed to kill process: {}", e)),
            }
        } else {
            Err("No Ghostty process is running".to_string())
        }
    }

    pub async fn write_to_process(&self, _data: String) -> Result<bool, String> {
        // Writing to process is not supported when Ghostty runs in its own window
        Err("Direct input not supported - use the Ghostty window".to_string())
    }

    pub async fn get_process_info(&self) -> GhosttyProcessInfo {
        let process_lock = self.process.lock().await;
        let start_time_lock = self.start_time.lock().await;

        if let Some(child) = process_lock.as_ref() {
            let uptime = if let Some(start) = *start_time_lock {
                start.elapsed().as_secs()
            } else {
                0
            };

            GhosttyProcessInfo {
                running: true,
                pid: Some(child.id()),
                uptime,
                start_time: start_time_lock.map(|t| {
                    let duration = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs() as i64
                        - t.elapsed().as_secs() as i64;
                    duration
                }),
            }
        } else {
            GhosttyProcessInfo {
                running: false,
                pid: None,
                uptime: 0,
                start_time: None,
            }
        }
    }

    pub async fn get_status(&self) -> GhosttyStatus {
        GhosttyStatus {
            installation: self.get_installation_status().await,
            process: self.get_process_info().await,
        }
    }
}

#[tauri::command]
pub async fn register_ghostty_commands() -> Result<(), String> {
    // This is a placeholder command to ensure the frontend knows
    // that Ghostty commands are available
    Ok(())
}

#[tauri::command]
pub async fn ghostty_spawn(
    options: GhosttySpawnOptions,
    app_handle: AppHandle,
    ghostty_manager: State<'_, Arc<GhosttyManager>>,
) -> Result<bool, String> {
    ghostty_manager.spawn_process(options, app_handle).await
}

#[tauri::command]
pub async fn ghostty_stop(
    force: bool,
    ghostty_manager: State<'_, Arc<GhosttyManager>>,
) -> Result<bool, String> {
    ghostty_manager.stop_process(force).await
}

#[tauri::command]
pub async fn ghostty_write(
    data: String,
    ghostty_manager: State<'_, Arc<GhosttyManager>>,
) -> Result<bool, String> {
    ghostty_manager.write_to_process(data).await
}

#[tauri::command]
pub async fn ghostty_status(
    ghostty_manager: State<'_, Arc<GhosttyManager>>,
) -> Result<GhosttyStatus, String> {
    Ok(ghostty_manager.get_status().await)
}

#[tauri::command]
pub async fn ghostty_installation_status(
    ghostty_manager: State<'_, Arc<GhosttyManager>>,
) -> Result<GhosttyInstallationStatus, String> {
    Ok(ghostty_manager.get_installation_status().await)
}
