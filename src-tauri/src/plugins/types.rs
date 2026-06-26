// Plugin types and data structures

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub enabled: bool,
    pub installed: bool,
    pub path: PathBuf,
    pub manifest_path: PathBuf,
    pub entry_point: Option<String>,
    pub permissions: Vec<String>,
    pub dependencies: Vec<String>,
    pub settings: HashMap<String, serde_json::Value>,
    pub settings_schema: Option<serde_json::Value>,
    pub status: PluginStatus,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub min_app_version: Option<String>,
    pub max_app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginStatus {
    Active,
    Inactive,
    Installing,
    Updating,
    Error(String),
    Disabled,
    Incompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub entry_point: Option<String>,
    pub permissions: Vec<String>,
    pub dependencies: Vec<String>,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub min_app_version: Option<String>,
    pub max_app_version: Option<String>,
    pub settings_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSettings {
    pub plugin_id: String,
    pub enabled: bool,
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallOptions {
    pub source: InstallSource,
    pub auto_enable: bool,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InstallSource {
    #[serde(rename = "local")]
    Local { path: PathBuf },
    #[serde(rename = "url")]
    Url { url: String },
    #[serde(rename = "registry")]
    Registry { package_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    pub install_date: String,
    pub update_date: Option<String>,
    pub last_enabled: Option<String>,
    pub last_disabled: Option<String>,
    pub usage_count: u64,
    pub error_count: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("Plugin not found: {0}")]
    NotFound(String),

    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),

    #[error("Installation failed: {0}")]
    InstallationFailed(String),

    #[error("Plugin already installed: {0}")]
    AlreadyInstalled(String),

    #[error("Incompatible version: {0}")]
    IncompatibleVersion(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Dependency missing: {0}")]
    DependencyMissing(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}
