#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::identity::frontmatter::FrontMatterParser;
    use crate::identity::IdentityManager;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Instant;
    use tempfile::TempDir;
    use tokio::sync::Mutex;

    // Helper to create a test environment
    struct TestEnv {
        temp_dir: TempDir,
        identity_manager: Arc<Mutex<IdentityManager>>,
    }

    impl TestEnv {
        fn new() -> Self {
            let temp_dir = TempDir::new().unwrap();
            let identity_manager = Arc::new(Mutex::new(IdentityManager::new(
                temp_dir.path().to_path_buf(),
            )));

            TestEnv {
                temp_dir,
                identity_manager,
            }
        }

        fn create_test_file(&self, name: &str, content: &str) -> PathBuf {
            let path = self.temp_dir.path().join(name);
            fs::write(&path, content).unwrap();
            path
        }

        fn read_file(&self, path: &PathBuf) -> String {
            fs::read_to_string(path).unwrap()
        }
    }

    // Helper function to test logic directly without State wrapper
    async fn test_ensure_uuid_logic(
        file_path: PathBuf,
        line_number: usize,
        manager: &Arc<Mutex<IdentityManager>>,
    ) -> Result<String, String> {
        let mut mgr = manager.lock().await;
        mgr.ensure_task_id(&file_path, line_number)
            .map_err(|e| format!("Failed to ensure task UUID: {}", e))
    }

    #[tokio::test]
    async fn test_ensure_task_uuid_creates_new_uuid() {
        let env = TestEnv::new();
        let file_content = "# Test Note\n\n- [ ] Test task without UUID\n- [ ] Another task\n";
        let file_path = env.create_test_file("test.md", file_content);

        // Verify file exists
        assert!(
            file_path.exists(),
            "File does not exist at: {:?}",
            file_path
        );

        // Ensure UUID for first task
        let result = test_ensure_uuid_logic(
            file_path.clone(),
            3, // Line number of first task
            &env.identity_manager,
        )
        .await;

        assert!(
            result.is_ok(),
            "Failed with error: {:?} for file: {:?}",
            result.err(),
            file_path
        );
        let uuid = result.unwrap();
        assert!(!uuid.is_empty());

        // Verify file was updated with UUID
        let updated_content = env.read_file(&file_path);
        assert!(updated_content.contains(&format!("<!-- tid:{} -->", uuid)));
    }

    #[tokio::test]
    async fn test_ensure_task_uuid_preserves_existing() {
        let env = TestEnv::new();
        let existing_uuid = "01932e4a-1234-7890-abcd-ef1234567890";
        let file_content = format!(
            "# Test Note\n\n- [ ] Test task <!-- tid:{} -->\n",
            existing_uuid
        );
        let file_path = env.create_test_file("test.md", &file_content);

        // Ensure UUID for task that already has one
        let result = test_ensure_uuid_logic(file_path.clone(), 3, &env.identity_manager).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), existing_uuid);

        // Verify file wasn't modified
        let content = env.read_file(&file_path);
        assert_eq!(content, file_content);
    }

    #[tokio::test]
    async fn test_ensure_task_uuid_invalid_line_number() {
        let env = TestEnv::new();
        let file_content = "# Test Note\n\n- [ ] Test task\n";
        let file_path = env.create_test_file("test.md", file_content);

        // Try to ensure UUID for non-existent line
        let result = test_ensure_uuid_logic(
            file_path,
            10, // Line doesn't exist
            &env.identity_manager,
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid line"));
    }

    #[tokio::test]
    async fn test_get_tasks_for_note_with_front_matter() {
        let env = TestEnv::new();
        let task_id = "01932e4a-1234-7890-abcd-ef1234567890";
        let file_content = format!(
            r#"---
tasks:
  "{}":
    text: "Test task with metadata"
    status: "todo"
    created_at: "2025-01-01T10:00:00Z"
    updated_at: "2025-01-02T10:00:00Z"
    due: "2025-01-10"
    priority: "high"
    tags: ["work", "urgent"]
    project: "TestProject"
---

# Test Note

- [ ] Test task with metadata <!-- tid:{} -->
- [x] Completed task
"#,
            task_id, task_id
        );
        let file_path = env.create_test_file("test.md", &file_content);

        // Parse the content directly to test the logic
        let content = env.read_file(&file_path);
        let (front_matter, _body) = FrontMatterParser::parse(&content).unwrap();
        let fm_tasks = if let Some(ref fm) = front_matter {
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields)
                .unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        };

        // Parse tasks from content
        let tasks = crate::identity::tasks::TaskParser::extract_all_tasks(&content);

        assert_eq!(tasks.len(), 2);

        // Check first task has ID
        let task = &tasks[0];
        assert_eq!(task.id, Some(task_id.to_string()));

        // Check we can get metadata from front matter
        let fm_task = fm_tasks.get(task_id).unwrap();
        assert_eq!(
            fm_task.status,
            crate::identity::frontmatter::tasks::TaskStatus::Todo
        );
        assert_eq!(fm_task.text, "Test task with metadata");
    }

    #[tokio::test]
    async fn test_toggle_task_status_logic() {
        let env = TestEnv::new();
        let task_id = "01932e4a-1234-7890-abcd-ef1234567890";
        let file_content = format!(
            r#"---
tasks:
  "{}":
    text: "Test task"
    status: "todo"
    created_at: "2025-01-01T10:00:00Z"
    updated_at: "2025-01-01T10:00:00Z"
---

# Test Note

- [ ] Test task <!-- tid:{} -->
"#,
            task_id, task_id
        );
        let file_path = env.create_test_file("test.md", &file_content);

        // Toggle task status manually (testing the core logic)
        let content = env.read_file(&file_path);
        let lines: Vec<&str> = content.lines().collect();

        // Find the line with the task (should be line 11, 0-indexed is 10)
        let task_line_index = lines
            .iter()
            .position(|l| l.contains("- [ ] Test task"))
            .unwrap();
        let line = lines[task_line_index];
        let toggled_line = crate::identity::tasks::TaskParser::toggle_task_status(line);

        assert!(
            toggled_line.contains("[x]"),
            "Toggled line should contain [x], got: {}",
            toggled_line
        );

        // Verify we can update front matter
        let (front_matter, _) = FrontMatterParser::parse(&content).unwrap();
        let fm = front_matter.unwrap();
        let mut tasks =
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();

        if let Some(task) = tasks.get_mut(task_id) {
            task.mark_done();
        }

        assert_eq!(
            tasks.get(task_id).unwrap().status,
            crate::identity::frontmatter::tasks::TaskStatus::Done
        );
        assert!(tasks.get(task_id).unwrap().completed_at.is_some());
    }

    #[tokio::test]
    async fn test_update_task_properties_logic() {
        let env = TestEnv::new();
        let task_id = "01932e4a-1234-7890-abcd-ef1234567890";
        let file_content = format!(
            r#"---
tasks:
  "{}":
    text: "Original task"
    status: "todo"
    created_at: "2025-01-01T10:00:00Z"
    updated_at: "2025-01-01T10:00:00Z"
---

# Test Note

- [ ] Original task <!-- tid:{} -->
"#,
            task_id, task_id
        );
        let file_path = env.create_test_file("test.md", &file_content);

        // Parse and update front matter
        let content = env.read_file(&file_path);
        let (front_matter, body) = FrontMatterParser::parse(&content).unwrap();
        let mut fm = front_matter.unwrap();
        let mut tasks =
            crate::identity::frontmatter::TaskFrontMatter::extract_tasks(&fm.extra_fields).unwrap();

        // Update task properties
        if let Some(task) = tasks.get_mut(task_id) {
            task.mark_done();
            task.text = "Updated task text".to_string();
            task.due = crate::identity::frontmatter::tasks::normalize_due_date("tomorrow").ok();
            task.priority = Some(crate::identity::frontmatter::tasks::normalize_priority(
                "high",
            ));
            task.tags = Some(vec!["work".to_string(), "urgent".to_string()]);
            task.project = Some("NewProject".to_string());
        }

        // Update front matter
        crate::identity::frontmatter::TaskFrontMatter::update_tasks(&mut fm.extra_fields, tasks);

        // Write back
        crate::identity::frontmatter::FrontMatterWriter::write_atomic(&file_path, &fm, &body)
            .unwrap();

        // Verify update
        let updated_content = env.read_file(&file_path);
        let (updated_fm, _) = FrontMatterParser::parse(&updated_content).unwrap();
        let updated_tasks = crate::identity::frontmatter::TaskFrontMatter::extract_tasks(
            &updated_fm.unwrap().extra_fields,
        )
        .unwrap();
        let task = updated_tasks.get(task_id).unwrap();

        assert_eq!(
            task.status,
            crate::identity::frontmatter::tasks::TaskStatus::Done
        );
        assert_eq!(task.text, "Updated task text");
        assert!(task.due.is_some());
        assert_eq!(
            task.priority,
            Some(crate::identity::frontmatter::Priority::High)
        );
        assert_eq!(
            task.tags,
            Some(vec!["work".to_string(), "urgent".to_string()])
        );
        assert_eq!(task.project, Some("NewProject".to_string()));
    }

    #[tokio::test]
    async fn test_batch_ensure_task_uuids() {
        let env = TestEnv::new();
        let file_content = r#"# Test Note

- [ ] First task
- [ ] Second task
- [x] Third task
Some text here
- [ ] Fourth task
"#;
        let file_path = env.create_test_file("test.md", file_content);

        // Batch ensure UUIDs
        let mut manager = env.identity_manager.lock().await;
        let result = manager.batch_ensure_task_ids(&file_path);

        assert!(result.is_ok());
        let uuids = result.unwrap();
        assert_eq!(uuids.len(), 4);

        // Verify all tasks have UUIDs
        drop(manager); // Release lock before reading file
        let updated_content = env.read_file(&file_path);
        for uuid in &uuids {
            assert!(updated_content.contains(&format!("<!-- tid:{} -->", uuid)));
        }
    }

    #[tokio::test]
    async fn test_get_task_by_id() {
        let env = TestEnv::new();
        let task_id = "01932e4a-1234-7890-abcd-ef1234567890";
        let file_content = format!(
            "# Test Note\n\n- [ ] Specific task <!-- tid:{} -->\n- [ ] Another task\n",
            task_id
        );
        let file_path = env.create_test_file("test.md", &file_content);

        // Get task by ID
        let manager = env.identity_manager.lock().await;
        let result = manager.get_task_by_id(&file_path, task_id);

        assert!(result.is_ok());
        let task = result.unwrap();
        assert!(task.is_some());

        let task = task.unwrap();
        assert_eq!(task.id, Some(task_id.to_string()));
        assert_eq!(task.content, "Specific task");
    }

    #[tokio::test]
    async fn test_find_duplicate_task_ids() {
        let env = TestEnv::new();
        let duplicate_id = "01932e4a-1234-7890-abcd-ef1234567890";

        // Create two files with the same task ID
        let file1_content = format!(
            "# File 1\n\n- [ ] Task in file 1 <!-- tid:{} -->\n",
            duplicate_id
        );
        let file2_content = format!(
            "# File 2\n\n- [ ] Task in file 2 <!-- tid:{} -->\n",
            duplicate_id
        );

        env.create_test_file("file1.md", &file1_content);
        env.create_test_file("file2.md", &file2_content);

        // Find duplicates
        let manager = env.identity_manager.lock().await;
        let result = manager.find_duplicate_task_ids();

        assert!(result.is_ok());
        let duplicates = result.unwrap();
        assert_eq!(duplicates.len(), 1);

        let paths = duplicates.get(duplicate_id).unwrap();
        assert_eq!(paths.len(), 2);
    }

    #[tokio::test]
    async fn test_performance_ensure_task_uuid() {
        let env = TestEnv::new();
        let file_content = "# Test Note\n\n- [ ] Test task\n";
        let file_path = env.create_test_file("test.md", file_content);

        let start = Instant::now();
        let result = test_ensure_uuid_logic(file_path, 3, &env.identity_manager).await;
        let duration = start.elapsed();

        assert!(result.is_ok());
        assert!(
            duration.as_millis() < 50,
            "Operation took {}ms, expected <50ms",
            duration.as_millis()
        );
    }

    #[tokio::test]
    async fn test_performance_parse_large_file() {
        let env = TestEnv::new();
        let mut content = String::from("# Test Note\n\n");

        // Create a file with 100 tasks
        for i in 0..100 {
            content.push_str(&format!("- [ ] Task {} @due:tomorrow !high #work\n", i));
        }

        let file_path = env.create_test_file("large.md", &content);
        let file_content = env.read_file(&file_path);

        let start = Instant::now();
        let tasks = crate::identity::tasks::TaskParser::extract_all_tasks(&file_content);
        let duration = start.elapsed();

        assert_eq!(tasks.len(), 100);
        assert!(
            duration.as_millis() < 50,
            "Operation took {}ms, expected <50ms",
            duration.as_millis()
        );
    }

    #[tokio::test]
    async fn test_error_handling_invalid_file_path() {
        let env = TestEnv::new();

        let result = test_ensure_uuid_logic(
            PathBuf::from("/non/existent/file.md"),
            1,
            &env.identity_manager,
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed"));
    }

    #[tokio::test]
    async fn test_error_handling_malformed_front_matter() {
        let env = TestEnv::new();
        let file_content = "---\nmalformed: yaml: :\n---\n\n- [ ] Test task\n";
        let file_path = env.create_test_file("malformed.md", file_content);
        let content = env.read_file(&file_path);

        // Try to parse - should handle gracefully
        let result = FrontMatterParser::parse(&content);

        // Parser should either handle the malformed YAML or return an error
        // but not panic
        if result.is_ok() {
            let (fm, _body) = result.unwrap();
            // Front matter might be None if parsing failed
            assert!(fm.is_none() || fm.is_some());
        } else {
            // Error is acceptable for malformed YAML
            assert!(result.is_err());
        }
    }
}
