use super::context::BotckyVaultContext;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyExecutorTaskInput {
    pub prompt: String,
    #[serde(default)]
    pub agent_type: Option<String>,
    pub context: BotckyVaultContext,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyExecutorTaskRequest {
    pub prompt: String,
    pub agent_type: String,
    pub vault_root: String,
    pub current_folder: String,
    pub vault_id: String,
    pub chat_session_id: String,
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_note: Option<serde_json::Value>,
    #[serde(default)]
    pub selected_notes: Vec<serde_json::Value>,
    #[serde(default)]
    pub context_notes: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn botcky_build_executor_task_request(
    input: BotckyExecutorTaskInput,
) -> Result<BotckyExecutorTaskRequest, String> {
    if input.prompt.trim().is_empty() {
        return Err("task prompt is required".into());
    }
    input.context.validate_required_fields()?;
    Ok(BotckyExecutorTaskRequest {
        prompt: input.prompt,
        agent_type: input.agent_type.unwrap_or_else(|| "executor".into()),
        vault_root: input.context.vault_path.clone(),
        current_folder: input.context.current_folder.clone(),
        vault_id: input.context.vault_id.clone(),
        chat_session_id: input.context.session_id.clone(),
        thread_id: input.context.thread_id.clone(),
        active_note: input
            .context
            .active_note
            .as_ref()
            .map(|note| serde_json::to_value(note).unwrap_or(serde_json::Value::Null)),
        selected_notes: input
            .context
            .selected_notes
            .iter()
            .map(|note| serde_json::to_value(note).unwrap_or(serde_json::Value::Null))
            .collect(),
        context_notes: input
            .context
            .context_notes
            .iter()
            .map(|note| serde_json::to_value(note).unwrap_or(serde_json::Value::Null))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::botcky::context::{BotckyContextNote, BotckyVaultContext};

    #[test]
    fn carries_required_vault_context_to_executor_request() {
        let context = BotckyVaultContext {
            active_note: Some(BotckyContextNote {
                path: "note.md".into(),
                title: Some("Note".into()),
                content: Some("body".into()),
            }),
            selected_notes: vec![BotckyContextNote {
                path: "selected.md".into(),
                title: None,
                content: None,
            }],
            context_notes: vec![],
            vault_path: "/vault".into(),
            vault_id: "vault-id".into(),
            session_id: "session-id".into(),
            thread_id: "thread-id".into(),
            current_folder: "Daily".into(),
        };
        let request = botcky_build_executor_task_request(BotckyExecutorTaskInput {
            prompt: "do work".into(),
            agent_type: Some("executor".into()),
            context,
        })
        .unwrap();
        assert_eq!(request.vault_root, "/vault");
        assert_eq!(request.current_folder, "Daily");
        assert_eq!(request.vault_id, "vault-id");
        assert_eq!(request.chat_session_id, "session-id");
        assert_eq!(request.thread_id, "thread-id");
        assert_eq!(request.selected_notes.len(), 1);
        assert!(request.active_note.is_some());
    }
}
