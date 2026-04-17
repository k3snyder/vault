/// MCP Protocol types and structures

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 Request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// JSON-RPC 2.0 Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 Error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

// JSON-RPC 2.0 Error codes
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INTERNAL_ERROR: i32 = -32603;

/// MCP Initialize Request Parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: String,
    pub capabilities: ClientCapabilities,
    pub client_info: ClientInfo,
}

/// Client Capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<RootsCapability>,
}

/// Roots Capability
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootsCapability {
    #[serde(default)]
    pub list_changed: bool,
}

/// Client Information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

/// MCP Initialize Result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: String,
    pub capabilities: ServerCapabilities,
    pub server_info: ServerInfo,
}

/// Server Capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub tools: ToolsCapability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<ResourcesCapability>,
}

/// Tools Capability
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolsCapability {
    /// Whether the tool list can change dynamically
    #[serde(default, skip_serializing_if = "is_false")]
    pub list_changed: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// Resources Capability
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcesCapability {
    /// Whether the resource list can change dynamically
    #[serde(default)]
    pub list_changed: bool,
}

/// Server Information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

/// Tool Definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Tools List Result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsListResult {
    pub tools: Vec<Tool>,
}

/// Tool Call Parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallParams {
    pub name: String,
    pub arguments: Value,
}

/// Tool Call Result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub content: Vec<Content>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "isError")]
    pub is_error: Option<bool>,
}

/// Content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Content {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

/// Resource Definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub uri: String,
    pub name: String,
    pub description: String,
    pub mime_type: String,
}

/// Resources List Result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourcesListResult {
    pub resources: Vec<Resource>,
}

/// Read Resource Parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadResourceParams {
    pub uri: String,
}

/// Read Resource Result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadResourceResult {
    pub contents: Vec<ResourceContent>,
}

/// Resource Content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceContent {
    pub uri: String,
    pub mime_type: String,
    pub text: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Test that InitializeParams deserializes when capabilities is empty {}
    /// This is the minimal case - no roots capability at all
    #[test]
    fn test_initialize_params_empty_capabilities() {
        let json = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        });

        let result: Result<InitializeParams, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Should parse empty capabilities: {:?}", result.err());

        let params = result.unwrap();
        assert!(params.capabilities.roots.is_none());
    }

    /// Test that InitializeParams deserializes when roots is empty {}
    /// This is the Claude Code case that was failing - roots present but listChanged missing
    #[test]
    fn test_initialize_params_empty_roots() {
        let json = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "roots": {}
            },
            "clientInfo": {
                "name": "claude-code",
                "version": "1.0.0"
            }
        });

        let result: Result<InitializeParams, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Should parse empty roots object: {:?}", result.err());

        let params = result.unwrap();
        assert!(params.capabilities.roots.is_some());
        assert!(!params.capabilities.roots.unwrap().list_changed); // defaults to false
    }

    /// Test that InitializeParams deserializes when listChanged is explicitly true
    #[test]
    fn test_initialize_params_roots_list_changed_true() {
        let json = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "roots": {
                    "listChanged": true
                }
            },
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        });

        let result: Result<InitializeParams, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Should parse roots with listChanged=true: {:?}", result.err());

        let params = result.unwrap();
        assert!(params.capabilities.roots.is_some());
        assert!(params.capabilities.roots.unwrap().list_changed);
    }

    /// Test that InitializeParams deserializes when listChanged is explicitly false
    #[test]
    fn test_initialize_params_roots_list_changed_false() {
        let json = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "roots": {
                    "listChanged": false
                }
            },
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        });

        let result: Result<InitializeParams, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Should parse roots with listChanged=false: {:?}", result.err());

        let params = result.unwrap();
        assert!(params.capabilities.roots.is_some());
        assert!(!params.capabilities.roots.unwrap().list_changed);
    }

    /// Test RootsCapability directly with empty object
    #[test]
    fn test_roots_capability_empty_object() {
        let json = json!({});
        let result: Result<RootsCapability, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Should parse empty RootsCapability: {:?}", result.err());
        assert!(!result.unwrap().list_changed);
    }
}