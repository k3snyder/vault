use crate::secrets::{decrypt_string, derive_key, encrypt_string};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

// API keys are stored AES-GCM-encrypted inside the app's own store files
// (Application Support). The key is derived from an app-local salt, so this is
// obfuscation against casual file reads, not protection from a local attacker.
// This is a deliberate product decision: the app must never touch the OS keychain.
const ENCRYPTION_SALT: &[u8] = b"vault_ai_settings_v1";
const LEGACY_GAIMPLAN_SALT: &[u8] = b"gaimplan_ai_settings_v1";

// Provider enum to identify different AI providers
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum AIProvider {
    #[serde(rename = "openai", alias = "openAI")]
    OpenAI,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "lmstudio", alias = "lMStudio")]
    LMStudio,
    #[serde(rename = "bedrock")]
    Bedrock,
    #[serde(rename = "claudeAgent")]
    ClaudeAgent,
    #[serde(rename = "botckyGateway")]
    BotckyGateway,
}

impl AIProvider {
    pub fn as_str(&self) -> &str {
        match self {
            AIProvider::OpenAI => "openai",
            AIProvider::Gemini => "gemini",
            AIProvider::Ollama => "ollama",
            AIProvider::LMStudio => "lmstudio",
            AIProvider::Bedrock => "bedrock",
            AIProvider::ClaudeAgent => "claudeAgent",
            AIProvider::BotckyGateway => "botckyGateway",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "openai" => Some(AIProvider::OpenAI),
            "gemini" => Some(AIProvider::Gemini),
            "ollama" => Some(AIProvider::Ollama),
            "lmstudio" => Some(AIProvider::LMStudio),
            "bedrock" => Some(AIProvider::Bedrock),
            "claudeAgent" => Some(AIProvider::ClaudeAgent),
            "botckyGateway" => Some(AIProvider::BotckyGateway),
            // Fallback for case-insensitive matching
            s if s.eq_ignore_ascii_case("openai") => Some(AIProvider::OpenAI),
            s if s.eq_ignore_ascii_case("gemini") => Some(AIProvider::Gemini),
            s if s.eq_ignore_ascii_case("ollama") => Some(AIProvider::Ollama),
            s if s.eq_ignore_ascii_case("lmstudio") => Some(AIProvider::LMStudio),
            s if s.eq_ignore_ascii_case("bedrock") => Some(AIProvider::Bedrock),
            s if s.eq_ignore_ascii_case("claudeagent") => Some(AIProvider::ClaudeAgent),
            s if s.eq_ignore_ascii_case("botckygateway") => Some(AIProvider::BotckyGateway),
            _ => None,
        }
    }

    // Get default settings for a provider
    pub fn default_settings(&self) -> AISettings {
        match self {
            AIProvider::OpenAI => AISettings {
                provider: self.clone(),
                endpoint: "https://api.openai.com/v1".to_string(),
                api_key: None,
                model: "gpt-4".to_string(),
                temperature: 0.7,
                max_tokens: 4096,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
            AIProvider::Gemini => AISettings {
                provider: self.clone(),
                endpoint: "https://generativelanguage.googleapis.com/v1beta/".to_string(),
                api_key: None,
                model: "gemini-2.0-flash".to_string(),
                temperature: 0.7,
                max_tokens: 8192,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
            AIProvider::Ollama => AISettings {
                provider: self.clone(),
                endpoint: "http://localhost:11434/v1".to_string(),
                api_key: None,
                model: "llama3.2".to_string(),
                temperature: 0.7,
                max_tokens: 4096,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
            AIProvider::LMStudio => AISettings {
                provider: self.clone(),
                endpoint: "http://localhost:1234/v1".to_string(),
                api_key: None,
                model: "local-model".to_string(),
                temperature: 0.7,
                max_tokens: 4096,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
            AIProvider::Bedrock => AISettings {
                provider: self.clone(),
                // Default to blank; user must provide Bedrock endpoint/proxy
                endpoint: "".to_string(),
                api_key: None,
                // Model identifier used in Bedrock path
                model: "anthropic.claude-sonnet-4-20250514-v1:0".to_string(),
                temperature: 0.7,
                max_tokens: 4096,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
            AIProvider::ClaudeAgent => AISettings {
                provider: self.clone(),
                endpoint: "https://api.anthropic.com".to_string(),
                api_key: None,
                model: "claude-sonnet-4-5-20250929".to_string(),
                temperature: 0.7,
                max_tokens: 8192,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
            AIProvider::BotckyGateway => AISettings {
                provider: self.clone(),
                endpoint: "http://127.0.0.1:7110".to_string(),
                api_key: None,
                model: "botcky-agent".to_string(),
                temperature: 0.7,
                max_tokens: 8000,
                system_prompt: None,
                streaming_enabled: true,
                last_modified: chrono::Utc::now(),
                headers: None,
            },
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HeaderKV {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AISettings {
    pub provider: AIProvider,
    pub endpoint: String,
    pub api_key: Option<String>,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub system_prompt: Option<String>,
    pub streaming_enabled: bool,
    pub last_modified: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    pub headers: Option<Vec<HeaderKV>>, // Optional custom headers
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredSettings {
    provider: AIProvider,
    endpoint: String,
    api_key_encrypted: Option<String>,
    #[serde(default)]
    api_key_in_keyring: bool,
    model: String,
    temperature: f32,
    max_tokens: u32,
    system_prompt: Option<String>,
    streaming_enabled: bool,
    last_modified: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    headers: Option<Vec<HeaderKV>>, // Persist custom headers
}

#[derive(Debug, Serialize, Deserialize)]
struct ActiveProvider {
    provider: AIProvider,
    last_switched: chrono::DateTime<chrono::Utc>,
}

fn encryption_key(app: &AppHandle, salt: &[u8]) -> [u8; 32] {
    let product_name = app.config().product_name.as_deref().unwrap_or("Vault");
    derive_key(salt, product_name)
}

fn decrypt_stored_key(stored: &StoredSettings, keys: &[[u8; 32]]) -> Option<String> {
    let encrypted = stored.api_key_encrypted.as_ref()?;
    keys.iter()
        .find_map(|key| decrypt_string(encrypted, key).ok())
}

// Get store filename for a provider
fn get_store_filename(provider: &AIProvider) -> String {
    format!("ai-settings-{}.json", provider.as_str())
}

#[tauri::command]
pub async fn save_ai_settings_for_provider(
    app: AppHandle,
    provider: String,
    settings: serde_json::Value,
) -> Result<(), String> {
    println!("Saving AI settings for provider: {provider}");

    let provider_enum =
        AIProvider::parse(&provider).ok_or_else(|| format!("Unknown provider: {provider}"))?;

    // Parse settings JSON into a mutable object
    let mut settings_obj = settings
        .as_object()
        .ok_or("Settings must be an object")?
        .clone();

    // Ensure required fields are present
    settings_obj.insert(
        "provider".to_string(),
        serde_json::Value::String(provider_enum.as_str().to_string()),
    );
    settings_obj.insert(
        "last_modified".to_string(),
        serde_json::to_value(chrono::Utc::now()).map_err(|e| e.to_string())?,
    );

    // Parse into AISettings struct
    let settings: AISettings = serde_json::from_value(serde_json::Value::Object(settings_obj))
        .map_err(|e| format!("Failed to parse settings: {e}"))?;

    let api_key_encrypted = match settings.api_key.as_deref() {
        Some(api_key) if !api_key.is_empty() => {
            let key = encryption_key(&app, ENCRYPTION_SALT);
            Some(encrypt_string(api_key, &key)?)
        }
        _ => None,
    };

    // Create stored settings
    let stored = StoredSettings {
        provider: settings.provider.clone(),
        endpoint: settings.endpoint,
        api_key_encrypted,
        api_key_in_keyring: false,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        system_prompt: settings.system_prompt,
        streaming_enabled: settings.streaming_enabled,
        last_modified: settings.last_modified,
        headers: settings.headers,
    };

    // Save to provider-specific store
    let store_name = get_store_filename(&provider_enum);
    let store = app
        .store(&store_name)
        .map_err(|e| format!("Failed to access store: {e}"))?;

    let value = serde_json::to_value(&stored).map_err(|e| e.to_string())?;
    store.set("settings", value);

    store
        .save()
        .map_err(|e| format!("Failed to persist settings: {e}"))?;

    println!("AI settings saved successfully for provider: {provider}");
    Ok(())
}

#[tauri::command]
pub async fn get_ai_settings_for_provider(
    app: AppHandle,
    provider: String,
) -> Result<AISettings, String> {
    println!("Loading AI settings for provider: {provider}");

    let provider_enum =
        AIProvider::parse(&provider).ok_or_else(|| format!("Unknown provider: {provider}"))?;

    let store_name = get_store_filename(&provider_enum);
    let store = app
        .store(&store_name)
        .map_err(|e| format!("Failed to access store: {e}"))?;

    if let Some(value) = store.get("settings") {
        let stored: StoredSettings = serde_json::from_value(value.clone())
            .map_err(|e| format!("Failed to parse settings: {e}"))?;

        let decryption_keys = [
            encryption_key(&app, ENCRYPTION_SALT),
            encryption_key(&app, LEGACY_GAIMPLAN_SALT),
        ];
        let api_key = decrypt_stored_key(&stored, &decryption_keys);

        if api_key.is_none() && stored.api_key_in_keyring {
            eprintln!(
                "Note: the {provider} API key was previously stored in the system keychain. \
                 Vault no longer reads the keychain; please re-enter the key in AI settings."
            );
        }

        Ok(AISettings {
            provider: stored.provider,
            endpoint: stored.endpoint,
            api_key,
            model: stored.model,
            temperature: stored.temperature,
            max_tokens: stored.max_tokens,
            system_prompt: stored.system_prompt,
            streaming_enabled: stored.streaming_enabled,
            last_modified: stored.last_modified,
            headers: stored.headers,
        })
    } else {
        println!("No settings found for provider {provider}, returning defaults");
        Ok(provider_enum.default_settings())
    }
}

#[tauri::command]
pub async fn get_active_ai_provider(app: AppHandle) -> Result<AIProvider, String> {
    let store = app
        .store("ai-settings-active.json")
        .map_err(|e| format!("Failed to access store: {e}"))?;

    if let Some(value) = store.get("active") {
        let active: ActiveProvider = serde_json::from_value(value.clone())
            .map_err(|e| format!("Failed to parse active provider: {e}"))?;
        Ok(active.provider)
    } else {
        // Default to OpenAI if no active provider set
        Ok(AIProvider::OpenAI)
    }
}

#[tauri::command]
pub async fn set_active_ai_provider(app: AppHandle, provider: String) -> Result<(), String> {
    println!("Setting active AI provider to: {provider}");

    let provider_enum =
        AIProvider::parse(&provider).ok_or_else(|| format!("Unknown provider: {provider}"))?;

    let active = ActiveProvider {
        provider: provider_enum,
        last_switched: chrono::Utc::now(),
    };

    let store = app
        .store("ai-settings-active.json")
        .map_err(|e| format!("Failed to access store: {e}"))?;

    let value = serde_json::to_value(&active).map_err(|e| e.to_string())?;
    store.set("active", value);

    store
        .save()
        .map_err(|e| format!("Failed to persist active provider: {e}"))?;

    println!("Active AI provider set successfully");
    Ok(())
}

#[tauri::command]
pub async fn migrate_ai_settings(app: AppHandle) -> Result<bool, String> {
    println!("Checking for AI settings migration...");

    // Check if old settings exist
    let old_store = app
        .store("ai_settings.json")
        .map_err(|e| format!("Failed to access old store: {e}"))?;

    let Some(value) = old_store.get("settings") else {
        println!("No old settings to migrate");
        return Ok(false);
    };

    // Parse old settings
    #[derive(Deserialize)]
    struct OldStoredSettings {
        endpoint: String,
        api_key_encrypted: Option<String>,
        model: String,
        temperature: f32,
        max_tokens: u32,
    }

    let old_settings: OldStoredSettings = serde_json::from_value(value.clone())
        .map_err(|e| format!("Failed to parse old settings: {e}"))?;

    // Determine provider from endpoint
    let provider = if old_settings.endpoint.contains("openai.com") {
        AIProvider::OpenAI
    } else if old_settings
        .endpoint
        .contains("generativelanguage.googleapis.com")
    {
        AIProvider::Gemini
    } else if old_settings.endpoint.contains("localhost:11434") {
        AIProvider::Ollama
    } else if old_settings.endpoint.contains("localhost:1234") {
        AIProvider::LMStudio
    } else if old_settings.endpoint.contains("anthropic.com") {
        AIProvider::ClaudeAgent
    } else {
        // Default to OpenAI for unknown endpoints
        AIProvider::OpenAI
    };

    println!("Migrating settings to provider: {provider:?}");

    // Create new settings
    let new_settings = StoredSettings {
        provider: provider.clone(),
        endpoint: old_settings.endpoint,
        api_key_encrypted: old_settings.api_key_encrypted,
        api_key_in_keyring: false,
        model: old_settings.model,
        temperature: old_settings.temperature,
        max_tokens: old_settings.max_tokens,
        system_prompt: None,
        streaming_enabled: true,
        last_modified: chrono::Utc::now(),
        headers: None,
    };

    // Save to new provider-specific store
    let store_name = get_store_filename(&provider);
    let new_store = app
        .store(&store_name)
        .map_err(|e| format!("Failed to access new store: {e}"))?;

    let value = serde_json::to_value(&new_settings).map_err(|e| e.to_string())?;
    new_store.set("settings", value);
    new_store
        .save()
        .map_err(|e| format!("Failed to save migrated settings: {e}"))?;

    // Set as active provider
    set_active_ai_provider(app.clone(), provider.as_str().to_string()).await?;

    // Remove old settings
    old_store.delete("settings");
    old_store
        .save()
        .map_err(|e| format!("Failed to clean up old settings: {e}"))?;

    println!("AI settings migration completed successfully");
    Ok(true)
}

// Re-export test connection functionality from the old module

// Command wrapper functions
#[tauri::command]
pub async fn get_ai_settings(app: AppHandle) -> Result<Option<AISettings>, String> {
    // Get the active provider's settings
    let active_provider = get_active_ai_provider(app.clone()).await?;
    let settings = get_ai_settings_for_provider(app, active_provider.as_str().to_string()).await?;
    Ok(Some(settings))
}

#[tauri::command]
pub async fn save_ai_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    // Extract provider from settings
    let provider_str = settings
        .get("provider")
        .and_then(|p| p.as_str())
        .ok_or("Provider not specified in settings")?
        .to_string();

    // Save using the provider-specific function which handles missing fields
    save_ai_settings_for_provider(app.clone(), provider_str.clone(), settings).await?;
    set_active_ai_provider(app, provider_str).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_settings_fixture() -> StoredSettings {
        StoredSettings {
            provider: AIProvider::OpenAI,
            endpoint: "https://api.openai.com/v1".to_string(),
            api_key_encrypted: None,
            api_key_in_keyring: false,
            model: "gpt-4".to_string(),
            temperature: 0.7,
            max_tokens: 4096,
            system_prompt: None,
            streaming_enabled: true,
            last_modified: chrono::Utc::now(),
            headers: None,
        }
    }

    #[test]
    fn botcky_gateway_string_mapping_round_trip() {
        let provider = AIProvider::BotckyGateway;
        assert_eq!(provider.as_str(), "botckyGateway");
        assert_eq!(
            AIProvider::parse("botckyGateway"),
            Some(AIProvider::BotckyGateway)
        );
        assert_eq!(
            AIProvider::parse("BotckyGateway"),
            Some(AIProvider::BotckyGateway)
        );
    }

    #[test]
    fn botcky_gateway_default_settings_are_expected() {
        let settings = AIProvider::BotckyGateway.default_settings();
        assert_eq!(settings.provider, AIProvider::BotckyGateway);
        assert_eq!(settings.endpoint, "http://127.0.0.1:7110");
        assert_eq!(settings.model, "botcky-agent");
        assert_eq!(settings.max_tokens, 8000);
        assert!(settings.api_key.is_none());
        assert!(settings.streaming_enabled);
    }

    #[test]
    fn gemini_default_endpoint_uses_native_google_api_path() {
        let settings = AIProvider::Gemini.default_settings();
        assert_eq!(settings.provider, AIProvider::Gemini);
        assert_eq!(
            settings.endpoint,
            "https://generativelanguage.googleapis.com/v1beta/"
        );
        assert_eq!(settings.model, "gemini-2.0-flash");
    }

    #[test]
    fn provider_serializes_to_frontend_provider_ids() {
        assert_eq!(
            serde_json::to_string(&AIProvider::OpenAI).expect("serialize provider"),
            "\"openai\""
        );
        assert_eq!(
            serde_json::to_string(&AIProvider::LMStudio).expect("serialize provider"),
            "\"lmstudio\""
        );
        assert_eq!(
            serde_json::to_string(&AIProvider::BotckyGateway).expect("serialize provider"),
            "\"botckyGateway\""
        );
    }

    #[test]
    fn provider_deserializes_legacy_camelcase_ids() {
        assert_eq!(
            serde_json::from_str::<AIProvider>("\"openAI\"").expect("deserialize legacy openai"),
            AIProvider::OpenAI
        );
        assert_eq!(
            serde_json::from_str::<AIProvider>("\"lMStudio\"")
                .expect("deserialize legacy lmstudio"),
            AIProvider::LMStudio
        );
    }

    #[test]
    fn stored_key_round_trip_vault_salt() {
        let key = derive_key(ENCRYPTION_SALT, "Vault");
        let encrypted = encrypt_string("vault-secret", &key).expect("encrypt key");
        assert_eq!(
            decrypt_string(&encrypted, &key).expect("decrypt key"),
            "vault-secret"
        );

        let mut stored = stored_settings_fixture();
        stored.api_key_encrypted = Some(encrypted);

        assert_eq!(
            decrypt_stored_key(&stored, &[key]),
            Some("vault-secret".to_string())
        );
    }

    #[test]
    fn stored_key_round_trip_legacy_gaimplan_salt() {
        let key = derive_key(LEGACY_GAIMPLAN_SALT, "Vault");
        let encrypted = encrypt_string("gaimplan-secret", &key).expect("encrypt key");

        let mut stored = stored_settings_fixture();
        stored.api_key_encrypted = Some(encrypted);

        assert_eq!(
            decrypt_stored_key(&stored, &[derive_key(ENCRYPTION_SALT, "Vault"), key]),
            Some("gaimplan-secret".to_string())
        );
    }

    #[test]
    fn keyring_era_record_without_blob_yields_no_key() {
        let mut stored = stored_settings_fixture();
        stored.api_key_in_keyring = true;

        assert_eq!(
            decrypt_stored_key(&stored, &[derive_key(ENCRYPTION_SALT, "Vault")]),
            None
        );
    }

    #[test]
    fn blob_decrypts_even_when_keyring_marker_is_set() {
        let key = derive_key(ENCRYPTION_SALT, "Vault");
        let encrypted = encrypt_string("file-secret", &key).expect("encrypt key");
        let mut stored = stored_settings_fixture();
        stored.api_key_encrypted = Some(encrypted);
        stored.api_key_in_keyring = true;

        assert_eq!(
            decrypt_stored_key(&stored, &[key]),
            Some("file-secret".to_string())
        );
    }

    #[test]
    fn no_key_material_yields_no_key() {
        let stored = stored_settings_fixture();

        assert_eq!(
            decrypt_stored_key(&stored, &[derive_key(ENCRYPTION_SALT, "Vault")]),
            None
        );
    }

    #[test]
    fn undecryptable_blob_yields_no_key_and_is_preserved() {
        let mut stored = stored_settings_fixture();
        stored.api_key_encrypted = Some("not-valid-base64".to_string());

        assert_eq!(
            decrypt_stored_key(&stored, &[derive_key(ENCRYPTION_SALT, "Vault")]),
            None
        );
        assert_eq!(
            stored.api_key_encrypted.as_deref(),
            Some("not-valid-base64")
        );
    }

    #[test]
    fn old_stored_settings_deserialize_with_keyring_marker_default_false() {
        let raw = serde_json::json!({
            "provider": "openai",
            "endpoint": "https://api.openai.com/v1",
            "api_key_encrypted": null,
            "model": "gpt-4",
            "temperature": 0.7,
            "max_tokens": 4096,
            "system_prompt": null,
            "streaming_enabled": true,
            "last_modified": chrono::Utc::now(),
            "headers": null
        });

        let stored: StoredSettings =
            serde_json::from_value(raw).expect("deserialize legacy settings");

        assert!(!stored.api_key_in_keyring);
    }
}
