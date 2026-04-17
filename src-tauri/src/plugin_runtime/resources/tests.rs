#[cfg(test)]
mod tests {
    use super::super::*;
    use std::time::Duration;
    use tokio::time::sleep;

    #[test]
    fn test_system_monitor_creation() {
        let monitor = SystemMonitor::new();
        assert!(monitor.is_initialized());
    }

    #[test]
    fn test_process_discovery() {
        let monitor = SystemMonitor::new();
        let processes = monitor.discover_webview_processes();
        // WebView processes should be discoverable when running
        assert!(processes.is_ok());
    }

    #[test]
    fn test_memory_monitoring() {
        let monitor = SystemMonitor::new();
        let plugin_id = "test-plugin";

        // Register a mock process for testing
        monitor.register_process(plugin_id, std::process::id());

        let memory = monitor.get_memory_usage(plugin_id);
        assert!(memory.is_some());
        assert!(memory.unwrap() > 0);
    }

    #[test]
    fn test_cpu_monitoring() {
        let monitor = SystemMonitor::new();
        let plugin_id = "test-plugin";

        monitor.register_process(plugin_id, std::process::id());

        // CPU usage requires sampling over time
        std::thread::sleep(Duration::from_millis(100));
        let cpu = monitor.get_cpu_usage(plugin_id);
        assert!(cpu.is_some());
        assert!(cpu.unwrap() >= 0.0);
    }

    #[test]
    fn test_network_tracking() {
        let mut tracker = NetworkTracker::new();
        let plugin_id = "test-plugin";

        // Track some network usage
        tracker.track_request(plugin_id, 1024, 512);
        tracker.track_request(plugin_id, 2048, 1024);

        let stats = tracker.get_stats(plugin_id);
        assert_eq!(stats.bytes_sent, 3072);
        assert_eq!(stats.bytes_received, 1536);
    }

    #[test]
    fn test_resource_limit_check() {
        let mut monitor = ResourceMonitor::new();
        let plugin_id = "test-plugin";

        // Set a memory limit
        futures::executor::block_on(monitor.set_limit(
            plugin_id,
            ResourceLimit {
                max_memory: Some(100 * 1024 * 1024), // 100MB
                max_cpu_percent: Some(50.0),
                max_storage: None,
                max_network_bandwidth: None,
            },
        ))
        .unwrap();

        // Simulate usage below limit
        monitor.set_usage_for_test(
            plugin_id,
            ResourceUsage {
                memory_bytes: 50 * 1024 * 1024, // 50MB
                cpu_percent: 25.0,
                network_bytes_sent: 0,
                network_bytes_received: 0,
                start_time: std::time::Instant::now(),
            },
        );

        assert!(!monitor.is_limit_exceeded(plugin_id));

        // Simulate usage above limit
        monitor.set_usage_for_test(
            plugin_id,
            ResourceUsage {
                memory_bytes: 150 * 1024 * 1024, // 150MB
                cpu_percent: 25.0,
                network_bytes_sent: 0,
                network_bytes_received: 0,
                start_time: std::time::Instant::now(),
            },
        );

        assert!(monitor.is_limit_exceeded(plugin_id));
    }

    #[test]
    fn test_process_termination() {
        let mut enforcer = ResourceEnforcer::new();
        let plugin_id = "test-plugin";

        // Register a plugin with limits
        enforcer.register_plugin(
            plugin_id,
            ResourceLimit {
                max_memory: Some(100 * 1024 * 1024),
                max_cpu_percent: Some(50.0),
                max_storage: None,
                max_network_bandwidth: None,
            },
        );

        // Simulate limit violation
        let should_terminate = enforcer.check_and_enforce(
            plugin_id,
            ResourceUsage {
                memory_bytes: 200 * 1024 * 1024, // 200MB - exceeds limit
                cpu_percent: 25.0,
                network_bytes_sent: 0,
                network_bytes_received: 0,
                start_time: std::time::Instant::now(),
            },
        );

        assert!(should_terminate);
    }

    #[test]
    fn test_warning_threshold() {
        let mut monitor = ResourceMonitor::new();
        let plugin_id = "test-plugin";

        futures::executor::block_on(monitor.set_limit(
            plugin_id,
            ResourceLimit {
                max_memory: Some(100 * 1024 * 1024),
                max_cpu_percent: None,
                max_storage: None,
                max_network_bandwidth: None,
            },
        ))
        .unwrap();

        // Test warning at 80% threshold
        monitor.set_usage_for_test(
            plugin_id,
            ResourceUsage {
                memory_bytes: 85 * 1024 * 1024, // 85MB - 85% of limit
                cpu_percent: 0.0,
                network_bytes_sent: 0,
                network_bytes_received: 0,
                start_time: std::time::Instant::now(),
            },
        );

        assert!(monitor.should_warn(plugin_id));
    }

    #[test]
    fn test_plugin_metrics_collection() {
        let mut metrics = PluginMetrics::new();
        let plugin_id = "test-plugin";

        // Collect some metrics
        metrics.record(
            plugin_id,
            PluginMetricEvent::ResourceUsage {
                memory_bytes: 50 * 1024 * 1024,
                cpu_percent: 10.0,
                network_bytes: 1024,
            },
        );

        metrics.record(
            plugin_id,
            PluginMetricEvent::LimitExceeded {
                resource_type: "memory".to_string(),
                limit: 100 * 1024 * 1024,
                actual: 150 * 1024 * 1024,
            },
        );

        let events = metrics.get_events(plugin_id);
        assert_eq!(events.len(), 2);
    }

    #[tokio::test]
    async fn test_periodic_monitoring() {
        let monitor = ResourceMonitor::new();
        let plugin_id = "test-plugin";

        // Start periodic monitoring
        let handle = monitor.start_monitoring_periodic(plugin_id, Duration::from_millis(100));

        // Let it run for a bit
        sleep(Duration::from_millis(350)).await;

        // Should have collected at least 3 samples
        let samples = monitor.get_sample_count(plugin_id);
        assert!(samples >= 3);

        // Stop monitoring
        handle.abort();
    }

    #[test]
    fn test_resource_cleanup() {
        let mut monitor = ResourceMonitor::new();
        let plugin_id = "test-plugin";

        // Add some resource tracking
        monitor.set_usage_for_test(
            plugin_id,
            ResourceUsage {
                memory_bytes: 50 * 1024 * 1024,
                cpu_percent: 10.0,
                network_bytes_sent: 1024,
                network_bytes_received: 512,
                start_time: std::time::Instant::now(),
            },
        );

        assert!(monitor.has_data(plugin_id));

        // Clean up resources
        monitor.cleanup(plugin_id);

        assert!(!monitor.has_data(plugin_id));
    }

    #[test]
    fn test_cross_platform_compatibility() {
        let monitor = SystemMonitor::new();

        // Should work on all platforms
        #[cfg(target_os = "macos")]
        assert!(monitor.supports_memory_monitoring());

        #[cfg(target_os = "linux")]
        assert!(monitor.supports_memory_monitoring());

        #[cfg(target_os = "windows")]
        assert!(monitor.supports_memory_monitoring());

        assert!(monitor.supports_cpu_monitoring());
    }
}
