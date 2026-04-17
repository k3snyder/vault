// Workspace API - UI and workspace operations for plugins
// Provides controlled access to UI elements and workspace state

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::plugin_runtime::permissions::{Capability, Permission, PermissionManager};

#[cfg(test)]
mod tests;

/// Permissions for workspace operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkspacePermission {
    Read,
    Write,
    Create,
}

/// View types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ViewType {
    Editor,
    Preview,
    Custom,
    Settings,
}

/// View positions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ViewPosition {
    Left,
    Right,
    Center,
    Bottom,
}

/// Split directions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

/// Sidebar positions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SidebarPosition {
    Left,
    Right,
}

/// Notice types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NoticeType {
    Info,
    Warning,
    Error,
    Success,
}

/// Status bar positions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StatusBarPosition {
    Left,
    Right,
}

/// Modal actions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModalAction {
    Close,
    Custom(String),
}

/// Workspace event types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum WorkspaceEventType {
    FileOpened,
    FileClosed,
    FileChanged,
    ViewCreated,
    ViewDestroyed,
    LayoutChanged,
    CommandExecuted,
}

/// Workspace event data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WorkspaceEventData {
    File { path: String },
    View { id: String },
    Layout { description: String },
    Command { id: String },
    Empty,
}

/// View configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewConfig {
    pub id: String,
    pub title: String,
    pub view_type: ViewType,
    pub icon: Option<String>,
    pub position: ViewPosition,
}

/// View information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub id: String,
    pub title: String,
    pub view_type: ViewType,
    pub is_active: bool,
    pub position: ViewPosition,
}

/// Layout information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutInfo {
    pub main_area: Option<String>,
    pub left_sidebar: bool,
    pub right_sidebar: bool,
    pub bottom_panel: bool,
    pub split_count: usize,
}

/// Modal configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModalConfig {
    pub title: String,
    pub content: String,
    pub buttons: Vec<ModalButton>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Modal button
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModalButton {
    pub text: String,
    pub action: ModalAction,
    pub primary: bool,
}

/// Status bar item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusBarItem {
    pub id: String,
    pub text: String,
    pub tooltip: Option<String>,
    pub icon: Option<String>,
    pub position: StatusBarPosition,
    pub priority: i32,
}

/// Ribbon item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RibbonItem {
    pub id: String,
    pub icon: String,
    pub tooltip: String,
    pub position: i32,
}

/// Command definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub hotkey: Option<String>,
}

/// Workspace event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceEvent {
    pub event_type: WorkspaceEventType,
    pub data: WorkspaceEventData,
    pub timestamp: u64,
}

/// Workspace API errors
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("View not found: {0}")]
    ViewNotFound(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Operation failed: {0}")]
    OperationFailed(String),
}

/// Internal workspace state
struct WorkspaceState {
    active_file: Option<String>,
    active_view: Option<String>,
    views: HashMap<String, ViewInfo>,
    layout: LayoutInfo,
    status_items: HashMap<String, StatusBarItem>,
    ribbon_items: HashMap<String, RibbonItem>,
    commands: HashMap<String, Command>,
    modals: HashMap<String, ModalConfig>,
    event_subscribers:
        HashMap<WorkspaceEventType, Vec<(String, tokio::sync::mpsc::Sender<WorkspaceEvent>)>>,
}

/// Workspace API implementation
pub struct WorkspaceApi {
    permission_manager: Arc<RwLock<PermissionManager>>,
    state: Arc<RwLock<WorkspaceState>>,
}

impl WorkspaceApi {
    /// Create a new Workspace API instance
    pub fn new(permission_manager: Arc<RwLock<PermissionManager>>) -> Self {
        Self {
            permission_manager,
            state: Arc::new(RwLock::new(WorkspaceState {
                active_file: None,
                active_view: None,
                views: HashMap::new(),
                layout: LayoutInfo {
                    main_area: Some("editor".to_string()),
                    left_sidebar: true,
                    right_sidebar: false,
                    bottom_panel: false,
                    split_count: 1,
                },
                status_items: HashMap::new(),
                ribbon_items: HashMap::new(),
                commands: HashMap::new(),
                modals: HashMap::new(),
                event_subscribers: HashMap::new(),
            })),
        }
    }

    /// Grant a permission to a plugin (for testing)
    #[cfg(test)]
    pub async fn grant_permission(&self, plugin_id: &str, permission: WorkspacePermission) {
        let capability = match permission {
            WorkspacePermission::Read => Capability::WorkspaceRead,
            WorkspacePermission::Write => Capability::WorkspaceWrite,
            WorkspacePermission::Create => Capability::WorkspaceCreate,
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

    /// Check if plugin has permission
    async fn check_permission(
        &self,
        plugin_id: &str,
        permission: WorkspacePermission,
    ) -> Result<(), WorkspaceError> {
        let capability = match permission {
            WorkspacePermission::Read => Capability::WorkspaceRead,
            WorkspacePermission::Write => Capability::WorkspaceWrite,
            WorkspacePermission::Create => Capability::WorkspaceCreate,
        };

        let manager = self.permission_manager.read().await;
        if !manager.has_capability(plugin_id, &capability).await {
            return Err(WorkspaceError::PermissionDenied(format!(
                "Plugin {} lacks permission: {:?}",
                plugin_id, permission
            )));
        }
        Ok(())
    }

    // Active file management

    /// Get the currently active file
    pub async fn get_active_file(&self, plugin_id: &str) -> Result<Option<String>, WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Read)
            .await?;
        let state = self.state.read().await;
        Ok(state.active_file.clone())
    }

    /// Set the active file
    pub async fn set_active_file(&self, plugin_id: &str, path: &str) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;
        let mut state = self.state.write().await;
        state.active_file = Some(path.to_string());

        // Emit event
        drop(state);
        self.emit_event_internal(WorkspaceEvent {
            event_type: WorkspaceEventType::FileOpened,
            data: WorkspaceEventData::File {
                path: path.to_string(),
            },
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
        .await;

        Ok(())
    }

    /// Open a file in the workspace
    pub async fn open_file(
        &self,
        plugin_id: &str,
        path: &str,
        _new_pane: bool,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;

        // Set as active file
        self.set_active_file(plugin_id, path).await?;

        Ok(())
    }

    /// Close a file
    pub async fn close_file(&self, plugin_id: &str, path: &str) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;

        let mut state = self.state.write().await;
        if state.active_file.as_ref() == Some(&path.to_string()) {
            state.active_file = None;
        }

        // Emit event
        drop(state);
        self.emit_event_internal(WorkspaceEvent {
            event_type: WorkspaceEventType::FileClosed,
            data: WorkspaceEventData::File {
                path: path.to_string(),
            },
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
        .await;

        Ok(())
    }

    // View management

    /// Create a new view
    pub async fn create_view(
        &self,
        plugin_id: &str,
        config: ViewConfig,
    ) -> Result<String, WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let view_id = format!("{}-{}", config.id, Uuid::new_v4());
        let view_info = ViewInfo {
            id: view_id.clone(),
            title: config.title,
            view_type: config.view_type,
            is_active: false,
            position: config.position,
        };

        let mut state = self.state.write().await;
        state.views.insert(view_id.clone(), view_info);

        // Emit event
        drop(state);
        self.emit_event_internal(WorkspaceEvent {
            event_type: WorkspaceEventType::ViewCreated,
            data: WorkspaceEventData::View {
                id: view_id.clone(),
            },
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
        .await;

        Ok(view_id)
    }

    /// Destroy a view
    pub async fn destroy_view(&self, plugin_id: &str, view_id: &str) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        if !state.views.contains_key(view_id) {
            return Err(WorkspaceError::ViewNotFound(view_id.to_string()));
        }

        state.views.remove(view_id);
        if state.active_view.as_ref() == Some(&view_id.to_string()) {
            state.active_view = None;
        }

        // Emit event
        drop(state);
        self.emit_event_internal(WorkspaceEvent {
            event_type: WorkspaceEventType::ViewDestroyed,
            data: WorkspaceEventData::View {
                id: view_id.to_string(),
            },
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
        .await;

        Ok(())
    }

    /// Get the active view
    pub async fn get_active_view(
        &self,
        plugin_id: &str,
    ) -> Result<Option<ViewInfo>, WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Read)
            .await?;

        let state = self.state.read().await;
        if let Some(view_id) = &state.active_view {
            Ok(state.views.get(view_id).cloned())
        } else {
            Ok(None)
        }
    }

    /// List all views
    pub async fn list_views(&self, plugin_id: &str) -> Result<Vec<ViewInfo>, WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Read)
            .await?;

        let state = self.state.read().await;
        Ok(state.views.values().cloned().collect())
    }

    // Layout management

    /// Get current layout information
    pub async fn get_layout(&self, plugin_id: &str) -> Result<LayoutInfo, WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Read)
            .await?;

        let state = self.state.read().await;
        Ok(state.layout.clone())
    }

    /// Split the editor
    pub async fn split_editor(
        &self,
        plugin_id: &str,
        _direction: SplitDirection,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;

        let mut state = self.state.write().await;
        state.layout.split_count += 1;

        // Emit event
        drop(state);
        self.emit_event_internal(WorkspaceEvent {
            event_type: WorkspaceEventType::LayoutChanged,
            data: WorkspaceEventData::Layout {
                description: "Editor split".to_string(),
            },
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
        .await;

        Ok(())
    }

    /// Focus a specific pane
    pub async fn focus_pane(
        &self,
        plugin_id: &str,
        _pane_index: usize,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;
        // In a real implementation, this would focus the specified pane
        Ok(())
    }

    /// Toggle sidebar visibility
    pub async fn toggle_sidebar(
        &self,
        plugin_id: &str,
        position: SidebarPosition,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;

        let mut state = self.state.write().await;
        match position {
            SidebarPosition::Left => state.layout.left_sidebar = !state.layout.left_sidebar,
            SidebarPosition::Right => state.layout.right_sidebar = !state.layout.right_sidebar,
        }

        Ok(())
    }

    // Modal and notices

    /// Show a modal dialog
    pub async fn show_modal(
        &self,
        plugin_id: &str,
        config: ModalConfig,
    ) -> Result<String, WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let modal_id = Uuid::new_v4().to_string();
        let mut state = self.state.write().await;
        state.modals.insert(modal_id.clone(), config);

        Ok(modal_id)
    }

    /// Close a modal dialog
    pub async fn close_modal(&self, plugin_id: &str, modal_id: &str) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        state.modals.remove(modal_id);

        Ok(())
    }

    /// Show a notice
    pub async fn show_notice(
        &self,
        plugin_id: &str,
        _notice_type: NoticeType,
        _message: &str,
        _duration_ms: Option<u32>,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;
        // In a real implementation, this would show a notice to the user
        Ok(())
    }

    // Status bar and ribbon

    /// Add a status bar item
    pub async fn add_status_bar_item(
        &self,
        plugin_id: &str,
        item: StatusBarItem,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        state.status_items.insert(item.id.clone(), item);

        Ok(())
    }

    /// Update a status bar item
    pub async fn update_status_bar_item(
        &self,
        plugin_id: &str,
        item_id: &str,
        text: Option<&str>,
        tooltip: Option<&str>,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Write)
            .await?;

        let mut state = self.state.write().await;
        if let Some(item) = state.status_items.get_mut(item_id) {
            if let Some(text) = text {
                item.text = text.to_string();
            }
            if let Some(tooltip) = tooltip {
                item.tooltip = Some(tooltip.to_string());
            }
        }

        Ok(())
    }

    /// Remove a status bar item
    pub async fn remove_status_bar_item(
        &self,
        plugin_id: &str,
        item_id: &str,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        state.status_items.remove(item_id);

        Ok(())
    }

    /// Add a ribbon item
    pub async fn add_ribbon_item(
        &self,
        plugin_id: &str,
        item: RibbonItem,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        state.ribbon_items.insert(item.id.clone(), item);

        Ok(())
    }

    // Events and commands

    /// Subscribe to workspace events
    pub async fn subscribe_to_event(
        &self,
        plugin_id: &str,
        event_type: WorkspaceEventType,
        sender: tokio::sync::mpsc::Sender<WorkspaceEvent>,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Read)
            .await?;

        let mut state = self.state.write().await;
        let subscribers = state
            .event_subscribers
            .entry(event_type)
            .or_insert_with(Vec::new);
        subscribers.push((plugin_id.to_string(), sender));

        Ok(())
    }

    /// Unsubscribe from workspace events
    pub async fn unsubscribe_from_event(
        &self,
        plugin_id: &str,
        event_type: WorkspaceEventType,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.state.write().await;
        if let Some(subscribers) = state.event_subscribers.get_mut(&event_type) {
            subscribers.retain(|(id, _)| id != plugin_id);
        }

        Ok(())
    }

    /// Register a command
    pub async fn register_command(
        &self,
        plugin_id: &str,
        command: Command,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        state.commands.insert(command.id.clone(), command);

        Ok(())
    }

    /// Unregister a command
    pub async fn unregister_command(
        &self,
        plugin_id: &str,
        command_id: &str,
    ) -> Result<(), WorkspaceError> {
        self.check_permission(plugin_id, WorkspacePermission::Create)
            .await?;

        let mut state = self.state.write().await;
        state.commands.remove(command_id);

        Ok(())
    }

    // Internal helpers for testing

    #[cfg(test)]
    pub async fn set_active_file_internal(&self, path: &str) {
        let mut state = self.state.write().await;
        state.active_file = Some(path.to_string());
    }

    #[cfg(test)]
    pub async fn set_active_view_internal(&self, view_id: &str) {
        let mut state = self.state.write().await;
        state.active_view = Some(view_id.to_string());
        if let Some(view) = state.views.get_mut(view_id) {
            view.is_active = true;
        }
    }

    pub async fn emit_event_internal(&self, event: WorkspaceEvent) {
        let state = self.state.read().await;
        if let Some(subscribers) = state.event_subscribers.get(&event.event_type) {
            for (_plugin_id, sender) in subscribers {
                let _ = sender.send(event.clone()).await;
            }
        }
    }
}
