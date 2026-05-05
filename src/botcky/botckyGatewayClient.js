import { botckyAfterSeq } from './botckyEvents.js';

export const DEFAULT_BOTCKY_GATEWAY_ENDPOINT = 'http://127.0.0.1:7110';
export const DEFAULT_LOCAL_BOTCKY_GATEWAY_FRONTEND_KEY = 'dev-gateway-key';

const LEGACY_LOCAL_GATEWAY_PORTS = new Set(['3002', '3005', '7112']);
const LEGACY_CONNECTOR_SECRET_PATTERN = /^[a-f0-9]{64}$/i;

export function normalizeGatewayBaseUrl(endpoint = DEFAULT_BOTCKY_GATEWAY_ENDPOINT) {
  const trimmed = String(endpoint || '').trim() || DEFAULT_BOTCKY_GATEWAY_ENDPOINT;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (isLocalHost(parsed.hostname) && isGatewayRootPath(parsed.pathname)) {
      if (LEGACY_LOCAL_GATEWAY_PORTS.has(parsed.port)) {
        parsed.hostname = '127.0.0.1';
        parsed.port = '7110';
      }
      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}


export function normalizeGatewayApiKey(apiKey, endpoint = DEFAULT_BOTCKY_GATEWAY_ENDPOINT) {
  const key = String(apiKey || '').trim();
  if (isDefaultLocalGateway(endpoint) && (!key || LEGACY_CONNECTOR_SECRET_PATTERN.test(key))) {
    return DEFAULT_LOCAL_BOTCKY_GATEWAY_FRONTEND_KEY;
  }
  return key || null;
}

export function gatewayWsUrl(endpoint, sessionId, afterSeq, apiKey) {
  const base = normalizeGatewayBaseUrl(endpoint);
  const url = new URL(base.startsWith('http') ? base : `http://${base}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/gateway/ws/chat`.replace('//gateway/ws/chat', '/gateway/ws/chat');
  url.searchParams.set('session_id', sessionId);
  if (afterSeq !== undefined && afterSeq !== null) url.searchParams.set('after_seq', String(afterSeq));
  if (apiKey) url.searchParams.set('api_key', apiKey);
  return url.toString();
}

export class BotckyGatewayNativeClient {
  constructor({ endpoint = DEFAULT_BOTCKY_GATEWAY_ENDPOINT, sessionId, apiKey = null, WebSocketCtor = globalThis.WebSocket, fetchImpl = defaultFetchImpl() } = {}) {
    this.endpoint = normalizeGatewayBaseUrl(endpoint);
    this.sessionId = sessionId || `vault_${Date.now()}`;
    this.apiKey = normalizeGatewayApiKey(apiKey, this.endpoint);
    this.WebSocketCtor = WebSocketCtor;
    this.fetchImpl = fetchImpl;
    this.socket = null;
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  connect({ afterSeq } = {}) {
    if (!this.WebSocketCtor) throw new Error('WebSocket is not available');
    this.close(1000, 'reconnect');
    this.socket = new this.WebSocketCtor(gatewayWsUrl(this.endpoint, this.sessionId, afterSeq, this.apiKey));
    this.socket.addEventListener?.('open', () => this.emit({ type: 'socket.open', session_id: this.sessionId }));
    this.socket.addEventListener?.('message', event => this.handleMessage(event.data));
    this.socket.addEventListener?.('error', event => this.emit({ type: 'socket.error', error: event?.message || 'WebSocket error' }));
    this.socket.addEventListener?.('close', event => this.emit({ type: 'socket.close', code: event?.code, reason: event?.reason }));
    return this.socket;
  }

  reconnectFromState(state) {
    return this.connect({ afterSeq: botckyAfterSeq(state) });
  }

  handleMessage(data) {
    try {
      this.emit(typeof data === 'string' ? JSON.parse(data) : data);
    } catch (error) {
      this.emit({ type: 'error', error: `Invalid Gateway event: ${error.message}` });
    }
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error('Botcky Gateway socket is not connected');
    }
    this.socket.send(JSON.stringify(payload));
  }

  sendChat({ text, context, connector = 'vault' }) {
    this.send({ type: 'chat.send', text, connector, platform: connector, context });
  }

  ping() {
    this.send({ type: 'ping', session_id: this.sessionId, ts: Date.now() });
  }

  cancelRun(runId) {
    this.send({ type: 'chat.cancel_run', run_id: runId });
  }

  sendToolResult({ id, callId, result, error }) {
    this.send({ type: 'tool.result', id, call_id: callId, tool_call_id: id || callId, result, error });
  }

  async createSession({ vaultId, title = 'Vault chat', timezone = safeTimezone() } = {}) {
    const response = await this.fetchJson('/gateway/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({
        platform: 'vault',
        name: title,
        title,
        timezone,
        metadata: { vault_id: vaultId },
      }),
    });
    this.sessionId = response.id || response.session_id || this.sessionId;
    return response;
  }

  listSessions({ platform = 'vault', status = 'active', limit } = {}) {
    const query = new URLSearchParams();
    if (platform) query.set('platform', platform);
    if (status) query.set('status', status);
    if (limit !== undefined && limit !== null) query.set('limit', String(limit));
    const suffix = query.toString();
    return this.fetchJson(`/gateway/chat/sessions${suffix ? `?${suffix}` : ''}`);
  }

  archiveSession(sessionId = this.sessionId) {
    return this.fetchJson(`/gateway/chat/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
  }

  deleteSession(sessionId = this.sessionId) {
    return this.fetchJson(`/gateway/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }

  async deleteAllSessions({ platform = 'vault', status = null } = {}) {
    const response = await this.listSessions({ platform, status });
    const sessions = Array.isArray(response) ? response : response.sessions || [];
    const ids = sessions
      .map(session => session?.id || session?.session_id)
      .filter(Boolean);

    await Promise.all(ids.map(id => this.deleteSession(id)));
    return { deleted: ids.length, session_ids: ids };
  }

  fetchHistory(sessionId = this.sessionId) {
    return this.fetchJson(`/gateway/chat/sessions/${encodeURIComponent(sessionId)}/messages?include_events=true`);
  }

  async fetchJson(path, init = {}) {
    if (!this.fetchImpl) throw new Error('fetch is not available');
    const headers = { 'content-type': 'application/json', ...(init.headers || {}) };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
      headers['X-Gateway-Frontend-Key'] = this.apiKey;
      headers['X-API-Key'] = this.apiKey;
    }
    const response = await this.fetchImpl(`${this.endpoint}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(`Botcky Gateway ${response.status}: ${await response.text()}`);
    if (response.status === 204) return {};
    const text = await response.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  close(code = 1000, reason = 'closed') {
    if (this.socket && this.socket.readyState <= 1) {
      this.socket.close(code, reason);
    }
    this.socket = null;
  }
}

export function botckyHistoryEvents(history = {}, afterSeq) {
  const minSeq = Number(afterSeq || 0);
  const directEvents = Array.isArray(history.events) ? history.events : [];
  if (directEvents.length > 0) {
    return directEvents.filter(event => eventSeq(event) > minSeq);
  }
  const messages = Array.isArray(history.messages) ? history.messages : [];
  return messages
    .filter(message => eventSeq(message) > minSeq)
    .map(message => ({
      type: 'chat.message',
      session_id: message.session_id,
      seq: eventSeq(message),
      payload: message,
    }));
}

export function defaultFetchImpl() {
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

function eventSeq(event) {
  const value = Number(event?.seq ?? event?.payload?.seq ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

function isGatewayRootPath(pathname) {
  return ['', '/', '/gateway'].includes(pathname || '');
}

function isDefaultLocalGateway(endpoint) {
  try {
    const parsed = new URL(normalizeGatewayBaseUrl(endpoint));
    return isLocalHost(parsed.hostname) && parsed.port === '7110' && isGatewayRootPath(parsed.pathname);
  } catch {
    return false;
  }
}
