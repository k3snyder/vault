/// STDIO Transport implementation for MCP server

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::debug;

use crate::protocol::{JsonRpcRequest, JsonRpcResponse};

pub struct StdioTransport {
    stdin: Arc<Mutex<BufReader<tokio::io::Stdin>>>,
    stdout: Arc<Mutex<tokio::io::Stdout>>,
}

impl StdioTransport {
    pub fn new() -> Self {
        Self {
            stdin: Arc::new(Mutex::new(BufReader::new(tokio::io::stdin()))),
            stdout: Arc::new(Mutex::new(tokio::io::stdout())),
        }
    }

    /// Read a JSON-RPC message from stdin
    pub async fn read_message(&self) -> Result<Option<JsonRpcRequest>> {
        let debug_enabled = std::env::var("MCP_DEBUG").is_ok();
        let mut stdin = self.stdin.lock().await;
        
        if debug_enabled {
            eprintln!("[Rust Filesystem Server] Waiting for message...");
        }
        
        // Read Content-Length header
        let mut header_line = String::new();
        let bytes_read = stdin.read_line(&mut header_line).await?;
        
        if bytes_read == 0 {
            // EOF reached
            if debug_enabled {
                eprintln!("[Rust Filesystem Server] EOF reached");
            }
            return Ok(None);
        }

        if debug_enabled {
            eprintln!("[Rust Filesystem Server] Read header line: {:?}", header_line);
        }
        
        let header_line = header_line.trim();
        if header_line.is_empty() {
            return Err(anyhow!("Empty header line"));
        }

        // Parse Content-Length
        let content_length = if let Some(length_str) = header_line.strip_prefix("Content-Length: ") {
            let len = length_str.parse::<usize>()?;
            if debug_enabled {
                eprintln!("[Rust Filesystem Server] Content-Length: {}", len);
            }
            len
        } else {
            return Err(anyhow!("Invalid Content-Length header: {}", header_line));
        };

        // Skip empty line after headers
        let mut empty_line = String::new();
        stdin.read_line(&mut empty_line).await?;

        // Read the JSON content
        let mut buffer = vec![0; content_length];
        stdin.read_exact(&mut buffer).await?;

        // Parse JSON-RPC request
        let request: JsonRpcRequest = serde_json::from_slice(&buffer)?;
        
        debug!("Received request: {} (id: {:?})", request.method, request.id);
        
        Ok(Some(request))
    }

    /// Write a JSON-RPC response to stdout
    pub async fn write_response(&self, response: &JsonRpcResponse) -> Result<()> {
        let debug_enabled = std::env::var("MCP_DEBUG").is_ok();
        let response_str = serde_json::to_string(response)?;
        let content_length = response_str.len();
        
        if debug_enabled {
            eprintln!("[Rust Filesystem Server] Writing response: {} bytes, id={:?}", content_length, response.id);
            eprintln!("[Rust Filesystem Server] Response content: {}", response_str);
        }
        
        let mut stdout = self.stdout.lock().await;
        
        // Write Content-Length header
        let header = format!("Content-Length: {}\r\n\r\n", content_length);
        stdout.write_all(header.as_bytes()).await?;
        
        // Write JSON content
        stdout.write_all(response_str.as_bytes()).await?;
        stdout.flush().await?;
        
        if debug_enabled {
            eprintln!("[Rust Filesystem Server] Response sent successfully");
        }
        debug!("Sent response: id={:?}", response.id);
        
        Ok(())
    }

    /// Send an error response
    pub async fn send_error(&self, id: Option<Value>, code: i32, message: String) -> Result<()> {
        let response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(crate::protocol::JsonRpcError {
                code,
                message,
                data: None,
            }),
        };
        
        self.write_response(&response).await
    }
}