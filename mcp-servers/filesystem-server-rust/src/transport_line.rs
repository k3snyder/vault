/// Line-based transport for compatibility with the app
use anyhow::{Result, anyhow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use serde_json::Value;

use crate::protocol::{JsonRpcRequest, JsonRpcResponse};

pub struct LineTransport {
    stdin: BufReader<tokio::io::Stdin>,
    stdout: tokio::io::Stdout,
}

impl LineTransport {
    pub fn new() -> Self {
        Self {
            stdin: BufReader::new(tokio::io::stdin()),
            stdout: tokio::io::stdout(),
        }
    }

    /// Read a line-based JSON message
    pub async fn read_message(&mut self) -> Result<Option<JsonRpcRequest>> {
        loop {
            let mut line = String::new();
            match self.stdin.read_line(&mut line).await {
                Ok(0) => return Ok(None), // EOF
                Ok(_) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        // Parse JSON from line
                        let request: JsonRpcRequest = serde_json::from_str(trimmed)
                            .map_err(|e| anyhow!("Failed to parse JSON: {}", e))?;
                        return Ok(Some(request));
                    }
                    // Empty line, continue loop
                }
                Err(e) => return Err(anyhow!("Failed to read line: {}", e)),
            }
        }
    }

    /// Write a line-based JSON response
    pub async fn write_response(&mut self, response: &JsonRpcResponse) -> Result<()> {
        let json_str = serde_json::to_string(response)?;
        self.stdout.write_all(json_str.as_bytes()).await?;
        self.stdout.write_all(b"\n").await?;
        self.stdout.flush().await?;
        Ok(())
    }

    /// Send an error response
    pub async fn send_error(&mut self, id: Option<Value>, code: i32, message: String) -> Result<()> {
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