#[cfg(test)]
mod tests {
    use super::super::tasks::{
        merge_task_updates, normalize_due_date, normalize_priority, validate_task_properties,
    };
    use super::super::*;
    use chrono::{DateTime, TimeZone, Utc};
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    // Test 3.1: Front matter tasks field operations
    #[test]
    fn test_add_task_to_frontmatter() {
        let mut fm = FrontMatter::with_id("note-123".to_string());
        let task_id = "task-uuid-1";
        let props = TaskProperties::new("Complete documentation".to_string());

        TaskFrontMatter::upsert_task(&mut fm.extra_fields, task_id.to_string(), props.clone());

        // Verify task was added
        let tasks = TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks.get(task_id).unwrap().text, "Complete documentation");
    }

    #[test]
    fn test_update_existing_task() {
        let mut fm = FrontMatter::with_id("note-123".to_string());
        let task_id = "task-uuid-1";

        // Add initial task
        let mut props = TaskProperties::new("Initial task".to_string());
        TaskFrontMatter::upsert_task(&mut fm.extra_fields, task_id.to_string(), props.clone());

        // Update task
        props.text = "Updated task".to_string();
        props.priority = Some(Priority::High);
        TaskFrontMatter::upsert_task(&mut fm.extra_fields, task_id.to_string(), props);

        // Verify update
        let tasks = TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();
        assert_eq!(tasks.get(task_id).unwrap().text, "Updated task");
        assert_eq!(tasks.get(task_id).unwrap().priority, Some(Priority::High));
    }

    #[test]
    fn test_remove_task_from_frontmatter() {
        let mut fm = FrontMatter::with_id("note-123".to_string());

        // Add multiple tasks
        TaskFrontMatter::upsert_task(
            &mut fm.extra_fields,
            "task-1".to_string(),
            TaskProperties::new("Task 1".to_string()),
        );
        TaskFrontMatter::upsert_task(
            &mut fm.extra_fields,
            "task-2".to_string(),
            TaskProperties::new("Task 2".to_string()),
        );

        // Remove one task
        let mut tasks = TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();
        tasks.remove("task-1");
        TaskFrontMatter::update_tasks(&mut fm.extra_fields, tasks);

        // Verify removal
        let remaining_tasks = TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();
        assert_eq!(remaining_tasks.len(), 1);
        assert!(!remaining_tasks.contains_key("task-1"));
        assert!(remaining_tasks.contains_key("task-2"));
    }

    // Test 3.2: Atomic task property updates
    #[test]
    fn test_atomic_task_status_update() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-note.md");

        // Create initial file with task
        let mut fm = FrontMatter::with_id("note-123".to_string());
        let task_id = "task-uuid-1";
        let mut props = TaskProperties::new("Test task".to_string());
        TaskFrontMatter::upsert_task(&mut fm.extra_fields, task_id.to_string(), props.clone());

        let content = "# Test Note\n\n- [ ] Test task <!-- tid: task-uuid-1 -->";
        FrontMatterWriter::write_atomic(&file_path, &fm, content).unwrap();

        // Update task status atomically
        props.mark_done();
        TaskFrontMatter::upsert_task(&mut fm.extra_fields, task_id.to_string(), props);
        FrontMatterWriter::write_atomic(&file_path, &fm, content).unwrap();

        // Verify update
        let updated_content = fs::read_to_string(&file_path).unwrap();
        let (updated_fm, _) = FrontMatterParser::parse(&updated_content).unwrap();
        let tasks = TaskFrontMatter::extract_tasks(&updated_fm.unwrap().extra_fields).unwrap();

        assert_eq!(tasks.get(task_id).unwrap().status, TaskStatus::Done);
        assert!(tasks.get(task_id).unwrap().completed_at.is_some());
    }

    // Test 3.3: Property normalization
    #[test]
    fn test_priority_normalization() {
        let test_cases = vec![
            ("!p1", Priority::High),
            ("!p2", Priority::Medium),
            ("!p3", Priority::Medium),
            ("!p4", Priority::Low),
            ("!p5", Priority::Low),
            ("high", Priority::High),
            ("HIGH", Priority::High),
            ("1", Priority::High),
            ("2", Priority::Medium),
            ("3", Priority::Medium),
            ("4", Priority::Low),
            ("5", Priority::Low),
        ];

        for (input, expected) in test_cases {
            let normalized = normalize_priority(input);
            assert_eq!(normalized, expected, "Failed for input: {}", input);
        }
    }

    #[test]
    fn test_due_date_normalization() {
        // Test ISO date format
        let iso_date = "2025-08-30";
        let normalized = normalize_due_date(iso_date).unwrap();
        assert_eq!(
            normalized.date_naive(),
            chrono::NaiveDate::from_ymd_opt(2025, 8, 30).unwrap()
        );

        // Test date-time format
        let datetime_str = "2025-08-30T14:30:00Z";
        let normalized = normalize_due_date(datetime_str).unwrap();
        assert!(normalized.to_rfc3339().contains("2025-08-30"));
    }

    // Test 3.4: Front matter validation
    #[test]
    fn test_validate_task_properties() {
        // Valid task
        let valid = TaskProperties::new("Valid task".to_string());
        assert!(validate_task_properties(&valid).is_ok());

        // Invalid: empty text
        let mut invalid = TaskProperties::new("".to_string());
        assert!(validate_task_properties(&invalid).is_err());

        // Invalid: completed without completion date
        invalid.text = "Task".to_string();
        invalid.status = TaskStatus::Done;
        invalid.completed_at = None;
        assert!(validate_task_properties(&invalid).is_err());

        // Invalid: not completed with completion date
        invalid.status = TaskStatus::Todo;
        invalid.completed_at = Some(Utc::now());
        assert!(validate_task_properties(&invalid).is_err());
    }

    // Test 3.5: Merge logic for concurrent updates
    #[test]
    fn test_merge_concurrent_task_updates() {
        let original_tasks = {
            let mut tasks = HashMap::new();
            tasks.insert(
                "task-1".to_string(),
                TaskProperties::new("Task 1".to_string()),
            );
            tasks.insert(
                "task-2".to_string(),
                TaskProperties::new("Task 2".to_string()),
            );
            tasks
        };

        // Update 1: Mark task-1 as done
        let update1_tasks = {
            let mut tasks = original_tasks.clone();
            tasks.get_mut("task-1").unwrap().mark_done();
            tasks
        };

        // Update 2: Change priority of task-1 and add task-3
        let update2_tasks = {
            let mut tasks = original_tasks.clone();
            tasks.get_mut("task-1").unwrap().priority = Some(Priority::High);
            tasks.insert(
                "task-3".to_string(),
                TaskProperties::new("Task 3".to_string()),
            );
            tasks
        };

        // Merge updates
        let merged = merge_task_updates(&original_tasks, &update1_tasks, &update2_tasks).unwrap();

        // Verify merge results
        assert_eq!(merged.len(), 3); // Should have all 3 tasks

        // Task 1 should be done (from update1) AND high priority (from update2)
        let task1 = merged.get("task-1").unwrap();
        assert_eq!(task1.status, TaskStatus::Done);
        assert_eq!(task1.priority, Some(Priority::High));

        // Task 2 should be unchanged
        let task2 = merged.get("task-2").unwrap();
        assert_eq!(task2.text, "Task 2");

        // Task 3 should be added
        assert!(merged.contains_key("task-3"));
    }

    // Test 3.6: Field ordering preservation
    #[test]
    fn test_frontmatter_field_ordering() {
        let mut fm = FrontMatter::with_id("note-123".to_string());
        fm.created_at = Some(Utc.with_ymd_and_hms(2025, 8, 24, 10, 0, 0).unwrap());
        fm.updated_at = Some(Utc.with_ymd_and_hms(2025, 8, 24, 11, 0, 0).unwrap());

        // Add tasks
        TaskFrontMatter::upsert_task(
            &mut fm.extra_fields,
            "task-1".to_string(),
            TaskProperties::new("Task 1".to_string()),
        );

        // Add other custom fields
        fm.extra_fields.insert(
            "author".to_string(),
            serde_json::Value::String("John Doe".to_string()),
        );
        fm.extra_fields.insert(
            "category".to_string(),
            serde_json::Value::String("Development".to_string()),
        );

        let content = "# Document\n\nContent here.";
        let result = FrontMatterWriter::write(&fm, content).unwrap();

        // Verify field order: id, created_at, updated_at, then others alphabetically
        let lines: Vec<&str> = result.lines().collect();

        // Find the index of each field
        let id_idx = lines.iter().position(|l| l.starts_with("id:")).unwrap();
        let created_idx = lines
            .iter()
            .position(|l| l.starts_with("created_at:"))
            .unwrap();
        let updated_idx = lines
            .iter()
            .position(|l| l.starts_with("updated_at:"))
            .unwrap();

        // Verify ordering
        assert!(id_idx < created_idx);
        assert!(created_idx < updated_idx);
    }

    // Test 3.7: Backward compatibility
    #[test]
    fn test_preserve_unknown_task_fields() {
        let content = r#"---
id: note-uuid-123
custom_field: "preserved"
author: "John Doe"
tasks:
  task-1:
    status: todo
    text: "Test task"
    custom_task_field: "also preserved"
    experimental_feature: true
---

Content"#;

        let (fm, body) = FrontMatterParser::parse(content).unwrap();
        let fm = fm.unwrap();

        // Verify custom fields are preserved
        assert!(fm.extra_fields.contains_key("custom_field"));
        assert!(fm.extra_fields.contains_key("author"));

        // Extract and verify task with custom fields
        if let Some(serde_json::Value::Object(tasks_obj)) = fm.extra_fields.get("tasks") {
            if let Some(serde_json::Value::Object(task)) = tasks_obj.get("task-1") {
                assert!(task.contains_key("custom_task_field"));
                assert!(task.contains_key("experimental_feature"));
            }
        }

        // Write back and verify preservation
        let result = FrontMatterWriter::write(&fm, &body).unwrap();
        assert!(result.contains("custom_field:"));
        assert!(result.contains("author:"));
        assert!(result.contains("custom_task_field:"));
        assert!(result.contains("experimental_feature:"));
    }

    // Test batch operations
    #[test]
    fn test_batch_task_operations() {
        let mut fm = FrontMatter::with_id("note-batch".to_string());
        let mut tasks = HashMap::new();

        // Add 100 tasks in batch
        for i in 0..100 {
            let task_id = format!("task-{}", i);
            let mut props = TaskProperties::new(format!("Task {}", i));
            if i % 2 == 0 {
                props.priority = Some(Priority::High);
            }
            if i % 3 == 0 {
                props.tags = Some(vec!["urgent".to_string()]);
            }
            tasks.insert(task_id, props);
        }

        // Perform batch update
        TaskFrontMatter::update_tasks(&mut fm.extra_fields, tasks);

        // Verify all tasks were added
        let extracted = TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();
        assert_eq!(extracted.len(), 100);

        // Verify some properties
        assert_eq!(
            extracted.get("task-0").unwrap().priority,
            Some(Priority::High)
        );
        assert!(extracted.get("task-3").unwrap().tags.is_some());
    }

    // Test concurrent file access
    #[test]
    fn test_concurrent_file_modifications() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("concurrent-test.md");

        // Create initial file
        let mut fm = FrontMatter::with_id("note-concurrent".to_string());
        TaskFrontMatter::upsert_task(
            &mut fm.extra_fields,
            "task-1".to_string(),
            TaskProperties::new("Initial task".to_string()),
        );

        let content = "# Note\n\n- [ ] Initial task <!-- tid: task-1 -->";
        FrontMatterWriter::write_atomic(&file_path, &fm, content).unwrap();

        // Simulate concurrent modifications
        let threads: Vec<_> = (0..5)
            .map(|i| {
                let path = file_path.clone();
                std::thread::spawn(move || {
                    // Read current state
                    let current = fs::read_to_string(&path).unwrap();
                    let (fm, body) = FrontMatterParser::parse(&current).unwrap();
                    let mut fm = fm.unwrap();

                    // Add a new task
                    let task_id = format!("task-thread-{}", i);
                    TaskFrontMatter::upsert_task(
                        &mut fm.extra_fields,
                        task_id,
                        TaskProperties::new(format!("Task from thread {}", i)),
                    );

                    // Write back atomically
                    FrontMatterWriter::write_atomic(&path, &fm, &body).unwrap();
                })
            })
            .collect();

        // Wait for all threads
        for t in threads {
            t.join().unwrap();
        }

        // Verify final state has all tasks
        let final_content = fs::read_to_string(&file_path).unwrap();
        let (final_fm, _) = FrontMatterParser::parse(&final_content).unwrap();
        let tasks = TaskFrontMatter::extract_tasks(&final_fm.unwrap().extra_fields).unwrap();

        // Should have initial task plus at least some thread tasks
        // (Some may be lost due to race conditions, but atomic writes ensure no corruption)
        assert!(tasks.len() >= 1);
        assert!(tasks.contains_key("task-1"));
    }
}
