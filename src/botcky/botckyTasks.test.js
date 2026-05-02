/**
 * @jest-environment jsdom
 */
import { describe, test, expect, jest } from '@jest/globals';
import { buildBotckyTaskRequest, BotckyTaskClient } from './botckyTasks.js';

function completeContext() {
  return {
    active_note: { path: 'a.md', title: 'A', content: 'A body', metadata: { line: 1 } },
    selected_notes: [{ path: 'b.md', title: 'B', content: 'B body' }],
    context_notes: [{ path: 'c.md', title: 'C', content: 'C body' }],
    vault_path: '/vault',
    vault_id: 'vault-1',
    session_id: 'chat-session-1',
    thread_id: 'thread-1',
    current_folder: '/vault/notes',
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

describe('Botcky Executor task routing', () => {
  test('builds Executor task request with required Vault/chat/note context', () => {
    const request = buildBotckyTaskRequest({
      title: 'Refactor note',
      instructions: 'Update the active note',
      context: completeContext(),
      task: { priority: 'normal' },
    });

    expect(request).toMatchObject({
      type: 'botcky.executor_task.create',
      title: 'Refactor note',
      instructions: 'Update the active note',
      vault_root: '/vault',
      current_folder: '/vault/notes',
      vault_id: 'vault-1',
      chat_session_id: 'chat-session-1',
      thread_id: 'thread-1',
    });
    expect(request.active_note).toMatchObject({ path: 'a.md', content: 'A body' });
    expect(request.selected_notes[0].path).toBe('b.md');
    expect(request.context_notes[0].path).toBe('c.md');
    expect(request.prompt_metadata.vault_id).toBe('vault-1');
  });

  test('creates task through Gateway task endpoint with context payload', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ id: 'task-1' }));
    const client = new BotckyTaskClient({ endpoint: 'http://127.0.0.1:7110', fetchImpl, contextProvider: completeContext });

    await client.createTask({ title: 'Implement', instructions: 'Do it' });

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7110/gateway/tasks', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.chat_session_id).toBe('chat-session-1');
    expect(body.thread_id).toBe('thread-1');
    expect(body.active_note.path).toBe('a.md');
  });

  test('preserves IDs/root context for task status, cancel, retry, and trace calls', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ ok: true }));
    const client = new BotckyTaskClient({ endpoint: 'http://127.0.0.1:7110', fetchImpl, contextProvider: completeContext });

    await client.listTasks();
    await client.getTask('task-1');
    await client.cancelTask('task-1');
    await client.retryTask('task-1');
    await client.getTaskTrace('task-1');

    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('chat_session_id')).toBe('chat-session-1');
    expect(new URL(fetchImpl.mock.calls[1][0]).pathname).toBe('/gateway/tasks/task-1');
    expect(fetchImpl.mock.calls[2][0]).toBe('http://127.0.0.1:7110/gateway/tasks/task-1/cancel');
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).vault_root).toBe('/vault');
    expect(fetchImpl.mock.calls[3][0]).toBe('http://127.0.0.1:7110/gateway/tasks/task-1/retry');
    expect(new URL(fetchImpl.mock.calls[4][0]).pathname).toBe('/gateway/tasks/task-1/trace');
  });

  test('blocks task creation when required Botcky context is missing', () => {
    expect(() => buildBotckyTaskRequest({ context: { ...completeContext(), current_folder: '' } })).toThrow(/current_folder/);
  });
});
