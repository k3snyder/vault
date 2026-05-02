export const BOTCKY_INITIAL_STATE = Object.freeze({
  messages: [],
  toolCalls: [],
  tasks: [],
  approvals: [],
  runs: {},
  seenSeq: [],
  activeRunId: null,
  connected: false,
  error: null,
});

export function createInitialBotckyState() {
  return {
    messages: [],
    toolCalls: [],
    tasks: [],
    approvals: [],
    runs: {},
    seenSeq: [],
    activeRunId: null,
    connected: false,
    error: null,
  };
}

export function reduceBotckyEvent(state = createInitialBotckyState(), event = {}) {
  const eventSeq = positiveSeq(event.seq);
  if (eventSeq !== undefined && state.seenSeq.includes(eventSeq)) {
    return state;
  }
  if (eventSeq !== undefined && state.seenSeq.length > 0) {
    const last = Math.max(...state.seenSeq);
    if (eventSeq < last) return state;
  }
  const next = {
    ...state,
    messages: [...state.messages],
    toolCalls: [...state.toolCalls],
    tasks: [...state.tasks],
    approvals: [...state.approvals],
    runs: { ...state.runs },
    seenSeq: eventSeq !== undefined ? [...state.seenSeq, eventSeq] : [...state.seenSeq],
  };

  switch (event.type) {
    case 'socket.open':
      next.connected = true;
      next.error = null;
      return next;
    case 'socket.close':
      next.connected = false;
      return next;
    case 'pong':
    case 'heartbeat':
      return state;
    case 'chat.accepted':
      next.activeRunId = event.run_id || event.payload?.run_id || next.activeRunId;
      return next;
    case 'chat.run.started': {
      const runId = event.run_id;
      next.activeRunId = runId;
      next.runs[runId] = { status: 'running', text: '' };
      return next;
    }
    case 'chat.delta': {
      const runId = event.run_id || next.activeRunId || 'current';
      const run = next.runs[runId] || { status: 'running', text: '' };
      const text = event.text || event.delta || '';
      next.runs[runId] = { ...run, status: 'running', text: `${run.text || ''}${text}` };
      upsertAssistantMessage(next.messages, runId, next.runs[runId].text, true, chatMessageTimestamp(event));
      return next;
    }
    case 'chat.message':
    case 'assistant.message':
    case 'chat.final': {
      const role = chatMessageRole(event);
      if (role === 'user') {
        upsertUserMessage(next.messages, event);
        return next;
      }
      const runId = chatMessageRunId(event, next.activeRunId);
      const text = chatMessageText(event);
      next.runs[runId] = { ...(next.runs[runId] || {}), status: 'completed', text };
      upsertAssistantMessage(next.messages, runId, text, false, chatMessageTimestamp(event));
      next.activeRunId = null;
      return next;
    }
    case 'chat.run.completed': {
      const runId = event.run_id || next.activeRunId;
      if (runId) {
        next.runs[runId] = { ...(next.runs[runId] || {}), status: 'completed' };
        finalizeAssistantMessage(next.messages, runId);
      }
      next.activeRunId = null;
      return next;
    }
    case 'chat.run.cancelled': {
      const runId = event.run_id || next.activeRunId;
      if (runId) next.runs[runId] = { ...(next.runs[runId] || {}), status: 'cancelled' };
      next.activeRunId = null;
      return next;
    }
    case 'chat.run.failed':
    case 'error': {
      const runId = event.run_id || next.activeRunId;
      if (runId) next.runs[runId] = { ...(next.runs[runId] || {}), status: 'failed', error: event.error || event.detail };
      next.error = event.error || event.detail || 'Botcky failed';
      next.activeRunId = null;
      return next;
    }
    case 'tool.call':
    case 'tool_call':
    case 'assistant.tool_call':
      next.toolCalls.push({ status: 'running', ...event });
      return next;
    case 'tool.result':
    case 'tool_result':
      next.toolCalls = next.toolCalls.map(call => {
        const sameId = call.id && (call.id === event.id || call.id === event.tool_call_id);
        const sameCall = call.call_id && call.call_id === event.call_id;
        return sameId || sameCall ? { ...call, ...event, status: 'completed' } : call;
      });
      if (!next.toolCalls.some(call => call.id === event.id || call.call_id === event.call_id)) {
        next.toolCalls.push({ status: 'completed', ...event });
      }
      return next;
    case 'task.created':
    case 'task.status':
    case 'task.completed':
    case 'task.failed': {
      const id = event.task_id || event.id || event.payload?.id;
      const task = { id, status: statusFromTaskEvent(event), ...event };
      const index = next.tasks.findIndex(existing => existing.id === id);
      if (index >= 0) next.tasks[index] = { ...next.tasks[index], ...task };
      else next.tasks.push(task);
      return next;
    }
    case 'approval.requested':
      next.approvals.push({ status: 'pending', ...event });
      return next;
    case 'approval.resolved':
      next.approvals = next.approvals.map(approval => (
        approval.approval_id === event.approval_id || approval.id === event.approval_id
          ? { ...approval, ...event, status: 'resolved' }
          : approval
      ));
      return next;
    default:
      return next;
  }
}

export function botckyAfterSeq(state) {
  return state?.seenSeq?.length ? Math.max(...state.seenSeq) : undefined;
}

function positiveSeq(seq) {
  if (seq === undefined || seq === null) return undefined;
  const value = Number(seq);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function upsertAssistantMessage(messages, runId, text, streaming, timestamp) {
  const existing = messages.find(message => message.runId === runId && message.role === 'assistant');
  const content = String(text || '');
  if (existing) {
    if (content || !existing.content) {
      existing.content = content;
    }
    existing.streaming = streaming;
    if (timestamp) existing.timestamp = timestamp;
    return;
  }
  messages.push({ id: runId, runId, role: 'assistant', content, streaming, timestamp: timestamp || new Date().toISOString() });
}

function upsertUserMessage(messages, event) {
  const messageId = event.message_id || event.payload?.message_id;
  const runId = chatMessageRunId(event, null);
  const content = chatMessageText(event);
  if (!content) return;

  const existingById = messages.find(message => (
    message.role === 'user' && (
      (messageId && (message.messageId === messageId || message.id === messageId)) ||
      (runId && message.runId === runId)
    )
  ));
  if (existingById) {
    existingById.id = messageId || existingById.id;
    existingById.messageId = messageId || existingById.messageId;
    existingById.runId = runId || existingById.runId;
    existingById.content = content;
    return;
  }

  const optimisticIndex = findOptimisticUserIndex(messages, content);
  if (optimisticIndex >= 0) {
    messages[optimisticIndex] = {
      ...messages[optimisticIndex],
      id: messageId || messages[optimisticIndex].id,
      messageId: messageId || messages[optimisticIndex].messageId,
      runId: runId || messages[optimisticIndex].runId,
      content,
      timestamp: chatMessageTimestamp(event) || messages[optimisticIndex].timestamp,
    };
    return;
  }

  messages.push({
    id: messageId || runId || `user_${Date.now()}`,
    messageId,
    runId,
    role: 'user',
    content,
    streaming: false,
    timestamp: chatMessageTimestamp(event) || new Date().toISOString(),
  });
}

function findOptimisticUserIndex(messages, content) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === 'user' &&
      !message.messageId &&
      !message.runId &&
      message.content === content
    ) {
      return index;
    }
  }
  return -1;
}

function finalizeAssistantMessage(messages, runId) {
  const existing = messages.find(message => message.runId === runId && message.role === 'assistant');
  if (existing) existing.streaming = false;
}

function statusFromTaskEvent(event) {
  if (event.type === 'task.completed') return 'completed';
  if (event.type === 'task.failed') return 'failed';
  return event.status || event.payload?.status || 'created';
}

function chatMessageRole(event) {
  return String(event.role || event.payload?.role || 'assistant').toLowerCase();
}

function chatMessageRunId(event, activeRunId) {
  return event.run_id || event.payload?.run_id || activeRunId || event.message_id || event.payload?.message_id || `msg_${Date.now()}`;
}

function chatMessageText(event) {
  return firstString(
    event.text,
    event.content,
    event.payload?.text,
    event.payload?.content,
    contentJsonText(event.content_json),
    contentJsonText(event.payload?.content_json),
  );
}

function chatMessageTimestamp(event) {
  return firstString(
    event.timestamp,
    event.created_at,
    event.createdAt,
    event.payload?.timestamp,
    event.payload?.created_at,
    event.payload?.createdAt,
  );
}

function contentJsonText(contentJson) {
  if (!contentJson) return '';
  const payload = typeof contentJson === 'string' ? safeJsonParse(contentJson) : contentJson;
  if (!payload || typeof payload !== 'object') return '';
  return firstString(
    payload.text,
    payload.content,
    Array.isArray(payload.parts) ? payload.parts.map(part => part?.text || part?.content || '').join('') : '',
    Array.isArray(payload.content)
      ? payload.content.map(part => (typeof part === 'string' ? part : part?.text || part?.content || '')).join('')
      : '',
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
