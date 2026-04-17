// Browser shim for Node.js crypto module
// Provides minimal crypto compatibility for Claude Agent SDK

// Use the browser's built-in crypto API
const browserCrypto = globalThis.crypto;

// randomUUID is available in modern browsers
export function randomUUID() {
  return browserCrypto.randomUUID();
}

// randomBytes equivalent using Web Crypto API
export function randomBytes(size) {
  const buffer = new Uint8Array(size);
  browserCrypto.getRandomValues(buffer);
  return buffer;
}

// createHash stub - not fully implemented but prevents import errors
export function createHash(algorithm) {
  return {
    update(data) { return this; },
    digest(encoding) { return ''; }
  };
}

// Export as default and named exports
export default {
  randomUUID,
  randomBytes,
  createHash
};
