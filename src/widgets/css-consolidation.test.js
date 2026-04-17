import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const STYLE_CSS = path.join(ROOT, 'src', 'style.css');
const CONSOLIDATED_CSS = path.join(ROOT, 'src', 'widgets', 'task-widget.css');

describe('Task Widget CSS Consolidation', () => {
  test('style.css imports consolidated task-widget.css', () => {
    const content = fs.readFileSync(STYLE_CSS, 'utf8');
    expect(content).toMatch(/@import\s+['"]\.\/widgets\/task-widget\.css['"];?/);
  });

  test('consolidated CSS file exists and is reasonably small (<= 400 lines)', () => {
    expect(fs.existsSync(CONSOLIDATED_CSS)).toBe(true);
    const css = fs.readFileSync(CONSOLIDATED_CSS, 'utf8');
    const lines = css.split(/\n/).length;
    expect(lines).toBeLessThanOrEqual(400);
  });

  test('consolidated CSS defines required selectors for TaskWidget', () => {
    const css = fs.readFileSync(CONSOLIDATED_CSS, 'utf8');
    // Accept either legacy .task-* selectors or BEM-friendly .tw-* equivalents
    const requiredSelectors = [
      /\.task-widget|\.tw-widget/,
      /\.task-header|\.tw-header/,
      /\.task-list|\.tw-list/,
      /\.task-item|\.tw-card/,
      /\.task-metadata|\.tw-meta/,
      /\.task-due-date|\.tw-date/,
      /\.task-tag|\.tw-tag/,
    ];
    for (const pattern of requiredSelectors) {
      expect(css).toMatch(pattern);
    }
  });
});

