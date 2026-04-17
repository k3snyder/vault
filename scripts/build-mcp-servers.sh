#!/bin/bash

# Build MCP Servers Script
# Ensures all Rust MCP servers are compiled before the app starts
# Skips building if binaries already exist (use --force to rebuild)

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_SIDECAR_DIR="$REPO_ROOT/src-tauri/target/debug"

FORCE_BUILD=false
if [[ "$1" == "--force" ]]; then
    FORCE_BUILD=true
fi

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Cargo (Rust) is not installed!"
    echo "Please install Rust from https://rustup.rs/"
    exit 1
fi

# Detect platform for Tauri
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [[ $(uname -m) == "arm64" ]]; then
        SUFFIX="aarch64-apple-darwin"
    else
        SUFFIX="x86_64-apple-darwin"
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    SUFFIX="x86_64-unknown-linux-gnu"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    SUFFIX="x86_64-pc-windows-msvc"
else
    echo "⚠️  Unknown platform, using default suffix"
    SUFFIX="unknown"
fi

# Build each MCP server
servers=("filesystem-server-rust" "search-server-rust")
binary_names=("mcp-filesystem-server" "mcp-search-server")
failed=()
skipped=()
built=()
synced=()

mkdir -p "$DEV_SIDECAR_DIR"

for i in "${!servers[@]}"; do
    server="${servers[$i]}"
    BINARY_NAME="${binary_names[$i]}"
    SERVER_DIR="$REPO_ROOT/mcp-servers/$server"
    RELEASE_BINARY="$SERVER_DIR/target/release/$BINARY_NAME"
    SUFFIXED_BINARY="$SERVER_DIR/target/release/${BINARY_NAME}-${SUFFIX}"
    SHOULD_BUILD="$FORCE_BUILD"

    if [[ "$SHOULD_BUILD" == false ]] && [[ -f "$SUFFIXED_BINARY" ]] && [[ -f "$RELEASE_BINARY" ]]; then
        if find "$SERVER_DIR/src" -type f -newer "$SUFFIXED_BINARY" | grep -q .; then
            SHOULD_BUILD=true
        elif [[ "$SERVER_DIR/Cargo.toml" -nt "$SUFFIXED_BINARY" ]] || [[ "$SERVER_DIR/Cargo.lock" -nt "$SUFFIXED_BINARY" ]]; then
            SHOULD_BUILD=true
        fi
    fi

    # Check if already built (suffixed binary exists)
    if [[ "$SHOULD_BUILD" == false ]] && [[ -f "$SUFFIXED_BINARY" ]] && [[ -f "$RELEASE_BINARY" ]]; then
        skipped+=("$server")
    else
        echo "📦 Building $server..."

        # Navigate to server directory
        cd "$SERVER_DIR" || { echo "❌ Failed to enter $server directory"; exit 1; }

        # Build the server
        cargo build --release || { echo "❌ Failed to build $server"; failed+=("$server"); cd "$REPO_ROOT" > /dev/null; continue; }

        # Create the suffixed binary for Tauri
        if [ -f "target/release/$BINARY_NAME" ]; then
            rm -f "target/release/${BINARY_NAME}-${SUFFIX}"
            cp "target/release/$BINARY_NAME" "target/release/${BINARY_NAME}-${SUFFIX}"

            if [ -f "target/release/${BINARY_NAME}-${SUFFIX}" ]; then
                built+=("$server")
            else
                echo "  ❌ Failed to create ${BINARY_NAME}-${SUFFIX}"
                failed+=("$server")
            fi
        else
            echo "  ❌ Binary not found: target/release/$BINARY_NAME"
            failed+=("$server")
        fi

        cd "$REPO_ROOT" > /dev/null
    fi

    if [ -f "$RELEASE_BINARY" ]; then
        cp "$RELEASE_BINARY" "$DEV_SIDECAR_DIR/$BINARY_NAME"
        synced+=("$server")
    else
        echo "  ❌ Release binary not found for sync: $RELEASE_BINARY"
        failed+=("$server")
        continue
    fi

    if [ -f "$DEV_SIDECAR_DIR/$BINARY_NAME" ]; then
        chmod +x "$DEV_SIDECAR_DIR/$BINARY_NAME"
    else
        echo "  ❌ Failed to sync dev sidecar: $DEV_SIDECAR_DIR/$BINARY_NAME"
        failed+=("$server")
    fi
done

# Summary
if [ ${#failed[@]} -gt 0 ]; then
    echo "❌ Failed to build: ${failed[*]}"
    exit 1
fi

if [ ${#built[@]} -gt 0 ]; then
    echo "✅ Built: ${built[*]}"
fi

if [ ${#skipped[@]} -gt 0 ]; then
    echo "⏭️  Skipped (already built): ${skipped[*]}"
fi

if [ ${#synced[@]} -gt 0 ]; then
    echo "🔄 Synced dev sidecars: ${synced[*]}"
fi

if [ ${#built[@]} -eq 0 ] && [ ${#skipped[@]} -eq ${#servers[@]} ]; then
    echo "✅ All MCP servers already built"
else
    echo "🎉 MCP servers ready!"
fi
