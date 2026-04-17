// Re-export modules needed by the test binary
pub mod ai_settings;
pub mod ai_settings_multi;
pub mod app_state;
pub mod commands;
pub mod csv;
pub mod editor;
pub mod identity;
pub mod license;
pub mod mcp;
pub mod pdf_intelligence;
pub mod plugin_runtime;
pub mod refactored_app_state;
pub mod tasks;
pub mod vault;
pub mod vault_agent_commands;
pub mod vault_id;
pub mod window_commands;
pub mod window_commands_basic;
pub mod window_factory;
pub mod window_lifecycle;
pub mod window_state;

pub use app_state::AppState;
pub use refactored_app_state::RefactoredAppState;
pub use window_state::{WindowRegistry, WindowState};
