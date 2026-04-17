use crate::editor::EditorManager;
use crate::mcp::MCPManager;
use crate::vault::Vault;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub vault: Arc<Mutex<Option<Vault>>>,
    pub editor: EditorManager,
    pub watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
    pub mcp_manager: Arc<MCPManager>,
}
