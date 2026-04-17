// Browser shim for Node.js url module
// Provides basic URL utilities for Claude Agent SDK

// Reference browser's global URL early
const NativeURL = globalThis.URL;

export function fileURLToPath(url) {
  if (typeof url === 'string') {
    if (url.startsWith('file://')) {
      return url.slice(7);
    }
    return url;
  }
  if (url && typeof url.pathname === 'string') {
    return url.pathname;
  }
  return String(url);
}

export function pathToFileURL(path) {
  return new NativeURL('file://' + path);
}

export function parse(urlString) {
  try {
    const url = new NativeURL(urlString);
    return {
      protocol: url.protocol,
      slashes: true,
      auth: url.username ? `${url.username}:${url.password}` : null,
      host: url.host,
      port: url.port,
      hostname: url.hostname,
      hash: url.hash,
      search: url.search,
      query: url.search.slice(1),
      pathname: url.pathname,
      path: url.pathname + url.search,
      href: url.href
    };
  } catch {
    return {};
  }
}

export function format(urlObject) {
  if (typeof urlObject === 'string') return urlObject;
  if (urlObject instanceof NativeURL) return urlObject.href;

  let result = '';
  if (urlObject.protocol) result += urlObject.protocol + '//';
  if (urlObject.auth) result += urlObject.auth + '@';
  if (urlObject.hostname) result += urlObject.hostname;
  if (urlObject.port) result += ':' + urlObject.port;
  if (urlObject.pathname) result += urlObject.pathname;
  if (urlObject.search) result += urlObject.search;
  if (urlObject.hash) result += urlObject.hash;
  return result;
}

export function resolve(from, to) {
  return new NativeURL(to, from).href;
}

// Reference browser's global URLSearchParams
const NativeURLSearchParams = globalThis.URLSearchParams;

export { NativeURL as URL, NativeURLSearchParams as URLSearchParams };

export default {
  fileURLToPath,
  pathToFileURL,
  parse,
  format,
  resolve,
  URL: NativeURL,
  URLSearchParams: NativeURLSearchParams
};
