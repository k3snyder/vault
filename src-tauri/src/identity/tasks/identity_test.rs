#[cfg(test)]
mod tests {
    use super::super::identity::*;
    use super::super::parser::{TaskParser, TaskStatus};
    use crate::identity::frontmatter::{FrontMatterParser, TaskFrontMatter};
    use crate::identity::uuid::UuidGenerator;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn test_ensure_task_id_updates_frontmatter() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.md");

        // Create file with front matter but no task IDs
        let content = r#"---
id: test-note-id
---
# Test Document

- [ ] Task without ID @due:tomorrow !high #work
- [x] Completed task @project:test
"#;
        fs::write(&file_path, content).unwrap();

        let mut identity = TaskIdentity::new();

        // Ensure ID for first task
        let task1_id = identity.ensure_task_id(&file_path, 6).unwrap();

        // Ensure ID for second task
        let task2_id = identity.ensure_task_id(&file_path, 7).unwrap();

        // Read the updated file
        let updated_content = fs::read_to_string(&file_path).unwrap();

        // Parse front matter to verify tasks were added
        let (front_matter, _body) = FrontMatterParser::parse(&updated_content).unwrap();
        assert!(front_matter.is_some());

        let fm = front_matter.unwrap();
        let tasks = TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();

        // Verify both tasks are in front matter
        assert_eq!(tasks.len(), 2);
        assert!(tasks.contains_key(&task1_id));
        assert!(tasks.contains_key(&task2_id));

        // Verify task properties were extracted correctly
        let task1_props = &tasks[&task1_id];
        assert_eq!(
            task1_props.text,
            "Task without ID @due:tomorrow !high #work"
        );
        assert!(task1_props.due.is_some());
        assert!(task1_props.priority.is_some());
        assert!(task1_props.tags.is_some());

        let task2_props = &tasks[&task2_id];
        assert_eq!(task2_props.text, "Completed task @project:test");
        assert!(task2_props.project.is_some());

        // Verify inline IDs were added
        assert!(updated_content.contains(&format!("<!-- tid: {} -->", task1_id)));
        assert!(updated_content.contains(&format!("<!-- tid: {} -->", task2_id)));
    }

    #[test]
    fn test_ensure_task_id_new_task() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.md");

        let content = r#"# Test Document

- [ ] Task without ID
- [ ] Another task without ID
"#;
        fs::write(&file_path, content).unwrap();

        let mut identity = TaskIdentity::new();
        let result = identity.ensure_task_id(&file_path, 3).unwrap();

        // Should return a new UUID
        assert!(result.len() > 0);
        assert!(result.contains('-')); // UUID format check

        // File should be updated with the new ID
        let updated_content = fs::read_to_string(&file_path).unwrap();
        assert!(updated_content.contains(&format!("<!-- tid: {} -->", result)));
    }

    #[test]
    fn test_ensure_task_id_existing_id() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.md");

        let existing_id = "existing-uuid-123";
        let content = format!(
            r#"# Test Document

- [ ] Task with ID <!-- tid: {} -->
- [ ] Another task
"#,
            existing_id
        );
        fs::write(&file_path, &content).unwrap();

        let mut identity = TaskIdentity::new();
        let result = identity.ensure_task_id(&file_path, 3).unwrap();

        // Should return the existing ID
        assert_eq!(result, existing_id);

        // File should not be modified
        let updated_content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(updated_content, content);
    }

    #[test]
    fn test_get_task_by_id() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.md");

        let task_id = "test-uuid-456";
        let content = format!(
            r#"# Test Document

- [ ] First task
- [x] Task with specific ID <!-- tid: {} -->
- [ ] Third task
"#,
            task_id
        );
        fs::write(&file_path, content).unwrap();

        let identity = TaskIdentity::new();
        let result = identity.get_task_by_id(&file_path, task_id).unwrap();

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.id, Some(task_id.to_string()));
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.line_number, 4);
    }

    #[test]
    fn test_batch_ensure_task_ids() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.md");

        let content = r#"# Test Document

- [ ] First task
- [ ] Second task
- [x] Third task
Regular text
- [ ] Fourth task
"#;
        fs::write(&file_path, content).unwrap();

        let mut identity = TaskIdentity::new();
        let results = identity.batch_ensure_task_ids(&file_path).unwrap();

        // Should return 4 task IDs
        assert_eq!(results.len(), 4);

        // All IDs should be unique
        let unique_ids: std::collections::HashSet<_> = results.iter().collect();
        assert_eq!(unique_ids.len(), 4);

        // File should be updated with all IDs
        let updated_content = fs::read_to_string(&file_path).unwrap();
        for id in &results {
            assert!(updated_content.contains(&format!("<!-- tid: {} -->", id)));
        }
    }

    #[test]
    fn test_duplicate_id_detection() {
        let temp_dir = TempDir::new().unwrap();
        let file1 = temp_dir.path().join("file1.md");
        let file2 = temp_dir.path().join("file2.md");

        let duplicate_id = "duplicate-uuid-789";

        let content1 = format!("- [ ] Task in file 1 <!-- tid: {} -->", duplicate_id);
        let content2 = format!("- [ ] Task in file 2 <!-- tid: {} -->", duplicate_id);

        fs::write(&file1, content1).unwrap();
        fs::write(&file2, content2).unwrap();

        let identity = TaskIdentity::new();
        let duplicates = identity.find_duplicate_task_ids(temp_dir.path()).unwrap();

        assert_eq!(duplicates.len(), 1);
        assert!(duplicates.contains_key(duplicate_id));
        assert_eq!(duplicates[duplicate_id].len(), 2);
    }

    #[test]
    fn test_task_cache_operations() {
        let mut cache = TaskCache::new(100);
        let file_path = PathBuf::from("/test/file.md");
        let task_id = "cached-task-123";

        // Test insertion
        cache.insert(task_id.to_string(), file_path.clone(), 5);

        // Test retrieval
        let result = cache.get(task_id);
        assert!(result.is_some());
        let (path, line) = result.unwrap();
        assert_eq!(path, &file_path);
        assert_eq!(*line, 5);

        // Test update
        cache.update_line(task_id, 10);
        let result = cache.get(task_id);
        assert!(result.is_some());
        let (_, line) = result.unwrap();
        assert_eq!(*line, 10);

        // Test removal
        cache.remove(task_id);
        assert!(cache.get(task_id).is_none());
    }

    #[test]
    fn test_atomic_file_update() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.md");

        let original_content = r#"# Test Document

- [ ] Task one
- [ ] Task two
- [ ] Task three
"#;
        fs::write(&file_path, original_content).unwrap();

        let identity = TaskIdentity::new();

        // Update line 3 with a task ID
        let new_id = "atomic-test-id";
        identity.update_task_line(&file_path, 3, new_id).unwrap();

        let updated_content = fs::read_to_string(&file_path).unwrap();
        let lines: Vec<_> = updated_content.lines().collect();

        // Check that only line 3 was modified
        assert_eq!(lines[0], "# Test Document");
        assert_eq!(lines[1], "");
        assert!(lines[2].contains("Task one") && lines[2].contains(new_id));
        assert!(lines[3].contains("Task two") && !lines[3].contains("tid:"));
        assert!(lines[4].contains("Task three") && !lines[4].contains("tid:"));
    }

    #[test]
    fn test_concurrent_task_id_generation() {
        use std::sync::{Arc, Mutex};
        use std::thread;

        let temp_dir = TempDir::new().unwrap();
        let file_path = Arc::new(temp_dir.path().join("test.md"));

        let content = r#"# Test Document

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Task 4
- [ ] Task 5
"#;
        fs::write(&*file_path, content).unwrap();

        let results = Arc::new(Mutex::new(Vec::new()));
        let mut handles = vec![];

        // Spawn multiple threads to generate IDs concurrently
        for line_num in 3..=7 {
            let file_clone = Arc::clone(&file_path);
            let results_clone = Arc::clone(&results);

            let handle = thread::spawn(move || {
                let mut identity = TaskIdentity::new();
                let id = identity.ensure_task_id(&*file_clone, line_num).unwrap();
                results_clone.lock().unwrap().push(id);
            });

            handles.push(handle);
        }

        // Wait for all threads
        for handle in handles {
            handle.join().unwrap();
        }

        // Check that all IDs are unique
        let final_results = results.lock().unwrap();
        let unique_ids: std::collections::HashSet<_> = final_results.iter().collect();
        assert_eq!(unique_ids.len(), 5);
    }
}
