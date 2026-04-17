use super::FileMetadata;
use chrono::Utc;
use std::path::Path;

/// Detects renames using various heuristics
pub struct RenameDetector {
    rename_window_ms: u64,
}

impl RenameDetector {
    pub fn new(rename_window_ms: u64) -> Self {
        Self { rename_window_ms }
    }

    /// Determine if a file creation is likely a rename from a deleted file
    pub fn is_likely_rename(&self, old_metadata: &FileMetadata, new_path: &Path) -> bool {
        // Calculate confidence score based on multiple factors
        let mut confidence = 0.0;

        // Time proximity - files renamed quickly are more likely to be the same
        let time_diff = Utc::now().signed_duration_since(old_metadata.deleted_at);
        let time_ms = time_diff.num_milliseconds() as u64;

        if time_ms <= self.rename_window_ms {
            // Linear decay of confidence based on time
            let time_factor = 1.0 - (time_ms as f64 / self.rename_window_ms as f64);
            confidence += time_factor * 0.4; // Time is 40% of confidence
        } else {
            // Outside time window, very unlikely to be a rename
            return false;
        }

        // Same directory - renames often stay in same directory
        if self.same_directory(&old_metadata.path, new_path) {
            confidence += 0.2; // Same directory is 20% of confidence
        }

        // Similar filename - check for common rename patterns
        if self.similar_filename(&old_metadata.path, new_path) {
            confidence += 0.2; // Similar name is 20% of confidence
        }

        // Same extension - files usually keep their type
        if self.same_extension(&old_metadata.path, new_path) {
            confidence += 0.1; // Same extension is 10% of confidence
        }

        // Same fingerprint (size/type) - strong indicator
        if old_metadata.fingerprint.is_some() {
            // Fingerprint match would add significant confidence
            // This would require calculating fingerprint for new file
            confidence += 0.1; // Fingerprint similarity is 10% of confidence
        }

        // Threshold for considering it a rename
        confidence >= 0.6
    }

    /// Check if two paths are in the same directory
    fn same_directory(&self, path1: &Path, path2: &Path) -> bool {
        path1.parent() == path2.parent()
    }

    /// Check if two filenames are similar (edit distance, common patterns)
    fn similar_filename(&self, path1: &Path, path2: &Path) -> bool {
        let name1 = path1.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let name2 = path2.file_stem().and_then(|s| s.to_str()).unwrap_or("");

        // Check for common rename patterns
        self.is_backup_pattern(name1, name2)
            || self.is_temp_pattern(name1, name2)
            || self.is_versioned_pattern(name1, name2)
            || self.levenshtein_similar(name1, name2)
    }

    /// Check if filenames follow backup pattern (file -> file.bak, file~ -> file)
    fn is_backup_pattern(&self, name1: &str, name2: &str) -> bool {
        name2.starts_with(name1) && (name2.ends_with(".bak") || name2.ends_with("~"))
            || name1.starts_with(name2) && (name1.ends_with(".bak") || name1.ends_with("~"))
    }

    /// Check if filenames follow temp file pattern
    fn is_temp_pattern(&self, name1: &str, name2: &str) -> bool {
        // VSCode pattern: .tmp123 -> realname
        (name1.starts_with('.') && name1.contains("tmp")) ||
        (name2.starts_with('.') && name2.contains("tmp")) ||
        // Vim pattern: .swp, .swo files
        name1.ends_with(".swp") || name2.ends_with(".swp") ||
        name1.ends_with(".swo") || name2.ends_with(".swo")
    }

    /// Check if filenames follow versioning pattern (file -> file_v2, file_1 -> file_2)
    fn is_versioned_pattern(&self, name1: &str, name2: &str) -> bool {
        // Remove version suffixes and compare
        let base1 = self.remove_version_suffix(name1);
        let base2 = self.remove_version_suffix(name2);

        !base1.is_empty() && base1 == base2
    }

    /// Remove common version suffixes from filename
    fn remove_version_suffix<'a>(&self, name: &'a str) -> &'a str {
        // Remove patterns like _v1, _v2, (1), (2), _1, _2
        if let Some(idx) = name.rfind('_') {
            let suffix = &name[idx + 1..];
            if suffix.starts_with('v') || suffix.chars().all(|c| c.is_numeric()) {
                return &name[..idx];
            }
        }

        if let Some(idx) = name.rfind('(') {
            if let Some(end_idx) = name.rfind(')') {
                if end_idx > idx {
                    let between = &name[idx + 1..end_idx];
                    if between.chars().all(|c| c.is_numeric()) {
                        return &name[..idx].trim_end();
                    }
                }
            }
        }

        name
    }

    /// Check if two strings are similar using Levenshtein distance
    fn levenshtein_similar(&self, s1: &str, s2: &str) -> bool {
        let distance = self.levenshtein_distance(s1, s2);
        let max_len = s1.len().max(s2.len());

        if max_len == 0 {
            return true;
        }

        // Consider similar if edit distance is less than 30% of string length
        (distance as f64) / (max_len as f64) < 0.3
    }

    /// Calculate Levenshtein distance between two strings
    fn levenshtein_distance(&self, s1: &str, s2: &str) -> usize {
        let len1 = s1.chars().count();
        let len2 = s2.chars().count();

        if len1 == 0 {
            return len2;
        }
        if len2 == 0 {
            return len1;
        }

        let s1_chars: Vec<char> = s1.chars().collect();
        let s2_chars: Vec<char> = s2.chars().collect();

        let mut prev_row: Vec<usize> = (0..=len2).collect();
        let mut curr_row = vec![0; len2 + 1];

        for i in 1..=len1 {
            curr_row[0] = i;
            for j in 1..=len2 {
                let cost = if s1_chars[i - 1] == s2_chars[j - 1] {
                    0
                } else {
                    1
                };
                curr_row[j] = [
                    prev_row[j] + 1,        // deletion
                    curr_row[j - 1] + 1,    // insertion
                    prev_row[j - 1] + cost, // substitution
                ]
                .into_iter()
                .min()
                .unwrap();
            }
            std::mem::swap(&mut prev_row, &mut curr_row);
        }

        prev_row[len2]
    }

    /// Check if two paths have the same extension
    fn same_extension(&self, path1: &Path, path2: &Path) -> bool {
        path1.extension() == path2.extension()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_same_directory() {
        let detector = RenameDetector::new(500);
        let path1 = PathBuf::from("/home/user/docs/file1.md");
        let path2 = PathBuf::from("/home/user/docs/file2.md");
        let path3 = PathBuf::from("/home/user/other/file3.md");

        assert!(detector.same_directory(&path1, &path2));
        assert!(!detector.same_directory(&path1, &path3));
    }

    #[test]
    fn test_backup_pattern() {
        let detector = RenameDetector::new(500);
        assert!(detector.is_backup_pattern("file", "file.bak"));
        assert!(detector.is_backup_pattern("file", "file~"));
        assert!(detector.is_backup_pattern("file.bak", "file"));
        assert!(!detector.is_backup_pattern("file1", "file2"));
    }

    #[test]
    fn test_temp_pattern() {
        let detector = RenameDetector::new(500);
        assert!(detector.is_temp_pattern(".tmp123", "realfile"));
        assert!(detector.is_temp_pattern("file", ".file.swp"));
        assert!(detector.is_temp_pattern("file.swo", "file"));
    }

    #[test]
    fn test_version_pattern() {
        let detector = RenameDetector::new(500);
        assert!(detector.is_versioned_pattern("file_v1", "file_v2"));
        assert!(detector.is_versioned_pattern("document_1", "document_2"));
        assert!(detector.is_versioned_pattern("report (1)", "report (2)"));
        assert!(!detector.is_versioned_pattern("file1", "other2"));
    }

    #[test]
    fn test_remove_version_suffix() {
        let detector = RenameDetector::new(500);
        assert_eq!(detector.remove_version_suffix("file_v1"), "file");
        assert_eq!(detector.remove_version_suffix("document_2"), "document");
        assert_eq!(detector.remove_version_suffix("report (3)"), "report");
        assert_eq!(detector.remove_version_suffix("plain"), "plain");
    }

    #[test]
    fn test_levenshtein_distance() {
        let detector = RenameDetector::new(500);
        assert_eq!(detector.levenshtein_distance("", ""), 0);
        assert_eq!(detector.levenshtein_distance("hello", "hello"), 0);
        assert_eq!(detector.levenshtein_distance("hello", "hallo"), 1);
        assert_eq!(detector.levenshtein_distance("sitting", "kitten"), 3);
        assert_eq!(detector.levenshtein_distance("saturday", "sunday"), 3);
    }

    #[test]
    fn test_levenshtein_similar() {
        let detector = RenameDetector::new(500);
        assert!(detector.levenshtein_similar("hello", "hallo")); // 1 edit, 20% difference
        assert!(detector.levenshtein_similar("document", "dokument")); // 1 edit
        assert!(!detector.levenshtein_similar("hello", "world")); // Too different
    }

    #[test]
    fn test_same_extension() {
        let detector = RenameDetector::new(500);
        let path1 = PathBuf::from("file1.md");
        let path2 = PathBuf::from("file2.md");
        let path3 = PathBuf::from("file3.txt");

        assert!(detector.same_extension(&path1, &path2));
        assert!(!detector.same_extension(&path1, &path3));
    }
}
