// Message protocol and routing for IPC communication

use super::{IpcBridgeError, IpcError, IpcMessage};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

type MessageHandler = Arc<dyn Fn(Value) -> Result<Value, IpcError> + Send + Sync>;

/// Routes messages to appropriate handlers
pub struct MessageRouter {
    handlers: HashMap<String, MessageHandler>,
    rate_limits: Arc<RwLock<HashMap<String, RateLimit>>>,
}

impl MessageRouter {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
            rate_limits: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a handler for a specific method
    pub fn register_handler<F>(&mut self, method: &str, handler: F)
    where
        F: Fn(Value) -> Result<Value, IpcError> + Send + Sync + 'static,
    {
        self.handlers.insert(method.to_string(), Arc::new(handler));
    }

    /// Process an incoming message
    pub async fn process_message(&self, message: IpcMessage) -> Result<IpcMessage, IpcBridgeError> {
        match message {
            IpcMessage::Request { id, method, params } => {
                // Check rate limit
                if !self.check_rate_limit(&method).await {
                    return Ok(IpcMessage::Response {
                        id,
                        result: None,
                        error: Some(IpcError {
                            code: -32005,
                            message: "Rate limit exceeded".to_string(),
                            data: None,
                        }),
                    });
                }

                // Find and execute handler
                if let Some(handler) = self.handlers.get(&method) {
                    match handler(params) {
                        Ok(result) => Ok(IpcMessage::Response {
                            id,
                            result: Some(result),
                            error: None,
                        }),
                        Err(error) => Ok(IpcMessage::Response {
                            id,
                            result: None,
                            error: Some(error),
                        }),
                    }
                } else {
                    Ok(IpcMessage::Response {
                        id,
                        result: None,
                        error: Some(IpcError {
                            code: -32601,
                            message: format!("Method not found: {}", method),
                            data: None,
                        }),
                    })
                }
            }
            IpcMessage::Notification {
                ref method,
                ref params,
            } => {
                // Check rate limit
                if !self.check_rate_limit(method).await {
                    return Ok(IpcMessage::Error {
                        code: -32005,
                        message: "Rate limit exceeded".to_string(),
                        data: None,
                    });
                }

                // Process notification (fire and forget)
                if let Some(handler) = self.handlers.get(method) {
                    let _ = handler(params.clone()); // Ignore result for notifications
                }

                Ok(message) // Return original message for notifications
            }
            _ => Ok(message), // Pass through other message types
        }
    }

    /// Check rate limit for a method
    async fn check_rate_limit(&self, method: &str) -> bool {
        let mut limits = self.rate_limits.write().await;

        let limit = limits
            .entry(method.to_string())
            .or_insert_with(|| RateLimit::new(100, 60)); // 100 requests per minute default

        limit.check_and_update()
    }

    /// Set rate limit for a specific method
    pub async fn set_rate_limit(&self, method: &str, max_requests: u32, window_seconds: u64) {
        let mut limits = self.rate_limits.write().await;
        limits.insert(
            method.to_string(),
            RateLimit::new(max_requests, window_seconds),
        );
    }
}

/// Rate limiting implementation
struct RateLimit {
    max_requests: u32,
    window_seconds: u64,
    requests: Vec<std::time::Instant>,
}

impl RateLimit {
    fn new(max_requests: u32, window_seconds: u64) -> Self {
        Self {
            max_requests,
            window_seconds,
            requests: Vec::new(),
        }
    }

    fn check_and_update(&mut self) -> bool {
        let now = std::time::Instant::now();
        let window_start = now - std::time::Duration::from_secs(self.window_seconds);

        // Remove old requests outside the window
        self.requests.retain(|&req_time| req_time > window_start);

        // Check if we're under the limit
        if self.requests.len() < self.max_requests as usize {
            self.requests.push(now);
            true
        } else {
            false
        }
    }
}

/// Message validation utilities
pub struct MessageValidator;

impl MessageValidator {
    /// Validate a request message
    pub fn validate_request(id: &str, method: &str, params: &Value) -> Result<(), IpcBridgeError> {
        if id.is_empty() {
            return Err(IpcBridgeError::InvalidMessage(
                "Request ID cannot be empty".to_string(),
            ));
        }

        if method.is_empty() {
            return Err(IpcBridgeError::InvalidMessage(
                "Method name cannot be empty".to_string(),
            ));
        }

        // Validate method format (should be namespace.method)
        if !method.contains('.') {
            return Err(IpcBridgeError::InvalidMessage(format!(
                "Invalid method format: {}. Expected namespace.method",
                method
            )));
        }

        Ok(())
    }

    /// Validate parameter types for specific methods
    pub fn validate_params(method: &str, params: &Value) -> Result<(), IpcBridgeError> {
        match method {
            "vault.read" => {
                if !params.is_object() || !params.get("path").is_some() {
                    return Err(IpcBridgeError::InvalidMessage(
                        "vault.read requires 'path' parameter".to_string(),
                    ));
                }
            }
            "vault.write" => {
                if !params.is_object()
                    || !params.get("path").is_some()
                    || !params.get("content").is_some()
                {
                    return Err(IpcBridgeError::InvalidMessage(
                        "vault.write requires 'path' and 'content' parameters".to_string(),
                    ));
                }
            }
            _ => {
                // No specific validation for other methods
            }
        }

        Ok(())
    }

    /// Sanitize parameters to prevent injection attacks
    pub fn sanitize_params(params: &mut Value) {
        if let Some(obj) = params.as_object_mut() {
            for (_, value) in obj.iter_mut() {
                if let Some(s) = value.as_str() {
                    // Remove potential script tags or dangerous content
                    let sanitized = s
                        .replace("<script", "&lt;script")
                        .replace("</script>", "&lt;/script&gt;")
                        .replace("javascript:", "");
                    *value = Value::String(sanitized);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_message_router() {
        let mut router = MessageRouter::new();

        // Register a test handler
        router.register_handler("test.echo", |params| Ok(params));

        // Process a request
        let request = IpcMessage::Request {
            id: "1".to_string(),
            method: "test.echo".to_string(),
            params: json!({"message": "hello"}),
        };

        let response = router.process_message(request).await.unwrap();

        match response {
            IpcMessage::Response { id, result, error } => {
                assert_eq!(id, "1");
                assert!(result.is_some());
                assert!(error.is_none());
                assert_eq!(result.unwrap(), json!({"message": "hello"}));
            }
            _ => panic!("Expected response message"),
        }
    }

    #[tokio::test]
    async fn test_method_not_found() {
        let router = MessageRouter::new();

        let request = IpcMessage::Request {
            id: "1".to_string(),
            method: "unknown.method".to_string(),
            params: json!({}),
        };

        let response = router.process_message(request).await.unwrap();

        match response {
            IpcMessage::Response { error, .. } => {
                assert!(error.is_some());
                let err = error.unwrap();
                assert_eq!(err.code, -32601);
                assert!(err.message.contains("Method not found"));
            }
            _ => panic!("Expected error response"),
        }
    }

    #[test]
    fn test_rate_limit() {
        let mut limit = RateLimit::new(3, 1);

        // First 3 requests should pass
        assert!(limit.check_and_update());
        assert!(limit.check_and_update());
        assert!(limit.check_and_update());

        // 4th request should fail
        assert!(!limit.check_and_update());

        // After waiting, should pass again
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(limit.check_and_update());
    }

    #[test]
    fn test_message_validation() {
        // Valid request
        let result = MessageValidator::validate_request("1", "vault.read", &json!({}));
        assert!(result.is_ok());

        // Empty ID
        let result = MessageValidator::validate_request("", "vault.read", &json!({}));
        assert!(result.is_err());

        // Empty method
        let result = MessageValidator::validate_request("1", "", &json!({}));
        assert!(result.is_err());

        // Invalid method format
        let result = MessageValidator::validate_request("1", "invalidmethod", &json!({}));
        assert!(result.is_err());
    }

    #[test]
    fn test_param_validation() {
        // Valid vault.read params
        let result = MessageValidator::validate_params("vault.read", &json!({"path": "/test"}));
        assert!(result.is_ok());

        // Missing required param
        let result = MessageValidator::validate_params("vault.read", &json!({}));
        assert!(result.is_err());

        // Valid vault.write params
        let result = MessageValidator::validate_params(
            "vault.write",
            &json!({
                "path": "/test",
                "content": "data"
            }),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_param_sanitization() {
        let mut params = json!({
            "content": "<script>alert('xss')</script>",
            "safe": "normal text"
        });

        MessageValidator::sanitize_params(&mut params);

        assert_eq!(
            params["content"].as_str().unwrap(),
            "&lt;script&gt;alert('xss')&lt;/script&gt;"
        );
        assert_eq!(params["safe"].as_str().unwrap(), "normal text");
    }
}
