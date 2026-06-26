#![deny(clippy::unwrap_used, clippy::expect_used)]

use serde::ser::SerializeStruct;
use serde::Serialize;
use std::path::Path;

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("window not found")]
    WindowNotFound,
    #[error("no vault is open")]
    VaultNotOpen,
    #[error("not found: {path}")]
    NotFound { path: String },
    #[error("invalid path {path}: {reason}")]
    InvalidPath { path: String, reason: String },
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
    #[error("I/O error on {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Identity(#[from] anyhow::Error),
    #[error("{message}")]
    Other { message: String },
}

impl CommandError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub fn io(path: impl AsRef<Path>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.as_ref().to_string_lossy().to_string(),
            source,
        }
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self::Other {
            message: message.into(),
        }
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl CommandError {
    fn kind(&self) -> &'static str {
        match self {
            Self::WindowNotFound => "WindowNotFound",
            Self::VaultNotOpen => "VaultNotOpen",
            Self::NotFound { .. } => "NotFound",
            Self::InvalidPath { .. } => "InvalidPath",
            Self::InvalidInput { .. } => "InvalidInput",
            Self::Io { .. } => "Io",
            Self::Identity(_) => "Identity",
            Self::Other { .. } => "Other",
        }
    }
}

impl From<CommandError> for String {
    fn from(error: CommandError) -> Self {
        error.to_string()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_kind_and_message_for_all_variants() {
        let cases = vec![
            (
                CommandError::WindowNotFound,
                json!({"kind": "WindowNotFound", "message": "window not found"}),
            ),
            (
                CommandError::VaultNotOpen,
                json!({"kind": "VaultNotOpen", "message": "no vault is open"}),
            ),
            (
                CommandError::NotFound {
                    path: "a.md".to_string(),
                },
                json!({"kind": "NotFound", "message": "not found: a.md"}),
            ),
            (
                CommandError::InvalidPath {
                    path: "../a.md".to_string(),
                    reason: "outside vault".to_string(),
                },
                json!({"kind": "InvalidPath", "message": "invalid path ../a.md: outside vault"}),
            ),
            (
                CommandError::invalid_input("bad status"),
                json!({"kind": "InvalidInput", "message": "invalid input: bad status"}),
            ),
            (
                CommandError::io("a.md", std::io::Error::from(std::io::ErrorKind::NotFound)),
                json!({"kind": "Io", "message": "I/O error on a.md: entity not found"}),
            ),
            (
                CommandError::Identity(anyhow::anyhow!("identity failed")),
                json!({"kind": "Identity", "message": "identity failed"}),
            ),
            (
                CommandError::other("plain failure"),
                json!({"kind": "Other", "message": "plain failure"}),
            ),
        ];

        for (error, expected) in cases {
            assert_eq!(serde_json::to_value(error).unwrap(), expected);
        }
    }
}
