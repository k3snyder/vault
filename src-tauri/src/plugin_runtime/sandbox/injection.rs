// JavaScript Injection for Plugin WebViews
use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindow};

/// Inject the plugin API bridge into a WebView
pub async fn inject_plugin_api(window: &WebviewWindow, plugin_id: &str) -> Result<(), String> {
    // Read the plugin API bridge JavaScript
    let api_bridge_js = include_str!("../js/plugin-api-bridge.js");

    // Inject the plugin ID into the context
    let plugin_id_injection = format!("window.__PLUGIN_ID__ = '{}';", plugin_id);

    // Combine the scripts
    let full_script = format!("{}\n{}", plugin_id_injection, api_bridge_js);

    // Inject the script into the WebView
    window
        .eval(&full_script)
        .map_err(|e| format!("Failed to inject plugin API: {}", e))?;

    // Set up message handler for API calls from the plugin
    setup_message_handler(window, plugin_id)?;

    Ok(())
}

/// Set up message handler for plugin API calls
fn setup_message_handler(window: &WebviewWindow, plugin_id: &str) -> Result<(), String> {
    let plugin_id = plugin_id.to_string();
    let window_clone = window.clone();

    // JavaScript to handle messages from the plugin
    let message_handler = r#"
        // Override postMessage to intercept plugin API calls
        (function() {
            const originalPostMessage = window.postMessage;
            
            window.postMessage = function(message, targetOrigin) {
                if (message && message.type === 'plugin-api-call') {
                    // Handle plugin API call
                    handlePluginApiCall(message);
                } else {
                    // Pass through other messages
                    originalPostMessage.call(window, message, targetOrigin);
                }
            };
            
            async function handlePluginApiCall(message) {
                try {
                    // Call the Tauri command
                    const result = await window.__TAURI__.invoke(message.command, message.args);
                    
                    // Send response back to plugin
                    window.postMessage({
                        id: message.id,
                        result: result
                    }, '*');
                } catch (error) {
                    // Send error back to plugin
                    window.postMessage({
                        id: message.id,
                        error: error.toString()
                    }, '*');
                }
            }
        })();
    "#;

    window
        .eval(message_handler)
        .map_err(|e| format!("Failed to set up message handler: {}", e))?;

    Ok(())
}

/// Create a sandboxed WebView for a plugin
pub async fn create_plugin_webview(
    app_handle: &tauri::AppHandle,
    plugin_id: &str,
    plugin_url: &str,
) -> Result<WebviewWindow, String> {
    // Create WebView window for the plugin
    let window = tauri::WebviewWindowBuilder::new(
        app_handle,
        format!("plugin-{}", plugin_id),
        WebviewUrl::External(plugin_url.parse::<url::Url>().map_err(|e| e.to_string())?),
    )
    .title(format!("Plugin: {}", plugin_id))
    .inner_size(800.0, 600.0)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .visible(false) // Start hidden
    .initialization_script(include_str!("../js/plugin-api-bridge.js"))
    .build()
    .map_err(|e| format!("Failed to create plugin WebView: {}", e))?;

    // Inject the plugin API
    inject_plugin_api(&window, plugin_id).await?;

    Ok(window)
}

/// Load plugin content into a WebView
pub async fn load_plugin_content(
    window: &WebviewWindow,
    plugin_id: &str,
    content_path: &str,
) -> Result<(), String> {
    // Check if it's a local file or URL
    if content_path.starts_with("http://") || content_path.starts_with("https://") {
        // Load external URL
        window
            .eval(&format!("window.location.href = '{}';", content_path))
            .map_err(|e| format!("Failed to load plugin URL: {}", e))?;
    } else {
        // Load local file
        let plugin_file = PathBuf::from(content_path);
        if !plugin_file.exists() {
            return Err(format!("Plugin file not found: {}", content_path));
        }

        // Read the file content
        let content = std::fs::read_to_string(&plugin_file)
            .map_err(|e| format!("Failed to read plugin file: {}", e))?;

        // If it's HTML, set it directly
        if content_path.ends_with(".html") {
            window
                .eval(&format!(
                    "document.documentElement.innerHTML = {};",
                    serde_json::to_string(&content).unwrap()
                ))
                .map_err(|e| format!("Failed to load plugin HTML: {}", e))?;
        } else if content_path.ends_with(".js") {
            // If it's JavaScript, execute it
            window
                .eval(&content)
                .map_err(|e| format!("Failed to execute plugin JavaScript: {}", e))?;
        }
    }

    Ok(())
}

/// Handle IPC messages from plugins
pub async fn handle_plugin_message(
    plugin_id: &str,
    message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // This will be called when a plugin sends a message
    // Route it to the appropriate API handler

    // Extract message type
    let message_type = message["type"]
        .as_str()
        .ok_or("Invalid message: missing type")?;

    match message_type {
        "api-call" => {
            // Handle API call
            let method = message["method"]
                .as_str()
                .ok_or("Invalid API call: missing method")?;
            let params = message["params"].clone();

            // Route to API handler (this would call the actual API implementation)
            handle_api_call(plugin_id, method, params).await
        }
        "event" => {
            // Handle event emission
            let event_name = message["event"]
                .as_str()
                .ok_or("Invalid event: missing event name")?;
            let event_data = message["data"].clone();

            // Emit event to other plugins or system
            emit_plugin_event(plugin_id, event_name, event_data).await
        }
        _ => Err(format!("Unknown message type: {}", message_type)),
    }
}

/// Handle API calls from plugins
async fn handle_api_call(
    plugin_id: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use serde_json::json;

    // This is a placeholder - in production, this would route to the actual API handlers
    match method {
        "vault.read" => {
            // Example response
            Ok(json!({ "content": "File content here" }))
        }
        "workspace.showNotice" => Ok(json!({ "success": true })),
        _ => Err(format!("Unknown API method: {}", method)),
    }
}

/// Emit an event from a plugin
async fn emit_plugin_event(
    plugin_id: &str,
    event_name: &str,
    event_data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use serde_json::json;

    println!(
        "Plugin {} emitted event {}: {:?}",
        plugin_id, event_name, event_data
    );

    // In production, this would broadcast the event to other plugins or the system
    Ok(json!({ "success": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_handle_plugin_message() {
        use serde_json::json;

        let message = json!({
            "type": "api-call",
            "method": "vault.read",
            "params": { "path": "test.md" }
        });

        let result = handle_plugin_message("test-plugin", message).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_api_call() {
        use serde_json::json;

        let result =
            handle_api_call("test-plugin", "vault.read", json!({ "path": "test.md" })).await;

        assert!(result.is_ok());
        assert!(result.unwrap()["content"].is_string());
    }

    #[tokio::test]
    async fn test_emit_plugin_event() {
        use serde_json::json;

        let result =
            emit_plugin_event("test-plugin", "test-event", json!({ "data": "test" })).await;

        assert!(result.is_ok());
    }
}
