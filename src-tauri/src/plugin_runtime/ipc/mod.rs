// IPC Bridge Module - Secure communication between plugins and Vault core

pub mod bridge;
pub mod channel;
#[cfg(test)]
mod integration_test;
pub mod plugin_api_handler;
pub mod protocol;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// IPC message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcMessage {
    Request {
        id: String,
        method: String,
        params: Value,
    },
    Response {
        id: String,
        result: Option<Value>,
        error: Option<IpcError>,
    },
    Notification {
        method: String,
        params: Value,
    },
    Error {
        code: i32,
        message: String,
        data: Option<Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<Value>,
}

/// IPC bridge for managing plugin communication
pub struct IpcBridge {
    channels: Arc<RwLock<HashMap<String, channel::IpcChannel>>>,
    router: Arc<RwLock<protocol::MessageRouter>>,
}

impl IpcBridge {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
            router: Arc::new(RwLock::new(protocol::MessageRouter::new())),
        }
    }

    /// Create a new IPC channel for a plugin
    pub async fn create_channel(&self, plugin_id: &str) -> Result<(), IpcBridgeError> {
        let mut channels = self.channels.write().await;

        if channels.contains_key(plugin_id) {
            return Err(IpcBridgeError::ChannelAlreadyExists);
        }

        let channel = channel::IpcChannel::new(plugin_id.to_string());
        channels.insert(plugin_id.to_string(), channel);

        Ok(())
    }

    /// Send a message to a plugin
    pub async fn send_to_plugin(
        &self,
        plugin_id: &str,
        message: IpcMessage,
    ) -> Result<(), IpcBridgeError> {
        let channels = self.channels.read().await;

        let channel = channels
            .get(plugin_id)
            .ok_or(IpcBridgeError::ChannelNotFound)?;

        channel
            .send(message)
            .await
            .map_err(|e| IpcBridgeError::SendFailed(e.to_string()))
    }

    /// Receive a message from a plugin
    pub async fn receive_from_plugin(&self, plugin_id: &str) -> Result<IpcMessage, IpcBridgeError> {
        let channels = self.channels.read().await;

        let channel = channels
            .get(plugin_id)
            .ok_or(IpcBridgeError::ChannelNotFound)?;

        channel
            .receive()
            .await
            .map_err(|e| IpcBridgeError::ReceiveFailed(e.to_string()))
    }

    /// Close an IPC channel
    pub async fn close_channel(&self, plugin_id: &str) -> Result<(), IpcBridgeError> {
        let mut channels = self.channels.write().await;

        if let Some(mut channel) = channels.remove(plugin_id) {
            channel.close().await;
        }

        Ok(())
    }

    /// Register a message handler
    pub async fn register_handler<F>(&self, method: &str, handler: F)
    where
        F: Fn(Value) -> Result<Value, IpcError> + Send + Sync + 'static,
    {
        let mut router = self.router.write().await;
        router.register_handler(method, handler);
    }

    /// Process an incoming message through the router
    pub async fn process_message(&self, message: IpcMessage) -> Result<IpcMessage, IpcBridgeError> {
        let router = self.router.read().await;
        router.process_message(message).await
    }

    /// Get channel metrics
    pub async fn get_channel_metrics(&self, plugin_id: &str) -> Option<ChannelMetrics> {
        let channels = self.channels.read().await;

        channels.get(plugin_id).map(|channel| ChannelMetrics {
            plugin_id: plugin_id.to_string(),
            messages_sent: channel.messages_sent(),
            messages_received: channel.messages_received(),
            is_open: channel.is_open(),
        })
    }

    /// List all active channels
    pub async fn list_channels(&self) -> Vec<String> {
        let channels = self.channels.read().await;
        channels.keys().cloned().collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelMetrics {
    pub plugin_id: String,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub is_open: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum IpcBridgeError {
    #[error("Channel already exists")]
    ChannelAlreadyExists,

    #[error("Channel not found")]
    ChannelNotFound,

    #[error("Failed to send message: {0}")]
    SendFailed(String),

    #[error("Failed to receive message: {0}")]
    ReceiveFailed(String),

    #[error("Message processing failed: {0}")]
    ProcessingFailed(String),

    #[error("Invalid message format: {0}")]
    InvalidMessage(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_ipc_bridge_creation() {
        let bridge = IpcBridge::new();
        let channels = bridge.list_channels().await;
        assert_eq!(channels.len(), 0);
    }

    #[tokio::test]
    async fn test_create_and_close_channel() {
        let bridge = IpcBridge::new();

        // Create channel
        let result = bridge.create_channel("test_plugin").await;
        assert!(result.is_ok());

        let channels = bridge.list_channels().await;
        assert_eq!(channels.len(), 1);
        assert!(channels.contains(&"test_plugin".to_string()));

        // Try to create duplicate
        let result = bridge.create_channel("test_plugin").await;
        assert!(result.is_err());

        // Close channel
        let result = bridge.close_channel("test_plugin").await;
        assert!(result.is_ok());

        let channels = bridge.list_channels().await;
        assert_eq!(channels.len(), 0);
    }

    #[tokio::test]
    async fn test_channel_metrics() {
        let bridge = IpcBridge::new();
        bridge.create_channel("test_plugin").await.unwrap();

        let metrics = bridge.get_channel_metrics("test_plugin").await;
        assert!(metrics.is_some());

        let metrics = metrics.unwrap();
        assert_eq!(metrics.plugin_id, "test_plugin");
        assert_eq!(metrics.messages_sent, 0);
        assert_eq!(metrics.messages_received, 0);
        assert!(metrics.is_open);
    }

    #[tokio::test]
    async fn test_message_types() {
        // Test request message
        let request = IpcMessage::Request {
            id: "123".to_string(),
            method: "test.method".to_string(),
            params: json!({"key": "value"}),
        };

        let serialized = serde_json::to_string(&request).unwrap();
        let deserialized: IpcMessage = serde_json::from_str(&serialized).unwrap();

        match deserialized {
            IpcMessage::Request { id, method, .. } => {
                assert_eq!(id, "123");
                assert_eq!(method, "test.method");
            }
            _ => panic!("Wrong message type"),
        }

        // Test response message
        let response = IpcMessage::Response {
            id: "123".to_string(),
            result: Some(json!({"success": true})),
            error: None,
        };

        let serialized = serde_json::to_string(&response).unwrap();
        let deserialized: IpcMessage = serde_json::from_str(&serialized).unwrap();

        match deserialized {
            IpcMessage::Response { id, result, error } => {
                assert_eq!(id, "123");
                assert!(result.is_some());
                assert!(error.is_none());
            }
            _ => panic!("Wrong message type"),
        }
    }
}
