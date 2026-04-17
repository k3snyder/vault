use super::{ResourceLimit, ResourceUsage, SystemMonitor};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{error, warn};

/// Enforces resource limits for plugins
pub struct ResourceEnforcer {
    limits: Arc<Mutex<HashMap<String, ResourceLimit>>>,
    violations: Arc<Mutex<HashMap<String, ViolationTracker>>>,
    system_monitor: Arc<SystemMonitor>,
    grace_period: Duration,
}

/// Tracks resource limit violations
#[derive(Debug, Clone)]
struct ViolationTracker {
    first_violation: Option<Instant>,
    violation_count: u32,
    warned: bool,
}

impl Default for ViolationTracker {
    fn default() -> Self {
        Self {
            first_violation: None,
            violation_count: 0,
            warned: false,
        }
    }
}

impl ResourceEnforcer {
    /// Create a new resource enforcer
    pub fn new() -> Self {
        Self {
            limits: Arc::new(Mutex::new(HashMap::new())),
            violations: Arc::new(Mutex::new(HashMap::new())),
            system_monitor: Arc::new(SystemMonitor::new()),
            grace_period: Duration::from_secs(10), // 10 second grace period
        }
    }

    /// Register a plugin with resource limits
    pub fn register_plugin(&mut self, plugin_id: &str, limit: ResourceLimit) {
        let mut limits = self.limits.lock().unwrap();
        limits.insert(plugin_id.to_string(), limit);
    }

    /// Check resource usage and enforce limits
    pub fn check_and_enforce(&mut self, plugin_id: &str, usage: ResourceUsage) -> bool {
        // Check limits and determine if termination is needed
        let (should_terminate, violation_type) = {
            let limits = self.limits.lock().unwrap();

            if let Some(limit) = limits.get(plugin_id) {
                let mut should_terminate = false;
                let mut violation_type = None;

                // Check memory limit
                if let Some(max_memory) = limit.max_memory {
                    if usage.memory_bytes > max_memory {
                        violation_type = Some("memory");
                        should_terminate = true;
                    }
                }

                // Check CPU limit
                if let Some(max_cpu) = limit.max_cpu_percent {
                    if usage.cpu_percent > max_cpu {
                        violation_type = Some("cpu");
                        should_terminate = true;
                    }
                }

                // Check network bandwidth limit
                if let Some(max_bandwidth) = limit.max_network_bandwidth {
                    let bandwidth = (usage.network_bytes_sent + usage.network_bytes_received)
                        as f64
                        / usage.start_time.elapsed().as_secs_f64();
                    if bandwidth > max_bandwidth as f64 {
                        violation_type = Some("network");
                        should_terminate = true;
                    }
                }

                (should_terminate, violation_type)
            } else {
                (false, None)
            }
        }; // Release the lock here

        if should_terminate {
            return self.handle_violation(plugin_id, violation_type.unwrap());
        }

        false // No termination needed
    }

    /// Handle a resource limit violation
    fn handle_violation(&mut self, plugin_id: &str, violation_type: &str) -> bool {
        let mut violations = self.violations.lock().unwrap();
        let tracker = violations.entry(plugin_id.to_string()).or_default();

        // First violation - start grace period
        if tracker.first_violation.is_none() {
            tracker.first_violation = Some(Instant::now());
            tracker.violation_count = 1;
            tracker.warned = false;

            warn!(
                "Plugin {} exceeded {} limit, starting grace period",
                plugin_id, violation_type
            );

            return false; // Don't terminate yet
        }

        tracker.violation_count += 1;

        // Check if we're still in grace period
        if let Some(first_violation) = tracker.first_violation {
            if first_violation.elapsed() < self.grace_period {
                // Still in grace period - warn if not already warned
                if !tracker.warned {
                    warn!(
                        "Plugin {} continuing to exceed {} limit ({} violations)",
                        plugin_id, violation_type, tracker.violation_count
                    );
                    tracker.warned = true;
                }
                return false; // Don't terminate yet
            }
        }

        // Grace period expired - terminate
        error!(
            "Plugin {} exceeded {} limit after grace period, terminating",
            plugin_id, violation_type
        );

        true // Terminate the plugin
    }

    /// Reset violation tracking for a plugin
    pub fn reset_violations(&mut self, plugin_id: &str) {
        let mut violations = self.violations.lock().unwrap();
        violations.remove(plugin_id);
    }

    /// Check if a plugin should receive a warning
    pub fn should_warn(&self, plugin_id: &str, usage: &ResourceUsage) -> bool {
        let limits = self.limits.lock().unwrap();

        if let Some(limit) = limits.get(plugin_id) {
            // Warn at 80% of limit
            if let Some(max_memory) = limit.max_memory {
                if usage.memory_bytes > (max_memory * 8 / 10) {
                    return true;
                }
            }

            if let Some(max_cpu) = limit.max_cpu_percent {
                if usage.cpu_percent > (max_cpu * 0.8) {
                    return true;
                }
            }

            if let Some(max_bandwidth) = limit.max_network_bandwidth {
                let bandwidth = (usage.network_bytes_sent + usage.network_bytes_received) as f64
                    / usage.start_time.elapsed().as_secs_f64();
                if bandwidth > (max_bandwidth as f64 * 0.8) {
                    return true;
                }
            }
        }

        false
    }

    /// Terminate a plugin process
    pub fn terminate_plugin(&self, plugin_id: &str) -> Result<(), String> {
        self.system_monitor.terminate_process(plugin_id)
    }

    /// Get violation statistics for a plugin
    pub fn get_violation_stats(&self, plugin_id: &str) -> Option<ViolationStats> {
        let violations = self.violations.lock().unwrap();

        if let Some(tracker) = violations.get(plugin_id) {
            Some(ViolationStats {
                violation_count: tracker.violation_count,
                first_violation: tracker.first_violation,
                warned: tracker.warned,
                in_grace_period: tracker
                    .first_violation
                    .map(|t| t.elapsed() < self.grace_period)
                    .unwrap_or(false),
            })
        } else {
            None
        }
    }

    /// Set grace period duration
    pub fn set_grace_period(&mut self, duration: Duration) {
        self.grace_period = duration;
    }
}

/// Statistics about resource violations
#[derive(Debug, Clone)]
pub struct ViolationStats {
    pub violation_count: u32,
    pub first_violation: Option<Instant>,
    pub warned: bool,
    pub in_grace_period: bool,
}
