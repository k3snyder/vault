function escapeAttribute(value = '') {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

function normalizePath(path = '') {
  return String(path).replace(/\\/gu, '/');
}

function encodePathSegments(path = '') {
  return normalizePath(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
    .replace(/%3A/gu, ':');
}

export function pathToFileUrl(path = '') {
  const normalized = normalizePath(path);
  if (!normalized) {
    return '';
  }

  const encoded = encodePathSegments(normalized);

  if (/^[A-Za-z]:\//u.test(normalized)) {
    return `file:///${encoded}`;
  }

  if (normalized.startsWith('/')) {
    return `file://${encoded}`;
  }

  return encoded;
}

export function buildHtmlBaseHref(vaultPath = '', filePath = '') {
  const vaultRoot = normalizePath(vaultPath).replace(/\/+$/u, '');
  if (!vaultRoot) {
    return '';
  }

  const relativePath = normalizePath(filePath).replace(/^\/+/u, '');
  const directory = relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : '';

  const absoluteDirectory = directory ? `${vaultRoot}/${directory}` : vaultRoot;
  const withTrailingSlash = absoluteDirectory.endsWith('/')
    ? absoluteDirectory
    : `${absoluteDirectory}/`;

  return pathToFileUrl(withTrailingSlash);
}

export function stripExecutableHtml(html = '') {
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/giu, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/giu, '')
    .replace(/\son[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
    .replace(/\s(href|src)\s*=\s*"[\t\n\f\r ]*javascript:[^"]*"/giu, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*'[\t\n\f\r ]*javascript:[^']*'/giu, " $1='#'");
}

function injectIntoHead(html = '', additions = '') {
  if (/<head\b[^>]*>/iu.test(html)) {
    return html.replace(/<head\b[^>]*>/iu, (match) => `${match}${additions}`);
  }

  if (/<html\b[^>]*>/iu.test(html)) {
    return html.replace(/<html\b[^>]*>/iu, (match) => `${match}<head>${additions}</head>`);
  }

  return `<!DOCTYPE html><html><head>${additions}</head><body>${html}</body></html>`;
}

export function buildSandboxedHtmlDocument(html = '', { baseHref = '' } = {}) {
  const stripped = stripExecutableHtml(html);
  const headAdditions = [
    baseHref ? `<base href="${escapeAttribute(baseHref)}">` : '',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob: file: http: https:; img-src * data: blob: file: http: https:; media-src * data: blob: file: http: https:; style-src 'unsafe-inline' * data: blob: file: http: https:; font-src * data: blob: file: http: https:; object-src 'none'; frame-src data: blob: file: http: https:; script-src 'none';">`,
  ].join('');

  return injectIntoHead(stripped, headAdditions);
}

export function extractHtmlPlainText(html = '') {
  if (typeof DOMParser === 'undefined') {
    return String(html).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
  }

  const document = new DOMParser().parseFromString(String(html), 'text/html');
  return document.body?.textContent?.replace(/\s+/gu, ' ').trim() || '';
}
