// Window lifecycle management
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Window};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowPersistenceState {
    pub vault_path: String,
    pub bounds: WindowBounds,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct AppPersistenceState {
    pub last_active_window: Option<WindowPersistenceState>,
    pub recent_vaults: Vec<String>,
}

impl AppPersistenceState {
    pub fn load() -> Result<Self, Box<dyn Error>> {
        let path = Self::get_config_path()?;

        if path.exists() {
            let content = fs::read_to_string(path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn Error>> {
        let path = Self::get_config_path()?;

        fs::create_dir_all(path.parent().unwrap())?;
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }

    fn get_config_path() -> Result<PathBuf, Box<dyn Error>> {
        let path = dirs::config_dir()
            .ok_or("No config dir")?
            .join("vault")
            .join("window-state.json");
        Ok(path)
    }

    pub fn add_recent_vault(&mut self, vault_path: String) {
        // Remove if already exists
        self.recent_vaults.retain(|v| v != &vault_path);
        // Add to front
        self.recent_vaults.insert(0, vault_path);
        // Keep only last 10
        self.recent_vaults.truncate(10);
    }
}

pub fn save_window_state_sync(window: &Window) -> Result<(), Box<dyn Error>> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;

    // Save window bounds
    let bounds = WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    let mut app_state = AppPersistenceState::load().unwrap_or_default();

    // For now, just save the window bounds without vault path
    // In a future enhancement, we could track vault paths through window labels or app state
    let persistence_state = WindowPersistenceState {
        vault_path: String::new(), // Empty for now
        bounds,
    };
    app_state.last_active_window = Some(persistence_state);

    app_state.save()?;
    Ok(())
}

pub async fn save_window_state(window: &Window) -> Result<(), Box<dyn Error>> {
    save_window_state_sync(window)
}

pub fn setup_window_handlers(_app: &AppHandle) {
    // Window event handling would be set up here
    // In Tauri 2.x, this is handled differently through window event handlers
    // This function is a placeholder for the window lifecycle setup
}

#[cfg(test)]
mod tests {
    use super::*;
    // use tempfile::TempDir;

    #[test]
    fn test_window_bounds_serialization() {
        let bounds = WindowBounds {
            x: 100,
            y: 200,
            width: 1200,
            height: 800,
        };

        let json = serde_json::to_string(&bounds).unwrap();
        let deserialized: WindowBounds = serde_json::from_str(&json).unwrap();

        assert_eq!(bounds.x, deserialized.x);
        assert_eq!(bounds.y, deserialized.y);
        assert_eq!(bounds.width, deserialized.width);
        assert_eq!(bounds.height, deserialized.height);
    }

    #[test]
    fn test_app_persistence_state_default() {
        let state = AppPersistenceState::default();
        assert!(state.last_active_window.is_none());
        assert!(state.recent_vaults.is_empty());
    }

    #[test]
    fn test_add_recent_vault() {
        let mut state = AppPersistenceState::default();

        state.add_recent_vault("/path/to/vault1".to_string());
        assert_eq!(state.recent_vaults.len(), 1);
        assert_eq!(state.recent_vaults[0], "/path/to/vault1");

        state.add_recent_vault("/path/to/vault2".to_string());
        assert_eq!(state.recent_vaults.len(), 2);
        assert_eq!(state.recent_vaults[0], "/path/to/vault2");
        assert_eq!(state.recent_vaults[1], "/path/to/vault1");

        // Test deduplication
        state.add_recent_vault("/path/to/vault1".to_string());
        assert_eq!(state.recent_vaults.len(), 2);
        assert_eq!(state.recent_vaults[0], "/path/to/vault1");
        assert_eq!(state.recent_vaults[1], "/path/to/vault2");
    }

    #[test]
    fn test_recent_vaults_limit() {
        let mut state = AppPersistenceState::default();

        for i in 0..15 {
            state.add_recent_vault(format!("/path/to/vault{}", i));
        }

        assert_eq!(state.recent_vaults.len(), 10);
        assert_eq!(state.recent_vaults[0], "/path/to/vault14");
        assert_eq!(state.recent_vaults[9], "/path/to/vault5");
    }

    // #[test]
    // fn test_persistence_state_save_load() {
    //     // This test requires tempfile crate
    //     // Commented out for now as it requires filesystem operations
    // }
}
