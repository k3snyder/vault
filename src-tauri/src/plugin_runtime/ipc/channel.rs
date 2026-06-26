// IPC Channel implementation for bidirectional communication

use super::{IpcBridgeError, IpcMessage};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::sync::RwLock;

/// Represents a bidirectional IPC channel
pub struct IpcChannel {
    plugin_id: String,
    sender: mpsc::Sender<IpcMessage>,
    receiver: Arc<RwLock<mpsc::Receiver<IpcMessage>>>,
    plugin_sender: mpsc::Sender<IpcMessage>,
    plugin_receiver: Arc<RwLock<mpsc::Receiver<IpcMessage>>>,
    messages_sent: AtomicU64,
    messages_received: AtomicU64,
    is_open: AtomicBool,
}

impl IpcChannel {
    /// Create a new IPC channel
    pub fn new(plugin_id: String) -> Self {
        // Create channels for core -> plugin communication
        let (sender, receiver) = mpsc::channel(100);

        // Create channels for plugin -> core communication
        let (plugin_sender, plugin_receiver) = mpsc::channel(100);

        Self {
            plugin_id,
            sender,
            receiver: Arc::new(RwLock::new(receiver)),
            plugin_sender,
            plugin_receiver: Arc::new(RwLock::new(plugin_receiver)),
            messages_sent: AtomicU64::new(0),
            messages_received: AtomicU64::new(0),
            is_open: AtomicBool::new(true),
        }
    }

    /// Send a message to the plugin
    pub async fn send(&self, message: IpcMessage) -> Result<(), IpcBridgeError> {
        if !self.is_open.load(Ordering::Relaxed) {
            return Err(IpcBridgeError::ChannelNotFound);
        }

        self.sender
            .send_timeout(message, Duration::from_secs(5))
            .await
            .map_err(|e| IpcBridgeError::SendFailed(e.to_string()))?;

        self.messages_sent.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// Receive a message from the plugin
    pub async fn receive(&self) -> Result<IpcMessage, IpcBridgeError> {
        if !self.is_open.load(Ordering::Relaxed) {
            return Err(IpcBridgeError::ChannelNotFound);
        }

        let mut receiver = self.plugin_receiver.write().await;

        match receiver.recv().await {
            Some(message) => {
                self.messages_received.fetch_add(1, Ordering::Relaxed);
                Ok(message)
            }
            None => Err(IpcBridgeError::ReceiveFailed("Channel closed".to_string())),
        }
    }

    /// Send a message from the plugin side
    pub async fn send_from_plugin(&self, message: IpcMessage) -> Result<(), IpcBridgeError> {
        if !self.is_open.load(Ordering::Relaxed) {
            return Err(IpcBridgeError::ChannelNotFound);
        }

        self.plugin_sender
            .send_timeout(message, Duration::from_secs(5))
            .await
            .map_err(|e| IpcBridgeError::SendFailed(e.to_string()))?;

        Ok(())
    }

    /// Receive a message on the plugin side
    pub async fn receive_on_plugin(&self) -> Result<IpcMessage, IpcBridgeError> {
        if !self.is_open.load(Ordering::Relaxed) {
            return Err(IpcBridgeError::ChannelNotFound);
        }

        let mut receiver = self.receiver.write().await;

        match receiver.recv().await {
            Some(message) => Ok(message),
            None => Err(IpcBridgeError::ReceiveFailed("Channel closed".to_string())),
        }
    }

    /// Close the channel
    pub async fn close(&mut self) {
        self.is_open.store(false, Ordering::Relaxed);
        // Channels will be dropped when the struct is dropped
    }

    /// Check if the channel is open
    pub fn is_open(&self) -> bool {
        self.is_open.load(Ordering::Relaxed)
    }

    /// Get the number of messages sent
    pub fn messages_sent(&self) -> u64 {
        self.messages_sent.load(Ordering::Relaxed)
    }

    /// Get the number of messages received
    pub fn messages_received(&self) -> u64 {
        self.messages_received.load(Ordering::Relaxed)
    }

    /// Get the plugin ID
    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_channel_creation() {
        let channel = IpcChannel::new("test_plugin".to_string());
        assert_eq!(channel.plugin_id(), "test_plugin");
        assert!(channel.is_open());
        assert_eq!(channel.messages_sent(), 0);
        assert_eq!(channel.messages_received(), 0);
    }

    #[tokio::test]
    async fn test_channel_send_receive() {
        let channel = IpcChannel::new("test_plugin".to_string());

        // Send from core to plugin
        let message = IpcMessage::Notification {
            method: "test.notification".to_string(),
            params: json!({"data": "test"}),
        };

        let send_result = channel.send(message.clone()).await;
        assert!(send_result.is_ok());
        assert_eq!(channel.messages_sent(), 1);

        // Receive on plugin side
        let received = channel.receive_on_plugin().await;
        assert!(received.is_ok());

        match received.unwrap() {
            IpcMessage::Notification { method, .. } => {
                assert_eq!(method, "test.notification");
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[tokio::test]
    async fn test_bidirectional_communication() {
        let channel = IpcChannel::new("test_plugin".to_string());

        // Send from plugin to core
        let message = IpcMessage::Request {
            id: "req_1".to_string(),
            method: "vault.read".to_string(),
            params: json!({"path": "/test"}),
        };

        let send_result = channel.send_from_plugin(message).await;
        assert!(send_result.is_ok());

        // Receive on core side
        let received = channel.receive().await;
        assert!(received.is_ok());
        assert_eq!(channel.messages_received(), 1);

        match received.unwrap() {
            IpcMessage::Request { id, method, .. } => {
                assert_eq!(id, "req_1");
                assert_eq!(method, "vault.read");
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[tokio::test]
    async fn test_channel_close() {
        let mut channel = IpcChannel::new("test_plugin".to_string());
        assert!(channel.is_open());

        channel.close().await;
        assert!(!channel.is_open());

        // Sending should fail after close
        let message = IpcMessage::Notification {
            method: "test".to_string(),
            params: json!({}),
        };

        let result = channel.send(message).await;
        assert!(result.is_err());
    }
}
