// Network API - Controlled network access for plugins
// Provides HTTP/HTTPS fetch operations with domain allowlisting and security controls

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use url::Url;

use crate::plugin_runtime::permissions::{Capability, Permission, PermissionManager};
use crate::plugin_runtime::resources::ResourceMonitor;

#[cfg(test)]
mod tests;

/// Network permissions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NetworkPermission {
    Fetch,
    WebSocket,
    Stream,
}

/// Network API errors
#[derive(Debug, thiserror::Error)]
pub enum NetworkError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Domain not allowed: {0}")]
    DomainNotAllowed(String),

    #[error("Insecure protocol: {0}")]
    InsecureProtocol(String),

    #[error("IP literal not allowed: {0}")]
    IpLiteralNotAllowed(String),

    #[error("Request too large: {0}")]
    RequestTooLarge(String),

    #[error("Response too large: {0}")]
    ResponseTooLarge(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("DNS resolution failed: {0}")]
    DnsResolutionFailed(String),

    #[error("Connection refused: {0}")]
    ConnectionRefused(String),

    #[error("Redirect to disallowed domain: {0}")]
    RedirectToDisallowedDomain(String),

    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    #[error("Network error: {0}")]
    NetworkError(String),
}

/// HTTP methods
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Head,
    Options,
}

/// Fetch request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchRequest {
    pub url: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

/// Fetch response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub final_url: String,
}

/// Stream response for large files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamResponse {
    pub stream_id: String,
    pub is_streaming: bool,
}

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WebSocketMessage {
    Text(String),
    Binary(Vec<u8>),
    Close,
}

/// Mock response for testing
#[cfg(test)]
pub struct MockResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub url: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>,
    pub timestamp: u64,
}

/// Rate limit info
struct RateLimitInfo {
    requests: Vec<std::time::Instant>,
    max_requests: usize,
    window: Duration,
}

/// Domain rate limit
struct DomainRateLimit {
    domain: String,
    limit: RateLimitInfo,
}

/// WebSocket connection
struct WebSocketConnection {
    id: String,
    url: String,
    plugin_id: String,
    created_at: std::time::Instant,
}

/// Network state
struct NetworkState {
    allowed_domains: HashMap<String, Vec<String>>, // plugin_id -> domains
    https_upgrade: HashMap<String, bool>,          // plugin_id -> enabled
    request_size_limits: HashMap<String, usize>,   // plugin_id -> bytes
    response_size_limits: HashMap<String, usize>,  // plugin_id -> bytes
    streaming_enabled: HashMap<String, bool>,      // plugin_id -> enabled
    rate_limits: HashMap<String, RateLimitInfo>,   // plugin_id -> limit
    domain_rate_limits: HashMap<String, Vec<DomainRateLimit>>, // plugin_id -> limits
    websocket_connections: HashMap<String, WebSocketConnection>, // connection_id -> connection
    audit_logs: HashMap<String, Vec<AuditLogEntry>>, // plugin_id -> logs
    audit_enabled: HashMap<String, bool>,          // plugin_id -> enabled
    connection_pooling: HashMap<String, bool>,     // plugin_id -> enabled
    #[cfg(test)]
    mock_responses: HashMap<String, MockResponse>,
    #[cfg(test)]
    mock_redirects: HashMap<String, String>,
    #[cfg(test)]
    mock_timeouts: HashMap<String, bool>,
    #[cfg(test)]
    mock_dns_failures: HashMap<String, bool>,
}

/// Network API implementation
pub struct NetworkApi {
    permission_manager: Arc<RwLock<PermissionManager>>,
    state: Arc<RwLock<NetworkState>>,
    resource_monitor: Option<Arc<ResourceMonitor>>,
}

impl NetworkApi {
    /// Create a new Network API instance
    pub fn new(permission_manager: Arc<RwLock<PermissionManager>>) -> Self {
        Self {
            permission_manager,
            resource_monitor: None,
            state: Arc::new(RwLock::new(NetworkState {
                allowed_domains: HashMap::new(),
                https_upgrade: HashMap::new(),
                request_size_limits: HashMap::new(),
                response_size_limits: HashMap::new(),
                streaming_enabled: HashMap::new(),
                rate_limits: HashMap::new(),
                domain_rate_limits: HashMap::new(),
                websocket_connections: HashMap::new(),
                audit_logs: HashMap::new(),
                audit_enabled: HashMap::new(),
                connection_pooling: HashMap::new(),
                #[cfg(test)]
                mock_responses: HashMap::new(),
                #[cfg(test)]
                mock_redirects: HashMap::new(),
                #[cfg(test)]
                mock_timeouts: HashMap::new(),
                #[cfg(test)]
                mock_dns_failures: HashMap::new(),
            })),
        }
    }

    /// Set the resource monitor for tracking network usage
    pub fn set_resource_monitor(&mut self, monitor: Arc<ResourceMonitor>) {
        self.resource_monitor = Some(monitor);
    }

    /// Grant a permission to a plugin (for testing)
    #[cfg(test)]
    pub async fn grant_permission(&self, plugin_id: &str, permission: NetworkPermission) {
        let capability = match permission {
            NetworkPermission::Fetch => Capability::NetworkAccess {
                domains: vec!["*".to_string()],
            },
            NetworkPermission::WebSocket => Capability::NetworkAccess {
                domains: vec!["ws:*".to_string()],
            },
            NetworkPermission::Stream => Capability::NetworkAccess {
                domains: vec!["stream:*".to_string()],
            },
        };

        let perm = Permission {
            capability,
            granted: true,
            granted_at: Some(chrono::Utc::now()),
            expires_at: None,
        };

        let manager = self.permission_manager.read().await;
        manager
            .grant_permissions(plugin_id, vec![perm])
            .await
            .unwrap();
    }

    /// Grant domain permission to a plugin
    pub async fn grant_domain_permission(&self, plugin_id: &str, domain: &str) {
        let mut state = self.state.write().await;
        let domains = state
            .allowed_domains
            .entry(plugin_id.to_string())
            .or_insert_with(Vec::new);
        if !domains.contains(&domain.to_string()) {
            domains.push(domain.to_string());
        }
    }

    /// Check if plugin has permission
    async fn check_permission(
        &self,
        plugin_id: &str,
        permission: NetworkPermission,
    ) -> Result<(), NetworkError> {
        let capability = match permission {
            NetworkPermission::Fetch => Capability::NetworkAccess {
                domains: vec!["*".to_string()],
            },
            NetworkPermission::WebSocket => Capability::NetworkAccess {
                domains: vec!["ws:*".to_string()],
            },
            NetworkPermission::Stream => Capability::NetworkAccess {
                domains: vec!["stream:*".to_string()],
            },
        };

        let manager = self.permission_manager.read().await;
        if !manager.has_capability(plugin_id, &capability).await {
            return Err(NetworkError::PermissionDenied(format!(
                "Plugin {} lacks network permission: {:?}",
                plugin_id, permission
            )));
        }
        Ok(())
    }

    /// Check if domain is allowed
    async fn check_domain(&self, plugin_id: &str, url: &str) -> Result<String, NetworkError> {
        let parsed_url = Url::parse(url).map_err(|e| NetworkError::InvalidUrl(e.to_string()))?;
        let domain = parsed_url
            .host_str()
            .ok_or_else(|| NetworkError::InvalidUrl("No host in URL".to_string()))?;

        // Check for IP literals
        if domain.parse::<std::net::IpAddr>().is_ok()
            && domain != "localhost"
            && !domain.starts_with("127.")
        {
            return Err(NetworkError::IpLiteralNotAllowed(domain.to_string()));
        }

        let state = self.state.read().await;

        if let Some(allowed) = state.allowed_domains.get(plugin_id) {
            // Check exact match
            if allowed.contains(&domain.to_string()) {
                return Ok(domain.to_string());
            }

            // Check wildcard match
            for allowed_domain in allowed {
                if allowed_domain.starts_with("*.") {
                    let suffix = &allowed_domain[2..];
                    if domain.ends_with(suffix) || domain == suffix {
                        return Ok(domain.to_string());
                    }
                }
            }

            return Err(NetworkError::DomainNotAllowed(domain.to_string()));
        }

        Err(NetworkError::PermissionDenied(
            "No domains allowed".to_string(),
        ))
    }

    /// Check and enforce HTTPS
    async fn check_https(&self, plugin_id: &str, url: &str) -> Result<String, NetworkError> {
        let parsed_url = Url::parse(url).map_err(|e| NetworkError::InvalidUrl(e.to_string()))?;

        // Allow HTTP for localhost
        if let Some(host) = parsed_url.host_str() {
            if host == "localhost" || host.starts_with("127.") || host == "::1" {
                return Ok(url.to_string());
            }
        }

        // Check if HTTPS upgrade is enabled
        let state = self.state.read().await;
        let should_upgrade = state.https_upgrade.get(plugin_id).copied().unwrap_or(false);

        if parsed_url.scheme() == "http" {
            if should_upgrade {
                // Upgrade to HTTPS
                let mut upgraded = parsed_url.clone();
                let _ = upgraded.set_scheme("https");
                return Ok(upgraded.to_string());
            } else {
                return Err(NetworkError::InsecureProtocol(
                    "HTTP not allowed".to_string(),
                ));
            }
        }

        Ok(url.to_string())
    }

    /// Check request size
    async fn check_request_size(
        &self,
        plugin_id: &str,
        body: &Option<String>,
    ) -> Result<(), NetworkError> {
        if let Some(body) = body {
            let state = self.state.read().await;
            if let Some(&limit) = state.request_size_limits.get(plugin_id) {
                if body.len() > limit {
                    return Err(NetworkError::RequestTooLarge(format!(
                        "Request body size {} exceeds limit {}",
                        body.len(),
                        limit
                    )));
                }
            }
        }
        Ok(())
    }

    /// Check rate limit
    async fn check_rate_limit(
        &self,
        plugin_id: &str,
        domain: Option<&str>,
    ) -> Result<(), NetworkError> {
        let mut state = self.state.write().await;
        let now = std::time::Instant::now();

        // Check plugin-wide rate limit
        if let Some(limit) = state.rate_limits.get_mut(plugin_id) {
            limit
                .requests
                .retain(|&t| now.duration_since(t) < limit.window);

            if limit.requests.len() >= limit.max_requests {
                return Err(NetworkError::RateLimited(format!(
                    "Plugin {} exceeded rate limit",
                    plugin_id
                )));
            }

            limit.requests.push(now);
        }

        // Check domain-specific rate limit
        if let Some(domain) = domain {
            if let Some(domain_limits) = state.domain_rate_limits.get_mut(plugin_id) {
                for domain_limit in domain_limits {
                    if domain_limit.domain == domain {
                        domain_limit
                            .limit
                            .requests
                            .retain(|&t| now.duration_since(t) < domain_limit.limit.window);

                        if domain_limit.limit.requests.len() >= domain_limit.limit.max_requests {
                            return Err(NetworkError::RateLimited(format!(
                                "Rate limit exceeded for domain {}",
                                domain
                            )));
                        }

                        domain_limit.limit.requests.push(now);
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    /// Log request for audit
    async fn log_request(&self, plugin_id: &str, request: &FetchRequest) {
        let state = self.state.read().await;
        if !state.audit_enabled.get(plugin_id).copied().unwrap_or(false) {
            return;
        }
        drop(state);

        let mut state = self.state.write().await;
        let logs = state
            .audit_logs
            .entry(plugin_id.to_string())
            .or_insert_with(Vec::new);

        let mut headers = request.headers.clone();
        // Redact sensitive headers
        for key in headers.keys().cloned().collect::<Vec<_>>() {
            if key.to_lowercase() == "authorization"
                || key.to_lowercase().contains("api-key")
                || key.to_lowercase().contains("token")
            {
                headers.insert(key, "[REDACTED]".to_string());
            }
        }

        logs.push(AuditLogEntry {
            url: request.url.clone(),
            method: request.method.clone(),
            headers,
            timestamp: chrono::Utc::now().timestamp() as u64,
        });
    }

    // Main operations

    /// Perform an HTTP fetch
    pub async fn fetch(
        &self,
        plugin_id: &str,
        request: FetchRequest,
    ) -> Result<FetchResponse, NetworkError> {
        // Check permissions
        self.check_permission(plugin_id, NetworkPermission::Fetch)
            .await?;

        // Check domain
        let domain = self.check_domain(plugin_id, &request.url).await?;

        // Check HTTPS
        let final_url = self.check_https(plugin_id, &request.url).await?;

        // Check request size
        self.check_request_size(plugin_id, &request.body).await?;

        // Check rate limit
        self.check_rate_limit(plugin_id, Some(&domain)).await?;

        // Log request
        self.log_request(plugin_id, &request).await;

        // Track network request in resource monitor
        let request_size = request.body.as_ref().map(|b| b.len() as u64).unwrap_or(0);

        // Check for mock responses in test mode
        #[cfg(test)]
        {
            let state = self.state.read().await;

            // Check for timeout
            if let Some(&should_timeout) = state.mock_timeouts.get(&final_url) {
                if should_timeout {
                    return Err(NetworkError::Timeout(format!(
                        "Request to {} timed out",
                        final_url
                    )));
                }
            }

            // Check for DNS failure
            if let Some(&should_fail) = state.mock_dns_failures.get(&domain) {
                if should_fail {
                    return Err(NetworkError::DnsResolutionFailed(format!(
                        "DNS lookup failed for {}",
                        domain
                    )));
                }
            }

            // Check for redirect
            if let Some(redirect_to) = state.mock_redirects.get(&final_url) {
                // Check if redirect domain is allowed
                let redirect_domain = self.check_domain(plugin_id, redirect_to).await;
                if redirect_domain.is_err() {
                    return Err(NetworkError::RedirectToDisallowedDomain(
                        redirect_to.clone(),
                    ));
                }
            }

            // Check for mock response
            if let Some(mock) = state.mock_responses.get(&final_url) {
                // Check response size
                if let Some(&limit) = state.response_size_limits.get(plugin_id) {
                    if mock.body.len() > limit {
                        return Err(NetworkError::ResponseTooLarge(format!(
                            "Response size {} exceeds limit {}",
                            mock.body.len(),
                            limit
                        )));
                    }
                }

                // Track the response in resource monitor
                let response_size = mock.body.len() as u64;
                if let Some(ref monitor) = self.resource_monitor {
                    monitor
                        .track_network_request(plugin_id, request_size, response_size)
                        .await;
                }

                return Ok(FetchResponse {
                    status: mock.status,
                    headers: mock.headers.clone(),
                    body: mock.body.clone(),
                    final_url: final_url.clone(),
                });
            }
        }

        // In production, this would make actual HTTP requests
        // For now, return a mock successful response
        let response = FetchResponse {
            status: 200,
            headers: HashMap::new(),
            body: "Mock response".to_string(),
            final_url,
        };

        // Track the response in resource monitor
        let response_size = response.body.len() as u64;
        if let Some(ref monitor) = self.resource_monitor {
            monitor
                .track_network_request(plugin_id, request_size, response_size)
                .await;
        }

        Ok(response)
    }

    /// Fetch with streaming for large files
    pub async fn fetch_stream(
        &self,
        plugin_id: &str,
        request: FetchRequest,
    ) -> Result<StreamResponse, NetworkError> {
        self.check_permission(plugin_id, NetworkPermission::Stream)
            .await?;

        let state = self.state.read().await;
        if !state
            .streaming_enabled
            .get(plugin_id)
            .copied()
            .unwrap_or(false)
        {
            return Err(NetworkError::PermissionDenied(
                "Streaming not enabled".to_string(),
            ));
        }
        drop(state);

        // Validate request like normal fetch
        let _ = self.check_domain(plugin_id, &request.url).await?;
        let _ = self.check_https(plugin_id, &request.url).await?;

        Ok(StreamResponse {
            stream_id: uuid::Uuid::new_v4().to_string(),
            is_streaming: true,
        })
    }

    /// Connect to a WebSocket
    pub async fn connect_websocket(
        &self,
        plugin_id: &str,
        url: &str,
    ) -> Result<String, NetworkError> {
        self.check_permission(plugin_id, NetworkPermission::WebSocket)
            .await?;

        let parsed_url = Url::parse(url).map_err(|e| NetworkError::InvalidUrl(e.to_string()))?;

        // Check WSS protocol
        if parsed_url.scheme() != "wss" && parsed_url.scheme() != "ws" {
            return Err(NetworkError::WebSocketError(
                "Invalid WebSocket protocol".to_string(),
            ));
        }

        // Check domain
        let _ = self.check_domain(plugin_id, url).await?;

        let connection_id = uuid::Uuid::new_v4().to_string();

        let mut state = self.state.write().await;
        state.websocket_connections.insert(
            connection_id.clone(),
            WebSocketConnection {
                id: connection_id.clone(),
                url: url.to_string(),
                plugin_id: plugin_id.to_string(),
                created_at: std::time::Instant::now(),
            },
        );

        Ok(connection_id)
    }

    /// Send a WebSocket message
    pub async fn websocket_send(
        &self,
        plugin_id: &str,
        connection_id: &str,
        message: WebSocketMessage,
    ) -> Result<(), NetworkError> {
        let state = self.state.read().await;

        if let Some(connection) = state.websocket_connections.get(connection_id) {
            if connection.plugin_id != plugin_id {
                return Err(NetworkError::PermissionDenied(
                    "Not your connection".to_string(),
                ));
            }

            // In production, this would send the message
            Ok(())
        } else {
            Err(NetworkError::WebSocketError(
                "Connection not found".to_string(),
            ))
        }
    }

    /// Subscribe to WebSocket messages
    pub async fn websocket_subscribe(
        &self,
        plugin_id: &str,
        connection_id: &str,
        _sender: tokio::sync::mpsc::Sender<WebSocketMessage>,
    ) -> Result<(), NetworkError> {
        let state = self.state.read().await;

        if let Some(connection) = state.websocket_connections.get(connection_id) {
            if connection.plugin_id != plugin_id {
                return Err(NetworkError::PermissionDenied(
                    "Not your connection".to_string(),
                ));
            }

            // In production, this would set up message forwarding
            Ok(())
        } else {
            Err(NetworkError::WebSocketError(
                "Connection not found".to_string(),
            ))
        }
    }

    /// Close a WebSocket connection
    pub async fn close_websocket(
        &self,
        plugin_id: &str,
        connection_id: &str,
    ) -> Result<(), NetworkError> {
        let mut state = self.state.write().await;

        if let Some(connection) = state.websocket_connections.get(connection_id) {
            if connection.plugin_id != plugin_id {
                return Err(NetworkError::PermissionDenied(
                    "Not your connection".to_string(),
                ));
            }

            state.websocket_connections.remove(connection_id);
            Ok(())
        } else {
            Err(NetworkError::WebSocketError(
                "Connection not found".to_string(),
            ))
        }
    }

    // Configuration methods

    /// Set HTTPS upgrade behavior
    pub async fn set_https_upgrade(&self, plugin_id: &str, enabled: bool) {
        let mut state = self.state.write().await;
        state.https_upgrade.insert(plugin_id.to_string(), enabled);
    }

    /// Set request size limit
    pub async fn set_request_size_limit(&self, plugin_id: &str, limit: usize) {
        let mut state = self.state.write().await;
        state
            .request_size_limits
            .insert(plugin_id.to_string(), limit);
    }

    /// Set response size limit
    pub async fn set_response_size_limit(&self, plugin_id: &str, limit: usize) {
        let mut state = self.state.write().await;
        state
            .response_size_limits
            .insert(plugin_id.to_string(), limit);
    }

    /// Enable streaming
    pub async fn enable_streaming(&self, plugin_id: &str, enabled: bool) {
        let mut state = self.state.write().await;
        state
            .streaming_enabled
            .insert(plugin_id.to_string(), enabled);
    }

    /// Set rate limit
    pub async fn set_rate_limit(&self, plugin_id: &str, max_requests: usize, window: Duration) {
        let mut state = self.state.write().await;
        state.rate_limits.insert(
            plugin_id.to_string(),
            RateLimitInfo {
                requests: Vec::new(),
                max_requests,
                window,
            },
        );
    }

    /// Set domain-specific rate limit
    pub async fn set_domain_rate_limit(
        &self,
        plugin_id: &str,
        domain: &str,
        max_requests: usize,
        window: Duration,
    ) {
        let mut state = self.state.write().await;
        let limits = state
            .domain_rate_limits
            .entry(plugin_id.to_string())
            .or_insert_with(Vec::new);

        // Update existing or add new
        if let Some(existing) = limits.iter_mut().find(|l| l.domain == domain) {
            existing.limit.max_requests = max_requests;
            existing.limit.window = window;
        } else {
            limits.push(DomainRateLimit {
                domain: domain.to_string(),
                limit: RateLimitInfo {
                    requests: Vec::new(),
                    max_requests,
                    window,
                },
            });
        }
    }

    /// Enable audit logging
    pub async fn enable_audit_log(&self, plugin_id: &str, enabled: bool) {
        let mut state = self.state.write().await;
        state.audit_enabled.insert(plugin_id.to_string(), enabled);
    }

    /// Get audit log
    pub async fn get_audit_log(&self, plugin_id: &str) -> Result<Vec<AuditLogEntry>, NetworkError> {
        let state = self.state.read().await;
        Ok(state.audit_logs.get(plugin_id).cloned().unwrap_or_default())
    }

    /// Enable connection pooling
    pub async fn enable_connection_pooling(&self, plugin_id: &str, enabled: bool) {
        let mut state = self.state.write().await;
        state
            .connection_pooling
            .insert(plugin_id.to_string(), enabled);
    }

    // Test helpers

    #[cfg(test)]
    pub async fn set_mock_response(&self, url: &str, response: MockResponse) {
        let mut state = self.state.write().await;
        state.mock_responses.insert(url.to_string(), response);
    }

    #[cfg(test)]
    pub async fn set_mock_redirect(&self, from_url: &str, to_url: &str) {
        let mut state = self.state.write().await;
        state
            .mock_redirects
            .insert(from_url.to_string(), to_url.to_string());
    }

    #[cfg(test)]
    pub async fn set_mock_timeout(&self, url: &str, should_timeout: bool) {
        let mut state = self.state.write().await;
        state.mock_timeouts.insert(url.to_string(), should_timeout);
    }

    #[cfg(test)]
    pub async fn set_mock_dns_failure(&self, domain: &str, should_fail: bool) {
        let mut state = self.state.write().await;
        state
            .mock_dns_failures
            .insert(domain.to_string(), should_fail);
    }

    #[cfg(test)]
    pub async fn emit_websocket_message_internal(
        &self,
        connection_id: &str,
        _message: WebSocketMessage,
    ) {
        // In tests, this would trigger subscriptions
        // For now, just validate connection exists
        let state = self.state.read().await;
        if !state.websocket_connections.contains_key(connection_id) {
            panic!("Connection {} not found", connection_id);
        }
    }

    #[cfg(test)]
    pub fn clone_internal(&self) -> Self {
        Self {
            permission_manager: self.permission_manager.clone(),
            state: self.state.clone(),
            resource_monitor: self.resource_monitor.clone(),
        }
    }
}
