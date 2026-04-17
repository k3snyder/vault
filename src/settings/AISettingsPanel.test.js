/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.unstable_mockModule('../icons/icon-utils.js', () => ({
  icons: new Proxy({}, {
    get: () => () => '<svg></svg>',
  }),
}));

let AISettingsPanel;

beforeAll(async () => {
  ({ AISettingsPanel } = await import('./AISettingsPanel.js'));
});

describe('AISettingsPanel Botcky connection test', () => {
  const originalWebSocket = global.WebSocket;

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    jest.restoreAllMocks();
  });

  test('accepts session.resumed as a successful Botcky handshake', async () => {
    const sentPayloads = [];

    class FakeWebSocket {
      constructor() {
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;

        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({
            data: JSON.stringify({
              type: 'session.resumed',
              session: {
                gateway_session_id: 'chs_resumed',
              },
            }),
          });
        }, 0);
      }

      send(payload) {
        sentPayloads.push(JSON.parse(payload));
      }

      close() {}
    }

    global.WebSocket = FakeWebSocket;

    const panel = new AISettingsPanel();
    panel.state.provider = 'botckyGateway';
    panel.state.endpoint = 'http://192.168.1.4:3005';
    panel.state.apiKey = 'secret';

    const result = await panel.testBotckyConnection();

    expect(result.overall_status.success).toBe(true);
    expect(result.auth_status.message).toBe('client.hello accepted');
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].type).toBe('client.hello');
    expect(sentPayloads[0].thread_id).toBe(sentPayloads[0].request_id);
    expect(sentPayloads[0].room_id).toBe(sentPayloads[0].request_id);
  });
});
