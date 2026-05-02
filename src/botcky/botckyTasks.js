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
    const error = new Error(body?.error || body?.message || `Botcky task request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function noteMetadata(note) {
  if (!note || typeof note !== 'object') return note;
  return {
    path: note.path,
    title: note.title,
    id: note.id,
    content: note.content,
    metadata: note.metadata,
  };
}

export function buildBotckyTaskRequest({ title, instructions, context: contextSource = {}, task = {} } = {}) {
  const context = collectBotckyContext(contextSource);
  const prompt_metadata = buildBotckyPromptMetadata(context);

  return {
    type: 'botcky.executor_task.create',
    title,
    instructions,
    task,
    vault_root: context.vault_path,
    current_folder: context.current_folder,
    vault_id: context.vault_id,
    chat_session_id: context.session_id,
    thread_id: context.thread_id,
    active_note: noteMetadata(context.active_note),
    selected_notes: context.selected_notes.map(noteMetadata),
    context_notes: context.context_notes.map(noteMetadata),
    context,
    prompt_metadata,
  };
}

export class BotckyTaskClient {
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

  createTask(options = {}) {
    return this.request('/gateway/tasks', {
      method: 'POST',
      body: buildBotckyTaskRequest({ ...options, context: options.context || this.contextProvider() }),
    });
  }

  listTasks(overrides = {}) {
    const context = collectBotckyContext({ ...this.contextProvider(), ...overrides });
    buildBotckyPromptMetadata(context);
    return this.request('/gateway/tasks', {
      query: {
        vault_id: context.vault_id,
        chat_session_id: context.session_id,
        thread_id: context.thread_id,
        current_folder: context.current_folder,
      },
    });
  }

  getTask(taskId, overrides = {}) {
    if (!taskId) throw new Error('taskId is required');
    const context = collectBotckyContext({ ...this.contextProvider(), ...overrides });
    buildBotckyPromptMetadata(context);
    return this.request(`/gateway/tasks/${encodeURIComponent(taskId)}`, {
      query: { vault_id: context.vault_id, thread_id: context.thread_id },
    });
  }

  cancelTask(taskId, overrides = {}) {
    if (!taskId) throw new Error('taskId is required');
    return this.request(`/gateway/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      body: buildBotckyTaskRequest({ context: { ...this.contextProvider(), ...overrides }, task: { id: taskId } }),
    });
  }

  retryTask(taskId, overrides = {}) {
    if (!taskId) throw new Error('taskId is required');
    return this.request(`/gateway/tasks/${encodeURIComponent(taskId)}/retry`, {
      method: 'POST',
      body: buildBotckyTaskRequest({ context: { ...this.contextProvider(), ...overrides }, task: { id: taskId } }),
    });
  }

  getTaskTrace(taskId, overrides = {}) {
    if (!taskId) throw new Error('taskId is required');
    const context = collectBotckyContext({ ...this.contextProvider(), ...overrides });
    buildBotckyPromptMetadata(context);
    return this.request(`/gateway/tasks/${encodeURIComponent(taskId)}/trace`, {
      query: { vault_id: context.vault_id, thread_id: context.thread_id },
    });
  }
}
