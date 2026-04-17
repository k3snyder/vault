import { readFileSync } from 'node:fs';

const iconFiles = [
  './help-circle.svg',
  './alert-circle.svg',
  './check-circle.svg',
  './edit.svg',
  './loader-2.svg',
  './more-horizontal.svg',
  './more-vertical.svg',
];

describe('lucide icon assets', () => {
  test.each(iconFiles)('%s contains SVG markup instead of a broken 404 payload', (relativePath) => {
    const content = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    expect(content).toContain('<svg');
    expect(content).toContain('</svg>');
    expect(content).not.toContain('404: Not Found');
  });
});
