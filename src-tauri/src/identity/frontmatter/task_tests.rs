#[cfg(test)]
mod tests {
    use super::super::*;
    use chrono::{DateTime, TimeZone, Utc};
    use serde::{Deserialize, Serialize};
    use std::collections::HashMap;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    pub struct TaskProperties {
        pub status: String,
        pub text: String,
        pub due: Option<String>,
        pub priority: Option<String>,
        pub tags: Option<Vec<String>>,
        pub project: Option<String>,
        pub created_at: DateTime<Utc>,
        pub updated_at: DateTime<Utc>,
        pub completed_at: Option<DateTime<Utc>>,
    }

    #[test]
    fn test_parse_frontmatter_with_tasks() {
        let content = r#"---
id: note-uuid-123
created_at: 2025-08-24T10:00:00Z
updated_at: 2025-08-24T11:00:00Z
tasks:
  task-uuid-1:
    status: todo
    text: "Write documentation"
    due: "2025-08-30"
    priority: high
    tags: ["docs", "urgent"]
    created_at: 2025-08-24T10:00:00Z
    updated_at: 2025-08-24T10:00:00Z
  task-uuid-2:
    status: done
    text: "Fix bug"
    priority: medium
    created_at: 2025-08-23T10:00:00Z
    updated_at: 2025-08-24T09:00:00Z
    completed_at: 2025-08-24T09:00:00Z
---

# Document Content

This is the main content."#;

        let (fm, body) = FrontMatterParser::parse(content).unwrap();
        assert!(fm.is_some());

        let fm = fm.unwrap();
        assert_eq!(fm.id, Some("note-uuid-123".to_string()));

        // Check that tasks field exists in extra_fields
        assert!(fm.extra_fields.contains_key("tasks"));

        // Verify body content
        assert!(body.contains("# Document Content"));
    }

    #[test]
    fn test_write_frontmatter_with_tasks() {
        let mut fm = FrontMatter::with_id("note-uuid-456".to_string());

        // Create tasks HashMap
        let mut tasks = serde_json::Map::new();

        // Task 1
        let mut task1 = serde_json::Map::new();
        task1.insert(
            "status".to_string(),
            serde_json::Value::String("todo".to_string()),
        );
        task1.insert(
            "text".to_string(),
            serde_json::Value::String("Complete feature".to_string()),
        );
        task1.insert(
            "priority".to_string(),
            serde_json::Value::String("high".to_string()),
        );
        task1.insert(
            "created_at".to_string(),
            serde_json::Value::String("2025-08-24T10:00:00Z".to_string()),
        );
        task1.insert(
            "updated_at".to_string(),
            serde_json::Value::String("2025-08-24T10:00:00Z".to_string()),
        );

        tasks.insert("task-id-1".to_string(), serde_json::Value::Object(task1));

        fm.extra_fields
            .insert("tasks".to_string(), serde_json::Value::Object(tasks));

        let body = "# Test Document\n\nContent here.";
        let result = FrontMatterWriter::write(&fm, body).unwrap();

        // Verify the output contains tasks
        assert!(result.contains("tasks:"));
        assert!(result.contains("task-id-1:"));
        assert!(result.contains("status: todo"));
        assert!(result.contains("text: Complete feature"));
        assert!(result.contains("# Test Document"));
    }

    #[test]
    fn test_atomic_task_update() {
        let content = r#"---
id: note-uuid-789
tasks:
  task-uuid-1:
    status: todo
    text: "Original task"
    priority: low
    created_at: 2025-08-24T10:00:00Z
    updated_at: 2025-08-24T10:00:00Z
---

Content"#;

        let (fm, body) = FrontMatterParser::parse(content).unwrap();
        assert!(fm.is_some());

        let mut fm = fm.unwrap();

        // Update task properties
        if let Some(serde_json::Value::Object(ref mut tasks)) = fm.extra_fields.get_mut("tasks") {
            if let Some(serde_json::Value::Object(ref mut task)) = tasks.get_mut("task-uuid-1") {
                task.insert(
                    "status".to_string(),
                    serde_json::Value::String("done".to_string()),
                );
                task.insert(
                    "priority".to_string(),
                    serde_json::Value::String("high".to_string()),
                );
                task.insert(
                    "completed_at".to_string(),
                    serde_json::Value::String(Utc::now().to_rfc3339()),
                );
            }
        }

        let result = FrontMatterWriter::write(&fm, &body).unwrap();

        // Verify updates
        assert!(result.contains("status: done"));
        assert!(result.contains("priority: high"));
        assert!(result.contains("completed_at:"));
    }

    #[test]
    fn test_normalize_priority() {
        let test_cases = vec![
            ("!p1", "high"),
            ("!p2", "medium"),
            ("!p3", "medium"),
            ("!p4", "low"),
            ("!p5", "low"),
            ("high", "high"),
            ("medium", "medium"),
            ("low", "low"),
            ("1", "high"),
            ("2", "medium"),
            ("3", "medium"),
        ];

        for (input, expected) in test_cases {
            let normalized = normalize_priority(input);
            assert_eq!(normalized, expected, "Failed for input: {}", input);
        }
    }

    #[test]
    fn test_normalize_due_date() {
        // Test ISO date format
        let iso_date = "2025-08-30";
        let normalized = normalize_due_date(iso_date);
        assert_eq!(normalized, "2025-08-30T00:00:00+00:00");

        // Test date-time format
        let datetime = "2025-08-30T14:30:00Z";
        let normalized = normalize_due_date(datetime);
        assert_eq!(normalized, "2025-08-30T14:30:00+00:00");
    }

    #[test]
    fn test_validate_task_properties() {
        let mut props = HashMap::new();
        props.insert("status".to_string(), "todo".to_string());
        props.insert("text".to_string(), "Valid task".to_string());
        props.insert("priority".to_string(), "high".to_string());
        props.insert("due".to_string(), "2025-08-30T00:00:00+00:00".to_string());

        assert!(validate_task_properties(&props).is_ok());

        // Test invalid status
        props.insert("status".to_string(), "invalid".to_string());
        assert!(validate_task_properties(&props).is_err());

        // Test missing text
        props.remove("text");
        assert!(validate_task_properties(&props).is_err());
    }

    #[test]
    fn test_merge_concurrent_task_updates() {
        let original = r#"---
id: note-123
tasks:
  task-1:
    status: todo
    text: "Task 1"
    priority: low
---"#;

        let update1 = r#"---
id: note-123
tasks:
  task-1:
    status: done
    text: "Task 1"
    priority: low
---"#;

        let update2 = r#"---
id: note-123
tasks:
  task-1:
    status: todo
    text: "Task 1"
    priority: high
---"#;

        // Parse all versions
        let (orig_fm, _) = FrontMatterParser::parse(original).unwrap();
        let (fm1, _) = FrontMatterParser::parse(update1).unwrap();
        let (fm2, _) = FrontMatterParser::parse(update2).unwrap();

        // Merge updates (update1 changes status, update2 changes priority)
        let merged = merge_task_updates(
            orig_fm.as_ref().unwrap(),
            fm1.as_ref().unwrap(),
            fm2.as_ref().unwrap(),
        )
        .unwrap();

        // Verify merge result has both changes
        if let Some(serde_json::Value::Object(ref tasks)) = merged.extra_fields.get("tasks") {
            if let Some(serde_json::Value::Object(ref task)) = tasks.get("task-1") {
                assert_eq!(
                    task.get("status"),
                    Some(&serde_json::Value::String("done".to_string()))
                );
                assert_eq!(
                    task.get("priority"),
                    Some(&serde_json::Value::String("high".to_string()))
                );
            }
        }
    }

    #[test]
    fn test_preserve_unknown_fields() {
        let content = r#"---
id: note-uuid-123
custom_field: "preserved"
author: "John Doe"
tasks:
  task-1:
    status: todo
    text: "Test task"
    custom_task_field: "also preserved"
---

Content"#;

        let (fm, body) = FrontMatterParser::parse(content).unwrap();
        let fm = fm.unwrap();

        // Verify custom fields are preserved
        assert!(fm.extra_fields.contains_key("custom_field"));
        assert!(fm.extra_fields.contains_key("author"));

        // Write back and verify preservation
        let result = FrontMatterWriter::write(&fm, &body).unwrap();
        assert!(result.contains("custom_field:"));
        assert!(result.contains("author:"));
        assert!(result.contains("custom_task_field:"));
    }

    #[test]
    fn test_batch_task_updates() {
        let mut fm = FrontMatter::with_id("note-batch".to_string());

        let task_updates = vec![
            (
                "task-1",
                HashMap::from([
                    ("status".to_string(), "todo".to_string()),
                    ("text".to_string(), "First task".to_string()),
                ]),
            ),
            (
                "task-2",
                HashMap::from([
                    ("status".to_string(), "done".to_string()),
                    ("text".to_string(), "Second task".to_string()),
                ]),
            ),
            (
                "task-3",
                HashMap::from([
                    ("status".to_string(), "todo".to_string()),
                    ("text".to_string(), "Third task".to_string()),
                ]),
            ),
        ];

        batch_update_tasks(&mut fm, task_updates).unwrap();

        // Verify all tasks were added
        if let Some(serde_json::Value::Object(ref tasks)) = fm.extra_fields.get("tasks") {
            assert_eq!(tasks.len(), 3);
            assert!(tasks.contains_key("task-1"));
            assert!(tasks.contains_key("task-2"));
            assert!(tasks.contains_key("task-3"));
        } else {
            panic!("Tasks field not found");
        }
    }

    // Helper functions for testing
    fn normalize_priority(input: &str) -> &str {
        match input {
            "!p1" | "1" | "high" => "high",
            "!p2" | "!p3" | "2" | "3" | "medium" => "medium",
            "!p4" | "!p5" | "4" | "5" | "low" => "low",
            _ => "medium",
        }
    }

    fn normalize_due_date(input: &str) -> String {
        if let Ok(dt) = DateTime::parse_from_rfc3339(input) {
            return dt.with_timezone(&Utc).to_rfc3339();
        }

        // Try parsing as date only (YYYY-MM-DD)
        if let Ok(date) = chrono::NaiveDate::parse_from_str(input, "%Y-%m-%d") {
            let datetime = date.and_hms_opt(0, 0, 0).unwrap();
            return Utc.from_utc_datetime(&datetime).to_rfc3339();
        }

        input.to_string()
    }

    fn validate_task_properties(props: &HashMap<String, String>) -> Result<(), String> {
        // Check required fields
        if !props.contains_key("text") {
            return Err("Task text is required".to_string());
        }

        // Validate status
        if let Some(status) = props.get("status") {
            if !["todo", "done"].contains(&status.as_str()) {
                return Err(format!("Invalid status: {}", status));
            }
        }

        // Validate priority
        if let Some(priority) = props.get("priority") {
            if !["high", "medium", "low"].contains(&priority.as_str()) {
                return Err(format!("Invalid priority: {}", priority));
            }
        }

        Ok(())
    }

    fn merge_task_updates(
        _original: &FrontMatter,
        update1: &FrontMatter,
        update2: &FrontMatter,
    ) -> Result<FrontMatter, String> {
        let mut merged = update1.clone();

        // Merge tasks from update2
        if let Some(serde_json::Value::Object(ref tasks2)) = update2.extra_fields.get("tasks") {
            let tasks_mut = merged
                .extra_fields
                .entry("tasks".to_string())
                .or_insert(serde_json::Value::Object(serde_json::Map::new()));

            if let serde_json::Value::Object(ref mut tasks1) = tasks_mut {
                for (task_id, task2) in tasks2 {
                    if let Some(task2_obj) = task2.as_object() {
                        let task1_mut = tasks1
                            .entry(task_id.clone())
                            .or_insert(serde_json::Value::Object(serde_json::Map::new()));

                        if let serde_json::Value::Object(ref mut task1_obj) = task1_mut {
                            // Merge fields from task2 into task1
                            for (key, value) in task2_obj {
                                task1_obj.insert(key.clone(), value.clone());
                            }
                        }
                    }
                }
            }
        }

        Ok(merged)
    }

    fn batch_update_tasks(
        fm: &mut FrontMatter,
        updates: Vec<(&str, HashMap<String, String>)>,
    ) -> Result<(), String> {
        let tasks_mut = fm
            .extra_fields
            .entry("tasks".to_string())
            .or_insert(serde_json::Value::Object(serde_json::Map::new()));

        if let serde_json::Value::Object(ref mut tasks) = tasks_mut {
            for (task_id, props) in updates {
                let mut task_obj = serde_json::Map::new();
                for (key, value) in props {
                    task_obj.insert(key, serde_json::Value::String(value));
                }
                task_obj.insert(
                    "created_at".to_string(),
                    serde_json::Value::String(Utc::now().to_rfc3339()),
                );
                task_obj.insert(
                    "updated_at".to_string(),
                    serde_json::Value::String(Utc::now().to_rfc3339()),
                );

                tasks.insert(task_id.to_string(), serde_json::Value::Object(task_obj));
            }
        }

        Ok(())
    }
}
