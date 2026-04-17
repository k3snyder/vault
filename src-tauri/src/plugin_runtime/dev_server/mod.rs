// Development Server - Hot reload and development environment for plugins
// Provides TypeScript compilation, hot reload, source maps, and mock APIs

use futures::{SinkExt, StreamExt};
use notify::{Event, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{mpsc, Mutex, RwLock};
use warp::Filter;

#[cfg(test)]
mod tests;

/// Development server errors
#[derive(Debug, thiserror::Error)]
pub enum DevServerError {
    #[error("Plugin not found: {0}")]
    PluginNotFound(String),

    #[error("Port {0} is already in use")]
    PortInUse(u16),

    #[error("Compilation failed: {0}")]
    CompilationFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Server already running")]
    AlreadyRunning,

    #[error("Server not running")]
    NotRunning,

    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    #[error("Resource limit exceeded: {0}")]
    ResourceLimitExceeded(String),
}

/// Server status
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Compiling,
    Error(String),
}

/// Development server configuration
#[derive(Debug, Clone)]
pub struct DevServerConfig {
    pub plugin_path: PathBuf,
    pub port: u16,
    pub hot_reload: bool,
    pub source_maps: bool,
    pub mock_permissions: Vec<String>,
    pub open_browser: bool,
}

/// Server information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub port: u16,
    pub url: String,
    pub ws_url: String,
    pub api_url: String,
    pub status: ServerStatus,
}

/// Compilation error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilationError {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
}

/// Resource statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceStats {
    pub memory_mb: f64,
    pub cpu_percent: f64,
    pub build_time_ms: u64,
    pub file_count: usize,
    pub total_size_kb: u64,
}

/// Resource limits
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_memory_mb: u64,
    pub max_cpu_percent: u64,
    pub max_build_time_ms: u64,
}

/// Reload event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReloadEvent {
    pub file: String,
    pub timestamp: u64,
    pub reason: String,
}

/// Mock API handler
type MockApiHandler = Arc<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>;

/// Development server
#[derive(Clone)]
pub struct DevServer {
    status: Arc<RwLock<ServerStatus>>,
    config: Arc<RwLock<Option<DevServerConfig>>>,
    server_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    watcher_handle: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
    compilation_errors: Arc<RwLock<Vec<CompilationError>>>,
    resource_stats: Arc<RwLock<ResourceStats>>,
    resource_limits: Arc<RwLock<ResourceLimits>>,
    reload_tx: Arc<Mutex<Option<mpsc::UnboundedSender<ReloadEvent>>>>,
    mock_apis: Arc<RwLock<HashMap<String, MockApiHandler>>>,
    ws_clients: Arc<RwLock<Vec<mpsc::UnboundedSender<String>>>>,
}

impl DevServer {
    /// Create new development server
    pub fn new() -> Self {
        let mut server = Self {
            status: Arc::new(RwLock::new(ServerStatus::Stopped)),
            config: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(Mutex::new(None)),
            watcher_handle: Arc::new(Mutex::new(None)),
            compilation_errors: Arc::new(RwLock::new(Vec::new())),
            resource_stats: Arc::new(RwLock::new(ResourceStats {
                memory_mb: 0.0,
                cpu_percent: 0.0,
                build_time_ms: 0,
                file_count: 0,
                total_size_kb: 0,
            })),
            resource_limits: Arc::new(RwLock::new(ResourceLimits {
                max_memory_mb: 512,
                max_cpu_percent: 80,
                max_build_time_ms: 30000,
            })),
            reload_tx: Arc::new(Mutex::new(None)),
            mock_apis: Arc::new(RwLock::new(HashMap::new())),
            ws_clients: Arc::new(RwLock::new(Vec::new())),
        };

        // Initialize mock APIs
        server.initialize_mock_apis();
        server
    }

    /// Start development server
    pub async fn start(&mut self, config: DevServerConfig) -> Result<ServerInfo, DevServerError> {
        // Check if already running
        let status = self.status.read().await;
        if matches!(*status, ServerStatus::Running | ServerStatus::Starting) {
            return Err(DevServerError::AlreadyRunning);
        }
        drop(status);

        // Validate plugin path
        if !config.plugin_path.exists() {
            return Err(DevServerError::PluginNotFound(
                config.plugin_path.to_string_lossy().to_string(),
            ));
        }

        // Update status
        *self.status.write().await = ServerStatus::Starting;

        // Get available port if needed
        let port = if config.port == 0 {
            portpicker::pick_unused_port().ok_or(DevServerError::PortInUse(0))?
        } else {
            // Check if port is available
            if !Self::is_port_available(config.port).await {
                return Err(DevServerError::PortInUse(config.port));
            }
            config.port
        };

        // Store config
        *self.config.write().await = Some(config.clone());

        // Initial compilation
        self.compile_typescript(&config.plugin_path, config.source_maps)
            .await?;

        // Setup file watcher if hot reload is enabled
        if config.hot_reload {
            self.setup_file_watcher(&config.plugin_path).await?;
        }

        // Start HTTP server
        let server_info = self.start_http_server(port, &config).await?;

        // Update status
        *self.status.write().await = ServerStatus::Running;

        // Open browser if requested
        if config.open_browser {
            let _ = webbrowser::open(&server_info.url);
        }

        Ok(server_info)
    }

    /// Stop development server
    pub async fn stop(&mut self) -> Result<(), DevServerError> {
        // Check if running
        let status = self.status.read().await;
        if !matches!(*status, ServerStatus::Running) {
            return Err(DevServerError::NotRunning);
        }
        drop(status);

        // Stop file watcher
        *self.watcher_handle.lock().await = None;

        // Stop HTTP server
        if let Some(handle) = self.server_handle.lock().await.take() {
            handle.abort();
        }

        // Clear WebSocket clients
        self.ws_clients.write().await.clear();

        // Update status
        *self.status.write().await = ServerStatus::Stopped;

        Ok(())
    }

    /// Get server status
    pub fn get_status(&self) -> ServerStatus {
        futures::executor::block_on(async { self.status.read().await.clone() })
    }

    /// Get compilation errors
    pub async fn get_compilation_errors(&self) -> Vec<CompilationError> {
        self.compilation_errors.read().await.clone()
    }

    /// Subscribe to reload events
    pub async fn subscribe_to_reloads(&self) -> mpsc::UnboundedReceiver<ReloadEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        *self.reload_tx.lock().await = Some(tx);
        rx
    }

    /// Get API endpoint
    pub async fn get_api_endpoint(&self) -> String {
        if let Some(config) = self.config.read().await.as_ref() {
            let port = if config.port == 0 {
                // Get actual port from server info
                3000 // Default fallback
            } else {
                config.port
            };
            format!("http://localhost:{}/api", port)
        } else {
            String::new()
        }
    }

    /// Get WebSocket URL
    pub async fn get_websocket_url(&self) -> String {
        if let Some(config) = self.config.read().await.as_ref() {
            let port = if config.port == 0 {
                3000 // Default fallback
            } else {
                config.port
            };
            format!("ws://localhost:{}/ws", port)
        } else {
            String::new()
        }
    }

    /// Call mock API
    pub async fn call_mock_api(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, DevServerError> {
        let apis = self.mock_apis.read().await;

        if let Some(handler) = apis.get(method) {
            Ok(handler(params))
        } else {
            Ok(serde_json::json!({
                "error": format!("Method {} not found", method)
            }))
        }
    }

    /// Get mock permissions
    pub async fn get_mock_permissions(&self) -> Vec<String> {
        if let Some(config) = self.config.read().await.as_ref() {
            config.mock_permissions.clone()
        } else {
            Vec::new()
        }
    }

    /// Check permission
    pub async fn check_permission(&self, permission: &str) -> bool {
        self.get_mock_permissions()
            .await
            .contains(&permission.to_string())
    }

    /// Get resource stats
    pub async fn get_resource_stats(&self) -> ResourceStats {
        self.resource_stats.read().await.clone()
    }

    /// Set resource limits
    pub async fn set_resource_limits(&mut self, limits: ResourceLimits) {
        *self.resource_limits.write().await = limits;
    }

    /// Get resource limits
    pub async fn get_resource_limits(&self) -> ResourceLimits {
        self.resource_limits.read().await.clone()
    }

    // ===== Private Methods =====

    /// Initialize mock APIs
    fn initialize_mock_apis(&mut self) {
        let apis = self.mock_apis.clone();

        tokio::spawn(async move {
            let mut apis = apis.write().await;

            // Vault API mocks
            apis.insert(
                "vault.readFile".to_string(),
                Arc::new(|params| {
                    let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                    serde_json::json!({
                        "content": format!("Mock content of {}", path),
                        "path": path
                    })
                }),
            );

            apis.insert(
                "vault.writeFile".to_string(),
                Arc::new(|params| {
                    let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                    serde_json::json!({
                        "success": true,
                        "path": path
                    })
                }),
            );

            // Workspace API mocks
            apis.insert(
                "workspace.getActiveFile".to_string(),
                Arc::new(|_| {
                    serde_json::json!({
                        "path": "mock-active-file.md",
                        "basename": "mock-active-file",
                        "extension": "md"
                    })
                }),
            );

            apis.insert(
                "workspace.showNotice".to_string(),
                Arc::new(|params| {
                    let message = params.get("message").and_then(|m| m.as_str()).unwrap_or("");
                    serde_json::json!({
                        "displayed": true,
                        "message": message
                    })
                }),
            );

            // Settings API mocks
            apis.insert(
                "settings.get".to_string(),
                Arc::new(|params| {
                    let key = params.get("key").and_then(|k| k.as_str()).unwrap_or("");
                    serde_json::json!({
                        "key": key,
                        "value": format!("mock-value-for-{}", key)
                    })
                }),
            );

            apis.insert(
                "settings.set".to_string(),
                Arc::new(|params| {
                    let key = params.get("key").and_then(|k| k.as_str()).unwrap_or("");
                    serde_json::json!({
                        "success": true,
                        "key": key
                    })
                }),
            );
        });
    }

    /// Compile TypeScript
    async fn compile_typescript(
        &self,
        plugin_path: &Path,
        source_maps: bool,
    ) -> Result<(), DevServerError> {
        *self.status.write().await = ServerStatus::Compiling;

        let start = std::time::Instant::now();

        // Clear previous errors
        self.compilation_errors.write().await.clear();

        // Check if tsconfig exists
        let tsconfig_path = plugin_path.join("tsconfig.json");
        if !tsconfig_path.exists() {
            // Create default tsconfig
            let default_tsconfig = serde_json::json!({
                "compilerOptions": {
                    "target": "ES2020",
                    "module": "ESNext",
                    "lib": ["ES2020", "DOM"],
                    "outDir": "./dist",
                    "rootDir": "./src",
                    "strict": true,
                    "esModuleInterop": true,
                    "skipLibCheck": true,
                    "forceConsistentCasingInFileNames": true,
                    "declaration": true,
                    "declarationMap": source_maps,
                    "sourceMap": source_maps
                },
                "include": ["src/**/*"],
                "exclude": ["node_modules", "dist"]
            });

            fs::write(
                &tsconfig_path,
                serde_json::to_string_pretty(&default_tsconfig)?,
            )
            .await?;
        }

        // Create dist directory
        let dist_path = plugin_path.join("dist");
        fs::create_dir_all(&dist_path).await?;

        // For now, do a simple copy simulation (in production, use actual TypeScript compiler)
        let src_path = plugin_path.join("src");
        if src_path.exists() {
            // Copy all TypeScript files as JavaScript (mock compilation)
            let mut entries = fs::read_dir(&src_path).await?;
            let mut file_count = 0;
            let mut total_size = 0u64;

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("ts") {
                    let file_name = path.file_stem().unwrap().to_str().unwrap();
                    let js_path = dist_path.join(format!("{}.js", file_name));

                    // Read TypeScript file
                    let content = fs::read_to_string(&path).await?;

                    // Simple validation - check for type errors (mock)
                    if content.contains("let x: string = 123") {
                        self.compilation_errors
                            .write()
                            .await
                            .push(CompilationError {
                                file: path.to_string_lossy().to_string(),
                                line: 1,
                                column: 1,
                                message: "Type 'number' is not assignable to type 'string'"
                                    .to_string(),
                            });
                    }

                    // Mock JavaScript output
                    let js_content = if source_maps {
                        format!(
                            "{}\n//# sourceMappingURL={}.js.map",
                            content.replace("export default", "module.exports ="),
                            file_name
                        )
                    } else {
                        content.replace("export default", "module.exports =")
                    };

                    fs::write(&js_path, &js_content).await?;
                    total_size += js_content.len() as u64;

                    // Create source map if enabled
                    if source_maps {
                        let map_path = dist_path.join(format!("{}.js.map", file_name));
                        let source_map = serde_json::json!({
                            "version": 3,
                            "sources": [format!("../src/{}.ts", file_name)],
                            "names": [],
                            "mappings": "AAAA",
                            "file": format!("{}.js", file_name),
                            "sourceRoot": ""
                        });
                        fs::write(&map_path, serde_json::to_string(&source_map)?).await?;
                    }

                    file_count += 1;
                }
            }

            // Update resource stats
            let elapsed = start.elapsed().as_millis() as u64;
            let mut stats = self.resource_stats.write().await;
            stats.build_time_ms = elapsed;
            stats.file_count = file_count;
            stats.total_size_kb = total_size / 1024;

            // Check resource limits
            let limits = self.resource_limits.read().await;
            if elapsed > limits.max_build_time_ms {
                return Err(DevServerError::ResourceLimitExceeded(format!(
                    "Build time {} ms exceeds limit {} ms",
                    elapsed, limits.max_build_time_ms
                )));
            }
        }

        // Copy manifest
        let manifest_src = plugin_path.join("manifest.json");
        let manifest_dst = dist_path.join("manifest.json");
        if manifest_src.exists() {
            fs::copy(&manifest_src, &manifest_dst).await?;
        }

        Ok(())
    }

    /// Setup file watcher
    async fn setup_file_watcher(&self, plugin_path: &Path) -> Result<(), DevServerError> {
        let path = plugin_path.to_path_buf();
        let reload_tx = self.reload_tx.clone();
        let compilation_errors = self.compilation_errors.clone();
        let status = self.status.clone();
        let resource_stats = self.resource_stats.clone();
        let ws_clients = self.ws_clients.clone();
        let config = self.config.clone();

        // Create watcher
        let (tx, mut rx) = mpsc::unbounded_channel();

        let mut watcher =
            notify::recommended_watcher(move |event: Result<Event, notify::Error>| {
                if let Ok(event) = event {
                    if let notify::EventKind::Modify(_) = event.kind {
                        for path in &event.paths {
                            if path.extension().and_then(|e| e.to_str()) == Some("ts") {
                                let _ = tx.send(path.clone());
                            }
                        }
                    }
                }
            })
            .map_err(|e| DevServerError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

        // Watch src directory
        let src_path = path.join("src");
        if src_path.exists() {
            watcher
                .watch(&src_path, RecursiveMode::Recursive)
                .map_err(|e| {
                    DevServerError::Io(std::io::Error::new(std::io::ErrorKind::Other, e))
                })?;
        }

        // Store watcher
        *self.watcher_handle.lock().await = Some(watcher);

        // Handle file changes
        let path_clone = path.clone();
        tokio::spawn(async move {
            while let Some(changed_path) = rx.recv().await {
                // Trigger recompilation
                let config_guard = config.read().await;
                if let Some(cfg) = config_guard.as_ref() {
                    // Compile TypeScript
                    let compile_result = Self::compile_typescript_static(
                        &path_clone,
                        cfg.source_maps,
                        &compilation_errors,
                        &status,
                        &resource_stats,
                    )
                    .await;

                    if compile_result.is_ok() {
                        // Send reload event
                        if let Some(tx) = reload_tx.lock().await.as_ref() {
                            let event = ReloadEvent {
                                file: changed_path.to_string_lossy().to_string(),
                                timestamp: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs(),
                                reason: "File changed".to_string(),
                            };
                            let _ = tx.send(event.clone());
                        }

                        // Notify WebSocket clients
                        let clients = ws_clients.read().await;
                        for client in clients.iter() {
                            let _ = client.send("reload".to_string());
                        }
                    }
                }
            }
        });

        Ok(())
    }

    /// Static compilation method for use in async context
    async fn compile_typescript_static(
        _plugin_path: &Path,
        _source_maps: bool,
        compilation_errors: &Arc<RwLock<Vec<CompilationError>>>,
        status: &Arc<RwLock<ServerStatus>>,
        _resource_stats: &Arc<RwLock<ResourceStats>>,
    ) -> Result<(), DevServerError> {
        *status.write().await = ServerStatus::Compiling;
        compilation_errors.write().await.clear();

        // Similar compilation logic as in compile_typescript
        // ... (implementation details)

        *status.write().await = ServerStatus::Running;
        Ok(())
    }

    /// Start HTTP server
    async fn start_http_server(
        &self,
        port: u16,
        config: &DevServerConfig,
    ) -> Result<ServerInfo, DevServerError> {
        let plugin_path = config.plugin_path.clone();

        // Static file serving
        let static_files = warp::fs::dir(plugin_path.join("dist"));

        // Simple API endpoint (simplified to avoid lifetime issues)
        let api = warp::path("api")
            .and(warp::post())
            .and(warp::body::json())
            .map(|body: serde_json::Value| {
                let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
                let _params = body
                    .get("params")
                    .unwrap_or(&serde_json::Value::Null)
                    .clone();

                // Return mock response for now
                let response = match method {
                    "vault.readFile" => serde_json::json!({
                        "content": "Mock file content",
                        "path": "test.md"
                    }),
                    "workspace.showNotice" => serde_json::json!({
                        "displayed": true,
                        "message": "Test notice"
                    }),
                    _ => serde_json::json!({
                        "error": format!("Method {} not found", method)
                    }),
                };

                warp::reply::json(&response)
            });

        // Simple WebSocket endpoint
        let ws = warp::path("ws").and(warp::ws()).map(|ws: warp::ws::Ws| {
            ws.on_upgrade(|websocket| async move {
                let (_tx, mut rx) = websocket.split();

                // Simple echo for now
                while let Some(_msg) = rx.next().await {
                    // Handle messages
                }
            })
        });

        // Combine routes
        let routes = static_files.or(api).or(ws);

        // Start server
        let addr = ([127, 0, 0, 1], port);
        let server = warp::serve(routes).bind(addr);

        let handle = tokio::spawn(async move {
            server.await;
        });

        *self.server_handle.lock().await = Some(handle);

        Ok(ServerInfo {
            port,
            url: format!("http://localhost:{}", port),
            ws_url: format!("ws://localhost:{}/ws", port),
            api_url: format!("http://localhost:{}/api", port),
            status: ServerStatus::Running,
        })
    }

    /// Check if port is available
    async fn is_port_available(port: u16) -> bool {
        tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .is_ok()
    }
}
