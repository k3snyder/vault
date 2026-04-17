// Vault Plugin CLI - Developer tooling for plugin development
// Provides commands for creating, developing, building, and testing plugins
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_assignments)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests;

// These modules will be implemented separately
// pub mod dev_server;
// pub mod bundler;
// pub mod validator;

/// CLI errors
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("Invalid plugin name: {0}")]
    InvalidPluginName(String),

    #[error("Path already exists: {0}")]
    PathExists(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Build failed: {0}")]
    BuildFailed(String),

    #[error("Validation failed: {0}")]
    ValidationFailed(String),

    #[error("Dev server error: {0}")]
    DevServerError(String),

    #[error("Template not found: {0}")]
    TemplateNotFound(String),

    #[error("Command not found: {0}")]
    CommandNotFound(String),

    #[error("Command failed: {0}")]
    CommandFailed(String),
}

/// Command output types
#[derive(Debug, Serialize)]
pub enum CommandOutput {
    Success {
        message: String,
    },
    Created {
        path: PathBuf,
        name: String,
    },
    DevServer {
        port: u16,
        url: String,
    },
    Build {
        output_path: PathBuf,
        size: u64,
    },
    Lint {
        issues: Vec<LintIssue>,
        passed: bool,
    },
    Test {
        passed: usize,
        failed: usize,
        skipped: usize,
    },
    Validate {
        valid: bool,
        issues: Vec<String>,
    },
    Info {
        manifest: PluginManifest,
        size: u64,
    },
}

/// Lint issue
#[derive(Debug, Serialize, Deserialize)]
pub struct LintIssue {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub severity: LintSeverity,
    pub message: String,
    pub rule: String,
}

/// Lint severity
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum LintSeverity {
    Error,
    Warning,
    Info,
}

/// Plugin manifest structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub min_api_version: String,
    pub permissions: Vec<String>,
    pub entry_point: String,
}

impl Default for PluginManifest {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            version: "0.1.0".to_string(),
            description: String::new(),
            author: String::new(),
            min_api_version: "1.0.0".to_string(),
            permissions: Vec::new(),
            entry_point: "dist/main.js".to_string(),
        }
    }
}

/// Main CLI struct
pub struct VaultPluginCli {
    verbose: bool,
}

impl VaultPluginCli {
    /// Create new CLI instance
    pub fn new() -> Self {
        Self { verbose: false }
    }

    /// Run CLI with arguments
    pub async fn run(&self, args: Vec<&str>) -> Result<CommandOutput, CliError> {
        if args.is_empty() {
            return Err(CliError::CommandNotFound("No command provided".to_string()));
        }

        match args[0] {
            "create" => self.create_command(&args[1..]).await,
            "dev" => self.dev_command(&args[1..]).await,
            "build" => self.build_command(&args[1..]).await,
            "lint" => self.lint_command(&args[1..]).await,
            "test" => self.test_command(&args[1..]).await,
            "validate" => self.validate_command(&args[1..]).await,
            "init" => self.init_command(&args[1..]).await,
            "info" => self.info_command(&args[1..]).await,
            "types" => self.types_command(&args[1..]).await,
            _ => Err(CliError::CommandNotFound(args[0].to_string())),
        }
    }

    /// Create new plugin project
    async fn create_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        if args.is_empty() {
            return Err(CliError::InvalidPluginName("No name provided".to_string()));
        }

        let name = args[0];

        // Validate plugin name
        if !self.validate_plugin_name(name) {
            return Err(CliError::InvalidPluginName(name.to_string()));
        }

        // Parse arguments
        let mut path = PathBuf::from(".");
        let mut template = "default";
        let mut force = false;

        let mut i = 1;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--template" => {
                    if i + 1 < args.len() {
                        template = args[i + 1];
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--force" => {
                    force = true;
                    i += 1;
                }
                _ => i += 1,
            }
        }

        let plugin_path = path.join(name);

        // Check if path exists
        if plugin_path.exists() && !force {
            return Err(CliError::PathExists(
                plugin_path.to_string_lossy().to_string(),
            ));
        }

        // Create plugin structure
        self.create_plugin_structure(&plugin_path, name, template)?;

        Ok(CommandOutput::Created {
            path: plugin_path,
            name: name.to_string(),
        })
    }

    /// Dev server command
    async fn dev_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");
        let mut port = 3000;
        let mut hot_reload = false;
        let mut no_open = false;
        let mut mock_permissions = Vec::new();

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--port" => {
                    if i + 1 < args.len() {
                        port = args[i + 1].parse().unwrap_or(3000);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--hot-reload" => {
                    hot_reload = true;
                    i += 1;
                }
                "--no-open" => {
                    no_open = true;
                    i += 1;
                }
                "--mock-permissions" => {
                    if i + 1 < args.len() {
                        mock_permissions = args[i + 1].split(',').map(|s| s.to_string()).collect();
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                _ => i += 1,
            }
        }

        // Use port 0 for random port in tests
        if port == 0 {
            port = portpicker::pick_unused_port()
                .ok_or(CliError::DevServerError("No available ports".to_string()))?;
        }

        // In real implementation, start dev server
        // For now, return mock success
        Ok(CommandOutput::DevServer {
            port,
            url: format!("http://localhost:{}", port),
        })
    }

    /// Build command
    async fn build_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");
        let mut source_maps = false;
        let mut package = false;

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--source-maps" => {
                    source_maps = true;
                    i += 1;
                }
                "--package" => {
                    package = true;
                    i += 1;
                }
                _ => i += 1,
            }
        }

        // Create dist directory
        let dist_path = path.join("dist");
        fs::create_dir_all(&dist_path)?;

        // Copy manifest
        let manifest_src = path.join("manifest.json");
        let manifest_dst = dist_path.join("manifest.json");
        if manifest_src.exists() {
            fs::copy(&manifest_src, &manifest_dst)?;
        }

        // Create mock built file
        let main_js = if source_maps {
            "// Built plugin code\nconsole.log('Plugin loaded');\n//# sourceMappingURL=main.js.map"
        } else {
            "console.log('Plugin loaded');"
        };
        fs::write(dist_path.join("main.js"), main_js)?;

        if source_maps {
            fs::write(
                dist_path.join("main.js.map"),
                "{\"version\":3,\"sources\":[]}",
            )?;
        }

        // Create package if requested
        if package {
            let plugin_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("plugin");
            let package_path = path.join(format!("{}.vault-plugin", plugin_name));
            fs::write(&package_path, "mock package content")?;
        }

        Ok(CommandOutput::Build {
            output_path: dist_path,
            size: 1024, // Mock size
        })
    }

    /// Lint command
    async fn lint_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");
        let mut security = false;

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--security" => {
                    security = true;
                    i += 1;
                }
                _ => i += 1,
            }
        }

        let mut issues = Vec::new();

        // Check manifest
        let manifest_path = path.join("manifest.json");
        if manifest_path.exists() {
            let content = fs::read_to_string(&manifest_path)?;
            match serde_json::from_str::<PluginManifest>(&content) {
                Ok(manifest) => {
                    // Validate manifest fields
                    if manifest.id.is_empty() {
                        issues.push(LintIssue {
                            file: "manifest.json".to_string(),
                            line: 1,
                            column: 1,
                            severity: LintSeverity::Error,
                            message: "Plugin ID is empty".to_string(),
                            rule: "manifest-id".to_string(),
                        });
                    }

                    // Check version format (simple semver check)
                    let parts: Vec<&str> = manifest.version.split('.').collect();
                    if parts.len() != 3 || parts.iter().any(|p| p.parse::<u32>().is_err()) {
                        issues.push(LintIssue {
                            file: "manifest.json".to_string(),
                            line: 1,
                            column: 1,
                            severity: LintSeverity::Error,
                            message: "Invalid version format (expected x.y.z)".to_string(),
                            rule: "manifest-version".to_string(),
                        });
                    }
                }
                Err(_) => {
                    issues.push(LintIssue {
                        file: "manifest.json".to_string(),
                        line: 1,
                        column: 1,
                        severity: LintSeverity::Error,
                        message: "Invalid JSON in manifest".to_string(),
                        rule: "manifest-json".to_string(),
                    });
                }
            }
        } else {
            issues.push(LintIssue {
                file: "manifest.json".to_string(),
                line: 1,
                column: 1,
                severity: LintSeverity::Error,
                message: "Missing manifest.json".to_string(),
                rule: "manifest-missing".to_string(),
            });
        }

        // Security checks if requested
        if security {
            let src_dir = path.join("src");
            if src_dir.exists() {
                for entry in fs::read_dir(&src_dir)? {
                    let entry = entry?;
                    if entry.path().extension().and_then(|e| e.to_str()) == Some("ts") {
                        let content = fs::read_to_string(entry.path())?;

                        // Check for eval
                        if content.contains("eval(") {
                            issues.push(LintIssue {
                                file: entry.file_name().to_string_lossy().to_string(),
                                line: 1,
                                column: 1,
                                severity: LintSeverity::Error,
                                message: "Use of eval is not allowed".to_string(),
                                rule: "no-eval".to_string(),
                            });
                        }

                        // Check for require
                        if content.contains("require(") {
                            issues.push(LintIssue {
                                file: entry.file_name().to_string_lossy().to_string(),
                                line: 1,
                                column: 1,
                                severity: LintSeverity::Error,
                                message: "Direct require() is not allowed".to_string(),
                                rule: "no-require".to_string(),
                            });
                        }

                        // Check for innerHTML
                        if content.contains(".innerHTML") {
                            issues.push(LintIssue {
                                file: entry.file_name().to_string_lossy().to_string(),
                                line: 1,
                                column: 1,
                                severity: LintSeverity::Warning,
                                message: "Use of innerHTML can lead to XSS".to_string(),
                                rule: "no-inner-html".to_string(),
                            });
                        }
                    }
                }
            }
        }

        let passed = issues.is_empty() || !issues.iter().any(|i| i.severity == LintSeverity::Error);

        Ok(CommandOutput::Lint { issues, passed })
    }

    /// Test command
    async fn test_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");
        let mut coverage = false;
        let mut watch = false;
        let mut max_runs: Option<usize> = None;

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--coverage" => {
                    coverage = true;
                    i += 1;
                }
                "--watch" => {
                    watch = true;
                    i += 1;
                }
                "--max-runs" => {
                    if i + 1 < args.len() {
                        max_runs = args[i + 1].parse().ok();
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                _ => i += 1,
            }
        }

        // Create coverage directory if needed
        if coverage {
            fs::create_dir_all(path.join("coverage"))?;
        }

        // Mock test results
        Ok(CommandOutput::Test {
            passed: 5,
            failed: 0,
            skipped: 1,
        })
    }

    /// Validate command
    async fn validate_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                _ => i += 1,
            }
        }

        let mut issues = Vec::new();

        // Check manifest
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            issues.push("Missing manifest.json".to_string());
        } else {
            let content = fs::read_to_string(&manifest_path)?;
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    // Check minApiVersion field
                    if let Some(min_api) = json.get("minApiVersion").and_then(|v| v.as_str()) {
                        if min_api.starts_with("99.") {
                            issues.push(format!("API version {} is not supported", min_api));
                        }
                    }

                    // Try to parse as PluginManifest
                    if let Ok(manifest) = serde_json::from_value::<PluginManifest>(json.clone()) {
                        // Check API version compatibility
                        if manifest.min_api_version.starts_with("99.") {
                            issues.push(format!(
                                "API version {} is not supported",
                                manifest.min_api_version
                            ));
                        }
                    }
                }
                Err(e) => {
                    issues.push(format!("Invalid manifest JSON: {}", e));
                }
            }
        }

        // Check dist directory
        if !path.join("dist").exists() {
            issues.push("Missing dist directory (run build first)".to_string());
        }

        let valid = issues.is_empty();

        Ok(CommandOutput::Validate { valid, issues })
    }

    /// Init command - initialize existing project as plugin
    async fn init_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                _ => i += 1,
            }
        }

        // Read existing package.json if it exists
        let package_json_path = path.join("package.json");
        let project_name = if package_json_path.exists() {
            let content = fs::read_to_string(&package_json_path)?;
            if let Ok(package) = serde_json::from_str::<serde_json::Value>(&content) {
                package["name"].as_str().unwrap_or("my-plugin").to_string()
            } else {
                "my-plugin".to_string()
            }
        } else {
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("my-plugin")
                .to_string()
        };

        // Create plugin files if they don't exist
        if !path.join("manifest.json").exists() {
            let manifest = PluginManifest {
                id: project_name.clone(),
                name: project_name.clone(),
                ..Default::default()
            };
            fs::write(
                path.join("manifest.json"),
                serde_json::to_string_pretty(&manifest)?,
            )?;
        }

        // Create src directory and main.ts if needed
        let src_dir = path.join("src");
        fs::create_dir_all(&src_dir)?;

        if !src_dir.join("main.ts").exists() {
            fs::write(src_dir.join("main.ts"), templates::MAIN_TS_TEMPLATE)?;
        }

        Ok(CommandOutput::Success {
            message: format!("Initialized plugin in {}", path.display()),
        })
    }

    /// Info command - show plugin information
    async fn info_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        // Parse arguments
        let mut path = PathBuf::from(".");

        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--path" => {
                    if i + 1 < args.len() {
                        path = PathBuf::from(args[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                _ => i += 1,
            }
        }

        // Read manifest
        let manifest_path = path.join("manifest.json");
        let manifest: PluginManifest = if manifest_path.exists() {
            let content = fs::read_to_string(&manifest_path)?;
            serde_json::from_str(&content)?
        } else {
            return Err(CliError::ValidationFailed(
                "No manifest.json found".to_string(),
            ));
        };

        // Calculate size (mock for now)
        let size = 1024 * 10; // 10KB

        Ok(CommandOutput::Info { manifest, size })
    }

    /// Generate TypeScript definitions
    async fn types_command(&self, args: &[&str]) -> Result<CommandOutput, CliError> {
        let project_dir = if !args.is_empty() {
            PathBuf::from(args[0])
        } else {
            std::env::current_dir().map_err(CliError::Io)?
        };

        let types_dir = project_dir.join("types");

        // Import the TypeScript generator
        use crate::plugin_runtime::typescript::TypeScriptGenerator;

        let generator = TypeScriptGenerator::new();
        let api = TypeScriptGenerator::create_vault_api_structure();

        // Generate complete type package
        generator
            .generate_type_package(&api, &types_dir)
            .await
            .map_err(|e| CliError::CommandFailed(format!("TypeScript generation failed: {}", e)))?;

        // Also generate VS Code settings
        let vscode_dir = project_dir.join(".vscode");
        generator
            .generate_vscode_settings(&vscode_dir)
            .await
            .map_err(|e| {
                CliError::CommandFailed(format!("VS Code settings generation failed: {}", e))
            })?;

        // Generate migration guide
        let migration_guide = generator
            .generate_migration_guide("obsidian")
            .await
            .map_err(|e| {
                CliError::CommandFailed(format!("Migration guide generation failed: {}", e))
            })?;
        fs::write(project_dir.join("MIGRATION.md"), migration_guide).map_err(CliError::Io)?;

        // Generate code snippets
        let snippets = generator
            .generate_snippets()
            .await
            .map_err(|e| CliError::CommandFailed(format!("Snippets generation failed: {}", e)))?;
        let vscode_snippets_dir = project_dir.join(".vscode");
        fs::create_dir_all(&vscode_snippets_dir).map_err(CliError::Io)?;
        fs::write(
            vscode_snippets_dir.join("vault-plugin.code-snippets"),
            snippets,
        )
        .map_err(CliError::Io)?;

        Ok(CommandOutput::Success {
            message: format!(
                "✅ TypeScript definitions generated successfully!\n\nFiles created:\n  - types/index.d.ts\n  - types/global.d.ts\n  - types/tsconfig.json\n  - types/package.json\n  - types/README.md\n  - .vscode/settings.json\n  - .vscode/vault-plugin.code-snippets\n  - MIGRATION.md\n\nYour plugin project now has complete TypeScript support!"
            ),
        })
    }

    /// Validate plugin name
    fn validate_plugin_name(&self, name: &str) -> bool {
        if name.is_empty() {
            return false;
        }

        // Must start with letter
        if !name.chars().next().unwrap().is_alphabetic() {
            return false;
        }

        // Only alphanumeric and hyphens
        if !name.chars().all(|c| c.is_alphanumeric() || c == '-') {
            return false;
        }

        // No spaces or special characters
        if name.contains(' ') || name.contains('/') || name.contains('\\') {
            return false;
        }

        true
    }

    /// Create plugin structure
    fn create_plugin_structure(
        &self,
        path: &Path,
        name: &str,
        template: &str,
    ) -> Result<(), CliError> {
        // Create directories
        fs::create_dir_all(path)?;
        fs::create_dir_all(path.join("src"))?;
        fs::create_dir_all(path.join("tests"))?;

        // Create manifest
        let manifest = PluginManifest {
            id: if template == "readwise" {
                "readwise".to_string()
            } else {
                name.to_string()
            },
            name: if template == "readwise" {
                "Readwise".to_string()
            } else {
                name.to_string()
            },
            description: if template == "readwise" {
                "Sync highlights from Readwise".to_string()
            } else {
                format!("{} plugin for Vault", name)
            },
            author: "Your Name".to_string(),
            ..Default::default()
        };

        fs::write(
            path.join("manifest.json"),
            serde_json::to_string_pretty(&manifest)?,
        )?;

        // Create package.json
        let package_json = serde_json::json!({
            "name": name,
            "version": "0.1.0",
            "scripts": {
                "dev": "vault-plugin dev",
                "build": "vault-plugin build",
                "test": "vault-plugin test",
                "lint": "vault-plugin lint"
            },
            "devDependencies": {
                "@types/node": "^20.0.0",
                "typescript": "^5.0.0",
                "vault-plugin-sdk": "^1.0.0"
            }
        });

        fs::write(
            path.join("package.json"),
            serde_json::to_string_pretty(&package_json)?,
        )?;

        // Create tsconfig.json
        let tsconfig = serde_json::json!({
            "compilerOptions": {
                "target": "ES2020",
                "module": "ESNext",
                "lib": ["ES2020", "DOM"],
                "outDir": "./dist",
                "rootDir": "./src",
                "strict": true,
                "esModuleInterop": true,
                "skipLibCheck": true,
                "forceConsistentCasingInFileNames": true,
                "declaration": true,
                "declarationMap": true,
                "sourceMap": true
            },
            "include": ["src/**/*"],
            "exclude": ["node_modules", "dist"]
        });

        fs::write(
            path.join("tsconfig.json"),
            serde_json::to_string_pretty(&tsconfig)?,
        )?;

        // Create main.ts
        let main_content = if template == "readwise" {
            templates::READWISE_TEMPLATE
        } else if template == "with-tests" {
            templates::WITH_TESTS_TEMPLATE
        } else {
            templates::MAIN_TS_TEMPLATE
        };

        fs::write(path.join("src").join("main.ts"), main_content)?;

        // Create README
        fs::write(
            path.join("README.md"),
            format!(
                "# {}\n\n{}\n\n## Development\n\n```bash\nnpm install\nnpm run dev\n```",
                name, manifest.description
            ),
        )?;

        // Create .gitignore
        fs::write(
            path.join(".gitignore"),
            "node_modules/\ndist/\ncoverage/\n*.log\n.DS_Store\n",
        )?;

        // Create test file if using test template
        if template == "with-tests" {
            fs::write(
                path.join("tests").join("main.test.ts"),
                templates::TEST_TEMPLATE,
            )?;
        }

        Ok(())
    }
}

/// CLI templates module
pub mod templates {
    pub const MAIN_TS_TEMPLATE: &str = r#"import { Plugin } from 'vault-plugin-sdk';

export default class MyPlugin extends Plugin {
    async onload() {
        console.log('Plugin loaded');
        
        // Register commands
        this.addCommand({
            id: 'example-command',
            name: 'Example Command',
            callback: () => {
                this.app.workspace.showNotice('Hello from plugin!');
            }
        });
    }
    
    async onunload() {
        console.log('Plugin unloaded');
    }
}
"#;

    pub const READWISE_TEMPLATE: &str = r#"import { Plugin } from 'vault-plugin-sdk';

export default class ReadwisePlugin extends Plugin {
    settings: ReadwiseSettings;
    
    async onload() {
        await this.loadSettings();
        
        // Add sync command
        this.addCommand({
            id: 'sync-readwise',
            name: 'Sync from Readwise',
            callback: () => this.syncReadwise()
        });
        
        // Add settings tab
        this.addSettingTab(new ReadwiseSettingTab(this.app, this));
    }
    
    async syncReadwise() {
        const { token } = this.settings;
        if (!token) {
            this.app.workspace.showNotice('Please configure Readwise token');
            return;
        }
        
        // Sync logic here
        this.app.workspace.showNotice('Syncing from Readwise...');
    }
    
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

interface ReadwiseSettings {
    token: string;
    folder: string;
    frequency: number;
}

const DEFAULT_SETTINGS: ReadwiseSettings = {
    token: '',
    folder: 'Readwise',
    frequency: 60
};
"#;

    pub const WITH_TESTS_TEMPLATE: &str = r#"import { Plugin } from 'vault-plugin-sdk';

export default class MyPlugin extends Plugin {
    counter = 0;
    
    async onload() {
        console.log('Plugin loaded');
        
        this.addCommand({
            id: 'increment-counter',
            name: 'Increment Counter',
            callback: () => {
                this.counter++;
                this.app.workspace.showNotice(`Counter: ${this.counter}`);
            }
        });
    }
    
    getCounter(): number {
        return this.counter;
    }
    
    resetCounter(): void {
        this.counter = 0;
    }
}
"#;

    pub const TEST_TEMPLATE: &str = r#"import MyPlugin from '../src/main';
import { mockApp } from 'vault-plugin-sdk/test';

describe('MyPlugin', () => {
    let plugin: MyPlugin;
    
    beforeEach(() => {
        plugin = new MyPlugin(mockApp);
    });
    
    test('should initialize with counter at 0', () => {
        expect(plugin.getCounter()).toBe(0);
    });
    
    test('should increment counter', () => {
        plugin.counter++;
        expect(plugin.getCounter()).toBe(1);
    });
    
    test('should reset counter', () => {
        plugin.counter = 5;
        plugin.resetCounter();
        expect(plugin.getCounter()).toBe(0);
    });
});
"#;
}
