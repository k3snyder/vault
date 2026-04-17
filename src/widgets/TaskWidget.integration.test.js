import { JSDOM } from 'jsdom';
import { jest } from '@jest/globals';

let TaskWidget;
let coreInvoke;

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  return dom;
}

describe('TaskWidget integrates TaskCard for rendering', () => {
  beforeEach(async () => {
    jest.resetModules();
    setupDom();
    coreInvoke = (await import('@tauri-apps/api/core')).invoke;

    jest.unstable_mockModule('../icons/icon-utils.js', () => ({
      icons: new Proxy({}, {
        get: () => () => '<svg></svg>'
      })
    }));

    // Default mock: return one task with TID link when querying tasks
    coreInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'query_tasks_by_status') {
        return Promise.resolve([
          {
            id: 'abc',
            status: 'todo',
            text: 'Review [[TID:abc|Spec]] before meeting',
            filePath: '/vault/notes/spec.md',
            lineNumber: 12,
            dueDate: '2025-08-31',
            priority: 'high',
            tags: ['review', 'meeting']
          }
        ]);
      }
      if (cmd === 'get_task_source_by_id') {
        return Promise.resolve({ file_path: '/vault/notes/spec.md', line_number: 12 });
      }
      if (cmd === 'open_file_at_line') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    ({ TaskWidget } = await import('./TaskWidget.js'));
  });

  test('renders a card with TID link that triggers navigation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const widget = new TaskWidget();
    widget.mount(container);

    // Allow async loadTasks to complete
    await Promise.resolve();
    await Promise.resolve();

    const tid = document.querySelector('.tid-link');
    expect(tid).toBeTruthy();
    tid.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(coreInvoke).toHaveBeenCalledWith('get_task_source_by_id', { taskId: 'abc' });
    expect(coreInvoke).toHaveBeenCalledWith('open_file_at_line', { filePath: '/vault/notes/spec.md', lineNumber: 12 });

    widget.unmount();
  });

  test('hub mode hides dashboard button and notifies after task open', async () => {
    const onTaskOpen = jest.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const widget = new TaskWidget({
      showDashboardButton: false,
      variant: 'hub',
      onTaskOpen
    });
    widget.mount(container);

    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('.task-widget-hub')).toBeTruthy();
    expect(container.querySelector('.task-dashboard-btn')).toBeFalsy();

    const content = container.querySelector('.task-content');
    expect(content).toBeTruthy();
    content.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(coreInvoke).toHaveBeenCalledWith('open_file_at_line', {
      filePath: '/vault/notes/spec.md',
      lineNumber: 12
    });
    expect(onTaskOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc' }));

    widget.unmount();
  });
});
