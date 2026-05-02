/**
 * @jest-environment jsdom
 */
import React from 'react';
import { BotckyMarkdown } from './BotckyMarkdown.js';

let renderToStaticMarkup;

beforeAll(async () => {
  ({ renderToStaticMarkup } = await import('react-dom/server.node'));
});

describe('BotckyMarkdown', () => {
  function render(markdown) {
    const html = renderToStaticMarkup(React.createElement(BotckyMarkdown, { content: markdown }));
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  test('renders common assistant markdown as formatted safe HTML nodes', () => {
    const root = render([
      '## Summary',
      '',
      '- **Author:** K3',
      '- **Link:** https://example.com/post',
      '',
      'Use `code` and [docs](https://example.com/docs).',
    ].join('\n'));

    expect(root.querySelector('h2')?.textContent).toBe('Summary');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(root.querySelector('strong')?.textContent).toBe('Author:');
    expect(root.querySelector('code.botcky-inline-code')?.textContent).toBe('code');
    expect(root.querySelector('a[href="https://example.com/post"]')?.textContent).toBe('https://example.com/post');
    expect(root.querySelector('a[href="https://example.com/docs"]')?.textContent).toBe('docs');
  });

  test('does not inject HTML and rejects unsafe markdown links', () => {
    const root = render('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) **safe**');

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(root.querySelector('strong')?.textContent).toBe('safe');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('bad');
    expect(root.textContent).not.toContain('javascript:');
  });

  test('renders repeated model-style 1. items as bullets instead of repeated single-item ordered lists', () => {
    const root = render([
      '1. **Long-form authenticity**',
      '',
      '- Senra says you can’t consume Tim’s books and not feel like you know Tim.',
      '- That creates high-trust distribution.',
      '',
      '1. **Distribution with credibility**',
      '',
      '- Tim has an audience of founders and operators.',
      '',
      '1. **Taste as a filter**',
    ].join('\n'));

    expect(root.querySelector('ol')).toBeNull();
    expect(root.querySelectorAll('ul')).toHaveLength(5);
    expect(root.querySelectorAll('li')).toHaveLength(6);
    expect(root.querySelector('li strong')?.textContent).toBe('Long-form authenticity');
  });

  test('preserves explicitly numbered lists when numbers progress', () => {
    const root = render([
      '1. First',
      '2. Second',
      '3. Third',
    ].join('\n'));

    expect(root.querySelectorAll('ol')).toHaveLength(1);
    expect(root.querySelectorAll('li')).toHaveLength(3);
  });
});
