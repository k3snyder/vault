// Browser shim for Node.js path module
// Provides basic path manipulation for Claude Agent SDK

export function join(...parts) {
  return parts
    .map((part, i) => {
      if (i === 0) {
        return part.replace(/\/*$/, '');
      }
      return part.replace(/(^\/*|\/*$)/g, '');
    })
    .filter(Boolean)
    .join('/');
}

export function resolve(...parts) {
  return join(...parts);
}

export function dirname(p) {
  if (!p) return '.';
  const parts = p.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export function basename(p, ext) {
  if (!p) return '';
  const base = p.split('/').pop() || '';
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}

export function extname(p) {
  if (!p) return '';
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

export function normalize(p) {
  if (!p) return '.';
  const parts = p.split('/').filter(Boolean);
  const result = [];
  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.') {
      result.push(part);
    }
  }
  return (p.startsWith('/') ? '/' : '') + result.join('/');
}

export function isAbsolute(p) {
  return p && p.startsWith('/');
}

export function relative(from, to) {
  // Simplified - just return the to path
  return to;
}

export const sep = '/';
export const delimiter = ':';
export const posix = { sep: '/', delimiter: ':' };
export const win32 = { sep: '\\', delimiter: ';' };

export default {
  join,
  resolve,
  dirname,
  basename,
  extname,
  normalize,
  isAbsolute,
  relative,
  sep,
  delimiter,
  posix,
  win32
};
