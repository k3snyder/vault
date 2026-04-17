use anyhow::Result;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::identity::frontmatter::Priority;
use crate::identity::tasks::TaskStatus;
use crate::identity::IdentityManager;
use crate::tasks::{IndexStats, TaskQuery, TaskRecord};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSourceInfo {
    pub file_path: String,
    pub line_number: usize,
}

/// Query tasks by project
#[tauri::command]
pub async fn query_tasks_by_project(
    project: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    Ok(index.get_tasks_by_project(&project).await)
}

/// Query tasks by status
#[tauri::command]
pub async fn query_tasks_by_status(
    status: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    let task_status = match status.as_str() {
        "todo" => TaskStatus::Todo,
        "done" => TaskStatus::Done,
        _ => return Err("Invalid status".to_string()),
    };

    Ok(index.get_tasks_by_status(task_status).await)
}

/// Query tasks due today
#[tauri::command]
pub async fn query_tasks_today(
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    Ok(index.query_today().await)
}

/// Query overdue tasks
#[tauri::command]
pub async fn query_tasks_overdue(
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    Ok(index.query_overdue().await)
}

/// Query tasks by date range
#[tauri::command]
pub async fn query_tasks_by_date_range(
    start_date: String,
    end_date: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid start date: {}", e))?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid end date: {}", e))?;

    Ok(index.query_by_date_range(start, end).await)
}

/// Get tasks sorted by due date
#[tauri::command]
pub async fn get_tasks_sorted_by_due_date(
    ascending: bool,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    Ok(index.get_sorted_by_due_date(ascending).await)
}

/// Get tasks sorted by priority
#[tauri::command]
pub async fn get_tasks_sorted_by_priority(
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    Ok(index.get_sorted_by_priority().await)
}

/// Get index statistics
#[tauri::command]
pub async fn get_task_index_stats(
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<IndexStats, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    Ok(index.get_stats().await)
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
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskRecord>, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    let mut task_query = TaskQuery::new();

    if let Some(status_str) = query.status {
        let status = match status_str.as_str() {
            "todo" => TaskStatus::Todo,
            "done" => TaskStatus::Done,
            _ => return Err("Invalid status".to_string()),
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
            _ => return Err("Invalid priority".to_string()),
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
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<TaskSourceInfo, String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    let record = index
        .get_task(&task_id)
        .await
        .map_err(|e| format!("Task not found: {}", e))?;

    Ok(TaskSourceInfo {
        file_path: record.file_path.to_string_lossy().to_string(),
        line_number: record.line_number,
    })
}

/// Sync tasks from a file to the index
#[tauri::command]
pub async fn sync_file_tasks_to_index(
    file_path: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<(), String> {
    eprintln!(
        "[sync_file_tasks_to_index command] Received file_path: {:?}",
        file_path
    );

    let path = Path::new(&file_path);
    eprintln!(
        "[sync_file_tasks_to_index command] Path exists: {}",
        path.exists()
    );
    eprintln!(
        "[sync_file_tasks_to_index command] Path is absolute: {}",
        path.is_absolute()
    );

    let manager = identity_manager.lock().await;

    // Use the async version to avoid blocking in async context
    manager
        .sync_file_tasks_to_index_async(path)
        .await
        .map_err(|e| {
            eprintln!("[sync_file_tasks_to_index command] Error: {}", e);
            format!("Failed to sync tasks: {}", e)
        })
}

/// Verify index consistency
#[tauri::command]
pub async fn verify_task_index_consistency(
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<(), String> {
    let manager = identity_manager.lock().await;
    let index = manager.task_index();

    index
        .verify_consistency()
        .await
        .map_err(|e| format!("Index inconsistency detected: {}", e))
}

#[cfg(test)]
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
