import { BotckyGatewaySDK } from './BotckyGatewaySDK.js';

describe('BotckyGatewaySDK error handling', () => {
  test('preserves gateway run error text from connector error events', () => {
    const sdk = new BotckyGatewaySDK();
    sdk._activeChat = true;
    sdk._activeRun = {
      accumulatedText: '',
      terminalSeen: false,
    };

    sdk._handleSocketMessage({
      type: 'error',
      gateway_event_type: 'chat.run.error',
      content: 'Botcky run failed upstream',
      payload: {
        content: 'Botcky run failed upstream',
      },
    });

    expect(sdk._activeRun.terminalSeen).toBe(true);
    expect(sdk._eventQueue).toHaveLength(1);
    expect(sdk._eventQueue[0]).toEqual({
      type: 'error',
      error: 'Botcky run failed upstream',
    });
  });

  test('closes an existing websocket before reinitializing', async () => {
    const sdk = new BotckyGatewaySDK();
    const closeCalls = [];
    const close = (...args) => {
      closeCalls.push(args);
    };

    sdk.ws = {
      readyState: 1,
      close,
    };
    sdk._ready = true;
    sdk._resolveVaultPath = async () => '/tmp/vault';
    sdk._loadMergedConfig = async () => undefined;
    sdk._buildSettings = () => ({ max_tokens: 8000 });
    sdk._ensureConnected = async () => true;

    await expect(sdk.initialize({
      gatewayUrl: 'http://localhost:3005',
      apiKey: 'secret',
    })).resolves.toBe(true);

    expect(closeCalls).toEqual([[1000, 'Botcky connector disconnect']]);
  });

  test('ignores stale socket close events during reinitialization', async () => {
    const sdk = new BotckyGatewaySDK();
    const originalWebSocket = global.WebSocket;
    const sockets = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.sent = [];
        sockets.push(this);
      }

      send(payload) {
        this.sent.push(payload);
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }
    }

    global.WebSocket = FakeWebSocket;

    try {
      sdk._resolveVaultPath = async () => '/tmp/vault';
      sdk._loadMergedConfig = async () => {
        sdk.connectorUrl = 'http://localhost:3005';
        sdk.clientSecret = 'secret';
        sdk.botckyConfig = {};
      };
      sdk._buildSettings = () => ({ max_tokens: 8000 });
      sdk._buildHelloMessage = async () => ({ type: 'client.hello' });

      const firstConnectPromise = sdk._connectSocket();
      const oldSocket = sockets[0];
      oldSocket.readyState = FakeWebSocket.OPEN;
      await oldSocket.onopen();
      oldSocket.onmessage({
        data: JSON.stringify({
          type: 'client.ready',
          session: {
            session_id: 'chs_old',
            actor_key: 'actor_old',
          },
        }),
      });
      await firstConnectPromise;

      const initializePromise = sdk.initialize({
        gatewayUrl: 'http://localhost:3005',
        apiKey: 'secret',
      });

      for (let attempt = 0; attempt < 10 && sockets.length < 2; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      expect(sockets).toHaveLength(2);

      const newSocket = sockets[1];
      oldSocket.onclose({ code: 1000, reason: 'Botcky connector disconnect' });

      newSocket.readyState = FakeWebSocket.OPEN;
      await newSocket.onopen();
      newSocket.onmessage({
        data: JSON.stringify({
          type: 'client.ready',
          session: {
            session_id: 'chs_new',
            actor_key: 'actor_new',
          },
        }),
      });

      await expect(initializePromise).resolves.toBe(true);
      expect(sdk.sessionId).toBe('chs_new');
      expect(sdk.actorKey).toBe('actor_new');
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });

  test('serializes initialize and reloadVaultConfig so they do not disconnect each other', async () => {
    const sdk = new BotckyGatewaySDK();
    const connectCalls = [];
    let resolveFirstConnect;
    const firstConnectPromise = new Promise(resolve => {
      resolveFirstConnect = resolve;
    });

    sdk._resolveVaultPath = async (explicitPath = null) => explicitPath || '/tmp/vault-a';
    sdk._loadMergedConfig = async () => undefined;
    sdk._buildSettings = () => ({ max_tokens: 8000 });
    sdk._computeContextCharLimit = () => 32000;
    sdk._ensureConnected = async () => {
      connectCalls.push(sdk.baseConfig?.vault_path || sdk.vaultPath || null);
      if (connectCalls.length === 1) {
        await firstConnectPromise;
      }
      return true;
    };

    const initializePromise = sdk.initialize({
      gatewayUrl: 'http://localhost:3005',
      apiKey: 'secret',
      vault_path: '/tmp/vault-a',
    });

    const reloadPromise = sdk.reloadVaultConfig('/tmp/vault-b');

    for (let attempt = 0; attempt < 10 && connectCalls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(connectCalls).toHaveLength(1);

    resolveFirstConnect(true);

    await expect(initializePromise).resolves.toBe(true);
    await expect(reloadPromise).resolves.toBe(true);

    expect(connectCalls).toEqual(['/tmp/vault-a', '/tmp/vault-b']);
    expect(sdk.baseConfig.vault_path).toBe('/tmp/vault-b');
    expect(sdk.isInitialized).toBe(true);
  });

  test('fails initialization when the connector never completes the handshake', async () => {
    const sdk = new BotckyGatewaySDK();
    const originalWebSocket = global.WebSocket;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const sockets = [];
    const scheduled = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.sent = [];
        sockets.push(this);
      }

      send(payload) {
        this.sent.push(payload);
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ code: 1000, reason: 'closed' });
      }
    }

    global.WebSocket = FakeWebSocket;
    global.setTimeout = (fn, delay) => {
      const entry = { fn, delay, cleared: false };
      scheduled.push(entry);
      return entry;
    };
    global.clearTimeout = (entry) => {
      if (entry) {
        entry.cleared = true;
      }
    };

    try {
      sdk._resolveVaultPath = async () => '/tmp/vault';
      sdk._loadMergedConfig = async () => {
        sdk.connectorUrl = 'http://localhost:3005';
        sdk.clientSecret = 'secret';
        sdk.botckyConfig = {};
      };
      sdk._buildSettings = () => ({ max_tokens: 8000 });
      sdk._buildHelloMessage = async () => ({ type: 'client.hello' });

      const initializePromise = sdk.initialize({
        gatewayUrl: 'http://localhost:3005',
        apiKey: 'secret',
      });

      for (let attempt = 0; attempt < 10 && sockets.length < 1; attempt += 1) {
        await new Promise(resolve => queueMicrotask(resolve));
      }

      expect(sockets).toHaveLength(1);

      sockets[0].readyState = FakeWebSocket.OPEN;
      await sockets[0].onopen();

      const handshakeTimer = scheduled.find(entry => entry.delay === 10000 && !entry.cleared);
      expect(handshakeTimer).toBeTruthy();

      handshakeTimer.fn();

      await expect(initializePromise).resolves.toBe(false);
      expect(sdk.isInitialized).toBe(false);
    } finally {
      global.WebSocket = originalWebSocket;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  test('uses a session-scoped connector identity when thread and room are not configured', () => {
    const sdk = new BotckyGatewaySDK();
    sdk.baseConfig = sdk._normalizeConfig({
      gatewayUrl: 'http://192.168.1.4:3005',
      apiKey: 'secret',
    });
    sdk.botckyConfig = { ...sdk.baseConfig };
    sdk.clientSecret = 'secret';
    sdk.vaultPath = '/tmp/vault';

    const firstHello = sdk._buildHelloMessage();
    const secondHello = sdk._buildHelloMessage();

    expect(firstHello.type).toBe('client.hello');
    expect(firstHello.thread_id).toBe(firstHello.room_id);
    expect(firstHello.thread_id).toMatch(/^session_/);
    expect(firstHello.thread_id).not.toBe('main');
    expect(secondHello.thread_id).toBe(firstHello.thread_id);
    expect(secondHello.room_id).toBe(firstHello.room_id);
    expect(secondHello.request_id).not.toBe(firstHello.request_id);
  });

  test('uses final result text as the canonical assistant content without emitting a duplicate chunk', () => {
    const sdk = new BotckyGatewaySDK();
    sdk._activeChat = true;
    sdk._activeRun = {
      accumulatedText: "Built onthis platform, running in your workspace.",
      terminalSeen: false,
    };

    const events = sdk._mapConnectorEvent({
      type: 'result',
      content: 'Built on this platform, running in your workspace.',
      payload: {
        content: 'Built on this platform, running in your workspace.',
      },
    });

    expect(events).toEqual([{
      type: 'result',
      success: true,
      text: 'Built on this platform, running in your workspace.',
      usage: undefined,
    }]);
    expect(sdk._activeRun.accumulatedText).toBe('Built on this platform, running in your workspace.');
    expect(sdk._activeRun.terminalSeen).toBe(true);
  });

  test('suppresses synthetic task confirmation text when Botcky only created a task', () => {
    const sdk = new BotckyGatewaySDK();
    sdk._activeChat = true;
    sdk._activeRun = {
      accumulatedText: '',
      terminalSeen: false,
      lastToolEvent: {
        toolName: 'task_create_now',
        toolInput: {
          name: 'Tell me a joke',
          agent_type: 'agent1',
        },
        result: {
          decision: 'accepted',
          gateway_task_id: 'gwy_123',
          resolved_agent_type: 'agent1',
        },
      },
    };

    const events = sdk._mapConnectorEvent({
      type: 'result',
      content: '',
      payload: {},
    });

    expect(events).toEqual([{
      type: 'result',
      success: true,
      text: '',
      usage: undefined,
    }]);
    expect(sdk._activeRun.accumulatedText).toBe('');
    expect(sdk._activeRun.terminalSeen).toBe(true);
  });

  test('emits task_created metadata from task-creating tool results', () => {
    const sdk = new BotckyGatewaySDK();
    sdk._activeChat = true;
    sdk._activeRun = {
      accumulatedText: '',
      terminalSeen: false,
    };
    sdk._announcedToolIds.add('tool_1');
    sdk._toolState.set('tool_1', {
      toolName: 'task_create_now',
      toolInput: {
        name: 'Tell me a joke',
        agent_type: 'agent1',
      },
    });

    const events = sdk._mapConnectorEvent({
      type: 'tool_result',
      payload: {
        tool_call_id: 'tool_1',
        result: {
          gateway_task_id: 'gwy_123',
          resolved_agent_type: 'agent1',
        },
      },
    });

    expect(events).toEqual([
      {
        type: 'tool_result',
        id: 'tool_1',
        toolName: 'task_create_now',
        toolInput: {
          name: 'Tell me a joke',
          agent_type: 'agent1',
        },
        result: {
          gateway_task_id: 'gwy_123',
          resolved_agent_type: 'agent1',
        },
      },
      {
        type: 'task_created',
        meta: {
          gateway_task_id: 'gwy_123',
          name: 'Tell me a joke',
        },
      },
    ]);
  });

  test('emits a terminal result when task.update completes an active chat run', () => {
    const sdk = new BotckyGatewaySDK();
    sdk._activeChat = true;
    sdk._activeRun = {
      accumulatedText: '',
      terminalSeen: false,
    };

    const events = sdk._mapConnectorEvent({
      type: 'task.update',
      payload: {
        gateway_task_id: 'gwy_123',
        status: 'completed',
        response: 'Why can’t you trust an atom? Because they make up everything.',
      },
    });

    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'gwy_123',
        toolName: 'task_update',
        toolInput: {
          gateway_task_id: 'gwy_123',
          status: 'completed',
          response: 'Why can’t you trust an atom? Because they make up everything.',
        },
      },
      {
        type: 'tool_result',
        id: 'gwy_123',
        toolName: 'task_update',
        result: {
          gateway_task_id: 'gwy_123',
          status: 'completed',
          response: 'Why can’t you trust an atom? Because they make up everything.',
        },
      },
      {
        type: 'result',
        success: true,
        text: 'Why can’t you trust an atom? Because they make up everything.',
        usage: undefined,
      },
    ]);
    expect(sdk._activeRun.accumulatedText).toBe('Why can’t you trust an atom? Because they make up everything.');
    expect(sdk._activeRun.terminalSeen).toBe(true);
  });

  test('emits an error when task.update fails an active chat run', () => {
    const sdk = new BotckyGatewaySDK();
    sdk._activeChat = true;
    sdk._activeRun = {
      accumulatedText: '',
      terminalSeen: false,
    };

    const events = sdk._mapConnectorEvent({
      type: 'task.update',
      payload: {
        gateway_task_id: 'gwy_999',
        status: 'failed',
        error: 'The agent could not complete the request.',
      },
    });

    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'gwy_999',
        toolName: 'task_update',
        toolInput: {
          gateway_task_id: 'gwy_999',
          status: 'failed',
          error: 'The agent could not complete the request.',
        },
      },
      {
        type: 'tool_result',
        id: 'gwy_999',
        toolName: 'task_update',
        result: {
          gateway_task_id: 'gwy_999',
          status: 'failed',
          error: 'The agent could not complete the request.',
        },
      },
      {
        type: 'error',
        error: 'The agent could not complete the request.',
      },
    ]);
    expect(sdk._activeRun.terminalSeen).toBe(true);
  });

  test('emits background assistant text when a task completes after the chat run ended', () => {
    const sdk = new BotckyGatewaySDK();
    const backgroundEvents = [];
    sdk.addBackgroundListener(event => backgroundEvents.push(event));
    sdk._taskMetaByKey.set('task:gwy_123', {
      gateway_task_id: 'gwy_123',
      name: 'Tell me a joke',
    });

    sdk._handleSocketMessage({
      type: 'task.update',
      payload: {
        gateway_task_id: 'gwy_123',
        status: 'completed',
        response: 'Why do programmers hate nature? Too many bugs.',
      },
    });

    expect(backgroundEvents).toEqual([
      {
        type: 'task_update',
        taskId: 'gwy_123',
        status: 'completed',
        meta: {
          gateway_task_id: 'gwy_123',
          name: 'Tell me a joke',
        },
        result: {
          gateway_task_id: 'gwy_123',
          status: 'completed',
          response: 'Why do programmers hate nature? Too many bugs.',
        },
      },
      {
        type: 'assistant_message',
        taskId: 'gwy_123',
        status: 'completed',
        text: 'Why do programmers hate nature? Too many bugs.',
        meta: {
          gateway_task_id: 'gwy_123',
          name: 'Tell me a joke',
        },
      },
    ]);
  });
});
