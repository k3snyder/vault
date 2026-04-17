// MCP API Tests - Test-driven development for Model Context Protocol integration
// Tests all MCP API methods for plugin interaction with MCP servers

use super::*;
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(test)]
mod mcp_api_tests {
    use super::*;

    // Helper function to create a test MCP API
    async fn create_test_mcp() -> McpApi {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        McpApi::new(permission_manager)
    }

    // Helper to grant permissions for testing
    async fn grant_mcp_permission(api: &McpApi, plugin_id: &str, permission: McpPermission) {
        api.grant_permission(plugin_id, permission).await;
    }

    // Mock MCP server for testing
    async fn setup_mock_server(api: &McpApi) {
        api.register_mock_server(
            "test-server",
            MockServerConfig {
                tools: vec![
                    ToolInfo {
                        name: "calculate".to_string(),
                        description: "Perform calculations".to_string(),
                        input_schema: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "expression": { "type": "string" }
                            }
                        }),
                    },
                    ToolInfo {
                        name: "search".to_string(),
                        description: "Search for information".to_string(),
                        input_schema: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "query": { "type": "string" }
                            }
                        }),
                    },
                ],
                resources: vec![
                    ResourceInfo {
                        uri: "file:///test.txt".to_string(),
                        name: "Test File".to_string(),
                        description: Some("A test file resource".to_string()),
                        mime_type: Some("text/plain".to_string()),
                    },
                    ResourceInfo {
                        uri: "https://api.example.com/data".to_string(),
                        name: "API Data".to_string(),
                        description: Some("External API data".to_string()),
                        mime_type: Some("application/json".to_string()),
                    },
                ],
                prompts: vec![PromptInfo {
                    name: "summarize".to_string(),
                    description: "Summarize text".to_string(),
                    arguments: vec![PromptArgument {
                        name: "text".to_string(),
                        description: "Text to summarize".to_string(),
                        required: true,
                    }],
                }],
            },
        )
        .await;
    }

    mod server_management {
        use super::*;

        #[tokio::test]
        async fn test_list_available_servers() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::List).await;

            setup_mock_server(&mcp).await;

            let servers = mcp.list_servers("test-plugin").await;
            assert!(servers.is_ok());

            let server_list = servers.unwrap();
            assert!(!server_list.is_empty());
            assert!(server_list.iter().any(|s| s.name == "test-server"));
        }

        #[tokio::test]
        async fn test_get_server_info() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::List).await;

            setup_mock_server(&mcp).await;

            let info = mcp.get_server_info("test-plugin", "test-server").await;
            assert!(info.is_ok());

            let server_info = info.unwrap();
            assert_eq!(server_info.name, "test-server");
            assert!(server_info.is_active);
        }

        #[tokio::test]
        async fn test_register_server_with_permission() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Register).await;

            let config = ServerConfig {
                name: "custom-server".to_string(),
                command: "node".to_string(),
                args: vec!["server.js".to_string()],
                env: std::collections::HashMap::new(),
            };

            let result = mcp.register_server("test-plugin", config).await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_register_server_without_permission() {
            let mcp = create_test_mcp().await;

            let config = ServerConfig {
                name: "unauthorized-server".to_string(),
                command: "node".to_string(),
                args: vec![],
                env: std::collections::HashMap::new(),
            };

            let result = mcp.register_server("test-plugin", config).await;
            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::PermissionDenied(_)));
        }
    }

    mod tool_operations {
        use super::*;

        #[tokio::test]
        async fn test_list_tools() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::List).await;

            setup_mock_server(&mcp).await;

            let tools = mcp.list_tools("test-plugin", Some("test-server")).await;
            assert!(tools.is_ok());

            let tool_list = tools.unwrap();
            assert_eq!(tool_list.len(), 2);
            assert!(tool_list.iter().any(|t| t.name == "calculate"));
            assert!(tool_list.iter().any(|t| t.name == "search"));
        }

        #[tokio::test]
        async fn test_invoke_tool_with_permission() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;

            setup_mock_server(&mcp).await;

            let params = serde_json::json!({
                "expression": "2 + 2"
            });

            let result = mcp
                .invoke_tool("test-plugin", "test-server", "calculate", params)
                .await;

            assert!(result.is_ok());
            // In a real implementation, this would return the calculation result
        }

        #[tokio::test]
        async fn test_invoke_tool_without_permission() {
            let mcp = create_test_mcp().await;
            setup_mock_server(&mcp).await;

            let params = serde_json::json!({
                "query": "test"
            });

            let result = mcp
                .invoke_tool("test-plugin", "test-server", "search", params)
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::PermissionDenied(_)));
        }

        #[tokio::test]
        async fn test_invoke_nonexistent_tool() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;

            setup_mock_server(&mcp).await;

            let result = mcp
                .invoke_tool(
                    "test-plugin",
                    "test-server",
                    "nonexistent",
                    serde_json::json!({}),
                )
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::ToolNotFound(_)));
        }
    }

    mod resource_operations {
        use super::*;

        #[tokio::test]
        async fn test_list_resources() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::List).await;

            setup_mock_server(&mcp).await;

            let resources = mcp.list_resources("test-plugin", Some("test-server")).await;
            assert!(resources.is_ok());

            let resource_list = resources.unwrap();
            assert_eq!(resource_list.len(), 2);
            assert!(resource_list.iter().any(|r| r.name == "Test File"));
            assert!(resource_list.iter().any(|r| r.name == "API Data"));
        }

        #[tokio::test]
        async fn test_read_resource_with_permission() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Read).await;

            setup_mock_server(&mcp).await;

            let result = mcp
                .read_resource("test-plugin", "test-server", "file:///test.txt")
                .await;

            assert!(result.is_ok());
            // In a real implementation, this would return the resource content
        }

        #[tokio::test]
        async fn test_read_resource_without_permission() {
            let mcp = create_test_mcp().await;
            setup_mock_server(&mcp).await;

            let result = mcp
                .read_resource("test-plugin", "test-server", "file:///test.txt")
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::PermissionDenied(_)));
        }

        #[tokio::test]
        async fn test_subscribe_to_resource() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Subscribe).await;

            setup_mock_server(&mcp).await;

            let (tx, mut rx) = tokio::sync::mpsc::channel(10);

            let result = mcp
                .subscribe_to_resource(
                    "test-plugin",
                    "test-server",
                    "https://api.example.com/data",
                    tx,
                )
                .await;

            assert!(result.is_ok());

            // Simulate resource update
            mcp.emit_resource_update_internal(
                "test-server",
                "https://api.example.com/data",
                ResourceUpdate {
                    uri: "https://api.example.com/data".to_string(),
                    content: serde_json::json!({"updated": true}),
                    timestamp: chrono::Utc::now().timestamp() as u64,
                },
            )
            .await;

            // Check if update was received
            if let Ok(update) = rx.try_recv() {
                assert_eq!(update.uri, "https://api.example.com/data");
            }
        }
    }

    mod prompt_operations {
        use super::*;

        #[tokio::test]
        async fn test_list_prompts() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::List).await;

            setup_mock_server(&mcp).await;

            let prompts = mcp.list_prompts("test-plugin", Some("test-server")).await;
            assert!(prompts.is_ok());

            let prompt_list = prompts.unwrap();
            assert_eq!(prompt_list.len(), 1);
            assert_eq!(prompt_list[0].name, "summarize");
        }

        #[tokio::test]
        async fn test_get_prompt_with_permission() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Read).await;

            setup_mock_server(&mcp).await;

            let args = std::collections::HashMap::from([(
                "text".to_string(),
                "Long text to summarize...".to_string(),
            )]);

            let result = mcp
                .get_prompt("test-plugin", "test-server", "summarize", args)
                .await;

            assert!(result.is_ok());
            // In a real implementation, this would return the formatted prompt
        }

        #[tokio::test]
        async fn test_get_prompt_missing_required_arg() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Read).await;

            setup_mock_server(&mcp).await;

            let args = std::collections::HashMap::new(); // Missing required "text" arg

            let result = mcp
                .get_prompt("test-plugin", "test-server", "summarize", args)
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::InvalidArguments(_)));
        }
    }

    mod error_handling {
        use super::*;

        #[tokio::test]
        async fn test_server_connection_failure() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;

            // Don't setup mock server - simulate it being down

            let result = mcp
                .invoke_tool(
                    "test-plugin",
                    "nonexistent-server",
                    "tool",
                    serde_json::json!({}),
                )
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::ServerNotFound(_)));
        }

        #[tokio::test]
        async fn test_server_timeout() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;

            // Setup a server that simulates timeout
            mcp.register_mock_server(
                "slow-server",
                MockServerConfig {
                    tools: vec![ToolInfo {
                        name: "slow-tool".to_string(),
                        description: "Tool that times out".to_string(),
                        input_schema: serde_json::json!({}),
                    }],
                    resources: vec![],
                    prompts: vec![],
                },
            )
            .await;

            mcp.set_mock_timeout("slow-server", true).await;

            let result = mcp
                .invoke_tool(
                    "test-plugin",
                    "slow-server",
                    "slow-tool",
                    serde_json::json!({}),
                )
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::Timeout(_)));
        }

        #[tokio::test]
        async fn test_invalid_server_response() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Read).await;

            // Setup a server that returns invalid data
            mcp.register_mock_server(
                "broken-server",
                MockServerConfig {
                    tools: vec![],
                    resources: vec![ResourceInfo {
                        uri: "invalid://resource".to_string(),
                        name: "Broken Resource".to_string(),
                        description: None,
                        mime_type: Some("invalid/type".to_string()),
                    }],
                    prompts: vec![],
                },
            )
            .await;

            mcp.set_mock_invalid_response("broken-server", true).await;

            let result = mcp
                .read_resource("test-plugin", "broken-server", "invalid://resource")
                .await;

            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::InvalidResponse(_)));
        }
    }

    mod permission_validation {
        use super::*;

        #[tokio::test]
        async fn test_tool_permission_scoping() {
            let mcp = create_test_mcp().await;

            // Grant permission for specific tools only
            mcp.grant_tool_permission("test-plugin", "test-server", vec!["calculate"])
                .await;

            setup_mock_server(&mcp).await;

            // Should work for allowed tool
            let result = mcp
                .invoke_tool(
                    "test-plugin",
                    "test-server",
                    "calculate",
                    serde_json::json!({"expression": "1+1"}),
                )
                .await;
            assert!(result.is_ok());

            // Should fail for non-allowed tool
            let result = mcp
                .invoke_tool(
                    "test-plugin",
                    "test-server",
                    "search",
                    serde_json::json!({"query": "test"}),
                )
                .await;
            assert!(result.is_err());
        }

        #[tokio::test]
        async fn test_server_permission_isolation() {
            let mcp = create_test_mcp().await;

            // Grant permission for one server only
            mcp.grant_server_permission("test-plugin", "test-server")
                .await;

            setup_mock_server(&mcp).await;

            // Setup another server
            mcp.register_mock_server(
                "other-server",
                MockServerConfig {
                    tools: vec![ToolInfo {
                        name: "other-tool".to_string(),
                        description: "Another tool".to_string(),
                        input_schema: serde_json::json!({}),
                    }],
                    resources: vec![],
                    prompts: vec![],
                },
            )
            .await;

            // Should work for allowed server
            let result = mcp.list_tools("test-plugin", Some("test-server")).await;
            assert!(result.is_ok());

            // Should fail for non-allowed server
            let result = mcp.list_tools("test-plugin", Some("other-server")).await;
            assert!(result.is_err());
        }
    }

    mod rate_limiting {
        use super::*;
        use std::time::Duration;

        #[tokio::test]
        async fn test_rate_limiting() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;

            setup_mock_server(&mcp).await;

            // Set rate limit
            let _ = mcp
                .set_rate_limit("test-plugin", 5, Duration::from_secs(1))
                .await;

            // Make requests up to limit
            for i in 0..5 {
                let result = mcp
                    .invoke_tool(
                        "test-plugin",
                        "test-server",
                        "calculate",
                        serde_json::json!({"expression": format!("{} + 1", i)}),
                    )
                    .await;
                assert!(result.is_ok());
            }

            // Next request should be rate limited
            let result = mcp
                .invoke_tool(
                    "test-plugin",
                    "test-server",
                    "calculate",
                    serde_json::json!({"expression": "6 + 1"}),
                )
                .await;
            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), McpError::RateLimited(_)));
        }
    }

    mod performance {
        use super::*;
        use std::time::Instant;

        #[tokio::test]
        async fn test_tool_invocation_performance() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;

            setup_mock_server(&mcp).await;

            let start = Instant::now();

            // Invoke tool 100 times
            for i in 0..100 {
                mcp.invoke_tool(
                    "test-plugin",
                    "test-server",
                    "calculate",
                    serde_json::json!({"expression": format!("{} + 1", i)}),
                )
                .await
                .unwrap();
            }

            let duration = start.elapsed();

            // Should complete in under 1 second for mock operations
            assert!(duration.as_secs() < 1);
        }

        #[tokio::test]
        async fn test_concurrent_operations() {
            let mcp = create_test_mcp().await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Invoke).await;
            grant_mcp_permission(&mcp, "test-plugin", McpPermission::Read).await;

            setup_mock_server(&mcp).await;

            let start = Instant::now();

            // Launch concurrent operations
            let mut handles = vec![];

            for i in 0..10 {
                let mcp_clone = mcp.clone_internal();
                let handle = tokio::spawn(async move {
                    // Mix of operations
                    if i % 2 == 0 {
                        mcp_clone
                            .invoke_tool(
                                "test-plugin",
                                "test-server",
                                "calculate",
                                serde_json::json!({"expression": format!("{} * 2", i)}),
                            )
                            .await
                    } else {
                        mcp_clone
                            .read_resource("test-plugin", "test-server", "file:///test.txt")
                            .await
                    }
                });
                handles.push(handle);
            }

            // Wait for all operations
            for handle in handles {
                assert!(handle.await.unwrap().is_ok());
            }

            let duration = start.elapsed();

            // Concurrent operations should be faster than sequential
            assert!(duration.as_millis() < 500);
        }
    }
}
