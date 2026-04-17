use super::*;
use crate::identity::frontmatter::Priority;
use crate::identity::tasks::TaskStatus;
use chrono::{NaiveDate, Utc};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

// Helper function to create a test task record
fn create_test_task(
    id: &str,
    file: &str,
    status: TaskStatus,
    project: Option<&str>,
    due: Option<NaiveDate>,
    priority: Option<Priority>,
) -> TaskRecord {
    let now = Utc::now();
    TaskRecord {
        id: id.to_string(),
        file_path: PathBuf::from(file),
        line_number: 1,
        status,
        text: format!("Test task {}", id),
        project: project.map(String::from),
        due_date: due,
        priority,
        tags: Some(vec!["test".to_string()]),
        created_at: now,
        updated_at: now,
        completed_at: if status == TaskStatus::Done {
            Some(now)
        } else {
            None
        },
        properties: HashMap::new(),
    }
}

#[tokio::test]
async fn test_index_creation_and_initialization() {
    let index = TaskIndex::new();

    assert_eq!(index.size().await, 0);
    assert!(index.is_empty().await);

    // Verify all lookup maps are initialized
    let stats = index.get_stats().await;
    assert_eq!(stats.total_tasks, 0);
    assert_eq!(stats.open_tasks, 0);
    assert_eq!(stats.done_tasks, 0);
    assert_eq!(stats.files_with_tasks, 0);
}

#[tokio::test]
async fn test_task_insertion_and_retrieval() {
    let index = TaskIndex::new();

    let task = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        Some("project-a"),
        None,
        Some(Priority::High),
    );

    // Insert task
    index.insert_task(task.clone()).await.unwrap();

    // Verify insertion
    assert_eq!(index.size().await, 1);
    assert!(!index.is_empty().await);

    // Retrieve by ID
    let retrieved = index.get_task("task-001").await.unwrap();
    assert_eq!(retrieved.id, "task-001");
    assert_eq!(retrieved.text, "Test task task-001");
    assert_eq!(retrieved.status, TaskStatus::Todo);
}

#[tokio::test]
async fn test_multiple_lookup_maps() {
    let index = TaskIndex::new();

    // Insert multiple tasks with different properties
    let task1 = create_test_task(
        "task-001",
        "/notes/test1.md",
        TaskStatus::Todo,
        Some("project-a"),
        Some(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap()),
        Some(Priority::High),
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test1.md",
        TaskStatus::Done,
        Some("project-a"),
        Some(NaiveDate::from_ymd_opt(2025, 8, 26).unwrap()),
        Some(Priority::Medium),
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test2.md",
        TaskStatus::Todo,
        Some("project-b"),
        Some(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap()),
        Some(Priority::Low),
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();

    // Test by_file lookup
    let file1_tasks = index
        .get_tasks_by_file(&PathBuf::from("/notes/test1.md"))
        .await;
    assert_eq!(file1_tasks.len(), 2);

    let file2_tasks = index
        .get_tasks_by_file(&PathBuf::from("/notes/test2.md"))
        .await;
    assert_eq!(file2_tasks.len(), 1);

    // Test by_status lookup
    let open_tasks = index.get_tasks_by_status(TaskStatus::Todo).await;
    assert_eq!(open_tasks.len(), 2);

    let done_tasks = index.get_tasks_by_status(TaskStatus::Done).await;
    assert_eq!(done_tasks.len(), 1);

    // Test by_project lookup
    let project_a_tasks = index.get_tasks_by_project("project-a").await;
    assert_eq!(project_a_tasks.len(), 2);

    let project_b_tasks = index.get_tasks_by_project("project-b").await;
    assert_eq!(project_b_tasks.len(), 1);

    // Test by_due_date lookup
    let due_20250825 = index
        .get_tasks_by_due_date(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap())
        .await;
    assert_eq!(due_20250825.len(), 2);

    // Test by_priority lookup
    let high_priority = index.get_tasks_by_priority(Priority::High).await;
    assert_eq!(high_priority.len(), 1);
}

#[tokio::test]
async fn test_task_update() {
    let index = TaskIndex::new();

    let mut task = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        Some("project-a"),
        None,
        Some(Priority::Low),
    );
    index.insert_task(task.clone()).await.unwrap();

    // Update task status
    task.status = TaskStatus::Done;
    task.completed_at = Some(Utc::now());
    task.priority = Some(Priority::High);

    index.update_task(task.clone()).await.unwrap();

    // Verify update
    let retrieved = index.get_task("task-001").await.unwrap();
    assert_eq!(retrieved.status, TaskStatus::Done);
    assert!(retrieved.completed_at.is_some());
    assert_eq!(retrieved.priority, Some(Priority::High));

    // Verify indices are updated
    let done_tasks = index.get_tasks_by_status(TaskStatus::Done).await;
    assert_eq!(done_tasks.len(), 1);

    let todo_tasks = index.get_tasks_by_status(TaskStatus::Todo).await;
    assert_eq!(todo_tasks.len(), 0);

    let high_priority = index.get_tasks_by_priority(Priority::High).await;
    assert_eq!(high_priority.len(), 1);
}

#[tokio::test]
async fn test_task_removal() {
    let index = TaskIndex::new();

    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        Some("project-a"),
        None,
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        Some("project-a"),
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();

    assert_eq!(index.size().await, 2);

    // Remove one task
    index.remove_task("task-001").await.unwrap();

    assert_eq!(index.size().await, 1);
    assert!(index.get_task("task-001").await.is_err());
    assert!(index.get_task("task-002").await.is_ok());

    // Verify indices are updated
    let file_tasks = index
        .get_tasks_by_file(&PathBuf::from("/notes/test.md"))
        .await;
    assert_eq!(file_tasks.len(), 1);
}

#[tokio::test]
async fn test_remove_file_tasks() {
    let index = TaskIndex::new();

    let task1 = create_test_task(
        "task-001",
        "/notes/test1.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test1.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test2.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();

    assert_eq!(index.size().await, 3);

    // Remove all tasks from test1.md
    index
        .remove_file_tasks(&PathBuf::from("/notes/test1.md"))
        .await
        .unwrap();

    assert_eq!(index.size().await, 1);
    assert!(index.get_task("task-001").await.is_err());
    assert!(index.get_task("task-002").await.is_err());
    assert!(index.get_task("task-003").await.is_ok());
}

#[tokio::test]
async fn test_query_by_date_range() {
    let index = TaskIndex::new();

    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 24).unwrap()),
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap()),
        None,
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 26).unwrap()),
        None,
    );
    let task4 = create_test_task(
        "task-004",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 27).unwrap()),
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();
    index.insert_task(task4).await.unwrap();

    // Query range
    let start = NaiveDate::from_ymd_opt(2025, 8, 25).unwrap();
    let end = NaiveDate::from_ymd_opt(2025, 8, 26).unwrap();
    let tasks = index.query_by_date_range(start, end).await;

    assert_eq!(tasks.len(), 2);
    assert!(tasks.iter().any(|t| t.id == "task-002"));
    assert!(tasks.iter().any(|t| t.id == "task-003"));
}

#[tokio::test]
async fn test_query_today_tasks() {
    let index = TaskIndex::new();

    let today = Utc::now().date_naive();
    let tomorrow = today + chrono::Duration::days(1);
    let yesterday = today - chrono::Duration::days(1);

    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(today),
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(tomorrow),
        None,
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(yesterday),
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();

    let today_tasks = index.query_today().await;
    assert_eq!(today_tasks.len(), 1);
    assert_eq!(today_tasks[0].id, "task-001");
}

#[tokio::test]
async fn test_query_overdue_tasks() {
    let index = TaskIndex::new();

    let today = Utc::now().date_naive();
    let yesterday = today - chrono::Duration::days(1);
    let last_week = today - chrono::Duration::days(7);
    let tomorrow = today + chrono::Duration::days(1);

    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(yesterday),
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(last_week),
        None,
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(tomorrow),
        None,
    );
    let task4 = create_test_task(
        "task-004",
        "/notes/test.md",
        TaskStatus::Done,
        None,
        Some(yesterday),
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();
    index.insert_task(task4).await.unwrap();

    let overdue = index.query_overdue().await;
    assert_eq!(overdue.len(), 2); // Only incomplete tasks that are overdue
    assert!(overdue.iter().any(|t| t.id == "task-001"));
    assert!(overdue.iter().any(|t| t.id == "task-002"));
}

#[tokio::test]
async fn test_sorted_retrieval_by_due_date() {
    let index = TaskIndex::new();

    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 26).unwrap()),
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 24).unwrap()),
        None,
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        Some(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap()),
        None,
    );
    let task4 = create_test_task(
        "task-004",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();
    index.insert_task(task4).await.unwrap();

    // Ascending order
    let sorted_asc = index.get_sorted_by_due_date(true).await;
    assert_eq!(sorted_asc.len(), 3); // Only tasks with due dates
    assert_eq!(sorted_asc[0].id, "task-002");
    assert_eq!(sorted_asc[1].id, "task-003");
    assert_eq!(sorted_asc[2].id, "task-001");

    // Descending order
    let sorted_desc = index.get_sorted_by_due_date(false).await;
    assert_eq!(sorted_desc[0].id, "task-001");
    assert_eq!(sorted_desc[1].id, "task-003");
    assert_eq!(sorted_desc[2].id, "task-002");
}

#[tokio::test]
async fn test_sorted_retrieval_by_priority() {
    let index = TaskIndex::new();

    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        Some(Priority::Low),
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        Some(Priority::High),
    );
    let task3 = create_test_task(
        "task-003",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        Some(Priority::Medium),
    );
    let task4 = create_test_task(
        "task-004",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();
    index.insert_task(task3).await.unwrap();
    index.insert_task(task4).await.unwrap();

    let sorted = index.get_sorted_by_priority().await;
    assert_eq!(sorted.len(), 3); // Only tasks with priority
    assert_eq!(sorted[0].id, "task-002"); // High
    assert_eq!(sorted[1].id, "task-003"); // Medium
    assert_eq!(sorted[2].id, "task-001"); // Low
}

#[tokio::test]
async fn test_performance_with_many_tasks() {
    let index = TaskIndex::new();

    // Insert 1000 tasks
    let start = Instant::now();
    for i in 0..1000 {
        let task = create_test_task(
            &format!("task-{:04}", i),
            &format!("/notes/test{}.md", i % 10),
            if i % 2 == 0 {
                TaskStatus::Todo
            } else {
                TaskStatus::Done
            },
            Some(&format!("project-{}", i % 5)),
            Some(NaiveDate::from_ymd_opt(2025, 8, 20 + (i % 10) as u32).unwrap()),
            match i % 3 {
                0 => Some(Priority::High),
                1 => Some(Priority::Medium),
                _ => Some(Priority::Low),
            },
        );
        index.insert_task(task).await.unwrap();
    }
    let insert_duration = start.elapsed();
    println!("Inserted 1000 tasks in {:?}", insert_duration);

    // Test query performance
    let query_start = Instant::now();
    let _project_tasks = index.get_tasks_by_project("project-0").await;
    let project_query_time = query_start.elapsed();
    assert!(
        project_query_time < Duration::from_millis(10),
        "Project query took {:?}",
        project_query_time
    );

    let status_start = Instant::now();
    let _todo_tasks = index.get_tasks_by_status(TaskStatus::Todo).await;
    let status_query_time = status_start.elapsed();
    assert!(
        status_query_time < Duration::from_millis(10),
        "Status query took {:?}",
        status_query_time
    );

    let date_start = Instant::now();
    let _dated_tasks = index
        .get_tasks_by_due_date(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap())
        .await;
    let date_query_time = date_start.elapsed();
    assert!(
        date_query_time < Duration::from_millis(10),
        "Date query took {:?}",
        date_query_time
    );

    let sort_start = Instant::now();
    let _sorted_tasks = index.get_sorted_by_due_date(true).await;
    let sort_time = sort_start.elapsed();
    assert!(
        sort_time < Duration::from_millis(50),
        "Sorting took {:?}",
        sort_time
    );
}

#[tokio::test]
async fn test_concurrent_access() {
    let index = Arc::new(TaskIndex::new());

    // Spawn multiple tasks that read and write concurrently
    let mut handles = vec![];

    for i in 0..10 {
        let index_clone = Arc::clone(&index);
        let handle = tokio::spawn(async move {
            for j in 0..10 {
                let task = create_test_task(
                    &format!("task-{}-{}", i, j),
                    "/notes/test.md",
                    TaskStatus::Todo,
                    Some("project"),
                    None,
                    None,
                );
                index_clone.insert_task(task).await.unwrap();
            }
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Verify all tasks were inserted
    assert_eq!(index.size().await, 100);
}

#[tokio::test]
async fn test_index_consistency_verification() {
    let index = TaskIndex::new();

    // Insert tasks
    let task1 = create_test_task(
        "task-001",
        "/notes/test1.md",
        TaskStatus::Todo,
        Some("project-a"),
        None,
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test2.md",
        TaskStatus::Done,
        Some("project-b"),
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();

    // Verify consistency
    let result = index.verify_consistency().await;
    assert!(result.is_ok());

    // Manually corrupt an index (simulate inconsistency)
    // This would be tested with a method that allows direct manipulation for testing
    // For now, we just verify the method exists and returns Ok for valid state
}

#[tokio::test]
async fn test_index_serialization_and_recovery() {
    let index = TaskIndex::new();

    // Insert test data
    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        Some("project"),
        Some(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap()),
        Some(Priority::High),
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Done,
        Some("project"),
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();

    // Serialize to bytes
    let serialized = index.serialize().await.unwrap();
    assert!(!serialized.is_empty());

    // Create new index and deserialize
    let new_index = TaskIndex::new();
    new_index.deserialize(&serialized).await.unwrap();

    // Verify data was restored
    assert_eq!(new_index.size().await, 2);
    let task = new_index.get_task("task-001").await.unwrap();
    assert_eq!(task.project, Some("project".to_string()));
    assert_eq!(task.priority, Some(Priority::High));
}

#[tokio::test]
async fn test_query_builder_pattern() {
    let index = TaskIndex::new();

    // Insert diverse tasks
    for i in 0..20 {
        let task = create_test_task(
            &format!("task-{:03}", i),
            "/notes/test.md",
            if i % 3 == 0 {
                TaskStatus::Done
            } else {
                TaskStatus::Todo
            },
            Some(&format!("project-{}", i % 2)),
            if i % 2 == 0 {
                Some(NaiveDate::from_ymd_opt(2025, 8, 25).unwrap())
            } else {
                None
            },
            match i % 4 {
                0 => Some(Priority::High),
                1 => Some(Priority::Medium),
                2 => Some(Priority::Low),
                _ => None,
            },
        );
        index.insert_task(task).await.unwrap();
    }

    // Test compound query
    let query = TaskQuery::new()
        .with_status(TaskStatus::Todo)
        .with_project("project-0")
        .with_priority(Priority::High);

    let results = index.query(query).await;

    // Verify results match all criteria
    for task in &results {
        assert_eq!(task.status, TaskStatus::Todo);
        assert_eq!(task.project, Some("project-0".to_string()));
        assert_eq!(task.priority, Some(Priority::High));
    }
}

#[tokio::test]
async fn test_cache_hit_rate() {
    let index = TaskIndex::new();

    // Insert tasks
    for i in 0..100 {
        let task = create_test_task(
            &format!("task-{:03}", i),
            "/notes/test.md",
            TaskStatus::Todo,
            None,
            None,
            None,
        );
        index.insert_task(task).await.unwrap();
    }

    // Access same tasks multiple times to test cache
    for _ in 0..10 {
        for i in 0..10 {
            let _ = index.get_task(&format!("task-{:03}", i)).await;
        }
    }

    // Check cache statistics
    let stats = index.get_cache_stats().await;
    assert!(
        stats.hit_rate > 0.8,
        "Cache hit rate should be > 80%, got {}",
        stats.hit_rate
    );
}

#[tokio::test]
async fn test_update_file_tasks_incremental() {
    let index = TaskIndex::new();

    // Initial tasks
    let task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );
    let task2 = create_test_task(
        "task-002",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    );

    index.insert_task(task1).await.unwrap();
    index.insert_task(task2).await.unwrap();

    // Update with new set of tasks for the file
    let new_task1 = create_test_task(
        "task-001",
        "/notes/test.md",
        TaskStatus::Done,
        None,
        None,
        None,
    ); // Updated
    let new_task3 = create_test_task(
        "task-003",
        "/notes/test.md",
        TaskStatus::Todo,
        None,
        None,
        None,
    ); // New

    let new_tasks = vec![new_task1, new_task3];
    index
        .update_file_tasks(&PathBuf::from("/notes/test.md"), new_tasks)
        .await
        .unwrap();

    // Verify updates
    assert_eq!(index.size().await, 2); // task-002 removed, task-003 added

    let task1 = index.get_task("task-001").await.unwrap();
    assert_eq!(task1.status, TaskStatus::Done);

    assert!(index.get_task("task-002").await.is_err()); // Removed
    assert!(index.get_task("task-003").await.is_ok()); // Added
}
