// Browser shim for Node.js fs module
// Provides minimal fs compatibility for Claude Agent SDK
// Most operations are no-ops or return sensible defaults

export function realpathSync(path) {
  // In browser, just return the path as-is
  return path;
}

export function realpath(path, callback) {
  if (callback) {
    callback(null, path);
  }
  return Promise.resolve(path);
}

export function existsSync(path) {
  return false;
}

export function readFileSync(path, options) {
  throw new Error('readFileSync not available in browser');
}

export function writeFileSync(path, data, options) {
  throw new Error('writeFileSync not available in browser');
}

export function mkdirSync(path, options) {
  // No-op in browser
}

export function statSync(path) {
  throw new Error('statSync not available in browser');
}

export function accessSync(path, mode) {
  throw new Error('accessSync not available in browser');
}

export function appendFileSync(path, data, options) {
  console.warn('appendFileSync not available in browser, data discarded');
  // No-op - SDK uses this for logging
}

// Async versions that return promises
export const promises = {
  readFile: async (path, options) => {
    throw new Error('fs.promises.readFile not available in browser');
  },
  writeFile: async (path, data, options) => {
    throw new Error('fs.promises.writeFile not available in browser');
  },
  mkdir: async (path, options) => {
    // No-op
  },
  stat: async (path) => {
    throw new Error('fs.promises.stat not available in browser');
  },
  access: async (path, mode) => {
    throw new Error('fs.promises.access not available in browser');
  },
  realpath: async (path) => {
    return path;
  }
};

// Constants
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1
};

export default {
  realpathSync,
  realpath,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  accessSync,
  appendFileSync,
  promises,
  constants
};
