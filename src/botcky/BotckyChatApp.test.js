/**
 * @jest-environment jsdom
 */
import { describe, expect, jest, test, beforeEach } from '@jest/globals';
import {
  archiveTargetSessionIds,
  buildBotckyTranscriptItems,
  displaySessions,
  ensureBotckyStartupSession,
  lastRemainingSessionId,
  nextSessionTitle,
  resetBotckyStartupSessionLocksForTests,
  sessionSelectWidth,
} from './BotckyChatApp.js';
import { createBotckyContextPayload } from './botckyContext.js';

function contextFor(sessionId = 'vault_pending') {
  return createBotckyContextPayload({
    vaultPath: '/vault',
    vaultId: 'vault-id',
    sessionId,
    threadId: sessionId,
    currentFolder: '.',
  });
}

describe('BotckyChatApp session startup', () => {
  beforeEach(() => {
    resetBotckyStartupSessionLocksForTests();
  });

  test('reuses an existing active Vault session instead of creating an empty duplicate on reload', async () => {
    const nativeClient = {
      endpoint: 'http://127.0.0.1:7110',
      sessionId: 'vault_pending',
      listSessions: jest.fn(async () => ({
        sessions: [
          { session_id: 'chs_rust_000120', name: 'Session 1', status: 'active', created_at: '2026-05-02T15:53:47+00:00' },
        ],
      })),
      createSession: jest.fn(),
    };

    await expect(ensureBotckyStartupSession({
      nativeClient,
      contextProvider: async ({ sessionId }) => contextFor(sessionId),
      provisionalSessionId: 'vault_pending',
    })).resolves.toBe('chs_rust_000120');

    expect(nativeClient.sessionId).toBe('chs_rust_000120');
    expect(nativeClient.createSession).not.toHaveBeenCalled();
  });

  test('coalesces concurrent startup calls so one reload creates only one Session 1', async () => {
    let createCount = 0;
    const nativeClient = {
      endpoint: 'http://127.0.0.1:7110',
      sessionId: 'vault_pending',
      listSessions: jest.fn(async () => ({ sessions: [] })),
      createSession: jest.fn(async () => {
        createCount += 1;
        await new Promise(resolve => setTimeout(resolve, 1));
        return { session_id: `created-${createCount}` };
      }),
    };
    const contextProvider = jest.fn(async ({ sessionId }) => contextFor(sessionId));

    const [first, second] = await Promise.all([
      ensureBotckyStartupSession({ nativeClient, contextProvider, provisionalSessionId: 'vault_a' }),
      ensureBotckyStartupSession({ nativeClient, contextProvider, provisionalSessionId: 'vault_b' }),
    ]);

    expect(first).toBe('created-1');
    expect(second).toBe('created-1');
    expect(nativeClient.createSession).toHaveBeenCalledTimes(1);
  });

  test('collapses duplicate race-created Session 1 entries in the dropdown while keeping the current one', () => {
    const sessions = [
      { session_id: 'chs_rust_000120', name: 'Session 1', status: 'active', platform: 'vault', created_at: '2026-05-02T15:53:47+00:00' },
      { session_id: 'chs_rust_000121', name: 'Session 1', status: 'active', platform: 'vault', created_at: '2026-05-02T15:53:53+00:00' },
      { session_id: 'chs_rust_000122', name: 'Session 1', status: 'active', platform: 'vault', created_at: '2026-05-02T15:53:53+00:00' },
      { session_id: 'chs_rust_000123', name: 'Session 1', status: 'active', platform: 'vault', created_at: '2026-05-02T15:53:53+00:00' },
      { session_id: 'chs_rust_000124', name: 'Session 2', status: 'active', platform: 'vault', created_at: '2026-05-02T15:54:00+00:00' },
    ];

    expect(displaySessions(sessions, 'chs_rust_000122').map(session => session.session_id)).toEqual([
      'chs_rust_000122',
      'chs_rust_000124',
    ]);
  });

  test('collapses duplicate generated session labels even when archive gaps created them later', () => {
    const sessions = [
      { session_id: 'older', name: 'Session 3', status: 'active', platform: 'vault', created_at: '2026-05-02T16:13:27+00:00' },
      { session_id: 'current', name: 'Session 3', status: 'active', platform: 'vault', created_at: '2026-05-02T16:14:08+00:00' },
    ];

    expect(displaySessions(sessions, 'current').map(session => session.session_id)).toEqual(['current']);
  });

  test('archives every duplicate backend row for the selected generated session label', () => {
    const sessions = [
      { session_id: 'session-3-a', name: 'Session 3', status: 'active', platform: 'vault', created_at: '2026-05-02T16:13:27+00:00' },
      { session_id: 'session-3-b', name: 'Session 3', status: 'active', platform: 'vault', created_at: '2026-05-02T16:14:08+00:00' },
      { session_id: 'session-4', name: 'Session 4', status: 'active', platform: 'vault', created_at: '2026-05-02T16:17:13+00:00' },
    ];

    expect(archiveTargetSessionIds(sessions, 'session-3-b')).toEqual(['session-3-a', 'session-3-b']);
  });

  test('does not archive unrelated custom same-name sessions as a group', () => {
    const sessions = [
      { session_id: 'alpha-a', name: 'Planning', status: 'active', platform: 'vault' },
      { session_id: 'alpha-b', name: 'Planning', status: 'active', platform: 'vault' },
    ];

    expect(archiveTargetSessionIds(sessions, 'alpha-b')).toEqual(['alpha-b']);
  });

  test('chooses the newest remaining active session after archiving the current session', () => {
    const sessions = [
      { session_id: 'session-4', name: 'Session 4', status: 'active', platform: 'vault', created_at: '2026-05-02T16:17:13+00:00' },
      { session_id: 'session-7', name: 'Session 7', status: 'archived', platform: 'vault', created_at: '2026-05-02T16:22:00+00:00' },
      { session_id: 'session-5', name: 'Session 5', status: 'active', platform: 'vault', created_at: '2026-05-02T16:19:00+00:00' },
      { session_id: 'session-6', name: 'Session 6', status: 'active', platform: 'vault', created_at: '2026-05-02T16:20:00+00:00' },
    ];

    expect(lastRemainingSessionId(sessions, 'session-7')).toBe('session-6');
  });

  test('returns no replacement id after archiving the only active session', () => {
    const sessions = [
      { session_id: 'session-1', name: 'Session 1', status: 'archived', platform: 'vault', created_at: '2026-05-02T16:17:13+00:00' },
    ];

    expect(lastRemainingSessionId(sessions, 'session-1')).toBe('');
  });

  test('chooses the next generated session title from the maximum existing session number', () => {
    expect(nextSessionTitle([
      { label: 'Session 1' },
      { label: 'Session 3' },
    ])).toBe('Session 4');
    expect(nextSessionTitle([
      { name: 'Session 1', status: 'active' },
      { name: 'Session 2', status: 'archived' },
      { name: 'Session 3', status: 'active' },
    ])).toBe('Session 4');
  });

  test('sizes the session dropdown from the selected label length', () => {
    expect(sessionSelectWidth('Session 2')).toBe('calc(9ch + 34px)');
    expect(sessionSelectWidth('A very long session name that should clamp')).toBe('calc(32ch + 34px)');
  });
});


describe('BotckyChatApp transcript grouping', () => {
  test('adds a timestamped thread break before the first message and each new day', () => {
    const items = buildBotckyTranscriptItems([
      { id: 'm1', role: 'assistant', content: 'first', timestamp: '2026-05-02T18:56:32.000Z' },
      { id: 'm2', role: 'user', content: 'same day', timestamp: '2026-05-02T19:01:00.000Z' },
      { id: 'm3', role: 'assistant', content: 'two days later', timestamp: '2026-05-04T13:14:15.000Z' },
    ]);

    expect(items.map(item => item.type)).toEqual(['date', 'message', 'message', 'date', 'message']);
    expect(items.filter(item => item.type === 'date').map(item => item.timestamp)).toEqual([
      '2026-05-02T18:56:32.000Z',
      '2026-05-04T13:14:15.000Z',
    ]);
  });
});
