// IPC Bridge implementation for plugin communication management

use super::{IpcBridgeError, IpcError, IpcMessage};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Bridge configuration
#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub max_message_size: usize,
    pub timeout_ms: u64,
    pub enable_logging: bool,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            max_message_size: 1024 * 1024, // 1MB
            timeout_ms: 5000,
            enable_logging: false,
        }
    }
}

/// IPC Bridge implementation
pub struct Bridge {
    config: BridgeConfig,
    message_queue: Arc<RwLock<Vec<QueuedMessage>>>,
}

#[derive(Debug, Clone)]
struct QueuedMessage {
    plugin_id: String,
    message: IpcMessage,
    timestamp: std::time::Instant,
}

impl Bridge {
    pub fn new(config: BridgeConfig) -> Self {
        Self {
            config,
            message_queue: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Queue a message for delivery
    pub async fn queue_message(
        &self,
        plugin_id: String,
        message: IpcMessage,
    ) -> Result<(), IpcBridgeError> {
        // Check message size
        let serialized = serde_json::to_string(&message)
            .map_err(|e| IpcBridgeError::InvalidMessage(e.to_string()))?;

        if serialized.len() > self.config.max_message_size {
            return Err(IpcBridgeError::InvalidMessage(format!(
                "Message exceeds maximum size of {} bytes",
                self.config.max_message_size
            )));
        }

        let queued = QueuedMessage {
            plugin_id,
            message,
            timestamp: std::time::Instant::now(),
        };

        let mut queue = self.message_queue.write().await;
        queue.push(queued);

        // Clean up old messages
        let timeout = std::time::Duration::from_millis(self.config.timeout_ms);
        let now = std::time::Instant::now();
        queue.retain(|msg| now.duration_since(msg.timestamp) < timeout);

        Ok(())
    }

    /// Get queued messages for a plugin
    pub async fn get_queued_messages(&self, plugin_id: &str) -> Vec<IpcMessage> {
        let mut queue = self.message_queue.write().await;
        let mut messages = Vec::new();

        queue.retain(|msg| {
            if msg.plugin_id == plugin_id {
                messages.push(msg.message.clone());
                false // Remove from queue
            } else {
                true // Keep in queue
            }
        });

        messages
    }

    /// Create a response for a request
    pub fn create_response(request_id: String, result: Result<Value, IpcError>) -> IpcMessage {
        match result {
            Ok(value) => IpcMessage::Response {
                id: request_id,
                result: Some(value),
                error: None,
            },
            Err(error) => IpcMessage::Response {
                id: request_id,
                result: None,
                error: Some(error),
            },
        }
    }

    /// Create an error message
    pub fn create_error(code: i32, message: String, data: Option<Value>) -> IpcMessage {
        IpcMessage::Error {
            code,
            message,
            data,
        }
    }

    /// Log a message if logging is enabled
    pub fn log_message(&self, plugin_id: &str, direction: &str, message: &IpcMessage) {
        if self.config.enable_logging {
            println!(
                "[IPC Bridge] {} {} {}: {:?}",
                chrono::Local::now().format("%H:%M:%S%.3f"),
                plugin_id,
                direction,
                message
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_bridge_creation() {
        let config = BridgeConfig::default();
        let bridge = Bridge::new(config);

        let messages = bridge.get_queued_messages("test").await;
        assert_eq!(messages.len(), 0);
    }

    #[tokio::test]
    async fn test_message_queueing() {
        let bridge = Bridge::new(BridgeConfig::default());

        let message = IpcMessage::Notification {
            method: "test".to_string(),
            params: json!({}),
        };

        let result = bridge
            .queue_message("plugin1".to_string(), message.clone())
            .await;
        assert!(result.is_ok());

        let messages = bridge.get_queued_messages("plugin1").await;
        assert_eq!(messages.len(), 1);

        // Should be empty after retrieval
        let messages = bridge.get_queued_messages("plugin1").await;
        assert_eq!(messages.len(), 0);
    }

    #[tokio::test]
    async fn test_message_size_limit() {
        let mut config = BridgeConfig::default();
        config.max_message_size = 100; // Very small limit
        let bridge = Bridge::new(config);

        let large_data = "x".repeat(200);
        let message = IpcMessage::Notification {
            method: "test".to_string(),
            params: json!({"data": large_data}),
        };

        let result = bridge.queue_message("plugin1".to_string(), message).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_create_response() {
        let response = Bridge::create_response("req1".to_string(), Ok(json!({"success": true})));

        match response {
            IpcMessage::Response { id, result, error } => {
                assert_eq!(id, "req1");
                assert!(result.is_some());
                assert!(error.is_none());
            }
            _ => panic!("Wrong message type"),
        }

        let error_response = Bridge::create_response(
            "req2".to_string(),
            Err(IpcError {
                code: -1,
                message: "Failed".to_string(),
                data: None,
            }),
        );

        match error_response {
            IpcMessage::Response { id, result, error } => {
                assert_eq!(id, "req2");
                assert!(result.is_none());
                assert!(error.is_some());
            }
            _ => panic!("Wrong message type"),
        }
    }
}
