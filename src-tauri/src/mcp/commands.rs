use serde_json;
use std::sync::Arc;
use tauri::State;

use crate::mcp::{JsonRpcMessage, MCPManager, ServerConfig};

/// Start an MCP server
#[tauri::command]
pub async fn start_mcp_server(
    mcp_manager: State<'_, Arc<MCPManager>>,
    server_id: String,
    config: ServerConfig,
) -> Result<(), String> {
    mcp_manager
        .start_server(server_id, config)
        .await
        .map_err(|e| e.to_string())
}

/// Stop an MCP server
#[tauri::command]
pub async fn stop_mcp_server(
    mcp_manager: State<'_, Arc<MCPManager>>,
    server_id: String,
) -> Result<(), String> {
    mcp_manager
        .stop_server(&server_id)
        .await
        .map_err(|e| e.to_string())
}

/// Send a message to an MCP server
#[tauri::command]
pub async fn send_mcp_message(
    mcp_manager: State<'_, Arc<MCPManager>>,
    server_id: String,
    message: String,
) -> Result<String, String> {
    // Parse the message
    let json_message: JsonRpcMessage =
        serde_json::from_str(&message).map_err(|e| format!("Invalid JSON-RPC message: {}", e))?;

    // Send and get response
    let response = mcp_manager
        .send_message(&server_id, json_message)
        .await
        .map_err(|e| e.to_string())?;

    // Serialize response
    serde_json::to_string(&response).map_err(|e| format!("Failed to serialize response: {}", e))
}

/// Get status of all MCP servers
#[tauri::command]
pub async fn get_mcp_server_statuses(
    mcp_manager: State<'_, Arc<MCPManager>>,
) -> Result<serde_json::Value, String> {
    let statuses = mcp_manager.get_server_statuses().await;
    serde_json::to_value(statuses).map_err(|e| format!("Failed to serialize statuses: {}", e))
}

/// Get detailed info about a specific server
#[tauri::command]
pub async fn get_mcp_server_info(
    mcp_manager: State<'_, Arc<MCPManager>>,
    server_id: String,
) -> Result<serde_json::Value, String> {
    let info = mcp_manager
        .get_server_info(&server_id)
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_value(info).map_err(|e| format!("Failed to serialize info: {}", e))
}

/// Test stdio communication with simple echo server
#[tauri::command]
pub async fn test_process_spawn() -> Result<String, String> {
    println!("🧪 Testing basic process spawn...");

    use std::process::Stdio;
    use tokio::process::Command;

    // Try the simplest possible spawn
    match Command::new("echo")
        .arg("hello")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(mut child) => {
            println!("✅ Basic spawn successful, PID: {:?}", child.id());
            let _ = child.kill().await;
            Ok("Basic spawn successful".to_string())
        }
        Err(e) => {
            println!("❌ Basic spawn failed: {}", e);
            Err(format!("Basic spawn failed: {}", e))
        }
    }
}

#[tauri::command]
pub async fn test_mcp_direct() -> Result<String, String> {
    println!("🧪 Testing direct MCP communication...");

    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    let mut cmd = Command::new("node");
    cmd.arg("./mcp-servers/test-server/index.js");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Set working directory
    if let Ok(current_dir) = std::env::current_dir() {
        if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                println!("📁 Setting working directory to: {:?}", parent);
                cmd.current_dir(parent);
            }
        }
    }

    println!("🚀 Spawning MCP server...");
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => return Err(format!("Failed to spawn: {}", e)),
    };

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut stdout_reader = BufReader::new(stdout);
    let mut _stderr_reader = BufReader::new(stderr);

    // Send initialize request
    let request = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"experimental":{}},"clientInfo":{"name":"test","version":"0.1.0"}}}"#;

    println!("📤 Sending request...");
    stdin
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Write failed: {}", e))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("Write newline failed: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Flush failed: {}", e))?;

    // Try to read response
    println!("📥 Reading response...");
    let mut line = String::new();

    match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        stdout_reader.read_line(&mut line),
    )
    .await
    {
        Ok(Ok(0)) => {
            let _ = child.kill().await;
            Err("EOF on stdout".to_string())
        }
        Ok(Ok(n)) => {
            let _ = child.kill().await;
            Ok(format!("Read {} bytes: {}", n, line.trim()))
        }
        Ok(Err(e)) => {
            let _ = child.kill().await;
            Err(format!("Read error: {}", e))
        }
        Err(_) => {
            let _ = child.kill().await;
            Err("Timeout waiting for response".to_string())
        }
    }
}

#[tauri::command]
pub async fn test_transport_direct(app_handle: tauri::AppHandle) -> Result<String, String> {
    println!("🧪 Testing transport layer directly...");

    use crate::mcp::process::ProcessPool;
    use crate::mcp::transport::Transport;
    use crate::mcp::types::*;

    // Create a simple server config
    let config = ServerConfig {
        enabled: true,
        transport: TransportType::Stdio {
            command: "node".to_string(),
            args: vec!["./mcp-servers/test-server/index.js".to_string()],
            env: std::collections::HashMap::new(),
            working_dir: None,
        },
        capabilities: RequestedCapabilities {
            tools: true,
            resources: true,
            prompts: false,
            sampling: false,
        },
        permissions: ServerPermissions {
            read: true,
            write: false,
            delete: false,
            external_access: false,
        },
    };

    // Spawn process
    let pool = ProcessPool::new(app_handle.clone());
    let process_handle = match pool.spawn(&config).await {
        Ok(handle) => {
            println!("✅ Process spawned");
            handle
        }
        Err(e) => return Err(format!("Failed to spawn: {}", e)),
    };

    // Create transport
    let transport = match Transport::new_stdio(
        "test-transport".to_string(),
        process_handle,
        app_handle,
    )
    .await
    {
        Ok(t) => {
            println!("✅ Transport created");
            t
        }
        Err(e) => return Err(format!("Failed to create transport: {}", e)),
    };

    // Wait a bit for readers to start
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Send initialize message
    let init_msg = JsonRpcMessage {
        jsonrpc: "2.0".to_string(),
        id: Some(serde_json::json!(1)),
        method: "initialize".to_string(),
        params: Some(serde_json::json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {
                "experimental": {}
            },
            "clientInfo": {
                "name": "test",
                "version": "0.1.0"
            }
        })),
    };

    println!("📤 Sending initialize via transport...");
    match transport.send_message(init_msg).await {
        Ok(response) => {
            println!("✅ Got response: {:?}", response);
            Ok(format!("Transport test successful: {:?}", response))
        }
        Err(e) => {
            println!("❌ Transport send failed: {}", e);
            Err(format!("Transport send failed: {}", e))
        }
    }
}

#[tauri::command]
pub async fn test_stdio_echo(mcp_manager: State<'_, Arc<MCPManager>>) -> Result<String, String> {
    println!("🧪 Testing stdio echo...");

    // Direct test of process spawning
    use crate::mcp::process::ProcessPool;
    use crate::mcp::types::*;

    let config = ServerConfig {
        enabled: true,
        transport: TransportType::Stdio {
            command: "node".to_string(),
            args: vec!["./test-stdio.js".to_string()],
            env: std::collections::HashMap::new(),
            working_dir: None,
        },
        capabilities: RequestedCapabilities {
            tools: true,
            resources: false,
            prompts: false,
            sampling: false,
        },
        permissions: ServerPermissions {
            read: true,
            write: false,
            delete: false,
            external_access: false,
        },
    };

    // Try to spawn process directly
    let pool = ProcessPool::new(mcp_manager.app_handle.clone());
    match pool.spawn(&config).await {
        Ok(handle) => {
            println!("✅ Process spawned successfully!");

            // Try to write a line
            match handle.write_line(r#"{"test": "message"}"#).await {
                Ok(_) => println!("✅ Successfully wrote to stdin"),
                Err(e) => println!("❌ Failed to write: {}", e),
            }

            // Try to read a line
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            match handle.read_stdout_line().await {
                Ok(Some(line)) => println!("✅ Read from stdout: {}", line),
                Ok(None) => println!("❌ EOF on stdout"),
                Err(e) => println!("❌ Failed to read: {}", e),
            }

            // Clean up
            let _ = handle.kill().await;

            Ok("Process spawn test completed - check console for details".to_string())
        }
        Err(e) => {
            println!("❌ Failed to spawn process: {}", e);
            Err(format!("Failed to spawn process: {}", e))
        }
    }
}

#[tauri::command]
pub async fn test_debug_mcp_init() -> Result<String, String> {
    println!("🧪 Debug MCP initialization...");

    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    let mut cmd = Command::new("node");
    cmd.arg("./mcp-servers/test-server/index.js");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Set working directory
    if let Ok(current_dir) = std::env::current_dir() {
        if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                println!("📁 Working directory: {:?}", parent);
                cmd.current_dir(parent);
            }
        }
    }

    println!("🚀 Spawning MCP server...");
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => return Err(format!("Failed to spawn: {}", e)),
    };

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut stdout_reader = BufReader::new(stdout);
    let mut stderr_reader = BufReader::new(stderr);

    // Start stderr reader
    let stderr_handle = tokio::spawn(async move {
        let mut line = String::new();
        while stderr_reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            println!("📕 STDERR: {}", line.trim());
            line.clear();
        }
    });

    // Start stdout reader
    let stdout_handle = tokio::spawn(async move {
        let mut responses = Vec::new();
        let mut line = String::new();
        while stdout_reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            println!("📥 STDOUT: {}", line.trim());
            responses.push(line.trim().to_string());
            line.clear();
        }
        responses
    });

    // Wait for server to start
    println!("⏳ Waiting for server to start...");
    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;

    // Send initialize request
    let request = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}"#;

    println!("📤 Sending: {}", request);
    stdin
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Write failed: {}", e))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("Write newline failed: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Flush failed: {}", e))?;

    // Wait for response
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Kill the process
    let _ = child.kill().await;

    // Get responses
    let responses = stdout_handle.await.unwrap_or_default();

    if responses.is_empty() {
        Err("No response received from MCP server".to_string())
    } else {
        Ok(format!(
            "Received {} responses: {:?}",
            responses.len(),
            responses
        ))
    }
}

#[tauri::command]
pub async fn test_node_basic() -> Result<String, String> {
    println!("🧪 Testing basic Node.js execution...");

    use tokio::process::Command;

    use std::process::Stdio;

    let mut cmd = Command::new("node");
    cmd.arg("./test-simple-node.js");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Set working directory
    if let Ok(current_dir) = std::env::current_dir() {
        println!("📁 Current directory: {:?}", current_dir);
        if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                println!("📁 Setting working directory to: {:?}", parent);
                cmd.current_dir(parent);
            }
        }
    }

    println!("🚀 Spawning Node.js...");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute Node.js: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let status = output.status;

    println!("📥 Exit status: {:?}", status);
    println!("📥 STDOUT: {}", stdout);
    println!("📕 STDERR: {}", stderr);

    Ok(format!(
        "Node.js test - Status: {:?}, Stdout: {}, Stderr: {}",
        status, stdout, stderr
    ))
}

#[tauri::command]
pub async fn test_mcp_spawn_direct() -> Result<String, String> {
    println!("🧪 Testing MCP spawn directly without transport...");

    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let mut cmd = Command::new("node");
    cmd.arg("./mcp-servers/test-server/index.js");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Set working directory
    if let Ok(current_dir) = std::env::current_dir() {
        if current_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                println!("📁 Working directory: {:?}", parent);
                cmd.current_dir(parent);
            }
        }
    }

    println!("🚀 Spawning MCP server...");
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let stdout_reader = BufReader::new(stdout);
    let mut stderr_reader = BufReader::new(stderr);

    // Start reading stderr in background
    let stderr_handle = tokio::spawn(async move {
        let mut messages = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            match stderr_reader.read_line(&mut line).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let msg = line.trim().to_string();
                    println!("📕 STDERR: {}", msg);
                    messages.push(msg);
                }
                Err(e) => {
                    println!("❌ Stderr read error: {}", e);
                    break;
                }
            }
        }
        messages
    });

    // Give server time to start and output initial messages
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Kill the process
    let _ = child.kill().await;

    // Get stderr messages
    let stderr_messages = stderr_handle.await.unwrap_or_default();

    Ok(format!(
        "MCP spawn test - Stderr messages: {:?}",
        stderr_messages
    ))
}
