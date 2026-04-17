// MCP API - Model Context Protocol integration for plugins
// Provides controlled access to MCP servers and their capabilities

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::plugin_runtime::permissions::{Capability, Permission, PermissionManager};

#[cfg(test)]
mod tests;

/// Permissions for MCP operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum McpPermission {
    List,
    Read,
    Invoke,
    Subscribe,
    Register,
}

/// MCP API errors
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Server not found: {0}")]
    ServerNotFound(String),

    #[error("Tool not found: {0}")]
    ToolNotFound(String),

    #[error("Resource not found: {0}")]
    ResourceNotFound(String),

    #[error("Prompt not found: {0}")]
    PromptNotFound(String),

    #[error("Invalid arguments: {0}")]
    InvalidArguments(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Server error: {0}")]
    ServerError(String),
}

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

/// Server information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub is_active: bool,
    pub version: Option<String>,
    pub capabilities: ServerCapabilities,
}

/// Server capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub tools: bool,
    pub resources: bool,
    pub prompts: bool,
    pub subscriptions: bool,
}

/// Tool information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: JsonValue,
}

/// Resource information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

/// Resource update event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUpdate {
    pub uri: String,
    pub content: JsonValue,
    pub timestamp: u64,
}

/// Prompt information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptInfo {
    pub name: String,
    pub description: String,
    pub arguments: Vec<PromptArgument>,
}

/// Prompt argument
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptArgument {
    pub name: String,
    pub description: String,
    pub required: bool,
}

/// Prompt result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptResult {
    pub messages: Vec<PromptMessage>,
}

/// Prompt message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptMessage {
    pub role: String,
    pub content: String,
}

/// Rate limit info
struct RateLimitInfo {
    max_requests: usize,
    window: Duration,
    requests: Vec<std::time::Instant>,
}

/// Mock server configuration for testing
#[cfg(test)]
pub struct MockServerConfig {
    pub tools: Vec<ToolInfo>,
    pub resources: Vec<ResourceInfo>,
    pub prompts: Vec<PromptInfo>,
}

/// Internal MCP state
struct McpState {
    servers: HashMap<String, ServerInfo>,
    tools: HashMap<String, Vec<ToolInfo>>,
    resources: HashMap<String, Vec<ResourceInfo>>,
    prompts: HashMap<String, Vec<PromptInfo>>,
    subscriptions: HashMap<String, Vec<(String, tokio::sync::mpsc::Sender<ResourceUpdate>)>>,
    rate_limits: HashMap<String, RateLimitInfo>,
    server_permissions: HashMap<String, Vec<String>>, // plugin_id -> allowed servers
    tool_permissions: HashMap<String, HashMap<String, Vec<String>>>, // plugin_id -> server -> tools
    #[cfg(test)]
    mock_timeouts: HashMap<String, bool>,
    #[cfg(test)]
    mock_invalid_responses: HashMap<String, bool>,
}

/// MCP API implementation
pub struct McpApi {
    permission_manager: Arc<RwLock<PermissionManager>>,
    state: Arc<RwLock<McpState>>,
}

impl McpApi {
    /// Create a new MCP API instance
    pub fn new(permission_manager: Arc<RwLock<PermissionManager>>) -> Self {
        Self {
            permission_manager,
            state: Arc::new(RwLock::new(McpState {
                servers: HashMap::new(),
                tools: HashMap::new(),
                resources: HashMap::new(),
                prompts: HashMap::new(),
                subscriptions: HashMap::new(),
                rate_limits: HashMap::new(),
                server_permissions: HashMap::new(),
                tool_permissions: HashMap::new(),
                #[cfg(test)]
                mock_timeouts: HashMap::new(),
                #[cfg(test)]
                mock_invalid_responses: HashMap::new(),
            })),
        }
    }

    /// Grant a permission to a plugin (for testing)
    #[cfg(test)]
    pub async fn grant_permission(&self, plugin_id: &str, permission: McpPermission) {
        let capability = match permission {
            McpPermission::List => Capability::McpInvoke {
                tools: vec!["list".to_string()],
            },
            McpPermission::Read => Capability::McpInvoke {
                tools: vec!["read".to_string()],
            },
            McpPermission::Invoke => Capability::McpInvoke {
                tools: vec!["*".to_string()],
            },
            McpPermission::Subscribe => Capability::McpInvoke {
                tools: vec!["subscribe".to_string()],
            },
            McpPermission::Register => Capability::McpInvoke {
                tools: vec!["register".to_string()],
            },
        };

        let perm = Permission {
            capability,
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        let manager = self.permission_manager.read().await;
        manager
            .grant_permissions(plugin_id, vec![perm])
            .await
            .unwrap();
    }

    /// Check if plugin has permission
    async fn check_permission(
        &self,
        plugin_id: &str,
        permission: McpPermission,
    ) -> Result<(), McpError> {
        let capability = match permission {
            McpPermission::List => Capability::McpInvoke {
                tools: vec!["list".to_string()],
            },
            McpPermission::Read => Capability::McpInvoke {
                tools: vec!["read".to_string()],
            },
            McpPermission::Invoke => Capability::McpInvoke {
                tools: vec!["*".to_string()],
            },
            McpPermission::Subscribe => Capability::McpInvoke {
                tools: vec!["subscribe".to_string()],
            },
            McpPermission::Register => Capability::McpInvoke {
                tools: vec!["register".to_string()],
            },
        };

        let manager = self.permission_manager.read().await;
        if !manager.has_capability(plugin_id, &capability).await {
            return Err(McpError::PermissionDenied(format!(
                "Plugin {} lacks permission: {:?}",
                plugin_id, permission
            )));
        }
        Ok(())
    }

    /// Check rate limit
    async fn check_rate_limit(&self, plugin_id: &str) -> Result<(), McpError> {
        let mut state = self.state.write().await;

        if let Some(limit_info) = state.rate_limits.get_mut(plugin_id) {
            let now = std::time::Instant::now();

            // Remove old requests outside the window
            limit_info
                .requests
                .retain(|&req_time| now.duration_since(req_time) < limit_info.window);

            // Check if under limit
            if limit_info.requests.len() >= limit_info.max_requests {
                return Err(McpError::RateLimited(format!(
                    "Plugin {} exceeded rate limit: {} requests per {:?}",
                    plugin_id, limit_info.max_requests, limit_info.window
                )));
            }

            // Add current request
            limit_info.requests.push(now);
        }

        Ok(())
    }

    // Server management

    /// List available MCP servers
    pub async fn list_servers(&self, plugin_id: &str) -> Result<Vec<ServerInfo>, McpError> {
        self.check_permission(plugin_id, McpPermission::List)
            .await?;

        let state = self.state.read().await;

        // Filter servers based on permissions
        let servers: Vec<ServerInfo> =
            if let Some(allowed) = state.server_permissions.get(plugin_id) {
                state
                    .servers
                    .values()
                    .filter(|s| allowed.contains(&s.name))
                    .cloned()
                    .collect()
            } else {
                state.servers.values().cloned().collect()
            };

        Ok(servers)
    }

    /// Get information about a specific server
    pub async fn get_server_info(
        &self,
        plugin_id: &str,
        server_name: &str,
    ) -> Result<ServerInfo, McpError> {
        self.check_permission(plugin_id, McpPermission::List)
            .await?;

        let state = self.state.read().await;

        // Check server permission
        if let Some(allowed) = state.server_permissions.get(plugin_id) {
            if !allowed.contains(&server_name.to_string()) {
                return Err(McpError::PermissionDenied(format!(
                    "Plugin {} not allowed to access server {}",
                    plugin_id, server_name
                )));
            }
        }

        state
            .servers
            .get(server_name)
            .cloned()
            .ok_or_else(|| McpError::ServerNotFound(server_name.to_string()))
    }

    /// Register a new MCP server (requires elevated permission)
    pub async fn register_server(
        &self,
        plugin_id: &str,
        config: ServerConfig,
    ) -> Result<(), McpError> {
        self.check_permission(plugin_id, McpPermission::Register)
            .await?;

        let mut state = self.state.write().await;

        // Create server info
        let server_info = ServerInfo {
            name: config.name.clone(),
            is_active: false, // Will be activated when started
            version: None,
            capabilities: ServerCapabilities {
                tools: true,
                resources: true,
                prompts: true,
                subscriptions: true,
            },
        };

        state.servers.insert(config.name.clone(), server_info);

        // In a real implementation, this would start the server process
        // For now, we just register it

        Ok(())
    }

    // Tool operations

    /// List available tools
    pub async fn list_tools(
        &self,
        plugin_id: &str,
        server_name: Option<&str>,
    ) -> Result<Vec<ToolInfo>, McpError> {
        self.check_permission(plugin_id, McpPermission::List)
            .await?;

        let state = self.state.read().await;

        let tools = if let Some(server) = server_name {
            // Check server permission
            if let Some(allowed) = state.server_permissions.get(plugin_id) {
                if !allowed.contains(&server.to_string()) {
                    return Err(McpError::PermissionDenied(format!(
                        "Plugin {} not allowed to access server {}",
                        plugin_id, server
                    )));
                }
            }

            state.tools.get(server).cloned().unwrap_or_default()
        } else {
            // Return all tools from allowed servers
            let mut all_tools = Vec::new();
            for (server, tools) in &state.tools {
                if let Some(allowed) = state.server_permissions.get(plugin_id) {
                    if allowed.contains(server) {
                        all_tools.extend(tools.clone());
                    }
                } else {
                    all_tools.extend(tools.clone());
                }
            }
            all_tools
        };

        Ok(tools)
    }

    /// Invoke a tool
    pub async fn invoke_tool(
        &self,
        plugin_id: &str,
        server_name: &str,
        tool_name: &str,
        parameters: JsonValue,
    ) -> Result<JsonValue, McpError> {
        self.check_permission(plugin_id, McpPermission::Invoke)
            .await?;
        self.check_rate_limit(plugin_id).await?;

        let state = self.state.read().await;

        // Check server exists
        if !state.servers.contains_key(server_name) {
            return Err(McpError::ServerNotFound(server_name.to_string()));
        }

        // Check tool permission
        if let Some(server_perms) = state.tool_permissions.get(plugin_id) {
            if let Some(allowed_tools) = server_perms.get(server_name) {
                if !allowed_tools.contains(&tool_name.to_string())
                    && !allowed_tools.contains(&"*".to_string())
                {
                    return Err(McpError::PermissionDenied(format!(
                        "Plugin {} not allowed to invoke tool {} on server {}",
                        plugin_id, tool_name, server_name
                    )));
                }
            }
        }

        // Check tool exists
        if let Some(tools) = state.tools.get(server_name) {
            if !tools.iter().any(|t| t.name == tool_name) {
                return Err(McpError::ToolNotFound(tool_name.to_string()));
            }
        } else {
            return Err(McpError::ToolNotFound(tool_name.to_string()));
        }

        // Check for mock timeout
        #[cfg(test)]
        {
            if let Some(&should_timeout) = state.mock_timeouts.get(server_name) {
                if should_timeout {
                    return Err(McpError::Timeout(format!(
                        "Server {} timed out",
                        server_name
                    )));
                }
            }
        }

        // In a real implementation, this would send the request to the MCP server
        // For testing, return a mock response
        Ok(serde_json::json!({
            "result": "success",
            "tool": tool_name,
            "parameters": parameters,
        }))
    }

    // Resource operations

    /// List available resources
    pub async fn list_resources(
        &self,
        plugin_id: &str,
        server_name: Option<&str>,
    ) -> Result<Vec<ResourceInfo>, McpError> {
        self.check_permission(plugin_id, McpPermission::List)
            .await?;

        let state = self.state.read().await;

        let resources = if let Some(server) = server_name {
            state.resources.get(server).cloned().unwrap_or_default()
        } else {
            let mut all_resources = Vec::new();
            for resources in state.resources.values() {
                all_resources.extend(resources.clone());
            }
            all_resources
        };

        Ok(resources)
    }

    /// Read a resource
    pub async fn read_resource(
        &self,
        plugin_id: &str,
        server_name: &str,
        uri: &str,
    ) -> Result<JsonValue, McpError> {
        self.check_permission(plugin_id, McpPermission::Read)
            .await?;
        self.check_rate_limit(plugin_id).await?;

        let state = self.state.read().await;

        // Check server exists
        if !state.servers.contains_key(server_name) {
            return Err(McpError::ServerNotFound(server_name.to_string()));
        }

        // Check for mock invalid response
        #[cfg(test)]
        {
            if let Some(&should_fail) = state.mock_invalid_responses.get(server_name) {
                if should_fail {
                    return Err(McpError::InvalidResponse(format!(
                        "Invalid response from server {}",
                        server_name
                    )));
                }
            }
        }

        // Check resource exists
        if let Some(resources) = state.resources.get(server_name) {
            if !resources.iter().any(|r| r.uri == uri) {
                return Err(McpError::ResourceNotFound(uri.to_string()));
            }
        } else {
            return Err(McpError::ResourceNotFound(uri.to_string()));
        }

        // In a real implementation, this would fetch the resource from the MCP server
        // For testing, return mock content
        Ok(serde_json::json!({
            "uri": uri,
            "content": "Mock resource content",
            "timestamp": chrono::Utc::now().timestamp(),
        }))
    }

    /// Subscribe to resource updates
    pub async fn subscribe_to_resource(
        &self,
        plugin_id: &str,
        server_name: &str,
        uri: &str,
        sender: tokio::sync::mpsc::Sender<ResourceUpdate>,
    ) -> Result<(), McpError> {
        self.check_permission(plugin_id, McpPermission::Subscribe)
            .await?;

        let mut state = self.state.write().await;

        // Check server exists
        if !state.servers.contains_key(server_name) {
            return Err(McpError::ServerNotFound(server_name.to_string()));
        }

        // Add subscription
        let key = format!("{}:{}", server_name, uri);
        let subscribers = state.subscriptions.entry(key).or_insert_with(Vec::new);
        subscribers.push((plugin_id.to_string(), sender));

        Ok(())
    }

    // Prompt operations

    /// List available prompts
    pub async fn list_prompts(
        &self,
        plugin_id: &str,
        server_name: Option<&str>,
    ) -> Result<Vec<PromptInfo>, McpError> {
        self.check_permission(plugin_id, McpPermission::List)
            .await?;

        let state = self.state.read().await;

        let prompts = if let Some(server) = server_name {
            state.prompts.get(server).cloned().unwrap_or_default()
        } else {
            let mut all_prompts = Vec::new();
            for prompts in state.prompts.values() {
                all_prompts.extend(prompts.clone());
            }
            all_prompts
        };

        Ok(prompts)
    }

    /// Get a formatted prompt
    pub async fn get_prompt(
        &self,
        plugin_id: &str,
        server_name: &str,
        prompt_name: &str,
        arguments: HashMap<String, String>,
    ) -> Result<PromptResult, McpError> {
        self.check_permission(plugin_id, McpPermission::Read)
            .await?;

        let state = self.state.read().await;

        // Check server exists
        if !state.servers.contains_key(server_name) {
            return Err(McpError::ServerNotFound(server_name.to_string()));
        }

        // Check prompt exists and validate arguments
        if let Some(prompts) = state.prompts.get(server_name) {
            if let Some(prompt) = prompts.iter().find(|p| p.name == prompt_name) {
                // Check required arguments
                for arg in &prompt.arguments {
                    if arg.required && !arguments.contains_key(&arg.name) {
                        return Err(McpError::InvalidArguments(format!(
                            "Missing required argument: {}",
                            arg.name
                        )));
                    }
                }
            } else {
                return Err(McpError::PromptNotFound(prompt_name.to_string()));
            }
        } else {
            return Err(McpError::PromptNotFound(prompt_name.to_string()));
        }

        // In a real implementation, this would format the prompt using the MCP server
        // For testing, return a mock result
        Ok(PromptResult {
            messages: vec![PromptMessage {
                role: "system".to_string(),
                content: format!("Prompt: {} with args: {:?}", prompt_name, arguments),
            }],
        })
    }

    // Rate limiting

    /// Set rate limit for a plugin
    pub async fn set_rate_limit(
        &self,
        plugin_id: &str,
        max_requests: usize,
        window: Duration,
    ) -> Result<(), McpError> {
        let mut state = self.state.write().await;

        state.rate_limits.insert(
            plugin_id.to_string(),
            RateLimitInfo {
                max_requests,
                window,
                requests: Vec::new(),
            },
        );

        Ok(())
    }

    // Testing helpers

    #[cfg(test)]
    pub async fn register_mock_server(&self, name: &str, config: MockServerConfig) {
        let mut state = self.state.write().await;

        // Register server
        state.servers.insert(
            name.to_string(),
            ServerInfo {
                name: name.to_string(),
                is_active: true,
                version: Some("1.0.0".to_string()),
                capabilities: ServerCapabilities {
                    tools: !config.tools.is_empty(),
                    resources: !config.resources.is_empty(),
                    prompts: !config.prompts.is_empty(),
                    subscriptions: true,
                },
            },
        );

        // Register tools
        if !config.tools.is_empty() {
            state.tools.insert(name.to_string(), config.tools);
        }

        // Register resources
        if !config.resources.is_empty() {
            state.resources.insert(name.to_string(), config.resources);
        }

        // Register prompts
        if !config.prompts.is_empty() {
            state.prompts.insert(name.to_string(), config.prompts);
        }
    }

    #[cfg(test)]
    pub async fn set_mock_timeout(&self, server_name: &str, should_timeout: bool) {
        let mut state = self.state.write().await;
        state
            .mock_timeouts
            .insert(server_name.to_string(), should_timeout);
    }

    #[cfg(test)]
    pub async fn set_mock_invalid_response(&self, server_name: &str, should_fail: bool) {
        let mut state = self.state.write().await;
        state
            .mock_invalid_responses
            .insert(server_name.to_string(), should_fail);
    }

    #[cfg(test)]
    pub async fn grant_tool_permission(
        &self,
        plugin_id: &str,
        server_name: &str,
        tools: Vec<&str>,
    ) {
        let mut state = self.state.write().await;
        let server_perms = state
            .tool_permissions
            .entry(plugin_id.to_string())
            .or_insert_with(HashMap::new);
        server_perms.insert(
            server_name.to_string(),
            tools.iter().map(|t| t.to_string()).collect(),
        );

        // Also grant invoke permission
        self.grant_permission(plugin_id, McpPermission::Invoke)
            .await;
    }

    #[cfg(test)]
    pub async fn grant_server_permission(&self, plugin_id: &str, server_name: &str) {
        let mut state = self.state.write().await;
        let servers = state
            .server_permissions
            .entry(plugin_id.to_string())
            .or_insert_with(Vec::new);
        servers.push(server_name.to_string());

        // Also grant list permission
        self.grant_permission(plugin_id, McpPermission::List).await;
    }

    #[cfg(test)]
    pub async fn emit_resource_update_internal(
        &self,
        server_name: &str,
        uri: &str,
        update: ResourceUpdate,
    ) {
        let state = self.state.read().await;
        let key = format!("{}:{}", server_name, uri);

        if let Some(subscribers) = state.subscriptions.get(&key) {
            for (_plugin_id, sender) in subscribers {
                let _ = sender.send(update.clone()).await;
            }
        }
    }

    #[cfg(test)]
    pub fn clone_internal(&self) -> Self {
        Self {
            permission_manager: self.permission_manager.clone(),
            state: self.state.clone(),
        }
    }
}
