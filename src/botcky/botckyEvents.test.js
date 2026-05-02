import { createInitialBotckyState, reduceBotckyEvent, botckyAfterSeq } from './botckyEvents.js';

describe('Botcky Gateway event reducer', () => {
  test('maps assistant delta and final/completion events', () => {
    let state = createInitialBotckyState();
    state = reduceBotckyEvent(state, { type: 'chat.run.started', run_id: 'run-1', seq: 1 });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'hel', seq: 2 });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'lo', seq: 3 });
    state = reduceBotckyEvent(state, { type: 'chat.run.completed', run_id: 'run-1', seq: 4 });
    expect(state.messages[0].content).toBe('hello');
    expect(state.runs['run-1'].status).toBe('completed');
    expect(botckyAfterSeq(state)).toBe(4);
  });

  test('does not blank streamed assistant text when Gateway persists final chat.message payloads', () => {
    let state = createInitialBotckyState();
    state = reduceBotckyEvent(state, { type: 'chat.accepted', run_id: 'run-1' });
    state = {
      ...state,
      messages: [{ id: 'local-user-1', role: 'user', content: 'hello' }],
    };
    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      session_id: 'session-1',
      seq: 1,
      payload: {
        message_id: 'msg_rust_000001',
        role: 'user',
        content_json: '{"text":"hello"}',
        run_id: 'run-1',
        seq: 1,
      },
    });
    state = reduceBotckyEvent(state, { type: 'chat.run.started', run_id: 'run-1' });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'hi ', seq: 2 });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'there', seq: 3 });
    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      session_id: 'session-1',
      seq: 4,
      payload: {
        message_id: 'msg_rust_000002',
        role: 'assistant',
        content_json: '{"text":"hi there"}',
        run_id: 'run-1',
        seq: 4,
      },
    });
    state = reduceBotckyEvent(state, { type: 'chat.run.completed', run_id: 'run-1', seq: 5 });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ id: 'msg_rust_000001', role: 'user', content: 'hello', runId: 'run-1' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', content: 'hi there', streaming: false });
  });

  test('replays durable history without duplicating optimistic user messages', () => {
    let state = createInitialBotckyState();
    state = {
      ...state,
      messages: [{ id: 'local-user-1', role: 'user', content: 'hello' }],
      activeRunId: 'run-1',
    };

    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      session_id: 'session-1',
      seq: 1,
      payload: {
        message_id: 'msg_rust_000001',
        role: 'user',
        content_json: '{"text":"hello"}',
        run_id: 'run-1',
        seq: 1,
      },
    });
    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      session_id: 'session-1',
      seq: 2,
      payload: {
        message_id: 'msg_rust_000002',
        role: 'assistant',
        content_json: '{"text":"task finished"}',
        run_id: 'task:gwy-1',
        seq: 2,
      },
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ id: 'msg_rust_000001', role: 'user', content: 'hello' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', content: 'task finished', streaming: false });
    expect(state.activeRunId).toBeNull();
  });

  test('keeps message timestamps from durable Gateway payloads', () => {
    let state = {
      ...createInitialBotckyState(),
      messages: [{ id: 'local-user-1', role: 'user', content: 'hello', timestamp: '2026-05-02T12:00:00.000Z' }],
      activeRunId: 'run-1',
    };

    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      seq: 1,
      payload: {
        message_id: 'msg-user',
        role: 'user',
        content_json: '{"text":"hello"}',
        run_id: 'run-1',
        created_at: '2026-05-02T12:01:00.000Z',
      },
    });
    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      seq: 2,
      payload: {
        message_id: 'msg-assistant',
        role: 'assistant',
        content_json: '{"text":"hi"}',
        run_id: 'run-1',
        created_at: '2026-05-02T12:02:00.000Z',
      },
    });

    expect(state.messages[0]).toMatchObject({ role: 'user', timestamp: '2026-05-02T12:01:00.000Z' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', timestamp: '2026-05-02T12:02:00.000Z' });
  });

  test('keeps streamed text if a malformed final persisted message has empty content', () => {
    let state = createInitialBotckyState();
    state = reduceBotckyEvent(state, { type: 'chat.run.started', run_id: 'run-1', seq: 1 });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'visible response', seq: 2 });
    state = reduceBotckyEvent(state, {
      type: 'chat.message',
      seq: 3,
      payload: { role: 'assistant', run_id: 'run-1', content_json: '' },
    });

    expect(state.messages[0]).toMatchObject({ role: 'assistant', content: 'visible response', streaming: false });
  });

  test('maps tool, task, approval, failure, and cancellation events', () => {
    let state = createInitialBotckyState();
    state = reduceBotckyEvent(state, { type: 'tool.call', id: 'tool-1', name: 'read', seq: 1 });
    state = reduceBotckyEvent(state, { type: 'tool.result', id: 'tool-1', result: { ok: true }, seq: 2 });
    state = reduceBotckyEvent(state, { type: 'task.created', task_id: 'task-1', seq: 3 });
    state = reduceBotckyEvent(state, { type: 'approval.requested', approval_id: 'approval-1', seq: 4 });
    state = reduceBotckyEvent(state, { type: 'chat.run.started', run_id: 'run-2', seq: 5 });
    state = reduceBotckyEvent(state, { type: 'chat.run.cancelled', run_id: 'run-2', seq: 6 });
    state = reduceBotckyEvent(state, { type: 'chat.run.failed', run_id: 'run-3', error: 'boom', seq: 7 });
    expect(state.toolCalls[0].status).toBe('completed');
    expect(state.tasks[0].id).toBe('task-1');
    expect(state.approvals[0].status).toBe('pending');
    expect(state.runs['run-2'].status).toBe('cancelled');
    expect(state.error).toBe('boom');
  });

  test('deduplicates replayed or out-of-order events', () => {
    let state = createInitialBotckyState();
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'a', seq: 3 });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'b', seq: 3 });
    state = reduceBotckyEvent(state, { type: 'chat.delta', run_id: 'run-1', text: 'c', seq: 2 });
    expect(state.messages[0].content).toBe('a');
  });

  test('does not treat Gateway control seq zero as an out-of-order durable chat seq', () => {
    let state = createInitialBotckyState();
    state = reduceBotckyEvent(state, { type: 'chat.run.started', run_id: 'run-1', seq: 1 });
    state = reduceBotckyEvent(state, { type: 'chat.run.completed', seq: 0 });

    expect(state.activeRunId).toBeNull();
    expect(state.runs['run-1'].status).toBe('completed');
    expect(botckyAfterSeq(state)).toBe(1);
  });
});
