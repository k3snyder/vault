/**
 * @jest-environment jsdom
 */
import { describe, expect, jest, test } from '@jest/globals';
import {
  BotckyGatewayNativeClient,
  DEFAULT_LOCAL_BOTCKY_GATEWAY_FRONTEND_KEY,
  botckyHistoryEvents,
  gatewayWsUrl,
  normalizeGatewayApiKey,
  normalizeGatewayBaseUrl,
} from './botckyGatewayClient.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('BotckyGatewayNativeClient', () => {
  test('migrates legacy local connector endpoints to the Gateway chat port', () => {
    expect(normalizeGatewayBaseUrl('http://localhost:7112')).toBe('http://127.0.0.1:7110');
    expect(normalizeGatewayBaseUrl('http://localhost:3005/gateway')).toBe('http://127.0.0.1:7110');
    expect(normalizeGatewayBaseUrl('http://192.168.1.4:3005')).toBe('http://192.168.1.4:3005');
  });



  test('normalizes missing or legacy local connector secrets to the local Gateway dev key', () => {
    const legacyConnectorSecret = 'f856d3aa637d6027e039a35ed161d0da53e4f852492672d6fcf68ed5b194a76d';

    expect(normalizeGatewayApiKey('', 'http://127.0.0.1:7110')).toBe(DEFAULT_LOCAL_BOTCKY_GATEWAY_FRONTEND_KEY);
    expect(normalizeGatewayApiKey(legacyConnectorSecret, 'http://127.0.0.1:7110')).toBe(DEFAULT_LOCAL_BOTCKY_GATEWAY_FRONTEND_KEY);
    expect(normalizeGatewayApiKey('custom-key', 'http://127.0.0.1:7110')).toBe('custom-key');
    expect(normalizeGatewayApiKey(legacyConnectorSecret, 'http://192.168.1.4:7110')).toBe(legacyConnectorSecret);
  });

  test('builds Gateway-native websocket URLs with replay and frontend key auth', () => {
    const url = new URL(gatewayWsUrl('http://127.0.0.1:7110', 'session-1', 42, 'front-key'));

    expect(url.protocol).toBe('ws:');
    expect(url.pathname).toBe('/gateway/ws/chat');
    expect(url.searchParams.get('session_id')).toBe('session-1');
    expect(url.searchParams.get('after_seq')).toBe('42');
    expect(url.searchParams.get('api_key')).toBe('front-key');
  });

  test('uses Gateway chat session routes and frontend key headers', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ session_id: 'session-2' }));
    const client = new BotckyGatewayNativeClient({
      endpoint: 'http://127.0.0.1:7110',
      sessionId: 'session-1',
      apiKey: 'front-key',
      fetchImpl,
      WebSocketCtor: null,
    });

    await client.createSession({ vaultId: 'vault-1', title: 'Vault chat' });
    await client.archiveSession('session-2');
    await client.deleteSession('session-2');
    await client.fetchHistory('session-2');

    const [createUrl, createInit] = fetchImpl.mock.calls[0];
    expect(createUrl).toBe('http://127.0.0.1:7110/gateway/chat/sessions');
    expect(createInit.method).toBe('POST');
    expect(createInit.headers['X-Gateway-Frontend-Key']).toBe('front-key');
    expect(createInit.headers['X-API-Key']).toBe('front-key');
    expect(JSON.parse(createInit.body)).toMatchObject({
      platform: 'vault',
      name: 'Vault chat',
      metadata: { vault_id: 'vault-1' },
    });

    expect(fetchImpl.mock.calls[1][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-2/status');
    expect(fetchImpl.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ status: 'archived' });

    expect(fetchImpl.mock.calls[2][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-2');
    expect(fetchImpl.mock.calls[2][1].method).toBe('DELETE');

    expect(fetchImpl.mock.calls[3][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-2/messages?include_events=true');
  });

  test('deletes every Gateway chat session returned by the session list', async () => {
    const fetchImpl = jest.fn(async (url, init = {}) => {
      if (!init.method) return jsonResponse({ sessions: [{ id: 'session-1' }, { session_id: 'session-2' }] });
      return { ok: true, status: 204, text: async () => '' };
    });
    const client = new BotckyGatewayNativeClient({
      endpoint: 'http://127.0.0.1:7110',
      apiKey: 'front-key',
      fetchImpl,
      WebSocketCtor: null,
    });

    await expect(client.deleteAllSessions()).resolves.toEqual({
      deleted: 2,
      session_ids: ['session-1', 'session-2'],
    });

    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions?platform=vault');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-1');
    expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
    expect(fetchImpl.mock.calls[2][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-2');
    expect(fetchImpl.mock.calls[2][1].method).toBe('DELETE');
  });

  test('binds the default fetch implementation to Window/globalThis for WebKit', async () => {
    const originalFetch = globalThis.fetch;
    const receivers = [];
    globalThis.fetch = jest.fn(function () {
      receivers.push(this);
      return Promise.resolve(jsonResponse({ sessions: [] }));
    });

    try {
      const client = new BotckyGatewayNativeClient({
        endpoint: 'http://127.0.0.1:7110',
        sessionId: 'session-1',
        WebSocketCtor: null,
      });

      await client.listSessions();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7110/gateway/chat/sessions?platform=vault&status=active',
        expect.objectContaining({
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
        })
      );
      expect(receivers[0]).toBe(globalThis);
    } finally {
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      } else {
        delete globalThis.fetch;
      }
    }
  });

  test('sends lightweight ping frames to wake queued Gateway websocket fanout', () => {
    const sent = [];
    const socket = {
      readyState: 1,
      send: payload => sent.push(JSON.parse(payload)),
      close: jest.fn(),
      addEventListener: jest.fn((type, listener) => {
        if (type === 'open') listener();
      }),
    };
    const WebSocketCtor = jest.fn(() => socket);
    const client = new BotckyGatewayNativeClient({
      endpoint: 'http://127.0.0.1:7110',
      sessionId: 'session-1',
      apiKey: 'front-key',
      WebSocketCtor,
      fetchImpl: jest.fn(),
    });

    client.connect();
    client.ping();

    expect(sent[0]).toMatchObject({ type: 'ping', session_id: 'session-1' });
    expect(typeof sent[0].ts).toBe('number');
  });

  test('normalizes durable history into replayable events after the last seen seq', () => {
    const history = {
      messages: [
        { message_id: 'msg-1', role: 'user', content_json: '{"text":"hello"}', run_id: 'run-1', seq: 1 },
        { message_id: 'msg-2', role: 'assistant', content_json: '{"text":"done"}', run_id: 'task:gwy-1', seq: 2 },
      ],
    };

    expect(botckyHistoryEvents(history, 1)).toEqual([
      {
        type: 'chat.message',
        session_id: undefined,
        seq: 2,
        payload: history.messages[1],
      },
    ]);
  });
});
