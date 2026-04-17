# MCP Filesystem Server (Rust)

A high-performance Model Context Protocol (MCP) server implementation in Rust that provides secure filesystem operations within a designated vault directory.

## Features

- **Secure by Design**: All operations are restricted to a designated vault directory with path traversal protection
- **Full Filesystem Operations**: List, read, write, create, delete, move, and search files
- **MCP Protocol Compliant**: Implements the MCP 2024-11-05 protocol specification
- **High Performance**: Built with Rust and Tokio for excellent performance and low resource usage
- **Comprehensive Testing**: Includes extensive test suites for protocol compliance and filesystem operations

## Installation

### Prerequisites

- Rust 1.70 or later
- Cargo

### Building from Source

```bash
cd mcp-servers/filesystem-server-rust
cargo build --release
```

The compiled binary will be available at `target/release/mcp-filesystem-server`.

## Usage

### Running the Server

The server communicates via STDIO and expects a `VAULT_PATH` environment variable:

```bash
VAULT_PATH=/path/to/your/vault ./target/release/mcp-filesystem-server
```

If `VAULT_PATH` is not set, the server will use the current working directory as the vault.

### Integration with MCP Clients

To use this server with an MCP client (like Aura), add it to your MCP configuration:

```json
{
  "mcp-filesystem-rust": {
    "command": "/path/to/mcp-filesystem-server",
    "env": {
      "VAULT_PATH": "/path/to/your/vault"
    }
  }
}
```

## Available Tools

### list_files
List files and directories in a given path within the vault.

**Parameters:**
- `path` (string, optional): Path relative to vault root (default: ".")
- `include_hidden` (boolean, optional): Include hidden files starting with "." (default: false)

### read_file
Read the contents of a file in the vault.

**Parameters:**
- `path` (string, required): Path to file relative to vault root

### write_file
Write or update a file in the vault.

**Parameters:**
- `path` (string, required): Path to file relative to vault root
- `content` (string, required): Content to write to the file

### create_directory
Create a new directory in the vault.

**Parameters:**
- `path` (string, required): Path to directory relative to vault root

### delete_file
Delete a file or empty directory in the vault.

**Parameters:**
- `path` (string, required): Path to file or directory relative to vault root

### move_file
Move or rename a file or directory in the vault.

**Parameters:**
- `source` (string, required): Source path relative to vault root
- `destination` (string, required): Destination path relative to vault root

### search_files
Search for files by name pattern in the vault.

**Parameters:**
- `pattern` (string, required): Search pattern (supports * and ? wildcards)
- `path` (string, optional): Starting path for search (default: ".")

## Available Resources

### vault-info
Provides information about the current vault including path, creation date, modification date, and total file count.

URI: `file://vault-info`

## Security

- All paths are validated to ensure they remain within the vault directory
- Path traversal attempts (e.g., `../../../etc/passwd`) are blocked
- Symlinks are handled safely and cannot escape the vault boundary

## Development

### Running Tests

Run all tests:
```bash
cargo test
```

Run specific test suites:
```bash
# Protocol compliance tests
cargo test --test mcp_protocol_tests_v2

# Filesystem operations tests
cargo test --test filesystem_operations_tests
```

### Debugging

Enable debug logging:
```bash
RUST_LOG=debug VAULT_PATH=/path/to/vault cargo run
```

## Performance

This Rust implementation offers several performance advantages:
- Zero-copy message parsing where possible
- Efficient async I/O with Tokio
- Minimal memory allocations
- Fast regex-based file searching

## Contributing

Contributions are welcome! Please ensure all tests pass and add new tests for any new functionality.

## License

[Same license as the Aura project]