#![deny(clippy::unwrap_used, clippy::expect_used)]

use anyhow::Context;
use chrono::NaiveDate;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::State;

use crate::command_error::{CommandError, CommandResult};
use crate::identity::frontmatter::Priority;
use crate::identity::tasks::TaskStatus;
use crate::identity::IdentityManager;
use crate::tasks::{TaskQuery, TaskRecord};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSourceInfo {
    pub file_path: String,
    pub line_number: usize,
}

/// Query tasks by status
#[tauri::command]
pub async fn query_tasks_by_status(
    status: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<Vec<TaskRecord>> {
    let index = { identity_manager.read().task_index() };

    let task_status = match status.as_str() {
        "todo" => TaskStatus::Todo,
        "done" => TaskStatus::Done,
        _ => return Err(CommandError::invalid_input("Invalid status")),
    };

    Ok(index.get_tasks_by_status(task_status).await)
}

/// Query tasks due today
#[tauri::command]
pub async fn query_tasks_today(
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<Vec<TaskRecord>> {
    let index = { identity_manager.read().task_index() };

    Ok(index.query_today().await)
}

/// Query overdue tasks
#[tauri::command]
pub async fn query_tasks_overdue(
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<Vec<TaskRecord>> {
    let index = { identity_manager.read().task_index() };

    Ok(index.query_overdue().await)
}

/// Query tasks by date range
#[tauri::command]
pub async fn query_tasks_by_date_range(
    start_date: String,
    end_date: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<Vec<TaskRecord>> {
    let index = { identity_manager.read().task_index() };

    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| CommandError::invalid_input(format!("Invalid start date: {e}")))?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| CommandError::invalid_input(format!("Invalid end date: {e}")))?;

    Ok(index.query_by_date_range(start, end).await)
}

/// Complex query with multiple filters
#[derive(Debug, Deserialize)]
pub struct TaskQueryRequest {
    pub status: Option<String>,
    pub project: Option<String>,
    pub priority: Option<String>,
    pub has_due_date: Option<bool>,
    pub tags: Option<Vec<String>>,
}

#[tauri::command]
pub async fn query_tasks(
    query: TaskQueryRequest,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<Vec<TaskRecord>> {
    let index = { identity_manager.read().task_index() };

    let mut task_query = TaskQuery::new();

    if let Some(status_str) = query.status {
        let status = match status_str.as_str() {
            "todo" => TaskStatus::Todo,
            "done" => TaskStatus::Done,
            _ => return Err(CommandError::invalid_input("Invalid status")),
        };
        task_query = task_query.with_status(status);
    }

    if let Some(project) = query.project {
        task_query = task_query.with_project(&project);
    }

    if let Some(priority_str) = query.priority {
        let priority = match priority_str.as_str() {
            "high" => Priority::High,
            "medium" => Priority::Medium,
            "low" => Priority::Low,
            _ => return Err(CommandError::invalid_input("Invalid priority")),
        };
        task_query = task_query.with_priority(priority);
    }

    if let Some(has_due) = query.has_due_date {
        task_query = task_query.with_due_date(has_due);
    }

    if let Some(tags) = query.tags {
        task_query = task_query.with_tags(tags);
    }

    Ok(index.query(task_query).await)
}

/// Resolve a task ID to its source note and line number
#[tauri::command]
pub async fn get_task_source_by_id(
    task_id: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<TaskSourceInfo> {
    let index = { identity_manager.read().task_index() };

    let record = index
        .get_task(&task_id)
        .await
        .map_err(|_| CommandError::NotFound {
            path: task_id.clone(),
        })?;

    Ok(TaskSourceInfo {
        file_path: record.file_path.to_string_lossy().to_string(),
        line_number: record.line_number,
    })
}

/// Sync tasks from a file to the index
#[tauri::command]
pub async fn sync_file_tasks_to_index(
    file_path: String,
    identity_manager: State<'_, Arc<RwLock<IdentityManager>>>,
) -> CommandResult<()> {
    eprintln!("[sync_file_tasks_to_index command] Received file_path: {file_path:?}");

    let path = Path::new(&file_path);
    eprintln!(
        "[sync_file_tasks_to_index command] Path exists: {}",
        path.exists()
    );
    eprintln!(
        "[sync_file_tasks_to_index command] Path is absolute: {}",
        path.is_absolute()
    );

    let manager_snapshot = { identity_manager.read().clone() };

    // Use the async version to avoid blocking in async context
    manager_snapshot
        .sync_file_tasks_to_index_async(path)
        .await
        .map_err(|e| {
            eprintln!("[sync_file_tasks_to_index command] Error: {e}");
            CommandError::Identity(e.context("Failed to sync tasks"))
        })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn test_task_query_request_deserialization() {
        let json = r#"{
            "status": "todo",
            "project": "work",
            "priority": "high",
            "has_due_date": true,
            "tags": ["urgent", "review"]
        }"#;

        let query: TaskQueryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(query.status, Some("todo".to_string()));
        assert_eq!(query.project, Some("work".to_string()));
        assert_eq!(query.priority, Some("high".to_string()));
        assert_eq!(query.has_due_date, Some(true));
        assert_eq!(
            query.tags,
            Some(vec!["urgent".to_string(), "review".to_string()])
        );
    }
}
