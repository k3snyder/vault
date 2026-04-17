pub mod tasks;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::NamedTempFile;
use yaml_rust::{Yaml, YamlLoader};

pub use tasks::{Priority, TaskFrontMatter, TaskProperties, TaskStatus};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrontMatter {
    pub id: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub legacy_ids: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra_fields: BTreeMap<String, serde_json::Value>,
    #[serde(skip)]
    pub other: BTreeMap<String, Yaml>,
}

impl FrontMatter {
    pub fn new() -> Self {
        FrontMatter {
            id: None,
            created_at: None,
            updated_at: None,
            legacy_ids: None,
            extra_fields: BTreeMap::new(),
            other: BTreeMap::new(),
        }
    }

    pub fn with_id(id: String) -> Self {
        let now = Utc::now();
        FrontMatter {
            id: Some(id),
            created_at: Some(now),
            updated_at: Some(now),
            legacy_ids: None,
            extra_fields: BTreeMap::new(),
            other: BTreeMap::new(),
        }
    }
}

pub struct FrontMatterParser;

impl FrontMatterParser {
    pub fn parse(content: &str) -> Result<(Option<FrontMatter>, String)> {
        // Check if content starts with front matter delimiter
        if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
            return Ok((None, content.to_string()));
        }

        // Find the closing delimiter
        let search_start = if content.starts_with("---\r\n") { 5 } else { 4 };
        let closing_pattern = if content.contains("\r\n") {
            "\r\n---\r\n"
        } else {
            "\n---\n"
        };
        let pattern_start = if content.contains("\r\n") {
            "\r\n---"
        } else {
            "\n---"
        };

        if let Some(end_pos) = content[search_start..].find(pattern_start) {
            let yaml_content = &content[search_start..search_start + end_pos];
            let remaining_content = &content[search_start + end_pos + closing_pattern.len()..];

            // Parse YAML
            match YamlLoader::load_from_str(yaml_content) {
                Ok(docs) if !docs.is_empty() => {
                    let front_matter = Self::yaml_to_frontmatter(&docs[0])?;
                    Ok((Some(front_matter), remaining_content.to_string()))
                }
                _ => {
                    // Return content as-is if YAML parsing fails
                    Ok((None, content.to_string()))
                }
            }
        } else {
            // No closing delimiter found
            Ok((None, content.to_string()))
        }
    }

    fn yaml_to_frontmatter(yaml: &Yaml) -> Result<FrontMatter> {
        let mut fm = FrontMatter::new();

        if let Yaml::Hash(ref h) = yaml {
            for (k, v) in h {
                if let Yaml::String(ref key) = k {
                    match key.as_str() {
                        "id" => {
                            if let Yaml::String(ref s) = v {
                                fm.id = Some(s.clone());
                            }
                        }
                        "created_at" => {
                            if let Yaml::String(ref s) = v {
                                fm.created_at = DateTime::parse_from_rfc3339(s)
                                    .ok()
                                    .map(|dt| dt.with_timezone(&Utc));
                            }
                        }
                        "updated_at" => {
                            if let Yaml::String(ref s) = v {
                                fm.updated_at = DateTime::parse_from_rfc3339(s)
                                    .ok()
                                    .map(|dt| dt.with_timezone(&Utc));
                            }
                        }
                        "legacy_ids" => {
                            if let Yaml::Array(ref arr) = v {
                                let ids: Vec<String> = arr
                                    .iter()
                                    .filter_map(|item| {
                                        if let Yaml::String(ref s) = item {
                                            Some(s.clone())
                                        } else {
                                            None
                                        }
                                    })
                                    .collect();
                                if !ids.is_empty() {
                                    fm.legacy_ids = Some(ids);
                                }
                            }
                        }
                        _ => {
                            // Store as extra field
                            let json_value = Self::yaml_to_json(v);
                            fm.extra_fields.insert(key.clone(), json_value);
                        }
                    }
                }
            }
        }

        Ok(fm)
    }

    fn yaml_to_json(yaml: &Yaml) -> serde_json::Value {
        match yaml {
            Yaml::String(s) => serde_json::Value::String(s.clone()),
            Yaml::Integer(i) => serde_json::Value::Number((*i).into()),
            Yaml::Real(r) => {
                if let Ok(f) = r.parse::<f64>() {
                    serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::String(r.clone()))
                } else {
                    serde_json::Value::String(r.clone())
                }
            }
            Yaml::Boolean(b) => serde_json::Value::Bool(*b),
            Yaml::Array(arr) => {
                let items: Vec<serde_json::Value> = arr.iter().map(Self::yaml_to_json).collect();
                serde_json::Value::Array(items)
            }
            Yaml::Hash(h) => {
                let mut map = serde_json::Map::new();
                for (k, v) in h {
                    if let Yaml::String(key) = k {
                        map.insert(key.clone(), Self::yaml_to_json(v));
                    }
                }
                serde_json::Value::Object(map)
            }
            _ => serde_json::Value::Null,
        }
    }
}

pub struct FrontMatterWriter;

impl FrontMatterWriter {
    pub fn write(front_matter: &FrontMatter, content: &str) -> Result<String> {
        // Use a Vec to maintain insertion order instead of BTreeMap
        let mut yaml_fields: Vec<(String, serde_json::Value)> = Vec::new();

        // Add fields in the desired order: id, created_at, updated_at, then others
        if let Some(ref id) = front_matter.id {
            yaml_fields.push(("id".to_string(), serde_json::Value::String(id.clone())));
        }

        if let Some(ref created) = front_matter.created_at {
            yaml_fields.push((
                "created_at".to_string(),
                serde_json::Value::String(created.to_rfc3339()),
            ));
        }

        if let Some(ref updated) = front_matter.updated_at {
            yaml_fields.push((
                "updated_at".to_string(),
                serde_json::Value::String(updated.to_rfc3339()),
            ));
        }

        if let Some(ref legacy_ids) = front_matter.legacy_ids {
            let ids: Vec<serde_json::Value> = legacy_ids
                .iter()
                .map(|id| serde_json::Value::String(id.clone()))
                .collect();
            yaml_fields.push(("legacy_ids".to_string(), serde_json::Value::Array(ids)));
        }

        // Add extra fields (preserving unknown fields) - sort them alphabetically
        let mut extra_sorted: Vec<_> = front_matter.extra_fields.iter().collect();
        extra_sorted.sort_by_key(|(k, _)| k.as_str());
        for (key, value) in extra_sorted {
            yaml_fields.push((key.clone(), value.clone()));
        }

        // Convert to YAML string
        let yaml_str = Self::vec_to_yaml_string(&yaml_fields)?;

        // Detect line ending style from content
        let line_ending = if content.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };

        // Format with delimiters (yaml_str already has trailing newline)
        Ok(format!(
            "---{}{}---{}{}",
            line_ending, yaml_str, line_ending, content
        ))
    }

    fn vec_to_yaml_string(fields: &Vec<(String, serde_json::Value)>) -> Result<String> {
        let mut yaml_str = String::new();

        for (key, value) in fields {
            yaml_str.push_str(key);
            yaml_str.push_str(": ");
            yaml_str.push_str(&Self::json_to_yaml_value(value, 0));
            yaml_str.push('\n');
        }

        Ok(yaml_str)
    }

    fn json_to_yaml_value(value: &serde_json::Value, indent: usize) -> String {
        match value {
            serde_json::Value::Null => "null".to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => {
                // Quote strings that contain special characters
                if s.contains(':') || s.contains('\n') || s.starts_with(' ') {
                    format!("\"{}\"", s.replace('"', "\\\""))
                } else {
                    s.clone()
                }
            }
            serde_json::Value::Array(arr) => {
                if arr.is_empty() {
                    "[]".to_string()
                } else {
                    let mut result = String::new();
                    for item in arr {
                        result.push('\n');
                        result.push_str(&"  ".repeat(indent + 1));
                        result.push_str("- ");
                        result.push_str(&Self::json_to_yaml_value(item, indent + 1));
                    }
                    result
                }
            }
            serde_json::Value::Object(obj) => {
                let mut result = String::new();
                for (k, v) in obj {
                    result.push('\n');
                    result.push_str(&"  ".repeat(indent + 1));
                    result.push_str(k);
                    result.push_str(": ");
                    result.push_str(&Self::json_to_yaml_value(v, indent + 1));
                }
                result
            }
        }
    }

    pub fn write_atomic(path: &Path, front_matter: &FrontMatter, content: &str) -> Result<()> {
        // Read existing content if file exists
        let full_content = if path.exists() {
            let existing = fs::read_to_string(path)?;
            let (_old_fm, body) = FrontMatterParser::parse(&existing)?;
            Self::write(front_matter, &body)?
        } else {
            Self::write(front_matter, content)?
        };

        // Create temp file in same directory for atomic rename
        let parent = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid file path"))?;

        let mut temp_file = NamedTempFile::new_in(parent)?;
        temp_file.write_all(full_content.as_bytes())?;
        temp_file.flush()?;

        // Sync to disk
        temp_file.as_file().sync_all()?;

        // Atomic rename
        temp_file.persist(path)?;

        Ok(())
    }
}

#[cfg(test)]
mod task_integration_tests;
#[cfg(test)]
mod task_tests;
#[cfg(test)]
mod tests;
