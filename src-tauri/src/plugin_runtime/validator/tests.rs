// Plugin Validator Tests
use super::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

/// Test helpers
mod helpers {
    use super::*;

    pub fn create_test_plugin() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let plugin_path = temp_dir.path().to_path_buf();

        // Create plugin structure
        fs::create_dir_all(plugin_path.join("src")).unwrap();
        fs::create_dir_all(plugin_path.join("dist")).unwrap();

        // Create valid manifest
        let manifest = serde_json::json!({
            "id": "test-plugin",
            "name": "Test Plugin",
            "version": "1.0.0",
            "description": "A test plugin",
            "author": "Test Author",
            "minApiVersion": "1.0.0",
            "permissions": ["vault:read", "workspace:modify"],
            "entryPoint": "dist/main.js"
        });
        fs::write(
            plugin_path.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        // Create source files
        let main_ts = r#"
            export default class TestPlugin {
                onload() {
                    console.log('Plugin loaded');
                }
            }
        "#;
        fs::write(plugin_path.join("src/main.ts"), main_ts).unwrap();

        // Create built files
        fs::write(plugin_path.join("dist/main.js"), "console.log('compiled');").unwrap();

        (temp_dir, plugin_path)
    }

    pub fn create_invalid_manifest_plugin() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let plugin_path = temp_dir.path().to_path_buf();

        // Create invalid manifest (missing required fields)
        let manifest = serde_json::json!({
            "name": "Invalid Plugin"
        });
        fs::write(
            plugin_path.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        (temp_dir, plugin_path)
    }
}

// ===== Manifest Validation Tests =====

#[tokio::test]
async fn test_validator_creation() {
    let validator = PluginValidator::new();
    assert!(validator.get_rules().len() > 0);
}

#[tokio::test]
async fn test_valid_manifest() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.validate_manifest(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.is_valid);
    assert_eq!(report.errors.len(), 0);
    assert_eq!(report.manifest.id, "test-plugin");
}

#[tokio::test]
async fn test_invalid_manifest_missing_fields() {
    let (_temp_dir, plugin_path) = helpers::create_invalid_manifest_plugin();
    let validator = PluginValidator::new();

    let result = validator.validate_manifest(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_valid);
    assert!(report
        .errors
        .iter()
        .any(|e| e.rule == "manifest-required-fields"));
}

#[tokio::test]
async fn test_manifest_version_format() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    let manifest = serde_json::json!({
        "id": "test-plugin",
        "name": "Test Plugin",
        "version": "invalid-version",
        "description": "Test",
        "author": "Test",
        "minApiVersion": "1.0.0",
        "permissions": [],
        "entryPoint": "dist/main.js"
    });
    fs::write(
        plugin_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let validator = PluginValidator::new();
    let result = validator.validate_manifest(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_valid);
    assert!(report
        .errors
        .iter()
        .any(|e| e.rule == "manifest-version-format"));
}

#[tokio::test]
async fn test_manifest_permission_validation() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    let manifest = serde_json::json!({
        "id": "test-plugin",
        "name": "Test Plugin",
        "version": "1.0.0",
        "description": "Test",
        "author": "Test",
        "minApiVersion": "1.0.0",
        "permissions": ["vault:read", "invalid:permission"],
        "entryPoint": "dist/main.js"
    });
    fs::write(
        plugin_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let validator = PluginValidator::new();
    let result = validator.validate_manifest(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.is_valid); // Should be valid, just with warnings
    assert!(report
        .warnings
        .iter()
        .any(|w| w.rule == "manifest-invalid-permission"));
}

// ===== Code Security Analysis Tests =====

#[tokio::test]
async fn test_security_analysis_clean_code() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.analyze_security(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.is_safe);
    assert_eq!(report.violations.len(), 0);
}

#[tokio::test]
async fn test_security_analysis_eval_usage() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let unsafe_code = r#"
        export default class TestPlugin {
            onload() {
                eval('console.log("dangerous")');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), unsafe_code).unwrap();

    let validator = PluginValidator::new();
    let result = validator.analyze_security(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_safe);
    assert!(report.violations.iter().any(|v| v.rule == "no-eval"));
}

#[tokio::test]
async fn test_security_analysis_require_usage() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let unsafe_code = r#"
        const fs = require('fs');
        export default class TestPlugin {
            onload() {
                fs.readFileSync('/etc/passwd');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), unsafe_code).unwrap();

    let validator = PluginValidator::new();
    let result = validator.analyze_security(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_safe);
    assert!(report.violations.iter().any(|v| v.rule == "no-require"));
}

#[tokio::test]
async fn test_security_analysis_innerhtml() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let unsafe_code = r#"
        export default class TestPlugin {
            onload() {
                document.body.innerHTML = userInput;
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), unsafe_code).unwrap();

    let validator = PluginValidator::new();
    let result = validator.analyze_security(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_safe);
    assert!(report.violations.iter().any(|v| v.rule == "no-inner-html"));
}

#[tokio::test]
async fn test_security_analysis_function_constructor() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let unsafe_code = r#"
        export default class TestPlugin {
            onload() {
                const fn = new Function('return 42');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), unsafe_code).unwrap();

    let validator = PluginValidator::new();
    let result = validator.analyze_security(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_safe);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule == "no-function-constructor"));
}

// ===== Dependency Scanning Tests =====

#[tokio::test]
async fn test_dependency_scanning_no_dependencies() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.scan_dependencies(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(report.total_dependencies, 0);
    assert_eq!(report.vulnerabilities.len(), 0);
}

#[tokio::test]
async fn test_dependency_scanning_with_package_json() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    let package_json = serde_json::json!({
        "name": "test-plugin",
        "version": "1.0.0",
        "dependencies": {
            "lodash": "^4.17.21",
            "axios": "^1.0.0"
        },
        "devDependencies": {
            "typescript": "^5.0.0"
        }
    });
    fs::write(
        plugin_path.join("package.json"),
        serde_json::to_string_pretty(&package_json).unwrap(),
    )
    .unwrap();

    let validator = PluginValidator::new();
    let result = validator.scan_dependencies(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(report.total_dependencies, 2);
    assert_eq!(report.dev_dependencies, 1);
}

#[tokio::test]
async fn test_dependency_scanning_vulnerable_package() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    let package_json = serde_json::json!({
        "name": "test-plugin",
        "version": "1.0.0",
        "dependencies": {
            "lodash": "4.17.19" // Known vulnerable version
        }
    });
    fs::write(
        plugin_path.join("package.json"),
        serde_json::to_string_pretty(&package_json).unwrap(),
    )
    .unwrap();

    let validator = PluginValidator::new();
    let result = validator.scan_dependencies(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.vulnerabilities.len() > 0);
    assert!(report.vulnerabilities.iter().any(|v| v.package == "lodash"));
}

// ===== API Compatibility Tests =====

#[tokio::test]
async fn test_api_compatibility_valid() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator
        .check_api_compatibility(&plugin_path, "1.0.0")
        .await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.is_compatible);
    assert_eq!(report.required_version, "1.0.0");
    assert_eq!(report.current_version, "1.0.0");
}

#[tokio::test]
async fn test_api_compatibility_incompatible() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    let manifest = serde_json::json!({
        "id": "test-plugin",
        "name": "Test Plugin",
        "version": "1.0.0",
        "description": "Test",
        "author": "Test",
        "minApiVersion": "2.0.0", // Requires newer API
        "permissions": [],
        "entryPoint": "dist/main.js"
    });
    fs::write(
        plugin_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let validator = PluginValidator::new();
    let result = validator
        .check_api_compatibility(plugin_path, "1.0.0")
        .await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.is_compatible);
    assert_eq!(report.required_version, "2.0.0");
    assert_eq!(report.current_version, "1.0.0");
}

#[tokio::test]
async fn test_api_usage_validation() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let code_with_apis = r#"
        export default class TestPlugin {
            async onload() {
                // Valid API usage
                await this.app.vault.readFile('test.md');
                this.app.workspace.showNotice('Hello');
                
                // Deprecated API usage
                this.app.vault.adapter.read('test.md');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), code_with_apis).unwrap();

    let validator = PluginValidator::new();
    let result = validator.validate_api_usage(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.deprecated_apis.len() > 0);
    assert!(report
        .deprecated_apis
        .iter()
        .any(|api| api.name.contains("adapter")));
}

// ===== Performance Analysis Tests =====

#[tokio::test]
async fn test_performance_analysis() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.analyze_performance(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    let _ = report.bundle_size_kb;
    assert_eq!(report.issues.len(), 0);
}

#[tokio::test]
async fn test_performance_large_bundle() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("dist")).unwrap();

    // Create large bundle file
    let large_content = "x".repeat(1024 * 1024); // 1MB
    fs::write(plugin_path.join("dist/main.js"), large_content).unwrap();

    let validator = PluginValidator::new();
    let result = validator.analyze_performance(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.bundle_size_kb > 1000);
    assert!(report
        .issues
        .iter()
        .any(|i| i.severity == IssueSeverity::Warning));
}

#[tokio::test]
async fn test_performance_sync_operations() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let code_with_sync = r#"
        export default class TestPlugin {
            onload() {
                // Synchronous operations
                for (let i = 0; i < 1000000; i++) {
                    document.createElement('div');
                }
                
                // Blocking operation
                while (Date.now() < endTime) {
                    // Busy wait
                }
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), code_with_sync).unwrap();

    let validator = PluginValidator::new();
    let result = validator.analyze_performance(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.issues.len() > 0);
    assert!(report.issues.iter().any(|i| i.rule == "no-sync-loops"));
}

// ===== Full Validation Tests =====

#[tokio::test]
async fn test_full_validation_valid_plugin() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.validate_plugin(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.overall_valid);
    assert_eq!(report.total_errors, 0);
    assert!(report.score >= 90.0);
}

#[tokio::test]
async fn test_full_validation_with_issues() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    // Create plugin with issues
    let manifest = serde_json::json!({
        "id": "problematic-plugin",
        "name": "Problematic Plugin",
        "version": "1.0.0",
        "description": "Plugin with issues",
        "author": "Test",
        "minApiVersion": "1.0.0",
        "permissions": ["vault:read"],
        "entryPoint": "dist/main.js"
    });
    fs::write(
        plugin_path.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let problematic_code = r#"
        export default class ProblematicPlugin {
            onload() {
                eval('console.log("unsafe")');
                document.body.innerHTML = userInput;
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), problematic_code).unwrap();

    let validator = PluginValidator::new();
    let result = validator.validate_plugin(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(!report.overall_valid);
    assert!(report.total_errors > 0);
    assert!(report.score < 70.0); // Security violations should reduce score
}

// ===== Validation Report Tests =====

#[tokio::test]
async fn test_validation_report_generation() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.validate_plugin(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    let report_text = validator.generate_report(&report).await;

    assert!(report_text.contains("Plugin Validation Report"));
    assert!(report_text.contains("test-plugin"));
    assert!(report_text.contains("PASSED"));
}

#[tokio::test]
async fn test_validation_report_json_format() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin();
    let validator = PluginValidator::new();

    let result = validator.validate_plugin(&plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    let json_report = validator.generate_json_report(&report).await;

    assert!(json_report.is_ok());
    let json = json_report.unwrap();
    assert_eq!(json["plugin_id"], "test-plugin");
    assert_eq!(json["overall_valid"], true);
}

// ===== Custom Rule Tests =====

#[tokio::test]
async fn test_custom_validation_rules() {
    let mut validator = PluginValidator::new();

    // Add custom rule
    validator.add_rule(ValidationRule {
        id: "custom-rule".to_string(),
        name: "Custom Rule".to_string(),
        description: "A custom validation rule".to_string(),
        severity: RuleSeverity::Error,
        category: RuleCategory::Custom,
    });

    assert!(validator.get_rules().iter().any(|r| r.id == "custom-rule"));
}

#[tokio::test]
async fn test_disable_validation_rule() {
    let mut validator = PluginValidator::new();

    // Disable a rule
    validator.disable_rule("no-eval");

    // Test that eval is now allowed
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::create_dir_all(plugin_path.join("src")).unwrap();
    let code_with_eval = r#"
        export default class TestPlugin {
            onload() {
                eval('console.log("allowed")');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), code_with_eval).unwrap();

    let result = validator.analyze_security(plugin_path).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert!(report.is_safe); // Should be safe since rule is disabled
}

// ===== Edge Case Tests =====

#[tokio::test]
async fn test_empty_plugin_directory() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    let validator = PluginValidator::new();
    let result = validator.validate_plugin(plugin_path).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        ValidationError::ManifestNotFound
    ));
}

#[tokio::test]
async fn test_malformed_manifest_json() {
    let temp_dir = TempDir::new().unwrap();
    let plugin_path = temp_dir.path();

    fs::write(plugin_path.join("manifest.json"), "{ invalid json }").unwrap();

    let validator = PluginValidator::new();
    let result = validator.validate_manifest(plugin_path).await;

    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        ValidationError::InvalidJson(_)
    ));
}

#[tokio::test]
async fn test_concurrent_validations() {
    let (_temp_dir1, plugin_path1) = helpers::create_test_plugin();
    let (_temp_dir2, plugin_path2) = helpers::create_test_plugin();

    let validator = PluginValidator::new();

    // Run validations concurrently
    let (result1, result2) = tokio::join!(
        validator.validate_plugin(&plugin_path1),
        validator.validate_plugin(&plugin_path2)
    );

    assert!(result1.is_ok());
    assert!(result2.is_ok());
}
