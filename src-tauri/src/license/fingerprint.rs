/// Machine fingerprinting module for license validation
///
/// Generates a stable, hardware-based identifier for the current machine
/// using CPU ID, system board serial, and system UUID.
use sha2::{Digest, Sha256};

/// Generate a stable machine fingerprint
///
/// Returns a 16-character hex string derived from hardware identifiers.
/// The fingerprint is consistent across reboots and OS reinstalls.
pub fn get_machine_fingerprint() -> Result<String, String> {
    // Get machine UID using the machine-uid crate
    // This uses hardware identifiers like CPU ID, system board serial, etc.
    let machine_id = machine_uid::get().map_err(|e| format!("Failed to get machine UID: {}", e))?;

    // Hash the machine ID with SHA-256 for stability and privacy
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    let hash_result = hasher.finalize();

    // Convert to hex string and take first 16 characters
    let hex_string = format!("{:x}", hash_result);
    let fingerprint = hex_string.chars().take(16).collect::<String>();

    Ok(fingerprint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_machine_fingerprint_consistent() {
        // Machine fingerprint should be identical across multiple calls
        let fingerprint1 = get_machine_fingerprint().expect("Failed to get machine fingerprint");
        let fingerprint2 = get_machine_fingerprint().expect("Failed to get machine fingerprint");
        let fingerprint3 = get_machine_fingerprint().expect("Failed to get machine fingerprint");

        assert_eq!(
            fingerprint1, fingerprint2,
            "Fingerprint should be consistent"
        );
        assert_eq!(
            fingerprint2, fingerprint3,
            "Fingerprint should be consistent"
        );
    }

    #[test]
    fn test_fingerprint_format() {
        // Fingerprint should be exactly 16 characters of lowercase hexadecimal
        let fingerprint = get_machine_fingerprint().expect("Failed to get machine fingerprint");

        assert_eq!(fingerprint.len(), 16, "Fingerprint should be 16 characters");

        // Check that all characters are valid hex (0-9, a-f)
        for c in fingerprint.chars() {
            assert!(
                c.is_ascii_hexdigit() && (c.is_ascii_digit() || c.is_ascii_lowercase()),
                "Fingerprint should only contain lowercase hex characters, found: {}",
                c
            );
        }
    }

    #[test]
    fn test_fingerprint_not_empty() {
        // Fingerprint should never be empty
        let fingerprint = get_machine_fingerprint().expect("Failed to get machine fingerprint");

        assert!(!fingerprint.is_empty(), "Fingerprint should not be empty");
        assert!(
            fingerprint.len() > 0,
            "Fingerprint should have positive length"
        );
    }
}
