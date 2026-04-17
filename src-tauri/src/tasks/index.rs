use anyhow::{anyhow, Result};
use chrono::{DateTime, NaiveDate, Utc};
use lru::LruCache;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::identity::frontmatter::Priority;
use crate::identity::tasks::TaskStatus;

/// A complete task record stored in the index
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub file_path: PathBuf,
    pub line_number: usize,
    pub status: TaskStatus,
    pub text: String,
    pub project: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub priority: Option<Priority>,
    pub tags: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub properties: HashMap<String, String>,
}

/// Statistics about the task index
#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub total_tasks: usize,
    pub open_tasks: usize,
    pub done_tasks: usize,
    pub files_with_tasks: usize,
    pub projects: usize,
    pub tasks_with_due_dates: usize,
}

/// Cache statistics
#[derive(Debug, Clone, Serialize)]
pub struct CacheStats {
    pub hits: usize,
    pub misses: usize,
    pub hit_rate: f64,
    pub cache_size: usize,
    pub capacity: usize,
}

/// Query builder for compound task queries
#[derive(Debug, Clone, Default)]
pub struct TaskQuery {
    status: Option<TaskStatus>,
    project: Option<String>,
    priority: Option<Priority>,
    has_due_date: Option<bool>,
    tags: Option<Vec<String>>,
}

impl TaskQuery {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_status(mut self, status: TaskStatus) -> Self {
        self.status = Some(status);
        self
    }

    pub fn with_project(mut self, project: &str) -> Self {
        self.project = Some(project.to_string());
        self
    }

    pub fn with_priority(mut self, priority: Priority) -> Self {
        self.priority = Some(priority);
        self
    }

    pub fn with_due_date(mut self, has_due: bool) -> Self {
        self.has_due_date = Some(has_due);
        self
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = Some(tags);
        self
    }

    fn matches(&self, task: &TaskRecord) -> bool {
        if let Some(status) = &self.status {
            if task.status != *status {
                return false;
            }
        }

        if let Some(project) = &self.project {
            if task.project.as_ref() != Some(project) {
                return false;
            }
        }

        if let Some(priority) = &self.priority {
            if task.priority.as_ref() != Some(priority) {
                return false;
            }
        }

        if let Some(has_due) = self.has_due_date {
            if has_due && task.due_date.is_none() {
                return false;
            }
            if !has_due && task.due_date.is_some() {
                return false;
            }
        }

        if let Some(query_tags) = &self.tags {
            if let Some(task_tags) = &task.tags {
                for tag in query_tags {
                    if !task_tags.contains(tag) {
                        return false;
                    }
                }
            } else {
                return false;
            }
        }

        true
    }
}

/// Internal structure for tracking index state
struct IndexInner {
    // Primary storage
    tasks: HashMap<String, TaskRecord>,

    // Secondary indices
    by_file: HashMap<PathBuf, HashSet<String>>,
    by_status: HashMap<TaskStatus, HashSet<String>>,
    by_project: HashMap<String, HashSet<String>>,
    by_due_date: BTreeMap<NaiveDate, HashSet<String>>,
    by_priority: HashMap<Priority, HashSet<String>>,

    // LRU cache for frequently accessed tasks
    cache: LruCache<String, TaskRecord>,
    cache_hits: usize,
    cache_misses: usize,

    // Version for consistency tracking
    version: u64,
}

impl IndexInner {
    fn new(cache_size: usize) -> Self {
        Self {
            tasks: HashMap::new(),
            by_file: HashMap::new(),
            by_status: HashMap::new(),
            by_project: HashMap::new(),
            by_due_date: BTreeMap::new(),
            by_priority: HashMap::new(),
            cache: LruCache::new(NonZeroUsize::new(cache_size).unwrap()),
            cache_hits: 0,
            cache_misses: 0,
            version: 0,
        }
    }

    fn add_to_indices(&mut self, task: &TaskRecord) {
        let id = &task.id;

        // Update by_file index
        self.by_file
            .entry(task.file_path.clone())
            .or_insert_with(HashSet::new)
            .insert(id.clone());

        // Update by_status index
        self.by_status
            .entry(task.status)
            .or_insert_with(HashSet::new)
            .insert(id.clone());

        // Update by_project index
        if let Some(project) = &task.project {
            self.by_project
                .entry(project.clone())
                .or_insert_with(HashSet::new)
                .insert(id.clone());
        }

        // Update by_due_date index
        if let Some(due_date) = task.due_date {
            self.by_due_date
                .entry(due_date)
                .or_insert_with(HashSet::new)
                .insert(id.clone());
        }

        // Update by_priority index
        if let Some(priority) = &task.priority {
            self.by_priority
                .entry(*priority)
                .or_insert_with(HashSet::new)
                .insert(id.clone());
        }
    }

    fn remove_from_indices(&mut self, task: &TaskRecord) {
        let id = &task.id;

        // Remove from by_file index
        if let Some(file_tasks) = self.by_file.get_mut(&task.file_path) {
            file_tasks.remove(id);
            if file_tasks.is_empty() {
                self.by_file.remove(&task.file_path);
            }
        }

        // Remove from by_status index
        if let Some(status_tasks) = self.by_status.get_mut(&task.status) {
            status_tasks.remove(id);
            if status_tasks.is_empty() {
                self.by_status.remove(&task.status);
            }
        }

        // Remove from by_project index
        if let Some(project) = &task.project {
            if let Some(project_tasks) = self.by_project.get_mut(project) {
                project_tasks.remove(id);
                if project_tasks.is_empty() {
                    self.by_project.remove(project);
                }
            }
        }

        // Remove from by_due_date index
        if let Some(due_date) = task.due_date {
            if let Some(date_tasks) = self.by_due_date.get_mut(&due_date) {
                date_tasks.remove(id);
                if date_tasks.is_empty() {
                    self.by_due_date.remove(&due_date);
                }
            }
        }

        // Remove from by_priority index
        if let Some(priority) = &task.priority {
            if let Some(priority_tasks) = self.by_priority.get_mut(priority) {
                priority_tasks.remove(id);
                if priority_tasks.is_empty() {
                    self.by_priority.remove(priority);
                }
            }
        }
    }
}

/// Thread-safe task index with multiple lookup capabilities
pub struct TaskIndex {
    inner: Arc<RwLock<IndexInner>>,
}

impl TaskIndex {
    /// Create a new task index with default cache size
    pub fn new() -> Self {
        Self::with_cache_size(100)
    }

    /// Create a new task index with specified cache size
    pub fn with_cache_size(cache_size: usize) -> Self {
        Self {
            inner: Arc::new(RwLock::new(IndexInner::new(cache_size))),
        }
    }

    /// Get the number of tasks in the index
    pub async fn size(&self) -> usize {
        let inner = self.inner.read().await;
        inner.tasks.len()
    }

    /// Check if the index is empty
    pub async fn is_empty(&self) -> bool {
        let inner = self.inner.read().await;
        inner.tasks.is_empty()
    }

    /// Get statistics about the index
    pub async fn get_stats(&self) -> IndexStats {
        let inner = self.inner.read().await;

        let open_tasks = inner
            .by_status
            .get(&TaskStatus::Todo)
            .map(|s| s.len())
            .unwrap_or(0);

        let done_tasks = inner
            .by_status
            .get(&TaskStatus::Done)
            .map(|s| s.len())
            .unwrap_or(0);

        let tasks_with_due_dates = inner.by_due_date.values().map(|s| s.len()).sum();

        IndexStats {
            total_tasks: inner.tasks.len(),
            open_tasks,
            done_tasks,
            files_with_tasks: inner.by_file.len(),
            projects: inner.by_project.len(),
            tasks_with_due_dates,
        }
    }

    /// Get cache statistics
    pub async fn get_cache_stats(&self) -> CacheStats {
        let inner = self.inner.read().await;

        let total_accesses = inner.cache_hits + inner.cache_misses;
        let hit_rate = if total_accesses > 0 {
            inner.cache_hits as f64 / total_accesses as f64
        } else {
            0.0
        };

        CacheStats {
            hits: inner.cache_hits,
            misses: inner.cache_misses,
            hit_rate,
            cache_size: inner.cache.len(),
            capacity: inner.cache.cap().get(),
        }
    }

    /// Insert a new task into the index
    pub async fn insert_task(&self, task: TaskRecord) -> Result<()> {
        let mut inner = self.inner.write().await;

        // Remove old indices if task already exists
        if let Some(old_task) = inner.tasks.get(&task.id).cloned() {
            inner.remove_from_indices(&old_task);
        }

        // Add to indices
        inner.add_to_indices(&task);

        // Insert into primary storage
        inner.tasks.insert(task.id.clone(), task.clone());

        // Update cache
        inner.cache.put(task.id.clone(), task);

        // Increment version
        inner.version += 1;

        Ok(())
    }

    /// Update an existing task
    pub async fn update_task(&self, task: TaskRecord) -> Result<()> {
        let mut inner = self.inner.write().await;

        // Check if task exists
        if !inner.tasks.contains_key(&task.id) {
            return Err(anyhow!("Task {} not found", task.id));
        }

        // Remove old indices
        if let Some(old_task) = inner.tasks.get(&task.id).cloned() {
            inner.remove_from_indices(&old_task);
        }

        // Add new indices
        inner.add_to_indices(&task);

        // Update primary storage
        inner.tasks.insert(task.id.clone(), task.clone());

        // Update cache
        inner.cache.put(task.id.clone(), task);

        // Increment version
        inner.version += 1;

        Ok(())
    }

    /// Remove a task from the index
    pub async fn remove_task(&self, task_id: &str) -> Result<()> {
        let mut inner = self.inner.write().await;

        // Get task to remove
        let task = inner
            .tasks
            .get(task_id)
            .ok_or_else(|| anyhow!("Task {} not found", task_id))?
            .clone();

        // Remove from indices
        inner.remove_from_indices(&task);

        // Remove from primary storage
        inner.tasks.remove(task_id);

        // Remove from cache
        inner.cache.pop(task_id);

        // Increment version
        inner.version += 1;

        Ok(())
    }

    /// Remove all tasks for a file
    pub async fn remove_file_tasks(&self, file_path: &Path) -> Result<()> {
        let mut inner = self.inner.write().await;

        // Get all task IDs for this file
        let task_ids = inner.by_file.get(file_path).cloned().unwrap_or_default();

        // Remove each task
        for task_id in task_ids {
            if let Some(task) = inner.tasks.get(&task_id).cloned() {
                inner.remove_from_indices(&task);
                inner.tasks.remove(&task_id);
                inner.cache.pop(&task_id);
            }
        }

        // Increment version
        inner.version += 1;

        Ok(())
    }

    /// Update all tasks for a file (incremental update)
    pub async fn update_file_tasks(
        &self,
        file_path: &Path,
        new_tasks: Vec<TaskRecord>,
    ) -> Result<()> {
        let mut inner = self.inner.write().await;

        // Get current task IDs for this file
        let current_ids = inner.by_file.get(file_path).cloned().unwrap_or_default();

        // Build set of new task IDs
        let new_ids: HashSet<String> = new_tasks.iter().map(|t| t.id.clone()).collect();

        // Remove tasks that are no longer in the file
        for task_id in &current_ids {
            if !new_ids.contains(task_id) {
                if let Some(task) = inner.tasks.get(task_id).cloned() {
                    inner.remove_from_indices(&task);
                    inner.tasks.remove(task_id);
                    inner.cache.pop(task_id);
                }
            }
        }

        // Add or update tasks
        for task in new_tasks {
            // Remove old indices if task exists
            if let Some(old_task) = inner.tasks.get(&task.id).cloned() {
                inner.remove_from_indices(&old_task);
            }

            // Add new indices
            inner.add_to_indices(&task);

            // Update storage and cache
            inner.tasks.insert(task.id.clone(), task.clone());
            inner.cache.put(task.id.clone(), task);
        }

        // Increment version
        inner.version += 1;

        Ok(())
    }

    /// Get a task by ID
    pub async fn get_task(&self, task_id: &str) -> Result<TaskRecord> {
        let mut inner = self.inner.write().await;

        // Check cache first
        if let Some(task) = inner.cache.get(task_id).cloned() {
            inner.cache_hits += 1;
            return Ok(task);
        }

        inner.cache_misses += 1;

        // Get from primary storage
        let task = inner
            .tasks
            .get(task_id)
            .ok_or_else(|| anyhow!("Task {} not found", task_id))?
            .clone();

        // Update cache
        inner.cache.put(task_id.to_string(), task.clone());

        Ok(task)
    }

    /// Get all tasks for a file
    pub async fn get_tasks_by_file(&self, file_path: &Path) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        inner
            .by_file
            .get(file_path)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.tasks.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all tasks with a specific status
    pub async fn get_tasks_by_status(&self, status: TaskStatus) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        inner
            .by_status
            .get(&status)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.tasks.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all tasks for a project
    pub async fn get_tasks_by_project(&self, project: &str) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        inner
            .by_project
            .get(project)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.tasks.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all tasks for a specific due date
    pub async fn get_tasks_by_due_date(&self, due_date: NaiveDate) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        inner
            .by_due_date
            .get(&due_date)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.tasks.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all tasks with a specific priority
    pub async fn get_tasks_by_priority(&self, priority: Priority) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        inner
            .by_priority
            .get(&priority)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.tasks.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Query tasks within a date range (inclusive)
    pub async fn query_by_date_range(&self, start: NaiveDate, end: NaiveDate) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        let mut results = Vec::new();

        for (date, ids) in inner.by_due_date.range(start..=end) {
            for id in ids {
                if let Some(task) = inner.tasks.get(id) {
                    results.push(task.clone());
                }
            }
        }

        results
    }

    /// Get all tasks due today
    pub async fn query_today(&self) -> Vec<TaskRecord> {
        let today = Utc::now().date_naive();
        self.get_tasks_by_due_date(today).await
    }

    /// Get all overdue tasks (incomplete tasks with due date < today)
    pub async fn query_overdue(&self) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;
        let today = Utc::now().date_naive();

        let mut results = Vec::new();

        for (date, ids) in inner.by_due_date.range(..today) {
            for id in ids {
                if let Some(task) = inner.tasks.get(id) {
                    // Only include incomplete tasks
                    if task.status == TaskStatus::Todo {
                        results.push(task.clone());
                    }
                }
            }
        }

        results
    }

    /// Get tasks sorted by due date
    pub async fn get_sorted_by_due_date(&self, ascending: bool) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        let mut results = Vec::new();

        if ascending {
            for ids in inner.by_due_date.values() {
                for id in ids {
                    if let Some(task) = inner.tasks.get(id) {
                        results.push(task.clone());
                    }
                }
            }
        } else {
            for ids in inner.by_due_date.values().rev() {
                for id in ids {
                    if let Some(task) = inner.tasks.get(id) {
                        results.push(task.clone());
                    }
                }
            }
        }

        results
    }

    /// Get tasks sorted by priority (High -> Medium -> Low)
    pub async fn get_sorted_by_priority(&self) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        let mut results = Vec::new();

        // Order: High, Medium, Low
        for priority in [Priority::High, Priority::Medium, Priority::Low] {
            if let Some(ids) = inner.by_priority.get(&priority) {
                for id in ids {
                    if let Some(task) = inner.tasks.get(id) {
                        results.push(task.clone());
                    }
                }
            }
        }

        results
    }

    /// Execute a compound query
    pub async fn query(&self, query: TaskQuery) -> Vec<TaskRecord> {
        let inner = self.inner.read().await;

        // Start with all tasks or filtered set based on most selective criterion
        let initial_set: HashSet<String> = if let Some(status) = &query.status {
            inner.by_status.get(status).cloned().unwrap_or_default()
        } else if let Some(project) = &query.project {
            inner.by_project.get(project).cloned().unwrap_or_default()
        } else if let Some(priority) = &query.priority {
            inner.by_priority.get(priority).cloned().unwrap_or_default()
        } else {
            inner.tasks.keys().cloned().collect()
        };

        // Filter by query criteria
        initial_set
            .iter()
            .filter_map(|id| inner.tasks.get(id))
            .filter(|task| query.matches(task))
            .cloned()
            .collect()
    }

    /// Verify index consistency
    pub async fn verify_consistency(&self) -> Result<()> {
        let inner = self.inner.read().await;

        // Check that all IDs in indices exist in primary storage
        for ids in inner.by_file.values() {
            for id in ids {
                if !inner.tasks.contains_key(id) {
                    return Err(anyhow!(
                        "Inconsistency: task {} in by_file index but not in primary storage",
                        id
                    ));
                }
            }
        }

        for ids in inner.by_status.values() {
            for id in ids {
                if !inner.tasks.contains_key(id) {
                    return Err(anyhow!(
                        "Inconsistency: task {} in by_status index but not in primary storage",
                        id
                    ));
                }
            }
        }

        for ids in inner.by_project.values() {
            for id in ids {
                if !inner.tasks.contains_key(id) {
                    return Err(anyhow!(
                        "Inconsistency: task {} in by_project index but not in primary storage",
                        id
                    ));
                }
            }
        }

        for ids in inner.by_due_date.values() {
            for id in ids {
                if !inner.tasks.contains_key(id) {
                    return Err(anyhow!(
                        "Inconsistency: task {} in by_due_date index but not in primary storage",
                        id
                    ));
                }
            }
        }

        for ids in inner.by_priority.values() {
            for id in ids {
                if !inner.tasks.contains_key(id) {
                    return Err(anyhow!(
                        "Inconsistency: task {} in by_priority index but not in primary storage",
                        id
                    ));
                }
            }
        }

        // Check that all tasks in primary storage are properly indexed
        for (id, task) in &inner.tasks {
            // Check file index
            if let Some(file_tasks) = inner.by_file.get(&task.file_path) {
                if !file_tasks.contains(id) {
                    return Err(anyhow!("Inconsistency: task {} not in by_file index", id));
                }
            } else {
                return Err(anyhow!(
                    "Inconsistency: file {} not in by_file index",
                    task.file_path.display()
                ));
            }

            // Check status index
            if let Some(status_tasks) = inner.by_status.get(&task.status) {
                if !status_tasks.contains(id) {
                    return Err(anyhow!("Inconsistency: task {} not in by_status index", id));
                }
            } else {
                return Err(anyhow!(
                    "Inconsistency: status {:?} not in by_status index",
                    task.status
                ));
            }

            // Check project index if applicable
            if let Some(project) = &task.project {
                if let Some(project_tasks) = inner.by_project.get(project) {
                    if !project_tasks.contains(id) {
                        return Err(anyhow!(
                            "Inconsistency: task {} not in by_project index",
                            id
                        ));
                    }
                } else {
                    return Err(anyhow!(
                        "Inconsistency: project {} not in by_project index",
                        project
                    ));
                }
            }

            // Check due_date index if applicable
            if let Some(due_date) = task.due_date {
                if let Some(date_tasks) = inner.by_due_date.get(&due_date) {
                    if !date_tasks.contains(id) {
                        return Err(anyhow!(
                            "Inconsistency: task {} not in by_due_date index",
                            id
                        ));
                    }
                } else {
                    return Err(anyhow!(
                        "Inconsistency: date {} not in by_due_date index",
                        due_date
                    ));
                }
            }

            // Check priority index if applicable
            if let Some(priority) = &task.priority {
                if let Some(priority_tasks) = inner.by_priority.get(priority) {
                    if !priority_tasks.contains(id) {
                        return Err(anyhow!(
                            "Inconsistency: task {} not in by_priority index",
                            id
                        ));
                    }
                } else {
                    return Err(anyhow!(
                        "Inconsistency: priority {:?} not in by_priority index",
                        priority
                    ));
                }
            }
        }

        Ok(())
    }

    /// Serialize the index to bytes for persistence
    pub async fn serialize(&self) -> Result<Vec<u8>> {
        let inner = self.inner.read().await;

        #[derive(Serialize)]
        struct IndexSnapshot {
            tasks: HashMap<String, TaskRecord>,
            version: u64,
        }

        let snapshot = IndexSnapshot {
            tasks: inner.tasks.clone(),
            version: inner.version,
        };

        Ok(bincode::serialize(&snapshot)?)
    }

    /// Deserialize and restore the index from bytes
    pub async fn deserialize(&self, data: &[u8]) -> Result<()> {
        #[derive(Deserialize)]
        struct IndexSnapshot {
            tasks: HashMap<String, TaskRecord>,
            version: u64,
        }

        let snapshot: IndexSnapshot = bincode::deserialize(data)?;

        let mut inner = self.inner.write().await;

        // Clear existing data
        inner.tasks.clear();
        inner.by_file.clear();
        inner.by_status.clear();
        inner.by_project.clear();
        inner.by_due_date.clear();
        inner.by_priority.clear();
        inner.cache.clear();

        // Restore tasks and rebuild indices
        for (id, task) in snapshot.tasks {
            inner.add_to_indices(&task);
            inner.tasks.insert(id, task);
        }

        inner.version = snapshot.version;

        Ok(())
    }
}

// Include test module
#[cfg(test)]
#[path = "index_test.rs"]
mod tests;
