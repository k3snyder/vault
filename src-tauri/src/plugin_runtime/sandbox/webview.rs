// WebView implementation for sandboxed plugin execution

use std::sync::Arc;
use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder};
use thiserror::Error;

/// Represents a sandboxed WebView for plugin execution
pub struct PluginWebview {
    id: String,
    window: Option<Arc<WebviewWindow>>,
    csp_policy: Option<String>,
    is_isolated: bool,
    is_suspended: bool,
}

impl PluginWebview {
    /// Create a new plugin WebView
    pub fn new(id: String) -> Self {
        Self {
            id,
            window: None,
            csp_policy: None,
            is_isolated: false,
            is_suspended: false,
        }
    }

    /// Set Content Security Policy for the WebView
    pub fn set_csp(&mut self, policy: &str) -> Result<(), WebviewError> {
        // Validate CSP policy
        if policy.is_empty() {
            return Err(WebviewError::InvalidCsp(
                "CSP policy cannot be empty".to_string(),
            ));
        }

        self.csp_policy = Some(policy.to_string());

        // Apply CSP to existing window if present
        if let Some(window) = &self.window {
            self.apply_csp_to_window(window.as_ref())?;
        }

        Ok(())
    }

    /// Configure process isolation for the WebView
    pub fn configure_isolation(&mut self) -> Result<(), WebviewError> {
        // Set isolation flag
        self.is_isolated = true;

        // Apply isolation settings to existing window if present
        if let Some(window) = &self.window {
            self.apply_isolation_to_window(window.as_ref())?;
        }

        Ok(())
    }

    /// Create the actual WebView window and return its process ID if available
    pub fn create_window(&mut self, app_handle: &AppHandle) -> Result<Option<u32>, WebviewError> {
        let window_label = format!("plugin_{}", self.id);

        // Build WebView window with security settings
        // Use a data URL for the initial blank page
        let blank_html = "data:text/html,<!DOCTYPE html><html><head></head><body></body></html>";

        let mut builder = WebviewWindowBuilder::new(
            app_handle,
            &window_label,
            tauri::WebviewUrl::External(blank_html.parse().unwrap()),
        )
        .title(format!("Plugin: {}", self.id))
        .visible(false) // Hidden by default for plugins
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(false)
        .skip_taskbar(true)
        .decorations(false)
        .transparent(true);

        // Apply additional security configurations
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
        }

        // Create the window
        let window = builder
            .build()
            .map_err(|e| WebviewError::CreationFailed(e.to_string()))?;

        // Apply CSP if set
        if let Some(csp) = &self.csp_policy {
            self.apply_csp_to_window(&window)?;
        }

        // Apply isolation if configured
        if self.is_isolated {
            self.apply_isolation_to_window(&window)?;
        }

        // Try to get the WebView process ID
        // Note: This is platform-specific and may not always be available
        let pid = self.get_webview_pid(&window);

        self.window = Some(Arc::new(window));
        Ok(pid)
    }

    /// Load the plugin entry point
    pub async fn load_entry_point(&mut self, entry_point: &str) -> Result<(), WebviewError> {
        // Validate entry point
        if entry_point.is_empty() {
            return Err(WebviewError::InvalidEntryPoint(
                "Entry point cannot be empty".to_string(),
            ));
        }

        // Create sandboxed HTML with the plugin script
        let sandboxed_html = self.create_sandboxed_html(entry_point)?;

        if let Some(window) = &self.window {
            // Load the sandboxed HTML
            window
                .eval(&format!(
                    "document.documentElement.innerHTML = `{}`;",
                    sandboxed_html.replace('`', "\\`")
                ))
                .map_err(|e| WebviewError::LoadFailed(e.to_string()))?;
        } else {
            return Err(WebviewError::WindowNotCreated);
        }

        Ok(())
    }

    /// Suspend the WebView execution
    pub async fn suspend(&mut self) -> Result<(), WebviewError> {
        if self.is_suspended {
            return Ok(());
        }

        if let Some(window) = &self.window {
            // Pause JavaScript execution
            window
                .eval("window.__PLUGIN_SUSPENDED__ = true;")
                .map_err(|e| WebviewError::SuspendFailed(e.to_string()))?;

            self.is_suspended = true;
        }

        Ok(())
    }

    /// Resume the WebView execution
    pub async fn resume(&mut self) -> Result<(), WebviewError> {
        if !self.is_suspended {
            return Ok(());
        }

        if let Some(window) = &self.window {
            // Resume JavaScript execution
            window
                .eval("window.__PLUGIN_SUSPENDED__ = false;")
                .map_err(|e| WebviewError::ResumeFailed(e.to_string()))?;

            self.is_suspended = false;
        }

        Ok(())
    }

    /// Get the WebView process ID (platform-specific)
    fn get_webview_pid(&self, _window: &WebviewWindow) -> Option<u32> {
        // This would need platform-specific implementation
        // For now, we'll use a discovery mechanism in the system monitor
        // On macOS/Linux we could use window handle to find process
        // On Windows we could use HWND to find process

        // TODO: Implement platform-specific PID retrieval
        // For now, return None and let the system monitor discover WebView processes
        None
    }

    /// Terminate the WebView
    pub async fn terminate(&mut self) -> Result<(), WebviewError> {
        if let Some(window) = &self.window {
            // Clean up and close window
            window
                .close()
                .map_err(|e| WebviewError::TerminateFailed(e.to_string()))?;

            self.window = None;
        }

        Ok(())
    }

    /// Apply CSP to a window
    fn apply_csp_to_window(&self, window: &WebviewWindow) -> Result<(), WebviewError> {
        if let Some(csp) = &self.csp_policy {
            // Inject CSP meta tag
            let csp_script = format!(
                r#"
                (function() {{
                    const meta = document.createElement('meta');
                    meta.httpEquiv = 'Content-Security-Policy';
                    meta.content = "{}";
                    document.head.appendChild(meta);
                }})();
                "#,
                csp
            );

            window
                .eval(&csp_script)
                .map_err(|e| WebviewError::CspApplicationFailed(e.to_string()))?;
        }

        Ok(())
    }

    /// Apply isolation settings to a window
    fn apply_isolation_to_window(&self, window: &WebviewWindow) -> Result<(), WebviewError> {
        // Disable dangerous APIs
        let isolation_script = r#"
            (function() {
                // Disable eval and Function constructor
                window.eval = undefined;
                window.Function = undefined;
                
                // Remove access to parent window
                if (window.parent !== window) {
                    window.parent = window;
                }
                
                // Disable dynamic script injection
                const createElement = document.createElement.bind(document);
                document.createElement = function(tagName) {
                    if (tagName.toLowerCase() === 'script') {
                        throw new Error('Script injection is not allowed');
                    }
                    return createElement(tagName);
                };
                
                // Set isolation flag
                window.__PLUGIN_ISOLATED__ = true;
            })();
        "#;

        window
            .eval(isolation_script)
            .map_err(|e| WebviewError::IsolationFailed(e.to_string()))?;

        Ok(())
    }

    /// Create sandboxed HTML for plugin execution
    fn create_sandboxed_html(&self, entry_point: &str) -> Result<String, WebviewError> {
        let csp = self
            .csp_policy
            .as_ref()
            .map(|p| p.as_str())
            .unwrap_or(super::csp::default_csp_policy());

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="{}">
    <title>Plugin Sandbox</title>
    <style>
        body {{ margin: 0; padding: 0; overflow: hidden; }}
        #plugin-root {{ width: 100%; height: 100vh; }}
    </style>
</head>
<body>
    <div id="plugin-root"></div>
    <script>
        // Plugin sandbox environment
        window.__PLUGIN_ID__ = '{}';
        window.__PLUGIN_ISOLATED__ = {};
        window.__PLUGIN_SUSPENDED__ = false;
        
        // Plugin API will be injected here
        window.VaultAPI = {{}};
        
        // Error handling
        window.addEventListener('error', function(event) {{
            console.error('Plugin error:', event.error);
            window.__TAURI__.event.emit('plugin-error', {{
                pluginId: window.__PLUGIN_ID__,
                error: event.error.toString()
            }});
        }});
        
        // Load plugin entry point
        const script = document.createElement('script');
        script.src = '{}';
        script.onerror = function() {{
            console.error('Failed to load plugin entry point');
        }};
        document.body.appendChild(script);
    </script>
</body>
</html>"#,
            csp, self.id, self.is_isolated, entry_point
        );

        Ok(html)
    }
}

#[derive(Debug, Error)]
pub enum WebviewError {
    #[error("WebView creation failed: {0}")]
    CreationFailed(String),

    #[error("Invalid CSP policy: {0}")]
    InvalidCsp(String),

    #[error("CSP application failed: {0}")]
    CspApplicationFailed(String),

    #[error("Isolation configuration failed: {0}")]
    IsolationFailed(String),

    #[error("Invalid entry point: {0}")]
    InvalidEntryPoint(String),

    #[error("Failed to load plugin: {0}")]
    LoadFailed(String),

    #[error("WebView window not created")]
    WindowNotCreated,

    #[error("Failed to suspend WebView: {0}")]
    SuspendFailed(String),

    #[error("Failed to resume WebView: {0}")]
    ResumeFailed(String),

    #[error("Failed to terminate WebView: {0}")]
    TerminateFailed(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webview_creation() {
        let webview = PluginWebview::new("test_plugin".to_string());
        assert!(!webview.is_isolated);
        assert!(!webview.is_suspended);
        assert!(webview.window.is_none());
    }

    #[test]
    fn test_csp_configuration() {
        let mut webview = PluginWebview::new("test_plugin".to_string());

        // Test empty CSP
        let result = webview.set_csp("");
        assert!(result.is_err());

        // Test valid CSP
        let result = webview.set_csp("default-src 'self'");
        assert!(result.is_ok());
        assert_eq!(webview.csp_policy, Some("default-src 'self'".to_string()));
    }

    #[test]
    fn test_isolation_configuration() {
        let mut webview = PluginWebview::new("test_plugin".to_string());

        let result = webview.configure_isolation();
        assert!(result.is_ok());
        assert!(webview.is_isolated);
    }

    #[tokio::test]
    async fn test_load_entry_point_validation() {
        let mut webview = PluginWebview::new("test_plugin".to_string());

        // Test empty entry point
        let result = webview.load_entry_point("").await;
        assert!(result.is_err());

        // Test without window created
        let result = webview.load_entry_point("test.js").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_sandboxed_html_generation() {
        let mut webview = PluginWebview::new("test_plugin".to_string());
        webview.set_csp("default-src 'self'").unwrap();
        webview.configure_isolation().unwrap();

        let html = webview.create_sandboxed_html("plugin.js").unwrap();

        // Verify HTML contains essential elements
        assert!(html.contains("Content-Security-Policy"));
        assert!(html.contains("default-src 'self'"));
        assert!(html.contains("window.__PLUGIN_ID__ = 'test_plugin'"));
        assert!(html.contains("window.__PLUGIN_ISOLATED__ = true"));
        assert!(html.contains("plugin.js"));
    }

    #[tokio::test]
    async fn test_suspend_resume_lifecycle() {
        let mut webview = PluginWebview::new("test_plugin".to_string());

        // Test suspend without window
        let result = webview.suspend().await;
        assert!(result.is_ok()); // Should succeed even without window
        assert!(!webview.is_suspended); // But state shouldn't change

        // Test resume without window
        let result = webview.resume().await;
        assert!(result.is_ok());
    }
}
