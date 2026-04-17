/// Main MCP Server implementation

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use tracing::{error, info, warn};

use crate::filesystem::FileSystemHandler;
use crate::protocol::*;
use crate::transport::StdioTransport;
use crate::transport_line::LineTransport;

pub struct McpServer {
    transport: StdioTransport,
    fs_handler: FileSystemHandler,
    initialized: bool,
}

impl McpServer {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            transport: StdioTransport::new(),
            fs_handler: FileSystemHandler::new(vault_path),
            initialized: false,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let debug_enabled = std::env::var("MCP_DEBUG").is_ok();
        
        if debug_enabled {
            info!("MCP Filesystem Server starting...");
            eprintln!("[Rust Filesystem Server] Ready to receive messages");
        }
        
        loop {
            match self.transport.read_message().await {
                Ok(Some(request)) => {
                    if debug_enabled {
                        eprintln!("[Rust Filesystem Server] Received request: {}", request.method);
                    }
                    if let Err(e) = self.handle_request(request).await {
                        if debug_enabled {
                            error!("Error handling request: {}", e);
                            eprintln!("[Rust Filesystem Server] Error: {}", e);
                        }
                    }
                }
                Ok(None) => {
                    if debug_enabled {
                        info!("Client disconnected");
                        eprintln!("[Rust Filesystem Server] Client disconnected");
                    }
                    break;
                }
                Err(e) => {
                    if debug_enabled {
                        error!("Error reading message: {}", e);
                        eprintln!("[Rust Filesystem Server] Error reading message: {}", e);
                    }
                    // Try to send an error response
                    if let Err(send_err) = self.transport.send_error(
                        None,
                        INVALID_REQUEST,
                        format!("Invalid request: {}", e)
                    ).await {
                        if debug_enabled {
                            error!("Failed to send error response: {}", send_err);
                        }
                    }
                }
            }
        }
        
        Ok(())
    }

    async fn handle_request(&mut self, request: JsonRpcRequest) -> Result<()> {
        // Check if this is a notification (no id)
        if request.id.is_none() {
            return self.handle_notification(&request).await;
        }

        let response = match request.method.as_str() {
            "initialize" => self.handle_initialize(request.params).await,
            "tools/list" => self.handle_tools_list().await,
            "tools/call" => self.handle_tool_call(request.params).await,
            "resources/list" => self.handle_resources_list().await,
            "resources/read" => self.handle_resource_read(request.params).await,
            _ => {
                self.transport
                    .send_error(
                        request.id.clone(),
                        METHOD_NOT_FOUND,
                        format!("Method not found: {}", request.method),
                    )
                    .await?;
                return Ok(());
            }
        };

        match response {
            Ok(result) => {
                let response = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id,
                    result: Some(result),
                    error: None,
                };
                self.transport.write_response(&response).await?;
            }
            Err(e) => {
                self.transport
                    .send_error(request.id, INTERNAL_ERROR, e.to_string())
                    .await?;
            }
        }

        Ok(())
    }

    async fn handle_notification(&self, request: &JsonRpcRequest) -> Result<()> {
        match request.method.as_str() {
            "notifications/cancelled" => {
                // Handle cancellation notification
                if std::env::var("MCP_DEBUG").is_ok() {
                    info!("Received cancellation notification");
                }
            }
            _ => {
                if std::env::var("MCP_DEBUG").is_ok() {
                    warn!("Unknown notification: {}", request.method);
                }
            }
        }
        Ok(())
    }

    async fn handle_initialize(&mut self, params: Value) -> Result<Value> {
        let _init_params: InitializeParams = serde_json::from_value(params)?;
        
        self.initialized = true;
        
        let result = InitializeResult {
            protocol_version: "2025-06-18".to_string(),
            capabilities: ServerCapabilities {
                tools: ToolsCapability::default(),
                resources: None,
            },
            server_info: ServerInfo {
                name: "mcp-filesystem-rust".to_string(),
                version: "1.0.0".to_string(),
            },
        };

        Ok(serde_json::to_value(result)?)
    }

    async fn handle_tools_list(&self) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let tools = vec![
            Tool {
                name: "list_files".to_string(),
                description: "List files and directories in a given path within the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path relative to vault root (default: root)",
                            "default": "."
                        },
                        "include_hidden": {
                            "type": "boolean",
                            "description": "Include hidden files (starting with .)",
                            "default": false
                        }
                    }
                }),
            },
            Tool {
                name: "read_file".to_string(),
                description: "Read the contents of a file in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file relative to vault root"
                        }
                    },
                    "required": ["path"]
                }),
            },
            Tool {
                name: "write_file".to_string(),
                description: "Write or update a file in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file relative to vault root"
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write to the file"
                        }
                    },
                    "required": ["path", "content"]
                }),
            },
            Tool {
                name: "create_directory".to_string(),
                description: "Create a new directory in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to directory relative to vault root"
                        }
                    },
                    "required": ["path"]
                }),
            },
            Tool {
                name: "delete_file".to_string(),
                description: "Delete a file or empty directory in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file or directory relative to vault root"
                        }
                    },
                    "required": ["path"]
                }),
            },
            Tool {
                name: "move_file".to_string(),
                description: "Move or rename a file or directory in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "source": {
                            "type": "string",
                            "description": "Source path relative to vault root"
                        },
                        "destination": {
                            "type": "string",
                            "description": "Destination path relative to vault root"
                        }
                    },
                    "required": ["source", "destination"]
                }),
            },
            Tool {
                name: "search_files".to_string(),
                description: "Search for files by name pattern in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern (supports * and ? wildcards)"
                        },
                        "path": {
                            "type": "string",
                            "description": "Starting path for search (default: root)",
                            "default": "."
                        }
                    },
                    "required": ["pattern"]
                }),
            },
        ];

        let result = ToolsListResult { tools };
        Ok(serde_json::to_value(result)?)
    }

    async fn handle_tool_call(&self, params: Value) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let tool_params: ToolCallParams = serde_json::from_value(params)?;
        
        let result = match tool_params.name.as_str() {
            "list_files" => self.fs_handler.list_files(tool_params.arguments).await,
            "read_file" => self.fs_handler.read_file(tool_params.arguments).await,
            "write_file" => self.fs_handler.write_file(tool_params.arguments).await,
            "create_directory" => self.fs_handler.create_directory(tool_params.arguments).await,
            "delete_file" => self.fs_handler.delete_file(tool_params.arguments).await,
            "move_file" => self.fs_handler.move_file(tool_params.arguments).await,
            "search_files" => self.fs_handler.search_files(tool_params.arguments).await,
            _ => {
                return Ok(serde_json::to_value(ToolCallResult {
                    content: vec![Content {
                        content_type: "text".to_string(),
                        text: format!("Unknown tool: {}", tool_params.name),
                    }],
                    is_error: Some(true),
                })?);
            }
        };

        match result {
            Ok(text) => Ok(serde_json::to_value(ToolCallResult {
                content: vec![Content {
                    content_type: "text".to_string(),
                    text,
                }],
                is_error: None,
            })?),
            Err(e) => Ok(serde_json::to_value(ToolCallResult {
                content: vec![Content {
                    content_type: "text".to_string(),
                    text: format!("Error: {}", e),
                }],
                is_error: Some(true),
            })?),
        }
    }

    async fn handle_resources_list(&self) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let resources = vec![Resource {
            uri: "file://vault-info".to_string(),
            name: "Vault Information".to_string(),
            description: "Information about the current vault".to_string(),
            mime_type: "application/json".to_string(),
        }];

        let result = ResourcesListResult { resources };
        Ok(serde_json::to_value(result)?)
    }

    async fn handle_resource_read(&self, params: Value) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let read_params: ReadResourceParams = serde_json::from_value(params)?;
        
        if read_params.uri == "file://vault-info" {
            let vault_info = self.fs_handler.get_vault_info().await?;
            
            let result = ReadResourceResult {
                contents: vec![ResourceContent {
                    uri: read_params.uri,
                    mime_type: "application/json".to_string(),
                    text: vault_info,
                }],
            };
            
            Ok(serde_json::to_value(result)?)
        } else {
            Err(anyhow!("Unknown resource: {}", read_params.uri))
        }
    }
}

/// Line-based server for app compatibility
pub struct LineServer {
    transport: LineTransport,
    fs_handler: FileSystemHandler,
    initialized: bool,
}

impl LineServer {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            transport: LineTransport::new(),
            fs_handler: FileSystemHandler::new(vault_path),
            initialized: false,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let debug_enabled = std::env::var("MCP_DEBUG").is_ok();
        
        if debug_enabled {
            info!("MCP Filesystem Server (line mode) starting...");
            eprintln!("[Rust Filesystem Server] Ready to receive line-based messages");
        }
        
        loop {
            match self.transport.read_message().await {
                Ok(Some(request)) => {
                    if debug_enabled {
                        eprintln!("[Rust Filesystem Server] Received request: {}", request.method);
                    }
                    if let Err(e) = self.handle_request(request).await {
                        if debug_enabled {
                            error!("Error handling request: {}", e);
                            eprintln!("[Rust Filesystem Server] Error: {}", e);
                        }
                    }
                }
                Ok(None) => {
                    if debug_enabled {
                        info!("Client disconnected");
                        eprintln!("[Rust Filesystem Server] Client disconnected");
                    }
                    break;
                }
                Err(e) => {
                    if debug_enabled {
                        error!("Error reading message: {}", e);
                        eprintln!("[Rust Filesystem Server] Error reading message: {}", e);
                    }
                    // Try to send an error response
                    if let Err(send_err) = self.transport.send_error(
                        None,
                        INVALID_REQUEST,
                        format!("Invalid request: {}", e)
                    ).await {
                        if debug_enabled {
                            error!("Failed to send error response: {}", send_err);
                        }
                    }
                }
            }
        }
        
        Ok(())
    }

    async fn handle_request(&mut self, request: JsonRpcRequest) -> Result<()> {
        // Check if this is a notification (no id)
        if request.id.is_none() {
            return self.handle_notification(&request).await;
        }

        let response = match request.method.as_str() {
            "initialize" => self.handle_initialize(request.params).await,
            "tools/list" => self.handle_tools_list().await,
            "tools/call" => self.handle_tool_call(request.params).await,
            "resources/list" => self.handle_resources_list().await,
            "resources/read" => self.handle_resource_read(request.params).await,
            _ => {
                self.transport
                    .send_error(
                        request.id.clone(),
                        METHOD_NOT_FOUND,
                        format!("Method not found: {}", request.method),
                    )
                    .await?;
                return Ok(());
            }
        };

        match response {
            Ok(result) => {
                let response = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id,
                    result: Some(result),
                    error: None,
                };
                self.transport.write_response(&response).await?;
            }
            Err(e) => {
                self.transport
                    .send_error(request.id, INTERNAL_ERROR, e.to_string())
                    .await?;
            }
        }

        Ok(())
    }

    async fn handle_notification(&self, request: &JsonRpcRequest) -> Result<()> {
        match request.method.as_str() {
            "notifications/cancelled" => {
                // Handle cancellation notification
                if std::env::var("MCP_DEBUG").is_ok() {
                    info!("Received cancellation notification");
                }
            }
            _ => {
                if std::env::var("MCP_DEBUG").is_ok() {
                    warn!("Unknown notification: {}", request.method);
                }
            }
        }
        Ok(())
    }

    async fn handle_initialize(&mut self, params: Value) -> Result<Value> {
        let _init_params: InitializeParams = serde_json::from_value(params)?;
        
        self.initialized = true;
        
        let result = InitializeResult {
            protocol_version: "2025-06-18".to_string(),
            capabilities: ServerCapabilities {
                tools: ToolsCapability::default(),
                resources: None,
            },
            server_info: ServerInfo {
                name: "mcp-filesystem-rust".to_string(),
                version: "1.0.0".to_string(),
            },
        };

        Ok(serde_json::to_value(result)?)
    }

    async fn handle_tools_list(&self) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let tools = vec![
            Tool {
                name: "list_files".to_string(),
                description: "List files and directories in a given path within the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path relative to vault root (default: root)",
                            "default": "."
                        },
                        "include_hidden": {
                            "type": "boolean",
                            "description": "Include hidden files (starting with .)",
                            "default": false
                        }
                    }
                }),
            },
            Tool {
                name: "read_file".to_string(),
                description: "Read the contents of a file in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file relative to vault root"
                        }
                    },
                    "required": ["path"]
                }),
            },
            Tool {
                name: "write_file".to_string(),
                description: "Write or update a file in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file relative to vault root"
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write to the file"
                        }
                    },
                    "required": ["path", "content"]
                }),
            },
            Tool {
                name: "create_directory".to_string(),
                description: "Create a new directory in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to directory relative to vault root"
                        }
                    },
                    "required": ["path"]
                }),
            },
            Tool {
                name: "delete_file".to_string(),
                description: "Delete a file or empty directory in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file or directory relative to vault root"
                        }
                    },
                    "required": ["path"]
                }),
            },
            Tool {
                name: "move_file".to_string(),
                description: "Move or rename a file or directory in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "source": {
                            "type": "string",
                            "description": "Source path relative to vault root"
                        },
                        "destination": {
                            "type": "string",
                            "description": "Destination path relative to vault root"
                        }
                    },
                    "required": ["source", "destination"]
                }),
            },
            Tool {
                name: "search_files".to_string(),
                description: "Search for files by name pattern in the vault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern (supports * and ? wildcards)"
                        },
                        "path": {
                            "type": "string",
                            "description": "Starting path for search (default: root)",
                            "default": "."
                        }
                    },
                    "required": ["pattern"]
                }),
            },
        ];

        let result = ToolsListResult { tools };
        Ok(serde_json::to_value(result)?)
    }

    async fn handle_tool_call(&self, params: Value) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let tool_params: ToolCallParams = serde_json::from_value(params)?;
        
        let result = match tool_params.name.as_str() {
            "list_files" => self.fs_handler.list_files(tool_params.arguments).await,
            "read_file" => self.fs_handler.read_file(tool_params.arguments).await,
            "write_file" => self.fs_handler.write_file(tool_params.arguments).await,
            "create_directory" => self.fs_handler.create_directory(tool_params.arguments).await,
            "delete_file" => self.fs_handler.delete_file(tool_params.arguments).await,
            "move_file" => self.fs_handler.move_file(tool_params.arguments).await,
            "search_files" => self.fs_handler.search_files(tool_params.arguments).await,
            _ => {
                return Ok(serde_json::to_value(ToolCallResult {
                    content: vec![Content {
                        content_type: "text".to_string(),
                        text: format!("Unknown tool: {}", tool_params.name),
                    }],
                    is_error: Some(true),
                })?);
            }
        };

        match result {
            Ok(text) => Ok(serde_json::to_value(ToolCallResult {
                content: vec![Content {
                    content_type: "text".to_string(),
                    text,
                }],
                is_error: None,
            })?),
            Err(e) => Ok(serde_json::to_value(ToolCallResult {
                content: vec![Content {
                    content_type: "text".to_string(),
                    text: format!("Error: {}", e),
                }],
                is_error: Some(true),
            })?),
        }
    }

    async fn handle_resources_list(&self) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let resources = vec![Resource {
            uri: "file://vault-info".to_string(),
            name: "Vault Information".to_string(),
            description: "Information about the current vault".to_string(),
            mime_type: "application/json".to_string(),
        }];

        let result = ResourcesListResult { resources };
        Ok(serde_json::to_value(result)?)
    }

    async fn handle_resource_read(&self, params: Value) -> Result<Value> {
        if !self.initialized {
            return Err(anyhow!("Server not initialized"));
        }

        let read_params: ReadResourceParams = serde_json::from_value(params)?;
        
        if read_params.uri == "file://vault-info" {
            let vault_info = self.fs_handler.get_vault_info().await?;
            
            let result = ReadResourceResult {
                contents: vec![ResourceContent {
                    uri: read_params.uri,
                    mime_type: "application/json".to_string(),
                    text: vault_info,
                }],
            };
            
            Ok(serde_json::to_value(result)?)
        } else {
            Err(anyhow!("Unknown resource: {}", read_params.uri))
        }
    }
}
