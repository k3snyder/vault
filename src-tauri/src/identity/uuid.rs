use anyhow::Result;
use parking_lot::Mutex;
use uuid::Uuid;

pub struct UuidGenerator {
    last_timestamp: Mutex<u64>,
    counter: Mutex<u16>,
}

impl UuidGenerator {
    pub fn new() -> Self {
        Self {
            last_timestamp: Mutex::new(0),
            counter: Mutex::new(0),
        }
    }

    pub fn generate(&self) -> Result<String> {
        // Generate UUIDv7 with timestamp
        let uuid = Uuid::now_v7();
        Ok(uuid.to_string())
    }

    pub fn generate_with_timestamp(&self, timestamp_ms: u64) -> Result<String> {
        // For testing - generate UUID with specific timestamp
        let timestamp = timestamp_ms / 1000;
        let nanos = ((timestamp_ms % 1000) * 1_000_000) as u32;

        let uuid = Uuid::new_v7(uuid::Timestamp::from_unix(
            uuid::NoContext,
            timestamp,
            nanos,
        ));

        Ok(uuid.to_string())
    }

    pub fn extract_timestamp(&self, uuid_str: &str) -> Result<u64> {
        let uuid = Uuid::parse_str(uuid_str)?;

        // Extract timestamp from UUIDv7
        if let Some(ts) = uuid.get_timestamp() {
            let (seconds, nanos) = ts.to_unix();
            Ok(seconds * 1000 + (nanos as u64 / 1_000_000))
        } else {
            anyhow::bail!("UUID does not contain a timestamp")
        }
    }

    pub fn is_valid_uuid(&self, uuid_str: &str) -> bool {
        Uuid::parse_str(uuid_str).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Arc;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_uuid_generation() {
        let generator = UuidGenerator::new();
        let uuid = generator.generate().unwrap();

        assert!(generator.is_valid_uuid(&uuid));
        assert_eq!(uuid.len(), 36); // Standard UUID string length
    }

    #[test]
    fn test_uuid_uniqueness() {
        let generator = UuidGenerator::new();
        let mut uuids = HashSet::new();

        for _ in 0..1000 {
            let uuid = generator.generate().unwrap();
            assert!(uuids.insert(uuid), "Duplicate UUID generated");
        }
    }

    #[test]
    fn test_uuid_timestamp_extraction() {
        let generator = UuidGenerator::new();
        let before = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let uuid = generator.generate().unwrap();

        let after = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let extracted = generator.extract_timestamp(&uuid).unwrap();

        assert!(extracted >= before);
        assert!(extracted <= after);
    }

    #[test]
    fn test_concurrent_generation() {
        let generator = Arc::new(UuidGenerator::new());
        let mut handles = vec![];
        let uuids = Arc::new(Mutex::new(HashSet::new()));

        for _ in 0..10 {
            let gen = generator.clone();
            let uuids_clone = uuids.clone();

            let handle = thread::spawn(move || {
                for _ in 0..100 {
                    let uuid = gen.generate().unwrap();
                    uuids_clone.lock().insert(uuid);
                }
            });

            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(
            uuids.lock().len(),
            1000,
            "Should generate 1000 unique UUIDs"
        );
    }

    #[test]
    fn test_uuid_validation() {
        let generator = UuidGenerator::new();

        assert!(generator.is_valid_uuid("550e8400-e29b-41d4-a716-446655440000"));
        assert!(!generator.is_valid_uuid("invalid-uuid"));
        assert!(!generator.is_valid_uuid(""));
        assert!(!generator.is_valid_uuid("550e8400-e29b-41d4-a716"));
    }

    #[test]
    fn test_generate_with_timestamp() {
        let generator = UuidGenerator::new();
        let timestamp_ms = 1704067200000u64; // 2024-01-01 00:00:00 UTC

        let uuid = generator.generate_with_timestamp(timestamp_ms).unwrap();
        let extracted = generator.extract_timestamp(&uuid).unwrap();

        // Allow small difference due to precision
        assert!((extracted as i64 - timestamp_ms as i64).abs() < 1000);
    }
}
