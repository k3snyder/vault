use super::types::LicenseInfo;
use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

pub const EMBEDDED_PUBLIC_KEY_B64: &str = "WfMqn6FZR/BE8mCGWGcMZ/rmEEyhmGLbAV7q/wzu0qw=";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedLicense {
    pub payload: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    pub license: LicenseInfo,
    pub machine_id: String,
    pub issued_at: DateTime<Utc>,
}

pub fn embedded_verifying_key() -> Result<VerifyingKey, String> {
    verifying_key_from_base64(EMBEDDED_PUBLIC_KEY_B64)
}

pub fn verifying_key_from_base64(encoded: &str) -> Result<VerifyingKey, String> {
    let key_bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid license public key encoding: {e}"))?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| "License public key must be 32 bytes".to_string())?;

    VerifyingKey::from_bytes(&key_bytes).map_err(|e| format!("Invalid license public key: {e}"))
}

pub fn verify_signed_license(
    signed_license: &SignedLicense,
    verifying_key: &VerifyingKey,
    expected_machine_id: &str,
) -> Result<LicenseInfo, String> {
    let payload_bytes = general_purpose::STANDARD
        .decode(&signed_license.payload)
        .map_err(|e| format!("Invalid license payload encoding: {e}"))?;
    let signature_bytes = general_purpose::STANDARD
        .decode(&signed_license.signature)
        .map_err(|e| format!("Invalid license signature encoding: {e}"))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|e| format!("Invalid license signature shape: {e}"))?;

    verifying_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| {
            "License response failed signature verification - refusing to activate".to_string()
        })?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("Invalid signed license payload: {e}"))?;

    if payload.machine_id != expected_machine_id {
        return Err("Signed license is bound to a different machine".to_string());
    }

    Ok(payload.license)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    pub(crate) fn signing_key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    pub(crate) fn sign_license(
        signing_key: &SigningKey,
        license: LicenseInfo,
        machine_id: &str,
    ) -> SignedLicense {
        let payload = LicensePayload {
            license,
            machine_id: machine_id.to_string(),
            issued_at: Utc::now(),
        };
        let payload_bytes = serde_json::to_vec(&payload).expect("license payload serializes");
        let signature = signing_key.sign(&payload_bytes);

        SignedLicense {
            payload: general_purpose::STANDARD.encode(payload_bytes),
            signature: general_purpose::STANDARD.encode(signature.to_bytes()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{sign_license, signing_key};
    use super::*;

    fn test_license() -> LicenseInfo {
        LicenseInfo {
            key: "SIGNED-KEY".to_string(),
            license_type: "lifetime".to_string(),
            features: vec!["pacasdb".to_string()],
            activated_at: Utc::now(),
            expires_at: None,
        }
    }

    #[test]
    fn verify_accepts_correctly_signed_payload() {
        let key = signing_key(7);
        let signed = sign_license(&key, test_license(), "machine-a");

        let verified =
            verify_signed_license(&signed, &key.verifying_key(), "machine-a").expect("valid");

        assert_eq!(verified.key, "SIGNED-KEY");
        assert_eq!(verified.license_type, "lifetime");
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let key = signing_key(7);
        let mut signed = sign_license(&key, test_license(), "machine-a");
        let mut payload = general_purpose::STANDARD
            .decode(&signed.payload)
            .expect("payload decodes");
        let last = payload.len() - 1;
        payload[last] ^= 1;
        signed.payload = general_purpose::STANDARD.encode(payload);

        let result = verify_signed_license(&signed, &key.verifying_key(), "machine-a");

        assert!(result.unwrap_err().contains("signature"));
    }

    #[test]
    fn verify_rejects_wrong_key() {
        let trusted_key = signing_key(7);
        let attacker_key = signing_key(8);
        let signed = sign_license(&attacker_key, test_license(), "machine-a");

        let result = verify_signed_license(&signed, &trusted_key.verifying_key(), "machine-a");

        assert!(result.unwrap_err().contains("signature"));
    }

    #[test]
    fn verify_rejects_machine_id_mismatch() {
        let key = signing_key(7);
        let signed = sign_license(&key, test_license(), "machine-a");

        let result = verify_signed_license(&signed, &key.verifying_key(), "machine-b");

        assert!(result.unwrap_err().contains("different machine"));
    }

    #[test]
    fn embedded_public_key_is_valid() {
        let key = embedded_verifying_key().expect("embedded key must parse");

        assert_eq!(key.to_bytes().len(), 32);
    }
}
