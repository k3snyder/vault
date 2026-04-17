use super::FileMetadata;
use chrono::Utc;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Cache for recently deleted files to support rename detection
pub struct DeletionCache {
    entries: HashMap<PathBuf, FileMetadata>,
    order: VecDeque<PathBuf>,
    max_size: usize,
    ttl_ms: u64,
}

impl DeletionCache {
    pub fn new(max_size: usize, ttl_ms: u64) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            max_size,
            ttl_ms,
        }
    }

    /// Add a deleted file to the cache
    pub fn add(&mut self, metadata: FileMetadata) {
        let path = metadata.path.clone();

        // Remove old entry if it exists
        if self.entries.contains_key(&path) {
            self.order.retain(|p| p != &path);
        }

        // Evict oldest if at capacity
        while self.order.len() >= self.max_size {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }

        // Add new entry
        self.entries.insert(path.clone(), metadata);
        self.order.push_back(path);

        // Clean expired entries
        self.clean_expired();
    }

    /// Find a possible rename candidate based on file size and time window
    pub fn find_possible_rename(
        &mut self,
        new_path: &Path,
        size: Option<u64>,
    ) -> Option<FileMetadata> {
        self.clean_expired();

        let now = Utc::now();
        let mut best_match: Option<(&PathBuf, &FileMetadata, f64)> = None;

        for (path, metadata) in &self.entries {
            // Skip if outside time window
            let time_diff = now.signed_duration_since(metadata.deleted_at);
            if time_diff.num_milliseconds() as u64 > self.ttl_ms {
                continue;
            }

            // Calculate match score
            let mut score = 0.0;

            // Time proximity (closer in time = higher score)
            let time_factor = 1.0 - (time_diff.num_milliseconds() as f64 / self.ttl_ms as f64);
            score += time_factor * 0.5;

            // Same directory bonus
            if path.parent() == new_path.parent() {
                score += 0.2;
            }

            // Same size is strong indicator
            if let (Some(old_size), Some(new_size)) = (metadata.size, size) {
                if old_size == new_size {
                    score += 0.3;
                } else {
                    // Partial score for similar sizes (within 10%)
                    let size_diff = (old_size as f64 - new_size as f64).abs();
                    let max_size = old_size.max(new_size) as f64;
                    if size_diff / max_size < 0.1 {
                        score += 0.15;
                    }
                }
            }

            // Update best match if this scores higher
            if best_match.is_none() || best_match.as_ref().unwrap().2 < score {
                best_match = Some((path, metadata, score));
            }
        }

        // Return best match if score is high enough (threshold: 0.5)
        if let Some((path, metadata, score)) = best_match {
            if score >= 0.5 {
                let path_to_remove = path.clone();
                let result = metadata.clone();
                // Remove from cache since we're using it
                self.remove(&path_to_remove);
                return Some(result);
            }
        }
        None
    }

    /// Remove a specific path from the cache
    pub fn remove(&mut self, path: &Path) -> Option<FileMetadata> {
        self.order.retain(|p| p != path);
        self.entries.remove(path)
    }

    /// Clean expired entries based on TTL
    fn clean_expired(&mut self) {
        let now = Utc::now();
        let ttl_duration = Duration::from_millis(self.ttl_ms);

        // Collect paths to remove (to avoid borrow issues)
        let to_remove: Vec<PathBuf> = self
            .entries
            .iter()
            .filter(|(_, metadata)| {
                let age = now.signed_duration_since(metadata.deleted_at);
                age.to_std().unwrap_or(Duration::ZERO) > ttl_duration
            })
            .map(|(path, _)| path.clone())
            .collect();

        // Remove expired entries
        for path in to_remove {
            self.remove(&path);
        }
    }

    /// Get the current size of the cache
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the cache is empty
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Clear all entries from the cache
    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn create_test_metadata(path: &str, size: u64) -> FileMetadata {
        FileMetadata {
            path: PathBuf::from(path),
            id: "test-uuid".to_string(),
            deleted_at: Utc::now(),
            size: Some(size),
            fingerprint: Some(format!("md-{}", size)),
        }
    }

    #[test]
    fn test_add_and_retrieve() {
        let mut cache = DeletionCache::new(10, 5000);
        let metadata = create_test_metadata("/test/file.md", 1024);

        cache.add(metadata.clone());
        assert_eq!(cache.len(), 1);

        // Should find with same size
        let found = cache.find_possible_rename(&PathBuf::from("/test/renamed.md"), Some(1024));
        assert!(found.is_some());
        assert_eq!(found.unwrap().path, PathBuf::from("/test/file.md"));

        // Should be removed after finding
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_max_size_eviction() {
        let mut cache = DeletionCache::new(2, 5000);

        cache.add(create_test_metadata("/file1.md", 100));
        cache.add(create_test_metadata("/file2.md", 200));
        cache.add(create_test_metadata("/file3.md", 300));

        // Should only have 2 entries (file2 and file3)
        assert_eq!(cache.len(), 2);
        assert!(!cache.entries.contains_key(&PathBuf::from("/file1.md")));
        assert!(cache.entries.contains_key(&PathBuf::from("/file2.md")));
        assert!(cache.entries.contains_key(&PathBuf::from("/file3.md")));
    }

    #[test]
    fn test_same_directory_bonus() {
        let mut cache = DeletionCache::new(10, 5000);

        // Add two files with same size, different directories
        cache.add(create_test_metadata("/dir1/file.md", 1024));
        cache.add(create_test_metadata("/dir2/file.md", 1024));

        // Should prefer the one in the same directory
        let found = cache.find_possible_rename(&PathBuf::from("/dir2/renamed.md"), Some(1024));

        assert!(found.is_some());
        assert_eq!(found.unwrap().path, PathBuf::from("/dir2/file.md"));
    }

    #[test]
    fn test_size_matching() {
        let mut cache = DeletionCache::new(10, 5000);

        cache.add(create_test_metadata("/file1.md", 1000));
        cache.add(create_test_metadata("/file2.md", 1050)); // 5% difference
        cache.add(create_test_metadata("/file3.md", 2000)); // 100% difference

        // Should find close size match
        let found = cache.find_possible_rename(&PathBuf::from("/renamed.md"), Some(1025));

        assert!(found.is_some());
        // Should match file2 (1050) as it's within 10% of 1025
        let metadata = found.unwrap();
        assert!(
            metadata.path == PathBuf::from("/file1.md")
                || metadata.path == PathBuf::from("/file2.md")
        );
    }

    #[test]
    fn test_remove() {
        let mut cache = DeletionCache::new(10, 5000);
        let metadata = create_test_metadata("/test.md", 1024);

        cache.add(metadata.clone());
        assert_eq!(cache.len(), 1);

        let removed = cache.remove(&PathBuf::from("/test.md"));
        assert!(removed.is_some());
        assert_eq!(cache.len(), 0);

        let removed_again = cache.remove(&PathBuf::from("/test.md"));
        assert!(removed_again.is_none());
    }

    #[test]
    fn test_clear() {
        let mut cache = DeletionCache::new(10, 5000);

        cache.add(create_test_metadata("/file1.md", 100));
        cache.add(create_test_metadata("/file2.md", 200));
        assert_eq!(cache.len(), 2);

        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_score_threshold() {
        let mut cache = DeletionCache::new(10, 5000);

        // Add a file that won't match well (different size, will be old)
        let mut metadata = create_test_metadata("/old/file.md", 5000);
        metadata.deleted_at = Utc::now() - chrono::Duration::milliseconds(4000);
        cache.add(metadata);

        // Should not find match due to low score (different size, old, different dir)
        let found = cache.find_possible_rename(&PathBuf::from("/new/renamed.md"), Some(100));

        assert!(found.is_none());
    }
}
