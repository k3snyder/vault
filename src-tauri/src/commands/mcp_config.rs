use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct MCPServerConfig {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MCPProjectConfig {
    #[serde(rename = "mcpServers")]
    pub mcp_servers: HashMap<String, MCPServerConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeConfig {
    pub projects: HashMap<String, MCPProjectConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MCPSettings {
    pub neo4j_uri: String,
    pub neo4j_username: String,
    pub neo4j_password: String,
    pub qdrant_url: String,
    pub qdrant_api_key: Option<String>,
}

pub struct MCPConfigGenerator {
    app_resources: PathBuf,
    vault_path: String,
    window_id: String,
}

impl MCPConfigGenerator {
    pub fn new(app_handle: &AppHandle, vault_path: String, window_id: String) -> Self {
        let app_resources = app_handle
            .path()
            .resource_dir()
            .expect("Failed to get resource directory");

        Self {
            app_resources,
            vault_path,
            window_id,
        }
    }

    pub async fn generate_config(&self) -> Result<ClaudeConfig, String> {
        // Read MCP settings from the vault
        let mcp_settings = self.read_mcp_settings()?;

        // Get the MCP server paths
        let mcp_servers_path = self.app_resources.join("mcp-servers");

        // Create server configurations
        let mut mcp_servers = HashMap::new();

        // Neo4j server
        mcp_servers.insert(
            "gaimplan-neo4j".to_string(),
            MCPServerConfig {
                command: "node".to_string(),
                args: vec![mcp_servers_path
                    .join("neo4j")
                    .join("index.js")
                    .to_string_lossy()
                    .to_string()],
                cwd: mcp_servers_path.to_string_lossy().to_string(),
                env: {
                    let mut env = HashMap::new();
                    env.insert("VAULT_PATH".to_string(), self.vault_path.clone());
                    env.insert("NEO4J_URI".to_string(), mcp_settings.neo4j_uri.clone());
                    env.insert(
                        "NEO4J_USERNAME".to_string(),
                        mcp_settings.neo4j_username.clone(),
                    );
                    env.insert(
                        "NEO4J_PASSWORD".to_string(),
                        mcp_settings.neo4j_password.clone(),
                    );
                    env
                },
            },
        );

        // Qdrant server
        mcp_servers.insert(
            "gaimplan-qdrant".to_string(),
            MCPServerConfig {
                command: "node".to_string(),
                args: vec![mcp_servers_path
                    .join("qdrant-server")
                    .join("index.js")
                    .to_string_lossy()
                    .to_string()],
                cwd: mcp_servers_path.to_string_lossy().to_string(),
                env: {
                    let mut env = HashMap::new();
                    env.insert("VAULT_PATH".to_string(), self.vault_path.clone());
                    env.insert("QDRANT_URL".to_string(), mcp_settings.qdrant_url.clone());
                    if let Some(api_key) = &mcp_settings.qdrant_api_key {
                        env.insert("QDRANT_API_KEY".to_string(), api_key.clone());
                    }
                    env
                },
            },
        );

        // Filesystem server
        mcp_servers.insert(
            "gaimplan-filesystem".to_string(),
            MCPServerConfig {
                command: "node".to_string(),
                args: vec![mcp_servers_path
                    .join("filesystem-server")
                    .join("index.js")
                    .to_string_lossy()
                    .to_string()],
                cwd: mcp_servers_path.to_string_lossy().to_string(),
                env: {
                    let mut env = HashMap::new();
                    env.insert("ALLOWED_PATHS".to_string(), self.vault_path.clone());
                    env
                },
            },
        );

        // Create the project configuration
        let mut projects = HashMap::new();
        projects.insert(self.vault_path.clone(), MCPProjectConfig { mcp_servers });

        Ok(ClaudeConfig { projects })
    }

    fn read_mcp_settings(&self) -> Result<MCPSettings, String> {
        let settings_path = PathBuf::from(&self.vault_path)
            .join(".gaimplan")
            .join("mcp-settings.json");

        if !settings_path.exists() {
            // Return default settings if file doesn't exist
            return Ok(MCPSettings {
                neo4j_uri: "bolt://localhost:7687".to_string(),
                neo4j_username: "neo4j".to_string(),
                neo4j_password: "password".to_string(),
                qdrant_url: "http://localhost:6333".to_string(),
                qdrant_api_key: None,
            });
        }

        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read MCP settings: {}", e))?;

        serde_json::from_str(&content).map_err(|e| format!("Failed to parse MCP settings: {}", e))
    }

    pub async fn write_config_file(&self, config: &ClaudeConfig) -> Result<String, String> {
        // Validate vault path is not empty
        if self.vault_path.is_empty() {
            return Err("Vault path is empty, cannot create .claude directory".to_string());
        }

        // Create project-specific .claude directory
        let vault_path = PathBuf::from(&self.vault_path);

        // Make sure the vault path exists
        if !vault_path.exists() {
            return Err(format!("Vault path does not exist: {}", self.vault_path));
        }

        let project_claude_dir = vault_path.join(".claude");
        fs::create_dir_all(&project_claude_dir)
            .map_err(|e| format!("Failed to create project .claude directory: {}", e))?;

        // Write config file to project directory
        let config_path = project_claude_dir.join("settings.local.json");

        // Claude expects the config in a different format for project-local configs
        let claude_config = json!({
            "mcpServers": config.projects.get(&self.vault_path)
                .map(|p| &p.mcp_servers)
                .unwrap_or(&HashMap::new())
        });

        let json_content = serde_json::to_string_pretty(&claude_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(&config_path, json_content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;

        println!("MCP config written to: {:?}", config_path);

        Ok(config_path.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub async fn generate_mcp_config(
    app_handle: AppHandle,
    vault_path: String,
    window_id: String,
) -> Result<String, String> {
    let generator = MCPConfigGenerator::new(&app_handle, vault_path, window_id);

    let config = generator.generate_config().await?;
    let config_path = generator.write_config_file(&config).await?;

    Ok(config_path)
}

#[tauri::command]
pub async fn write_mcp_config(path: String, content: String, format: String) -> Result<(), String> {
    use std::path::Path;

    let config_path = Path::new(&path);

    // Create parent directory if it doesn't exist
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    // Validate format
    match format.as_str() {
        "json" => {
            // Validate JSON
            serde_json::from_str::<serde_json::Value>(&content)
                .map_err(|e| format!("Invalid JSON: {}", e))?;
        }
        "toml" => {
            // Validate TOML
            toml::from_str::<toml::Value>(&content).map_err(|e| format!("Invalid TOML: {}", e))?;
        }
        _ => {
            return Err(format!("Unsupported format: {}", format));
        }
    }

    // Write content to file
    fs::write(&config_path, &content).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(rename = "type")]
    pub server_type: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn validate_mcp_server(
    name: String,
    config: ServerConfig,
) -> Result<ValidationResult, String> {
    let mut errors = Vec::new();
    let warnings = Vec::new();

    // Validate server type
    let valid_types = ["stdio", "http", "sse"];
    if !valid_types.contains(&config.server_type.as_str()) {
        errors.push(format!(
            "Invalid server type for {}: {}",
            name, config.server_type
        ));
    }

    // Shell metacharacters to check for
    let shell_metacharacters = [
        '|', '&', ';', '$', '`', '(', ')', '{', '}', '[', ']', '<', '>',
    ];

    // Check command for shell metacharacters
    if config
        .command
        .chars()
        .any(|c| shell_metacharacters.contains(&c))
    {
        errors.push(format!("Invalid characters in command for {}", name));
    }

    // Check args for shell metacharacters
    for arg in &config.args {
        if arg.chars().any(|c| shell_metacharacters.contains(&c)) {
            errors.push(format!("Invalid characters in args for {}", name));
            break; // Only report once
        }
    }

    Ok(ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_write_mcp_config_creates_directory() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("subdir").join("config.json");

        let content = r#"{"mcpServers": {}}"#.to_string();

        let result = write_mcp_config(
            config_path.to_string_lossy().to_string(),
            content,
            "json".to_string(),
        )
        .await;

        assert!(result.is_ok());
        assert!(config_path.exists());
    }

    #[tokio::test]
    async fn test_write_mcp_config_validates_json() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");

        let invalid_json = r#"{"invalid": json}"#.to_string();

        let result = write_mcp_config(
            config_path.to_string_lossy().to_string(),
            invalid_json,
            "json".to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid JSON"));
    }

    #[tokio::test]
    async fn test_write_mcp_config_validates_toml() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.toml");

        let invalid_toml = r#"[invalid toml"#.to_string();

        let result = write_mcp_config(
            config_path.to_string_lossy().to_string(),
            invalid_toml,
            "toml".to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid TOML"));
    }

    #[tokio::test]
    async fn test_write_mcp_config_rejects_unsupported_format() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.yaml");

        let content = "key: value".to_string();

        let result = write_mcp_config(
            config_path.to_string_lossy().to_string(),
            content,
            "yaml".to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported format: yaml"));
    }

    #[tokio::test]
    async fn test_write_mcp_config_writes_valid_json() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");

        let content = r#"{"mcpServers": {"test": {"command": "/bin/test"}}}"#.to_string();

        let result = write_mcp_config(
            config_path.to_string_lossy().to_string(),
            content.clone(),
            "json".to_string(),
        )
        .await;

        assert!(result.is_ok());
        assert!(config_path.exists());

        let written_content = fs::read_to_string(&config_path).unwrap();
        assert_eq!(written_content, content);
    }

    #[tokio::test]
    async fn test_write_mcp_config_writes_valid_toml() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.toml");

        let content = r#"[mcp_servers.test]
command = "/bin/test"
"#
        .to_string();

        let result = write_mcp_config(
            config_path.to_string_lossy().to_string(),
            content.clone(),
            "toml".to_string(),
        )
        .await;

        assert!(result.is_ok());
        assert!(config_path.exists());

        let written_content = fs::read_to_string(&config_path).unwrap();
        assert_eq!(written_content, content);
    }

    #[tokio::test]
    async fn test_validate_mcp_server_accepts_valid_stdio() {
        let config = ServerConfig {
            server_type: "stdio".to_string(),
            command: "/usr/local/bin/my-server".to_string(),
            args: vec!["--port".to_string(), "3000".to_string()],
            env: HashMap::from([("API_KEY".to_string(), "test-key".to_string())]),
        };

        let result = validate_mcp_server("test-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(validation.valid);
        assert!(validation.errors.is_empty());
    }

    #[tokio::test]
    async fn test_validate_mcp_server_rejects_invalid_type() {
        let config = ServerConfig {
            server_type: "invalid".to_string(),
            command: "/usr/local/bin/my-server".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        let result = validate_mcp_server("test-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|e| e.contains("Invalid server type")));
    }

    #[tokio::test]
    async fn test_validate_mcp_server_detects_shell_metacharacters_in_command() {
        let config = ServerConfig {
            server_type: "stdio".to_string(),
            command: "rm -rf / | cat".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        let result = validate_mcp_server("test-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|e| e.contains("Invalid characters in command")));
    }

    #[tokio::test]
    async fn test_validate_mcp_server_detects_shell_metacharacters_in_args() {
        let config = ServerConfig {
            server_type: "stdio".to_string(),
            command: "/usr/local/bin/server".to_string(),
            args: vec!["--flag".to_string(), "value; rm -rf /".to_string()],
            env: HashMap::new(),
        };

        let result = validate_mcp_server("test-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|e| e.contains("Invalid characters in args")));
    }

    #[tokio::test]
    async fn test_validate_mcp_server_accepts_http_type() {
        let config = ServerConfig {
            server_type: "http".to_string(),
            command: "https://api.example.com/mcp".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        let result = validate_mcp_server("remote-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(validation.valid);
        assert!(validation.errors.is_empty());
    }

    #[tokio::test]
    async fn test_validate_mcp_server_accepts_sse_type() {
        let config = ServerConfig {
            server_type: "sse".to_string(),
            command: "https://api.example.com/events".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        let result = validate_mcp_server("sse-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(validation.valid);
        assert!(validation.errors.is_empty());
    }

    #[tokio::test]
    async fn test_validate_mcp_server_multiple_errors() {
        let config = ServerConfig {
            server_type: "invalid".to_string(),
            command: "/bin/test | cat".to_string(),
            args: vec!["--flag".to_string(), "value; rm".to_string()],
            env: HashMap::new(),
        };

        let result = validate_mcp_server("bad-server".to_string(), config).await;

        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(!validation.valid);
        assert!(validation.errors.len() >= 2); // Should have type error and command error
    }
}
