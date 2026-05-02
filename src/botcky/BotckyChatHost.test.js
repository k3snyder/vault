/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { gatewayWsUrl } from './botckyGatewayClient.js';

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: jest.fn(async () => ({ endpoint: 'http://127.0.0.1:7110', api_key: null })),
}));

let BotckyChatHost;
let invoke;

beforeAll(async () => {
  ({ invoke } = await import('@tauri-apps/api/core'));
  ({ BotckyChatHost } = await import('./BotckyChatHost.js'));
});

describe('BotckyChatHost', () => {
  test('mount/unmount delegates to contained React root', async () => {
    const render = jest.fn();
    const unmount = jest.fn();
    const host = new BotckyChatHost({ ReactRoot: () => ({ render, unmount }) });
    const container = document.createElement('div');
    await host.mount(container);
    expect(render).toHaveBeenCalled();
    expect(host.mounted).toBe(true);
    host.unmount();
    expect(unmount).toHaveBeenCalled();
    expect(host.mounted).toBe(false);
  });



  test('mount maps legacy local connector secret to the local Gateway dev key', async () => {
    invoke.mockResolvedValueOnce({
      endpoint: 'http://127.0.0.1:7110',
      api_key: 'f856d3aa637d6027e039a35ed161d0da53e4f852492672d6fcf68ed5b194a76d',
    });
    const render = jest.fn();
    const host = new BotckyChatHost({ ReactRoot: () => ({ render, unmount: jest.fn() }) });

    await host.mount(document.createElement('div'));

    expect(render.mock.calls[0][0].props).toMatchObject({
      endpoint: 'http://127.0.0.1:7110',
      apiKey: 'dev-gateway-key',
    });
  });

  test('passes Botcky context UI callbacks through to the React app', async () => {
    const render = jest.fn();
    const contextUiProvider = jest.fn(() => ({ activeNote: null, selectedNotes: [] }));
    const onAddContext = jest.fn();
    const onRemoveContext = jest.fn();
    const onRemoveActiveNoteContext = jest.fn();
    const onIncludeActiveNoteContext = jest.fn();
    const host = new BotckyChatHost({
      ReactRoot: () => ({ render, unmount: jest.fn() }),
      contextUiProvider,
      onAddContext,
      onRemoveContext,
      onRemoveActiveNoteContext,
      onIncludeActiveNoteContext,
    });

    await host.mount(document.createElement('div'));

    expect(render.mock.calls[0][0].props).toMatchObject({
      contextUiProvider,
      onAddContext,
      onRemoveContext,
      onRemoveActiveNoteContext,
      onIncludeActiveNoteContext,
    });
  });

  test('native websocket URL targets Gateway chat route only', () => {
    const url = gatewayWsUrl('http://127.0.0.1:7110', 'session-1', 42, 'front-key');
    expect(url).toContain('/gateway/ws/chat');
    expect(url).toContain('after_seq=42');
    expect(url).toContain('api_key=front-key');
  });
});
