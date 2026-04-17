// Complete API definitions for Vault Plugin System
// This module defines the complete API surface for TypeScript generation

use super::*;

impl TypeScriptGenerator {
    /// Create complete Vault API structure
    pub fn create_vault_api_structure() -> ApiStructure {
        ApiStructure {
            name: "VaultAPI".to_string(),
            version: "1.0.0".to_string(),
            modules: vec![
                Self::create_vault_module(),
                Self::create_workspace_module(),
                Self::create_settings_module(),
                Self::create_mcp_module(),
                Self::create_network_module(),
            ],
        }
    }

    /// Create Vault API module
    fn create_vault_module() -> ApiModule {
        ApiModule {
            name: "vault".to_string(),
            description: "File system operations and vault management".to_string(),
            methods: vec![
                ApiMethod {
                    name: "readFile".to_string(),
                    description: "Read a file from the vault".to_string(),
                    params: vec![ApiParam {
                        name: "path".to_string(),
                        type_def: "string".to_string(),
                        required: true,
                        description: "Path to the file relative to vault root".to_string(),
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
                            description: "Content to write to the file".to_string(),
                        },
                    ],
                    returns: "Promise<void>".to_string(),
                    permissions: vec!["vault:write".to_string()],
                },
                ApiMethod {
                    name: "listFiles".to_string(),
                    description: "List files in a directory".to_string(),
                    params: vec![ApiParam {
                        name: "path".to_string(),
                        type_def: "string".to_string(),
                        required: false,
                        description: "Directory path (default: vault root)".to_string(),
                    }],
                    returns: "Promise<FileInfo[]>".to_string(),
                    permissions: vec!["vault:read".to_string()],
                },
                ApiMethod {
                    name: "watchFile".to_string(),
                    description: "Watch a file for changes".to_string(),
                    params: vec![
                        ApiParam {
                            name: "path".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Path to watch".to_string(),
                        },
                        ApiParam {
                            name: "callback".to_string(),
                            type_def: "(event: FileChangeEvent) => void".to_string(),
                            required: true,
                            description: "Callback for file changes".to_string(),
                        },
                    ],
                    returns: "Promise<WatchHandle>".to_string(),
                    permissions: vec!["vault:read".to_string()],
                },
            ],
            interfaces: vec![
                InterfaceDefinition {
                    name: "FileInfo".to_string(),
                    description: "Information about a file or directory".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "path".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "Full path to the file".to_string(),
                        },
                        PropertyDefinition {
                            name: "name".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "File name".to_string(),
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
                            optional: false,
                            description: "Last modified timestamp".to_string(),
                        },
                        PropertyDefinition {
                            name: "isDirectory".to_string(),
                            type_def: "boolean".to_string(),
                            optional: false,
                            description: "Whether this is a directory".to_string(),
                        },
                    ],
                },
                InterfaceDefinition {
                    name: "FileChangeEvent".to_string(),
                    description: "File change event data".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "path".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "Path that changed".to_string(),
                        },
                        PropertyDefinition {
                            name: "type".to_string(),
                            type_def: "FileChangeType".to_string(),
                            optional: false,
                            description: "Type of change".to_string(),
                        },
                    ],
                },
                InterfaceDefinition {
                    name: "WatchHandle".to_string(),
                    description: "Handle for file watching operations".to_string(),
                    properties: vec![PropertyDefinition {
                        name: "unwatch".to_string(),
                        type_def: "() => void".to_string(),
                        optional: false,
                        description: "Stop watching the file".to_string(),
                    }],
                },
            ],
            types: vec![TypeAlias {
                name: "FileChangeType".to_string(),
                type_def: "'created' | 'modified' | 'deleted'".to_string(),
                description: "Types of file changes".to_string(),
            }],
        }
    }

    /// Create Workspace API module
    fn create_workspace_module() -> ApiModule {
        ApiModule {
            name: "workspace".to_string(),
            description: "UI manipulation and workspace management".to_string(),
            methods: vec![
                ApiMethod {
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
                            description: "Duration in milliseconds (default: 3000)".to_string(),
                        },
                    ],
                    returns: "void".to_string(),
                    permissions: vec!["workspace:modify".to_string()],
                },
                ApiMethod {
                    name: "createView".to_string(),
                    description: "Create a new view in the workspace".to_string(),
                    params: vec![
                        ApiParam {
                            name: "viewType".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Type of view to create".to_string(),
                        },
                        ApiParam {
                            name: "options".to_string(),
                            type_def: "ViewOptions".to_string(),
                            required: false,
                            description: "View configuration options".to_string(),
                        },
                    ],
                    returns: "Promise<View>".to_string(),
                    permissions: vec!["workspace:modify".to_string()],
                },
                ApiMethod {
                    name: "getActiveView".to_string(),
                    description: "Get the currently active view".to_string(),
                    params: vec![],
                    returns: "View | null".to_string(),
                    permissions: vec!["workspace:read".to_string()],
                },
                ApiMethod {
                    name: "addStatusBarItem".to_string(),
                    description: "Add an item to the status bar".to_string(),
                    params: vec![
                        ApiParam {
                            name: "text".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Status bar text".to_string(),
                        },
                        ApiParam {
                            name: "onClick".to_string(),
                            type_def: "() => void".to_string(),
                            required: false,
                            description: "Click handler".to_string(),
                        },
                    ],
                    returns: "StatusBarItem".to_string(),
                    permissions: vec!["workspace:modify".to_string()],
                },
            ],
            interfaces: vec![
                InterfaceDefinition {
                    name: "ViewOptions".to_string(),
                    description: "Options for creating views".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "title".to_string(),
                            type_def: "string".to_string(),
                            optional: true,
                            description: "View title".to_string(),
                        },
                        PropertyDefinition {
                            name: "position".to_string(),
                            type_def: "ViewPosition".to_string(),
                            optional: true,
                            description: "View position".to_string(),
                        },
                    ],
                },
                InterfaceDefinition {
                    name: "View".to_string(),
                    description: "Workspace view".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "id".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "View identifier".to_string(),
                        },
                        PropertyDefinition {
                            name: "title".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "View title".to_string(),
                        },
                        PropertyDefinition {
                            name: "close".to_string(),
                            type_def: "() => void".to_string(),
                            optional: false,
                            description: "Close the view".to_string(),
                        },
                    ],
                },
                InterfaceDefinition {
                    name: "StatusBarItem".to_string(),
                    description: "Status bar item".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "setText".to_string(),
                            type_def: "(text: string) => void".to_string(),
                            optional: false,
                            description: "Update the text".to_string(),
                        },
                        PropertyDefinition {
                            name: "remove".to_string(),
                            type_def: "() => void".to_string(),
                            optional: false,
                            description: "Remove from status bar".to_string(),
                        },
                    ],
                },
            ],
            types: vec![TypeAlias {
                name: "ViewPosition".to_string(),
                type_def: "'left' | 'right' | 'bottom' | 'main'".to_string(),
                description: "View position in workspace".to_string(),
            }],
        }
    }

    /// Create Settings API module
    fn create_settings_module() -> ApiModule {
        ApiModule {
            name: "settings".to_string(),
            description: "Plugin settings and persistent storage".to_string(),
            methods: vec![
                ApiMethod {
                    name: "get".to_string(),
                    description: "Get a setting value".to_string(),
                    params: vec![ApiParam {
                        name: "key".to_string(),
                        type_def: "string".to_string(),
                        required: true,
                        description: "Setting key".to_string(),
                    }],
                    returns: "Promise<any>".to_string(),
                    permissions: vec!["settings:read".to_string()],
                },
                ApiMethod {
                    name: "set".to_string(),
                    description: "Set a setting value".to_string(),
                    params: vec![
                        ApiParam {
                            name: "key".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Setting key".to_string(),
                        },
                        ApiParam {
                            name: "value".to_string(),
                            type_def: "any".to_string(),
                            required: true,
                            description: "Setting value".to_string(),
                        },
                    ],
                    returns: "Promise<void>".to_string(),
                    permissions: vec!["settings:write".to_string()],
                },
                ApiMethod {
                    name: "delete".to_string(),
                    description: "Delete a setting".to_string(),
                    params: vec![ApiParam {
                        name: "key".to_string(),
                        type_def: "string".to_string(),
                        required: true,
                        description: "Setting key to delete".to_string(),
                    }],
                    returns: "Promise<void>".to_string(),
                    permissions: vec!["settings:write".to_string()],
                },
            ],
            interfaces: vec![],
            types: vec![],
        }
    }

    /// Create MCP API module
    fn create_mcp_module() -> ApiModule {
        ApiModule {
            name: "mcp".to_string(),
            description: "Model Context Protocol integration".to_string(),
            methods: vec![
                ApiMethod {
                    name: "listTools".to_string(),
                    description: "List available MCP tools".to_string(),
                    params: vec![ApiParam {
                        name: "server".to_string(),
                        type_def: "string".to_string(),
                        required: false,
                        description: "Specific server name (optional)".to_string(),
                    }],
                    returns: "Promise<McpTool[]>".to_string(),
                    permissions: vec!["mcp:read".to_string()],
                },
                ApiMethod {
                    name: "callTool".to_string(),
                    description: "Call an MCP tool".to_string(),
                    params: vec![
                        ApiParam {
                            name: "name".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Tool name".to_string(),
                        },
                        ApiParam {
                            name: "args".to_string(),
                            type_def: "Record<string, any>".to_string(),
                            required: false,
                            description: "Tool arguments".to_string(),
                        },
                    ],
                    returns: "Promise<McpResponse>".to_string(),
                    permissions: vec!["mcp:execute".to_string()],
                },
            ],
            interfaces: vec![
                InterfaceDefinition {
                    name: "McpTool".to_string(),
                    description: "MCP tool definition".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "name".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "Tool name".to_string(),
                        },
                        PropertyDefinition {
                            name: "description".to_string(),
                            type_def: "string".to_string(),
                            optional: false,
                            description: "Tool description".to_string(),
                        },
                        PropertyDefinition {
                            name: "schema".to_string(),
                            type_def: "Record<string, any>".to_string(),
                            optional: false,
                            description: "Tool input schema".to_string(),
                        },
                    ],
                },
                InterfaceDefinition {
                    name: "McpResponse".to_string(),
                    description: "MCP tool response".to_string(),
                    properties: vec![
                        PropertyDefinition {
                            name: "content".to_string(),
                            type_def: "any".to_string(),
                            optional: false,
                            description: "Response content".to_string(),
                        },
                        PropertyDefinition {
                            name: "isError".to_string(),
                            type_def: "boolean".to_string(),
                            optional: false,
                            description: "Whether response is an error".to_string(),
                        },
                    ],
                },
            ],
            types: vec![],
        }
    }

    /// Create Network API module  
    fn create_network_module() -> ApiModule {
        ApiModule {
            name: "network".to_string(),
            description: "Controlled network access for plugins".to_string(),
            methods: vec![
                ApiMethod {
                    name: "fetch".to_string(),
                    description: "Make an HTTP request".to_string(),
                    params: vec![
                        ApiParam {
                            name: "url".to_string(),
                            type_def: "string".to_string(),
                            required: true,
                            description: "Request URL".to_string(),
                        },
                        ApiParam {
                            name: "options".to_string(),
                            type_def: "FetchOptions".to_string(),
                            required: false,
                            description: "Request options".to_string(),
                        },
                    ],
                    returns: "Promise<Response>".to_string(),
                    permissions: vec!["network:request".to_string()],
                },
                ApiMethod {
                    name: "createWebSocket".to_string(),
                    description: "Create a WebSocket connection".to_string(),
                    params: vec![ApiParam {
                        name: "url".to_string(),
                        type_def: "string".to_string(),
                        required: true,
                        description: "WebSocket URL".to_string(),
                    }],
                    returns: "Promise<WebSocket>".to_string(),
                    permissions: vec!["network:websocket".to_string()],
                },
            ],
            interfaces: vec![InterfaceDefinition {
                name: "FetchOptions".to_string(),
                description: "HTTP request options".to_string(),
                properties: vec![
                    PropertyDefinition {
                        name: "method".to_string(),
                        type_def: "string".to_string(),
                        optional: true,
                        description: "HTTP method".to_string(),
                    },
                    PropertyDefinition {
                        name: "headers".to_string(),
                        type_def: "Record<string, string>".to_string(),
                        optional: true,
                        description: "Request headers".to_string(),
                    },
                    PropertyDefinition {
                        name: "body".to_string(),
                        type_def: "string".to_string(),
                        optional: true,
                        description: "Request body".to_string(),
                    },
                ],
            }],
            types: vec![],
        }
    }
}
