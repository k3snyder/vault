import { invoke } from '@tauri-apps/api/core';
import { formatDistanceToNow, format, isToday, isTomorrow, isPast } from 'date-fns';

function isDone(status) {
  if (!status) return false;
  const s = String(status).toLowerCase();
  return s === 'done';
}

function createTidFragment(text) {
  const frag = document.createDocumentFragment();
  const regex = /\[\[\s*(?:TID|tid)\s*:\s*([^\]|\s]+)\s*(?:\|\s*([^\]]+))?\s*\]\]/g;

  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) frag.appendChild(document.createTextNode(before));

    const taskId = match[1];
    const label = match[2] || `TID:${taskId}`;

    const a = document.createElement('a');
    a.href = '#';
    a.className = 'tid-link';
    a.textContent = label;
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const res = await invoke('get_task_source_by_id', { taskId });
        const filePath = res.filePath || res.file_path;
        const lineNumber = res.lineNumber || res.line_number;
        if (filePath && typeof lineNumber === 'number') {
          await invoke('open_file_at_line', { filePath, lineNumber });
        }
      } catch (err) {
        // Swallow navigation errors to avoid breaking UI
        // console.error('[TaskCard] TID navigation failed:', err);
      }
    });

    frag.appendChild(a);
    lastIndex = regex.lastIndex;
  }
  const after = text.slice(lastIndex);
  if (after) frag.appendChild(document.createTextNode(after));
  return frag;
}

function parseLocalYmd(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (m) {
    const [, y, mo, d] = m;
    // Local midnight to avoid timezone drift
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  return new Date(dateStr);
}

function renderDueDate(dueDateStr) {
  if (!dueDateStr) return null;
  const span = document.createElement('span');
  span.className = 'task-due-date';
  const date = parseLocalYmd(dueDateStr);
  if (isToday(date)) {
    span.textContent = 'Today';
    span.classList.add('due-today');
  } else if (isTomorrow(date)) {
    span.textContent = 'Tomorrow';
    span.classList.add('due-tomorrow');
  } else if (isPast(date)) {
    span.textContent = formatDistanceToNow(date, { addSuffix: true });
    span.classList.add('overdue');
  } else {
    span.textContent = format(date, 'MMM d');
  }
  return span;
}

function normalizeDueToken(token) {
  if (!token) return null;
  const t = String(token).trim().toLowerCase();
  const now = new Date();
  const toIso = (d) => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  if (t === 'today') return toIso(now);
  if (t === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return toIso(d); }
  if (t === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return toIso(d); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

function extractDueFromText(text = '') {
  // @due(YYYY-MM-DD) or @due token
  const paren = /@due\s*\(\s*([^\)]+)\s*\)/i.exec(text);
  if (paren) {
    const normalized = normalizeDueToken(paren[1]);
    if (normalized) return normalized;
  }
  const space = /@due\s+([^\s]+)/i.exec(text);
  if (space) {
    const normalized = normalizeDueToken(space[1]);
    if (normalized) return normalized;
  }
  return null;
}

function renderPriority(priorityVal) {
  if (!priorityVal) return null;
  const p = String(priorityVal).toLowerCase();
  const span = document.createElement('span');
  span.className = `task-priority task-priority-${p}`;
  span.title = `Priority: ${p}`;
  span.textContent = p === 'high' ? '!' : p === 'medium' ? '!!' : '!!!';
  return span;
}

function renderTags(tags) {
  const result = [];
  if (!Array.isArray(tags) || tags.length === 0) return result;
  const toShow = tags.slice(0, 3);
  toShow.forEach((tag) => {
    const s = document.createElement('span');
    const isProjectTag = typeof tag === 'string' && tag.toLowerCase().startsWith('project/');
    s.className = `task-tag${isProjectTag ? ' task-tag-project' : ''}`;
    s.textContent = `#${tag}`;
    result.push(s);
  });
  const remaining = tags.length - toShow.length;
  if (remaining > 0) {
    const more = document.createElement('span');
    more.className = 'task-tag';
    more.textContent = `+${remaining}`;
    result.push(more);
  }
  return result;
}

export function createTaskCard(task, handlers = {}) {
  const root = document.createElement('div');
  root.className = 'task-item';
  if (task.id) root.dataset.taskId = task.id;

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = isDone(task.status);
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    if (typeof handlers.onToggle === 'function') {
      handlers.onToggle(task, checkbox.checked);
    }
  });

  // Content container
  const content = document.createElement('div');
  content.className = 'task-content';
  content.addEventListener('click', () => {
    if (typeof handlers.onOpen === 'function') handlers.onOpen(task);
  });

  // Title
  const title = document.createElement('div');
  title.className = 'task-text';
  if (isDone(task.status)) title.classList.add('task-done');
  const titleFrag = createTidFragment(task.text || '');
  title.appendChild(titleFrag);

  // Metadata
  const meta = document.createElement('div');
  meta.className = 'task-metadata';
  const due = renderDueDate(task.dueDate || extractDueFromText(task.text || ''));
  if (due) meta.appendChild(due);
  const pr = renderPriority(task.priority);
  if (pr) meta.appendChild(pr);
  const tagEls = renderTags(task.tags);
  tagEls.forEach((el) => meta.appendChild(el));
  if (meta.children.length === 0) {
    // Keep structure consistent even if empty (some layout relies on presence)
  }

  // Assemble
  content.appendChild(title);
  if (meta.children.length > 0) content.appendChild(meta);
  root.appendChild(checkbox);
  root.appendChild(content);
  return root;
}
