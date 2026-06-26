use chrono::{DateTime, Utc};
/// License type definitions for PacasDB Premium
///
/// Defines the core types for license management including status tracking
/// and license information storage.
use serde::{Deserialize, Serialize};

/// License status representing the current entitlement state
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LicenseStatus {
    /// No license or trial active
    Unlicensed,
    /// Trial period active (within 30 days)
    Trial,
    /// Valid paid license active
    Licensed,
    /// License has expired
    Expired,
    /// Grace period after expiration (30 days)
    GracePeriod,
    /// License is invalid or corrupted
    Invalid,
}

/// Complete license information including key and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    /// License key (unique identifier)
    pub key: String,
    /// Type of license (trial, lifetime, subscription)
    pub license_type: String,
    /// Enabled features (e.g., ["pacasdb", "search"])
    pub features: Vec<String>,
    /// When the license was activated on this machine
    pub activated_at: DateTime<Utc>,
    /// When the license expires (None for lifetime)
    pub expires_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_license_status_serialization() {
        // Test all variants serialize correctly
        let unlicensed = LicenseStatus::Unlicensed;
        let json = serde_json::to_string(&unlicensed).unwrap();
        assert_eq!(json, "\"unlicensed\"");

        let trial = LicenseStatus::Trial;
        let json = serde_json::to_string(&trial).unwrap();
        assert_eq!(json, "\"trial\"");

        let licensed = LicenseStatus::Licensed;
        let json = serde_json::to_string(&licensed).unwrap();
        assert_eq!(json, "\"licensed\"");

        let expired = LicenseStatus::Expired;
        let json = serde_json::to_string(&expired).unwrap();
        assert_eq!(json, "\"expired\"");

        let grace = LicenseStatus::GracePeriod;
        let json = serde_json::to_string(&grace).unwrap();
        assert_eq!(json, "\"graceperiod\"");

        let invalid = LicenseStatus::Invalid;
        let json = serde_json::to_string(&invalid).unwrap();
        assert_eq!(json, "\"invalid\"");
    }

    #[test]
    fn test_license_status_deserialization() {
        // Test all variants deserialize correctly
        let unlicensed: LicenseStatus = serde_json::from_str("\"unlicensed\"").unwrap();
        assert_eq!(unlicensed, LicenseStatus::Unlicensed);

        let trial: LicenseStatus = serde_json::from_str("\"trial\"").unwrap();
        assert_eq!(trial, LicenseStatus::Trial);

        let licensed: LicenseStatus = serde_json::from_str("\"licensed\"").unwrap();
        assert_eq!(licensed, LicenseStatus::Licensed);

        let expired: LicenseStatus = serde_json::from_str("\"expired\"").unwrap();
        assert_eq!(expired, LicenseStatus::Expired);

        let grace: LicenseStatus = serde_json::from_str("\"graceperiod\"").unwrap();
        assert_eq!(grace, LicenseStatus::GracePeriod);

        let invalid: LicenseStatus = serde_json::from_str("\"invalid\"").unwrap();
        assert_eq!(invalid, LicenseStatus::Invalid);
    }

    #[test]
    fn test_license_info_serialization() {
        let now = Utc::now();
        let expires = now + chrono::Duration::days(365);

        let info = LicenseInfo {
            key: "TEST-KEY-12345".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string(), "search".to_string()],
            activated_at: now,
            expires_at: Some(expires),
        };

        // Serialize to JSON
        let json = serde_json::to_string(&info).unwrap();

        // Should contain all fields
        assert!(json.contains("TEST-KEY-12345"));
        assert!(json.contains("lifetime"));
        assert!(json.contains("pacasdb"));
        assert!(json.contains("search"));
    }

    #[test]
    fn test_license_info_deserialization() {
        let json = r#"{
            "key": "TEST-KEY-67890",
            "license_type": "subscription",
            "features": ["pacasdb"],
            "activated_at": "2024-01-01T00:00:00Z",
            "expires_at": "2025-01-01T00:00:00Z"
        }"#;

        let info: LicenseInfo = serde_json::from_str(json).unwrap();

        assert_eq!(info.key, "TEST-KEY-67890");
        assert_eq!(info.license_type, "subscription");
        assert_eq!(info.features, vec!["pacasdb"]);
        assert!(info.expires_at.is_some());
    }

    #[test]
    fn test_license_info_lifetime_no_expiry() {
        let now = Utc::now();

        let info = LicenseInfo {
            key: "LIFETIME-KEY".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: now,
            expires_at: None, // Lifetime license never expires
        };

        let json = serde_json::to_string(&info).unwrap();
        let parsed: LicenseInfo = serde_json::from_str(&json).unwrap();

        assert!(parsed.expires_at.is_none());
        assert_eq!(parsed.license_type, "lifetime");
    }

    #[test]
    fn test_license_status_clone() {
        // Verify Clone trait works
        let status = LicenseStatus::Licensed;
        let cloned = status.clone();
        assert_eq!(status, cloned);
    }

    #[test]
    fn test_license_info_clone() {
        // Verify Clone trait works
        let now = Utc::now();
        let info = LicenseInfo {
            key: "TEST-KEY".to_string(),
            license_type: "trial".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: now,
            expires_at: Some(now + chrono::Duration::days(30)),
        };

        let cloned = info.clone();
        assert_eq!(info.key, cloned.key);
        assert_eq!(info.license_type, cloned.license_type);
    }
}
