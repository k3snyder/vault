use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::mcp::types::*;

/// Maximum number of concurrent MCP server processes
const MAX_PROCESSES: usize = 5;

/// Process pool for managing MCP server processes
pub struct ProcessPool {
    /// Active processes indexed by server ID
    active_processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
    /// Maximum number of processes allowed
    max_processes: usize,
    /// App handle for resolving resource paths
    app_handle: AppHandle,
}

/// Handle to a running MCP server process
pub struct ProcessHandle {
    pub child: Arc<Mutex<Child>>,
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub stdout_reader: Arc<Mutex<BufReader<ChildStdout>>>,
    pub stderr_reader: Arc<Mutex<BufReader<ChildStderr>>>,
}

impl ProcessPool {
    /// Create a new process pool
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            active_processes: Arc::new(Mutex::new(HashMap::new())),
            max_processes: MAX_PROCESSES,
            app_handle,
        }
    }

    /// Spawn a new MCP server process
    pub async fn spawn(&self, config: &ServerConfig) -> Result<ProcessHandle> {
        println!("🔧 ProcessPool::spawn called");

        // Check resource limits
        self.check_limits().await?;
        println!("✅ Process limits checked");

        // Extract stdio config
        let (command, args, env, working_dir) = match &config.transport {
            TransportType::Stdio {
                command,
                args,
                env,
                working_dir,
            } => {
                println!("✅ Extracted stdio config: {} {:?}", command, args);
                (
                    command.clone(),
                    args.clone(),
                    env.clone(),
                    working_dir.clone(),
                )
            }
            _ => return Err(anyhow!("Process pool only supports stdio transport")),
        };

        // Resolve MCP server paths for production FIRST
        let (resolved_command, resolved_args) = self.resolve_mcp_command(&command, &args)?;

        // Build command with resolved paths
        println!(
            "🚀 Spawning command: {} with args: {:?}",
            resolved_command, resolved_args
        );
        let mut cmd = Command::new(&resolved_command);
        cmd.args(&resolved_args);

        // Ensure PATH includes common binary locations (especially for Node.js)
        let mut path_components = vec![];

        // Add existing PATH if available
        if let Ok(existing_path) = std::env::var("PATH") {
            path_components.push(existing_path);
        }

        // Add common macOS binary locations (prioritize likely Node.js locations)
        let common_paths = vec![
            "/opt/homebrew/bin", // Homebrew on Apple Silicon (most likely)
            "/usr/local/bin",    // Homebrew on Intel
            "/opt/homebrew/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/usr/local/node/bin", // Node.js official installer
            "/opt/local/bin",      // MacPorts
            // Add Rust MCP server locations for development
            "/Users/ksnyder/code/aura-dev/mcp-servers/filesystem-server-rust/target/release",
            "/Users/ksnyder/code/aura-dev/mcp-servers/search-server-rust/target/release",
            "/Users/ksnyder/code/aura-dev/mcp-servers/git-server-rust/target/release",
        ];

        // Add user-specific paths if HOME is set
        if let Ok(home) = std::env::var("HOME") {
            path_components.push(format!("{}/.local/bin", home));
            path_components.push(format!("{}/bin", home));

            // Add Node Version Manager paths if they exist
            let nvm_path = format!("{}/.nvm/versions/node", home);
            if let Ok(entries) = std::fs::read_dir(&nvm_path) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let node_bin = entry.path().join("bin");
                        if node_bin.exists() {
                            path_components.push(node_bin.to_string_lossy().to_string());
                        }
                    }
                }
            }

            // Add other Node managers
            let volta_bin = format!("{}/.volta/bin", home);
            if std::path::Path::new(&volta_bin).exists() {
                path_components.push(volta_bin);
            }

            let fnm_bin = format!("{}/.fnm", home);
            if std::path::Path::new(&fnm_bin).exists() {
                path_components.push(fnm_bin);
            }
        }

        for path in common_paths {
            if !path_components.contains(&path.to_string()) {
                path_components.push(path.to_string());
            }
        }

        let full_path = path_components.join(":");
        println!("🔧 MCP Process using PATH: {}", &full_path);

        // Debug: Try to find Node.js in the PATH
        for path_dir in &path_components {
            let node_path = std::path::Path::new(path_dir).join("node");
            if node_path.exists() {
                println!("✅ Found Node.js at: {}", node_path.display());
                break;
            }
        }

        cmd.env("PATH", full_path);

        // Set additional environment variables that might help Node.js
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }
        if let Ok(user) = std::env::var("USER") {
            cmd.env("USER", user);
        }
        if let Ok(shell) = std::env::var("SHELL") {
            cmd.env("SHELL", shell);
        }

        // Set environment variables (but skip VAULT_PATH - servers use CWD)
        for (key, value) in &env {
            if key == "VAULT_PATH" {
                // Skip VAULT_PATH - MCP servers should use their working directory
                println!("🔧 Skipping VAULT_PATH env var - servers will use working directory");
                continue;
            }

            println!("🔧 Setting env var: {}={}", key, value);
            cmd.env(key, value);
        }

        // Set working directory - use specified directory or current directory
        let final_working_dir = if let Some(cwd) = working_dir {
            println!("🔧 Using specified working directory: {:?}", cwd);
            cmd.current_dir(&cwd);
            cwd.clone()
        } else {
            // Use current directory as fallback
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            println!(
                "🔧 No working_dir specified, using current directory: {:?}",
                cwd
            );
            cmd.current_dir(&cwd);
            cwd.to_string_lossy().to_string()
        };

        // Configure process pipes
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Debug: Show final command and working directory
        println!(
            "🚀 Executing command: {} {:?}",
            resolved_command, resolved_args
        );
        println!("🔧 Final working directory: {:?}", final_working_dir);

        // Additional debug for production
        if resolved_args.len() > 0 {
            let script_path = &resolved_args[0];
            println!("🔍 Checking if script exists: {}", script_path);
            if std::path::Path::new(script_path).exists() {
                println!("✅ Script file exists at: {}", script_path);
            } else {
                println!("❌ Script file NOT FOUND at: {}", script_path);
            }
        }

        // Kill process when parent dies (platform-specific)
        #[cfg(unix)]
        {
            unsafe {
                cmd.pre_exec(|| {
                    // Set process group
                    libc::setpgid(0, 0);
                    Ok(())
                });
            }
        }

        // Spawn process
        println!("🚀 Spawning process: {} {:?}", command, args);
        let mut child = cmd
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn process: {}", e))?;
        println!("✅ Process spawned with PID: {:?}", child.id());

        // Extract handles
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to get stdin handle"))?;
        let stdout = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| anyhow!("Failed to get stdout handle"))?,
        );
        let stderr = BufReader::new(
            child
                .stderr
                .take()
                .ok_or_else(|| anyhow!("Failed to get stderr handle"))?,
        );

        Ok(ProcessHandle {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            stdout_reader: Arc::new(Mutex::new(stdout)),
            stderr_reader: Arc::new(Mutex::new(stderr)),
        })
    }

    /// Check if we can spawn more processes
    async fn check_limits(&self) -> Result<()> {
        let processes = self.active_processes.lock().await;
        if processes.len() >= self.max_processes {
            return Err(anyhow!(
                "Process limit reached. Maximum {} processes allowed",
                self.max_processes
            ));
        }
        Ok(())
    }

    /// Store a process handle
    pub async fn register(&self, server_id: String, handle: ProcessHandle) {
        self.active_processes.lock().await.insert(server_id, handle);
    }

    /// Remove a process handle
    pub async fn unregister(&self, server_id: &str) -> Option<ProcessHandle> {
        self.active_processes.lock().await.remove(server_id)
    }

    /// Get active process count
    pub async fn active_count(&self) -> usize {
        self.active_processes.lock().await.len()
    }

    /// Cleanup all processes
    pub async fn cleanup_all(&self) -> Result<()> {
        let mut processes = self.active_processes.lock().await;

        for (server_id, handle) in processes.drain() {
            // Try graceful shutdown first
            if let Err(e) = handle.kill().await {
                eprintln!("Error killing process for {}: {}", server_id, e);
            }
        }

        Ok(())
    }

    /// Get the app's resource directory for resolving relative paths
    fn get_app_resource_dir(&self) -> Option<PathBuf> {
        // Debug: Show current directory
        if let Ok(current_dir) = std::env::current_dir() {
            println!("🔧 Current directory: {:?}", current_dir);
        }

        // Try to get the resource directory from the app handle
        // This works for both development and production builds
        match self.app_handle.path().resource_dir() {
            Ok(path) => {
                println!("🔧 App resource directory: {:?}", path);
                // Check if this path exists
                if path.exists() {
                    println!("✅ App resource directory exists");
                    return Some(path);
                } else {
                    println!("❌ App resource directory does not exist");
                }
            }
            Err(e) => {
                println!("❌ Failed to get app resource directory: {}", e);
            }
        }

        // Fallback: try to detect if we're in development and use parent directory
        if let Ok(current_dir) = std::env::current_dir() {
            println!(
                "🔧 Checking if current directory is src-tauri: {:?}",
                current_dir
            );
            if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
                if let Some(parent) = current_dir.parent() {
                    println!("🔧 Development mode: using parent directory: {:?}", parent);
                    return Some(parent.to_path_buf());
                }
            }
        }

        println!("⚠️  Could not determine app resource directory, using current directory");
        None
    }

    /// Validate that a vault path exists and is accessible
    fn validate_vault_path(&self, path_str: &str) -> Result<()> {
        let path = PathBuf::from(path_str);

        // Check if path exists
        if !path.exists() {
            return Err(anyhow!("Vault path does not exist"));
        }

        // Check if path is a directory
        if !path.is_dir() {
            return Err(anyhow!("Vault path is not a directory"));
        }

        // Check if path is readable
        match std::fs::read_dir(&path) {
            Ok(_) => {
                println!("✅ Vault path validated: {}", path_str);
                Ok(())
            }
            Err(e) => Err(anyhow!("Cannot read vault directory: {}", e)),
        }
    }

    /// Resolve MCP server command for production vs development
    fn resolve_mcp_command(&self, command: &str, args: &[String]) -> Result<(String, Vec<String>)> {
        // Handle Rust MCP servers (sidecars)
        if command == "mcp-filesystem-server" || command == "mcp-search-server" {
            println!("🔍 Resolving Rust MCP server sidecar: {}", command);

            // First check if we're in development mode
            if cfg!(debug_assertions) {
                println!("🔧 Running in development mode");

                // Try to find the binary in the mcp-servers directory
                if let Ok(current_dir) = std::env::current_dir() {
                    println!("📁 Current directory: {:?}", current_dir);

                    // Map command names to project directories
                    let project_dir = match command {
                        "mcp-filesystem-server" => "filesystem-server-rust",
                        "mcp-search-server" => "search-server-rust",
                        _ => return Ok((command.to_string(), args.to_vec())),
                    };

                    // Try different possible locations (debug first, then release)
                    let possible_paths = vec![
                        // Debug builds - from src-tauri directory
                        current_dir.parent().map(|p| {
                            p.join(format!(
                                "mcp-servers/{}/target/debug/{}",
                                project_dir, command
                            ))
                        }),
                        // Debug builds - from project root
                        Some(current_dir.join(format!(
                            "mcp-servers/{}/target/debug/{}",
                            project_dir, command
                        ))),
                        // Release builds - from src-tauri directory
                        current_dir.parent().map(|p| {
                            p.join(format!(
                                "mcp-servers/{}/target/release/{}",
                                project_dir, command
                            ))
                        }),
                        // Release builds - from project root
                        Some(current_dir.join(format!(
                            "mcp-servers/{}/target/release/{}",
                            project_dir, command
                        ))),
                    ];

                    for path_opt in possible_paths.into_iter().flatten() {
                        println!("🔍 Checking path: {:?}", path_opt);
                        if path_opt.exists() {
                            println!("✅ Found binary at: {:?}", path_opt);
                            return Ok((path_opt.to_string_lossy().to_string(), args.to_vec()));
                        }
                    }
                }
            }

            // Production mode - sidecars are in the MacOS directory on macOS
            println!("🔍 Checking production sidecar locations for: {}", command);

            // Debug current environment
            if let Ok(exe_path) = std::env::current_exe() {
                println!("📍 Current executable: {:?}", exe_path);
            }

            // On macOS, sidecars are placed in Contents/MacOS directory
            #[cfg(target_os = "macos")]
            {
                if let Ok(exe_dir) = std::env::current_exe() {
                    println!("📍 Executable directory: {:?}", exe_dir);
                    if let Some(macos_dir) = exe_dir.parent() {
                        println!("📍 MacOS directory: {:?}", macos_dir);
                        let sidecar_path = macos_dir.join(command);
                        println!("🔍 Checking MacOS dir: {:?}", sidecar_path);
                        if sidecar_path.exists() {
                            println!("✅ Found sidecar in MacOS dir: {:?}", sidecar_path);
                            // Check if it's executable
                            if let Ok(metadata) = std::fs::metadata(&sidecar_path) {
                                println!("📊 Sidecar permissions: {:?}", metadata.permissions());
                            }
                            return Ok((sidecar_path.to_string_lossy().to_string(), args.to_vec()));
                        } else {
                            println!("❌ Sidecar not found at: {:?}", sidecar_path);
                        }
                    }
                }
            }

            // Try Tauri's sidecar resolution as fallback
            if let Ok(sidecar_path) = self
                .app_handle
                .path()
                .resolve(command, tauri::path::BaseDirectory::Resource)
            {
                println!("✅ Resolved sidecar path via Tauri: {:?}", sidecar_path);
                return Ok((sidecar_path.to_string_lossy().to_string(), args.to_vec()));
            }

            // If all else fails, return error
            println!("❌ Could not find binary for: {}", command);
            return Err(anyhow!("Could not find MCP server binary: {}", command));
        }

        // If it's not a node command with MCP server path, return as-is
        if command != "node" || args.is_empty() {
            return Ok((command.to_string(), args.to_vec()));
        }

        let server_path = &args[0];

        // Check if it's an MCP server path
        if !server_path.starts_with("./mcp-servers/") && !server_path.starts_with("mcp-servers/") {
            return Ok((command.to_string(), args.to_vec()));
        }

        println!("🔍 Resolving MCP server path: {}", server_path);

        // Try production path first
        if let Ok(resource_dir) = self.app_handle.path().resource_dir() {
            println!("🔍 Resource directory: {:?}", resource_dir);
            let clean_path = server_path.strip_prefix("./").unwrap_or(server_path);

            // Try _up_ directory first (Tauri bundles parent references under _up_)
            let production_path_up = resource_dir.join("_up_").join(clean_path);
            println!(
                "🔍 Checking production path (_up_): {:?}",
                production_path_up
            );
            if production_path_up.exists() {
                println!(
                    "✅ Using production MCP server path (_up_): {:?}",
                    production_path_up
                );
                let mut new_args = vec![production_path_up.to_string_lossy().to_string()];
                new_args.extend_from_slice(&args[1..]);
                return Ok((command.to_string(), new_args));
            } else {
                println!("❌ Production path (_up_) does not exist");
            }

            // Try direct path as fallback
            let production_path = resource_dir.join(clean_path);
            println!(
                "🔍 Checking production path (direct): {:?}",
                production_path
            );
            if production_path.exists() {
                println!("✅ Using production MCP server path: {:?}", production_path);
                let mut new_args = vec![production_path.to_string_lossy().to_string()];
                new_args.extend_from_slice(&args[1..]);
                return Ok((command.to_string(), new_args));
            } else {
                println!("❌ Production path (direct) does not exist");
            }
        } else {
            println!("⚠️  Could not get resource directory");
        }

        // Fallback to development path
        println!("🔍 Trying development paths...");
        if let Ok(current_dir) = std::env::current_dir() {
            println!("🔍 Current directory: {:?}", current_dir);
            let dev_path = if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri")
            {
                current_dir
                    .parent()
                    .map(|p| p.join(server_path.strip_prefix("./").unwrap_or(server_path)))
            } else {
                Some(current_dir.join(server_path.strip_prefix("./").unwrap_or(server_path)))
            };

            if let Some(path) = dev_path {
                println!("🔍 Checking development path: {:?}", path);
                if path.exists() {
                    println!("✅ Using development MCP server path: {:?}", path);
                    let mut new_args = vec![path.to_string_lossy().to_string()];
                    new_args.extend_from_slice(&args[1..]);
                    return Ok((command.to_string(), new_args));
                } else {
                    println!("❌ Development path does not exist");
                }
            }
        }

        // Return original if nothing found
        println!(
            "⚠️  No valid paths found, using original: {} {:?}",
            command, args
        );
        Ok((command.to_string(), args.to_vec()))
    }

    /// Get MCP server directory from args
    fn get_mcp_server_dir(&self, args: &[String]) -> Option<PathBuf> {
        if args.is_empty() {
            return None;
        }

        let server_path = &args[0];
        if !server_path.contains("mcp-servers") {
            return None;
        }

        // Try to get the parent directory of the index.js file
        let path = PathBuf::from(server_path);
        path.parent().map(|p| p.to_path_buf())
    }
}

impl ProcessHandle {
    /// Write a line to the process stdin
    pub async fn write_line(&self, line: &str) -> Result<()> {
        println!("📝 Writing to stdin: {}", line);
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await.map_err(|e| {
            eprintln!("❌ Failed to write line: {}", e);
            anyhow!("Failed to write to stdin: {}", e)
        })?;
        stdin.write_all(b"\n").await.map_err(|e| {
            eprintln!("❌ Failed to write newline: {}", e);
            anyhow!("Failed to write newline: {}", e)
        })?;
        stdin.flush().await.map_err(|e| {
            eprintln!("❌ Failed to flush stdin: {}", e);
            anyhow!("Failed to flush stdin: {}", e)
        })?;
        println!("✅ Successfully wrote to stdin and flushed");
        Ok(())
    }

    /// Read a line from stdout
    pub async fn read_stdout_line(&self) -> Result<Option<String>> {
        let mut reader = self.stdout_reader.lock().await;
        let mut line = String::new();

        match reader.read_line(&mut line).await {
            Ok(0) => Ok(None), // EOF
            Ok(_) => {
                // Remove trailing newline
                if line.ends_with('\n') {
                    line.pop();
                    if line.ends_with('\r') {
                        line.pop();
                    }
                }
                Ok(Some(line))
            }
            Err(e) => Err(anyhow!("Error reading stdout: {}", e)),
        }
    }

    /// Read a line from stderr
    pub async fn read_stderr_line(&self) -> Result<Option<String>> {
        let mut reader = self.stderr_reader.lock().await;
        let mut line = String::new();

        match reader.read_line(&mut line).await {
            Ok(0) => Ok(None), // EOF
            Ok(_) => {
                // Remove trailing newline
                if line.ends_with('\n') {
                    line.pop();
                    if line.ends_with('\r') {
                        line.pop();
                    }
                }
                Ok(Some(line))
            }
            Err(e) => Err(anyhow!("Error reading stderr: {}", e)),
        }
    }

    /// Check if process is still running
    pub async fn is_running(&self) -> bool {
        let mut child = self.child.lock().await;
        match child.try_wait() {
            Ok(Some(_)) => false, // Process has exited
            Ok(None) => true,     // Still running
            Err(_) => false,      // Error checking status
        }
    }

    /// Kill the process
    pub async fn kill(&self) -> Result<()> {
        let mut child = self.child.lock().await;
        child
            .kill()
            .await
            .map_err(|e| anyhow!("Failed to kill process: {}", e))
    }
}

// Cleanup processes on drop
impl Drop for ProcessPool {
    fn drop(&mut self) {
        // Note: We can't do async cleanup in drop, so we rely on
        // explicit cleanup or OS process cleanup
    }
}
