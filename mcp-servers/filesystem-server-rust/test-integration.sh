#!/bin/bash

# Test script for MCP Filesystem Server integration

# Build the server in release mode
echo "Building server..."
cargo build --release

# Create a temporary test vault
TEST_VAULT=$(mktemp -d)
echo "Created test vault at: $TEST_VAULT"

# Create some test files
echo "Creating test files..."
echo "Hello, World!" > "$TEST_VAULT/hello.txt"
mkdir -p "$TEST_VAULT/subdir"
echo "Nested content" > "$TEST_VAULT/subdir/nested.txt"

# Test the server with a simple MCP client
echo "Testing server..."

# Create a simple test client script
cat > "$TEST_VAULT/test_client.js" << 'EOF'
const { spawn } = require('child_process');
const readline = require('readline');

const server = spawn('./target/release/mcp-filesystem-server', [], {
  env: { ...process.env, VAULT_PATH: process.env.TEST_VAULT },
  stdio: ['pipe', 'pipe', 'inherit']
});

const rl = readline.createInterface({
  input: server.stdout
});

let requestId = 1;

function sendRequest(request) {
  request.jsonrpc = '2.0';
  request.id = requestId++;
  
  const json = JSON.stringify(request);
  const message = `Content-Length: ${json.length}\r\n\r\n${json}`;
  server.stdin.write(message);
}

// Handle responses
rl.on('line', (line) => {
  if (line.startsWith('Content-Length:')) {
    // Skip the header parsing for this simple test
    return;
  }
  if (line.trim() === '') return;
  
  try {
    const response = JSON.parse(line);
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (e) {
    // Partial JSON, wait for more
  }
});

// Test sequence
setTimeout(() => {
  console.log('1. Initializing...');
  sendRequest({
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
}, 100);

setTimeout(() => {
  console.log('\n2. Listing files...');
  sendRequest({
    method: 'tools/call',
    params: {
      name: 'list_files',
      arguments: { path: '.' }
    }
  });
}, 500);

setTimeout(() => {
  console.log('\n3. Reading file...');
  sendRequest({
    method: 'tools/call',
    params: {
      name: 'read_file',
      arguments: { path: 'hello.txt' }
    }
  });
}, 1000);

setTimeout(() => {
  console.log('\n4. Done!');
  server.kill();
  process.exit(0);
}, 1500);
EOF

# Run the test
cd "$(dirname "$0")"
TEST_VAULT="$TEST_VAULT" node "$TEST_VAULT/test_client.js"

# Cleanup
echo "Cleaning up..."
rm -rf "$TEST_VAULT"

echo "Test complete!"