#[cfg(test)]
mod tests {
    use super::super::parser::*;
    use chrono::{NaiveDate, Utc};

    #[test]
    fn test_parse_simple_unchecked_task() {
        let line = "- [ ] Write documentation";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Write documentation");
        assert_eq!(task.status, TaskStatus::Todo);
        assert_eq!(task.line_number, 1);
        assert!(task.id.is_none());
        assert!(task.properties.is_empty());
    }

    #[test]
    fn test_parse_checked_task() {
        let line = "- [x] Complete the parser implementation";
        let result = TaskParser::parse_line(line, 5);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Complete the parser implementation");
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.line_number, 5);
    }

    #[test]
    fn test_parse_task_with_existing_id() {
        let line = "- [ ] Task with ID <!-- tid: 01234567-89ab-cdef-0123-456789abcdef -->";
        let result = TaskParser::parse_line(line, 3);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Task with ID");
        assert_eq!(
            task.id,
            Some("01234567-89ab-cdef-0123-456789abcdef".to_string())
        );
    }

    #[test]
    fn test_parse_task_with_due_date() {
        let line = "- [ ] Submit report @due(2025-08-30)";
        let result = TaskParser::parse_line(line, 2);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Submit report @due(2025-08-30)");
        assert!(task.properties.contains_key("due"));

        let due_date = task.properties.get("due").unwrap();
        assert_eq!(due_date, "2025-08-30");
    }

    #[test]
    fn test_parse_task_with_due_space_syntax() {
        let line = "- [ ] Submit report @due 2025-09-01";
        let result = TaskParser::parse_line(line, 2);
        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.properties.get("due"), Some(&"2025-09-01".to_string()));
    }

    #[test]
    fn test_parse_task_with_due_colon_syntax() {
        let line = "- [ ] Submit report @due:2025-09-02";
        let result = TaskParser::parse_line(line, 2);
        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.properties.get("due"), Some(&"2025-09-02".to_string()));
    }

    #[test]
    fn test_parse_task_with_project_colon_syntax() {
        let line = "- [ ] Work item @project:enterprise";
        let result = TaskParser::parse_line(line, 1);
        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(
            task.properties.get("project"),
            Some(&"enterprise".to_string())
        );
    }

    #[test]
    fn test_parse_nested_tags_backend() {
        let line = "- [ ] Task with #analysis/security and #demo";
        let result = TaskParser::parse_line(line, 1);
        assert!(result.is_some());
        let task = result.unwrap();
        let tags = task.properties.get("tags").unwrap();
        assert!(tags.contains("analysis/security"));
        assert!(tags.contains("demo"));
    }

    #[test]
    fn test_project_from_nested_tag_backend() {
        let line = "- [ ] Finalize Q4 deck #project/qep #sales";
        let result = TaskParser::parse_line(line, 1);
        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.properties.get("project"), Some(&"qep".to_string()));
    }

    #[test]
    fn test_parse_task_with_natural_language_date() {
        let line = "- [ ] Call client @due(tomorrow)";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert!(task.properties.contains_key("due"));
        // Natural language dates should be parsed and normalized
        assert!(task.properties.get("due").unwrap().len() > 0);
    }

    #[test]
    fn test_parse_task_with_priority() {
        let line = "- [ ] Fix critical bug !p1";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Fix critical bug !p1");
        assert_eq!(task.properties.get("priority"), Some(&"high".to_string()));
    }

    #[test]
    fn test_parse_task_with_multiple_tags() {
        let line = "- [ ] Review PR #code-review #urgent #backend";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert!(task.properties.contains_key("tags"));

        let tags = task.properties.get("tags").unwrap();
        assert!(tags.contains("code-review"));
        assert!(tags.contains("urgent"));
        assert!(tags.contains("backend"));
    }

    #[test]
    fn test_parse_task_with_project() {
        let line = "- [ ] Design new feature @project(ProductLaunch)";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(
            task.properties.get("project"),
            Some(&"ProductLaunch".to_string())
        );
    }

    #[test]
    fn test_parse_task_with_all_properties() {
        let line = "- [ ] Complex task @due(2025-09-01) !p2 #frontend #testing @project(Sprint23) <!-- tid: test-id-123 -->";
        let result = TaskParser::parse_line(line, 10);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.id, Some("test-id-123".to_string()));
        assert_eq!(task.properties.get("due"), Some(&"2025-09-01".to_string()));
        assert_eq!(task.properties.get("priority"), Some(&"medium".to_string()));
        assert_eq!(
            task.properties.get("project"),
            Some(&"Sprint23".to_string())
        );
        assert!(task.properties.get("tags").unwrap().contains("frontend"));
        assert!(task.properties.get("tags").unwrap().contains("testing"));
    }

    #[test]
    fn test_parse_non_task_line() {
        let line = "This is just a regular line of text";
        let result = TaskParser::parse_line(line, 1);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_numbered_list() {
        let line = "1. This is a numbered list item";
        let result = TaskParser::parse_line(line, 1);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_task_with_unicode() {
        let line = "- [ ] 完成文档编写 📝";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "完成文档编写 📝");
    }

    #[test]
    fn test_parse_task_with_special_characters() {
        let line = "- [ ] Fix bug in `parse_line()` function & test $variables";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(
            task.content,
            "Fix bug in `parse_line()` function & test $variables"
        );
    }

    #[test]
    fn test_priority_normalization() {
        assert_eq!(TaskParser::normalize_priority("!p1"), "high");
        assert_eq!(TaskParser::normalize_priority("!p2"), "medium");
        assert_eq!(TaskParser::normalize_priority("!p3"), "medium");
        assert_eq!(TaskParser::normalize_priority("!p4"), "low");
        assert_eq!(TaskParser::normalize_priority("!p5"), "low");
        assert_eq!(TaskParser::normalize_priority("!high"), "high");
        assert_eq!(TaskParser::normalize_priority("!medium"), "medium");
        assert_eq!(TaskParser::normalize_priority("!low"), "low");
    }

    #[test]
    fn test_extract_multiple_tasks_from_document() {
        let content = r#"# My Tasks

- [ ] First task
- [x] Completed task
Regular text here
- [ ] Another task @due(2025-08-30)
- Not a task
- [ ] Final task #important"#;

        let tasks = TaskParser::extract_all_tasks(content);
        assert_eq!(tasks.len(), 4);

        assert_eq!(tasks[0].content, "First task");
        assert_eq!(tasks[0].line_number, 3);
        assert_eq!(tasks[0].status, TaskStatus::Todo);

        assert_eq!(tasks[1].content, "Completed task");
        assert_eq!(tasks[1].line_number, 4);
        assert_eq!(tasks[1].status, TaskStatus::Done);

        assert_eq!(tasks[2].content, "Another task @due(2025-08-30)");
        assert_eq!(tasks[2].line_number, 6);

        assert_eq!(tasks[3].content, "Final task #important");
        assert_eq!(tasks[3].line_number, 8);
    }

    #[test]
    fn test_add_tid_to_line() {
        let line = "- [ ] Task without ID";
        let tid = "new-uuid-123";
        let result = TaskParser::add_tid_to_line(line, tid);
        assert_eq!(result, "- [ ] Task without ID <!-- tid: new-uuid-123 -->");
    }

    #[test]
    fn test_add_tid_preserves_existing_id() {
        let line = "- [ ] Task with ID <!-- tid: existing-id -->";
        let tid = "new-uuid-123";
        let result = TaskParser::add_tid_to_line(line, tid);
        assert_eq!(result, "- [ ] Task with ID <!-- tid: existing-id -->");
    }

    #[test]
    fn test_update_task_status() {
        let line = "- [ ] Unchecked task";
        let result = TaskParser::toggle_task_status(line);
        assert_eq!(result, "- [x] Unchecked task");

        let line2 = "- [x] Checked task";
        let result2 = TaskParser::toggle_task_status(line2);
        assert_eq!(result2, "- [ ] Checked task");
    }

    #[test]
    fn test_parse_nested_task() {
        let line = "  - [ ] Nested task with indent";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Nested task with indent");
        assert_eq!(task.indent_level, 2);
    }

    #[test]
    fn test_parse_tab_indented_task() {
        let line = "\t- [ ] Tab indented task";
        let result = TaskParser::parse_line(line, 1);

        assert!(result.is_some());
        let task = result.unwrap();
        assert_eq!(task.content, "Tab indented task");
        assert_eq!(task.indent_level, 4); // Tab counts as 4 spaces
    }
}
