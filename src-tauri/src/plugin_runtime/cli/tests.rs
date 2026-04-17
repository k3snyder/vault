// CLI Tool Tests - Test-driven development for vault-plugin CLI
// Tests all CLI commands for plugin development workflow

use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

#[cfg(test)]
mod cli_tests {
    use super::*;

    // Helper function to create a temporary directory for testing
    fn create_temp_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp dir")
    }

    // Helper to run CLI command and capture output
    async fn run_command(args: Vec<&str>) -> Result<CommandOutput, CliError> {
        let cli = VaultPluginCli::new();
        cli.run(args).await
    }

    mod create_command {
        use super::*;

        #[tokio::test]
        async fn test_create_basic_plugin() {
            let temp_dir = create_temp_dir();
            let plugin_name = "test-plugin";
            let plugin_path = temp_dir.path().join(plugin_name);

            let result = run_command(vec![
                "create",
                plugin_name,
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await;

            assert!(result.is_ok());

            // Check that plugin directory was created
            assert!(plugin_path.exists());

            // Check for essential files
            assert!(plugin_path.join("manifest.json").exists());
            assert!(plugin_path.join("src").join("main.ts").exists());
            assert!(plugin_path.join("package.json").exists());
            assert!(plugin_path.join("tsconfig.json").exists());
            assert!(plugin_path.join("README.md").exists());
            assert!(plugin_path.join(".gitignore").exists());
        }

        #[tokio::test]
        async fn test_create_with_template() {
            let temp_dir = create_temp_dir();
            let plugin_name = "test-plugin";

            let result = run_command(vec![
                "create",
                plugin_name,
                "--path",
                temp_dir.path().to_str().unwrap(),
                "--template",
                "readwise",
            ])
            .await;

            assert!(result.is_ok());

            let manifest_path = temp_dir.path().join(plugin_name).join("manifest.json");
            let manifest = fs::read_to_string(manifest_path).unwrap();

            // Check that template was applied
            assert!(manifest.contains("readwise"));
        }

        #[tokio::test]
        async fn test_create_with_invalid_name() {
            let temp_dir = create_temp_dir();

            // Invalid names should be rejected
            let invalid_names = vec![
                "123-start-with-number",
                "has spaces",
                "has/slash",
                "has\\backslash",
                ".hidden",
                "",
            ];

            for name in invalid_names {
                let result = run_command(vec![
                    "create",
                    name,
                    "--path",
                    temp_dir.path().to_str().unwrap(),
                ])
                .await;

                assert!(result.is_err());
                assert!(matches!(
                    result.unwrap_err(),
                    CliError::InvalidPluginName(_)
                ));
            }
        }

        #[tokio::test]
        async fn test_create_overwrites_with_force() {
            let temp_dir = create_temp_dir();
            let plugin_name = "test-plugin";
            let plugin_path = temp_dir.path().join(plugin_name);

            // Create first time
            run_command(vec![
                "create",
                plugin_name,
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            // Try to create again without force (should fail)
            let result = run_command(vec![
                "create",
                plugin_name,
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await;

            assert!(result.is_err());

            // Create with force (should succeed)
            let result = run_command(vec![
                "create",
                plugin_name,
                "--path",
                temp_dir.path().to_str().unwrap(),
                "--force",
            ])
            .await;

            assert!(result.is_ok());
        }
    }

    mod dev_command {
        use super::*;

        #[tokio::test]
        async fn test_dev_server_starts() {
            let temp_dir = create_temp_dir();

            // First create a plugin
            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Start dev server
            let result = run_command(vec![
                "dev",
                "--path",
                plugin_path.to_str().unwrap(),
                "--port",
                "0",         // Use random port
                "--no-open", // Don't open browser
            ])
            .await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::DevServer { port, .. }) = result {
                assert!(port > 0);
            } else {
                panic!("Expected DevServer output");
            }
        }

        #[tokio::test]
        async fn test_dev_with_hot_reload() {
            let temp_dir = create_temp_dir();

            // Create plugin
            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Start with hot reload
            let result = run_command(vec![
                "dev",
                "--path",
                plugin_path.to_str().unwrap(),
                "--hot-reload",
                "--port",
                "0",
            ])
            .await;

            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_dev_with_mock_permissions() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Start with mock permissions
            let result = run_command(vec![
                "dev",
                "--path",
                plugin_path.to_str().unwrap(),
                "--mock-permissions",
                "vault:read,workspace:create",
                "--port",
                "0",
            ])
            .await;

            assert!(result.is_ok());
        }
    }

    mod build_command {
        use super::*;

        #[tokio::test]
        async fn test_build_production() {
            let temp_dir = create_temp_dir();

            // Create plugin
            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Build for production
            let result = run_command(vec!["build", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            // Check build output
            let dist_path = plugin_path.join("dist");
            assert!(dist_path.exists());
            assert!(dist_path.join("main.js").exists());
            assert!(dist_path.join("manifest.json").exists());

            // Check that output is minified
            let main_js = fs::read_to_string(dist_path.join("main.js")).unwrap();
            assert!(!main_js.contains("\n\n")); // Minified code shouldn't have double newlines
        }

        #[tokio::test]
        async fn test_build_with_source_maps() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Build with source maps
            let result = run_command(vec![
                "build",
                "--path",
                plugin_path.to_str().unwrap(),
                "--source-maps",
            ])
            .await;

            assert!(result.is_ok());

            // Check for source map files
            let dist_path = plugin_path.join("dist");
            assert!(dist_path.join("main.js.map").exists());
        }

        #[tokio::test]
        async fn test_build_package() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Build and package
            let result = run_command(vec![
                "build",
                "--path",
                plugin_path.to_str().unwrap(),
                "--package",
            ])
            .await;

            assert!(result.is_ok());

            // Check for package file
            assert!(plugin_path.join("test-plugin.vault-plugin").exists());
        }
    }

    mod lint_command {
        use super::*;

        #[tokio::test]
        async fn test_lint_valid_plugin() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Lint should pass for newly created plugin
            let result = run_command(vec!["lint", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Lint { issues, .. }) = result {
                assert_eq!(issues.len(), 0);
            }
        }

        #[tokio::test]
        async fn test_lint_invalid_manifest() {
            let temp_dir = create_temp_dir();
            let plugin_path = temp_dir.path().join("test-plugin");
            fs::create_dir_all(&plugin_path).unwrap();

            // Create invalid manifest
            fs::write(
                plugin_path.join("manifest.json"),
                r#"{
                    "id": "",
                    "name": "Test Plugin",
                    "version": "not-semver"
                }"#,
            )
            .unwrap();

            let result = run_command(vec!["lint", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Lint { issues, .. }) = result {
                assert!(issues.len() > 0);
                assert!(issues.iter().any(|i| i.severity == LintSeverity::Error));
            }
        }

        #[tokio::test]
        async fn test_lint_security_issues() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Add code with security issues
            fs::write(
                plugin_path.join("src").join("evil.ts"),
                r#"
                // Using eval (security issue)
                eval("alert('evil')");
                
                // Accessing Node.js APIs (not allowed)
                const fs = require('fs');
                
                // Using innerHTML (XSS risk)
                element.innerHTML = userInput;
                "#,
            )
            .unwrap();

            let result = run_command(vec![
                "lint",
                "--path",
                plugin_path.to_str().unwrap(),
                "--security",
            ])
            .await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Lint { issues, .. }) = result {
                assert!(issues
                    .iter()
                    .any(|i| i.severity == LintSeverity::Error && i.message.contains("eval")));
            }
        }
    }

    mod test_command {
        use super::*;

        #[tokio::test]
        async fn test_run_plugin_tests() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
                "--template",
                "with-tests",
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Run tests
            let result = run_command(vec!["test", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Test { passed, failed, .. }) = result {
                assert!(passed > 0);
                assert_eq!(failed, 0);
            }
        }

        #[tokio::test]
        async fn test_with_coverage() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Run with coverage
            let result = run_command(vec![
                "test",
                "--path",
                plugin_path.to_str().unwrap(),
                "--coverage",
            ])
            .await;

            assert!(result.is_ok());

            // Check coverage report exists
            assert!(plugin_path.join("coverage").exists());
        }

        #[tokio::test]
        async fn test_watch_mode() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Start in watch mode (will exit immediately in test)
            let result = run_command(vec![
                "test",
                "--path",
                plugin_path.to_str().unwrap(),
                "--watch",
                "--max-runs",
                "1", // Exit after one run for testing
            ])
            .await;

            assert!(result.is_ok());
        }
    }

    mod validate_command {
        use super::*;

        #[tokio::test]
        async fn test_validate_complete_plugin() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Build first
            run_command(vec!["build", "--path", plugin_path.to_str().unwrap()])
                .await
                .unwrap();

            // Validate
            let result =
                run_command(vec!["validate", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Validate { valid, .. }) = result {
                assert!(valid);
            }
        }

        #[tokio::test]
        async fn test_validate_api_compatibility() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            // Modify manifest to require higher API version
            let manifest_path = plugin_path.join("manifest.json");
            let mut manifest: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
            manifest["minApiVersion"] = serde_json::json!("99.0.0");
            fs::write(
                &manifest_path,
                serde_json::to_string_pretty(&manifest).unwrap(),
            )
            .unwrap();

            let result =
                run_command(vec!["validate", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Validate { valid, issues, .. }) = result {
                assert!(!valid);
                assert!(issues.iter().any(|i| i.contains("API version")));
            }
        }
    }

    mod init_command {
        use super::*;

        #[tokio::test]
        async fn test_init_existing_project() {
            let temp_dir = create_temp_dir();
            let project_path = temp_dir.path().join("existing-project");
            fs::create_dir_all(&project_path).unwrap();

            // Create existing package.json
            fs::write(
                project_path.join("package.json"),
                r#"{"name": "existing-project", "version": "1.0.0"}"#,
            )
            .unwrap();

            // Initialize as plugin
            let result = run_command(vec!["init", "--path", project_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            // Check plugin files were added
            assert!(project_path.join("manifest.json").exists());
            assert!(project_path.join("src").join("main.ts").exists());
        }
    }

    mod info_command {
        use super::*;

        #[tokio::test]
        async fn test_show_plugin_info() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "test-plugin",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("test-plugin");

            let result = run_command(vec!["info", "--path", plugin_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Info { manifest, .. }) = result {
                assert_eq!(manifest.id, "test-plugin");
            }
        }
    }

    mod types_command {
        use super::*;

        #[tokio::test]
        async fn test_types_command_generates_files() {
            let temp_dir = create_temp_dir();
            let project_path = temp_dir.path().join("test-project");
            fs::create_dir_all(&project_path).unwrap();

            let result = run_command(vec!["types", project_path.to_str().unwrap()]).await;

            assert!(result.is_ok());

            if let Ok(CommandOutput::Success { message }) = result {
                assert!(message.contains("TypeScript definitions generated successfully"));
                assert!(message.contains("types/index.d.ts"));
                assert!(message.contains("types/global.d.ts"));
                assert!(message.contains(".vscode/settings.json"));
            } else {
                panic!("Expected Success output");
            }

            // Check that files were created
            let types_dir = project_path.join("types");
            assert!(types_dir.join("index.d.ts").exists());
            assert!(types_dir.join("global.d.ts").exists());
            assert!(types_dir.join("tsconfig.json").exists());
            assert!(types_dir.join("package.json").exists());
            assert!(types_dir.join("README.md").exists());

            let vscode_dir = project_path.join(".vscode");
            assert!(vscode_dir.join("settings.json").exists());
            assert!(vscode_dir.join("vault-plugin.code-snippets").exists());

            assert!(project_path.join("MIGRATION.md").exists());
        }

        #[tokio::test]
        async fn test_types_command_uses_current_dir_if_no_path() {
            let temp_dir = create_temp_dir();
            std::env::set_current_dir(temp_dir.path()).unwrap();

            let result = run_command(vec!["types"]).await;

            assert!(result.is_ok());

            // Check that files were created in current directory
            assert!(temp_dir.path().join("types").join("index.d.ts").exists());
            assert!(temp_dir
                .path()
                .join(".vscode")
                .join("settings.json")
                .exists());
        }

        #[tokio::test]
        async fn test_generated_types_contain_apis() {
            let temp_dir = create_temp_dir();
            let project_path = temp_dir.path().join("test-project");
            fs::create_dir_all(&project_path).unwrap();

            run_command(vec!["types", project_path.to_str().unwrap()])
                .await
                .unwrap();

            // Check that generated types contain expected APIs
            let index_content =
                fs::read_to_string(project_path.join("types").join("index.d.ts")).unwrap();
            assert!(index_content.contains("VaultAPI"));
            assert!(index_content.contains("WorkspaceAPI"));
            assert!(index_content.contains("SettingsAPI"));
            assert!(index_content.contains("McpAPI"));
            assert!(index_content.contains("NetworkAPI"));
            assert!(index_content.contains("PluginManifest"));
            assert!(index_content.contains("abstract class Plugin"));
        }

        #[tokio::test]
        async fn test_generated_migration_guide() {
            let temp_dir = create_temp_dir();
            let project_path = temp_dir.path().join("test-project");
            fs::create_dir_all(&project_path).unwrap();

            run_command(vec!["types", project_path.to_str().unwrap()])
                .await
                .unwrap();

            let migration_content = fs::read_to_string(project_path.join("MIGRATION.md")).unwrap();
            assert!(migration_content.contains("Migration from Obsidian"));
            assert!(migration_content.contains("API Differences"));
            assert!(migration_content.contains("// Obsidian"));
            assert!(migration_content.contains("// Vault"));
        }

        #[tokio::test]
        async fn test_generated_vscode_snippets() {
            let temp_dir = create_temp_dir();
            let project_path = temp_dir.path().join("test-project");
            fs::create_dir_all(&project_path).unwrap();

            run_command(vec!["types", project_path.to_str().unwrap()])
                .await
                .unwrap();

            let snippets_content = fs::read_to_string(
                project_path
                    .join(".vscode")
                    .join("vault-plugin.code-snippets"),
            )
            .unwrap();
            assert!(snippets_content.contains("\"Vault Plugin\""));
            assert!(snippets_content.contains("\"prefix\": \"vault-plugin\""));
            assert!(snippets_content.contains("export default class"));
        }
    }

    mod performance {
        use super::*;
        use std::time::Instant;

        #[tokio::test]
        async fn test_create_performance() {
            let temp_dir = create_temp_dir();

            let start = Instant::now();

            let result = run_command(vec![
                "create",
                "perf-test",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await;

            let duration = start.elapsed();

            assert!(result.is_ok());
            // Creating a plugin should be fast
            assert!(duration.as_secs() < 5);
        }

        #[tokio::test]
        async fn test_build_performance() {
            let temp_dir = create_temp_dir();

            run_command(vec![
                "create",
                "build-perf",
                "--path",
                temp_dir.path().to_str().unwrap(),
            ])
            .await
            .unwrap();

            let plugin_path = temp_dir.path().join("build-perf");

            let start = Instant::now();

            let result = run_command(vec!["build", "--path", plugin_path.to_str().unwrap()]).await;

            let duration = start.elapsed();

            assert!(result.is_ok());
            // Build should complete reasonably quickly
            assert!(duration.as_secs() < 30);
        }
    }
}
