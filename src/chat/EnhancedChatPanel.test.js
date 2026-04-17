/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';

const invokeMock = jest.fn();

class MockChatInterface {
  constructor() {
    this.addMessage = jest.fn();
    this.showTyping = jest.fn();
    this.hideTyping = jest.fn();
    this.mount = jest.fn();
    this.saveMessages = jest.fn();
  }
}

class MockNoopClass {
  constructor() {}
}

class MockSDK {
  async initialize() {
    return false;
  }
}

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

jest.unstable_mockModule('./ChatInterface.js', () => ({
  ChatInterface: MockChatInterface,
}));

jest.unstable_mockModule('./ClaudeAuth.js', () => ({
  ClaudeAuth: MockNoopClass,
}));

jest.unstable_mockModule('./ContextManager.js', () => ({
  ContextManager: MockNoopClass,
}));

jest.unstable_mockModule('./ChatPersistence.js', () => ({
  ChatPersistence: MockNoopClass,
}));

jest.unstable_mockModule('./OpenAISDK.js', () => ({
  OpenAISDK: MockSDK,
}));

jest.unstable_mockModule('./GeminiSDK.js', () => ({
  GeminiSDK: MockSDK,
}));

jest.unstable_mockModule('./BedrockClaudeSDK.js', () => ({
  BedrockClaudeSDK: MockSDK,
}));

jest.unstable_mockModule('../settings/AISettingsPanel.js', () => ({
  AISettingsPanel: MockNoopClass,
}));

jest.unstable_mockModule('../components/ModeToggle.js', () => ({
  ModeToggle: MockNoopClass,
}));

jest.unstable_mockModule('../cli/CLIContainer.js', () => ({
  CLIContainer: MockNoopClass,
}));

jest.unstable_mockModule('../cli/XTermContainer.js', () => ({
  XTermContainer: MockNoopClass,
}));

jest.unstable_mockModule('../mcp/MCPManager.js', () => ({
  mcpManager: {
    stopAllServers: jest.fn(),
    startAllEnabledServers: jest.fn(),
    clients: new Map(),
    capabilities: new Map(),
    status: new Map(),
  },
}));

jest.unstable_mockModule('../mcp/MCPToolHandler.js', () => ({
  mcpToolHandler: {},
}));

jest.unstable_mockModule('./GemmaPromptToolCalling.js', () => ({
  gemmaPromptToolCalling: {},
}));

jest.unstable_mockModule('./TagContextExpander.js', () => ({
  tagContextExpander: {
    enhanceConversationWithTags: jest.fn(async () => null),
  },
}));

jest.unstable_mockModule('./ClaudeAgentSDK.js', () => ({
  ClaudeAgentSDK: MockSDK,
}));

jest.unstable_mockModule('./BotckyGatewaySDK.js', () => ({
  BotckyGatewaySDK: MockSDK,
}));

jest.unstable_mockModule('../components/AgentCostDisplay.js', () => ({
  AgentCostDisplay: MockNoopClass,
}));

let EnhancedChatPanel;

beforeAll(async () => {
  ({ EnhancedChatPanel } = await import('./EnhancedChatPanel.js'));
});

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
});

describe('EnhancedChatPanel Botcky lifecycle', () => {
  test('syncBotckyVaultPath updates SDK config without reconnecting', () => {
    const panel = new EnhancedChatPanel();
    panel.providers.botckyGateway.sdk = {
      vaultPath: null,
      baseConfig: { endpoint: 'http://192.168.1.4:3005' },
      botckyConfig: { workspace_id: 'vault-desktop' },
      settings: { endpoint: 'http://192.168.1.4:3005' },
    };

    panel.syncBotckyVaultPath('/tmp/vault-path');

    expect(panel.providers.botckyGateway.sdk.vaultPath).toBe('/tmp/vault-path');
    expect(panel.providers.botckyGateway.sdk.baseConfig.vault_path).toBe('/tmp/vault-path');
    expect(panel.providers.botckyGateway.sdk.botckyConfig.vault_path).toBe('/tmp/vault-path');
    expect(panel.providers.botckyGateway.sdk.settings.vault_path).toBe('/tmp/vault-path');
  });

  test('handleSendMessage surfaces an error when Botcky lazy init fails', async () => {
    const panel = new EnhancedChatPanel();
    const addMessage = jest.fn();
    const initialize = jest.fn().mockResolvedValue(false);

    panel.interface = {
      addMessage,
      showTyping: jest.fn(),
    };
    panel.currentProvider = 'botckyGateway';
    panel.providers.botckyGateway.configured = true;
    panel.providers.botckyGateway.status = 'error';
    panel.providers.botckyGateway.sdk = {
      isInitialized: false,
      initialize,
      isReady: jest.fn(() => false),
      getSettings: jest.fn(() => ({
        endpoint: 'http://192.168.1.4:3005',
        max_tokens: 8000,
      })),
    };

    invokeMock.mockResolvedValue({
      endpoint: 'http://192.168.1.4:3005',
      api_key: 'secret',
      model: 'botcky-agent',
    });

    await panel.handleSendMessage('hello');

    expect(initialize).toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      content: 'Botcky Agent is not ready. Open settings and test the connection again.',
    }));
  });

  test('handleSendMessage reinitializes Botcky when the SDK is initialized but not ready', async () => {
    const panel = new EnhancedChatPanel();
    const addMessage = jest.fn();
    const initialize = jest.fn().mockResolvedValue(false);

    panel.interface = {
      addMessage,
      showTyping: jest.fn(),
    };
    panel.currentProvider = 'botckyGateway';
    panel.providers.botckyGateway.configured = true;
    panel.providers.botckyGateway.status = 'not-configured';
    panel.providers.botckyGateway.sdk = {
      isInitialized: true,
      initialize,
      isReady: jest.fn(() => false),
      getSettings: jest.fn(() => ({
        endpoint: 'http://192.168.1.4:3005',
        max_tokens: 8000,
      })),
    };

    invokeMock.mockResolvedValue({
      endpoint: 'http://192.168.1.4:3005',
      api_key: 'secret',
      model: 'botcky-agent',
    });

    await panel.handleSendMessage('hello');

    expect(initialize).toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      content: 'Botcky Agent is not ready. Open settings and test the connection again.',
    }));
  });
});
