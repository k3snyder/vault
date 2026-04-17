// TypeScript Definitions Generator - Generates complete API type definitions for plugin development
// Provides TypeScript types, interfaces, and documentation for all plugin APIs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[cfg(test)]
mod tests;

mod api_definitions;

/// TypeScript generator errors
#[derive(Debug, thiserror::Error)]
pub enum TypeScriptError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Invalid TypeScript syntax: {0}")]
    InvalidSyntax(String),

    #[error("Generation failed: {0}")]
    GenerationFailed(String),
}

/// API structure definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiStructure {
    pub name: String,
    pub version: String,
    pub modules: Vec<ApiModule>,
}

/// API module definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiModule {
    pub name: String,
    pub description: String,
    pub methods: Vec<ApiMethod>,
    pub interfaces: Vec<InterfaceDefinition>,
    pub types: Vec<TypeAlias>,
}

/// API method definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiMethod {
    pub name: String,
    pub description: String,
    pub params: Vec<ApiParam>,
    pub returns: String,
    pub permissions: Vec<String>,
}

/// API parameter definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiParam {
    pub name: String,
    pub type_def: String,
    pub required: bool,
    pub description: String,
}

/// Interface definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceDefinition {
    pub name: String,
    pub description: String,
    pub properties: Vec<PropertyDefinition>,
}

/// Property definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyDefinition {
    pub name: String,
    pub type_def: String,
    pub optional: bool,
    pub description: String,
}

/// Type alias
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeAlias {
    pub name: String,
    pub type_def: String,
    pub description: String,
}

/// Enum definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnumDefinition {
    pub name: String,
    pub description: String,
    pub values: Vec<EnumValue>,
}

/// Enum value
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnumValue {
    pub name: String,
    pub value: String,
    pub description: String,
}

/// JSDoc comment
#[derive(Debug, Clone)]
pub struct JsDocComment {
    pub description: String,
    pub params: Vec<JsDocParam>,
    pub returns: Option<String>,
    pub example: Option<String>,
    pub deprecated: bool,
    pub since: Option<String>,
}

/// JSDoc parameter
#[derive(Debug, Clone)]
pub struct JsDocParam {
    pub name: String,
    pub type_def: String,
    pub description: String,
}

/// Main TypeScript generator
pub struct TypeScriptGenerator {
    version: String,
}

impl TypeScriptGenerator {
    /// Create new generator
    pub fn new() -> Self {
        Self {
            version: "1.0.0".to_string(),
        }
    }

    /// Get version
    pub fn get_version(&self) -> &str {
        &self.version
    }

    /// Generate interface definition
    pub fn generate_interface(&self, interface: &InterfaceDefinition) -> String {
        let mut result = String::new();

        // Add JSDoc
        result.push_str(&format!("/**\n * {}\n */\n", interface.description));

        // Interface declaration
        result.push_str(&format!("export interface {} {{\n", interface.name));

        // Properties
        for prop in &interface.properties {
            result.push_str(&format!("    /** {} */\n", prop.description));
            let optional = if prop.optional { "?" } else { "" };
            result.push_str(&format!(
                "    {}{}: {};\n",
                prop.name, optional, prop.type_def
            ));
        }

        result.push_str("}\n");
        result
    }

    /// Generate type alias
    pub fn generate_type_alias(&self, type_alias: &TypeAlias) -> String {
        format!(
            "/** {} */\nexport type {} = {};\n",
            type_alias.description, type_alias.name, type_alias.type_def
        )
    }

    /// Generate enum
    pub fn generate_enum(&self, enum_def: &EnumDefinition) -> String {
        let mut result = String::new();

        // Add JSDoc
        result.push_str(&format!("/**\n * {}\n */\n", enum_def.description));

        // Enum declaration
        result.push_str(&format!("export enum {} {{\n", enum_def.name));

        // Values
        for value in &enum_def.values {
            result.push_str(&format!("    /** {} */\n", value.description));
            result.push_str(&format!("    {} = \"{}\",\n", value.name, value.value));
        }

        result.push_str("}\n");
        result
    }

    /// Generate method signature
    pub fn generate_method_signature(&self, method: &ApiMethod) -> String {
        let params: Vec<String> = method
            .params
            .iter()
            .map(|p| {
                let optional = if !p.required { "?" } else { "" };
                format!("{}{}: {}", p.name, optional, p.type_def)
            })
            .collect();

        format!("{}({}): {}", method.name, params.join(", "), method.returns)
    }

    /// Generate JSDoc comment
    pub fn generate_jsdoc(&self, jsdoc: &JsDocComment) -> String {
        let mut result = String::new();

        result.push_str("/**\n");
        result.push_str(&format!(" * {}\n", jsdoc.description));

        // Parameters
        for param in &jsdoc.params {
            result.push_str(&format!(
                " * @param {{{}}} {} - {}\n",
                param.type_def, param.name, param.description
            ));
        }

        // Returns
        if let Some(ref returns) = jsdoc.returns {
            result.push_str(&format!(" * @returns {}\n", returns));
        }

        // Example
        if let Some(ref example) = jsdoc.example {
            result.push_str(" * @example\n");
            for line in example.lines() {
                result.push_str(&format!(" * {}\n", line));
            }
        }

        // Since
        if let Some(ref since) = jsdoc.since {
            result.push_str(&format!(" * @since {}\n", since));
        }

        // Deprecated
        if jsdoc.deprecated {
            result.push_str(" * @deprecated\n");
        }

        result.push_str(" */\n");
        result
    }

    /// Generate module types
    pub async fn generate_module_types(
        &self,
        module: &ApiModule,
    ) -> Result<String, TypeScriptError> {
        let mut result = String::new();

        // Module interface
        result.push_str(&format!("/**\n * {}\n */\n", module.description));
        result.push_str(&format!(
            "export interface {}API {{\n",
            module
                .name
                .chars()
                .next()
                .unwrap()
                .to_uppercase()
                .to_string()
                + &module.name[1..]
        ));

        // Methods
        for method in &module.methods {
            // JSDoc
            let jsdoc = JsDocComment {
                description: method.description.clone(),
                params: method
                    .params
                    .iter()
                    .map(|p| JsDocParam {
                        name: p.name.clone(),
                        type_def: p.type_def.clone(),
                        description: p.description.clone(),
                    })
                    .collect(),
                returns: Some(format!("Returns {}", method.returns)),
                example: None,
                deprecated: false,
                since: None,
            };

            result.push_str(&self.generate_jsdoc(&jsdoc));
            result.push_str(&format!(
                "    {}: {};\n",
                method.name,
                self.generate_method_signature(method)
            ));
        }

        result.push_str("}\n\n");

        // Interfaces
        for interface in &module.interfaces {
            result.push_str(&self.generate_interface(interface));
            result.push_str("\n");
        }

        // Type aliases
        for type_alias in &module.types {
            result.push_str(&self.generate_type_alias(type_alias));
            result.push_str("\n");
        }

        Ok(result)
    }

    /// Generate manifest types
    pub async fn generate_manifest_types(&self) -> Result<String, TypeScriptError> {
        Ok(r#"/**
 * Plugin manifest definition
 */
export interface PluginManifest {
    /** Unique plugin identifier */
    id: string;
    
    /** Human-readable plugin name */
    name: string;
    
    /** Plugin version (semver) */
    version: string;
    
    /** Plugin description */
    description: string;
    
    /** Plugin author */
    author: string;
    
    /** Minimum API version required */
    minApiVersion: string;
    
    /** Required permissions */
    permissions: string[];
    
    /** Entry point file */
    entryPoint: string;
    
    /** Optional repository URL */
    repository?: string;
    
    /** Optional homepage URL */
    homepage?: string;
}
"#
        .to_string())
    }

    /// Generate plugin base class
    pub async fn generate_plugin_base_class(&self) -> Result<String, TypeScriptError> {
        Ok(r#"/**
 * Base class for all Vault plugins
 */
export abstract class Plugin {
    /** Plugin manifest */
    public manifest: PluginManifest;
    
    /** Application instance */
    protected app: App;
    
    constructor(app: App, manifest: PluginManifest) {
        this.app = app;
        this.manifest = manifest;
    }
    
    /**
     * Called when plugin is loaded
     */
    abstract onload(): Promise<void>;
    
    /**
     * Called when plugin is unloaded
     */
    abstract onunload(): void;
    
    /**
     * Register a command
     */
    protected addCommand(command: Command): void {
        this.app.commands.register(command);
    }
    
    /**
     * Register a settings tab
     */
    protected addSettingTab(tab: SettingTab): void {
        this.app.settings.addTab(tab);
    }
}
"#
        .to_string())
    }

    /// Validate TypeScript syntax
    pub async fn validate_typescript(&self, content: &str) -> Result<(), TypeScriptError> {
        // Basic validation - check for common syntax errors
        let mut brace_count = 0;
        let mut in_string = false;
        let mut escape_next = false;

        for ch in content.chars() {
            if escape_next {
                escape_next = false;
                continue;
            }

            match ch {
                '\\' if in_string => escape_next = true,
                '"' | '\'' | '`' => in_string = !in_string,
                '{' if !in_string => brace_count += 1,
                '}' if !in_string => brace_count -= 1,
                _ => {}
            }
        }

        if brace_count != 0 {
            return Err(TypeScriptError::InvalidSyntax(
                "Unmatched braces".to_string(),
            ));
        }

        if in_string {
            return Err(TypeScriptError::InvalidSyntax(
                "Unclosed string".to_string(),
            ));
        }

        // Check for missing types in interface
        if content.contains("interface") && content.contains("value  //") {
            return Err(TypeScriptError::InvalidSyntax(
                "Missing type definition".to_string(),
            ));
        }

        Ok(())
    }

    /// Export type definitions
    pub async fn export_definitions(
        &self,
        api: &ApiStructure,
        output_path: &Path,
    ) -> Result<(), TypeScriptError> {
        let mut content = String::new();

        // Module declaration
        content.push_str(&format!("/**\n * Vault Plugin API v{}\n */\n", api.version));
        content.push_str("declare module 'vault-plugin' {\n");

        // Generate types for each module
        for module in &api.modules {
            let module_types = self.generate_module_types(module).await?;
            content.push_str(&module_types);
        }

        // Manifest types
        content.push_str(&self.generate_manifest_types().await?);

        // Plugin base class
        content.push_str(&self.generate_plugin_base_class().await?);

        content.push_str("}\n");

        // Write to file
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, content)?;

        Ok(())
    }

    /// Export ambient declarations
    pub async fn export_ambient_declarations(
        &self,
        output_path: &Path,
    ) -> Result<(), TypeScriptError> {
        let content = r#"/**
 * Global ambient declarations for Vault plugins
 */
declare global {
    interface Window {
        vault: VaultAPI;
        workspace: WorkspaceAPI;
        settings: SettingsAPI;
        mcp: McpAPI;
        network: NetworkAPI;
    }
}

export {};
"#;

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, content)?;

        Ok(())
    }

    /// Generate migration guide
    pub async fn generate_migration_guide(
        &self,
        from_platform: &str,
    ) -> Result<String, TypeScriptError> {
        match from_platform {
            "obsidian" => Ok(self.generate_obsidian_migration_guide()),
            _ => Err(TypeScriptError::GenerationFailed(format!(
                "Unknown platform: {}",
                from_platform
            ))),
        }
    }

    fn generate_obsidian_migration_guide(&self) -> String {
        r#"# Migration from Obsidian to Vault Plugins

## API Differences

### File Operations
```typescript
// Obsidian
await this.app.vault.read(file);
await this.app.vault.modify(file, content);

// Vault
await this.app.vault.readFile(path);
await this.app.vault.writeFile(path, content);
```

### Workspace
```typescript
// Obsidian
this.app.workspace.getActiveViewOfType(MarkdownView);

// Vault
this.app.workspace.getActiveView();
```

### Settings
```typescript
// Obsidian
await this.loadData();
await this.saveData(data);

// Vault
await this.app.settings.get('key');
await this.app.settings.set('key', value);
```

## Permission Model
Vault uses a granular permission system. Add required permissions to manifest:
```json
{
    "permissions": ["vault:read", "vault:write", "workspace:modify"]
}
```

## Manifest Changes
- `minAppVersion` → `minApiVersion`
- Add `permissions` array
- `main` → `entryPoint`
"#
        .to_string()
    }

    /// Generate tsconfig.json
    pub async fn generate_tsconfig(&self, output_path: &Path) -> Result<(), TypeScriptError> {
        let config = serde_json::json!({
            "compilerOptions": {
                "target": "ES2020",
                "module": "ESNext",
                "lib": ["ES2020", "DOM"],
                "strict": true,
                "esModuleInterop": true,
                "skipLibCheck": true,
                "forceConsistentCasingInFileNames": true,
                "moduleResolution": "node",
                "resolveJsonModule": true,
                "declaration": true,
                "declarationMap": true,
                "sourceMap": true,
                "outDir": "./dist",
                "rootDir": "./src",
                "types": ["vault-plugin"]
            },
            "include": ["src/**/*"],
            "exclude": ["node_modules", "dist"]
        });

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, serde_json::to_string_pretty(&config)?)?;

        Ok(())
    }

    /// Generate package.json with types
    pub async fn generate_package_json(&self, output_path: &Path) -> Result<(), TypeScriptError> {
        let package = serde_json::json!({
            "name": "@vault/plugin-types",
            "version": self.version,
            "description": "TypeScript type definitions for Vault plugins",
            "types": "index.d.ts",
            "files": ["*.d.ts", "README.md"],
            "keywords": ["vault", "plugin", "types", "typescript"],
            "license": "MIT",
            "devDependencies": {
                "typescript": "^5.0.0"
            }
        });

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, serde_json::to_string_pretty(&package)?)?;

        Ok(())
    }

    /// Generate complete type package
    pub async fn generate_type_package(
        &self,
        api: &ApiStructure,
        output_dir: &Path,
    ) -> Result<(), TypeScriptError> {
        // Create directory
        fs::create_dir_all(output_dir)?;

        // Generate type definitions
        self.export_definitions(api, &output_dir.join("index.d.ts"))
            .await?;

        // Generate ambient declarations
        self.export_ambient_declarations(&output_dir.join("global.d.ts"))
            .await?;

        // Generate tsconfig.json
        self.generate_tsconfig(&output_dir.join("tsconfig.json"))
            .await?;

        // Generate package.json
        self.generate_package_json(&output_dir.join("package.json"))
            .await?;

        // Generate README
        let readme = format!(
            "# Vault Plugin Type Definitions\n\nVersion: {}\n\n## Installation\n\n```bash\nnpm install @vault/plugin-types\n```\n\n## Usage\n\n```typescript\nimport {{ Plugin, PluginManifest }} from '@vault/plugin-types';\n```\n",
            api.version
        );
        fs::write(output_dir.join("README.md"), readme)?;

        Ok(())
    }

    /// Generate types from API structure
    pub async fn generate_types(&self, api: &ApiStructure) -> Result<String, TypeScriptError> {
        let mut result = String::new();

        result.push_str(&format!("/**\n * @version {}\n */\n", api.version));

        for module in &api.modules {
            result.push_str(&self.generate_module_types(module).await?);
        }

        Ok(result)
    }

    /// Generate VS Code settings
    pub async fn generate_vscode_settings(&self, vscode_dir: &Path) -> Result<(), TypeScriptError> {
        fs::create_dir_all(vscode_dir)?;

        let settings = serde_json::json!({
            "typescript.tsdk": "node_modules/typescript/lib",
            "typescript.enablePromptUseWorkspaceTsdk": true,
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
                "source.organizeImports": true
            }
        });

        fs::write(
            vscode_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings)?,
        )?;

        Ok(())
    }

    /// Generate code snippets
    pub async fn generate_snippets(&self) -> Result<String, TypeScriptError> {
        Ok(r#"{
    "Vault Plugin": {
        "prefix": "vault-plugin",
        "body": [
            "import { Plugin, PluginManifest } from 'vault-plugin';",
            "",
            "export default class ${1:MyPlugin} extends Plugin {",
            "    async onload() {",
            "        console.log('Loading ${1:MyPlugin}');",
            "        $0",
            "    }",
            "",
            "    onunload() {",
            "        console.log('Unloading ${1:MyPlugin}');",
            "    }",
            "}"
        ],
        "description": "Create a new Vault plugin"
    }
}"#
        .to_string())
    }
}
