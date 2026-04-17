/**
 * @jest-environment jsdom
 */

import { describe, expect, it } from '@jest/globals';

import {
  buildHtmlBaseHref,
  buildSandboxedHtmlDocument,
  extractHtmlPlainText,
  stripExecutableHtml,
} from './html-utils.js';

describe('html-utils', () => {
  it('builds a file base href for vault html files', () => {
    const baseHref = buildHtmlBaseHref(
      '/Users/test/My Vault',
      'Sites/Landing Page/index.html'
    );

    expect(baseHref).toBe('file:///Users/test/My%20Vault/Sites/Landing%20Page/');
  });

  it('strips executable html constructs while preserving markup', () => {
    const stripped = stripExecutableHtml(`
      <html>
        <head>
          <script>alert('x')</script>
          <meta http-equiv="refresh" content="0;url=https://example.com">
        </head>
        <body onclick="doBadThing()">
          <a href="javascript:alert('x')">Bad Link</a>
          <h1>Hello</h1>
        </body>
      </html>
    `);

    expect(stripped).not.toContain('<script');
    expect(stripped).not.toContain('http-equiv="refresh"');
    expect(stripped).not.toContain('onclick=');
    expect(stripped).toContain('href="#"');
    expect(stripped).toContain('<h1>Hello</h1>');
  });

  it('injects base href and a no-script CSP into the preview document', () => {
    const document = buildSandboxedHtmlDocument('<body><h1>Hello</h1></body>', {
      baseHref: 'file:///Users/test/Vault/Sites/',
    });

    expect(document).toContain('<base href="file:///Users/test/Vault/Sites/">');
    expect(document).toContain(`script-src 'none'`);
    expect(document).toContain('<h1>Hello</h1>');
  });

  it('extracts visible text from html for copy and word count', () => {
    const plainText = extractHtmlPlainText(`
      <html>
        <body>
          <h1>Landing</h1>
          <p>Hello <strong>world</strong>.</p>
        </body>
      </html>
    `);

    expect(plainText).toBe('Landing Hello world.');
  });
});
