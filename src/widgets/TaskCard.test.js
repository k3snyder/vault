import { JSDOM } from 'jsdom';
import { jest } from '@jest/globals';

let createTaskCard;
let coreInvoke;

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  return dom;
}

describe('TaskCard component', () => {
  beforeEach(async () => {
    jest.resetModules();
    setupDom();
    // dynamic import after resetting modules
    ({ createTaskCard } = await import('./TaskCard.js'));
    // re-import tauri core mock after reset to get the same instance used by TaskCard
    coreInvoke = (await import('@tauri-apps/api/core')).invoke;
  });

  test('renders title and metadata inline', () => {
    const task = {
      id: 'tid-1',
      text: 'Call client [[TID:abc123|Contract]] about renewal',
      status: 'todo',
      dueDate: '2025-08-31',
      priority: 'high',
      tags: ['client', 'renewal', 'q3']
    };

    const card = createTaskCard(task);
    document.body.appendChild(card);

    const root = document.querySelector('.task-item[data-task-id="tid-1"]');
    expect(root).toBeTruthy();

    const title = root.querySelector('.task-text');
    expect(title).toBeTruthy();
    expect(title.textContent).toContain('Call client');

    const tidLink = root.querySelector('.tid-link');
    expect(tidLink).toBeTruthy();
    expect(tidLink.textContent).toBe('Contract');

    const meta = root.querySelector('.task-metadata');
    expect(meta).toBeTruthy();
    expect(meta.querySelector('.task-priority-high')).toBeTruthy();
    expect(meta.querySelector('.task-due-date')).toBeTruthy();
    const tags = meta.querySelectorAll('.task-tag');
    expect(tags.length).toBeGreaterThanOrEqual(3);
  });

  test('formats due dates intelligently (Today, Tomorrow, past relative, future absolute)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-08-31T12:00:00Z'));

    const cases = [
      { dueDate: '2025-08-31', expectIncludes: 'Today' },
      { dueDate: '2025-09-01', expectIncludes: 'Tomorrow' },
      { dueDate: '2025-08-25', expectIncludes: 'ago' },
      { dueDate: '2025-09-10', expectIncludes: 'Sep' }
    ];

    for (const c of cases) {
      const task = { id: 't', text: 'x', status: 'todo', dueDate: c.dueDate };
      const card = createTaskCard(task);
      document.body.appendChild(card);
      const due = card.querySelector('.task-due-date');
      expect(due).toBeTruthy();
      expect(due.textContent).toEqual(expect.stringContaining(c.expectIncludes));
      card.remove();
    }

    jest.useRealTimers();
  });

  test('applies priority class and label', () => {
    const task = { id: 'p1', text: 'x', status: 'todo', priority: 'medium' };
    const card = createTaskCard(task);
    document.body.appendChild(card);
    const pr = card.querySelector('.task-priority-medium');
    expect(pr).toBeTruthy();
    expect(pr.textContent).toBe('!!');
  });

  test('falls back to parse @due YYYY-MM-DD without parentheses from text when backend dueDate missing', () => {
    const task = { id: 'd-fallback', text: 'Call client @due 2025-09-05', status: 'todo' };
    const card = createTaskCard(task);
    document.body.appendChild(card);
    const due = card.querySelector('.task-due-date');
    expect(due).toBeTruthy();
    expect(due.textContent).toEqual(expect.stringMatching(/Sep|Today|Tomorrow|ago/));
  });

  test('falls back to parse @due(YYYY-MM-DD) from text when backend dueDate missing', () => {
    const task = { id: 'd-fallback2', text: 'Submit report @due(2025-09-06)', status: 'todo' };
    const card = createTaskCard(task);
    document.body.appendChild(card);
    const due = card.querySelector('.task-due-date');
    expect(due).toBeTruthy();
  });

  test('falls back to parse @due(today|tomorrow)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-08-31T12:00:00Z'));
    const taskToday = { id: 'd-today', text: 'Ship build @due(today)', status: 'todo' };
    const cardToday = createTaskCard(taskToday);
    document.body.appendChild(cardToday);
    expect(cardToday.querySelector('.task-due-date').textContent).toContain('Today');

    const taskTomorrow = { id: 'd-tom', text: 'Prep demo @due tomorrow', status: 'todo' };
    const cardTomorrow = createTaskCard(taskTomorrow);
    document.body.appendChild(cardTomorrow);
    expect(cardTomorrow.querySelector('.task-due-date').textContent).toContain('Tomorrow');
    jest.useRealTimers();
  });

  test('shows up to 3 tags and "+n" overflow indicator', () => {
    const task = { id: 'tags', text: 'x', status: 'todo', tags: ['a', 'b', 'c', 'd', 'e'] };
    const card = createTaskCard(task);
    document.body.appendChild(card);
    const tags = Array.from(card.querySelectorAll('.task-tag')).map(n => n.textContent);
    expect(tags.slice(0, 3)).toEqual(['#a', '#b', '#c']);
    expect(tags[3]).toBe('+2');
  });

  test('completed tasks render with strike-through and checked checkbox', () => {
    const doneTask = { id: 'd1', text: 'Done item', status: 'done' };
    const card = createTaskCard(doneTask);
    document.body.appendChild(card);
    const text = card.querySelector('.task-text');
    const checkbox = card.querySelector('.task-checkbox');
    expect(text.classList.contains('task-done')).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  test('clicking TID link navigates via tauri commands', async () => {
    coreInvoke.mockReset();
    coreInvoke
      .mockResolvedValueOnce({ file_path: '/vault/notes/contract.md', line_number: 42 }) // get_task_source_by_id
      .mockResolvedValueOnce(null); // open_file_at_line

    const task = { id: 'tidlink', text: 'See [[TID:abc123|Contract]]', status: 'todo' };
    const card = createTaskCard(task);
    document.body.appendChild(card);

    const link = card.querySelector('.tid-link');
    expect(link).toBeTruthy();
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // Allow any async handlers to run
    await Promise.resolve();

    expect(coreInvoke).toHaveBeenNthCalledWith(1, 'get_task_source_by_id', { taskId: 'abc123' });
    expect(coreInvoke).toHaveBeenNthCalledWith(2, 'open_file_at_line', { filePath: '/vault/notes/contract.md', lineNumber: 42 });
  });
});
