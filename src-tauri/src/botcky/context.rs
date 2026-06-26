use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyContextNote {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyVaultContext {
    pub active_note: Option<BotckyContextNote>,
    #[serde(default)]
    pub selected_notes: Vec<BotckyContextNote>,
    #[serde(default)]
    pub context_notes: Vec<BotckyContextNote>,
    pub vault_path: String,
    pub vault_id: String,
    pub session_id: String,
    pub thread_id: String,
    pub current_folder: String,
}

impl BotckyVaultContext {
    pub fn validate_required_fields(&self) -> Result<(), String> {
        let required = [
            ("vault_path", self.vault_path.trim()),
            ("vault_id", self.vault_id.trim()),
            ("session_id", self.session_id.trim()),
            ("thread_id", self.thread_id.trim()),
            ("current_folder", self.current_folder.trim()),
        ];
        for (name, value) in required {
            if value.is_empty() {
                return Err(format!("missing required Botcky context field: {name}"));
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn botcky_validate_context(context: BotckyVaultContext) -> Result<BotckyVaultContext, String> {
    context.validate_required_fields()?;
    Ok(context)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> BotckyVaultContext {
        BotckyVaultContext {
            active_note: Some(BotckyContextNote {
                path: "Daily/today.md".into(),
                title: Some("today".into()),
                content: Some("body".into()),
            }),
            selected_notes: vec![BotckyContextNote {
                path: "Daily/one.md".into(),
                title: None,
                content: None,
            }],
            context_notes: vec![],
            vault_path: "/vault".into(),
            vault_id: "vault-1".into(),
            session_id: "session-1".into(),
            thread_id: "thread-1".into(),
            current_folder: "Daily".into(),
        }
    }

    #[test]
    fn serializes_all_mvp_fields() {
        let value = serde_json::to_value(context()).unwrap();
        for field in [
            "active_note",
            "selected_notes",
            "context_notes",
            "vault_path",
            "vault_id",
            "session_id",
            "thread_id",
            "current_folder",
        ] {
            assert!(value.get(field).is_some(), "missing {field}");
        }
    }

    #[test]
    fn rejects_missing_required_identity_field() {
        let mut context = context();
        context.thread_id.clear();
        assert!(context
            .validate_required_fields()
            .unwrap_err()
            .contains("thread_id"));
    }
}
