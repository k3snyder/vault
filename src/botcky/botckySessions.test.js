/**
 * @jest-environment jsdom
 */
import { describe, test, expect, jest } from '@jest/globals';
import { BotckySessionClient } from './botckySessions.js';

function completeContext() {
  return {
    active_note: { path: 'a.md', content: 'A' },
    selected_notes: [{ path: 'b.md', content: 'B' }],
    context_notes: [],
    vault_path: '/vault',
    vault_id: 'vault-1',
    session_id: 'session-1',
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

describe('Botcky native session client', () => {
  test('creates sessions with required Vault context and prompt metadata', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ id: 'session-1' }));
    const client = new BotckySessionClient({
      endpoint: 'http://127.0.0.1:7110',
      fetchImpl,
      contextProvider: completeContext,
    });

    await client.createSession({ title: 'Native Botcky' });

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7110/gateway/chat/sessions', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.title).toBe('Native Botcky');
    expect(body.name).toBe('Native Botcky');
    expect(body.platform).toBe('vault');
    expect(body.context.vault_id).toBe('vault-1');
    expect(body.context.current_folder).toBe('/vault/notes');
    expect(body.prompt_metadata.active_note.path).toBe('a.md');
    expect(body.prompt_metadata.selected_notes).toHaveLength(1);
  });

  test('lists sessions with Vault identity query parameters', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse([]));
    const client = new BotckySessionClient({ endpoint: 'http://127.0.0.1:7110', fetchImpl, contextProvider: completeContext });

    await client.listSessions();

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/gateway/chat/sessions');
    expect(url.searchParams.get('vault_id')).toBe('vault-1');
    expect(url.searchParams.get('session_id')).toBe('session-1');
    expect(url.searchParams.get('thread_id')).toBe('thread-1');
    expect(url.searchParams.get('current_folder')).toBe('/vault/notes');
  });

  test('archives sessions and fetches replayable history after a sequence', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ ok: true }));
    const client = new BotckySessionClient({ endpoint: 'http://127.0.0.1:7110', fetchImpl, contextProvider: completeContext });

    await client.archiveSession('session-1');
    await client.getSessionHistory('session-1', { after_seq: 17 });

    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-1/status');
    expect(fetchImpl.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).status).toBe('archived');
    const historyUrl = new URL(fetchImpl.mock.calls[1][0]);
    expect(historyUrl.pathname).toBe('/gateway/chat/sessions/session-1/messages');
    expect(historyUrl.searchParams.get('after_seq')).toBe('17');
    expect(historyUrl.searchParams.get('include_events')).toBe('true');
  });

  test('fails fast when session context is incomplete', async () => {
    const fetchImpl = jest.fn();
    const client = new BotckySessionClient({
      fetchImpl,
      contextProvider: () => ({ ...completeContext(), vault_id: '' }),
    });

    expect(() => client.createSession()).toThrow(/vault_id/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
