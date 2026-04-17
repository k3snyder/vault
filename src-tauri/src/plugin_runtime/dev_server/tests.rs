// Development Server Tests
use super::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;
use tokio::time::{sleep, Duration};

/// Test helpers
mod helpers {
    use super::*;

    pub async fn create_test_plugin() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let plugin_path = temp_dir.path().to_path_buf();

        // Create plugin structure
        fs::create_dir_all(plugin_path.join("src")).unwrap();
        fs::create_dir_all(plugin_path.join("dist")).unwrap();

        // Create manifest
        let manifest = r#"{
            "id": "test-plugin",
            "name": "Test Plugin",
            "version": "0.1.0",
            "description": "Test plugin",
            "author": "Test",
            "minApiVersion": "1.0.0",
            "permissions": ["vault:read"],
            "entryPoint": "dist/main.js"
        }"#;
        fs::write(plugin_path.join("manifest.json"), manifest).unwrap();

        // Create source file
        let main_ts = r#"
            export default class TestPlugin {
                onload() {
                    console.log('Plugin loaded');
                }
            }
        "#;
        fs::write(plugin_path.join("src/main.ts"), main_ts).unwrap();

        // Create tsconfig
        let tsconfig = r#"{
            "compilerOptions": {
                "target": "ES2020",
                "module": "ESNext",
                "outDir": "./dist",
                "rootDir": "./src",
                "strict": true,
                "sourceMap": true
            }
        }"#;
        fs::write(plugin_path.join("tsconfig.json"), tsconfig).unwrap();

        (temp_dir, plugin_path)
    }
}

// ===== Basic Server Tests =====

#[tokio::test]
async fn test_dev_server_creation() {
    let server = DevServer::new();
    assert_eq!(server.get_status(), ServerStatus::Stopped);
}

#[tokio::test]
async fn test_dev_server_start() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0, // Random port
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    let result = server.start(config).await;
    assert!(result.is_ok());

    let info = result.unwrap();
    assert!(info.port > 0);
    assert!(info.url.starts_with("http://localhost:"));
    assert_eq!(server.get_status(), ServerStatus::Running);

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_dev_server_stop() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();
    assert_eq!(server.get_status(), ServerStatus::Running);

    server.stop().await.unwrap();
    assert_eq!(server.get_status(), ServerStatus::Stopped);
}

// ===== TypeScript Compilation Tests =====

#[tokio::test]
async fn test_typescript_compilation() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Wait for compilation
    sleep(Duration::from_millis(100)).await;

    // Check if compiled file exists
    let compiled_file = plugin_path.join("dist/main.js");
    assert!(compiled_file.exists());

    // Check source map
    let source_map = plugin_path.join("dist/main.js.map");
    assert!(source_map.exists());

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_typescript_compilation_error() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;

    // Write invalid TypeScript
    let invalid_ts = r#"
        export default class TestPlugin {
            onload() {
                let x: string = 123; // Type error
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), invalid_ts).unwrap();

    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    let result = server.start(config).await;
    assert!(result.is_ok()); // Server starts but shows compilation errors

    // Check for compilation errors
    let errors = server.get_compilation_errors().await;
    assert!(!errors.is_empty());
    assert!(errors[0].message.contains("Type"));

    server.stop().await.unwrap();
}

// ===== Hot Reload Tests =====

#[tokio::test]
async fn test_hot_reload() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: true,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Subscribe to reload events
    let mut reload_rx = server.subscribe_to_reloads().await;

    // Modify source file
    let updated_ts = r#"
        export default class TestPlugin {
            onload() {
                console.log('Plugin updated');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), updated_ts).unwrap();

    // Wait for reload event
    let reload_event = tokio::time::timeout(Duration::from_secs(2), reload_rx.recv()).await;

    assert!(reload_event.is_ok());
    assert!(reload_event.unwrap().is_some());

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_hot_reload_multiple_files() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;

    // Create additional source file
    let utils_ts = r#"
        export function helper() {
            return 'helper';
        }
    "#;
    fs::write(plugin_path.join("src/utils.ts"), utils_ts).unwrap();

    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: true,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    let mut reload_rx = server.subscribe_to_reloads().await;

    // Modify utils file
    let updated_utils = r#"
        export function helper() {
            return 'updated helper';
        }
    "#;
    fs::write(plugin_path.join("src/utils.ts"), updated_utils).unwrap();

    // Should trigger reload
    let reload_event = tokio::time::timeout(Duration::from_secs(2), reload_rx.recv()).await;

    assert!(reload_event.is_ok());

    server.stop().await.unwrap();
}

// ===== Mock Vault Environment Tests =====

#[tokio::test]
async fn test_mock_vault_api() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec!["vault:read".to_string()],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Get mock API endpoint
    let api_endpoint = server.get_api_endpoint().await;
    assert!(api_endpoint.starts_with("http://localhost:"));

    // Test mock vault API call
    let mock_result = server
        .call_mock_api(
            "vault.readFile",
            serde_json::json!({
                "path": "test.md"
            }),
        )
        .await;

    assert!(mock_result.is_ok());
    let response = mock_result.unwrap();
    assert!(response.is_object());

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_mock_permissions() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec!["vault:read".to_string(), "workspace:modify".to_string()],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Check granted permissions
    let permissions = server.get_mock_permissions().await;
    assert_eq!(permissions.len(), 2);
    assert!(permissions.contains(&"vault:read".to_string()));
    assert!(permissions.contains(&"workspace:modify".to_string()));

    // Test permission check
    assert!(server.check_permission("vault:read").await);
    assert!(server.check_permission("workspace:modify").await);
    assert!(!server.check_permission("network:fetch").await);

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_mock_workspace_api() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec!["workspace:modify".to_string()],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Test workspace API
    let result = server
        .call_mock_api(
            "workspace.showNotice",
            serde_json::json!({
                "message": "Test notice"
            }),
        )
        .await;

    assert!(result.is_ok());

    // Test getting active file (mock)
    let active_file = server
        .call_mock_api("workspace.getActiveFile", serde_json::json!({}))
        .await;
    assert!(active_file.is_ok());

    server.stop().await.unwrap();
}

// ===== Resource Monitoring Tests =====

#[tokio::test]
async fn test_resource_monitoring() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Get resource stats
    let stats = server.get_resource_stats().await;
    assert!(stats.memory_mb >= 0.0);
    assert!(stats.cpu_percent >= 0.0);
    let _ = stats.build_time_ms;

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_resource_limits() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    // Set resource limits
    server
        .set_resource_limits(ResourceLimits {
            max_memory_mb: 100,
            max_cpu_percent: 50,
            max_build_time_ms: 5000,
        })
        .await;

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Check if limits are enforced
    let limits = server.get_resource_limits().await;
    assert_eq!(limits.max_memory_mb, 100);
    assert_eq!(limits.max_cpu_percent, 50);
    assert_eq!(limits.max_build_time_ms, 5000);

    server.stop().await.unwrap();
}

// ===== Source Map Tests =====

#[tokio::test]
async fn test_source_maps_enabled() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Wait for compilation
    sleep(Duration::from_millis(100)).await;

    // Check source maps exist
    assert!(plugin_path.join("dist/main.js.map").exists());

    // Read compiled file and check for source map reference
    let compiled = fs::read_to_string(plugin_path.join("dist/main.js")).unwrap();
    assert!(compiled.contains("//# sourceMappingURL=main.js.map"));

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_source_maps_disabled() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: false,
        source_maps: false, // Disabled
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Wait for compilation
    sleep(Duration::from_millis(100)).await;

    // Check source maps don't exist
    assert!(!plugin_path.join("dist/main.js.map").exists());

    server.stop().await.unwrap();
}

// ===== WebSocket Communication Tests =====

#[tokio::test]
async fn test_websocket_connection() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: true, // Requires WebSocket
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Get WebSocket URL
    let ws_url = server.get_websocket_url().await;
    assert!(ws_url.starts_with("ws://localhost:"));

    server.stop().await.unwrap();
}

// ===== Error Handling Tests =====

#[tokio::test]
async fn test_invalid_plugin_path() {
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: PathBuf::from("/nonexistent/path"),
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    let result = server.start(config).await;
    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        DevServerError::PluginNotFound(_)
    ));
}

#[tokio::test]
async fn test_port_in_use() {
    let (_temp_dir1, plugin_path1) = helpers::create_test_plugin().await;
    let (_temp_dir2, plugin_path2) = helpers::create_test_plugin().await;

    let mut server1 = DevServer::new();
    let mut server2 = DevServer::new();

    // Start first server
    let config1 = DevServerConfig {
        plugin_path: plugin_path1,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    let info1 = server1.start(config1).await.unwrap();

    // Try to start second server on same port
    let config2 = DevServerConfig {
        plugin_path: plugin_path2,
        port: info1.port,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    let result = server2.start(config2).await;
    assert!(result.is_err());
    assert!(matches!(result.unwrap_err(), DevServerError::PortInUse(_)));

    server1.stop().await.unwrap();
}

// ===== Integration Tests =====

#[tokio::test]
async fn test_full_development_workflow() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    // Start with full configuration
    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: true,
        source_maps: true,
        mock_permissions: vec![
            "vault:read".to_string(),
            "vault:write".to_string(),
            "workspace:modify".to_string(),
        ],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Test compilation
    sleep(Duration::from_millis(100)).await;
    assert!(plugin_path.join("dist/main.js").exists());
    assert!(plugin_path.join("dist/main.js.map").exists());

    // Test mock API
    let api_result = server
        .call_mock_api(
            "vault.readFile",
            serde_json::json!({
                "path": "test.md"
            }),
        )
        .await;
    assert!(api_result.is_ok());

    // Test hot reload
    let mut reload_rx = server.subscribe_to_reloads().await;

    let updated_ts = r#"
        export default class TestPlugin {
            onload() {
                console.log('Updated in workflow test');
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), updated_ts).unwrap();

    let reload_event = tokio::time::timeout(Duration::from_secs(2), reload_rx.recv()).await;
    assert!(reload_event.is_ok());

    // Test resource monitoring
    let stats = server.get_resource_stats().await;
    assert!(stats.memory_mb >= 0.0);

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_multiple_plugin_reload() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path: plugin_path.clone(),
        port: 0,
        hot_reload: true,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    let mut reload_rx = server.subscribe_to_reloads().await;
    let mut reload_count = 0;

    // Trigger multiple reloads
    for i in 0..3 {
        let updated_ts = format!(
            r#"
            export default class TestPlugin {{
                onload() {{
                    console.log('Reload {}');
                }}
            }}
        "#,
            i
        );
        fs::write(plugin_path.join("src/main.ts"), updated_ts).unwrap();

        let reload_event = tokio::time::timeout(Duration::from_secs(2), reload_rx.recv()).await;

        if reload_event.is_ok() && reload_event.unwrap().is_some() {
            reload_count += 1;
        }
    }

    assert_eq!(reload_count, 3);

    server.stop().await.unwrap();
}

// ===== Performance Tests =====

#[tokio::test]
async fn test_compilation_performance() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;

    // Create a larger source file
    let large_ts = r#"
        export default class TestPlugin {
            onload() {
                console.log('Plugin loaded');
                // Add more code to test compilation time
                for (let i = 0; i < 100; i++) {
                    this.processItem(i);
                }
            }
            
            processItem(index: number) {
                return index * 2;
            }
        }
    "#;
    fs::write(plugin_path.join("src/main.ts"), large_ts).unwrap();

    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec![],
        open_browser: false,
    };

    let start = std::time::Instant::now();
    server.start(config).await.unwrap();

    // Wait for compilation
    sleep(Duration::from_millis(500)).await;

    let stats = server.get_resource_stats().await;
    let elapsed = start.elapsed().as_millis();

    // Should compile within reasonable time
    assert!(elapsed < 5000);
    assert!(stats.build_time_ms < 5000);

    server.stop().await.unwrap();
}

#[tokio::test]
async fn test_concurrent_api_calls() {
    let (_temp_dir, plugin_path) = helpers::create_test_plugin().await;
    let mut server = DevServer::new();

    let config = DevServerConfig {
        plugin_path,
        port: 0,
        hot_reload: false,
        source_maps: true,
        mock_permissions: vec!["vault:read".to_string()],
        open_browser: false,
    };

    server.start(config).await.unwrap();

    // Make concurrent API calls
    let mut handles = vec![];
    let server_clone = server.clone();

    for i in 0..10 {
        let server = server_clone.clone();
        let handle = tokio::spawn(async move {
            server
                .call_mock_api(
                    "vault.readFile",
                    serde_json::json!({
                        "path": format!("test{}.md", i)
                    }),
                )
                .await
        });
        handles.push(handle);
    }

    // All should succeed
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }

    server.stop().await.unwrap();
}
