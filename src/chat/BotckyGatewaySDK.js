// BotckyGatewaySDK.js - Botcky Vault connector integration wrapper
// This module preserves the existing chat UI contract:
// - async generator chat()
// - chunk / tool_use / tool_result / result / error / aborted
// - persistent connection with reconnect support

import { invoke } from '@tauri-apps/api/core';

const DEFAULT_CONNECTOR_URL = 'http://localhost:3005';
const DEFAULT_MODEL = 'botcky-agent';
const DEFAULT_USER_ID = 'vault-user';
const DEFAULT_WORKSPACE_ID = 'vault-desktop';
const DEFAULT_THREAD_ID = 'main';
const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_CONTEXT_CHAR_LIMIT = 8000;
const MAX_CONTEXT_CHAR_LIMIT = 500000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const CONNECTION_TIMEOUT_MS = 10000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const FATAL_CLOSE_CODES = new Set([1008, 4001, 4003, 4004]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeString(value, fallback = '') {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim());
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function stripTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : '';
}

function normalizeBotckyConnectorUrl(url) {
  const normalized = normalizeString(url, DEFAULT_CONNECTOR_URL);
  if (!normalized) {
    return DEFAULT_CONNECTOR_URL;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.port === '3002' && ['', '/', '/gateway'].includes(parsed.pathname || '')) {
      parsed.port = '3005';
      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    // Keep the original value when URL parsing fails.
  }

  return normalized;
}

function toWebSocketUrl(url) {
  const trimmed = stripTrailingSlash(normalizeBotckyConnectorUrl(url || DEFAULT_CONNECTOR_URL));

  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed;
  }

  if (trimmed.startsWith('https://')) {
    return `wss://${trimmed.slice('https://'.length)}`;
  }

  if (trimmed.startsWith('http://')) {
    return `ws://${trimmed.slice('http://'.length)}`;
  }

  return `ws://${trimmed}`;
}

function joinUrlPath(basePath, segment) {
  const left = basePath || '';
  const right = segment || '';
  return `${left.replace(/\/+$/, '')}/${right.replace(/^\/+/, '')}`;
}

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function safeClone(value) {
  if (value === null || value === undefined) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function extractText(payload) {
  if (!payload) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload.text === 'string') {
    return payload.text;
  }

  if (typeof payload.content === 'string') {
    return payload.content;
  }

  if (typeof payload.response === 'string') {
    return payload.response;
  }

  if (typeof payload.message === 'string') {
    return payload.message;
  }

  if (payload.message && typeof payload.message.text === 'string') {
    return payload.message.text;
  }

  if (typeof payload.delta === 'string') {
    return payload.delta;
  }

  if (payload.delta && typeof payload.delta.text === 'string') {
    return payload.delta.text;
  }

  if (typeof payload.output === 'string') {
    return payload.output;
  }

  if (typeof payload.summary === 'string') {
    return payload.summary;
  }

  if (Array.isArray(payload.content)) {
    return payload.content
      .map(block => {
        if (typeof block === 'string') {
          return block;
        }

        if (block && typeof block.text === 'string') {
          return block.text;
        }

        return '';
      })
      .join('');
  }

  return '';
}

function extractMessageText(message, payload) {
  if (message && typeof message.content === 'string') {
    return message.content;
  }

  return extractText(payload);
}

function extractToolInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const rawInput =
    payload.input ??
    payload.tool_input ??
    payload.toolInput ??
    payload.arguments ??
    payload.args ??
    payload.payload ??
    payload.data ??
    payload;

  if (typeof rawInput === 'string') {
    return safeJsonParse(rawInput, { text: rawInput }) || { text: rawInput };
  }

  return safeClone(rawInput) || {};
}

function extractId(payload, fallbackPrefix = 'botcky') {
  if (!payload || typeof payload !== 'object') {
    return `${fallbackPrefix}_${Date.now()}`;
  }

  const candidate =
    payload.id ??
    payload.gateway_task_id ??
    payload.gatewayTaskId ??
    payload.task_id ??
    payload.taskId ??
    payload.tool_call_id ??
    payload.toolCallId ??
    payload.approval_id ??
    payload.approvalId;

  if (candidate !== undefined && candidate !== null && `${candidate}`.trim()) {
    return `${candidate}`;
  }

  return `${fallbackPrefix}_${Date.now()}`;
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function deriveVaultId(vaultPath) {
  const normalized = normalizeString(vaultPath, '');
  if (!normalized) {
    return 'vault-default';
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] || 'vault';
  return `${name}:${hashString(normalized)}`;
}

function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function parseConnectorMessage(rawMessage) {
  const parsed = typeof rawMessage === 'string' ? safeJsonParse(rawMessage, rawMessage) : rawMessage;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  return parsed;
}

function resolveToolName(message, payload = {}) {
  const gatewayEventType = normalizeString(
    message?.gateway_event_type || message?.gatewayEventType || message?.event_type || message?.eventType,
    '',
  );
  const nestedResult = isObject(payload?.result) ? payload.result : {};

  if (gatewayEventType === 'approval.requested') {
    return 'approval_request';
  }

  if (gatewayEventType === 'approval.resolved') {
    return 'approval_resolve';
  }

  if (gatewayEventType === 'task.created') {
    return 'task_create';
  }

  if (gatewayEventType === 'task.update') {
    return 'task_update';
  }

  if (gatewayEventType === 'schedule.created') {
    return 'schedule_create';
  }

  if (nestedResult.gateway_task_id || nestedResult.gatewayTaskId) {
    return 'task_create_now';
  }

  if (nestedResult.schedule_id || nestedResult.scheduleId) {
    return 'task_schedule';
  }

  if (nestedResult.approval_id || nestedResult.approvalId) {
    return nestedResult.decision === 'accepted' ? 'approval_resolve' : 'approval_request';
  }

  if (nestedResult.question) {
    return 'task_ask_clarify';
  }

  return (
    payload.toolName ||
    payload.tool_name ||
    payload.name ||
    payload.tool ||
    'botcky_event'
  );
}

function buildAssistantContent(text) {
  if (!text) {
    return [];
  }

  return [{ type: 'text', text }];
}

function normalizeTaskIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim());
}

function getTaskMetaKey(taskMeta) {
  if (!taskMeta || typeof taskMeta !== 'object') {
    return '';
  }

  const gatewayTaskId = normalizeString(taskMeta.gateway_task_id || taskMeta.gatewayTaskId, '');
  if (gatewayTaskId) {
    return `task:${gatewayTaskId}`;
  }

  const groupId = normalizeString(taskMeta.group_id || taskMeta.groupId, '');
  if (groupId) {
    return `group:${groupId}`;
  }

  return '';
}

function extractTaskCreatedMeta(action) {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const result = isObject(action.result) ? action.result : {};
  const toolInput = isObject(action.toolInput) ? action.toolInput : {};
  const gatewayTaskId = normalizeString(result.gateway_task_id || result.gatewayTaskId, '');
  const groupId = normalizeString(result.group_id || result.groupId, '');

  if (!gatewayTaskId && !groupId) {
    return null;
  }

  const meta = {
    name: normalizeString(
      toolInput.name || result.name,
      gatewayTaskId ? 'Task created' : 'Fan-out task group created',
    ),
  };

  if (gatewayTaskId) {
    meta.gateway_task_id = gatewayTaskId;
  }

  if (groupId) {
    meta.group_id = groupId;
  }

  const childTaskIds = normalizeTaskIdList(result.child_task_ids || result.childTaskIds);
  if (childTaskIds.length > 0) {
    meta.child_task_ids = childTaskIds;
  }

  const childAgentTypes = normalizeTaskIdList(result.child_agent_types || result.childAgentTypes);
  if (childAgentTypes.length > 0) {
    meta.child_agent_types = childAgentTypes;
  }

  if (Number.isFinite(Number(result.expected_children))) {
    meta.expected_children = Number(result.expected_children);
  }

  if (typeof result.group_status === 'string' && result.group_status.trim()) {
    meta.group_status = result.group_status.trim();
  }

  return meta;
}

function shouldSuppressAssistantFallback(action) {
  const taskMeta = extractTaskCreatedMeta(action);
  if (taskMeta) {
    return true;
  }

  if (!action || typeof action !== 'object') {
    return false;
  }

  const result = isObject(action.result) ? action.result : {};
  const scheduleId = normalizeString(result.schedule_id || result.scheduleId, '');
  return Boolean(scheduleId);
}

function isTerminalTaskStatus(status) {
  return new Set(['completed', 'failed', 'blocked', 'timed_out', 'cancelled']).has(
    normalizeString(status, '').toLowerCase(),
  );
}

function buildBotckyActionSummary(action) {
  if (!action || typeof action !== 'object') {
    return '';
  }

  const result = isObject(action.result) ? action.result : {};
  const toolInput = isObject(action.toolInput) ? action.toolInput : {};
  const toolName = normalizeString(action.toolName, 'botcky_event');

  const gatewayTaskId = normalizeString(result.gateway_task_id || result.gatewayTaskId, '');
  const scheduleId = normalizeString(result.schedule_id || result.scheduleId, '');
  const approvalId = normalizeString(result.approval_id || result.approvalId, '');
  const decision = normalizeString(result.decision, '');
  const agentType = normalizeString(
    result.resolved_agent_type || result.requested_agent_type || toolInput.agent_type || toolInput.agentType,
    '',
  );
  const taskName = normalizeString(toolInput.name || result.name, '');
  const question = normalizeString(result.question, '');
  const reason = normalizeString(result.reason || result.message, '');
  const status = normalizeString(result.status, '').toLowerCase();

  if (gatewayTaskId) {
    const fragments = [`Created task ${gatewayTaskId}`];
    if (agentType) {
      fragments.push(`on ${agentType}`);
    }
    if (taskName) {
      fragments.push(`for "${taskName}"`);
    }
    return `${fragments.join(' ')}.`;
  }

  if (scheduleId) {
    return `Created schedule ${scheduleId}.`;
  }

  if (decision === 'needs_approval' || approvalId) {
    return approvalId
      ? `Approval requested: ${approvalId}.`
      : 'Approval is required before Botcky can continue.';
  }

  if (decision === 'clarification' && question) {
    return question;
  }

  if (decision === 'rejected') {
    return reason
      ? `Botcky could not complete that request: ${reason}`
      : 'Botcky could not complete that request.';
  }

  if (status === 'completed') {
    if (gatewayTaskId) {
      return `Task ${gatewayTaskId} completed.`;
    }
    return 'Task completed.';
  }

  if (status === 'failed') {
    if (gatewayTaskId && reason) {
      return `Task ${gatewayTaskId} failed: ${reason}`;
    }
    return reason ? `Task failed: ${reason}` : 'Task failed.';
  }

  if (decision === 'accepted') {
    if (toolName === 'task_schedule') {
      return 'Schedule created.';
    }
    if (toolName === 'approval_resolve') {
      return 'Approval resolved.';
    }
    if (toolName === 'task_create_now') {
      return agentType
        ? `Task accepted and routed to ${agentType}.`
        : 'Task accepted and queued.';
    }
  }

  return '';
}

export class BotckyGatewaySDK {
  constructor() {
    this.baseConfig = null;
    this.settings = null;
    this.botckyConfig = {};
    this.connectorUrl = DEFAULT_CONNECTOR_URL;
    this.clientSecret = '';
    this.vaultPath = null;
    this.sessionId = null;
    this.actorKey = null;
    this.lastSeq = 0;
    this.isInitialized = false;
    this.ws = null;

    this._manualDisconnect = false;
    this._abortRequested = false;
    this._ready = false;
    this._connectPromise = null;
    this._readyDeferred = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._eventQueue = [];
    this._eventWaiters = [];
    this._activeChat = false;
    this._activeRun = null;
    this._syntheticId = 0;
    this._contextCharLimit = DEFAULT_CONTEXT_CHAR_LIMIT;
    this._announcedToolIds = new Set();
    this._toolState = new Map();
    this._backgroundListeners = new Set();
    this._taskMetaByKey = new Map();
    this._announcedTaskKeys = new Set();
    this._deliveredTaskResponses = new Set();
    this._lifecycleQueue = Promise.resolve();
    this._sessionIdentityId = null;
  }

  addBackgroundListener(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this._backgroundListeners.add(listener);
    return () => {
      this._backgroundListeners.delete(listener);
    };
  }

  async initialize(config = {}) {
    console.log('[BotckyGatewaySDK] Initializing');

    return this._runLifecycleOperation(async () => {
      try {
        await this._disconnectInternal({ preserveState: true });
        this._resetRuntimeState();
        this.baseConfig = this._normalizeConfig(config);

        await this._resolveVaultPath();
        await this._loadMergedConfig();
        this.settings = this._buildSettings();
        this._contextCharLimit = this._computeContextCharLimit(this.settings);

        await this._ensureConnected();

        this.isInitialized = true;
        return true;
      } catch (error) {
        console.error('[BotckyGatewaySDK] Failed to initialize:', error);
        await this._disconnectInternal();
        this.isInitialized = false;
        return false;
      }
    });
  }

  async refreshSettings() {
    return this.initialize(this.baseConfig || this.settings || {});
  }

  async reloadVaultConfig(vaultPath) {
    return this._runLifecycleOperation(async () => {
      this.vaultPath = vaultPath || this.vaultPath || null;

      if (!this.baseConfig) {
        this.baseConfig = this._normalizeConfig({});
      }

      try {
        const preservedConfig = {
          ...this.baseConfig,
          vault_path: this.vaultPath,
        };

        await this._disconnectInternal({ preserveState: true });
        this._resetRuntimeState();

        this.baseConfig = this._normalizeConfig(preservedConfig);
        await this._resolveVaultPath(vaultPath);
        await this._loadMergedConfig();
        this.settings = this._buildSettings();
        this._contextCharLimit = this._computeContextCharLimit(this.settings);

        await this._ensureConnected();

        this.isInitialized = true;
        console.log('[BotckyGatewaySDK] Reloaded vault config');
        return true;
      } catch (error) {
        console.error('[BotckyGatewaySDK] Failed to reload vault config:', error);
        this.isInitialized = false;
        throw error;
      }
    });
  }

  getSettings() {
    if (!this.settings) {
      return null;
    }

    return {
      ...this.settings,
      context_files: Array.isArray(this.settings.context_files)
        ? [...this.settings.context_files]
        : [],
      headers: Array.isArray(this.settings.headers)
        ? this.settings.headers.map(header => ({ ...header }))
        : this.settings.headers,
    };
  }

  isReady() {
    return (
      this.isInitialized &&
      this._ready &&
      this.sessionId &&
      this.ws &&
      this.ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1)
    );
  }

  abort() {
    this._abortRequested = true;
    this._enqueueTerminalEvent({
      type: 'aborted',
      message: 'Request aborted by client',
    });
  }

  async disconnect(options = {}) {
    return this._runLifecycleOperation(async () => this._disconnectInternal(options));
  }

  async _disconnectInternal(options = {}) {
    const { preserveState = false } = options;

    this._manualDisconnect = true;
    this._clearReconnectTimer();
    this._rejectReadyWaiters(new Error('Disconnected'));
    this._closeWebSocket();
    this._connectPromise = null;

    if (!preserveState) {
      this._ready = false;
      this._eventQueue = [];
      this._eventWaiters = [];
      this._activeChat = false;
      this._activeRun = null;
      this.sessionId = null;
      this.actorKey = null;
      this.lastSeq = 0;
      this.isInitialized = false;
    }
  }

  _runLifecycleOperation(operation) {
    const run = this._lifecycleQueue
      .catch(() => {})
      .then(async () => operation());
    this._lifecycleQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async *chat(message, context = []) {
    if (!this.baseConfig && !this.settings) {
      yield {
        type: 'error',
        error: 'SDK not initialized. Please configure Botcky connector settings.',
      };
      return;
    }

    this._abortRequested = false;
    this._activeChat = true;
    this._activeRun = {
      accumulatedText: '',
      terminalSeen: false,
      requestId: this._nextSyntheticId('request'),
    };
    this._eventQueue = [];
    this._eventWaiters = [];
    this._announcedToolIds.clear();

    try {
      await this._ensureConnected();

      // Slash command interception — handle deterministic commands client-side
      // by calling the gateway REST API directly, bypassing the LLM agent loop.
      const slashResult = await this._maybeHandleSlashCommand(message);
      if (slashResult !== null) {
        yield { type: 'start', model: 'system' };
        yield { type: 'chunk', text: slashResult };
        yield { type: 'result', success: true, text: slashResult };
        return;
      }

      yield {
        type: 'start',
        model: this.settings?.model || DEFAULT_MODEL,
      };

      await this._sendChatMessage(message, context);

      while (true) {
        const event = await this._dequeueEvent();
        if (!event) {
          continue;
        }

        yield event;

        if (event.type === 'result' || event.type === 'error' || event.type === 'aborted') {
          break;
        }
      }
    } catch (error) {
      console.error('[BotckyGatewaySDK] Chat error:', error);
      yield {
        type: 'error',
        error: error?.message || String(error),
      };
    } finally {
      this._activeChat = false;
      this._activeRun = null;
    }
  }

  async _loadMergedConfig() {
    const resolvedVaultPath = await this._resolveVaultPath();
    const fileConfig = await this._readBotckyConfig();
    const mergedFileConfig = isObject(fileConfig) ? fileConfig : {};
    const explicitThreadId =
      normalizeString(this.baseConfig?.has_explicit_thread_id ? this.baseConfig?.thread_id : '', '') ||
      normalizeString(mergedFileConfig.thread_id || mergedFileConfig.threadId, '');
    const explicitRoomId =
      normalizeString(this.baseConfig?.has_explicit_room_id ? this.baseConfig?.room_id : '', '') ||
      normalizeString(mergedFileConfig.room_id || mergedFileConfig.roomId, '');

    this.botckyConfig = {
      ...mergedFileConfig,
      ...this.baseConfig,
      vault_path: this.baseConfig?.vault_path || mergedFileConfig.vault_path || resolvedVaultPath || null,
      thread_id: explicitThreadId || this.baseConfig?.thread_id || mergedFileConfig.thread_id || mergedFileConfig.threadId || DEFAULT_THREAD_ID,
      room_id: explicitRoomId || this.baseConfig?.room_id || mergedFileConfig.room_id || mergedFileConfig.roomId || '',
      has_explicit_thread_id: Boolean(explicitThreadId),
      has_explicit_room_id: Boolean(explicitRoomId),
    };

    this.connectorUrl = normalizeBotckyConnectorUrl(normalizeString(
      this.botckyConfig.endpoint ||
      this.botckyConfig.connector_url ||
      this.botckyConfig.gatewayUrl ||
      this.botckyConfig.gateway_url,
      DEFAULT_CONNECTOR_URL,
    ));
    this.clientSecret = normalizeString(
      this.botckyConfig.api_key ||
      this.botckyConfig.client_secret ||
      this.botckyConfig.clientSecret,
      '',
    );
    this.vaultPath = this.botckyConfig.vault_path || this.vaultPath || null;
  }

  async _readBotckyConfig() {
    try {
      const raw = await invoke('read_file_content', { filePath: '.botcky.json' });
      const parsed = safeJsonParse(raw, null);

      if (!isObject(parsed)) {
        console.warn('[BotckyGatewaySDK] .botcky.json did not contain an object');
        return {};
      }

      return parsed;
    } catch (error) {
      const message = error?.message || String(error);
      if (message.includes('No such file or directory')) {
        console.log('[BotckyGatewaySDK] Skipping .botcky.json load:', message);
        return {};
      }

      throw error;
    }
  }

  _buildSettings() {
    const config = this.botckyConfig || this.baseConfig || this._normalizeConfig({});

    return {
      provider: 'botckyGateway',
      endpoint: normalizeBotckyConnectorUrl(this.connectorUrl),
      api_key: this.clientSecret || null,
      model: normalizeString(config.model, DEFAULT_MODEL),
      temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7,
      max_tokens: Number.isFinite(Number(config.max_tokens))
        ? Number(config.max_tokens)
        : DEFAULT_MAX_TOKENS,
      headers: Array.isArray(config.headers) ? config.headers.map(header => ({ ...header })) : null,
      workspace_id: normalizeString(config.workspace_id, DEFAULT_WORKSPACE_ID),
      user_id: normalizeString(config.user_id, DEFAULT_USER_ID),
      thread_id: normalizeString(config.thread_id, DEFAULT_THREAD_ID),
      room_id: normalizeString(config.room_id, ''),
      user_email: normalizeString(config.user_email, ''),
      default_priority: normalizeString(config.default_priority, 'p2'),
      is_main_session: normalizeBoolean(config.is_main_session, true),
      default_agent: config.default_agent ?? null,
      context_files: Array.isArray(config.context_files) ? [...config.context_files] : [],
      system_prompt_append: config.system_prompt_append ?? '',
      vault_path: config.vault_path ?? this.vaultPath ?? null,
    };
  }

  _normalizeConfig(config) {
    const source = isObject(config) ? config : {};
    const explicitThreadId = normalizeString(source.thread_id || source.threadId, '');
    const explicitRoomId = normalizeString(source.room_id || source.roomId, '');

    return {
      endpoint: normalizeBotckyConnectorUrl(normalizeString(
        source.endpoint ||
        source.connectorUrl ||
        source.connector_url ||
        source.gatewayUrl ||
        source.gateway_url,
        DEFAULT_CONNECTOR_URL,
      )),
      api_key: normalizeString(
        source.api_key ||
        source.apiKey ||
        source.client_secret ||
        source.clientSecret,
        '',
      ),
      model: normalizeString(source.model, DEFAULT_MODEL),
      temperature: Number.isFinite(Number(source.temperature)) ? Number(source.temperature) : 0.7,
      max_tokens: Number.isFinite(Number(source.max_tokens ?? source.maxTokens))
        ? Number(source.max_tokens ?? source.maxTokens)
        : DEFAULT_MAX_TOKENS,
      headers: Array.isArray(source.headers) ? source.headers.map(header => ({ ...header })) : null,
      workspace_id: normalizeString(source.workspace_id || source.workspaceId, DEFAULT_WORKSPACE_ID),
      vault_id: normalizeString(source.vault_id || source.vaultId, ''),
      user_id: normalizeString(source.user_id || source.userId, DEFAULT_USER_ID),
      thread_id: explicitThreadId || DEFAULT_THREAD_ID,
      room_id: explicitRoomId,
      has_explicit_thread_id: Boolean(explicitThreadId),
      has_explicit_room_id: Boolean(explicitRoomId),
      user_email: normalizeString(source.user_email || source.userEmail, ''),
      timezone: normalizeString(source.timezone, ''),
      default_priority: normalizeString(source.default_priority || source.defaultPriority, 'p2'),
      is_main_session: normalizeBoolean(source.is_main_session ?? source.isMainSession, true),
      default_agent: source.default_agent ?? source.defaultAgent ?? null,
      context_files: normalizeArray(source.context_files ?? source.contextFiles),
      system_prompt_append: normalizeString(
        source.system_prompt_append ?? source.systemPromptAppend,
        '',
      ),
      vault_path: source.vault_path ?? source.vaultPath ?? this.vaultPath ?? null,
    };
  }

  async _resolveVaultPath(explicitPath = null) {
    const candidates = [
      explicitPath,
      this.baseConfig?.vault_path,
      this.baseConfig?.vaultPath,
      this.vaultPath,
      typeof window !== 'undefined' ? window.currentVaultPath : null,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeString(candidate, '');
      if (normalized) {
        this.vaultPath = normalized;
        return normalized;
      }
    }

    try {
      const vaultInfo = await invoke('get_vault_info');
      const normalized = normalizeString(vaultInfo?.path, '');
      if (normalized) {
        this.vaultPath = normalized;
        return normalized;
      }
    } catch {
      // Vault path is optional for initialization.
    }

    return null;
  }

  _computeContextCharLimit(settings) {
    if (!settings) {
      return DEFAULT_CONTEXT_CHAR_LIMIT;
    }

    const maxTokensRaw = settings.max_tokens ?? settings.maxTokens;
    const maxTokens = Number(maxTokensRaw);

    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
      return DEFAULT_CONTEXT_CHAR_LIMIT;
    }

    const computed = Math.floor(maxTokens * CHARS_PER_TOKEN_ESTIMATE);
    return Math.min(Math.max(computed, DEFAULT_CONTEXT_CHAR_LIMIT), MAX_CONTEXT_CHAR_LIMIT);
  }

  async _ensureConnected() {
    if (this.ws && this.ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1) && this._ready) {
      return true;
    }

    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = this._connectSocket();

    try {
      return await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async _connectSocket() {
    if (typeof WebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this runtime');
    }

    this._clearReconnectTimer();
    this._ready = false;
    const helloMessage = this._buildHelloMessage();

    const connectUrl = new URL(toWebSocketUrl(this.connectorUrl || DEFAULT_CONNECTOR_URL));
    connectUrl.pathname = joinUrlPath(connectUrl.pathname || '/', 'ws/vault');

    const ws = new WebSocket(connectUrl.toString());
    this.ws = ws;
    this._readyDeferred = createDeferred();
    let handshakeTimeout = null;

    const clearHandshakeTimeout = () => {
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
    };

    const startHandshakeTimeout = (message) => {
      clearHandshakeTimeout();
      handshakeTimeout = setTimeout(() => {
        if (ws !== this.ws) {
          return;
        }

        this._rejectReadyWaiters(new Error(message));
        try {
          ws.close();
        } catch {
          // ignore
        }
      }, CONNECTION_TIMEOUT_MS);
    };

    const openTimeout = setTimeout(() => {
      if (ws !== this.ws) {
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) {
        this._rejectReadyWaiters(new Error('Timed out waiting for Botcky connector WebSocket to open'));
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }, CONNECTION_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(openTimeout);
      if (ws !== this.ws) {
        return;
      }

      try {
        startHandshakeTimeout('Timed out waiting for Botcky connector handshake');
        ws.send(JSON.stringify(helloMessage));
      } catch (error) {
        clearHandshakeTimeout();
        this._rejectReadyWaiters(error);
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };

    ws.onmessage = event => {
      if (ws !== this.ws) {
        return;
      }
      this._handleSocketMessage(event?.data);

      if (this._ready) {
        clearHandshakeTimeout();
      }
    };

    ws.onerror = error => {
      clearTimeout(openTimeout);
      clearHandshakeTimeout();
      if (ws !== this.ws) {
        return;
      }

      console.warn('[BotckyGatewaySDK] WebSocket error:', error);
      if (!this._ready) {
        this._rejectReadyWaiters(new Error('Botcky connector WebSocket failed to open'));
      }
    };

    ws.onclose = event => {
      clearTimeout(openTimeout);
      clearHandshakeTimeout();
      if (ws !== this.ws) {
        return;
      }

      const code = event?.code;
      const reason = event?.reason || 'WebSocket closed';
      console.log('[BotckyGatewaySDK] WebSocket closed:', code, reason);

      this._ready = false;

      if (!this._manualDisconnect && !this._readyDeferred) {
        // already connected once
      } else {
        this._rejectReadyWaiters(new Error(reason));
      }

      if (this._manualDisconnect) {
        return;
      }

      if (FATAL_CLOSE_CODES.has(code)) {
        this._enqueueTerminalEvent({
          type: 'error',
          error: `Botcky connector WebSocket closed with fatal code ${code}: ${reason}`,
        });
        return;
      }

      if (this.isInitialized || this._activeChat) {
        this._scheduleReconnect();
      }
    };

    await this._readyDeferred.promise;
    this._readyDeferred = null;
    this._reconnectAttempts = 0;
    console.log('[BotckyGatewaySDK] WebSocket connected');
    return true;
  }

  _scheduleReconnect() {
    if (this._manualDisconnect || this._reconnectTimer) {
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * (2 ** this._reconnectAttempts),
      RECONNECT_MAX_DELAY_MS,
    );

    this._reconnectAttempts += 1;
    console.log(`[BotckyGatewaySDK] Scheduling reconnect in ${delay}ms`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;

      if (this._manualDisconnect) {
        return;
      }

      try {
        await this._connectSocket();
        console.log('[BotckyGatewaySDK] Reconnected');
      } catch (error) {
        console.warn('[BotckyGatewaySDK] Reconnect attempt failed:', error);
        this._scheduleReconnect();
      }
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _closeWebSocket() {
    if (!this.ws) {
      return;
    }

    const ws = this.ws;
    this.ws = null;

    try {
      if (
        ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.CONNECTING : 0) ||
        ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1)
      ) {
        ws.close(1000, 'Botcky connector disconnect');
      }
    } catch {
      // ignore close failures
    }
  }

  _resetRuntimeState() {
    this._manualDisconnect = false;
    this._abortRequested = false;
    this.isInitialized = false;
    this._ready = false;
    this._clearReconnectTimer();
    this._eventQueue = [];
    this._eventWaiters = [];
    this._activeChat = false;
    this._activeRun = null;
    this._connectPromise = null;
    this._readyDeferred = null;
    this.sessionId = null;
    this.actorKey = null;
    this.lastSeq = 0;
    this.ws = null;
    this._reconnectAttempts = 0;
    this._syntheticId = 0;
    this._announcedToolIds.clear();
    this._toolState.clear();
    this._backgroundListeners = this._backgroundListeners || new Set();
    this._taskMetaByKey.clear();
    this._announcedTaskKeys.clear();
    this._deliveredTaskResponses.clear();
    this._sessionIdentityId = null;
  }

  _rejectReadyWaiters(error) {
    if (this._readyDeferred) {
      this._readyDeferred.reject(error);
      this._readyDeferred = null;
    }
  }

  _enqueueEvent(event) {
    if (!event) {
      return;
    }

    if (this._eventWaiters.length > 0) {
      const resolve = this._eventWaiters.shift();
      resolve(event);
    } else {
      this._eventQueue.push(event);
    }
  }

  _enqueueTerminalEvent(event) {
    this._enqueueEvent(event);
  }

  _emitBackgroundEvent(event) {
    if (!event || this._backgroundListeners.size === 0) {
      return;
    }

    for (const listener of this._backgroundListeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[BotckyGatewaySDK] Background listener failed:', error);
      }
    }
  }

  _dequeueEvent() {
    if (this._eventQueue.length > 0) {
      return Promise.resolve(this._eventQueue.shift());
    }

    return new Promise(resolve => {
      this._eventWaiters.push(resolve);
    });
  }

  _buildHelloMessage() {
    const identity = this._buildConnectorIdentity();

    return {
      type: 'client.hello',
      request_id: this._nextSyntheticId('hello'),
      client_secret: this.clientSecret || undefined,
      ...identity,
    };
  }

  _ensureSessionIdentityId() {
    if (!this._sessionIdentityId) {
      this._sessionIdentityId = this._nextSyntheticId('session');
    }

    return this._sessionIdentityId;
  }

  _buildConnectorIdentity() {
    const config = this.botckyConfig || this.baseConfig || {};
    const resolvedVaultPath =
      normalizeString(config.vault_path, '') ||
      normalizeString(this.vaultPath, '') ||
      normalizeString(typeof window !== 'undefined' ? window.currentVaultPath : '', '');
    const configuredThreadId = config.has_explicit_thread_id ? normalizeString(config.thread_id, '') : '';
    const configuredRoomId = config.has_explicit_room_id ? normalizeString(config.room_id, '') : '';
    const sessionIdentityId = this._ensureSessionIdentityId();
    const threadId = configuredThreadId || sessionIdentityId || DEFAULT_THREAD_ID;
    const roomId = configuredRoomId || threadId;
    const userId = normalizeString(config.user_id, DEFAULT_USER_ID);
    const vaultId =
      normalizeString(config.vault_id, '') ||
      deriveVaultId(resolvedVaultPath || this.vaultPath || 'vault-default');

    return {
      workspace_id: normalizeString(config.workspace_id, DEFAULT_WORKSPACE_ID),
      vault_id: vaultId,
      user_id: userId,
      thread_id: threadId,
      room_id: roomId,
      user_email: normalizeString(config.user_email, `${userId}@vault.local`).toLowerCase(),
      timezone: normalizeString(config.timezone, getLocalTimezone()),
      default_priority: normalizeString(config.default_priority, 'p2').toLowerCase(),
      is_main_session: normalizeBoolean(config.is_main_session, true),
    };
  }

  _handleSocketMessage(rawMessage) {
    const message = parseConnectorMessage(rawMessage);
    if (!message) {
      return;
    }

    const messageType = normalizeString(
      message.type || message.event_type || message.eventType,
      '',
    );

    this._updateSequenceState(message);

    if (messageType === 'client.ready' || messageType === 'session.resumed') {
      this._applySessionSummary(message.session);
      this._ready = true;
      if (this._readyDeferred) {
        this._readyDeferred.resolve(true);
      }
      return;
    }

    if (messageType === 'chat.send.ack') {
      if (message.session) {
        this._applySessionSummary(message.session);
      }
      return;
    }

    if (messageType === 'error') {
      const payload = isObject(message.payload) ? message.payload : {};
      const detail = normalizeString(
        message.detail || message.message || message.content || extractText(payload),
        '',
      );
      const errorCode = normalizeString(
        message.error || message.gateway_event_type || message.event_type || message.eventType,
        'connector_error',
      );
      const errorText = detail || errorCode || 'Botcky connector error';

      if (!this._ready && this._readyDeferred) {
        this._rejectReadyWaiters(new Error(errorText));
        return;
      }

      if (this._activeChat) {
        this._activeRun.terminalSeen = true;
        this._enqueueTerminalEvent({
          type: 'error',
          error: errorText,
        });
      }
      return;
    }

    if (!this._activeChat || !this._activeRun) {
      const backgroundEvents = this._mapBackgroundConnectorEvent(message);
      for (const event of backgroundEvents) {
        this._emitBackgroundEvent(event);
      }
      return;
    }

    const mappedEvents = this._mapConnectorEvent(message);
    for (const event of mappedEvents) {
      this._enqueueEvent(event);
    }
  }

  _updateSequenceState(message) {
    const seqRaw =
      message.seq ??
      message.sequence ??
      message.payload?.seq ??
      message.payload?.sequence ??
      message.session?.last_seq ??
      message.session?.lastSeq;
    const seq = Number(seqRaw);
    if (Number.isFinite(seq)) {
      this.lastSeq = Math.max(this.lastSeq, seq);
    }
  }

  _applySessionSummary(session) {
    if (!session || typeof session !== 'object') {
      return;
    }

    const actorKey = normalizeString(session.actor_key || session.actorKey, '');
    const sessionId = normalizeString(
      session.gateway_session_id || session.gatewaySessionId || session.session_id || session.sessionId,
      '',
    );

    if (actorKey) {
      this.actorKey = actorKey;
    }

    if (sessionId) {
      this.sessionId = sessionId;
    }

    const activeRunId = normalizeString(session.active_run_id || session.activeRunId, '');
    if (this._activeRun && activeRunId) {
      this._activeRun.runId = activeRunId;
    }

    const lastSeq = Number(session.last_seq ?? session.lastSeq);
    if (Number.isFinite(lastSeq)) {
      this.lastSeq = Math.max(this.lastSeq, lastSeq);
    }
  }

  _mapConnectorEvent(message) {
    const type = normalizeString(message.type || message.event_type || message.eventType, '');
    const payload = isObject(message.payload) ? safeClone(message.payload) : {};
    const events = [];

    if (type === 'chunk') {
      const text = extractMessageText(message, payload);
      if (typeof text === 'string' && text !== '') {
        this._activeRun.accumulatedText += text;
        events.push({
          type: 'chunk',
          text,
        });
      }
      return events;
    }

    if (type === 'assistant') {
      const text = extractMessageText(message, payload);
      if (typeof text === 'string' && text !== '' && !this._activeRun.accumulatedText) {
        this._activeRun.accumulatedText = text;
      }
      events.push({
        type: 'assistant',
        content: buildAssistantContent(text),
      });
      return events;
    }

    if (type === 'result') {
      const explicitText = extractMessageText(message, payload);
      const finalText =
        explicitText ||
        this._activeRun.accumulatedText ||
        (shouldSuppressAssistantFallback(this._activeRun.lastToolEvent)
          ? ''
          : buildBotckyActionSummary(this._activeRun.lastToolEvent)) ||
        '';
      this._activeRun.accumulatedText = finalText || this._activeRun.accumulatedText || '';

      this._activeRun.terminalSeen = true;
      events.push({
        type: 'result',
        success: true,
        text: finalText || this._activeRun.accumulatedText || '',
        usage: payload?.usage || payload?.metrics || payload?.usage_stats || undefined,
      });
      return events;
    }

    if (type === 'tool_use') {
      const toolId = extractId(payload, 'tool');
      const toolName = resolveToolName(message, payload);
      const toolInput = extractToolInput(payload);
      this._announcedToolIds.add(toolId);
      this._toolState.set(toolId, {
        toolName,
        toolInput,
      });
      events.push({
        type: 'tool_use',
        id: toolId,
        toolName,
        toolInput,
      });
      return events;
    }

    if (type === 'tool_result') {
      const toolId = extractId(payload, 'tool');
      const storedTool = this._toolState.get(toolId) || null;
      const toolName = storedTool?.toolName || resolveToolName(message, payload);
      const toolInput = storedTool?.toolInput || extractToolInput(payload);
      const result = payload?.result ?? payload?.output ?? payload?.data ?? payload;

      if (!this._announcedToolIds.has(toolId)) {
        this._announcedToolIds.add(toolId);
        this._toolState.set(toolId, {
          toolName,
          toolInput,
        });
        events.push({
          type: 'tool_use',
          id: toolId,
          toolName,
          toolInput,
        });
      }

      this._activeRun.lastToolEvent = {
        toolId,
        toolName,
        toolInput,
        result: safeClone(result),
      };

      events.push({
        type: 'tool_result',
        id: toolId,
        toolName,
        toolInput,
        result,
      });

      const taskMeta = this._rememberTaskMeta(extractTaskCreatedMeta({
        toolName,
        toolInput,
        result,
      }));
      if (taskMeta) {
        this._appendTaskCreatedEvent(events, taskMeta);
      }
      return events;
    }

    if (type === 'task.update') {
      const taskId = extractId(payload, 'task');
      const status = normalizeString(payload.status, '').toLowerCase();
      const toolInput = safeClone(payload) || {};
      const result = safeClone(payload) || {};

      if (!this._announcedToolIds.has(taskId)) {
        this._announcedToolIds.add(taskId);
        this._toolState.set(taskId, {
          toolName: 'task_update',
          toolInput,
        });
        events.push({
          type: 'tool_use',
          id: taskId,
          toolName: 'task_update',
          toolInput,
        });
      }

      this._activeRun.lastToolEvent = {
        toolId: taskId,
        toolName: 'task_update',
        toolInput,
        result,
      };

      events.push({
        type: 'tool_result',
        id: taskId,
        toolName: 'task_update',
        result,
      });

      if (!isTerminalTaskStatus(status)) {
        return events;
      }

      const terminalText =
        normalizeString(extractText(payload), '').trim() ||
        normalizeString(payload.error || payload.message, '').trim();

      this._activeRun.terminalSeen = true;

      if (status === 'completed') {
        if (terminalText) {
          const responseKey = `${taskId}:${status}:${hashString(terminalText)}`;
          if (!this._deliveredTaskResponses.has(responseKey)) {
            this._deliveredTaskResponses.add(responseKey);
          }
          this._activeRun.accumulatedText = terminalText;
        }
        events.push({
          type: 'result',
          success: true,
          text: terminalText || this._activeRun.accumulatedText || '',
          usage: payload?.usage || payload?.metrics || payload?.usage_stats || undefined,
        });
        return events;
      }

      events.push({
        type: 'error',
        error: terminalText || `Task ${taskId || ''} ${status || 'failed'}.`.trim(),
      });
      return events;
    }

    if (type === 'system.notice') {
      return events;
    }

    return events;
  }

  _mapBackgroundConnectorEvent(message) {
    const type = normalizeString(message.type || message.event_type || message.eventType, '');
    const payload = isObject(message.payload) ? safeClone(message.payload) : {};
    const events = [];

    if (type !== 'task.update') {
      return events;
    }

    const taskId = extractId(payload, 'task');
    const status = normalizeString(payload.status, '').toLowerCase();
    const rememberedMeta = this._rememberTaskMeta(extractTaskCreatedMeta({
      toolName: 'task_update',
      toolInput: payload,
      result: payload,
    }));
    const fallbackMeta = this._getRememberedTaskMetaById(taskId);
    const meta = rememberedMeta || fallbackMeta || {
      gateway_task_id: taskId,
      name: normalizeString(payload.name, 'Task created'),
    };

    events.push({
      type: 'task_update',
      taskId,
      status,
      meta: safeClone(meta),
      result: payload,
    });

    if (!isTerminalTaskStatus(status)) {
      return events;
    }

    const text = extractText(payload).trim();
    if (!text) {
      return events;
    }

    const responseKey = `${taskId}:${status}:${hashString(text)}`;
    if (this._deliveredTaskResponses.has(responseKey)) {
      return events;
    }

    this._deliveredTaskResponses.add(responseKey);
    events.push({
      type: 'assistant_message',
      taskId,
      status,
      text,
      meta: safeClone(meta),
    });

    return events;
  }

  _rememberTaskMeta(taskMeta) {
    const key = getTaskMetaKey(taskMeta);
    if (!key) {
      return null;
    }

    const existing = this._taskMetaByKey.get(key) || {};
    const incoming = safeClone(taskMeta);
    const incomingName = normalizeString(incoming?.name, '');
    const existingName = normalizeString(existing?.name, '');
    const merged = {
      ...existing,
      ...incoming,
    };
    if (!incomingName && existingName) {
      merged.name = existingName;
    } else if (incomingName === 'Task created' && existingName && existingName !== 'Task created') {
      merged.name = existingName;
    }
    this._taskMetaByKey.set(key, merged);
    return merged;
  }

  _getRememberedTaskMetaById(taskId) {
    const normalizedTaskId = normalizeString(taskId, '');
    if (!normalizedTaskId) {
      return null;
    }

    return this._taskMetaByKey.get(`task:${normalizedTaskId}`) || null;
  }

  _appendTaskCreatedEvent(events, taskMeta) {
    const key = getTaskMetaKey(taskMeta);
    if (!key || this._announcedTaskKeys.has(key)) {
      return;
    }

    this._announcedTaskKeys.add(key);
    events.push({
      type: 'task_created',
      meta: safeClone(taskMeta),
    });
  }

  async _sendProtocolMessage(message) {
    if (!this.ws || this.ws.readyState !== (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1)) {
      await this._ensureConnected();
    }

    this.ws.send(JSON.stringify(message));
  }

  async _maybeHandleSlashCommand(message) {
    const normalized = String(message || '').trim().toLowerCase();

    // /cancel <schedule_id> — cancel a scheduled or cron job
    const cancelMatch = normalized.match(/^\/cancel\s+(sch_[a-f0-9]+)$/);
    if (cancelMatch) {
      return this._handleCancelSchedule(cancelMatch[1]);
    }
    // "cancel cron job <id>" or "cancel schedule <id>" — natural language
    const cancelNatural = normalized.match(/cancel\s+(?:cron\s+(?:job\s+)?|schedule\s+|chron\s+(?:job\s+)?)(sch_[a-f0-9]+)/);
    if (cancelNatural) {
      return this._handleCancelSchedule(cancelNatural[1]);
    }

    if (normalized !== '/chron' && normalized !== '/cron' && normalized !== '/schedules') {
      return null;
    }
    try {
      const baseUrl = String(this.connectorUrl || '').replace(/\/+$/, '').replace(/^ws/, 'http');
      const response = await fetch(`${baseUrl}/api/schedules?status=active`);
      if (!response.ok) {
        // Fallback: try gateway directly if connector doesn't have the endpoint
        const gatewayBase = String(
          this.botckyConfig?.gatewayBackendUrl ||
          this.botckyConfig?.gateway_backend_url ||
          'http://127.0.0.1:3002'
        ).replace(/\/+$/, '');
        const gwResponse = await fetch(`${gatewayBase}/gateway/schedules?status=active`);
        if (!gwResponse.ok) {
          return 'Failed to fetch schedules.';
        }
        const data = await gwResponse.json();
        return this._formatScheduleList(data);
      }
      const data = await response.json();
      return this._formatScheduleList(data);
    } catch (error) {
      console.warn('[BotckyGatewaySDK] Slash command failed:', error);
      return `Failed to fetch schedules: ${error.message}`;
    }
  }

  async _handleCancelSchedule(scheduleId) {
    try {
      const baseUrl = String(this.connectorUrl || '').replace(/\/+$/, '').replace(/^ws/, 'http');
      const response = await fetch(`${baseUrl}/api/schedules/${encodeURIComponent(scheduleId)}/cancel`, {
        method: 'POST',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return `Failed to cancel \`${scheduleId}\`: ${err.detail || response.statusText}`;
      }
      const data = await response.json();
      return `Cancelled **${data.name || scheduleId}** (\`${scheduleId}\`). Status: ${data.status || 'cancelled'}`;
    } catch (error) {
      console.warn('[BotckyGatewaySDK] Cancel schedule failed:', error);
      return `Failed to cancel \`${scheduleId}\`: ${error.message}`;
    }
  }

  _formatScheduleList(data) {
    const schedules = Array.isArray(data) ? data : (data.schedules || []);
    if (schedules.length === 0) {
      return 'No active scheduled or recurring jobs.';
    }
    const lines = schedules.map(s => {
      let line = `**${s.name || 'Unnamed'}** (\`${s.schedule_id || '?'}\`)`;
      if (s.schedule_type === 'cron' && s.cron_expr) {
        line += ` — cron \`${s.cron_expr}\` (${s.timezone || 'UTC'})`;
      }
      if (s.next_run_at) {
        line += ` — next: ${s.next_run_at}`;
      }
      if (s.status && s.status !== 'active') {
        line += ` [${s.status}]`;
      }
      return `- ${line}`;
    });
    return `**Active schedules (${schedules.length}):**\n${lines.join('\n')}`;
  }

  async _sendChatMessage(message, context) {
    await this._sendProtocolMessage({
      type: 'chat.send',
      request_id: this._activeRun?.requestId || this._nextSyntheticId('request'),
      text: message,
      context: await this._buildChatContext(context),
    });
  }

  async _buildChatContext(context) {
    const resolvedVaultPath = await this._resolveVaultPath();
    const notes = Array.isArray(context) ? context : [];
    const activeNote = notes.length > 0 ? this._serializeNote(notes[0]) : null;
    const contextNotes = [];

    for (const note of notes.slice(1)) {
      const serialized = this._serializeNote(note);
      if (serialized) {
        contextNotes.push(serialized);
      }
    }

    const fileNotes = await this._loadContextFiles();
    for (const fileNote of fileNotes) {
      if (!fileNote) {
        continue;
      }

      const existing = contextNotes.find(note => note.path && note.path === fileNote.path);
      if (!existing) {
        contextNotes.push(fileNote);
      }
    }

    const botcky = this.botckyConfig || {};
    const identity = await this._buildConnectorIdentity();

    return {
      vault_path: resolvedVaultPath || botcky.vault_path || null,
      active_note: activeNote,
      context_notes: contextNotes,
      default_agent: botcky.default_agent ?? null,
      context_files: Array.isArray(botcky.context_files) ? [...botcky.context_files] : [],
      system_prompt_append: botcky.system_prompt_append || '',
      workspace_id: identity.workspace_id,
      vault_id: identity.vault_id,
      thread_id: identity.thread_id,
      room_id: identity.room_id,
      user_id: identity.user_id,
      user_email: identity.user_email,
    };
  }

  _serializeNote(note) {
    if (!note || typeof note !== 'object') {
      return null;
    }

    const title = normalizeString(note.title || note.name || 'Untitled', 'Untitled');
    const path = normalizeString(note.path || note.filePath || '', '');
    const content = typeof note.content === 'string' ? note.content : '';
    const truncatedContent = this._truncateContent(content);

    if (!title && !path && !truncatedContent) {
      return null;
    }

    return {
      title,
      path: path || null,
      content: truncatedContent,
      type: note.type || 'markdown',
    };
  }

  async _loadContextFiles() {
    const contextFiles = Array.isArray(this.botckyConfig?.context_files)
      ? this.botckyConfig.context_files
      : [];

    if (contextFiles.length === 0) {
      return [];
    }

    const notes = [];
    for (const filePath of contextFiles) {
      try {
        const content = await invoke('read_file_content', { filePath });
        if (typeof content !== 'string' || !content.trim()) {
          continue;
        }

        notes.push({
          title: filePath.split('/').pop() || filePath,
          path: filePath,
          content: this._truncateContent(content),
          type: 'markdown',
        });
      } catch (error) {
        console.warn('[BotckyGatewaySDK] Failed to load context file:', filePath, error);
      }
    }

    return notes;
  }

  _truncateContent(content) {
    if (typeof content !== 'string' || !content) {
      return '';
    }

    const limit = this._contextCharLimit || DEFAULT_CONTEXT_CHAR_LIMIT;
    if (content.length <= limit) {
      return content;
    }

    return `${content.slice(0, limit)}...[truncated]`;
  }

  _nextSyntheticId(prefix = 'botcky') {
    this._syntheticId += 1;
    return `${prefix}_${Date.now()}_${this._syntheticId}`;
  }
}
