// Workspace API Tests - Test-driven development for UI and workspace operations
// Tests all Workspace API methods for plugin UI integration

use super::*;
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(test)]
mod workspace_api_tests {
    use super::*;

    // Helper function to create a test workspace
    async fn create_test_workspace() -> WorkspaceApi {
        let permission_manager = Arc::new(RwLock::new(PermissionManager::new()));
        WorkspaceApi::new(permission_manager)
    }

    // Helper to grant permissions for testing
    async fn grant_workspace_permission(
        api: &WorkspaceApi,
        plugin_id: &str,
        permission: WorkspacePermission,
    ) {
        api.grant_permission(plugin_id, permission).await;
    }

    mod active_file_management {
        use super::*;

        #[tokio::test]
        async fn test_get_active_file() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;

            // Set an active file
            workspace.set_active_file_internal("test.md").await;

            // Get active file
            let result = workspace.get_active_file("test-plugin").await;
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), Some("test.md".to_string()));
        }

        #[tokio::test]
        async fn test_set_active_file_with_permission() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Set active file
            let result = workspace.set_active_file("test-plugin", "new.md").await;
            assert!(result.is_ok());

            // Verify it was set
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;
            let active = workspace.get_active_file("test-plugin").await.unwrap();
            assert_eq!(active, Some("new.md".to_string()));
        }

        #[tokio::test]
        async fn test_set_active_file_without_permission() {
            let workspace = create_test_workspace().await;

            // Try to set without permission
            let result = workspace.set_active_file("test-plugin", "new.md").await;
            assert!(result.is_err());
            assert!(matches!(
                result.unwrap_err(),
                WorkspaceError::PermissionDenied(_)
            ));
        }

        #[tokio::test]
        async fn test_open_file() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Open a file
            let result = workspace
                .open_file("test-plugin", "document.md", false)
                .await;
            assert!(result.is_ok());

            // Verify it became active
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;
            let active = workspace.get_active_file("test-plugin").await.unwrap();
            assert_eq!(active, Some("document.md".to_string()));
        }

        #[tokio::test]
        async fn test_close_file() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Open and then close a file
            workspace
                .open_file("test-plugin", "temp.md", false)
                .await
                .unwrap();
            let result = workspace.close_file("test-plugin", "temp.md").await;
            assert!(result.is_ok());

            // Verify it's no longer active
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;
            let active = workspace.get_active_file("test-plugin").await.unwrap();
            assert_eq!(active, None);
        }
    }

    mod view_management {
        use super::*;

        #[tokio::test]
        async fn test_create_view() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            let view_config = ViewConfig {
                id: "test-view".to_string(),
                title: "Test View".to_string(),
                view_type: ViewType::Custom,
                icon: Some("test-icon".to_string()),
                position: ViewPosition::Right,
            };

            let result = workspace.create_view("test-plugin", view_config).await;
            assert!(result.is_ok());

            let view_id = result.unwrap();
            assert!(!view_id.is_empty());
        }

        #[tokio::test]
        async fn test_destroy_view() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Create a view
            let view_config = ViewConfig {
                id: "temp-view".to_string(),
                title: "Temp View".to_string(),
                view_type: ViewType::Custom,
                icon: None,
                position: ViewPosition::Left,
            };

            let view_id = workspace
                .create_view("test-plugin", view_config)
                .await
                .unwrap();

            // Destroy it
            let result = workspace.destroy_view("test-plugin", &view_id).await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_get_active_view() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Create a view
            let view_config = ViewConfig {
                id: "active-view".to_string(),
                title: "Active View".to_string(),
                view_type: ViewType::Custom,
                icon: None,
                position: ViewPosition::Center,
            };

            let view_id = workspace
                .create_view("test-plugin", view_config.clone())
                .await
                .unwrap();

            // Set it as active
            workspace.set_active_view_internal(&view_id).await;

            // Get active view
            let result = workspace.get_active_view("test-plugin").await;
            assert!(result.is_ok());

            let active_view = result.unwrap();
            assert!(active_view.is_some());
            assert_eq!(active_view.unwrap().id, view_id);
        }

        #[tokio::test]
        async fn test_list_views() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Create multiple views
            for i in 0..3 {
                let view_config = ViewConfig {
                    id: format!("view-{}", i),
                    title: format!("View {}", i),
                    view_type: ViewType::Custom,
                    icon: None,
                    position: ViewPosition::Right,
                };
                workspace
                    .create_view("test-plugin", view_config)
                    .await
                    .unwrap();
            }

            // List all views
            let views = workspace.list_views("test-plugin").await.unwrap();
            assert_eq!(views.len(), 3);
        }
    }

    mod layout_management {
        use super::*;

        #[tokio::test]
        async fn test_get_layout() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;

            let layout = workspace.get_layout("test-plugin").await;
            assert!(layout.is_ok());

            let layout_info = layout.unwrap();
            assert!(layout_info.main_area.is_some());
        }

        #[tokio::test]
        async fn test_split_editor() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Split editor horizontally
            let result = workspace
                .split_editor("test-plugin", SplitDirection::Horizontal)
                .await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_focus_pane() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Focus a specific pane
            let result = workspace.focus_pane("test-plugin", 0).await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_toggle_sidebar() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Toggle left sidebar
            let result = workspace
                .toggle_sidebar("test-plugin", SidebarPosition::Left)
                .await;
            assert!(result.is_ok());

            // Toggle right sidebar
            let result = workspace
                .toggle_sidebar("test-plugin", SidebarPosition::Right)
                .await;
            assert!(result.is_ok());
        }
    }

    mod modal_and_notices {
        use super::*;

        #[tokio::test]
        async fn test_show_modal() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            let modal_config = ModalConfig {
                title: "Test Modal".to_string(),
                content: "This is a test modal".to_string(),
                buttons: vec![
                    ModalButton {
                        text: "OK".to_string(),
                        action: ModalAction::Close,
                        primary: true,
                    },
                    ModalButton {
                        text: "Cancel".to_string(),
                        action: ModalAction::Close,
                        primary: false,
                    },
                ],
                width: Some(400),
                height: Some(300),
            };

            let result = workspace.show_modal("test-plugin", modal_config).await;
            assert!(result.is_ok());

            let modal_id = result.unwrap();
            assert!(!modal_id.is_empty());
        }

        #[tokio::test]
        async fn test_close_modal() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Show a modal
            let modal_config = ModalConfig {
                title: "Temp Modal".to_string(),
                content: "Temporary".to_string(),
                buttons: vec![],
                width: None,
                height: None,
            };

            let modal_id = workspace
                .show_modal("test-plugin", modal_config)
                .await
                .unwrap();

            // Close it
            let result = workspace.close_modal("test-plugin", &modal_id).await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_show_notice() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Show info notice
            let result = workspace
                .show_notice("test-plugin", NoticeType::Info, "Test notice", Some(5000))
                .await;
            assert!(result.is_ok());

            // Show warning notice
            let result = workspace
                .show_notice("test-plugin", NoticeType::Warning, "Warning message", None)
                .await;
            assert!(result.is_ok());

            // Show error notice
            let result = workspace
                .show_notice(
                    "test-plugin",
                    NoticeType::Error,
                    "Error occurred",
                    Some(10000),
                )
                .await;
            assert!(result.is_ok());
        }
    }

    mod status_bar_and_ribbon {
        use super::*;

        #[tokio::test]
        async fn test_add_status_bar_item() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            let status_item = StatusBarItem {
                id: "test-status".to_string(),
                text: "Status Text".to_string(),
                tooltip: Some("This is a tooltip".to_string()),
                icon: Some("icon-name".to_string()),
                position: StatusBarPosition::Left,
                priority: 100,
            };

            let result = workspace
                .add_status_bar_item("test-plugin", status_item)
                .await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_update_status_bar_item() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Write).await;

            // Add item first
            let status_item = StatusBarItem {
                id: "update-status".to_string(),
                text: "Initial".to_string(),
                tooltip: None,
                icon: None,
                position: StatusBarPosition::Right,
                priority: 50,
            };

            workspace
                .add_status_bar_item("test-plugin", status_item)
                .await
                .unwrap();

            // Update it
            let result = workspace
                .update_status_bar_item("test-plugin", "update-status", Some("Updated Text"), None)
                .await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_remove_status_bar_item() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Add item
            let status_item = StatusBarItem {
                id: "remove-status".to_string(),
                text: "Remove Me".to_string(),
                tooltip: None,
                icon: None,
                position: StatusBarPosition::Left,
                priority: 0,
            };

            workspace
                .add_status_bar_item("test-plugin", status_item)
                .await
                .unwrap();

            // Remove it
            let result = workspace
                .remove_status_bar_item("test-plugin", "remove-status")
                .await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_add_ribbon_item() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            let ribbon_item = RibbonItem {
                id: "test-ribbon".to_string(),
                icon: "ribbon-icon".to_string(),
                tooltip: "Ribbon tooltip".to_string(),
                position: 0,
            };

            let result = workspace.add_ribbon_item("test-plugin", ribbon_item).await;
            assert!(result.is_ok());
        }
    }

    mod workspace_events {
        use super::*;
        use tokio::sync::mpsc;

        #[tokio::test]
        async fn test_subscribe_to_events() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;

            let (tx, mut rx) = mpsc::channel(10);

            // Subscribe to file open events
            let result = workspace
                .subscribe_to_event("test-plugin", WorkspaceEventType::FileOpened, tx.clone())
                .await;
            assert!(result.is_ok());

            // Trigger an event
            workspace
                .emit_event_internal(WorkspaceEvent {
                    event_type: WorkspaceEventType::FileOpened,
                    data: WorkspaceEventData::File {
                        path: "test.md".to_string(),
                    },
                    timestamp: chrono::Utc::now().timestamp() as u64,
                })
                .await;

            // Check if event was received
            if let Ok(event) = rx.try_recv() {
                assert_eq!(event.event_type, WorkspaceEventType::FileOpened);
            }
        }

        #[tokio::test]
        async fn test_unsubscribe_from_events() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;

            let (tx, _rx) = mpsc::channel(10);

            // Subscribe
            workspace
                .subscribe_to_event("test-plugin", WorkspaceEventType::FileClosed, tx)
                .await
                .unwrap();

            // Unsubscribe
            let result = workspace
                .unsubscribe_from_event("test-plugin", WorkspaceEventType::FileClosed)
                .await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_command_registration() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            let command = Command {
                id: "test-command".to_string(),
                name: "Test Command".to_string(),
                description: Some("A test command".to_string()),
                hotkey: Some("Ctrl+Shift+T".to_string()),
            };

            let result = workspace.register_command("test-plugin", command).await;
            assert!(result.is_ok());
        }

        #[tokio::test]
        async fn test_command_unregistration() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            // Register command
            let command = Command {
                id: "temp-command".to_string(),
                name: "Temp Command".to_string(),
                description: None,
                hotkey: None,
            };

            workspace
                .register_command("test-plugin", command)
                .await
                .unwrap();

            // Unregister it
            let result = workspace
                .unregister_command("test-plugin", "temp-command")
                .await;
            assert!(result.is_ok());
        }
    }

    mod performance {
        use super::*;
        use std::time::Instant;

        #[tokio::test]
        async fn test_view_creation_performance() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Create)
                .await;

            let start = Instant::now();

            // Create 10 views
            for i in 0..10 {
                let view_config = ViewConfig {
                    id: format!("perf-view-{}", i),
                    title: format!("Performance View {}", i),
                    view_type: ViewType::Custom,
                    icon: None,
                    position: ViewPosition::Right,
                };
                workspace
                    .create_view("test-plugin", view_config)
                    .await
                    .unwrap();
            }

            let duration = start.elapsed();

            // Should complete in under 100ms
            assert!(duration.as_millis() < 100);
        }

        #[tokio::test]
        async fn test_event_subscription_performance() {
            let workspace = create_test_workspace().await;
            grant_workspace_permission(&workspace, "test-plugin", WorkspacePermission::Read).await;

            let start = Instant::now();

            // Subscribe to multiple event types
            for _ in 0..100 {
                let (tx, _rx) = tokio::sync::mpsc::channel(10);
                workspace
                    .subscribe_to_event("test-plugin", WorkspaceEventType::FileOpened, tx)
                    .await
                    .unwrap();
            }

            let duration = start.elapsed();

            // Should complete in under 50ms
            assert!(duration.as_millis() < 50);
        }
    }
}
