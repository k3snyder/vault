use crate::identity::NoteIdentity;
use lru::LruCache;
use std::num::NonZeroUsize;
use std::path::PathBuf;

pub struct IdentityCache {
    cache: LruCache<PathBuf, NoteIdentity>,
}

impl IdentityCache {
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(10000).unwrap());
        Self {
            cache: LruCache::new(cap),
        }
    }

    pub fn insert(&mut self, path: PathBuf, identity: NoteIdentity) {
        self.cache.put(path, identity);
    }

    pub fn get(&mut self, path: &PathBuf) -> Option<NoteIdentity> {
        self.cache.get(path).cloned()
    }

    pub fn remove(&mut self, path: &PathBuf) -> Option<NoteIdentity> {
        self.cache.pop(path)
    }

    pub fn clear(&mut self) {
        self.cache.clear();
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_cache_basic_operations() {
        let mut cache = IdentityCache::new(3);

        let identity1 = NoteIdentity {
            id: "uuid1".to_string(),
            path: PathBuf::from("note1.md"),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let identity2 = NoteIdentity {
            id: "uuid2".to_string(),
            path: PathBuf::from("note2.md"),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        cache.insert(PathBuf::from("note1.md"), identity1.clone());
        cache.insert(PathBuf::from("note2.md"), identity2.clone());

        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get(&PathBuf::from("note1.md")).unwrap().id, "uuid1");
        assert_eq!(cache.get(&PathBuf::from("note2.md")).unwrap().id, "uuid2");
    }

    #[test]
    fn test_cache_lru_eviction() {
        let mut cache = IdentityCache::new(2);

        let identity1 = NoteIdentity {
            id: "uuid1".to_string(),
            path: PathBuf::from("note1.md"),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let identity2 = NoteIdentity {
            id: "uuid2".to_string(),
            path: PathBuf::from("note2.md"),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let identity3 = NoteIdentity {
            id: "uuid3".to_string(),
            path: PathBuf::from("note3.md"),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        cache.insert(PathBuf::from("note1.md"), identity1);
        cache.insert(PathBuf::from("note2.md"), identity2);
        cache.insert(PathBuf::from("note3.md"), identity3);

        assert_eq!(cache.len(), 2);
        assert!(cache.get(&PathBuf::from("note1.md")).is_none()); // Evicted
        assert!(cache.get(&PathBuf::from("note2.md")).is_some());
        assert!(cache.get(&PathBuf::from("note3.md")).is_some());
    }

    #[test]
    fn test_cache_remove() {
        let mut cache = IdentityCache::new(5);

        let identity = NoteIdentity {
            id: "uuid1".to_string(),
            path: PathBuf::from("note1.md"),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        cache.insert(PathBuf::from("note1.md"), identity.clone());
        assert_eq!(cache.len(), 1);

        let removed = cache.remove(&PathBuf::from("note1.md"));
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, "uuid1");
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_clear() {
        let mut cache = IdentityCache::new(5);

        for i in 0..3 {
            let identity = NoteIdentity {
                id: format!("uuid{}", i),
                path: PathBuf::from(format!("note{}.md", i)),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            };
            cache.insert(PathBuf::from(format!("note{}.md", i)), identity);
        }

        assert_eq!(cache.len(), 3);
        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }
}
