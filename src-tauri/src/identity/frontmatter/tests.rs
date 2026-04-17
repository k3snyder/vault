use super::*;
use chrono::TimeZone;

#[test]
fn test_parse_no_frontmatter() {
    let content = "# Hello World\n\nThis is content.";
    let (fm, body) = FrontMatterParser::parse(content).unwrap();

    assert!(fm.is_none());
    assert_eq!(body, content);
}

#[test]
fn test_parse_basic_frontmatter() {
    let content = "---\nid: test-uuid-123\n---\n# Hello World";
    let (fm, body) = FrontMatterParser::parse(content).unwrap();

    assert!(fm.is_some());
    let fm = fm.unwrap();
    assert_eq!(fm.id, Some("test-uuid-123".to_string()));
    assert_eq!(body, "# Hello World");
}

#[test]
fn test_parse_complete_frontmatter() {
    let content = r#"---
id: test-uuid-123
created_at: 2024-01-01T00:00:00Z
updated_at: 2024-01-02T00:00:00Z
legacy_ids:
  - old-id-1
  - old-id-2
custom_field: custom_value
---
# Content here"#;

    let (fm, body) = FrontMatterParser::parse(content).unwrap();

    assert!(fm.is_some());
    let fm = fm.unwrap();
    assert_eq!(fm.id, Some("test-uuid-123".to_string()));
    assert!(fm.created_at.is_some());
    assert!(fm.updated_at.is_some());
    assert_eq!(
        fm.legacy_ids,
        Some(vec!["old-id-1".to_string(), "old-id-2".to_string()])
    );
    assert_eq!(
        fm.extra_fields.get("custom_field"),
        Some(&serde_json::Value::String("custom_value".to_string()))
    );
    assert_eq!(body, "# Content here");
}

#[test]
fn test_parse_windows_line_endings() {
    let content = "---\r\nid: test-uuid-123\r\n---\r\n# Hello World\r\n";
    let (fm, body) = FrontMatterParser::parse(content).unwrap();

    assert!(fm.is_some());
    let fm = fm.unwrap();
    assert_eq!(fm.id, Some("test-uuid-123".to_string()));
    assert_eq!(body, "# Hello World\r\n");
}

#[test]
fn test_parse_preserves_unknown_fields() {
    let content = r#"---
id: test-uuid-123
author: John Doe
tags:
  - rust
  - testing
metadata:
  version: 1.0
  draft: true
---
Content"#;

    let (fm, body) = FrontMatterParser::parse(content).unwrap();

    assert!(fm.is_some());
    let fm = fm.unwrap();
    assert_eq!(fm.id, Some("test-uuid-123".to_string()));

    // Check preserved fields
    assert_eq!(
        fm.extra_fields.get("author"),
        Some(&serde_json::Value::String("John Doe".to_string()))
    );

    let tags = fm.extra_fields.get("tags").unwrap();
    assert!(tags.is_array());

    let metadata = fm.extra_fields.get("metadata").unwrap();
    assert!(metadata.is_object());
}

#[test]
fn test_parse_corrupted_yaml() {
    let content = "---\nid: test-uuid-123\nauthor: [unclosed\n---\n# Content";
    let (fm, body) = FrontMatterParser::parse(content).unwrap();

    // Should return content as-is when YAML is corrupted
    assert!(fm.is_none());
    assert_eq!(body, content);
}

#[test]
fn test_write_basic_frontmatter() {
    let fm = FrontMatter::with_id("test-uuid-123".to_string());
    let content = "# Hello World";

    let result = FrontMatterWriter::write(&fm, content).unwrap();

    assert!(result.starts_with("---\n"));
    assert!(result.contains("id: test-uuid-123"));
    assert!(result.contains("created_at: "));
    assert!(result.contains("updated_at: "));
    assert!(result.ends_with("---\n# Hello World"));
}

#[test]
fn test_write_preserves_line_endings() {
    let fm = FrontMatter::with_id("test-uuid-123".to_string());
    let content = "# Hello World\r\n";

    let result = FrontMatterWriter::write(&fm, content).unwrap();

    assert!(result.contains("\r\n"));
    assert!(result.ends_with("---\r\n# Hello World\r\n"));
}

#[test]
fn test_write_preserves_extra_fields() {
    let mut fm = FrontMatter::with_id("test-uuid-123".to_string());
    fm.extra_fields.insert(
        "author".to_string(),
        serde_json::Value::String("John Doe".to_string()),
    );
    fm.extra_fields
        .insert("version".to_string(), serde_json::Value::Number(1.into()));

    let content = "Content";
    let result = FrontMatterWriter::write(&fm, content).unwrap();

    assert!(result.contains("author: John Doe"));
    assert!(result.contains("version: 1"));
}

#[test]
fn test_roundtrip_preservation() {
    let original = r#"---
id: test-uuid-123
created_at: 2024-01-01T00:00:00Z
author: John Doe
tags:
  - rust
  - testing
custom_meta:
  nested: value
---
# Document Content

This is the body."#;

    let (fm, body) = FrontMatterParser::parse(original).unwrap();
    assert!(fm.is_some());

    let fm = fm.unwrap();
    let reconstructed = FrontMatterWriter::write(&fm, &body).unwrap();

    // Parse again to verify
    let (fm2, body2) = FrontMatterParser::parse(&reconstructed).unwrap();
    assert!(fm2.is_some());

    let fm2 = fm2.unwrap();
    assert_eq!(fm.id, fm2.id);
    assert_eq!(
        fm.extra_fields.get("author"),
        fm2.extra_fields.get("author")
    );
    assert_eq!(fm.extra_fields.get("tags"), fm2.extra_fields.get("tags"));
    assert_eq!(body, body2);
}

#[test]
fn test_unicode_content() {
    let content = r#"---
id: test-uuid-123
title: "Hello 世界 🌍"
emoji: 🦀
---
# Unicode Test 测试

Content with emojis 🎉 and CJK characters 中文日本語한글"#;

    let (fm, body) = FrontMatterParser::parse(content).unwrap();
    assert!(fm.is_some());

    let fm = fm.unwrap();
    assert_eq!(
        fm.extra_fields.get("title"),
        Some(&serde_json::Value::String("Hello 世界 🌍".to_string()))
    );
    assert_eq!(
        fm.extra_fields.get("emoji"),
        Some(&serde_json::Value::String("🦀".to_string()))
    );
    assert!(body.contains("中文日本語한글"));
}

#[test]
fn test_special_yaml_characters() {
    let content = r#"---
id: test-uuid-123
description: "This has: colons and special chars"
multiline: |
  Line 1
  Line 2
---
Content"#;

    let (fm, _body) = FrontMatterParser::parse(content).unwrap();
    assert!(fm.is_some());

    let fm = fm.unwrap();
    assert!(fm.extra_fields.get("description").is_some());
}

#[tokio::test]
async fn test_atomic_write() {
    use tempfile::TempDir;

    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.md");

    let fm = FrontMatter::with_id("test-uuid-123".to_string());
    let content = "# Test Document";

    // Write atomically
    FrontMatterWriter::write_atomic(&file_path, &fm, content).unwrap();

    // Verify file exists and has correct content
    assert!(file_path.exists());

    let written = fs::read_to_string(&file_path).unwrap();
    assert!(written.contains("id: test-uuid-123"));
    assert!(written.contains("# Test Document"));
}

#[tokio::test]
async fn test_atomic_write_preserves_body() {
    use tempfile::TempDir;

    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.md");

    // Write initial content
    fs::write(&file_path, "# Original Content\n\nBody text here").unwrap();

    // Update with new front matter
    let fm = FrontMatter::with_id("new-uuid-456".to_string());
    FrontMatterWriter::write_atomic(&file_path, &fm, "").unwrap();

    // Read and verify
    let updated = fs::read_to_string(&file_path).unwrap();
    let (new_fm, body) = FrontMatterParser::parse(&updated).unwrap();

    assert!(new_fm.is_some());
    assert_eq!(new_fm.unwrap().id, Some("new-uuid-456".to_string()));
    assert_eq!(body, "# Original Content\n\nBody text here");
}
