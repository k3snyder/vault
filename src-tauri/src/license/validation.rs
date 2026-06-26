/// Online license validation and activation
///
/// Handles communication with the license server for activation,
/// validation, and deactivation operations.
use super::signing::{embedded_verifying_key, verify_signed_license, SignedLicense};
use super::types::LicenseInfo;
#[cfg(debug_assertions)]
use chrono::Utc;
use ed25519_dalek::VerifyingKey;
use reqwest;
use serde::{Deserialize, Serialize};

const LICENSE_SERVER_URL: &str = "https://license.vaultapp.com/api/v1";
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// Dev license key prefix - bypasses online validation for development testing
#[cfg(debug_assertions)]
const DEV_LICENSE_PREFIX: &str = "DEV-";

#[derive(Debug)]
pub struct ActivatedLicense {
    pub license_info: LicenseInfo,
    pub signed_license: Option<SignedLicense>,
}

#[derive(Debug, Serialize)]
struct ActivationRequest {
    key: String,
    machine_id: String,
    app_version: String,
    platform: String,
}

#[derive(Debug, Deserialize)]
struct ActivationResponse {
    success: bool,
    license: Option<SignedLicense>,
    error: Option<String>,
}

/// Activate a license key online
pub async fn activate_online(key: &str, machine_id: &str) -> Result<ActivatedLicense, String> {
    let verifying_key = embedded_verifying_key()?;

    activate_online_at(LICENSE_SERVER_URL, &verifying_key, key, machine_id).await
}

pub(crate) async fn activate_online_at(
    base_url: &str,
    verifying_key: &VerifyingKey,
    key: &str,
    machine_id: &str,
) -> Result<ActivatedLicense, String> {
    // Check for dev license key (DEV-xxxx) - bypasses online validation
    #[cfg(debug_assertions)]
    if key.starts_with(DEV_LICENSE_PREFIX) {
        return Ok(ActivatedLicense {
            license_info: create_dev_license(key),
            signed_license: None,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let request_body = ActivationRequest {
        key: key.to_string(),
        machine_id: machine_id.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    };

    let url = format!("{base_url}/activate");

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "License server timeout - check your internet connection".to_string()
            } else if e.is_connect() {
                "Cannot connect to license server - check your internet connection".to_string()
            } else {
                format!("Network error: {e}")
            }
        })?;

    let status = response.status();

    if status.is_success() {
        let activation_response: ActivationResponse = response
            .json()
            .await
            .map_err(|e| format!("Invalid response from license server: {e}"))?;

        if activation_response.success {
            let signed_license = activation_response
                .license
                .ok_or_else(|| "License server returned success but no license data".to_string())?;
            let license_info = verify_signed_license(&signed_license, verifying_key, machine_id)?;

            Ok(ActivatedLicense {
                license_info,
                signed_license: Some(signed_license),
            })
        } else {
            Err(activation_response
                .error
                .unwrap_or_else(|| "Activation failed".to_string()))
        }
    } else if status.as_u16() == 400 {
        Err("Invalid license key format".to_string())
    } else if status.as_u16() == 401 {
        Err("Invalid or expired license key".to_string())
    } else if status.as_u16() == 429 {
        Err("Activation limit reached for this license key".to_string())
    } else {
        let status_code = status.as_u16();
        Err(format!("License server error: {status_code}"))
    }
}

/// Validate an existing license key online
#[allow(dead_code)] // Reserved for periodic validation feature
pub async fn validate_online(key: &str, machine_id: &str) -> Result<bool, String> {
    validate_online_at(LICENSE_SERVER_URL, key, machine_id).await
}

pub(crate) async fn validate_online_at(
    base_url: &str,
    key: &str,
    machine_id: &str,
) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let request_body = serde_json::json!({
        "key": key,
        "machine_id": machine_id,
    });

    let url = format!("{base_url}/validate");

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            // Network errors during validation should not invalidate license
            // Return Ok(true) to allow grace period
            if e.is_timeout() || e.is_connect() {
                return "Network error - entering grace period".to_string();
            }
            format!("Validation error: {e}")
        })?;

    let status = response.status();

    if status.is_success() {
        #[derive(Deserialize)]
        struct ValidationResponse {
            #[allow(dead_code)] // Field read via deserialization
            valid: bool,
        }

        let validation: ValidationResponse = response
            .json()
            .await
            .map_err(|e| format!("Invalid validation response: {e}"))?;

        Ok(validation.valid)
    } else if status.as_u16() == 401 {
        Ok(false) // License is invalid
    } else {
        // Server errors should not invalidate license (grace period)
        Err(format!("Server error during validation: {status}"))
    }
}

/// Deactivate a license key online
pub async fn deactivate_online(key: &str, machine_id: &str) -> Result<(), String> {
    // Dev licenses can be deactivated locally without server call
    #[cfg(debug_assertions)]
    if key.starts_with(DEV_LICENSE_PREFIX) {
        return Ok(());
    }

    deactivate_online_at(LICENSE_SERVER_URL, key, machine_id).await
}

pub(crate) async fn deactivate_online_at(
    base_url: &str,
    key: &str,
    machine_id: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let request_body = serde_json::json!({
        "key": key,
        "machine_id": machine_id,
    });

    let url = format!("{base_url}/deactivate");

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error during deactivation: {e}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        Err(format!("Deactivation failed: {status}"))
    }
}

/// Create a development license for testing purposes
/// Only accepts keys starting with "DEV-"
#[cfg(debug_assertions)]
fn create_dev_license(key: &str) -> LicenseInfo {
    LicenseInfo {
        key: key.to_string(),
        license_type: "lifetime".to_string(),
        features: vec!["pacasdb".to_string()],
        activated_at: Utc::now(),
        expires_at: None, // Dev licenses don't expire
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::signing::test_support::{sign_license, signing_key};
    use chrono::Utc;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_license(key: &str) -> LicenseInfo {
        LicenseInfo {
            key: key.to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: None,
        }
    }

    #[tokio::test]
    async fn activation_succeeds_against_signing_server() {
        let server = MockServer::start().await;
        let signing_key = signing_key(11);
        let signed_license = sign_license(&signing_key, test_license("SIGNED-OK"), "machine-a");

        Mock::given(method("POST"))
            .and(path("/activate"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "success": true,
                "license": signed_license,
            })))
            .mount(&server)
            .await;

        let activated = activate_online_at(
            &server.uri(),
            &signing_key.verifying_key(),
            "SIGNED-OK",
            "machine-a",
        )
        .await
        .expect("signed activation should pass");

        assert_eq!(activated.license_info.key, "SIGNED-OK");
        assert!(activated.signed_license.is_some());
    }

    #[tokio::test]
    async fn activation_fails_when_server_signs_with_wrong_key() {
        let server = MockServer::start().await;
        let trusted_key = signing_key(11);
        let attacker_key = signing_key(12);
        let signed_license = sign_license(&attacker_key, test_license("ATTACKER"), "machine-a");

        Mock::given(method("POST"))
            .and(path("/activate"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "success": true,
                "license": signed_license,
            })))
            .mount(&server)
            .await;

        let error = activate_online_at(
            &server.uri(),
            &trusted_key.verifying_key(),
            "ATTACKER",
            "machine-a",
        )
        .await
        .unwrap_err();

        assert!(error.contains("signature"));
    }

    #[tokio::test]
    async fn activation_maps_http_statuses() {
        let statuses = [
            (400, "Invalid license key format"),
            (401, "Invalid or expired license key"),
            (429, "Activation limit reached for this license key"),
            (500, "License server error: 500"),
        ];

        for (status, message) in statuses {
            let server = MockServer::start().await;
            let key = signing_key(11);

            Mock::given(method("POST"))
                .and(path("/activate"))
                .respond_with(ResponseTemplate::new(status))
                .mount(&server)
                .await;

            let error = activate_online_at(&server.uri(), &key.verifying_key(), "KEY", "machine-a")
                .await
                .unwrap_err();

            assert_eq!(error, message);
        }
    }

    #[tokio::test]
    async fn validate_online_returns_false_on_401() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/validate"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let valid = validate_online_at(&server.uri(), "KEY", "machine-a")
            .await
            .expect("401 maps to invalid license");

        assert!(!valid);
    }

    #[tokio::test]
    async fn deactivate_posts_key_and_machine_id() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/deactivate"))
            .and(body_json(serde_json::json!({
                "key": "KEY",
                "machine_id": "machine-a",
            })))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        deactivate_online_at(&server.uri(), "KEY", "machine-a")
            .await
            .expect("matching deactivation request should pass");
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn dev_key_activates_in_debug() {
        let key = embedded_verifying_key().expect("embedded key parses");

        let activated = activate_online_at("http://127.0.0.1:9", &key, "DEV-LOCAL", "machine-a")
            .await
            .expect("debug dev key should bypass network");

        assert_eq!(activated.license_info.key, "DEV-LOCAL");
        assert!(activated.signed_license.is_none());
    }

    #[cfg(not(debug_assertions))]
    #[tokio::test]
    async fn dev_key_rejected_in_release() {
        let server = MockServer::start().await;
        let key = embedded_verifying_key().expect("embedded key parses");

        Mock::given(method("POST"))
            .and(path("/activate"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let error = activate_online_at(&server.uri(), &key, "DEV-LOCAL", "machine-a")
            .await
            .unwrap_err();

        assert!(error.contains("Invalid or expired"));
        assert!(!crate::license::signing::EMBEDDED_PUBLIC_KEY_B64.is_empty());
    }
}
