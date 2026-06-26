//! App-local secret obfuscation helpers.
//!
//! Secrets are AES-256-GCM encrypted with keys derived from app-local salts and
//! stored inside the app's own Application Support files. This protects against
//! casual file reads (greps, backup scans), not against a local attacker who can
//! also read the app binary. Deliberate product decision: Vault must never read
//! from or write to the OS keychain.

use aes_gcm::aead::OsRng;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Derive a 32-byte key from an app-local salt and a context string
/// (product name, plugin id, ...).
pub fn derive_key(salt: &[u8], context: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(context.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// Encrypt a string with AES-256-GCM; output is base64(nonce || ciphertext).
pub fn encrypt_string(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let mut combined = Vec::new();
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(general_purpose::STANDARD.encode(&combined))
}

/// Decrypt a base64(nonce || ciphertext) string produced by [`encrypt_string`].
pub fn decrypt_string(encrypted: &str, key: &[u8; 32]) -> Result<String, String> {
    let combined = general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {e}"))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {e}"))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {e}"))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = derive_key(b"test_salt", "context");
        let encrypted = encrypt_string("secret-value", &key).expect("encrypt");
        assert_eq!(
            decrypt_string(&encrypted, &key).expect("decrypt"),
            "secret-value"
        );
    }

    #[test]
    fn derive_key_is_deterministic_and_context_sensitive() {
        assert_eq!(derive_key(b"salt", "a"), derive_key(b"salt", "a"));
        assert_ne!(derive_key(b"salt", "a"), derive_key(b"salt", "b"));
        assert_ne!(derive_key(b"salt1", "a"), derive_key(b"salt2", "a"));
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let encrypted = encrypt_string("secret-value", &derive_key(b"salt", "a")).expect("encrypt");
        assert!(decrypt_string(&encrypted, &derive_key(b"salt", "b")).is_err());
    }
}
