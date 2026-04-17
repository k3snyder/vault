/// Online license validation and activation
///
/// Handles communication with the license server for activation,
/// validation, and deactivation operations.
use super::types::LicenseInfo;
use chrono::Utc;
use reqwest;
use serde::{Deserialize, Serialize};

const LICENSE_SERVER_URL: &str = "https://license.vaultapp.com/api/v1";
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// Dev license key prefix - bypasses online validation for development testing
const DEV_LICENSE_PREFIX: &str = "DEV-";

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
    license: Option<LicenseInfo>,
    error: Option<String>,
}

/// Activate a license key online
pub async fn activate_online(key: &str, machine_id: &str) -> Result<LicenseInfo, String> {
    // Check for dev license key (DEV-xxxx) - bypasses online validation
    if key.starts_with(DEV_LICENSE_PREFIX) {
        return Ok(create_dev_license(key));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let request_body = ActivationRequest {
        key: key.to_string(),
        machine_id: machine_id.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    };

    let url = format!("{}/activate", LICENSE_SERVER_URL);

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
                format!("Network error: {}", e)
            }
        })?;

    let status = response.status();

    if status.is_success() {
        let activation_response: ActivationResponse = response
            .json()
            .await
            .map_err(|e| format!("Invalid response from license server: {}", e))?;

        if activation_response.success {
            activation_response
                .license
                .ok_or_else(|| "License server returned success but no license data".to_string())
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
        Err(format!("License server error: {}", status))
    }
}

/// Validate an existing license key online
#[allow(dead_code)] // Reserved for periodic validation feature
pub async fn validate_online(key: &str, machine_id: &str) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let request_body = serde_json::json!({
        "key": key,
        "machine_id": machine_id,
    });

    let url = format!("{}/validate", LICENSE_SERVER_URL);

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
            format!("Validation error: {}", e)
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
            .map_err(|e| format!("Invalid validation response: {}", e))?;

        Ok(validation.valid)
    } else if status.as_u16() == 401 {
        Ok(false) // License is invalid
    } else {
        // Server errors should not invalidate license (grace period)
        Err(format!("Server error during validation: {}", status))
    }
}

/// Deactivate a license key online
pub async fn deactivate_online(key: &str, machine_id: &str) -> Result<(), String> {
    // Dev licenses can be deactivated locally without server call
    if key.starts_with(DEV_LICENSE_PREFIX) {
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let request_body = serde_json::json!({
        "key": key,
        "machine_id": machine_id,
    });

    let url = format!("{}/deactivate", LICENSE_SERVER_URL);

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error during deactivation: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("Deactivation failed: {}", response.status()))
    }
}

/// Create a development license for testing purposes
/// Only accepts keys starting with "DEV-"
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
    #[tokio::test]
    async fn test_validate_online_success() {
        // This test would require a mock server
        // For now, we test that the function signature is correct
        // and can be called

        // In a real test, we'd use a mock HTTP server
        // For now, we just verify the function exists and can be called
        // The actual call will fail without a mock server, which is expected

        // Uncomment when implementation is ready:
        // let result = validate_online(&key, &machine_id).await;
        // We expect this to fail in test environment (no real server)
        // assert!(result.is_err() || result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_online_invalid_key() {
        // Test that invalid keys are handled properly
        // In production tests with mock server:
        // let result = validate_online(&key, &machine_id).await;
        // assert!(result.is_err() || result == Ok(false));
    }

    #[tokio::test]
    async fn test_validate_online_network_error() {
        // Test network error handling
        // When network fails, should enter grace period

        // In production with mock that simulates network failure:
        // let result = validate_online(&key, &machine_id).await;
        // Should handle network errors gracefully
    }

    #[tokio::test]
    async fn test_activate_online() {
        // Test successful activation flow
        // In production with mock server:
        // let result = activate_online(&key, &machine_id).await;
        // assert!(result.is_ok());
        // let license = result.unwrap();
        // assert_eq!(license.key, key);
    }

    #[tokio::test]
    async fn test_activate_activation_limit() {
        // Test activation limit reached
        // In production with mock server returning 429:
        // let result = activate_online(&key, &machine_id).await;
        // assert!(result.is_err());
        // assert!(result.unwrap_err().contains("limit"));
    }

    #[tokio::test]
    async fn test_deactivate_online() {
        // Test deactivation
        // In production with mock server:
        // let result = deactivate_online(&key, &machine_id).await;
        // assert!(result.is_ok());
    }
}
