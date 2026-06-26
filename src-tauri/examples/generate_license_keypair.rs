use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

fn main() {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    println!(
        "LICENSE_PRIVATE_KEY_B64={}",
        general_purpose::STANDARD.encode(signing_key.to_bytes())
    );
    println!(
        "LICENSE_PUBLIC_KEY_B64={}",
        general_purpose::STANDARD.encode(verifying_key.to_bytes())
    );
}
