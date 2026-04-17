use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Tracks network usage for plugins
#[derive(Debug, Clone)]
pub struct NetworkStats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub request_count: u32,
    pub last_request: Option<Instant>,
}

impl Default for NetworkStats {
    fn default() -> Self {
        Self {
            bytes_sent: 0,
            bytes_received: 0,
            request_count: 0,
            last_request: None,
        }
    }
}

/// Tracks network usage across all plugins
pub struct NetworkTracker {
    stats: Arc<Mutex<HashMap<String, NetworkStats>>>,
    bandwidth_limits: Arc<Mutex<HashMap<String, u64>>>, // bytes per second
}

impl NetworkTracker {
    /// Create a new network tracker
    pub fn new() -> Self {
        Self {
            stats: Arc::new(Mutex::new(HashMap::new())),
            bandwidth_limits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Track a network request for a plugin
    pub fn track_request(&mut self, plugin_id: &str, bytes_sent: u64, bytes_received: u64) {
        let mut stats = self.stats.lock().unwrap();
        let entry = stats
            .entry(plugin_id.to_string())
            .or_insert_with(NetworkStats::default);

        entry.bytes_sent += bytes_sent;
        entry.bytes_received += bytes_received;
        entry.request_count += 1;
        entry.last_request = Some(Instant::now());
    }

    /// Get network statistics for a plugin
    pub fn get_stats(&self, plugin_id: &str) -> NetworkStats {
        let stats = self.stats.lock().unwrap();
        stats.get(plugin_id).cloned().unwrap_or_default()
    }

    /// Get total bytes transferred for a plugin
    pub fn get_total_bytes(&self, plugin_id: &str) -> u64 {
        let stats = self.get_stats(plugin_id);
        stats.bytes_sent + stats.bytes_received
    }

    /// Set bandwidth limit for a plugin (bytes per second)
    pub fn set_bandwidth_limit(&mut self, plugin_id: &str, limit: u64) {
        let mut limits = self.bandwidth_limits.lock().unwrap();
        limits.insert(plugin_id.to_string(), limit);
    }

    /// Check if a plugin is exceeding its bandwidth limit
    pub fn is_exceeding_bandwidth(&self, plugin_id: &str) -> bool {
        let limits = self.bandwidth_limits.lock().unwrap();
        if let Some(limit) = limits.get(plugin_id) {
            let stats = self.get_stats(plugin_id);
            if let Some(last_request) = stats.last_request {
                let elapsed = last_request.elapsed().as_secs_f64();
                if elapsed > 0.0 {
                    let bytes_per_second =
                        (stats.bytes_sent + stats.bytes_received) as f64 / elapsed;
                    return bytes_per_second > *limit as f64;
                }
            }
        }
        false
    }

    /// Reset statistics for a plugin
    pub fn reset_stats(&mut self, plugin_id: &str) {
        let mut stats = self.stats.lock().unwrap();
        stats.remove(plugin_id);
    }

    /// Get all plugin IDs being tracked
    pub fn get_tracked_plugins(&self) -> Vec<String> {
        let stats = self.stats.lock().unwrap();
        stats.keys().cloned().collect()
    }

    /// Calculate bandwidth usage over a time window
    pub fn calculate_bandwidth(&self, plugin_id: &str, window_seconds: f64) -> f64 {
        let stats = self.get_stats(plugin_id);
        if let Some(last_request) = stats.last_request {
            let elapsed = last_request.elapsed().as_secs_f64();
            if elapsed <= window_seconds && elapsed > 0.0 {
                return (stats.bytes_sent + stats.bytes_received) as f64 / elapsed;
            }
        }
        0.0
    }
}

/// Network request interceptor for tracking
pub struct NetworkInterceptor {
    tracker: Arc<Mutex<NetworkTracker>>,
}

impl NetworkInterceptor {
    /// Create a new network interceptor
    pub fn new(tracker: Arc<Mutex<NetworkTracker>>) -> Self {
        Self { tracker }
    }

    /// Intercept and track a network request
    pub fn intercept_request(
        &self,
        plugin_id: &str,
        request_size: u64,
        response_size: u64,
    ) -> Result<(), String> {
        // Check bandwidth limit before allowing request
        {
            let tracker = self.tracker.lock().unwrap();
            if tracker.is_exceeding_bandwidth(plugin_id) {
                return Err("Bandwidth limit exceeded".to_string());
            }
        }

        // Track the request
        {
            let mut tracker = self.tracker.lock().unwrap();
            tracker.track_request(plugin_id, request_size, response_size);
        }

        Ok(())
    }

    /// Check if a plugin can make a network request
    pub fn can_make_request(&self, plugin_id: &str) -> bool {
        let tracker = self.tracker.lock().unwrap();
        !tracker.is_exceeding_bandwidth(plugin_id)
    }
}
