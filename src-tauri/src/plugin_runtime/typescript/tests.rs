// TypeScript Definitions Tests
use super::*;
use std::fs;
use tempfile::TempDir;

/// Test helpers
mod helpers {
    use super::*;

    pub fn create_test_api_structure() -> ApiStructure {
        ApiStructure {
            name: "VaultAPI".to_string(),
            version: "1.0.0".to_string(),
            modules: vec![ApiModule {
                name: "vault".to_string(),
                description: "File system operations API".to_string(),
                methods: vec![
                    ApiMethod {
                        name: "readFile".to_string(),
                        description: "Read a file from the vault".to_string(),
                        params: vec![ApiParam {
                            name: "path".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Path to the file".to_string(),
                        }],
                        returns: "Promise<string>".to_string(),
                        permissions: vec!["vault:read".to_string()],
                    },
                    ApiMethod {
                        name: "writeFile".to_string(),
                        description: "Write content to a file".to_string(),
                        params: vec![
                            ApiParam {
                                name: "path".to_string(),
                                type_def: "string".to_string(),
                                required: true,
                                description: "Path to the file".to_string(),
                            },
                            ApiParam {
                                name: "content".to_string(),
                                type_def: "string".to_string(),
                                required: true,
                                description: "Content to write".to_string(),
                            },
                        ],
                        returns: "Promise<void>".to_string(),
                        permissions: vec!["vault:write".to_string()],
                    },
                ],
                interfaces: vec![],
                types: vec![],
            }],
        }
    }
}

// ===== Type Definition Generation Tests =====

#[tokio::test]
async fn test_typescript_generator_creation() {
    let generator = TypeScriptGenerator::new();
    assert_eq!(generator.get_version(), "1.0.0");
}

#[tokio::test]
async fn test_generate_interface() {
    let generator = TypeScriptGenerator::new();

    let interface = InterfaceDefinition {
        name: "FileInfo".to_string(),
        description: "Information about a file".to_string(),
        properties: vec![
            PropertyDefinition {
                name: "path".to_string(),
                type_def: "string".to_string(),
                optional: false,
                description: "File path".to_string(),
            },
            PropertyDefinition {
                name: "size".to_string(),
                type_def: "number".to_string(),
                optional: false,
                description: "File size in bytes".to_string(),
            },
            PropertyDefinition {
                name: "modified".to_string(),
                type_def: "Date".to_string(),
                optional: true,
                description: "Last modified date".to_string(),
            },
        ],
    };

    let result = generator.generate_interface(&interface);
    assert!(result.contains("interface FileInfo"));
    assert!(result.contains("path: string"));
    assert!(result.contains("size: number"));
    assert!(result.contains("modified?: Date"));
}

#[tokio::test]
async fn test_generate_type_alias() {
    let generator = TypeScriptGenerator::new();

    let type_alias = TypeAlias {
        name: "PluginId".to_string(),
        type_def: "string".to_string(),
        description: "Unique identifier for a plugin".to_string(),
    };

    let result = generator.generate_type_alias(&type_alias);
    assert!(result.contains("type PluginId = string"));
    assert!(result.contains("Unique identifier for a plugin"));
}

#[tokio::test]
async fn test_generate_enum() {
    let generator = TypeScriptGenerator::new();

    let enum_def = EnumDefinition {
        name: "PluginStatus".to_string(),
        description: "Current status of a plugin".to_string(),
        values: vec![
            EnumValue {
                name: "Active".to_string(),
                value: "active".to_string(),
                description: "Plugin is running".to_string(),
            },
            EnumValue {
                name: "Inactive".to_string(),
                value: "inactive".to_string(),
                description: "Plugin is stopped".to_string(),
            },
        ],
    };

    let result = generator.generate_enum(&enum_def);
    assert!(result.contains("enum PluginStatus"));
    assert!(result.contains("Active = \"active\""));
    assert!(result.contains("Inactive = \"inactive\""));
}

#[tokio::test]
async fn test_generate_method_signature() {
    let generator = TypeScriptGenerator::new();

    let method = ApiMethod {
        name: "readFile".to_string(),
        description: "Read a file from the vault".to_string(),
        params: vec![ApiParam {
            name: "path".to_string(),
            type_def: "string".to_string(),
            required: true,
            description: "Path to the file".to_string(),
        }],
        returns: "Promise<string>".to_string(),
        permissions: vec!["vault:read".to_string()],
    };

    let result = generator.generate_method_signature(&method);
    assert!(result.contains("readFile(path: string): Promise<string>"));
}

#[tokio::test]
async fn test_generate_jsdoc() {
    let generator = TypeScriptGenerator::new();

    let jsdoc = JsDocComment {
        description: "Read a file from the vault".to_string(),
        params: vec![JsDocParam {
            name: "path".to_string(),
            type_def: "string".to_string(),
            description: "Path to the file".to_string(),
        }],
        returns: Some("The file content".to_string()),
        example: Some("const content = await vault.readFile('notes/test.md');".to_string()),
        deprecated: false,
        since: Some("1.0.0".to_string()),
    };

    let result = generator.generate_jsdoc(&jsdoc);
    assert!(result.contains("/**"));
    assert!(result.contains("@param {string} path"));
    assert!(result.contains("@returns The file content"));
    assert!(result.contains("@example"));
    assert!(result.contains("@since 1.0.0"));
}

// ===== Full API Definition Tests =====

#[tokio::test]
async fn test_generate_vault_api_types() {
    let generator = TypeScriptGenerator::new();
    let api = helpers::create_test_api_structure();

    let result = generator.generate_module_types(&api.modules[0]).await;
    assert!(result.is_ok());

    let types = result.unwrap();
    assert!(types.contains("interface VaultAPI"));
    assert!(types.contains("readFile(path: string): Promise<string>"));
    assert!(types.contains("writeFile(path: string, content: string): Promise<void>"));
}

#[tokio::test]
async fn test_generate_workspace_api_types() {
    let generator = TypeScriptGenerator::new();

    let workspace_module = ApiModule {
        name: "workspace".to_string(),
        description: "Workspace UI manipulation API".to_string(),
        methods: vec![ApiMethod {
            name: "showNotice".to_string(),
            description: "Show a notice to the user".to_string(),
            params: vec![
                ApiParam {
                    name: "message".to_string(),
                    type_def: "string".to_string(),
                    required: true,
                    description: "Notice message".to_string(),
                },
                ApiParam {
                    name: "duration".to_string(),
                    type_def: "number".to_string(),
                    required: false,
                    description: "Duration in milliseconds".to_string(),
                },
            ],
            returns: "void".to_string(),
            permissions: vec!["workspace:modify".to_string()],
        }],
        interfaces: vec![],
        types: vec![],
    };

    let result = generator.generate_module_types(&workspace_module).await;
    assert!(result.is_ok());

    let types = result.unwrap();
    assert!(types.contains("interface WorkspaceAPI"));
    assert!(types.contains("showNotice(message: string, duration?: number): void"));
}

// ===== Plugin Manifest Types Tests =====

#[tokio::test]
async fn test_generate_manifest_types() {
    let generator = TypeScriptGenerator::new();

    let result = generator.generate_manifest_types().await;
    assert!(result.is_ok());

    let types = result.unwrap();
    assert!(types.contains("interface PluginManifest"));
    assert!(types.contains("id: string"));
    assert!(types.contains("name: string"));
    assert!(types.contains("version: string"));
    assert!(types.contains("permissions: string[]"));
}

#[tokio::test]
async fn test_generate_plugin_base_class() {
    let generator = TypeScriptGenerator::new();

    let result = generator.generate_plugin_base_class().await;
    assert!(result.is_ok());

    let class_def = result.unwrap();
    assert!(class_def.contains("abstract class Plugin"));
    assert!(class_def.contains("abstract onload(): Promise<void>"));
    assert!(class_def.contains("abstract onunload(): void"));
    assert!(class_def.contains("protected app: App"));
}

// ===== Type Validation Tests =====

#[tokio::test]
async fn test_validate_typescript_syntax() {
    let generator = TypeScriptGenerator::new();

    let valid_ts = r#"
        interface Test {
            name: string;
            value: number;
        }
    "#;

    let result = generator.validate_typescript(valid_ts).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_validate_invalid_typescript() {
    let generator = TypeScriptGenerator::new();

    let invalid_ts = r#"
        interface Test {
            name: string
            value  // Missing type
        }
    "#;

    let result = generator.validate_typescript(invalid_ts).await;
    assert!(result.is_err());
}

// ===== Type Definition Export Tests =====

#[tokio::test]
async fn test_export_type_definitions() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("vault-plugin.d.ts");

    let generator = TypeScriptGenerator::new();
    let api = helpers::create_test_api_structure();

    let result = generator.export_definitions(&api, &output_path).await;
    assert!(result.is_ok());

    assert!(output_path.exists());
    let content = fs::read_to_string(&output_path).unwrap();
    assert!(content.contains("declare module 'vault-plugin'"));
}

#[tokio::test]
async fn test_export_ambient_declarations() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("global.d.ts");

    let generator = TypeScriptGenerator::new();

    let result = generator.export_ambient_declarations(&output_path).await;
    assert!(result.is_ok());

    assert!(output_path.exists());
    let content = fs::read_to_string(&output_path).unwrap();
    assert!(content.contains("declare global"));
    assert!(content.contains("interface Window"));
}

// ===== Migration Guide Tests =====

#[tokio::test]
async fn test_generate_obsidian_migration_guide() {
    let generator = TypeScriptGenerator::new();

    let result = generator.generate_migration_guide("obsidian").await;
    assert!(result.is_ok());

    let guide = result.unwrap();
    assert!(guide.contains("Migration from Obsidian"));
    assert!(guide.contains("API Differences"));
    assert!(guide.contains("// Obsidian"));
    assert!(guide.contains("// Vault"));
}

// ===== Auto-completion Support Tests =====

#[tokio::test]
async fn test_generate_tsconfig() {
    let temp_dir = TempDir::new().unwrap();
    let tsconfig_path = temp_dir.path().join("tsconfig.json");

    let generator = TypeScriptGenerator::new();

    let result = generator.generate_tsconfig(&tsconfig_path).await;
    assert!(result.is_ok());

    assert!(tsconfig_path.exists());
    let content = fs::read_to_string(&tsconfig_path).unwrap();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert!(json["compilerOptions"]["lib"]
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("ES2020")));
}

#[tokio::test]
async fn test_generate_package_json_types() {
    let temp_dir = TempDir::new().unwrap();
    let package_path = temp_dir.path().join("package.json");

    let generator = TypeScriptGenerator::new();

    let result = generator.generate_package_json(&package_path).await;
    assert!(result.is_ok());

    assert!(package_path.exists());
    let content = fs::read_to_string(&package_path).unwrap();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(json["types"], "index.d.ts");
}

// ===== Complete Type Package Tests =====

#[tokio::test]
async fn test_generate_complete_type_package() {
    let temp_dir = TempDir::new().unwrap();
    let package_dir = temp_dir.path();

    let generator = TypeScriptGenerator::new();
    let api = helpers::create_test_api_structure();

    let result = generator.generate_type_package(&api, package_dir).await;
    assert!(result.is_ok());

    // Check all files are created
    assert!(package_dir.join("index.d.ts").exists());
    assert!(package_dir.join("global.d.ts").exists());
    assert!(package_dir.join("tsconfig.json").exists());
    assert!(package_dir.join("package.json").exists());
    assert!(package_dir.join("README.md").exists());
}

#[tokio::test]
async fn test_type_definition_versioning() {
    let generator = TypeScriptGenerator::new();

    let v1_api = ApiStructure {
        name: "VaultAPI".to_string(),
        version: "1.0.0".to_string(),
        modules: vec![],
    };

    let v2_api = ApiStructure {
        name: "VaultAPI".to_string(),
        version: "2.0.0".to_string(),
        modules: vec![],
    };

    let v1_types = generator.generate_types(&v1_api).await.unwrap();
    let v2_types = generator.generate_types(&v2_api).await.unwrap();

    assert!(v1_types.contains("@version 1.0.0"));
    assert!(v2_types.contains("@version 2.0.0"));
}

// ===== IntelliSense Support Tests =====

#[tokio::test]
async fn test_generate_vscode_settings() {
    let temp_dir = TempDir::new().unwrap();
    let vscode_dir = temp_dir.path().join(".vscode");

    let generator = TypeScriptGenerator::new();

    let result = generator.generate_vscode_settings(&vscode_dir).await;
    assert!(result.is_ok());

    assert!(vscode_dir.join("settings.json").exists());
    let content = fs::read_to_string(vscode_dir.join("settings.json")).unwrap();
    assert!(content.contains("typescript.tsdk"));
}

#[tokio::test]
async fn test_generate_intellisense_snippets() {
    let generator = TypeScriptGenerator::new();

    let result = generator.generate_snippets().await;
    assert!(result.is_ok());

    let snippets = result.unwrap();
    assert!(snippets.contains("\"Vault Plugin\": {"));
    assert!(snippets.contains("\"prefix\": \"vault-plugin\""));
    assert!(snippets.contains("export default class"));
}

// ===== Complete Vault API Tests =====

#[tokio::test]
async fn test_generate_complete_vault_api() {
    let generator = TypeScriptGenerator::new();
    let api = TypeScriptGenerator::create_vault_api_structure();

    // Test that all modules are present
    assert_eq!(api.modules.len(), 5);
    let module_names: Vec<&str> = api.modules.iter().map(|m| m.name.as_str()).collect();
    assert!(module_names.contains(&"vault"));
    assert!(module_names.contains(&"workspace"));
    assert!(module_names.contains(&"settings"));
    assert!(module_names.contains(&"mcp"));
    assert!(module_names.contains(&"network"));
}

#[tokio::test]
async fn test_vault_api_contains_required_methods() {
    let generator = TypeScriptGenerator::new();
    let api = TypeScriptGenerator::create_vault_api_structure();

    let vault_module = api.modules.iter().find(|m| m.name == "vault").unwrap();
    let method_names: Vec<&str> = vault_module
        .methods
        .iter()
        .map(|m| m.name.as_str())
        .collect();

    assert!(method_names.contains(&"readFile"));
    assert!(method_names.contains(&"writeFile"));
    assert!(method_names.contains(&"listFiles"));
    assert!(method_names.contains(&"watchFile"));
}

#[tokio::test]
async fn test_complete_type_package_generation() {
    let temp_dir = TempDir::new().unwrap();
    let package_dir = temp_dir.path().join("vault-types");

    let generator = TypeScriptGenerator::new();
    let api = TypeScriptGenerator::create_vault_api_structure();

    let result = generator.generate_type_package(&api, &package_dir).await;
    assert!(result.is_ok());

    // Verify all required files exist
    assert!(package_dir.join("index.d.ts").exists());
    assert!(package_dir.join("global.d.ts").exists());
    assert!(package_dir.join("tsconfig.json").exists());
    assert!(package_dir.join("package.json").exists());
    assert!(package_dir.join("README.md").exists());

    // Verify index.d.ts contains all APIs
    let index_content = fs::read_to_string(package_dir.join("index.d.ts")).unwrap();
    assert!(index_content.contains("VaultAPI"));
    assert!(index_content.contains("WorkspaceAPI"));
    assert!(index_content.contains("SettingsAPI"));
    assert!(index_content.contains("McpAPI"));
    assert!(index_content.contains("NetworkAPI"));
    assert!(index_content.contains("PluginManifest"));
    assert!(index_content.contains("abstract class Plugin"));
}
