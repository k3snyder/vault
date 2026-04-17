use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::Mutex;

use crate::identity::frontmatter::TaskProperties;
use crate::identity::tasks::TaskStatus;
use crate::identity::IdentityManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskInfo {
    pub id: String,
    pub status: String,
    pub text: String,
    pub line_number: usize,
    pub file_path: String,
    pub due: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    pub project: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TaskUpdateRequest {
    pub task_id: String,
    pub file_path: String,
    pub updates: TaskPropertyUpdates,
}

#[derive(Debug, Deserialize)]
pub struct TaskPropertyUpdates {
    pub status: Option<String>,
    pub text: Option<String>,
    pub due: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    pub project: Option<String>,
}

/// Ensure a task has a UUID - hybrid approach with optional line content
#[tauri::command]
pub async fn ensure_task_uuid(
    file_path: String,
    line_number: usize,
    line_content: Option<String>,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<serde_json::Value, String> {
    use serde_json::json;

    // If line content is provided, check if it's a task first
    if let Some(content) = line_content {
        // Parse the line to see if it's actually a task
        if let Some(task) = crate::identity::tasks::TaskParser::parse_line(&content, line_number) {
            // Check if task already has UUID in the content
            if let Some(existing_id) = task.id {
                return Ok(json!({
                    "uuid": existing_id,
                    "isNew": false,
                    "isTemporary": false
                }));
            }

            // Generate a new UUID for this task
            let mut manager = identity_manager.lock().await;
            let new_uuid = manager
                .generate_task_id()
                .map_err(|e| format!("Failed to generate UUID: {}", e))?;

            // Return the UUID with metadata
            // The frontend will handle adding it to the content
            return Ok(json!({
                "uuid": new_uuid,
                "isNew": true,
                "isTemporary": true,  // Not yet persisted to disk
                "lineNumber": line_number
            }));
        } else {
            return Err(format!("Line {} is not a task: {}", line_number, content));
        }
    }

    // Fallback to file-based approach if no line content provided
    let mut manager = identity_manager.lock().await;
    let uuid = manager
        .ensure_task_id(Path::new(&file_path), line_number)
        .map_err(|e| format!("Failed to ensure task UUID: {}", e))?;

    Ok(json!({
        "uuid": uuid,
        "isNew": false,
        "isTemporary": false
    }))
}

/// Get all tasks for a note
#[tauri::command]
pub async fn get_tasks_for_note(
    file_path: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<TaskInfo>, String> {
    let manager = identity_manager.lock().await;
    let path = Path::new(&file_path);

    // Read file content
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse front matter to get task metadata
    let (front_matter, _body) = crate::identity::frontmatter::FrontMatterParser::parse(&content)
        .map_err(|e| format!("Failed to parse front matter: {}", e))?;

    // Extract tasks from front matter if present
    let fm_tasks = if let Some(ref fm) = front_matter {
        crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    // Parse tasks from content
    let tasks = crate::identity::tasks::TaskParser::extract_all_tasks(&content);

    // Convert to TaskInfo
    let mut task_infos = Vec::new();
    for task in tasks {
        // Ensure task has an ID (read-only operation, doesn't modify file)
        let task_id = task.id.unwrap_or_else(|| {
            // Generate a temporary ID for display (not persisted)
            format!("temp-{}", task.line_number)
        });

        // Get metadata from front matter if available
        let (created_at, updated_at, completed_at, due, priority, tags, project) =
            if let Some(fm_task) = fm_tasks.get(&task_id) {
                (
                    fm_task.created_at.to_rfc3339(),
                    fm_task.updated_at.to_rfc3339(),
                    fm_task.completed_at.map(|dt| dt.to_rfc3339()),
                    fm_task.due.map(|d| d.format("%Y-%m-%d").to_string()),
                    fm_task
                        .priority
                        .as_ref()
                        .map(|p| format!("{:?}", p).to_lowercase()),
                    fm_task.tags.clone(),
                    fm_task.project.clone(),
                )
            } else {
                // Use defaults for tasks without front matter entries
                let now = chrono::Utc::now().to_rfc3339();
                (
                    now.clone(),
                    now.clone(),
                    if task.status == TaskStatus::Done {
                        Some(now.clone())
                    } else {
                        None
                    },
                    task.properties.get("due").cloned(),
                    task.properties.get("priority").cloned(),
                    task.properties
                        .get("tags")
                        .map(|t| t.split(',').map(|s| s.trim().to_string()).collect()),
                    task.properties.get("project").cloned(),
                )
            };

        task_infos.push(TaskInfo {
            id: task_id,
            status: match task.status {
                TaskStatus::Todo => "todo".to_string(),
                TaskStatus::Done => "done".to_string(),
            },
            text: task.content.clone(),
            line_number: task.line_number,
            file_path: file_path.clone(),
            due,
            priority,
            tags,
            project,
            created_at,
            updated_at,
            completed_at,
        });
    }

    Ok(task_infos)
}

/// Toggle task status by task ID
#[tauri::command]
pub async fn toggle_task_by_id(
    file_path: String,
    task_id: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<String, String> {
    let path = Path::new(&file_path);

    // Read file content
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let mut task_line_number = None;
    let mut task_found = None;

    // Find the task by ID
    for (i, line) in lines.iter().enumerate() {
        if let Some(task) = crate::identity::tasks::TaskParser::parse_line(line, i + 1) {
            if task.id == Some(task_id.clone()) {
                task_line_number = Some(i);
                task_found = Some(task);
                break;
            }
        }
    }

    if task_line_number.is_none() {
        return Err(format!("Task with ID {} not found in file", task_id));
    }

    let line_idx = task_line_number.unwrap();
    let line = lines[line_idx];

    // Toggle the task status in the line
    let toggled_line = crate::identity::tasks::TaskParser::toggle_task_status(line);
    let new_status = if toggled_line.contains("[x]") {
        "done"
    } else {
        "todo"
    };

    // Rebuild body content with toggled line, making sure we don't duplicate frontmatter
    let mut new_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    new_lines[line_idx] = toggled_line.clone();

    // Parse front matter and body separately so we can write a single YAML block
    let (front_matter, body_only) =
        crate::identity::frontmatter::FrontMatterParser::parse(&content)
            .map_err(|e| format!("Failed to parse front matter: {}", e))?;

    // Replace the toggled line within the body only (avoid keeping the old frontmatter in body)
    let updated_body = if body_only.contains(line) {
        body_only.replacen(line, &toggled_line, 1)
    } else {
        // Fallback: remove frontmatter section from rebuilt content
        let rebuilt = new_lines.join("\n");
        // Find the closing delimiter of the first frontmatter block and strip it
        if rebuilt.starts_with("---\n") || rebuilt.starts_with("---\r\n") {
            let closing = if rebuilt.contains("\r\n") {
                "\r\n---\r\n"
            } else {
                "\n---\n"
            };
            if let Some(pos) = rebuilt[4..].find(if rebuilt.contains("\r\n") {
                "\r\n---"
            } else {
                "\n---"
            }) {
                rebuilt[(4 + pos + closing.len())..].to_string()
            } else {
                body_only // couldn't identify; keep the original body
            }
        } else {
            rebuilt
        }
    };

    // Update front matter if needed
    let final_content = if let Some(ref task) = task_found {
        // Ensure we have front matter
        let mut fm = front_matter.unwrap_or_else(crate::identity::frontmatter::FrontMatter::new);

        // Extract tasks from front matter
        let mut tasks =
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
                .unwrap_or_default();

        // Update or create task entry
        if let Some(fm_task) = tasks.get_mut(&task_id) {
            // Update existing task
            if new_status == "done" {
                fm_task.mark_done();
            } else {
                fm_task.mark_todo();
            }
        } else {
            // Create new task entry
            let mut new_task =
                crate::identity::frontmatter::TaskProperties::new(task.content.clone());
            new_task.status = if new_status == "done" {
                crate::identity::frontmatter::TaskStatus::Done
            } else {
                crate::identity::frontmatter::TaskStatus::Todo
            };

            // Set properties from parsed task
            if let Some(due) = task.properties.get("due") {
                // Try to parse date in YYYY-MM-DD format
                if let Ok(date) = chrono::NaiveDate::parse_from_str(due, "%Y-%m-%d") {
                    if let Some(datetime) = date.and_hms_opt(0, 0, 0) {
                        use chrono::{TimeZone, Utc};
                        new_task.due = Some(Utc.from_utc_datetime(&datetime));
                    }
                }
            }
            if let Some(priority) = task.properties.get("priority") {
                new_task.priority = match priority.to_lowercase().as_str() {
                    "high" | "!" => Some(crate::identity::frontmatter::Priority::High),
                    "medium" | "!!" => Some(crate::identity::frontmatter::Priority::Medium),
                    "low" | "!!!" => Some(crate::identity::frontmatter::Priority::Low),
                    _ => None,
                };
            }

            tasks.insert(task_id.clone(), new_task);
        }

        // Update front matter with modified tasks
        crate::identity::frontmatter::TaskFrontMatter::update_tasks(&mut fm.extra_fields, tasks);

        // Use FrontMatterWriter to properly serialize the single front matter block
        crate::identity::frontmatter::FrontMatterWriter::write(&fm, &updated_body)
            .map_err(|e| format!("Failed to write front matter: {}", e))?
    } else {
        updated_body
    };

    // Write back atomically
    use std::io::Write;
    let temp_file = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    {
        let mut file = temp_file.as_file();
        file.write_all(final_content.as_bytes())
            .map_err(|e| format!("Failed to write file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync file: {}", e))?;
    }

    temp_file
        .persist(path)
        .map_err(|e| format!("Failed to persist file: {}", e))?;

    // Sync the updated file to the task index (async-safe)
    let manager = identity_manager.lock().await;
    manager
        .sync_file_tasks_to_index_async(path)
        .await
        .map_err(|e| format!("Failed to sync task to index: {}", e))?;

    // Return new status
    Ok(new_status.to_string())
}

/// Toggle task status between todo and done (legacy - by line number)
#[tauri::command]
pub async fn toggle_task_status(
    file_path: String,
    line_number: usize,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<String, String> {
    let path = Path::new(&file_path);

    // Read file content
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();

    if line_number == 0 || line_number > lines.len() {
        return Err(format!("Invalid line number: {}", line_number));
    }

    // Parse the task to get its ID
    let line = lines[line_number - 1];
    let parsed_task = crate::identity::tasks::TaskParser::parse_line(line, line_number);

    if parsed_task.is_none() {
        return Err(format!("No task found on line {}", line_number));
    }

    let task = parsed_task.unwrap();

    // Toggle the task status in the line
    let toggled_line = crate::identity::tasks::TaskParser::toggle_task_status(line);
    let new_status = if toggled_line.contains("[x]") {
        "done"
    } else {
        "todo"
    };

    // Rebuild content with toggled line, but write back using body-only to avoid duplicating frontmatter
    let mut new_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    new_lines[line_number - 1] = toggled_line.clone();

    // Update front matter if task has an ID
    let final_content = if let Some(task_id) = task.id {
        // Parse front matter and body
        let (front_matter, body) = crate::identity::frontmatter::FrontMatterParser::parse(&content)
            .map_err(|e| format!("Failed to parse front matter: {}", e))?;

        // Ensure we have front matter
        let mut fm = front_matter.unwrap_or_else(crate::identity::frontmatter::FrontMatter::new);

        // Extract tasks from front matter
        let mut tasks =
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
                .unwrap_or_default();

        // Update or create task entry
        if let Some(fm_task) = tasks.get_mut(&task_id) {
            // Update existing task
            if new_status == "done" {
                fm_task.mark_done();
            } else {
                fm_task.mark_todo();
            }
        } else {
            // Create new task entry
            let mut new_task =
                crate::identity::frontmatter::TaskProperties::new(task.content.clone());
            if new_status == "done" {
                new_task.mark_done();
            }

            // Add any properties from the task line
            if let Some(due) = task.properties.get("due") {
                new_task.due = crate::identity::frontmatter::tasks::normalize_due_date(due).ok();
            }
            if let Some(priority) = task.properties.get("priority") {
                new_task.priority = Some(crate::identity::frontmatter::tasks::normalize_priority(
                    priority,
                ));
            }
            if let Some(tags) = task.properties.get("tags") {
                new_task.tags = Some(tags.split(',').map(|s| s.trim().to_string()).collect());
            }
            if let Some(project) = task.properties.get("project") {
                new_task.project = Some(project.clone());
            }

            tasks.insert(task_id.clone(), new_task);
        }

        // Update front matter with modified tasks
        crate::identity::frontmatter::TaskFrontMatter::update_tasks(&mut fm.extra_fields, tasks);

        // Replace the toggled line within the body content only
        let updated_body = if body.contains(line) {
            body.replacen(line, &toggled_line, 1)
        } else {
            // Fallback: strip frontmatter from rebuilt content
            if content.starts_with("---\n") || content.starts_with("---\r\n") {
                let rebuilt = new_lines.join("\n");
                let closing = if rebuilt.contains("\r\n") {
                    "\r\n---\r\n"
                } else {
                    "\n---\n"
                };
                if let Some(pos) = rebuilt[4..].find(if rebuilt.contains("\r\n") {
                    "\r\n---"
                } else {
                    "\n---"
                }) {
                    rebuilt[(4 + pos + closing.len())..].to_string()
                } else {
                    body
                }
            } else {
                new_lines.join("\n")
            }
        };

        // Use FrontMatterWriter to properly serialize the single front matter block
        crate::identity::frontmatter::FrontMatterWriter::write(&fm, &updated_body)
            .map_err(|e| format!("Failed to write front matter: {}", e))?
    } else {
        // No task ID in frontmatter; just return body with toggled line if possible
        if content.starts_with("---\n") || content.starts_with("---\r\n") {
            // Strip the first frontmatter block from rebuilt content
            let rebuilt = new_lines.join("\n");
            let closing = if rebuilt.contains("\r\n") {
                "\r\n---\r\n"
            } else {
                "\n---\n"
            };
            if let Some(pos) = rebuilt[4..].find(if rebuilt.contains("\r\n") {
                "\r\n---"
            } else {
                "\n---"
            }) {
                rebuilt[(4 + pos + closing.len())..].to_string()
            } else {
                new_lines.join("\n")
            }
        } else {
            new_lines.join("\n")
        }
    };

    // Write back atomically
    use std::io::Write;
    let temp_file = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    {
        let mut file = temp_file.as_file();
        file.write_all(final_content.as_bytes())
            .map_err(|e| format!("Failed to write file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync file: {}", e))?;
    }

    temp_file
        .persist(path)
        .map_err(|e| format!("Failed to persist file: {}", e))?;

    // Sync the updated file to the task index
    let manager = identity_manager.lock().await;
    manager
        .sync_file_tasks_to_index(path)
        .map_err(|e| format!("Failed to sync task to index: {}", e))?;

    // Return new status
    Ok(new_status.to_string())
}

/// Update task properties
#[tauri::command]
pub async fn update_task_properties(
    request: TaskUpdateRequest,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<(), String> {
    let path = Path::new(&request.file_path);

    // Read file and parse front matter
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let (fm, body) = crate::identity::frontmatter::FrontMatterParser::parse(&content)
        .map_err(|e| format!("Failed to parse front matter: {}", e))?;

    // Get or create front matter
    let mut fm = fm.unwrap_or_else(crate::identity::frontmatter::FrontMatter::new);

    // Extract existing tasks
    let mut tasks = crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
        .map_err(|e| format!("Failed to extract tasks: {}", e))?;

    // Update or upsert the specific task
    if !tasks.contains_key(&request.task_id) {
        // Try to parse the task from the file to upsert
        let manager_lock = identity_manager.lock().await;
        match manager_lock.get_task_by_id(path, &request.task_id) {
            Ok(Some(parsed)) => {
                let mut new_task = TaskProperties::new(parsed.content.clone());
                match parsed.status {
                    crate::identity::tasks::TaskStatus::Done => new_task.mark_done(),
                    crate::identity::tasks::TaskStatus::Todo => new_task.mark_todo(),
                }
                // Carry over inline props
                if let Some(due) = parsed.properties.get("due") {
                    if let Ok(dt) = crate::identity::frontmatter::tasks::normalize_due_date(due) {
                        new_task.due = Some(dt);
                    }
                }
                if let Some(priority) = parsed.properties.get("priority") {
                    new_task.priority = Some(
                        crate::identity::frontmatter::tasks::normalize_priority(priority),
                    );
                }
                if let Some(tags) = parsed.properties.get("tags") {
                    new_task.tags = Some(tags.split(',').map(|s| s.trim().to_string()).collect());
                }
                if let Some(project) = parsed.properties.get("project") {
                    new_task.project = Some(project.clone());
                }
                tasks.insert(request.task_id.clone(), new_task);
            }
            _ => {
                // Create minimal entry if parsing failed
                tasks.insert(request.task_id.clone(), TaskProperties::new(String::new()));
            }
        }
        drop(manager_lock);
    }

    if let Some(task) = tasks.get_mut(&request.task_id) {
        // Apply updates
        if let Some(status) = request.updates.status {
            match status.as_str() {
                "done" => task.mark_done(),
                "todo" => task.mark_todo(),
                _ => {}
            }
        }
        if let Some(text) = request.updates.text {
            task.text = text;
            task.updated_at = chrono::Utc::now();
        }
        if let Some(due) = request.updates.due {
            task.due = crate::identity::frontmatter::tasks::normalize_due_date(&due).ok();
            task.updated_at = chrono::Utc::now();
        }
        if let Some(priority) = request.updates.priority {
            task.priority = Some(crate::identity::frontmatter::tasks::normalize_priority(
                &priority,
            ));
            task.updated_at = chrono::Utc::now();
        }
        if let Some(tags) = request.updates.tags {
            task.tags = Some(tags);
            task.updated_at = chrono::Utc::now();
        }
        if let Some(project) = request.updates.project {
            task.project = Some(project);
            task.updated_at = chrono::Utc::now();
        }
    }

    // Update front matter with modified tasks
    crate::identity::frontmatter::TaskFrontMatter::update_tasks(&mut fm.extra_fields, tasks);

    // Write back to file
    crate::identity::frontmatter::FrontMatterWriter::write_atomic(path, &fm, &body)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    // Sync index asynchronously
    let manager = identity_manager.lock().await;
    manager
        .sync_file_tasks_to_index_async(path)
        .await
        .map_err(|e| format!("Failed to sync tasks to index: {}", e))?;

    Ok(())
}

/// Batch ensure all tasks in a file have UUIDs
#[tauri::command]
pub async fn batch_ensure_task_uuids(
    file_path: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<String>, String> {
    let mut manager = identity_manager.lock().await;
    let path = Path::new(&file_path);

    // First ensure all tasks have UUIDs
    let uuids = manager
        .batch_ensure_task_ids(path)
        .map_err(|e| format!("Failed to batch ensure task UUIDs: {}", e))?;

    // Then sync the file to the task index so tasks show up in the widget
    manager
        .sync_file_tasks_to_index_async(path)
        .await
        .map_err(|e| format!("Failed to sync tasks to index: {}", e))?;

    Ok(uuids)
}

/// Get task by ID
#[tauri::command]
pub async fn get_task_by_id(
    file_path: String,
    task_id: String,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Option<TaskInfo>, String> {
    let manager = identity_manager.lock().await;
    let path = Path::new(&file_path);

    // Read file content to get front matter
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse front matter to get task metadata
    let (front_matter, _body) = crate::identity::frontmatter::FrontMatterParser::parse(&content)
        .map_err(|e| format!("Failed to parse front matter: {}", e))?;

    // Extract tasks from front matter if present
    let fm_tasks = if let Some(ref fm) = front_matter {
        crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    match manager.get_task_by_id(path, &task_id) {
        Ok(Some(task)) => {
            let actual_id = task.id.clone().unwrap_or(task_id.clone());

            // Get metadata from front matter if available
            let (created_at, updated_at, completed_at, due, priority, tags, project) =
                if let Some(fm_task) = fm_tasks.get(&actual_id) {
                    (
                        fm_task.created_at.to_rfc3339(),
                        fm_task.updated_at.to_rfc3339(),
                        fm_task.completed_at.map(|dt| dt.to_rfc3339()),
                        fm_task.due.map(|d| d.format("%Y-%m-%d").to_string()),
                        fm_task
                            .priority
                            .as_ref()
                            .map(|p| format!("{:?}", p).to_lowercase()),
                        fm_task.tags.clone(),
                        fm_task.project.clone(),
                    )
                } else {
                    // Use defaults for tasks without front matter entries
                    let now = chrono::Utc::now().to_rfc3339();
                    (
                        now.clone(),
                        now.clone(),
                        if task.status == TaskStatus::Done {
                            Some(now.clone())
                        } else {
                            None
                        },
                        task.properties.get("due").cloned(),
                        task.properties.get("priority").cloned(),
                        task.properties
                            .get("tags")
                            .map(|t| t.split(',').map(|s| s.trim().to_string()).collect()),
                        task.properties.get("project").cloned(),
                    )
                };

            Ok(Some(TaskInfo {
                id: actual_id,
                status: match task.status {
                    TaskStatus::Todo => "todo".to_string(),
                    TaskStatus::Done => "done".to_string(),
                },
                text: task.content.clone(),
                line_number: task.line_number,
                file_path,
                due,
                priority,
                tags,
                project,
                created_at,
                updated_at,
                completed_at,
            }))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Failed to get task: {}", e)),
    }
}

/// Find duplicate task IDs across the vault
#[tauri::command]
pub async fn find_duplicate_task_ids(
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<Vec<(String, Vec<String>)>, String> {
    let manager = identity_manager.lock().await;

    match manager.find_duplicate_task_ids() {
        Ok(duplicates) => {
            let result: Vec<(String, Vec<String>)> = duplicates
                .into_iter()
                .map(|(id, paths)| {
                    let path_strings: Vec<String> = paths
                        .into_iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    (id, path_strings)
                })
                .collect();
            Ok(result)
        }
        Err(e) => Err(format!("Failed to find duplicates: {}", e)),
    }
}

/// Add task UUIDs to entire vault
#[tauri::command]
pub async fn add_task_uuids_to_vault(
    config: Option<crate::tasks::TaskMigrationConfig>,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<crate::tasks::TaskMigrationReport, String> {
    use crate::tasks::TaskMigrationManager;
    use parking_lot::RwLock;

    // Get vault root from identity manager
    let vault_root = {
        let manager = identity_manager.lock().await;
        manager.vault_root().to_path_buf()
    };

    // Use provided config or default
    let migration_config = config.unwrap_or_default();

    // Convert Mutex to RwLock for migration manager
    let identity_manager_rwlock = Arc::new(RwLock::new({
        let manager = identity_manager.lock().await;
        manager.clone()
    }));

    // Create migration manager
    let mut migration_manager = TaskMigrationManager::new(
        identity_manager_rwlock,
        vault_root,
        migration_config.clone(),
    );

    // Run migration
    let report = if migration_config.dry_run {
        migration_manager.migrate().await
    } else {
        migration_manager.migrate_with_backup().await
    }
    .map_err(|e| format!("Migration failed: {}", e))?;

    Ok(report)
}

/// Rollback a task migration
#[tauri::command]
pub async fn rollback_task_migration(
    report: crate::tasks::TaskMigrationReport,
    identity_manager: State<'_, Arc<Mutex<IdentityManager>>>,
) -> Result<(), String> {
    use crate::tasks::TaskMigrationManager;
    use parking_lot::RwLock;

    // Get vault root from identity manager
    let vault_root = {
        let manager = identity_manager.lock().await;
        manager.vault_root().to_path_buf()
    };

    // Convert Mutex to RwLock for migration manager
    let identity_manager_rwlock = Arc::new(RwLock::new({
        let manager = identity_manager.lock().await;
        manager.clone()
    }));

    // Create migration manager with default config
    let migration_manager =
        TaskMigrationManager::new(identity_manager_rwlock, vault_root, Default::default());

    // Perform rollback
    migration_manager
        .rollback(&report)
        .await
        .map_err(|e| format!("Rollback failed: {}", e))?;

    Ok(())
}

/// Open a file at a specific line in the editor
#[tauri::command]
pub async fn open_file_at_line(
    file_path: String,
    line_number: usize,
    window: tauri::Window,
) -> Result<(), String> {
    // Emit an event to the frontend to open the file at the line
    window
        .emit(
            "open-file-at-line",
            serde_json::json!({
                "filePath": file_path,
                "lineNumber": line_number
            }),
        )
        .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(())
}

// Include test module
#[cfg(test)]
#[path = "task_commands_test.rs"]
mod tests;
