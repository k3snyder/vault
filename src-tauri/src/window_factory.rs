// Window creation factory
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

use crate::window_lifecycle::AppPersistenceState;
use tauri::{AppHandle, WebviewWindow};
use uuid::Uuid;

pub struct WindowFactory {
    app_handle: AppHandle,
}

impl WindowFactory {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn create_vault_window(&self, vault_path: &str) -> Result<WebviewWindow, String> {
        let window_id = format!("vault-{}", Uuid::new_v4());
        let vault_name = std::path::Path::new(vault_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();

        // Encode the vault path as a URL parameter
        let encoded_vault_path = urlencoding::encode(vault_path);
        let url = format!("index.html?vault={}", encoded_vault_path);

        // Check if we have saved window state
        let saved_state = AppPersistenceState::load().ok();
        let saved_bounds = saved_state
            .as_ref()
            .and_then(|state| state.last_active_window.as_ref())
            .map(|window_state| &window_state.bounds);

        // Create window with saved size or defaults
        let mut window_builder = tauri::webview::WebviewWindowBuilder::new(
            &self.app_handle,
            &window_id,
            tauri::WebviewUrl::App(url.into()),
        )
        .title(format!("Gaimplan - {}", vault_name));

        if let Some(bounds) = saved_bounds {
            // Use saved window size and position
            window_builder = window_builder
                .position(bounds.x as f64, bounds.y as f64)
                .inner_size(bounds.width as f64, bounds.height as f64);
        } else {
            // Use default size
            window_builder = window_builder.inner_size(1200.0, 800.0);
        }

        // Enable devtools for debugging
        window_builder = window_builder.devtools(true);

        window_builder.build().map_err(|e| e.to_string())
    }

    pub fn set_window_title(window: &WebviewWindow, vault_name: &str) -> Result<(), String> {
        window
            .set_title(&format!("Gaimplan - {}", vault_name))
            .map_err(|e| e.to_string())
    }

    pub fn restore_window_position(
        window: &WebviewWindow,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                x as f64, y as f64,
            )))
            .map_err(|e| e.to_string())?;

        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                width as f64,
                height as f64,
            )))
            .map_err(|e| e.to_string())?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_factory_creation() {
        // Test that WindowFactory can be created with a valid structure
        // In real tests, we would use a mock AppHandle
    }

    #[test]
    fn test_window_id_generation() {
        // Test UUID generation for window IDs
        let id1 = format!("vault-{}", Uuid::new_v4());
        let id2 = format!("vault-{}", Uuid::new_v4());

        assert!(id1.starts_with("vault-"));
        assert!(id2.starts_with("vault-"));
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_vault_name_extraction() {
        let path = "/Users/test/vaults/my-vault";
        let vault_name = std::path::Path::new(path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();

        assert_eq!(vault_name, "my-vault");
    }
}
