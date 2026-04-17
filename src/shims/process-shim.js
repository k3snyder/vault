// Browser shim for Node.js process global
// Provides minimal process compatibility for Claude Agent SDK

const processShim = {
  env: {
    NODE_ENV: 'production',
    // Home directory - will be properly set by Tauri path API when available
    // This is a fallback to prevent "undefined" paths
    HOME: '/tmp',
    USERPROFILE: '/tmp',
    // Add any other env vars the SDK might check
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_BASE_URL: ''
  },
  platform: 'browser',
  version: 'v18.0.0',
  versions: {
    node: '18.0.0'
  },
  cwd: () => '/',
  nextTick: (callback, ...args) => {
    queueMicrotask(() => callback(...args));
  },
  stdout: {
    write: (str) => console.log(str),
    isTTY: false
  },
  stderr: {
    write: (str) => console.error(str),
    isTTY: false
  },
  stdin: {
    isTTY: false
  },
  argv: [],
  pid: 1,
  title: 'browser',
  browser: true,
  // Event emitter stubs
  on: () => processShim,
  once: () => processShim,
  off: () => processShim,
  emit: () => false,
  removeListener: () => processShim,
  removeAllListeners: () => processShim,
  listeners: () => [],
  // Exit stub
  exit: (code) => {
    console.warn('process.exit called with code:', code);
  },
  // hrtime for performance timing
  hrtime: (previousTimestamp) => {
    const clocktime = performance.now() * 1e-3;
    let seconds = Math.floor(clocktime);
    let nanoseconds = Math.floor((clocktime % 1) * 1e9);
    if (previousTimestamp) {
      seconds = seconds - previousTimestamp[0];
      nanoseconds = nanoseconds - previousTimestamp[1];
      if (nanoseconds < 0) {
        seconds--;
        nanoseconds += 1e9;
      }
    }
    return [seconds, nanoseconds];
  }
};

// Also set it globally for scripts that access process directly
if (typeof globalThis !== 'undefined') {
  globalThis.process = processShim;
}
if (typeof window !== 'undefined') {
  window.process = processShim;
}

export default processShim;
export const env = processShim.env;
export const platform = processShim.platform;
export const version = processShim.version;
export const versions = processShim.versions;
export const cwd = processShim.cwd;
export const nextTick = processShim.nextTick;
export const stdout = processShim.stdout;
export const stderr = processShim.stderr;
export const stdin = processShim.stdin;
export const argv = processShim.argv;
export const pid = processShim.pid;
export const title = processShim.title;
export const browser = processShim.browser;
export const exit = processShim.exit;
export const hrtime = processShim.hrtime;
