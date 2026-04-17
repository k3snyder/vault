// Sandbox Module - Provides isolated execution environments for plugins

pub mod csp;
pub mod injection;
pub mod webview;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

/// Configuration for a plugin sandbox
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub plugin_id: String,
    pub enable_dev_tools: bool,
    pub memory_limit_mb: u64,
    pub cpu_limit_percent: u8,
    pub allow_network: bool,
    pub csp_policy: String,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            plugin_id: String::new(),
            enable_dev_tools: false,
            memory_limit_mb: 128,
            cpu_limit_percent: 25,
            allow_network: false,
            csp_policy: csp::default_csp_policy().to_string(),
        }
    }
}

/// Represents an isolated sandbox instance
pub struct Sandbox {
    pub id: String,
    pub config: SandboxConfig,
    webview: webview::PluginWebview,
    status: SandboxStatus,
    app_handle: Option<AppHandle>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SandboxStatus {
    Created,
    Running,
    Suspended,
    Crashed,
    Terminated,
}

impl Sandbox {
    /// Create a new sandbox with the given configuration
    pub fn new(id: String, config: SandboxConfig) -> Self {
        Self {
            id: id.clone(),
            config,
            webview: webview::PluginWebview::new(id),
            status: SandboxStatus::Created,
            app_handle: None,
        }
    }

    /// Create a new sandbox with the given configuration and app handle
    pub fn new_with_handle(id: String, config: SandboxConfig, app_handle: AppHandle) -> Self {
        Self {
            id: id.clone(),
            config,
            webview: webview::PluginWebview::new(id),
            status: SandboxStatus::Created,
            app_handle: Some(app_handle),
        }
    }

    /// Check if this sandbox can create a window (has app handle)
    pub fn can_create_window(&self) -> bool {
        self.app_handle.is_some()
    }

    /// Load a plugin into the sandbox and return the WebView process ID if available
    pub async fn load_plugin(&mut self, entry_point: &str) -> Result<Option<u32>, SandboxError> {
        // Create the WebView window if we have an app handle
        let pid = if let Some(ref app_handle) = self.app_handle {
            self.webview.create_window(app_handle).map_err(|e| {
                SandboxError::WebViewError(format!("Failed to create WebView window: {}", e))
            })?
        } else {
            None
        };

        // Apply CSP policy
        self.webview
            .set_csp(&self.config.csp_policy)
            .map_err(|e| SandboxError::WebViewError(e.to_string()))?;

        // Configure isolation
        self.webview
            .configure_isolation()
            .map_err(|e| SandboxError::WebViewError(e.to_string()))?;

        // Load the plugin entry point
        self.webview
            .load_entry_point(entry_point)
            .await
            .map_err(|e| SandboxError::WebViewError(e.to_string()))?;

        self.status = SandboxStatus::Running;
        Ok(pid)
    }

    /// Suspend the sandbox
    pub async fn suspend(&mut self) -> Result<(), SandboxError> {
        self.webview
            .suspend()
            .await
            .map_err(|e| SandboxError::WebViewError(e.to_string()))?;
        self.status = SandboxStatus::Suspended;
        Ok(())
    }

    /// Resume the sandbox
    pub async fn resume(&mut self) -> Result<(), SandboxError> {
        self.webview
            .resume()
            .await
            .map_err(|e| SandboxError::WebViewError(e.to_string()))?;
        self.status = SandboxStatus::Running;
        Ok(())
    }

    /// Terminate the sandbox
    pub async fn terminate(&mut self) -> Result<(), SandboxError> {
        self.webview
            .terminate()
            .await
            .map_err(|e| SandboxError::WebViewError(e.to_string()))?;
        self.status = SandboxStatus::Terminated;
        Ok(())
    }

    /// Get sandbox status
    pub fn status(&self) -> &SandboxStatus {
        &self.status
    }

    /// Handle sandbox crash
    pub fn handle_crash(&mut self) {
        self.status = SandboxStatus::Crashed;
    }
}

/// Manages multiple sandbox instances
pub struct SandboxManager {
    sandboxes: Arc<RwLock<HashMap<String, Arc<RwLock<Sandbox>>>>>,
    app_handle: Option<AppHandle>,
}

impl SandboxManager {
    pub fn new() -> Self {
        Self {
            sandboxes: Arc::new(RwLock::new(HashMap::new())),
            app_handle: None,
        }
    }

    /// Set the Tauri app handle for WebView creation
    pub fn set_app_handle(&mut self, handle: AppHandle) {
        self.app_handle = Some(handle);
    }

    /// Check if the sandbox manager has an app handle
    pub fn has_app_handle(&self) -> bool {
        self.app_handle.is_some()
    }

    /// Create a new sandbox for a plugin
    pub async fn create_sandbox(
        &self,
        plugin_id: &str,
    ) -> Result<Arc<RwLock<Sandbox>>, SandboxError> {
        let config = SandboxConfig {
            plugin_id: plugin_id.to_string(),
            ..Default::default()
        };

        let sandbox_id = format!("sandbox_{}", plugin_id);

        // Create sandbox with or without app handle
        let sandbox = if let Some(ref app_handle) = self.app_handle {
            Arc::new(RwLock::new(Sandbox::new_with_handle(
                sandbox_id.clone(),
                config,
                app_handle.clone(),
            )))
        } else {
            Arc::new(RwLock::new(Sandbox::new(sandbox_id.clone(), config)))
        };

        let mut sandboxes = self.sandboxes.write().await;
        sandboxes.insert(sandbox_id, sandbox.clone());

        Ok(sandbox)
    }

    /// Get a sandbox by ID
    pub async fn get_sandbox(&self, sandbox_id: &str) -> Option<Arc<RwLock<Sandbox>>> {
        let sandboxes = self.sandboxes.read().await;
        sandboxes.get(sandbox_id).cloned()
    }

    /// Destroy a sandbox
    pub async fn destroy_sandbox(&self, plugin_id: &str) -> Result<(), SandboxError> {
        let sandbox_id = format!("sandbox_{}", plugin_id);

        let mut sandboxes = self.sandboxes.write().await;
        if let Some(sandbox) = sandboxes.remove(&sandbox_id) {
            let mut sandbox = sandbox.write().await;
            sandbox.terminate().await?;
        }

        Ok(())
    }

    /// List all active sandboxes
    pub async fn list_sandboxes(&self) -> Vec<String> {
        let sandboxes = self.sandboxes.read().await;
        sandboxes.keys().cloned().collect()
    }

    /// Get sandbox metrics
    pub async fn get_sandbox_metrics(&self, sandbox_id: &str) -> Option<SandboxMetrics> {
        if let Some(sandbox) = self.get_sandbox(sandbox_id).await {
            let sandbox = sandbox.read().await;
            Some(SandboxMetrics {
                id: sandbox.id.clone(),
                status: sandbox.status.clone(),
                memory_usage_mb: 0, // Will be implemented with resource monitoring
                cpu_usage_percent: 0, // Will be implemented with resource monitoring
            })
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxMetrics {
    pub id: String,
    pub status: SandboxStatus,
    pub memory_usage_mb: u64,
    pub cpu_usage_percent: u8,
}

#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("WebView error: {0}")]
    WebViewError(String),

    #[error("CSP violation: {0}")]
    CspViolation(String),

    #[error("Isolation error: {0}")]
    IsolationError(String),

    #[error("Resource limit exceeded: {0}")]
    ResourceLimitExceeded(String),

    #[error("Sandbox not found")]
    NotFound,

    #[error("Sandbox already exists")]
    AlreadyExists,

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_sandbox_creation() {
        let config = SandboxConfig::default();
        let sandbox = Sandbox::new("test_sandbox".to_string(), config);
        assert_eq!(sandbox.status(), &SandboxStatus::Created);
    }

    #[tokio::test]
    async fn test_sandbox_manager_creation() {
        let manager = SandboxManager::new();
        let sandboxes = manager.list_sandboxes().await;
        assert_eq!(sandboxes.len(), 0);
    }

    #[tokio::test]
    async fn test_create_and_destroy_sandbox() {
        let manager = SandboxManager::new();

        // Create sandbox
        let result = manager.create_sandbox("test_plugin").await;
        assert!(result.is_ok());

        let sandboxes = manager.list_sandboxes().await;
        assert_eq!(sandboxes.len(), 1);
        assert!(sandboxes.contains(&"sandbox_test_plugin".to_string()));

        // Destroy sandbox
        let result = manager.destroy_sandbox("test_plugin").await;
        assert!(result.is_ok());

        let sandboxes = manager.list_sandboxes().await;
        assert_eq!(sandboxes.len(), 0);
    }

    #[tokio::test]
    async fn test_sandbox_lifecycle() {
        let mut config = SandboxConfig::default();
        config.plugin_id = "test_plugin".to_string();

        let mut sandbox = Sandbox::new("test_sandbox".to_string(), config);
        assert_eq!(sandbox.status(), &SandboxStatus::Created);

        // Load plugin (will fail without actual WebView implementation)
        let result = sandbox.load_plugin("test_entry.js").await;
        assert!(result.is_err()); // Expected to fail in test environment

        // Test state transitions
        assert_eq!(sandbox.status(), &SandboxStatus::Created);

        sandbox.handle_crash();
        assert_eq!(sandbox.status(), &SandboxStatus::Crashed);
    }

    #[tokio::test]
    async fn test_sandbox_metrics() {
        let manager = SandboxManager::new();
        let _ = manager.create_sandbox("test_plugin").await;

        let metrics = manager.get_sandbox_metrics("sandbox_test_plugin").await;
        assert!(metrics.is_some());

        let metrics = metrics.unwrap();
        assert_eq!(metrics.id, "sandbox_test_plugin");
        assert_eq!(metrics.status, SandboxStatus::Created);
    }
}
