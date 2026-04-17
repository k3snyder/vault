use chrono::{NaiveDate, Utc};
use chrono_english::{parse_date_string, Dialect};
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

lazy_static! {
    // Main task pattern: matches checkbox tasks with optional indent
    static ref TASK_PATTERN: Regex = Regex::new(
        r"^(\s*)- \[([ xX])\]\s+(.+?)(?:\s*<!-- tid:\s*([a-f0-9-]+)\s*-->)?$"
    ).unwrap();

    // Task ID pattern for extracting existing IDs
    static ref TID_PATTERN: Regex = Regex::new(
        r"<!-- tid:\s*([a-zA-Z0-9-]+)\s*-->"
    ).unwrap();

    // Property patterns
    static ref DUE_PATTERN: Regex = Regex::new(
        r"@due\(([^)]+)\)"
    ).unwrap();
    // Alternative due syntaxes: @due 2025-09-01 or @due:2025-09-01 or natural tokens
    static ref DUE_ALT_PATTERN: Regex = Regex::new(
        r"@due(?::|\s+)\s*([^\s)]+)"
    ).unwrap();

    static ref PRIORITY_PATTERN: Regex = Regex::new(
        r"!(?:p([1-5])|high|medium|low)"
    ).unwrap();

    static ref TAG_PATTERN: Regex = Regex::new(
        r"#([A-Za-z0-9][A-Za-z0-9/_-]*)"
    ).unwrap();

    static ref PROJECT_PATTERN: Regex = Regex::new(
        r"@project\(([^)]+)\)"
    ).unwrap();
    static ref PROJECT_ALT_PATTERN: Regex = Regex::new(
        r"@project(?::|\s+)\s*([^\s)]+)"
    ).unwrap();
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TaskStatus {
    Todo,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTask {
    pub content: String,
    pub status: TaskStatus,
    pub line_number: usize,
    pub indent_level: usize,
    pub id: Option<String>,
    pub properties: HashMap<String, String>,
    pub raw_line: String,
}

pub struct TaskParser;

impl TaskParser {
    /// Parse a single line and extract task information if it's a task
    pub fn parse_line(line: &str, line_number: usize) -> Option<ParsedTask> {
        if let Some(captures) = TASK_PATTERN.captures(line) {
            let indent = captures.get(1).map_or("", |m| m.as_str());
            let status_char = captures.get(2).map_or("", |m| m.as_str());
            let content_with_props = captures.get(3).map_or("", |m| m.as_str());
            let tid = captures.get(4).map(|m| m.as_str().to_string());

            // Calculate indent level (tabs count as 4 spaces)
            let indent_level = indent.chars().map(|c| if c == '\t' { 4 } else { 1 }).sum();

            // Determine task status
            let status = match status_char.to_lowercase().as_str() {
                "x" => TaskStatus::Done,
                _ => TaskStatus::Todo,
            };

            // Extract properties from content
            let mut properties = HashMap::new();

            // Extract due date (support multiple syntaxes)
            if let Some(due_match) = DUE_PATTERN.captures(content_with_props) {
                if let Some(due_str) = due_match.get(1) {
                    let due_value = due_str.as_str();
                    let normalized_date = Self::parse_date(due_value);
                    properties.insert("due".to_string(), normalized_date);
                }
            } else if let Some(alt) = DUE_ALT_PATTERN.captures(content_with_props) {
                if let Some(due_str) = alt.get(1) {
                    let due_value = due_str.as_str();
                    let normalized_date = Self::parse_date(due_value);
                    properties.insert("due".to_string(), normalized_date);
                }
            }

            // Extract priority
            if let Some(priority_match) = PRIORITY_PATTERN.captures(content_with_props) {
                let priority_raw = priority_match.get(0).unwrap().as_str();
                let normalized = Self::normalize_priority(priority_raw);
                properties.insert("priority".to_string(), normalized.to_string());
            }

            // Extract tags
            let tags: Vec<String> = TAG_PATTERN
                .captures_iter(content_with_props)
                .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
                .collect();

            if !tags.is_empty() {
                properties.insert("tags".to_string(), tags.join(","));
            }
            // Derive project from nested tag form: #project/<name>
            if let Some(proj_tag) = tags
                .iter()
                .find(|t| t.to_lowercase().starts_with("project/"))
            {
                if let Some((_pfx, name)) = proj_tag.split_once('/') {
                    if !name.trim().is_empty() {
                        properties.insert("project".to_string(), name.trim().to_string());
                    }
                }
            }

            // Extract project
            if let Some(project_match) = PROJECT_PATTERN.captures(content_with_props) {
                if let Some(project) = project_match.get(1) {
                    properties.insert("project".to_string(), project.as_str().to_string());
                }
            } else if let Some(project_match) = PROJECT_ALT_PATTERN.captures(content_with_props) {
                if let Some(project) = project_match.get(1) {
                    properties.insert("project".to_string(), project.as_str().to_string());
                }
            }

            Some(ParsedTask {
                content: content_with_props.to_string(),
                status,
                line_number,
                indent_level,
                id: tid,
                properties,
                raw_line: line.to_string(),
            })
        } else {
            None
        }
    }

    /// Extract all tasks from a document
    pub fn extract_all_tasks(content: &str) -> Vec<ParsedTask> {
        let mut tasks = Vec::new();

        for (index, line) in content.lines().enumerate() {
            if let Some(task) = Self::parse_line(line, index + 1) {
                tasks.push(task);
            }
        }

        tasks
    }

    /// Add a task ID to a line if it doesn't already have one
    pub fn add_tid_to_line(line: &str, tid: &str) -> String {
        // Check if line already has a tid
        if TID_PATTERN.is_match(line) {
            return line.to_string();
        }

        // Add tid comment at the end of the line
        format!("{} <!-- tid: {} -->", line.trim_end(), tid)
    }

    /// Toggle task status between checked and unchecked
    pub fn toggle_task_status(line: &str) -> String {
        if line.contains("- [ ]") {
            line.replace("- [ ]", "- [x]")
        } else if line.contains("- [x]") || line.contains("- [X]") {
            line.replace("- [x]", "- [ ]").replace("- [X]", "- [ ]")
        } else {
            line.to_string()
        }
    }

    /// Normalize priority values
    pub fn normalize_priority(priority: &str) -> &str {
        match priority.to_lowercase().as_str() {
            "!p1" | "!high" => "high",
            "!p2" | "!p3" | "!medium" => "medium",
            "!p4" | "!p5" | "!low" => "low",
            _ => "medium",
        }
    }

    /// Parse date string (supports natural language)
    fn parse_date(date_str: &str) -> String {
        // First try standard date format (YYYY-MM-DD)
        if let Ok(_) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            return date_str.to_string();
        }

        // Try natural language parsing
        if let Ok(parsed) = parse_date_string(date_str, Utc::now(), Dialect::Uk) {
            return parsed.format("%Y-%m-%d").to_string();
        }

        // Return original if parsing fails
        date_str.to_string()
    }

    /// Update task properties in a line
    pub fn update_task_properties(line: &str, updates: &HashMap<String, Option<String>>) -> String {
        let mut result = line.to_string();

        for (key, value) in updates {
            match key.as_str() {
                "due" => {
                    // Remove existing due date
                    result = DUE_PATTERN.replace(&result, "").to_string();
                    // Add new due date if provided
                    if let Some(new_value) = value {
                        let tid_match = TID_PATTERN.find(&result);
                        if let Some(m) = tid_match {
                            let insert_pos = m.start();
                            result.insert_str(insert_pos, &format!(" @due({})", new_value));
                        } else {
                            result.push_str(&format!(" @due({})", new_value));
                        }
                    }
                }
                "priority" => {
                    // Remove existing priority
                    result = PRIORITY_PATTERN.replace(&result, "").to_string();
                    // Add new priority if provided
                    if let Some(new_value) = value {
                        let priority_marker = match new_value.as_str() {
                            "high" => "!p1",
                            "medium" => "!p2",
                            "low" => "!p4",
                            _ => "!p3",
                        };
                        let tid_match = TID_PATTERN.find(&result);
                        if let Some(m) = tid_match {
                            let insert_pos = m.start();
                            result.insert_str(insert_pos, &format!(" {}", priority_marker));
                        } else {
                            result.push_str(&format!(" {}", priority_marker));
                        }
                    }
                }
                _ => {}
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    // Tests are in parser_test.rs
}
