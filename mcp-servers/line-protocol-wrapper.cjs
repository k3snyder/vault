#!/usr/bin/env node
const { spawn } = require('child_process');
const readline = require('readline');

// This wrapper translates between line-based JSON protocol and JSON-RPC protocol
// Usage: node line-protocol-wrapper.js <rust-server-binary> [args...]

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node line-protocol-wrapper.js <rust-server-binary> [args...]');
  process.exit(1);
}

const serverBinary = args[0];
const serverArgs = args.slice(1);

console.error(`[Wrapper] Starting ${serverBinary} with args:`, serverArgs);

// Spawn the Rust server
const server = spawn(serverBinary, serverArgs, {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env
});

// Set up readline for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Buffer for accumulating stdout data from server
let stdoutBuffer = Buffer.alloc(0);
let expectedLength = 0;
let readingHeaders = true;
let headers = {};

// Handle stdout from server
server.stdout.on('data', (chunk) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
  
  while (stdoutBuffer.length > 0) {
    if (readingHeaders) {
      // Look for \r\n
      const headerEnd = stdoutBuffer.indexOf('\r\n');
      if (headerEnd === -1) break; // Need more data
      
      const line = stdoutBuffer.slice(0, headerEnd).toString();
      stdoutBuffer = stdoutBuffer.slice(headerEnd + 2);
      
      if (line === '') {
        // Empty line marks end of headers
        readingHeaders = false;
      } else {
        // Parse header
        const match = line.match(/^(.+?):\s*(.+)$/);
        if (match) {
          headers[match[1].toLowerCase()] = match[2];
          if (match[1].toLowerCase() === 'content-length') {
            expectedLength = parseInt(match[2]);
          }
        }
      }
    } else {
      // Reading body
      if (stdoutBuffer.length >= expectedLength) {
        const body = stdoutBuffer.slice(0, expectedLength).toString();
        stdoutBuffer = stdoutBuffer.slice(expectedLength);
        
        // Output the JSON on a single line for the app
        console.log(body);
        
        // Reset for next message
        headers = {};
        expectedLength = 0;
        readingHeaders = true;
      } else {
        // Need more data
        break;
      }
    }
  }
});

// Handle input from app (line-based JSON)
rl.on('line', (line) => {
  try {
    // Parse the JSON
    const message = JSON.parse(line);
    const messageStr = JSON.stringify(message);
    
    // Send to server with JSON-RPC framing
    const header = `Content-Length: ${messageStr.length}\r\n\r\n`;
    server.stdin.write(header);
    server.stdin.write(messageStr);
  } catch (e) {
    console.error('[Wrapper] Failed to parse input:', e.message);
  }
});

// Handle server exit
server.on('exit', (code, signal) => {
  console.error(`[Wrapper] Server exited with code ${code}, signal ${signal}`);
  process.exit(code || 0);
});

// Handle errors
server.on('error', (err) => {
  console.error('[Wrapper] Server error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  server.kill();
  process.exit(0);
});