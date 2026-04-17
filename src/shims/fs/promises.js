// Browser shim for Node.js fs/promises module
// Re-exports the promises object from fs-shim

export async function readFile(path, options) {
  throw new Error('fs.promises.readFile not available in browser');
}

export async function writeFile(path, data, options) {
  throw new Error('fs.promises.writeFile not available in browser');
}

export async function mkdir(path, options) {
  // No-op
}

export async function stat(path) {
  throw new Error('fs.promises.stat not available in browser');
}

export async function access(path, mode) {
  throw new Error('fs.promises.access not available in browser');
}

export async function realpath(path) {
  return path;
}

export async function readdir(path, options) {
  return [];
}

export async function unlink(path) {
  throw new Error('fs.promises.unlink not available in browser');
}

export async function rmdir(path, options) {
  throw new Error('fs.promises.rmdir not available in browser');
}

export async function rm(path, options) {
  throw new Error('fs.promises.rm not available in browser');
}

export async function copyFile(src, dest, mode) {
  throw new Error('fs.promises.copyFile not available in browser');
}

export async function rename(oldPath, newPath) {
  throw new Error('fs.promises.rename not available in browser');
}

// File handle mock for open()
class FileHandle {
  constructor() {
    this.fd = 0;
  }
  async read(buffer, offset, length, position) {
    throw new Error('FileHandle.read not available in browser');
  }
  async write(buffer, offset, length, position) {
    throw new Error('FileHandle.write not available in browser');
  }
  async close() {
    // No-op
  }
  async stat() {
    throw new Error('FileHandle.stat not available in browser');
  }
}

export async function open(path, flags, mode) {
  // Return a mock FileHandle
  return new FileHandle();
}

export default {
  readFile,
  writeFile,
  mkdir,
  stat,
  access,
  realpath,
  readdir,
  unlink,
  rmdir,
  rm,
  copyFile,
  rename,
  open
};
