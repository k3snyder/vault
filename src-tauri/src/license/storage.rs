/// File-based license storage
///
/// Stores license information in the app's data directory:
/// - macOS: ~/Library/Application Support/com.vault/license.json
/// - Windows: %APPDATA%/com.vault/license.json
/// - Linux: ~/.config/com.vault/license.json
use super::signing::{embedded_verifying_key, verify_signed_license, SignedLicense};
use super::types::LicenseInfo;
use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const APP_NAME: &str = "com.vault";
const LICENSE_FILE: &str = "license.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "format")]
pub enum StoredLicense {
    #[serde(rename = "trial")]
    Trial { info: LicenseInfo },
    #[serde(rename = "signed_v1")]
    Signed { license: SignedLicense },
    #[cfg(debug_assertions)]
    #[serde(rename = "debug_dev")]
    DebugDev { info: LicenseInfo },
}

#[derive(Debug, Clone)]
pub enum StoredLicenseState {
    Missing,
    Valid(LicenseInfo),
    Invalid(String),
}

/// Get the license file path
fn get_license_path() -> Result<PathBuf, String> {
    let data_dir =
        dirs::config_dir().ok_or_else(|| "Failed to get config directory".to_string())?;

    get_license_path_in(&data_dir)
}

fn get_license_path_in(base_dir: &Path) -> Result<PathBuf, String> {
    let app_dir = base_dir.join(APP_NAME);

    // Create directory if it doesn't exist
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app directory: {e}"))?;
    }

    Ok(app_dir.join(LICENSE_FILE))
}

/// Store license information to file
pub fn store_license(machine_id: &str, license_info: &LicenseInfo) -> Result<(), String> {
    let path = get_license_path()?;
    store_license_at_path(&path, machine_id, license_info)
}

pub fn store_signed_license(
    _machine_id: &str,
    signed_license: &SignedLicense,
) -> Result<(), String> {
    let path = get_license_path()?;
    write_stored_license_at_path(
        &path,
        &StoredLicense::Signed {
            license: signed_license.clone(),
        },
    )
}

fn store_license_at_path(
    path: &Path,
    _machine_id: &str,
    license_info: &LicenseInfo,
) -> Result<(), String> {
    let stored_license = if license_info.license_type == "trial" {
        StoredLicense::Trial {
            info: license_info.clone(),
        }
    } else {
        #[cfg(debug_assertions)]
        {
            if license_info.key.starts_with("DEV-") {
                StoredLicense::DebugDev {
                    info: license_info.clone(),
                }
            } else {
                return Err(
                    "Paid licenses must be stored from a signed server response".to_string()
                );
            }
        }

        #[cfg(not(debug_assertions))]
        {
            return Err("Paid licenses must be stored from a signed server response".to_string());
        }
    };

    write_stored_license_at_path(path, &stored_license)
}

fn write_stored_license_at_path(path: &Path, stored_license: &StoredLicense) -> Result<(), String> {
    let json = serde_json::to_string_pretty(stored_license)
        .map_err(|e| format!("Failed to serialize license: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write license file: {e}"))?;

    Ok(())
}

/// Load license information from file
pub fn load_license(machine_id: &str) -> Result<Option<LicenseInfo>, String> {
    match load_license_state(machine_id)? {
        StoredLicenseState::Missing => Ok(None),
        StoredLicenseState::Valid(license_info) => Ok(Some(license_info)),
        StoredLicenseState::Invalid(reason) => Err(reason),
    }
}

pub fn load_license_state(machine_id: &str) -> Result<StoredLicenseState, String> {
    let path = get_license_path()?;
    let verifying_key = embedded_verifying_key()?;

    read_license_state_at_path(&path, &verifying_key, machine_id)
}

fn read_license_state_at_path(
    path: &Path,
    verifying_key: &VerifyingKey,
    machine_id: &str,
) -> Result<StoredLicenseState, String> {
    // Check if file exists
    if !path.exists() {
        return Ok(StoredLicenseState::Missing);
    }

    // Read file contents
    let json = fs::read_to_string(path).map_err(|e| format!("Failed to read license file: {e}"))?;

    if let Ok(stored_license) = serde_json::from_str::<StoredLicense>(&json) {
        return Ok(match stored_license {
            StoredLicense::Trial { info } => StoredLicenseState::Valid(info),
            StoredLicense::Signed { license } => {
                match verify_signed_license(&license, verifying_key, machine_id) {
                    Ok(info) => StoredLicenseState::Valid(info),
                    Err(reason) => StoredLicenseState::Invalid(reason),
                }
            }
            #[cfg(debug_assertions)]
            StoredLicense::DebugDev { info } => StoredLicenseState::Valid(info),
        });
    }

    match serde_json::from_str::<LicenseInfo>(&json) {
        Ok(legacy_info) if legacy_info.license_type == "trial" => {
            Ok(StoredLicenseState::Valid(legacy_info))
        }
        Ok(_) => Ok(StoredLicenseState::Invalid(
            "Stored paid license is unsigned; reactivation required".to_string(),
        )),
        Err(e) => Ok(StoredLicenseState::Invalid(format!(
            "Failed to deserialize license: {e}"
        ))),
    }
}

/// Delete license information from file
pub fn delete_license(machine_id: &str) -> Result<(), String> {
    let path = get_license_path()?;
    delete_license_at_path(&path, machine_id)
}

fn delete_license_at_path(path: &Path, _machine_id: &str) -> Result<(), String> {
    // Check if file exists
    if !path.exists() {
        return Ok(()); // Already deleted
    }

    // Delete the file
    fs::remove_file(path).map_err(|e| format!("Failed to delete license file: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::signing::test_support::{sign_license, signing_key};
    use base64::Engine as _;
    use chrono::Utc;
    use tempfile::TempDir;

    // Test machine ID (not used in file storage, but kept for API compatibility)
    fn test_machine_id() -> String {
        let process_id = std::process::id();
        format!("test-machine-{process_id}")
    }

    fn test_path(temp_dir: &TempDir) -> PathBuf {
        get_license_path_in(temp_dir.path()).expect("test license path")
    }

    fn load_from_path(path: &Path, key: &VerifyingKey, machine_id: &str) -> StoredLicenseState {
        read_license_state_at_path(path, key, machine_id).expect("read license state")
    }

    #[test]
    fn test_store_and_load_license() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);

        // Create test license info
        let license_info = LicenseInfo {
            key: "TEST-KEY-12345".to_string(),
            license_type: "trial".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(30)),
        };

        // Store the license
        let result = store_license_at_path(&path, &machine_id, &license_info);
        assert!(
            result.is_ok(),
            "Failed to store license: {:?}",
            result.err()
        );

        // Load the license back
        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        let StoredLicenseState::Valid(loaded_info) = loaded else {
            panic!("License should exist after storing");
        };

        assert_eq!(loaded_info.key, license_info.key);
        assert_eq!(loaded_info.license_type, license_info.license_type);
        assert_eq!(loaded_info.features, license_info.features);
    }

    #[test]
    fn test_load_nonexistent_license() {
        let process_id = std::process::id();
        let machine_id = format!("nonexistent-{process_id}");
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);

        // Try to load license that doesn't exist
        let result = read_license_state_at_path(&path, &signing_key.verifying_key(), &machine_id);
        assert!(
            result.is_ok(),
            "Load should succeed even if license doesn't exist"
        );

        let loaded = result.unwrap();
        assert!(
            matches!(loaded, StoredLicenseState::Missing),
            "Should return None for nonexistent license"
        );
    }

    #[test]
    fn test_delete_license() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);

        // Store a test license
        let license_info = LicenseInfo {
            key: "DELETE-TEST-KEY".to_string(),
            license_type: "trial".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(30)),
        };

        store_license_at_path(&path, &machine_id, &license_info).expect("Failed to store license");

        // Verify it was stored
        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        assert!(
            matches!(loaded, StoredLicenseState::Valid(_)),
            "License should exist before deletion"
        );

        // Delete the license
        let result = delete_license_at_path(&path, &machine_id);
        assert!(
            result.is_ok(),
            "Failed to delete license: {:?}",
            result.err()
        );

        // Verify it was deleted
        let loaded_after =
            read_license_state_at_path(&path, &signing_key.verifying_key(), &machine_id)
                .expect("Failed to load license");
        assert!(
            matches!(loaded_after, StoredLicenseState::Missing),
            "License should not exist after deletion"
        );
    }

    #[test]
    fn test_update_license() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);

        // Store initial license
        let license_info_v1 = LicenseInfo {
            key: "UPDATE-KEY-V1".to_string(),
            license_type: "trial".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(30)),
        };

        store_license_at_path(&path, &machine_id, &license_info_v1).expect("Failed to store v1");

        // Update with new license
        let license_info_v2 = LicenseInfo {
            key: "UPDATE-KEY-V2".to_string(),
            license_type: "trial".to_string(),
            features: vec!["pacasdb".to_string(), "advanced".to_string()],
            activated_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(14)),
        };

        store_license_at_path(&path, &machine_id, &license_info_v2).expect("Failed to store v2");

        // Load and verify it's the updated version
        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        let StoredLicenseState::Valid(loaded_info) = loaded else {
            panic!("License should exist after update");
        };
        assert_eq!(loaded_info.key, "UPDATE-KEY-V2", "Should have updated key");
        assert_eq!(
            loaded_info.license_type, "trial",
            "Should have updated type"
        );
        assert_eq!(
            loaded_info.features.len(),
            2,
            "Should have updated features"
        );
    }

    #[test]
    fn paid_license_requires_signed_storage() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let license_info = LicenseInfo {
            key: "PAID-KEY".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: None,
        };

        let result = store_license_at_path(&path, &machine_id, &license_info);

        assert!(result.unwrap_err().contains("signed server response"));
    }

    #[test]
    fn stored_signed_license_reverifies_on_load() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);
        let license_info = LicenseInfo {
            key: "SIGNED-STORED".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string(), "csv:pro".to_string()],
            activated_at: Utc::now(),
            expires_at: None,
        };
        let signed_license = sign_license(&signing_key, license_info, &machine_id);

        write_stored_license_at_path(
            &path,
            &StoredLicense::Signed {
                license: signed_license,
            },
        )
        .expect("store signed license");

        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        let StoredLicenseState::Valid(loaded_info) = loaded else {
            panic!("signed license should verify");
        };

        assert_eq!(loaded_info.key, "SIGNED-STORED");
        assert_eq!(loaded_info.features, vec!["pacasdb", "csv:pro"]);
    }

    #[test]
    fn edited_signed_license_is_invalid_on_load() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);
        let license_info = LicenseInfo {
            key: "SIGNED-STORED".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: None,
        };
        let mut signed_license = sign_license(&signing_key, license_info, &machine_id);
        let mut payload = base64::engine::general_purpose::STANDARD
            .decode(&signed_license.payload)
            .expect("payload decodes");
        let last = payload.len() - 1;
        payload[last] ^= 1;
        signed_license.payload = base64::engine::general_purpose::STANDARD.encode(payload);

        write_stored_license_at_path(
            &path,
            &StoredLicense::Signed {
                license: signed_license,
            },
        )
        .expect("store tampered signed license");

        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        let StoredLicenseState::Invalid(reason) = loaded else {
            panic!("tampered signed license should be invalid");
        };

        assert!(reason.contains("signature"));
    }

    #[test]
    fn legacy_bare_license_file_is_invalid_unless_trial() {
        let machine_id = test_machine_id();
        let temp_dir = TempDir::new().expect("temp dir");
        let path = test_path(&temp_dir);
        let signing_key = signing_key(21);
        let paid_legacy = LicenseInfo {
            key: "LEGACY-PAID".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: None,
        };

        fs::write(
            &path,
            serde_json::to_string_pretty(&paid_legacy).expect("serializes"),
        )
        .expect("write legacy paid license");

        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        assert!(matches!(loaded, StoredLicenseState::Invalid(_)));

        let trial_legacy = LicenseInfo {
            key: "TRIAL-LEGACY".to_string(),
            license_type: "trial".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(30)),
        };
        fs::write(
            &path,
            serde_json::to_string_pretty(&trial_legacy).expect("serializes"),
        )
        .expect("write legacy trial license");

        let loaded = load_from_path(&path, &signing_key.verifying_key(), &machine_id);
        assert!(matches!(loaded, StoredLicenseState::Valid(_)));
    }
}
