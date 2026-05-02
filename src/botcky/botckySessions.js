import { collectBotckyContext, buildBotckyPromptMetadata } from './botckyContext.js';
import { defaultFetchImpl, normalizeGatewayBaseUrl } from './botckyGatewayClient.js';

function makeUrl(endpoint = '', path, query = {}) {
  const base = normalizeGatewayBaseUrl(endpoint);
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseResponse(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body?.error || body?.message || `Botcky session request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export class BotckySessionClient {
  constructor({ endpoint = '', fetchImpl = defaultFetchImpl(), contextProvider } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.contextProvider = contextProvider || (() => ({}));
  }

  async request(path, { method = 'GET', query, body } = {}) {
    if (!this.fetchImpl) throw new Error('fetch implementation is required');
    const response = await this.fetchImpl(makeUrl(this.endpoint, path, query), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parseResponse(response);
  }

  sessionContext(overrides = {}) {
    const context = collectBotckyContext({ ...this.contextProvider(), ...overrides });
    return {
      context,
      prompt_metadata: buildBotckyPromptMetadata(context),
    };
  }

  listSessions(overrides = {}) {
    const { context } = this.sessionContext(overrides);
    return this.request('/gateway/chat/sessions', {
      query: {
        vault_id: context.vault_id,
        session_id: context.session_id,
        thread_id: context.thread_id,
        current_folder: context.current_folder,
      },
    });
  }

  createSession({ title, ...overrides } = {}) {
    return this.request('/gateway/chat/sessions', {
      method: 'POST',
      body: {
        platform: 'vault',
        name: title,
        title,
        ...this.sessionContext(overrides),
      },
    });
  }

  archiveSession(sessionId, overrides = {}) {
    if (!sessionId) throw new Error('sessionId is required to archive a Botcky session');
    return this.request(`/gateway/chat/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: 'PATCH',
      body: {
        status: 'archived',
        ...this.sessionContext(overrides),
      },
    });
  }

  getSessionHistory(sessionId, { after_seq, ...overrides } = {}) {
    if (!sessionId) throw new Error('sessionId is required to fetch Botcky session history');
    const { context } = this.sessionContext(overrides);
    return this.request(`/gateway/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
      query: {
        after_seq,
        include_events: true,
        vault_id: context.vault_id,
        thread_id: context.thread_id,
      },
    });
  }
}
