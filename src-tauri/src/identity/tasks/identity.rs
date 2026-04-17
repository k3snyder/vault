use anyhow::{Context, Result};
use lru::LruCache;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::fs;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

use super::parser::{ParsedTask, TaskParser, TaskStatus};
use crate::identity::frontmatter::{
    FrontMatter, FrontMatterParser, FrontMatterWriter, TaskFrontMatter, TaskProperties,
    TaskStatus as FmTaskStatus,
};
use crate::identity::uuid::UuidGenerator;

/// Cache for task locations
pub struct TaskCache {
    cache: LruCache<String, (PathBuf, usize)>,
}

impl TaskCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: LruCache::new(capacity.try_into().unwrap()),
        }
    }

    pub fn insert(&mut self, task_id: String, file_path: PathBuf, line_number: usize) {
        self.cache.put(task_id, (file_path, line_number));
    }

    pub fn get(&mut self, task_id: &str) -> Option<(&PathBuf, &usize)> {
        self.cache.get(task_id).map(|(p, l)| (p, l))
    }

    pub fn update_line(&mut self, task_id: &str, new_line: usize) {
        if let Some((path, _)) = self.cache.get(task_id) {
            let path = path.clone();
            self.cache.put(task_id.to_string(), (path, new_line));
        }
    }

    pub fn remove(&mut self, task_id: &str) -> Option<(PathBuf, usize)> {
        self.cache.pop(task_id)
    }

    pub fn clear(&mut self) {
        self.cache.clear();
    }
}

/// Manages task identities with UUID generation and caching
#[derive(Clone)]
pub struct TaskIdentity {
    generator: Arc<UuidGenerator>,
    cache: Arc<RwLock<TaskCache>>,
}

impl TaskIdentity {
    pub fn new() -> Self {
        Self {
            generator: Arc::new(UuidGenerator::new()),
            cache: Arc::new(RwLock::new(TaskCache::new(10000))),
        }
    }

    /// Generate a new task ID without persisting
    pub fn generate_id(&mut self) -> Result<String> {
        self.generator.generate()
    }

    /// Ensure a task at the given line has a UUID, returning the ID
    pub fn ensure_task_id(&mut self, file_path: &Path, line_number: usize) -> Result<String> {
        let content = fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {:?}", file_path))?;

        let lines: Vec<&str> = content.lines().collect();

        if line_number == 0 || line_number > lines.len() {
            anyhow::bail!("Invalid line number: {}", line_number);
        }

        let line = lines[line_number - 1];

        // Parse the line to check if it's a task
        if let Some(task) = TaskParser::parse_line(line, line_number) {
            // If task already has an ID, return it
            if let Some(existing_id) = task.id {
                // Update cache
                let mut cache = self.cache.write();
                cache.insert(existing_id.clone(), file_path.to_path_buf(), line_number);
                return Ok(existing_id);
            }

            // Generate new ID
            let new_id = self.generator.generate()?;

            // Update the line with the new ID and update front matter
            self.update_task_with_frontmatter(file_path, line_number, &new_id, &task)?;

            // Update cache
            let mut cache = self.cache.write();
            cache.insert(new_id.clone(), file_path.to_path_buf(), line_number);

            Ok(new_id)
        } else {
            anyhow::bail!("Line {} is not a task", line_number);
        }
    }

    /// Update a task line with ID and also update front matter with task properties
    pub fn update_task_with_frontmatter(
        &self,
        file_path: &Path,
        line_number: usize,
        task_id: &str,
        parsed_task: &ParsedTask,
    ) -> Result<()> {
        let content = fs::read_to_string(file_path)?;

        // Parse front matter
        let (front_matter, body_content) = FrontMatterParser::parse(&content)?;

        // If no front matter exists, create one
        let mut fm = front_matter.unwrap_or_else(FrontMatter::new);

        // Create task properties from parsed task
        let mut task_props = TaskProperties::new(parsed_task.content.clone());

        // Set status
        task_props.status = match parsed_task.status {
            TaskStatus::Done => FmTaskStatus::Done,
            TaskStatus::Todo => FmTaskStatus::Todo,
        };

        // Extract properties from the parsed task
        if let Some(due) = parsed_task.properties.get("due") {
            // Try to parse the due date
            if let Ok(dt) = crate::identity::frontmatter::tasks::normalize_due_date(due) {
                task_props.due = Some(dt);
            }
        }

        if let Some(priority) = parsed_task.properties.get("priority") {
            task_props.priority = Some(crate::identity::frontmatter::tasks::normalize_priority(
                priority,
            ));
        }

        // Extract tags from properties
        let mut tags = Vec::new();
        for (key, _) in &parsed_task.properties {
            if key.starts_with("tag_") {
                // Remove "tag_" prefix to get actual tag
                tags.push(key.strip_prefix("tag_").unwrap_or(key).to_string());
            }
        }
        if !tags.is_empty() {
            task_props.tags = Some(tags);
        }

        if let Some(project) = parsed_task.properties.get("project") {
            task_props.project = Some(project.clone());
        }

        // Add task to front matter
        TaskFrontMatter::upsert_task(&mut fm.extra_fields, task_id.to_string(), task_props);

        // Now update the line with the task ID
        let lines: Vec<&str> = content.lines().collect();
        if line_number > 0 && line_number <= lines.len() {
            let updated_line = TaskParser::add_tid_to_line(lines[line_number - 1], task_id);

            // Compute body start (exclude existing front matter if present)
            let mut body_start_idx = 0usize;
            if content.starts_with("---\n") || content.starts_with("---\r\n") {
                // Find closing delimiter line index
                for (idx, ln) in lines.iter().enumerate().skip(1) {
                    if ln.trim() == "---" {
                        body_start_idx = idx + 1; // line after closing ---
                        break;
                    }
                }
            }

            // Rebuild body from updated lines (excluding any existing front matter lines)
            let mut new_body_lines: Vec<String> = Vec::new();
            for (i, ln) in lines.iter().enumerate().skip(body_start_idx) {
                if i == line_number - 1 {
                    new_body_lines.push(updated_line.clone());
                } else {
                    new_body_lines.push((*ln).to_string());
                }
            }
            let mut new_body = new_body_lines.join("\n");
            if content.ends_with('\n') {
                new_body.push('\n');
            }

            // Serialize new content with updated front matter and updated body
            let final_content = FrontMatterWriter::write(&fm, &new_body)?;

            // Atomic write
            let temp_file = NamedTempFile::new_in(file_path.parent().unwrap())?;
            {
                use std::io::Write;
                let mut f = temp_file.as_file();
                f.write_all(final_content.as_bytes())?;
                f.sync_all()?;
            }
            temp_file.persist(file_path)?;
        }

        Ok(())
    }

    /// Update a specific line in a file with a task ID
    pub fn update_task_line(
        &self,
        file_path: &Path,
        line_number: usize,
        task_id: &str,
    ) -> Result<()> {
        let content = fs::read_to_string(file_path)?;
        let mut lines: Vec<&str> = content.lines().collect();

        if line_number == 0 || line_number > lines.len() {
            anyhow::bail!("Invalid line number: {}", line_number);
        }

        // Update the specific line
        let updated_line = TaskParser::add_tid_to_line(lines[line_number - 1], task_id);
        lines[line_number - 1] = &updated_line;

        // Atomic write using temp file
        let temp_file = NamedTempFile::new_in(file_path.parent().unwrap())?;
        {
            let mut file = temp_file.as_file();
            for (i, line) in lines.iter().enumerate() {
                writeln!(file, "{}", line)?;
                // Don't add extra newline at the end
                if i == lines.len() - 1 && !content.ends_with('\n') {
                    // Remove the last newline if original didn't have it
                    let pos = file.stream_position()?;
                    file.set_len(pos - 1)?;
                }
            }
            file.sync_all()?;
        }

        // Atomically replace the original file
        temp_file.persist(file_path)?;

        Ok(())
    }

    /// Get a task by its ID from a specific file
    pub fn get_task_by_id(&self, file_path: &Path, task_id: &str) -> Result<Option<ParsedTask>> {
        let content = fs::read_to_string(file_path)?;
        let tasks = TaskParser::extract_all_tasks(&content);

        Ok(tasks.into_iter().find(|t| t.id.as_deref() == Some(task_id)))
    }

    /// Batch ensure all tasks in a file have IDs
    pub fn batch_ensure_task_ids(&mut self, file_path: &Path) -> Result<Vec<String>> {
        let content = fs::read_to_string(file_path)?;
        let tasks = TaskParser::extract_all_tasks(&content);

        let mut task_ids = Vec::new();
        let mut lines_to_update: HashMap<usize, String> = HashMap::new();

        for task in tasks {
            if let Some(existing_id) = task.id {
                task_ids.push(existing_id.clone());
                // Update cache
                let mut cache = self.cache.write();
                cache.insert(existing_id, file_path.to_path_buf(), task.line_number);
            } else {
                // Generate new ID
                let new_id = self.generator.generate()?;
                task_ids.push(new_id.clone());
                lines_to_update.insert(task.line_number, new_id.clone());

                // Update cache
                let mut cache = self.cache.write();
                cache.insert(new_id, file_path.to_path_buf(), task.line_number);
            }
        }

        // Apply all updates at once if needed
        if !lines_to_update.is_empty() {
            self.batch_update_file(file_path, lines_to_update)?;
        }

        Ok(task_ids)
    }

    /// Batch update multiple lines in a file
    fn batch_update_file(&self, file_path: &Path, updates: HashMap<usize, String>) -> Result<()> {
        let content = fs::read_to_string(file_path)?;
        let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

        for (line_number, task_id) in updates {
            if line_number > 0 && line_number <= lines.len() {
                lines[line_number - 1] =
                    TaskParser::add_tid_to_line(&lines[line_number - 1], &task_id);
            }
        }

        // Atomic write
        let temp_file = NamedTempFile::new_in(file_path.parent().unwrap())?;
        {
            let mut file = temp_file.as_file();
            for (i, line) in lines.iter().enumerate() {
                if i < lines.len() - 1 {
                    writeln!(file, "{}", line)?;
                } else {
                    // Last line - preserve original ending
                    write!(file, "{}", line)?;
                    if content.ends_with('\n') {
                        writeln!(file)?;
                    }
                }
            }
            file.sync_all()?;
        }

        temp_file.persist(file_path)?;
        Ok(())
    }

    /// Find duplicate task IDs across the vault
    pub fn find_duplicate_task_ids(
        &self,
        vault_root: &Path,
    ) -> Result<HashMap<String, Vec<PathBuf>>> {
        let mut id_locations: HashMap<String, Vec<PathBuf>> = HashMap::new();

        for entry in WalkDir::new(vault_root)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "md"))
        {
            let content = fs::read_to_string(entry.path())?;
            let tasks = TaskParser::extract_all_tasks(&content);

            for task in tasks {
                if let Some(task_id) = task.id {
                    id_locations
                        .entry(task_id)
                        .or_insert_with(Vec::new)
                        .push(entry.path().to_path_buf());
                }
            }
        }

        // Filter to only duplicates
        let duplicates: HashMap<String, Vec<PathBuf>> = id_locations
            .into_iter()
            .filter(|(_, locations)| locations.len() > 1)
            .collect();

        Ok(duplicates)
    }

    /// Clear the task cache
    pub fn clear_cache(&self) {
        let mut cache = self.cache.write();
        cache.clear();
    }

    /// Get cached task location
    pub fn get_cached_location(&self, task_id: &str) -> Option<(PathBuf, usize)> {
        let mut cache = self.cache.write();
        cache.get(task_id).map(|(p, l)| (p.clone(), *l))
    }
}
