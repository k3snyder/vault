// Re-export modules needed by the test binary
pub mod ai_settings;
pub mod ai_settings_multi;
pub mod botcky;
pub mod command_error;
pub mod commands;
pub mod csv;
pub mod editor;
pub mod identity;
pub mod license;
pub mod logging;
pub mod pdf_intelligence;
pub mod plugin_runtime;
pub mod refactored_app_state;
pub mod secrets;
pub mod tasks;
pub mod vault;
pub mod vault_agent_commands;
pub mod vault_id;
pub mod window_commands_basic;
pub mod window_factory;
pub mod window_lifecycle;
pub mod window_state;

pub use refactored_app_state::RefactoredAppState;
pub use window_state::{WindowRegistry, WindowState};

pub struct AppState {
    pub vault: std::sync::Arc<tokio::sync::Mutex<Option<crate::vault::Vault>>>,
    pub editor: crate::editor::EditorManager,
    pub watcher: std::sync::Arc<tokio::sync::Mutex<Option<notify::RecommendedWatcher>>>,
}
