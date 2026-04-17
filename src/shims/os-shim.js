// Browser shim for Node.js os module
// Provides minimal os compatibility for Claude Agent SDK

export function platform() {
  return 'browser';
}

export function arch() {
  return 'wasm';
}

export function homedir() {
  return '/';
}

export function tmpdir() {
  return '/tmp';
}

export function hostname() {
  return 'localhost';
}

export function type() {
  return 'Browser';
}

export function release() {
  return '1.0.0';
}

export function cpus() {
  return [{ model: 'Browser', speed: 0 }];
}

export function totalmem() {
  return 0;
}

export function freemem() {
  return 0;
}

export function uptime() {
  return 0;
}

export function userInfo() {
  return {
    username: 'browser',
    uid: 0,
    gid: 0,
    shell: null,
    homedir: '/'
  };
}

export function networkInterfaces() {
  return {};
}

export const EOL = '\n';

export default {
  platform,
  arch,
  homedir,
  tmpdir,
  hostname,
  type,
  release,
  cpus,
  totalmem,
  freemem,
  uptime,
  userInfo,
  networkInterfaces,
  EOL
};
