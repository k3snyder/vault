import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BotckyGatewayNativeClient, botckyHistoryEvents } from './botckyGatewayClient.js';
import { botckyAfterSeq, createInitialBotckyState, reduceBotckyEvent } from './botckyEvents.js';
import { validateBotckyContextPayload } from './botckyContext.js';
import { BotckyMarkdown } from './BotckyMarkdown.js';

const ACTIVE_RUN_LIVENESS_INTERVAL_MS = 1500;
const IDLE_LIVENESS_INTERVAL_MS = 10000;
const CONTEXT_UI_REFRESH_INTERVAL_MS = 1000;
const STREAM_FLUSH_INTERVAL_MS = 80;
const EMPTY_CONTEXT_UI = Object.freeze({
  activeNote: null,
  activeNoteIncluded: false,
  selectedNotes: Object.freeze([]),
});
const defaultContextUiProvider = () => EMPTY_CONTEXT_UI;
const noopContextAction = () => {};
const ICONS = {
  send: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></svg>',
  settings: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z" /></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>',
  check: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>',
  bot: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>',
  archive: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>',
};

const startupSessionLocks = new Map();
const MemoizedBotckyMarkdown = React.memo(BotckyMarkdown, (previous, next) => previous.content === next.content);

function BotckyThinkingIndicator() {
  return React.createElement('span', {
    className: 'botcky-thinking',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Botcky is thinking',
  },
    React.createElement('span', { className: 'botcky-thinking-label' }, 'Thinking'),
    React.createElement('span', { className: 'botcky-thinking-dots', 'aria-hidden': 'true' },
      React.createElement('span', null, '.'),
      React.createElement('span', null, '.'),
      React.createElement('span', null, '.')
    )
  );
}

export function BotckyChatApp({
  endpoint,
  apiKey,
  contextProvider,
  contextUiProvider = defaultContextUiProvider,
  sessionId: initialSessionId,
  onAddContext = noopContextAction,
  onRemoveContext = noopContextAction,
  onRemoveActiveNoteContext = noopContextAction,
  onIncludeActiveNoteContext = noopContextAction,
  onSettings,
}) {
  const [state, setState] = React.useState(createInitialBotckyState);
  const [input, setInput] = React.useState('');
  const [client, setClient] = React.useState(null);
  const [sessionId, setSessionId] = React.useState(initialSessionId || `vault_${Date.now()}`);
  const [sessions, setSessions] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [copiedMessageId, setCopiedMessageId] = React.useState(null);
  const [contextUi, setContextUi] = React.useState(EMPTY_CONTEXT_UI);
  const autoCreatedRef = React.useRef(Boolean(initialSessionId));
  const stateRef = React.useRef(state);
  const transcriptRef = React.useRef(null);
  const pendingStreamEventsRef = React.useRef([]);
  const streamFlushTimerRef = React.useRef(null);
  const scrollbarRevealTimerRef = React.useRef(null);

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshContextUi = React.useCallback(() => {
    try {
      setContextUi(normalizeContextUi(contextUiProvider()));
    } catch (error) {
      console.warn('Failed to refresh Botcky context UI:', error);
      setContextUi(EMPTY_CONTEXT_UI);
    }
  }, [contextUiProvider]);

  React.useEffect(() => {
    refreshContextUi();
    const timer = window.setInterval(refreshContextUi, CONTEXT_UI_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshContextUi]);

  React.useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    window.setTimeout(() => {
      transcript.scrollTop = transcript.scrollHeight;
    }, 0);
  }, [state.messages.length, state.toolCalls.length, state.tasks.length, state.approvals.length, state.error]);

  React.useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return undefined;

    const revealScrollbar = () => {
      transcript.classList.add('is-scrolling');
      if (scrollbarRevealTimerRef.current) {
        window.clearTimeout(scrollbarRevealTimerRef.current);
      }
      scrollbarRevealTimerRef.current = window.setTimeout(() => {
        transcript.classList.remove('is-scrolling');
        scrollbarRevealTimerRef.current = null;
      }, 900);
    };

    transcript.addEventListener('scroll', revealScrollbar, { passive: true });
    return () => {
      transcript.removeEventListener('scroll', revealScrollbar);
      if (scrollbarRevealTimerRef.current) {
        window.clearTimeout(scrollbarRevealTimerRef.current);
        scrollbarRevealTimerRef.current = null;
      }
      transcript.classList.remove('is-scrolling');
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const nativeClient = new BotckyGatewayNativeClient({ endpoint, apiKey, sessionId });
    const unsubscribe = nativeClient.onEvent(async event => {
      if (isStreamingDeltaEvent(event)) {
        queueStreamingEvent(event);
      } else {
        flushStreamingEvents();
        applyBotckyEvent(event);
      }
      if (isToolCallEvent(event)) {
        await handleToolCall(nativeClient, event, contextProvider, sessionId);
      }
    });

    async function startSession() {
      try {
        if (!autoCreatedRef.current) {
          autoCreatedRef.current = true;
          const nextSessionId = await ensureBotckyStartupSession({
            nativeClient,
            contextProvider,
            provisionalSessionId: sessionId,
          });
          if (nextSessionId !== sessionId) {
            if (!disposed) setSessionId(nextSessionId);
            return;
          }
        }
        nativeClient.connect();
        reconcileHistory(nativeClient, stateRef, setState, () => disposed).catch(error => {
          if (!disposed) {
            setState(prev => reduceBotckyEvent(prev, { type: 'error', error: error.message || String(error) }));
          }
        });
        if (!disposed) setClient(nativeClient);
      } catch (error) {
        if (!disposed) {
          setState(prev => reduceBotckyEvent(prev, { type: 'error', error: error.message || String(error) }));
        }
      }
    }

    startSession();
    return () => {
      disposed = true;
      unsubscribe();
      pendingStreamEventsRef.current = [];
      if (streamFlushTimerRef.current) {
        window.clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      nativeClient.close(1000, 'botcky-host-unmount');
      setClient(null);
    };
  }, [endpoint, apiKey, sessionId, contextProvider]);

  React.useEffect(() => {
    if (!client || !state.connected) return undefined;

    let disposed = false;
    const intervalMs = state.activeRunId ? ACTIVE_RUN_LIVENESS_INTERVAL_MS : IDLE_LIVENESS_INTERVAL_MS;
    const tick = async () => {
      if (disposed) return;
      try {
        client.ping();
      } catch {
        return;
      }
      if (stateRef.current.activeRunId) {
        await reconcileHistory(client, stateRef, setState, () => disposed);
      }
    };
    const timer = window.setInterval(() => {
      tick().catch(error => {
        if (!disposed) {
          setState(prev => reduceBotckyEvent(prev, { type: 'error', error: error.message || String(error) }));
        }
      });
    }, intervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [client, state.connected, state.activeRunId]);

  React.useEffect(() => {
    if (!client || !state.connected) return;
    refreshSessions(false).catch(error => {
      setState(prev => reduceBotckyEvent(prev, { type: 'error', error: error.message || String(error) }));
    });
  }, [client, state.connected]);

  const sessionOptions = React.useMemo(() => {
    const seen = new Set();
    const options = [];
    displaySessions(sessions, sessionId).forEach((session, index) => {
      const id = sessionIdentifier(session);
      if (!id || seen.has(id)) return;
      seen.add(id);
      options.push({
        id,
        label: sessionLabel(session, index),
      });
    });
    if (!seen.has(sessionId)) {
      options.unshift({ id: sessionId, label: options.length === 0 ? 'Session 1' : 'Current Session' });
    }
    return options;
  }, [sessions, sessionId]);
  const selectedSessionLabel = sessionOptions.find(option => option.id === sessionId)?.label || 'Session 1';
  const transcriptItems = React.useMemo(() => buildBotckyTranscriptItems(state.messages), [state.messages]);

  function applyBotckyEvent(event) {
    setState(prev => {
      const next = reduceBotckyEvent(prev, event);
      stateRef.current = next;
      return next;
    });
  }

  function queueStreamingEvent(event) {
    pendingStreamEventsRef.current.push(event);
    if (streamFlushTimerRef.current) return;
    streamFlushTimerRef.current = window.setTimeout(flushStreamingEvents, STREAM_FLUSH_INTERVAL_MS);
  }

  function flushStreamingEvents() {
    if (streamFlushTimerRef.current) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }

    const events = pendingStreamEventsRef.current;
    if (events.length === 0) return;
    pendingStreamEventsRef.current = [];
    setState(prev => {
      const next = events.reduce((current, event) => reduceBotckyEvent(current, event), prev);
      stateRef.current = next;
      return next;
    });
  }

  async function createSession() {
    if (!client) return;
    setBusy(true);
    try {
      await createFreshSession(nextSessionTitle(sessionOptions));
    } finally {
      setBusy(false);
    }
  }

  async function createFreshSession(title) {
    const context = await contextProvider({ sessionId, threadId: sessionId, includeNoteContent: false });
    const created = await client.createSession({ vaultId: context.vault_id, title });
    const nextSessionId = created.id || created.session_id || `vault_${Date.now()}`;
    setSessionId(nextSessionId);
    setState(createInitialBotckyState());
    await refreshSessions(false);
    return nextSessionId;
  }

  async function refreshSessions(showBusy = true) {
    if (!client) return;
    if (showBusy) setBusy(true);
    try {
      const response = await client.listSessions();
      setSessions(Array.isArray(response) ? response : response.sessions || []);
    } finally {
      if (showBusy) setBusy(false);
    }
  }

  async function archiveSession() {
    if (!client) return;
    setBusy(true);
    try {
      await exportCurrentThread();
      const activeSessionsBeforeArchive = sessionsFromResponse(await client.listSessions());
      const targetSessionIds = archiveTargetSessionIds(activeSessionsBeforeArchive, sessionId);
      await Promise.all(targetSessionIds.map(targetSessionId => client.archiveSession(targetSessionId)));
      const allSessionsResponse = await client.listSessions({ status: null });
      const allSessions = sessionsFromResponse(allSessionsResponse);
      setSessions(displaySessions(allSessions, sessionId));
      await createFreshSession(nextSessionTitle(allSessions));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession() {
    if (!client) return;
    if (!window.confirm('Delete this Botcky session? This cannot be undone.')) return;
    setBusy(true);
    try {
      await client.deleteSession(sessionId);
      const response = await client.listSessions();
      const remainingSessions = Array.isArray(response) ? response : response.sessions || [];
      setSessions(remainingSessions);
      const remainingOptions = normalizeSessions(remainingSessions)
        .map(session => session.id || session.session_id)
        .filter(Boolean);
      const nextSessionId = remainingOptions.find(id => id !== sessionId);
      if (nextSessionId) {
        setSessionId(nextSessionId);
        setState(createInitialBotckyState());
      } else {
        await createFreshSession('Session 1');
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportCurrentThread() {
    if (!state.messages.length) return null;
    const content = buildBotckyExportMarkdown({
      messages: state.messages,
      sessionId,
      sessionTitle: sessionOptions.find(option => option.id === sessionId)?.label || 'Botcky Session',
    });
    const filePath = await invoke('export_chat_to_vault', {
      content,
      filename: null,
    });
    window.dispatchEvent(new CustomEvent('vault-files-changed'));
    if (window.refreshFileTree) window.refreshFileTree();
    return filePath;
  }

  function selectSession(nextSessionId) {
    if (!nextSessionId || nextSessionId === sessionId) return;
    setSessionId(nextSessionId);
    setState(createInitialBotckyState());
  }

  async function sendMessage(event) {
    event?.preventDefault?.();
    const text = input.trim();
    if (!text || !client) return;
    setInput('');
    setBusy(true);
    try {
      const context = await contextProvider({ sessionId, threadId: sessionId, includeNoteContent: true });
      validateBotckyContextPayload(context);
      await invoke('botcky_validate_context', { context }).catch(() => context);
      setState(prev => ({ ...prev, messages: [...prev.messages, { id: `user_${Date.now()}`, role: 'user', content: text, timestamp: new Date().toISOString() }] }));
      client.sendChat({ text, context });
      window.setTimeout(() => {
        try {
          client.ping();
        } catch {
          // The liveness interval will reconnect/close reporting through the
          // normal socket handlers; the immediate wakeup is best-effort.
        }
      }, 1000);
    } catch (error) {
      setState(prev => reduceBotckyEvent(prev, { type: 'error', error: error.message || String(error) }));
    } finally {
      setBusy(false);
    }
  }

  function cancelRun() {
    if (client && state.activeRunId) client.cancelRun(state.activeRunId);
  }

  function Icon({ name }) {
    return React.createElement('span', {
      className: 'botcky-button-icon',
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: ICONS[name] },
    });
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message.content || '');
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(current => (current === message.id ? null : current)), 2000);
    } catch (error) {
      console.error('Failed to copy Botcky message:', error);
    }
  }

  function renderMessageActions(message) {
    const isCopied = copiedMessageId === message.id;
    const copyLabel = message.role === 'assistant' ? 'Copy response' : 'Copy message';
    return React.createElement('div', { className: 'botcky-message-actions' },
      React.createElement('button', {
        type: 'button',
        className: `botcky-copy-btn${isCopied ? ' copied' : ''}`,
        onClick: () => copyMessage(message),
        title: isCopied ? 'Copied!' : copyLabel,
        'aria-label': isCopied ? 'Copied!' : copyLabel,
      },
        React.createElement(Icon, { name: isCopied ? 'check' : 'copy' })
      ),
      message.timestamp && React.createElement('span', { className: 'botcky-hover-time' }, formatMessageTime(message.timestamp))
    );
  }

  async function handleAddContext() {
    await onAddContext();
    window.setTimeout(refreshContextUi, 0);
  }

  async function handleRemoveActiveNoteContext(note, event) {
    event?.stopPropagation?.();
    await onRemoveActiveNoteContext(note);
    refreshContextUi();
  }

  async function handleIncludeActiveNoteContext(note, event) {
    event?.preventDefault?.();
    await onIncludeActiveNoteContext(note);
    refreshContextUi();
  }

  async function handleRemoveContext(note, event) {
    event?.stopPropagation?.();
    await onRemoveContext(note?.path || note?.title || note?.name || '');
    refreshContextUi();
  }

  function renderContextPill(note, { active = false } = {}) {
    const displayName = contextDisplayName(note);
    return React.createElement('span', {
      key: `${active ? 'active' : 'manual'}-${note.path || displayName}`,
      className: `botcky-context-pill context-pill${active ? ' active-note' : ''}`,
      title: displayName,
    },
      React.createElement('span', { className: 'botcky-context-pill-label' }, displayName),
      React.createElement('button', {
        type: 'button',
        className: 'remove-context',
        onClick: event => (
          active
            ? handleRemoveActiveNoteContext(note, event)
            : handleRemoveContext(note, event)
        ),
        'aria-label': `Remove ${displayName} from context`,
      }, '×')
    );
  }

  function renderExcludedActiveNotePill(note) {
    return React.createElement('button', {
      key: 'active-note-excluded',
      type: 'button',
      className: 'botcky-context-pill context-pill excluded-active-note',
      title: 'Include active note',
      onClick: event => handleIncludeActiveNoteContext(note, event),
    }, 'Active note +');
  }

  function renderContextControls() {
    const hasActiveNote = Boolean(contextUi.activeNote);
    const selectedNotes = contextUi.selectedNotes || [];

    return React.createElement('div', {
      className: 'botcky-context-indicator chat-context-indicator',
      'aria-label': 'Botcky chat context',
    },
      React.createElement('button', {
        type: 'button',
        className: 'add-context-btn',
        onClick: handleAddContext,
      }, '+ Add Context'),
      hasActiveNote && contextUi.activeNoteIncluded
        ? renderContextPill(contextUi.activeNote, { active: true })
        : null,
      hasActiveNote && !contextUi.activeNoteIncluded
        ? renderExcludedActiveNotePill(contextUi.activeNote)
        : null,
      selectedNotes.map(note => renderContextPill(note))
    );
  }

  return React.createElement('div', { className: 'botcky-native-chat', 'data-testid': 'botcky-native-chat' },
    React.createElement('div', { className: 'botcky-toolbar' },
      React.createElement('div', { className: 'botcky-toolbar-title' },
        React.createElement('strong', null, 'Botcky'),
        React.createElement('span', {
          className: state.connected ? 'botcky-status-dot connected' : 'botcky-status-dot',
          title: state.connected ? 'Connected' : 'Offline',
          'aria-label': state.connected ? 'Connected' : 'Offline',
        })
      ),
      React.createElement('select', {
        className: 'botcky-session-select',
        value: sessionId,
        onChange: event => selectSession(event.target.value),
        onFocus: () => {
          refreshSessions(false).catch(error => {
            setState(prev => reduceBotckyEvent(prev, { type: 'error', error: error.message || String(error) }));
          });
        },
        style: { '--botcky-session-select-width': sessionSelectWidth(selectedSessionLabel) },
        disabled: busy,
        'aria-label': 'Botcky session',
      }, sessionOptions.map(option => React.createElement('option', { key: option.id, value: option.id }, option.label))),
      React.createElement('button', {
        type: 'button',
        className: 'chat-toolbar-btn icon-only botcky-toolbar-btn botcky-toolbar-icon-btn',
        onClick: createSession,
        disabled: busy,
        title: 'New session',
        'aria-label': 'New session',
      }, React.createElement(Icon, { name: 'plus' })),
      React.createElement('button', {
        type: 'button',
        className: 'chat-toolbar-btn icon-only botcky-toolbar-btn botcky-toolbar-icon-btn',
        onClick: archiveSession,
        disabled: busy,
        title: 'Archive session',
        'aria-label': 'Archive session',
      }, React.createElement(Icon, { name: 'archive' })),
      React.createElement('button', {
        type: 'button',
        className: 'chat-toolbar-btn icon-only botcky-toolbar-btn botcky-toolbar-icon-btn danger',
        onClick: deleteSession,
        disabled: busy,
        title: 'Delete session',
        'aria-label': 'Delete session',
      }, React.createElement(Icon, { name: 'trash' })),
      state.activeRunId && React.createElement('button', { type: 'button', className: 'chat-toolbar-btn botcky-toolbar-btn', onClick: cancelRun }, 'Cancel'),
      state.activeRunId && React.createElement('span', { className: 'botcky-toolbar-spacer' })
    ),
    React.createElement('div', { className: 'botcky-transcript', ref: transcriptRef },
      transcriptItems.map(item => (
        item.type === 'date'
          ? React.createElement('div', { key: item.key, className: 'botcky-date-separator' }, formatThreadDateTime(item.timestamp))
          : React.createElement('div', { key: item.message.id, className: `botcky-message ${item.message.role}` },
            React.createElement('div', { className: 'botcky-message-stack' },
              React.createElement('div', { className: 'botcky-message-bubble' },
                React.createElement('div', { className: 'botcky-message-content' },
                  item.message.role === 'assistant'
                    ? (
                      item.message.streaming
                        ? React.createElement(BotckyThinkingIndicator)
                        : React.createElement(MemoizedBotckyMarkdown, { content: item.message.content })
                    )
                    : item.message.content
                )
              ),
              item.message.role === 'assistant' && !item.message.streaming && renderMessageActions(item.message)
            )
          )
      )),
      state.toolCalls.map((tool, index) => React.createElement('div', { key: tool.id || tool.call_id || index, className: `botcky-card tool ${tool.status || ''}` },
        React.createElement('strong', null, `Tool: ${tool.name || tool.tool_name || tool.toolName || 'unknown'}`),
        React.createElement('pre', null, JSON.stringify(tool.result || tool.arguments || tool.input || {}, null, 2))
      )),
      state.tasks.map(task => React.createElement('div', { key: task.id, className: `botcky-card task ${task.status || ''}` },
        React.createElement('strong', null, `Task: ${task.id || 'created'}`),
        React.createElement('span', null, task.status || 'created')
      )),
      state.approvals.map((approval, index) => React.createElement('div', { key: approval.approval_id || approval.id || index, className: `botcky-card approval ${approval.status || ''}` },
        React.createElement('strong', null, 'Approval requested'),
        React.createElement('span', null, approval.status || 'pending')
      )),
      state.error && React.createElement('div', { className: 'botcky-error' }, state.error)
    ),
    React.createElement('form', { className: 'botcky-composer', onSubmit: sendMessage },
      renderContextControls(),
      React.createElement('div', { className: 'botcky-composer-input-row' },
        React.createElement('textarea', {
          value: input,
          onChange: event => setInput(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.shiftKey) sendMessage(event);
          },
          placeholder: 'Message Botcky (Enter send, Shift+Enter newline)',
        }),
        React.createElement('button', {
          type: 'submit',
          className: 'botcky-send-btn',
          disabled: busy || !input.trim(),
          title: 'Send message',
          'aria-label': 'Send message',
        }, React.createElement(Icon, { name: 'send' }))
      )
    )
  );
}

function normalizeContextUi(contextUi = {}) {
  const activeNote = contextUi?.activeNote || null;
  return {
    activeNote,
    activeNoteIncluded: Boolean(activeNote && contextUi.activeNoteIncluded !== false),
    selectedNotes: Array.isArray(contextUi?.selectedNotes) ? contextUi.selectedNotes.filter(Boolean) : [],
  };
}

function contextDisplayName(note = {}) {
  return String(note.title || note.name || note.path || 'Untitled').replace(/\.md$/i, '');
}

export function formatMessageTime(timestamp) {
  const date = validDate(timestamp);
  return date ? date.toLocaleTimeString() : '';
}

export function formatThreadDateTime(timestamp) {
  const date = validDate(timestamp);
  if (!date) return '';
  return `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString()}`;
}

export async function ensureBotckyStartupSession({
  nativeClient,
  contextProvider,
  provisionalSessionId,
  title = 'Session 1',
}) {
  const context = await contextProvider({
    sessionId: provisionalSessionId,
    threadId: provisionalSessionId,
    includeNoteContent: false,
  });
  validateBotckyContextPayload(context);
  const lockKey = startupSessionLockKey(nativeClient, context);

  if (!startupSessionLocks.has(lockKey)) {
    const startup = createOrReuseStartupSession(nativeClient, context, title)
      .finally(() => startupSessionLocks.delete(lockKey));
    startupSessionLocks.set(lockKey, startup);
  }

  return startupSessionLocks.get(lockKey);
}

export function resetBotckyStartupSessionLocksForTests() {
  startupSessionLocks.clear();
}

async function createOrReuseStartupSession(nativeClient, context, title) {
  const existingSessions = await listStartupSessions(nativeClient);
  const existingSessionId = reusableStartupSessionId(existingSessions);
  if (existingSessionId) {
    nativeClient.sessionId = existingSessionId;
    return existingSessionId;
  }

  const created = await nativeClient.createSession({
    vaultId: context.vault_id,
    title,
  });
  return created.id || created.session_id || nativeClient.sessionId;
}

async function listStartupSessions(nativeClient) {
  try {
    const response = await nativeClient.listSessions();
    return sessionsFromResponse(response);
  } catch {
    return [];
  }
}

function reusableStartupSessionId(sessions = []) {
  const visible = displaySessions(sessions);
  const newest = visible[visible.length - 1];
  return sessionIdentifier(newest);
}

function startupSessionLockKey(nativeClient, context) {
  return [
    nativeClient?.endpoint || '',
    context?.vault_id || context?.vault_path || 'vault',
  ].join('|');
}

function sessionsFromResponse(response) {
  return Array.isArray(response) ? response : response?.sessions || [];
}

export function normalizeSessions(sessions = []) {
  return [...sessions]
    .filter(session => {
      const status = String(session.status || session.state || '').toLowerCase();
      return status !== 'archived';
    })
    .sort((a, b) => {
      const aTime = validDate(a.created_at || a.createdAt || a.updated_at || a.updatedAt)?.getTime();
      const bTime = validDate(b.created_at || b.createdAt || b.updated_at || b.updatedAt)?.getTime();
      if (aTime === undefined && bTime === undefined) return 0;
      if (aTime === undefined) return 1;
      if (bTime === undefined) return -1;
      return aTime - bTime;
    });
}

export function displaySessions(sessions = [], currentSessionId = '') {
  const normalized = normalizeSessions(sessions);
  const grouped = new Map();

  normalized.forEach(session => {
    const id = sessionIdentifier(session);
    if (!id) return;
    const key = sessionDisplayKey(session);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  });

  const chosenIds = new Set();
  for (const group of grouped.values()) {
    if (!isRaceCreatedDefaultSessionGroup(group)) {
      group.forEach(session => chosenIds.add(sessionIdentifier(session)));
      continue;
    }

    const current = group.find(session => sessionIdentifier(session) === currentSessionId);
    const newest = group.reduce((selected, session) => (
      sessionTimestamp(session) >= sessionTimestamp(selected) ? session : selected
    ), group[0]);
    chosenIds.add(sessionIdentifier(current || newest));
  }

  return normalized.filter(session => chosenIds.has(sessionIdentifier(session)));
}

export function archiveTargetSessionIds(sessions = [], currentSessionId = '') {
  const normalized = normalizeSessions(sessions);
  const current = normalized.find(session => sessionIdentifier(session) === currentSessionId);
  if (!current) return currentSessionId ? [currentSessionId] : [];

  if (!isGeneratedSessionLabel(sessionLabel(current))) {
    return [currentSessionId];
  }

  const currentKey = sessionDisplayKey(current);
  const matchingIds = normalized
    .filter(session => sessionDisplayKey(session) === currentKey)
    .map(sessionIdentifier)
    .filter(Boolean);

  return matchingIds.length > 0 ? matchingIds : [currentSessionId];
}


export function nextSessionTitle(sessionsOrOptions = []) {
  const sessionNumbers = sessionsOrOptions
    .map(item => sessionTitleText(item).match(/^Session\s+(\d+)$/i)?.[1])
    .filter(Boolean)
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0);

  if (sessionNumbers.length > 0) {
    return `Session ${Math.max(...sessionNumbers) + 1}`;
  }

  return `Session ${sessionsOrOptions.length + 1}`;
}

export function sessionSelectWidth(label = '') {
  const text = String(label || 'Session 1').trim() || 'Session 1';
  return `calc(${Math.min(Math.max(text.length, 8), 32)}ch + 34px)`;
}

function sessionIdentifier(session) {
  return session?.id || session?.session_id || '';
}

function sessionLabel(session, index = 0) {
  return sessionTitleText(session) || `Session ${index + 1}`;
}

function sessionTitleText(sessionOrOption = {}) {
  return String(sessionOrOption?.label || sessionOrOption?.name || sessionOrOption?.title || '').trim();
}

function sessionDisplayKey(session) {
  const label = sessionLabel(session).toLowerCase();
  const platform = String(session?.platform || '').toLowerCase();
  const status = String(session?.status || session?.state || 'active').toLowerCase();
  return `${platform}|${status}|${label}`;
}

function isRaceCreatedDefaultSessionGroup(group) {
  if (group.length <= 1) return false;
  return isGeneratedSessionLabel(sessionLabel(group[0]));
}

function isGeneratedSessionLabel(label) {
  return /^session \d+$/i.test(String(label || '').trim());
}

function sessionTimestamp(session) {
  return validDate(session?.created_at || session?.createdAt || session?.updated_at || session?.updatedAt)?.getTime() || 0;
}

function buildBotckyExportMarkdown({ messages = [], sessionId, sessionTitle }) {
  let markdown = '# Botcky Chat Export\n\n';
  markdown += `**Date**: ${new Date().toLocaleString()}\n`;
  markdown += `**Provider**: Botcky\n`;
  markdown += `**Session**: ${sessionTitle || sessionId || 'Botcky Session'}\n`;
  markdown += `**Messages**: ${messages.length}\n\n`;
  markdown += '## Conversation\n\n';

  messages.forEach(message => {
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
    const role = message.role === 'user' ? 'You' : 'Botcky';
    markdown += `### ${role}${timestamp ? ` - ${timestamp}` : ''}\n${message.content || ''}\n\n`;
  });

  return markdown;
}

export function buildBotckyTranscriptItems(messages) {
  const items = [];
  let currentDateKey = null;
  messages.forEach(message => {
    const dateKey = messageDateKey(message.timestamp);
    if (dateKey && dateKey !== currentDateKey) {
      currentDateKey = dateKey;
      items.push({ type: 'date', key: `date-${dateKey}-${message.id}`, timestamp: message.timestamp });
    }
    items.push({ type: 'message', key: message.id, message });
  });
  return items;
}

function messageDateKey(timestamp) {
  const date = validDate(timestamp);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validDate(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function reconcileHistory(client, stateRef, setState, isDisposed = () => false) {
  const afterSeq = botckyAfterSeq(stateRef.current);
  const history = await client.fetchHistory();
  if (isDisposed()) return;
  const events = botckyHistoryEvents(history, afterSeq);
  if (events.length === 0) return;
  setState(prev => {
    const next = events.reduce((state, event) => reduceBotckyEvent(state, event), prev);
    stateRef.current = next;
    return next;
  });
}

function isToolCallEvent(event) {
  return ['tool.call', 'tool_call', 'assistant.tool_call'].includes(event?.type);
}

function isStreamingDeltaEvent(event) {
  return event?.type === 'chat.delta';
}

async function handleToolCall(client, event, contextProvider, sessionId) {
  const name = event.name || event.tool_name || event.toolName;
  const args = event.arguments || event.input || {};
  try {
    const needsFullContext = name === 'executor_task' || name === 'task_create';
    const context = await contextProvider({ sessionId, threadId: sessionId, includeNoteContent: needsFullContext });
    const requestWithScope = {
      vaultRoot: context.vault_path,
      vault_root: context.vault_path,
      currentFolder: context.current_folder,
      current_folder: context.current_folder,
    };
    const result = await invokeForTool(name, args, requestWithScope, context);
    client.sendToolResult({ id: event.id || event.tool_call_id, callId: event.call_id, result });
  } catch (error) {
    client.sendToolResult({ id: event.id || event.tool_call_id, callId: event.call_id, error: error.message || String(error) });
  }
}

async function invokeForTool(name, args, scope, context) {
  switch (name) {
    case 'vault_read_file':
    case 'read':
      return invoke('botcky_read_file', { request: { vault_root: scope.vault_root, current_folder: scope.current_folder, path: args.path } });
    case 'vault_search_files':
    case 'search':
      return invoke('botcky_search_files', { request: { vault_root: scope.vault_root, current_folder: scope.current_folder, query: args.query || args.text || '', limit: args.limit } });
    case 'vault_create_file':
    case 'create':
      return invoke('botcky_create_file', { request: { vault_root: scope.vault_root, current_folder: scope.current_folder, path: args.path, content: args.content || '' } });
    case 'vault_update_file':
    case 'update':
      return invoke('botcky_update_file', { request: { vault_root: scope.vault_root, current_folder: scope.current_folder, path: args.path, content: args.content || '' } });
    case 'vault_append_file':
    case 'append':
      return invoke('botcky_append_file', { request: { vault_root: scope.vault_root, current_folder: scope.current_folder, path: args.path, content: args.content || '' } });
    case 'vault_shell':
    case 'shell':
      return invoke('botcky_run_allowed_command', { request: { vault_root: scope.vault_root, current_folder: scope.current_folder, cwd: args.cwd, command: args.command || '' } });
    case 'executor_task':
    case 'task_create':
      return invoke('botcky_build_executor_task_request', { input: { prompt: args.prompt || args.text || '', agent_type: args.agent_type || 'executor', context } });
    default:
      throw new Error(`Unsupported Botcky tool: ${name}`);
  }
}
