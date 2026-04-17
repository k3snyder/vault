use anyhow::Result;
use std::env;
use std::path::PathBuf;
use tracing::info;
use tracing_subscriber;

mod filesystem;
mod protocol;
mod server;
mod transport;
mod transport_line;

use server::McpServer;

/// Parse command line arguments for --allowed-paths <path>
fn parse_allowed_paths() -> Option<PathBuf> {
    let args: Vec<String> = env::args().collect();
    for i in 0..args.len() {
        if args[i] == "--allowed-paths" && i + 1 < args.len() {
            return Some(PathBuf::from(&args[i + 1]));
        }
    }
    None
}

#[tokio::main]
async fn main() -> Result<()> {
    // Only output debug messages if MCP_DEBUG is set
    let debug_enabled = env::var("MCP_DEBUG").is_ok();

    // Only initialize logging if debug is enabled
    if debug_enabled {
        tracing_subscriber::fmt()
            .with_target(false)
            .with_writer(std::io::stderr)
            .with_ansi(false)
            .init();
    }

    // Check if we should use line-based transport (for app compatibility)
    let use_line_transport = env::args().any(|arg| arg == "--line-transport");

    if debug_enabled {
        eprintln!("[Rust Filesystem Server] Starting up...");
        if use_line_transport {
            eprintln!("[Rust Filesystem Server] Using line-based transport");
        }
    }

    // Use --allowed-paths if provided, otherwise fall back to CWD
    let vault_path = parse_allowed_paths()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    if debug_enabled {
        eprintln!("[Rust Filesystem Server] Operating in directory: {:?}", vault_path);
    }

    if debug_enabled {
        info!("Starting MCP Filesystem Server with vault path: {:?}", vault_path);
        eprintln!("[Rust Filesystem Server] Initialized with vault path: {:?}", vault_path);
    }

    // Create and run server
    if use_line_transport {
        // Use line-based transport for app compatibility
        let mut server = server::LineServer::new(vault_path);
        server.run().await?;
    } else {
        // Use standard JSON-RPC transport
        let mut server = McpServer::new(vault_path);
        server.run().await?;
    }

    Ok(())
}