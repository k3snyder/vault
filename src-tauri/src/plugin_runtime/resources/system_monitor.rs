use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Monitors system resources for plugin processes
pub struct SystemMonitor {
    system: Arc<Mutex<System>>,
    plugin_processes: Arc<Mutex<HashMap<String, Pid>>>,
    last_update: Arc<Mutex<Instant>>,
}

impl SystemMonitor {
    /// Create a new system monitor
    pub fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_all();

        Self {
            system: Arc::new(Mutex::new(system)),
            plugin_processes: Arc::new(Mutex::new(HashMap::new())),
            last_update: Arc::new(Mutex::new(Instant::now())),
        }
    }

    /// Check if monitor is initialized
    pub fn is_initialized(&self) -> bool {
        self.system.lock().unwrap().processes().len() > 0
    }

    /// Register a process for a plugin
    pub fn register_process(&self, plugin_id: &str, pid: u32) {
        let mut processes = self.plugin_processes.lock().unwrap();
        processes.insert(plugin_id.to_string(), Pid::from(pid as usize));
    }

    /// Unregister a plugin's process
    pub fn unregister_process(&self, plugin_id: &str) {
        let mut processes = self.plugin_processes.lock().unwrap();
        processes.remove(plugin_id);
    }

    /// Discover WebView processes
    pub fn discover_webview_processes(&self) -> Result<Vec<Pid>, String> {
        let mut system = self.system.lock().unwrap();
        system.refresh_processes(ProcessesToUpdate::All);

        let mut webview_pids = Vec::new();

        for (pid, process) in system.processes() {
            let name = process.name().to_string_lossy();
            // Look for WebView or Tauri-related processes
            if name.contains("WebView") || name.contains("Tauri") || name.contains("WebKit") {
                webview_pids.push(*pid);
            }
        }

        Ok(webview_pids)
    }

    /// Get memory usage for a plugin in bytes
    pub fn get_memory_usage(&self, plugin_id: &str) -> Option<u64> {
        let processes = self.plugin_processes.lock().unwrap();
        let pid = processes.get(plugin_id)?;

        let mut system = self.system.lock().unwrap();
        system.refresh_processes(ProcessesToUpdate::Some(&[*pid]));

        if let Some(process) = system.process(*pid) {
            Some(process.memory() * 1024) // Convert from KB to bytes
        } else {
            None
        }
    }

    /// Get CPU usage percentage for a plugin
    pub fn get_cpu_usage(&self, plugin_id: &str) -> Option<f32> {
        let processes = self.plugin_processes.lock().unwrap();
        let pid = processes.get(plugin_id)?;

        let mut system = self.system.lock().unwrap();

        // CPU usage requires two samples
        system.refresh_processes(ProcessesToUpdate::Some(&[*pid]));

        if let Some(process) = system.process(*pid) {
            Some(process.cpu_usage())
        } else {
            None
        }
    }

    /// Get disk I/O stats for a plugin
    pub fn get_disk_usage(&self, plugin_id: &str) -> Option<(u64, u64)> {
        let processes = self.plugin_processes.lock().unwrap();
        let pid = processes.get(plugin_id)?;

        let mut system = self.system.lock().unwrap();
        system.refresh_processes(ProcessesToUpdate::Some(&[*pid]));

        if let Some(process) = system.process(*pid) {
            let disk_usage = process.disk_usage();
            Some((disk_usage.written_bytes, disk_usage.read_bytes))
        } else {
            None
        }
    }

    /// Refresh all process information
    pub fn refresh(&self) {
        let mut system = self.system.lock().unwrap();
        system.refresh_all();

        let mut last_update = self.last_update.lock().unwrap();
        *last_update = Instant::now();
    }

    /// Refresh specific process information
    pub fn refresh_process(&self, plugin_id: &str) {
        if let Some(pid) = self
            .plugin_processes
            .lock()
            .unwrap()
            .get(plugin_id)
            .cloned()
        {
            let mut system = self.system.lock().unwrap();
            system.refresh_processes(ProcessesToUpdate::Some(&[pid]));
        }
    }

    /// Check if we support memory monitoring on this platform
    pub fn supports_memory_monitoring(&self) -> bool {
        // sysinfo supports memory monitoring on all major platforms
        true
    }

    /// Check if we support CPU monitoring on this platform
    pub fn supports_cpu_monitoring(&self) -> bool {
        // sysinfo supports CPU monitoring on all major platforms
        true
    }

    /// Get total system memory in bytes
    pub fn get_total_memory(&self) -> u64 {
        let system = self.system.lock().unwrap();
        system.total_memory() * 1024 // Convert from KB to bytes
    }

    /// Get available system memory in bytes
    pub fn get_available_memory(&self) -> u64 {
        let system = self.system.lock().unwrap();
        system.available_memory() * 1024 // Convert from KB to bytes
    }

    /// Terminate a process
    pub fn terminate_process(&self, plugin_id: &str) -> Result<(), String> {
        let processes = self.plugin_processes.lock().unwrap();
        if let Some(pid) = processes.get(plugin_id) {
            let system = self.system.lock().unwrap();
            if let Some(process) = system.process(*pid) {
                if process.kill() {
                    Ok(())
                } else {
                    Err("Failed to terminate process".to_string())
                }
            } else {
                Err("Process not found".to_string())
            }
        } else {
            Err("Plugin process not registered".to_string())
        }
    }
}

/// Aggregated metrics for a plugin
#[derive(Debug, Clone)]
pub struct PluginMetrics {
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub process_count: usize,
    pub timestamp: Instant,
}

impl SystemMonitor {
    /// Get aggregated metrics for a plugin
    pub fn get_plugin_metrics(&self, plugin_id: &str) -> Option<PluginMetrics> {
        self.refresh_process(plugin_id);

        let memory = self.get_memory_usage(plugin_id)?;
        let cpu = self.get_cpu_usage(plugin_id)?;
        let (disk_read, disk_write) = self.get_disk_usage(plugin_id).unwrap_or((0, 0));

        Some(PluginMetrics {
            memory_bytes: memory,
            cpu_percent: cpu,
            disk_read_bytes: disk_read,
            disk_write_bytes: disk_write,
            process_count: 1,
            timestamp: Instant::now(),
        })
    }
}
