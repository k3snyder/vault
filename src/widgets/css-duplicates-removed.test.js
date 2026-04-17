import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const LEGACY_TASKS_CSS = path.join(ROOT, 'src', 'styles', 'tasks.css');

describe('Legacy CSS duplicate removal for TaskWidget', () => {
  test('legacy tasks.css should not define widget container/header selectors', () => {
    const css = fs.readFileSync(LEGACY_TASKS_CSS, 'utf8');
    expect(css).not.toMatch(/\.task-widget\b/);
    expect(css).not.toMatch(/\.task-header\b/);
  });
});

