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
let invoke;

beforeAll(async () => {
  ({ invoke } = await import('@tauri-apps/api/core'));
  ({ AISettingsPanel } = await import('./AISettingsPanel.js'));
});

describe('AISettingsPanel native Botcky settings', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('loading active Botcky settings normalizes endpoint and API key without a provider reference error', async () => {
    invoke.mockImplementation(async command => {
      if (command === 'get_active_ai_provider') return 'botckyGateway';
      if (command === 'get_ai_settings') {
        return {
          provider: 'botckyGateway',
          endpoint: 'http://localhost:7112',
          api_key: 'f856d3aa637d6027e039a35ed161d0da53e4f852492672d6fcf68ed5b194a76d',
          model: 'botcky-agent',
          temperature: 0.7,
          max_tokens: 8000,
          streaming_enabled: true,
        };
      }
      return undefined;
    });

    const panel = new AISettingsPanel();
    await panel.mount(document.createElement('div'));

    expect(panel.state.provider).toBe('botckyGateway');
    expect(panel.state.endpoint).toBe('http://127.0.0.1:7110');
    expect(panel.state.apiKey).toBe('dev-gateway-key');
  });

  test('Botcky connection test reports native chat target without opening a websocket', async () => {
    const WebSocketMock = jest.fn();
    global.WebSocket = WebSocketMock;

    const panel = new AISettingsPanel();
    panel.container = document.createElement('div');
    panel.state.provider = 'botckyGateway';
    panel.state.endpoint = 'http://192.168.1.4:3005';
    panel.state.apiKey = 'secret';

    await panel.testConnection();

    expect(WebSocketMock).not.toHaveBeenCalled();
    expect(panel.state.testStatus.overall_status.success).toBe(true);
    expect(panel.state.testStatus.overall_status.message).toContain('native chat');
    expect(panel.state.testStatus.endpoint_status.success).toBe(true);
    expect(panel.state.testStatus.endpoint_status.message).toContain('/gateway/ws/chat');
  });

  test('Botcky labels describe native gateway settings instead of connector settings', () => {
    const panel = new AISettingsPanel();
    panel.state.provider = 'botckyGateway';

    expect(panel.getEndpointLabel()).toBe('Botcky Gateway Endpoint:');
    expect(panel.getEndpointHelp()).toContain('/gateway/ws/chat');
    expect(panel.getApiKeyLabel()).toBe('Gateway Frontend Key:');
    expect(panel.getApiKeyHelp()).toContain('session and websocket auth');
  });

  test('Botcky endpoint normalization migrates legacy local connector ports', () => {
    const panel = new AISettingsPanel();

    expect(panel.normalizeBotckyEndpoint('http://localhost:7112')).toBe('http://127.0.0.1:7110');
    expect(panel.normalizeBotckyEndpoint('http://localhost:3005/gateway')).toBe('http://127.0.0.1:7110');
    expect(panel.normalizeBotckyEndpoint('http://192.168.1.4:3005')).toBe('http://192.168.1.4:3005');
  });


  test('Botcky settings can delete all Gateway sessions returned by the Gateway', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (url, init = {}) => {
      if (!init.method) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ sessions: [{ id: 'session-1' }, { session_id: 'session-2' }] }),
        };
      }
      return { ok: true, status: 204, text: async () => '' };
    });
    global.fetch = fetchMock;
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    const panel = new AISettingsPanel();
    panel.container = document.createElement('div');
    panel.state.provider = 'botckyGateway';
    panel.state.endpoint = 'http://127.0.0.1:7110';
    panel.state.apiKey = 'front-key';

    try {
      await panel.deleteAllBotckySessions();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:7110/gateway/chat/sessions?platform=vault',
        expect.objectContaining({ headers: expect.objectContaining({ 'X-Gateway-Frontend-Key': 'front-key' }) })
      );
      expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-1');
      expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
      expect(fetchMock.mock.calls[2][0]).toBe('http://127.0.0.1:7110/gateway/chat/sessions/session-2');
      expect(fetchMock.mock.calls[2][1].method).toBe('DELETE');
      expect(panel.container.textContent).toContain('Vault Botcky sessions');
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  test('Gemini quick setup preserves saved provider values', async () => {
    invoke.mockResolvedValue({
      provider: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/',
      api_key: 'gemini-key',
      model: 'gemini-2.0-flash',
      temperature: 0.7,
      max_tokens: 4096,
      streaming_enabled: true,
    });

    const panel = new AISettingsPanel();
    panel.container = document.createElement('div');

    await panel.quickSetup('gemini');

    expect(panel.state.provider).toBe('gemini');
    expect(panel.state.endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/');
    expect(panel.state.model).toBe('gemini-2.0-flash');
    expect(panel.state.apiKey).toBe('gemini-key');
  });

  test('typing a Gemini API key updates state before Save is clicked', async () => {
    invoke.mockResolvedValue(undefined);

    const panel = new AISettingsPanel();
    panel.container = document.createElement('div');
    panel.callbacks = {};
    panel.state.provider = 'gemini';
    panel.state.endpoint = 'https://generativelanguage.googleapis.com/v1beta/';
    panel.state.model = 'gemini-2.0-flash';

    const input = document.createElement('input');
    input.dataset.action = 'update-api-key';
    input.value = 'live-gemini-key';
    panel.handleContainerInput({ target: input });

    await panel.saveSettings();

    expect(invoke).toHaveBeenCalledWith('save_ai_settings', expect.objectContaining({
      settings: expect.objectContaining({
        provider: 'gemini',
        api_key: 'live-gemini-key',
      }),
    }));
  });

  test('saving Botcky settings migrates a legacy local connector secret to the local Gateway dev key', async () => {
    invoke.mockResolvedValue(undefined);

    const panel = new AISettingsPanel();
    panel.container = document.createElement('div');
    panel.callbacks = {};
    panel.state.provider = 'botckyGateway';
    panel.state.endpoint = 'http://127.0.0.1:7110';
    panel.state.apiKey = 'f856d3aa637d6027e039a35ed161d0da53e4f852492672d6fcf68ed5b194a76d';
    panel.state.model = 'botcky-agent';

    await panel.saveSettings();

    expect(panel.state.apiKey).toBe('dev-gateway-key');
    expect(invoke).toHaveBeenCalledWith('save_ai_settings', expect.objectContaining({
      settings: expect.objectContaining({ api_key: 'dev-gateway-key' }),
    }));
  });

  test('saving Botcky settings persists the normalized native Gateway endpoint', async () => {
    invoke.mockResolvedValue(undefined);

    const panel = new AISettingsPanel();
    panel.container = document.createElement('div');
    panel.callbacks = {};
    panel.state.provider = 'botckyGateway';
    panel.state.endpoint = 'http://localhost:7112';
    panel.state.model = 'botcky-agent';

    await panel.saveSettings();

    expect(panel.state.endpoint).toBe('http://127.0.0.1:7110');
    expect(invoke).toHaveBeenCalledWith('save_ai_settings', expect.objectContaining({
      settings: expect.objectContaining({ endpoint: 'http://127.0.0.1:7110' }),
    }));
  });
});
