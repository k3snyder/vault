use super::path_safety::{canonical_scope, path_relative_to_vault, resolve_target, TargetMode};
use serde::{Deserialize, Serialize};
use std::fs;
use walkdir::WalkDir;

const MAX_BOTCKY_WRITE_BYTES: usize = 512_000;
const MAX_BOTCKY_READ_BYTES: usize = 1_000_000;
const MAX_SEARCH_RESULTS: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyFileRequest {
    pub vault_root: String,
    #[serde(default)]
    pub current_folder: Option<String>,
    pub path: String,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckySearchRequest {
    pub vault_root: String,
    #[serde(default)]
    pub current_folder: Option<String>,
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyToolResult {
    pub success: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub results: Vec<BotckySearchHit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckySearchHit {
    pub path: String,
    pub preview: String,
}

#[tauri::command]
pub async fn botcky_read_file(request: BotckyFileRequest) -> Result<BotckyToolResult, String> {
    let scope = canonical_scope(&request.vault_root, request.current_folder.as_deref())
        .map_err(|err| err.to_string())?;
    let path = resolve_target(&scope, &request.path, TargetMode::MustExist)
        .map_err(|err| err.to_string())?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err("target is not a file".into());
    }
    if metadata.len() as usize > MAX_BOTCKY_READ_BYTES {
        return Err("file exceeds Botcky read limit".into());
    }
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    Ok(BotckyToolResult {
        success: true,
        message: "file read".into(),
        path: Some(path_relative_to_vault(&scope, &path)),
        length: Some(content.len()),
        content: Some(content),
        results: Vec::new(),
    })
}

#[tauri::command]
pub async fn botcky_create_file(request: BotckyFileRequest) -> Result<BotckyToolResult, String> {
    let content = bounded_content(request.content.as_deref().ok_or("content is required")?)?;
    let scope = canonical_scope(&request.vault_root, request.current_folder.as_deref())
        .map_err(|err| err.to_string())?;
    let path = resolve_target(&scope, &request.path, TargetMode::ParentMustExist)
        .map_err(|err| err.to_string())?;
    if path.exists() {
        return Err("create refused: file already exists".into());
    }
    fs::write(&path, content).map_err(|err| err.to_string())?;
    Ok(BotckyToolResult {
        success: true,
        message: "file created".into(),
        path: Some(path_relative_to_vault(&scope, &path)),
        content: None,
        length: Some(content.len()),
        results: Vec::new(),
    })
}

#[tauri::command]
pub async fn botcky_update_file(request: BotckyFileRequest) -> Result<BotckyToolResult, String> {
    let content = bounded_content(request.content.as_deref().ok_or("content is required")?)?;
    let scope = canonical_scope(&request.vault_root, request.current_folder.as_deref())
        .map_err(|err| err.to_string())?;
    let path = resolve_target(&scope, &request.path, TargetMode::MustExist)
        .map_err(|err| err.to_string())?;
    if !path.is_file() {
        return Err("update refused: target is not a file".into());
    }
    fs::write(&path, content).map_err(|err| err.to_string())?;
    Ok(BotckyToolResult {
        success: true,
        message: "file updated".into(),
        path: Some(path_relative_to_vault(&scope, &path)),
        content: None,
        length: Some(content.len()),
        results: Vec::new(),
    })
}

#[tauri::command]
pub async fn botcky_append_file(request: BotckyFileRequest) -> Result<BotckyToolResult, String> {
    let content = bounded_content(request.content.as_deref().ok_or("content is required")?)?;
    let scope = canonical_scope(&request.vault_root, request.current_folder.as_deref())
        .map_err(|err| err.to_string())?;
    let path = resolve_target(&scope, &request.path, TargetMode::MustExist)
        .map_err(|err| err.to_string())?;
    if !path.is_file() {
        return Err("append refused: target is not a file".into());
    }
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|err| err.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|err| err.to_string())?;
    Ok(BotckyToolResult {
        success: true,
        message: "file appended".into(),
        path: Some(path_relative_to_vault(&scope, &path)),
        content: None,
        length: Some(content.len()),
        results: Vec::new(),
    })
}

#[tauri::command]
pub async fn botcky_search_files(request: BotckySearchRequest) -> Result<BotckyToolResult, String> {
    let query = request.query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return Err("search query is required".into());
    }
    let scope = canonical_scope(&request.vault_root, request.current_folder.as_deref())
        .map_err(|err| err.to_string())?;
    let limit = request
        .limit
        .unwrap_or(MAX_SEARCH_RESULTS)
        .clamp(1, MAX_SEARCH_RESULTS);
    let mut hits = Vec::new();
    for entry in WalkDir::new(&scope.current_folder)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if hits.len() >= limit {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if canonical.starts_with(&scope.vault_root) && canonical.starts_with(&scope.current_folder)
        {
            if let Ok(content) = fs::read_to_string(&canonical) {
                let lower = content.to_ascii_lowercase();
                if let Some(index) = lower.find(&query) {
                    hits.push(BotckySearchHit {
                        path: path_relative_to_vault(&scope, &canonical),
                        preview: preview_around(&content, index, query.len()),
                    });
                }
            }
        }
    }
    Ok(BotckyToolResult {
        success: true,
        message: format!("{} search result(s)", hits.len()),
        path: None,
        content: None,
        length: None,
        results: hits,
    })
}

fn bounded_content(content: &str) -> Result<&str, String> {
    if content.len() > MAX_BOTCKY_WRITE_BYTES {
        Err("content exceeds Botcky write limit".into())
    } else {
        Ok(content)
    }
}

fn preview_around(content: &str, byte_index: usize, query_len: usize) -> String {
    let start = content[..byte_index]
        .char_indices()
        .rev()
        .nth(80)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    let end_seed = (byte_index + query_len).min(content.len());
    let tail = &content[end_seed..];
    let end = end_seed
        + tail
            .char_indices()
            .nth(80)
            .map(|(idx, _)| idx)
            .unwrap_or(tail.len());
    content[start..end].replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn read_create_update_append_and_search_stay_inside_scope() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Daily")).unwrap();
        let base = BotckyFileRequest {
            vault_root: dir.path().to_string_lossy().to_string(),
            current_folder: Some("Daily".into()),
            path: "note.md".into(),
            content: Some("alpha".into()),
        };
        assert!(botcky_create_file(base.clone()).await.unwrap().success);
        let mut update = base.clone();
        update.content = Some("alpha beta".into());
        assert_eq!(botcky_update_file(update).await.unwrap().length, Some(10));
        let mut append = base.clone();
        append.content = Some(" gamma".into());
        assert_eq!(botcky_append_file(append).await.unwrap().length, Some(6));
        let read = botcky_read_file(BotckyFileRequest {
            content: None,
            ..base.clone()
        })
        .await
        .unwrap();
        assert_eq!(read.content.unwrap(), "alpha beta gamma");
        let search = botcky_search_files(BotckySearchRequest {
            vault_root: base.vault_root,
            current_folder: Some("Daily".into()),
            query: "beta".into(),
            limit: None,
        })
        .await
        .unwrap();
        assert_eq!(search.results.len(), 1);
    }

    #[tokio::test]
    async fn rejects_create_under_missing_parent_and_traversal() {
        let dir = tempdir().unwrap();
        let err = botcky_create_file(BotckyFileRequest {
            vault_root: dir.path().to_string_lossy().to_string(),
            current_folder: None,
            path: "missing/file.md".into(),
            content: Some("x".into()),
        })
        .await
        .unwrap_err();
        assert!(err.contains("parent"));
        let err = botcky_read_file(BotckyFileRequest {
            vault_root: dir.path().to_string_lossy().to_string(),
            current_folder: None,
            path: "../x".into(),
            content: None,
        })
        .await
        .unwrap_err();
        assert!(err.contains("traversal"));
    }
}
