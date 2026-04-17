use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::Manager;
use tokio::process::Command;

#[tauri::command]
pub async fn check_mcp_servers_status(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    // In production, MCP servers are bundled under _up_ directory
    let mcp_servers_dir = resource_dir.join("_up_").join("mcp-servers");
    let mcp_servers_alt = resource_dir.join("mcp-servers");
    let mut status = serde_json::Map::new();

    // Check if we're in development (no resource dir) or production
    let servers_path = if mcp_servers_dir.exists() {
        println!(
            "🔧 Using production MCP servers path (_up_): {:?}",
            mcp_servers_dir
        );
        mcp_servers_dir
    } else if mcp_servers_alt.exists() {
        println!(
            "🔧 Using production MCP servers path: {:?}",
            mcp_servers_alt
        );
        mcp_servers_alt
    } else {
        // Development - use parent directory
        if let Ok(current_dir) = std::env::current_dir() {
            if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
                if let Some(parent) = current_dir.parent() {
                    let dev_path = parent.join("mcp-servers");
                    println!("🔧 Using development MCP servers path: {:?}", dev_path);
                    dev_path
                } else {
                    return Ok(json!({"error": "Could not find MCP servers directory"}));
                }
            } else {
                return Ok(json!({"error": "Not in expected directory structure"}));
            }
        } else {
            return Ok(json!({"error": "Could not determine current directory"}));
        }
    };

    if !servers_path.exists() {
        return Ok(json!({"error": "MCP servers directory not found"}));
    }

    let entries =
        std::fs::read_dir(&servers_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let server_dir = entry.path();
            let server_name = entry.file_name().to_string_lossy().to_string();

            let has_package_json = server_dir.join("package.json").exists();
            let has_node_modules = server_dir.join("node_modules").exists();

            status.insert(
                server_name,
                json!({
                    "path": server_dir.to_string_lossy(),
                    "has_package_json": has_package_json,
                    "has_node_modules": has_node_modules,
                    "needs_install": has_package_json && !has_node_modules
                }),
            );
        }
    }

    Ok(Value::Object(status))
}

#[tauri::command]
pub async fn setup_mcp_servers(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut results = Vec::new();

    // Get the resource directory where MCP servers are bundled
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    // In production, MCP servers are bundled under _up_ directory
    let mcp_servers_dir = resource_dir.join("_up_").join("mcp-servers");
    let mcp_servers_alt = resource_dir.join("mcp-servers");

    // Check if we're in development or production
    let servers_path = if mcp_servers_dir.exists() {
        println!(
            "🚀 Setting up MCP servers in production at (_up_): {:?}",
            mcp_servers_dir
        );
        mcp_servers_dir
    } else if mcp_servers_alt.exists() {
        println!(
            "🚀 Setting up MCP servers in production at: {:?}",
            mcp_servers_alt
        );
        mcp_servers_alt
    } else {
        // Development - use parent directory
        if let Ok(current_dir) = std::env::current_dir() {
            if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
                if let Some(parent) = current_dir.parent() {
                    let dev_path = parent.join("mcp-servers");
                    println!(
                        "🚀 Setting up MCP servers in development at: {:?}",
                        dev_path
                    );
                    dev_path
                } else {
                    return Err("Could not find MCP servers directory".to_string());
                }
            } else {
                return Err("Not in expected directory structure".to_string());
            }
        } else {
            return Err("Could not determine current directory".to_string());
        }
    };

    if !servers_path.exists() {
        return Err("MCP servers directory not found".to_string());
    }

    // Find all server directories
    let entries = std::fs::read_dir(&servers_path)
        .map_err(|e| format!("Failed to read MCP servers directory: {}", e))?;

    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let server_dir = entry.path();
            let server_name = entry.file_name().to_string_lossy().to_string();

            // Check if package.json exists
            let package_json = server_dir.join("package.json");
            if !package_json.exists() {
                results.push(format!("{}: no package.json found", server_name));
                continue;
            }

            // Check if node_modules exists
            let node_modules = server_dir.join("node_modules");
            if node_modules.exists() {
                results.push(format!("{}: already installed", server_name));
                continue;
            }

            println!("📦 Installing dependencies for {}...", server_name);

            // Run npm install
            match install_server_dependencies(&server_dir, &server_name).await {
                Ok(output) => {
                    println!("✅ {} installed successfully", server_name);
                    results.push(format!("{}: {}", server_name, output));
                }
                Err(e) => {
                    println!("❌ {} installation failed: {}", server_name, e);
                    results.push(format!("{}: ERROR - {}", server_name, e));
                }
            }
        }
    }

    Ok(results)
}

async fn install_server_dependencies(
    server_dir: &PathBuf,
    server_name: &str,
) -> Result<String, String> {
    println!("🔧 Running npm install in {:?}", server_dir);

    // Check if npm is available
    let npm_check = Command::new("which")
        .arg("npm")
        .output()
        .await
        .map_err(|e| format!("Failed to check for npm: {}", e))?;

    if !npm_check.status.success() {
        return Err("npm not found in PATH".to_string());
    }

    // Create npm install command
    let mut cmd = Command::new("npm");
    cmd.arg("install")
        .arg("--production")
        .arg("--no-audit")
        .arg("--no-fund")
        .arg("--silent")
        .current_dir(server_dir)
        .env("NODE_ENV", "production");

    // Execute with timeout
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120), // 2 minute timeout per server
        cmd.output(),
    )
    .await
    .map_err(|_| format!("npm install timed out for {}", server_name))?
    .map_err(|e| format!("Failed to execute npm install: {}", e))?;

    if output.status.success() {
        // Check if node_modules was created
        let node_modules = server_dir.join("node_modules");
        if node_modules.exists() {
            Ok("installed successfully".to_string())
        } else {
            Err("npm install succeeded but node_modules not found".to_string())
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!(
            "npm install failed\nSTDOUT: {}\nSTDERR: {}",
            stdout, stderr
        ))
    }
}
