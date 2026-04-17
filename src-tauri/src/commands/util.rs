use std::env;
use std::process::Command;
use tauri::Manager;

#[tauri::command]
pub fn get_bundle_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .path()
        .resource_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get resource directory: {}", e))
}

#[tauri::command]
pub fn check_command_exists(command: String) -> bool {
    // Build comprehensive PATH for production environments
    let mut path_components = vec![];

    // Add existing PATH if available
    if let Ok(existing_path) = env::var("PATH") {
        path_components.push(existing_path);
    }

    // Add common macOS binary locations where Claude CLI might be installed
    let common_paths = vec![
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    // Add user-specific paths
    if let Ok(home) = env::var("HOME") {
        path_components.push(format!("{}/.local/bin", home));
        path_components.push(format!("{}/bin", home));
        // Add common Claude CLI installation location
        path_components.push(format!("{}/.claude/bin", home));

        // Add NVM paths - check for various Node versions
        let nvm_base = format!("{}/.nvm/versions/node", home);
        if std::path::Path::new(&nvm_base).exists() {
            // Try to find any installed Node version
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                for entry in entries.flatten() {
                    if let Some(version) = entry.file_name().to_str() {
                        if version.starts_with("v") {
                            let nvm_bin = format!("{}/{}/bin", nvm_base, version);
                            if !path_components.contains(&nvm_bin) {
                                path_components.push(nvm_bin);
                            }
                        }
                    }
                }
            }
        }
    }

    for path in common_paths {
        if !path_components.contains(&path.to_string()) {
            path_components.push(path.to_string());
        }
    }

    let full_path = path_components.join(":");

    // First try with enhanced PATH
    let result = Command::new("which")
        .env("PATH", &full_path)
        .arg(&command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    if result {
        println!("Command '{}' found in PATH", command);
        return true;
    }

    // As a fallback, check common installation locations directly
    let common_locations = vec![
        format!("/usr/local/bin/{}", command),
        format!("/opt/homebrew/bin/{}", command),
        format!("/usr/bin/{}", command),
    ];

    if let Ok(home) = env::var("HOME") {
        let mut home_locations = vec![
            format!("{}/.local/bin/{}", home, command),
            format!("{}/bin/{}", home, command),
            format!("{}/.claude/bin/{}", home, command),
        ];

        // Check NVM installations
        let nvm_base = format!("{}/.nvm/versions/node", home);
        if std::path::Path::new(&nvm_base).exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                for entry in entries.flatten() {
                    if let Some(version) = entry.file_name().to_str() {
                        if version.starts_with("v") {
                            home_locations
                                .push(format!("{}/{}/bin/{}", nvm_base, version, command));
                        }
                    }
                }
            }
        }

        for loc in home_locations {
            if std::path::Path::new(&loc).exists() {
                println!("Command '{}' found at: {}", command, loc);
                return true;
            }
        }
    }

    for loc in common_locations {
        if std::path::Path::new(&loc).exists() {
            println!("Command '{}' found at: {}", command, loc);
            return true;
        }
    }

    println!("Command '{}' not found in any known location", command);
    false
}
