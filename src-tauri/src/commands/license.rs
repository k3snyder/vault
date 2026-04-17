/// Tauri commands for license management
///
/// Exposes license operations to the frontend through Tauri's IPC bridge
use crate::license::{
    activate_online, check_trial, deactivate_online, delete_license, get_machine_fingerprint,
    load_license, start_trial, store_license, LicenseInfo, LicenseStatus,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseStatusResponse {
    pub status: String, // "unlicensed", "trial", "licensed", "expired", "graceperiod", "invalid"
    pub key: Option<String>,
    pub license_type: Option<String>,
    pub features: Vec<String>,
    pub activated_at: Option<String>,
    pub expires_at: Option<String>,
    pub days_remaining: Option<i64>,
}

impl From<LicenseStatus> for LicenseStatusResponse {
    fn from(status: LicenseStatus) -> Self {
        let status_str = match status {
            LicenseStatus::Unlicensed => "unlicensed",
            LicenseStatus::Trial => "trial",
            LicenseStatus::Licensed => "licensed",
            LicenseStatus::Expired => "expired",
            LicenseStatus::GracePeriod => "graceperiod",
            LicenseStatus::Invalid => "invalid",
        };

        LicenseStatusResponse {
            status: status_str.to_string(),
            key: None,
            license_type: None,
            features: Vec::new(),
            activated_at: None,
            expires_at: None,
            days_remaining: None,
        }
    }
}

/// Get current license status
#[tauri::command]
pub async fn get_license_status() -> Result<LicenseStatusResponse, String> {
    let machine_id = get_machine_fingerprint()?;

    // Try to load existing license
    if let Some(license_info) = load_license(&machine_id)? {
        // Calculate days remaining if expires_at is set
        let days_remaining = license_info.expires_at.as_ref().map(|expires| {
            let now = chrono::Utc::now();
            let duration = expires.signed_duration_since(now);
            duration.num_days()
        });

        let status = if license_info.license_type == "trial" {
            if let Some(days) = days_remaining {
                if days <= 0 {
                    LicenseStatus::Expired
                } else {
                    LicenseStatus::Trial
                }
            } else {
                LicenseStatus::Trial
            }
        } else {
            LicenseStatus::Licensed
        };

        let mut response = LicenseStatusResponse::from(status);
        response.key = Some(license_info.key);
        response.license_type = Some(license_info.license_type);
        response.features = license_info.features;
        response.activated_at = Some(license_info.activated_at.to_rfc3339());
        response.expires_at = license_info.expires_at.map(|e| e.to_rfc3339());
        response.days_remaining = days_remaining;

        return Ok(response);
    }

    // No license found
    let status = check_trial()?;
    Ok(LicenseStatusResponse::from(status))
}

/// Start a trial period
#[tauri::command(rename_all = "snake_case")]
pub async fn start_trial_cmd() -> Result<LicenseStatusResponse, String> {
    let status = start_trial()?;
    Ok(LicenseStatusResponse::from(status))
}

/// Activate a license key
#[tauri::command(rename_all = "snake_case")]
pub async fn activate_license(key: String) -> Result<LicenseStatusResponse, String> {
    let machine_id = get_machine_fingerprint()?;

    // Activate online
    let license_info = activate_online(&key, &machine_id).await?;

    // Store in keychain
    store_license(&machine_id, &license_info)?;

    // Return status
    let mut response = LicenseStatusResponse::from(LicenseStatus::Licensed);
    response.key = Some(license_info.key);
    response.license_type = Some(license_info.license_type);
    response.features = license_info.features;
    response.activated_at = Some(license_info.activated_at.to_rfc3339());
    response.expires_at = license_info.expires_at.map(|e| e.to_rfc3339());

    Ok(response)
}

/// Deactivate current license
#[tauri::command(rename_all = "snake_case")]
pub async fn deactivate_license() -> Result<(), String> {
    let machine_id = get_machine_fingerprint()?;

    // Load current license
    if let Some(license_info) = load_license(&machine_id)? {
        // Deactivate online
        deactivate_online(&license_info.key, &machine_id).await?;

        // Delete from keychain
        delete_license(&machine_id)?;

        Ok(())
    } else {
        Err("No license to deactivate".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_license_status_unlicensed() {
        // Clean up any existing license
        let machine_id = get_machine_fingerprint().unwrap();
        let _ = delete_license(&machine_id);

        // Get status
        let result = get_license_status().await;
        assert!(result.is_ok());

        let status = result.unwrap();
        assert_eq!(status.status, "unlicensed");
        assert!(status.key.is_none());
    }

    #[tokio::test]
    async fn test_get_license_status_trial() {
        // Clean up
        let machine_id = get_machine_fingerprint().unwrap();
        let _ = delete_license(&machine_id);

        // Start trial
        let _ = start_trial_cmd().await.unwrap();

        // Get status
        let result = get_license_status().await;
        assert!(result.is_ok());

        let status = result.unwrap();
        assert_eq!(status.status, "trial");
        assert!(status.days_remaining.is_some());

        // Cleanup
        let _ = delete_license(&machine_id);
    }

    #[tokio::test]
    async fn test_start_trial_success() {
        // Clean up
        let machine_id = get_machine_fingerprint().unwrap();
        let _ = delete_license(&machine_id);

        // Start trial
        let result = start_trial_cmd().await;
        assert!(result.is_ok());

        let status = result.unwrap();
        assert_eq!(status.status, "trial");

        // Cleanup
        let _ = delete_license(&machine_id);
    }

    #[tokio::test]
    async fn test_deactivate_license() {
        // This test would require a valid license to deactivate
        // For now, test the error path
        let machine_id = get_machine_fingerprint().unwrap();
        let _ = delete_license(&machine_id);

        let result = deactivate_license().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No license"));
    }

    // Note: test_activate_license_success and test_activate_license_invalid_key
    // would require a mock license server, which is beyond the scope of unit tests
}
