use super::{FrontMatter, FrontMatterParser, FrontMatterWriter};
use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Canonical task properties stored in front matter
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskProperties {
    pub status: TaskStatus,
    pub text: String,
    pub due: Option<DateTime<Utc>>,
    pub priority: Option<Priority>,
    pub tags: Option<Vec<String>>,
    pub project: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Done,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Medium,
    Low,
}

impl TaskProperties {
    pub fn new(text: String) -> Self {
        let now = Utc::now();
        Self {
            status: TaskStatus::Todo,
            text,
            due: None,
            priority: None,
            tags: None,
            project: None,
            created_at: now,
            updated_at: now,
            completed_at: None,
        }
    }

    pub fn mark_done(&mut self) {
        self.status = TaskStatus::Done;
        self.completed_at = Some(Utc::now());
        self.updated_at = Utc::now();
    }

    pub fn mark_todo(&mut self) {
        self.status = TaskStatus::Todo;
        self.completed_at = None;
        self.updated_at = Utc::now();
    }
}

/// Task-related extensions for FrontMatter operations
pub struct TaskFrontMatter;

impl TaskFrontMatter {
    /// Extract tasks from front matter extra_fields
    pub fn extract_tasks(
        extra_fields: &std::collections::BTreeMap<String, serde_json::Value>,
    ) -> Result<HashMap<String, TaskProperties>> {
        let mut tasks = HashMap::new();

        if let Some(serde_json::Value::Object(tasks_obj)) = extra_fields.get("tasks") {
            for (task_id, task_value) in tasks_obj {
                if let serde_json::Value::Object(task_obj) = task_value {
                    let props = Self::parse_task_properties(task_obj)?;
                    tasks.insert(task_id.clone(), props);
                }
            }
        }

        Ok(tasks)
    }

    /// Parse task properties from JSON object
    fn parse_task_properties(
        obj: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<TaskProperties> {
        let status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| match s {
                "done" => TaskStatus::Done,
                _ => TaskStatus::Todo,
            })
            .unwrap_or(TaskStatus::Todo);

        let text = obj
            .get("text")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Task text is required"))?
            .to_string();

        let due = obj
            .get("due")
            .and_then(|v| v.as_str())
            .and_then(|s| Self::parse_date(s));

        let priority = obj
            .get("priority")
            .and_then(|v| v.as_str())
            .and_then(|s| Self::parse_priority(s));

        let tags = obj.get("tags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

        let project = obj
            .get("project")
            .and_then(|v| v.as_str())
            .map(String::from);

        let created_at = obj
            .get("created_at")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);

        let updated_at = obj
            .get("updated_at")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);

        let completed_at = obj
            .get("completed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc));

        Ok(TaskProperties {
            status,
            text,
            due,
            priority,
            tags,
            project,
            created_at,
            updated_at,
            completed_at,
        })
    }

    /// Convert TaskProperties to JSON object for storage
    pub fn task_to_json(task: &TaskProperties) -> serde_json::Value {
        let mut obj = serde_json::Map::new();

        obj.insert(
            "status".to_string(),
            serde_json::Value::String(
                match task.status {
                    TaskStatus::Todo => "todo",
                    TaskStatus::Done => "done",
                }
                .to_string(),
            ),
        );

        obj.insert(
            "text".to_string(),
            serde_json::Value::String(task.text.clone()),
        );

        if let Some(ref due) = task.due {
            obj.insert(
                "due".to_string(),
                serde_json::Value::String(due.to_rfc3339()),
            );
        }

        if let Some(ref priority) = task.priority {
            obj.insert(
                "priority".to_string(),
                serde_json::Value::String(
                    match priority {
                        Priority::High => "high",
                        Priority::Medium => "medium",
                        Priority::Low => "low",
                    }
                    .to_string(),
                ),
            );
        }

        if let Some(ref tags) = task.tags {
            let tags_array: Vec<serde_json::Value> = tags
                .iter()
                .map(|t| serde_json::Value::String(t.clone()))
                .collect();
            obj.insert("tags".to_string(), serde_json::Value::Array(tags_array));
        }

        if let Some(ref project) = task.project {
            obj.insert(
                "project".to_string(),
                serde_json::Value::String(project.clone()),
            );
        }

        obj.insert(
            "created_at".to_string(),
            serde_json::Value::String(task.created_at.to_rfc3339()),
        );
        obj.insert(
            "updated_at".to_string(),
            serde_json::Value::String(task.updated_at.to_rfc3339()),
        );

        if let Some(ref completed) = task.completed_at {
            obj.insert(
                "completed_at".to_string(),
                serde_json::Value::String(completed.to_rfc3339()),
            );
        }

        serde_json::Value::Object(obj)
    }

    /// Update tasks in front matter
    pub fn update_tasks(
        extra_fields: &mut std::collections::BTreeMap<String, serde_json::Value>,
        tasks: HashMap<String, TaskProperties>,
    ) {
        let mut tasks_obj = serde_json::Map::new();

        for (task_id, props) in tasks {
            tasks_obj.insert(task_id, Self::task_to_json(&props));
        }

        extra_fields.insert("tasks".to_string(), serde_json::Value::Object(tasks_obj));
    }

    /// Add or update a single task in front matter
    pub fn upsert_task(
        extra_fields: &mut std::collections::BTreeMap<String, serde_json::Value>,
        task_id: String,
        properties: TaskProperties,
    ) {
        // Get existing tasks or create new map
        let mut tasks = Self::extract_tasks(extra_fields).unwrap_or_default();

        // Add or update the task
        tasks.insert(task_id, properties);

        // Write back all tasks
        Self::update_tasks(extra_fields, tasks);
    }

    /// Remove a task from front matter
    pub fn remove_task(
        extra_fields: &mut std::collections::BTreeMap<String, serde_json::Value>,
        task_id: &str,
    ) -> Option<TaskProperties> {
        // Get existing tasks
        let mut tasks = Self::extract_tasks(extra_fields).unwrap_or_default();

        // Remove the task
        let removed = tasks.remove(task_id);

        // Write back remaining tasks
        if tasks.is_empty() {
            extra_fields.remove("tasks");
        } else {
            Self::update_tasks(extra_fields, tasks);
        }

        removed
    }

    /// Get a single task from front matter
    pub fn get_task(
        extra_fields: &std::collections::BTreeMap<String, serde_json::Value>,
        task_id: &str,
    ) -> Option<TaskProperties> {
        let tasks = Self::extract_tasks(extra_fields).ok()?;
        tasks.get(task_id).cloned()
    }

    /// Batch update multiple tasks efficiently
    pub fn batch_update_tasks(
        extra_fields: &mut std::collections::BTreeMap<String, serde_json::Value>,
        updates: Vec<(String, TaskProperties)>,
    ) {
        let mut tasks = Self::extract_tasks(extra_fields).unwrap_or_default();

        for (task_id, properties) in updates {
            tasks.insert(task_id, properties);
        }

        Self::update_tasks(extra_fields, tasks);
    }

    /// Parse a date string into DateTime<Utc>
    fn parse_date(date_str: &str) -> Option<DateTime<Utc>> {
        // Try RFC3339 format first
        if let Ok(dt) = DateTime::parse_from_rfc3339(date_str) {
            return Some(dt.with_timezone(&Utc));
        }

        // Try date-only format (YYYY-MM-DD)
        if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            let datetime = date.and_hms_opt(0, 0, 0)?;
            return Some(Utc.from_utc_datetime(&datetime));
        }

        None
    }

    fn parse_priority(priority_str: &str) -> Option<Priority> {
        match priority_str.to_lowercase().as_str() {
            "high" | "!p1" | "1" => Some(Priority::High),
            "medium" | "!p2" | "!p3" | "2" | "3" => Some(Priority::Medium),
            "low" | "!p4" | "!p5" | "4" | "5" => Some(Priority::Low),
            _ => None,
        }
    }

    /// Atomically update a task in a file
    pub fn update_task_atomic(
        file_path: &Path,
        task_id: &str,
        update_fn: impl FnOnce(&mut TaskProperties),
    ) -> Result<()> {
        // Read current file
        let content = std::fs::read_to_string(file_path)?;
        let (fm, body) = FrontMatterParser::parse(&content)?;
        let mut fm = fm.ok_or_else(|| anyhow::anyhow!("No front matter found"))?;

        // Get and update task
        let mut tasks = Self::extract_tasks(&fm.extra_fields)?;
        if let Some(task) = tasks.get_mut(task_id) {
            update_fn(task);
            task.updated_at = Utc::now();
        } else {
            anyhow::bail!("Task {} not found", task_id);
        }

        // Update front matter
        Self::update_tasks(&mut fm.extra_fields, tasks);

        // Write atomically
        FrontMatterWriter::write_atomic(file_path, &fm, &body)?;

        Ok(())
    }

    /// Atomically add a new task to a file
    pub fn add_task_atomic(
        file_path: &Path,
        task_id: String,
        properties: TaskProperties,
    ) -> Result<()> {
        // Read current file
        let content = std::fs::read_to_string(file_path)?;
        let (fm, body) = FrontMatterParser::parse(&content)?;
        let mut fm = fm.unwrap_or_else(|| FrontMatter::new());

        // Add task
        Self::upsert_task(&mut fm.extra_fields, task_id, properties);

        // Write atomically
        FrontMatterWriter::write_atomic(file_path, &fm, &body)?;

        Ok(())
    }

    /// Atomically remove a task from a file
    pub fn remove_task_atomic(file_path: &Path, task_id: &str) -> Result<Option<TaskProperties>> {
        // Read current file
        let content = std::fs::read_to_string(file_path)?;
        let (fm, body) = FrontMatterParser::parse(&content)?;
        let mut fm = fm.ok_or_else(|| anyhow::anyhow!("No front matter found"))?;

        // Remove task
        let removed = Self::remove_task(&mut fm.extra_fields, task_id);

        // Write atomically
        FrontMatterWriter::write_atomic(file_path, &fm, &body)?;

        Ok(removed)
    }
}

/// Normalize priority values to canonical form
pub fn normalize_priority(input: &str) -> Priority {
    match input.to_lowercase().as_str() {
        "!p1" | "1" | "high" => Priority::High,
        "!p2" | "!p3" | "2" | "3" | "medium" => Priority::Medium,
        "!p4" | "!p5" | "4" | "5" | "low" => Priority::Low,
        _ => Priority::Medium,
    }
}

/// Normalize due date to ISO 8601 format
pub fn normalize_due_date(input: &str) -> Result<DateTime<Utc>> {
    // Try RFC3339 format
    if let Ok(dt) = DateTime::parse_from_rfc3339(input) {
        return Ok(dt.with_timezone(&Utc));
    }

    // Try date-only format (YYYY-MM-DD)
    if let Ok(date) = chrono::NaiveDate::parse_from_str(input, "%Y-%m-%d") {
        let datetime = date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| anyhow::anyhow!("Invalid time"))?;
        return Ok(Utc.from_utc_datetime(&datetime));
    }

    anyhow::bail!("Unable to parse date: {}", input)
}

/// Validate task properties
pub fn validate_task_properties(props: &TaskProperties) -> Result<()> {
    // Text must not be empty
    if props.text.trim().is_empty() {
        anyhow::bail!("Task text cannot be empty");
    }

    // If completed, must have completed_at
    if props.status == TaskStatus::Done && props.completed_at.is_none() {
        anyhow::bail!("Completed tasks must have a completion date");
    }

    // If not completed, should not have completed_at
    if props.status == TaskStatus::Todo && props.completed_at.is_some() {
        anyhow::bail!("Uncompleted tasks should not have a completion date");
    }

    Ok(())
}

/// Merge task updates from concurrent modifications
pub fn merge_task_updates(
    original: &HashMap<String, TaskProperties>,
    update1: &HashMap<String, TaskProperties>,
    update2: &HashMap<String, TaskProperties>,
) -> Result<HashMap<String, TaskProperties>> {
    let mut merged = HashMap::new();

    // Get all task IDs from all versions
    let mut all_ids = std::collections::HashSet::new();
    all_ids.extend(original.keys().cloned());
    all_ids.extend(update1.keys().cloned());
    all_ids.extend(update2.keys().cloned());

    for task_id in all_ids {
        let orig = original.get(&task_id);
        let u1 = update1.get(&task_id);
        let u2 = update2.get(&task_id);

        match (orig, u1, u2) {
            // Task exists in all versions - merge changes
            (Some(o), Some(v1), Some(v2)) => {
                let merged_task = merge_single_task(o, v1, v2)?;
                merged.insert(task_id, merged_task);
            }
            // Task only in update1
            (_, Some(v1), None) => {
                merged.insert(task_id, v1.clone());
            }
            // Task only in update2
            (_, None, Some(v2)) => {
                merged.insert(task_id, v2.clone());
            }
            // Task in both updates but not original (new task)
            (None, Some(v1), Some(v2)) => {
                // Use the one with later updated_at
                if v1.updated_at >= v2.updated_at {
                    merged.insert(task_id, v1.clone());
                } else {
                    merged.insert(task_id, v2.clone());
                }
            }
            _ => {}
        }
    }

    Ok(merged)
}

fn merge_single_task(
    original: &TaskProperties,
    update1: &TaskProperties,
    update2: &TaskProperties,
) -> Result<TaskProperties> {
    let mut merged = original.clone();

    // Status - if both changed, prefer completed
    if update1.status != original.status || update2.status != original.status {
        if update1.status == TaskStatus::Done || update2.status == TaskStatus::Done {
            merged.status = TaskStatus::Done;
            merged.completed_at = update1.completed_at.or(update2.completed_at);
        } else {
            merged.status = TaskStatus::Todo;
        }
    }

    // Text - use most recently updated
    if update1.text != original.text || update2.text != original.text {
        if update1.updated_at >= update2.updated_at {
            merged.text = update1.text.clone();
        } else {
            merged.text = update2.text.clone();
        }
    }

    // Priority - use most recently set
    if update1.priority != original.priority {
        merged.priority = update1.priority.clone();
    }
    if update2.priority != original.priority {
        // If update2 also changed priority, it takes precedence
        // (either because it's newer or we prefer the second update in case of conflict)
        merged.priority = update2.priority.clone();
    }

    // Due date - use most recently set
    if update1.due != original.due {
        merged.due = update1.due;
    }
    if update2.due != original.due {
        // If update2 also changed due date, it takes precedence
        merged.due = update2.due;
    }

    // Tags - merge both sets
    let mut all_tags = std::collections::HashSet::new();
    if let Some(ref tags) = update1.tags {
        all_tags.extend(tags.clone());
    }
    if let Some(ref tags) = update2.tags {
        all_tags.extend(tags.clone());
    }
    if !all_tags.is_empty() {
        merged.tags = Some(all_tags.into_iter().collect());
    }

    // Project - use most recently set
    if update1.project != original.project {
        merged.project = update1.project.clone();
    }
    if update2.project != original.project {
        // If update2 also changed project, it takes precedence
        merged.project = update2.project.clone();
    }

    // Update timestamp
    merged.updated_at = std::cmp::max(update1.updated_at, update2.updated_at);

    Ok(merged)
}
