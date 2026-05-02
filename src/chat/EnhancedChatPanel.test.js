/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';

const invokeMock = jest.fn();

class MockChatInterface {
  constructor() {
    this.messages = [];
    this.addMessage = jest.fn();
    this.showTyping = jest.fn();
    this.hideTyping = jest.fn();
    this.mount = jest.fn();
    this.saveMessages = jest.fn(() => {
      this.onMessagesChanged?.(this.messages);
    });
    this.getMessages = jest.fn(() => this.messages);
    this.loadMessages = jest.fn((messages = []) => {
      this.messages = Array.isArray(messages) ? messages : [];
    });
    this.clearMessages = jest.fn(() => {
      this.messages = [];
      this.onMessagesChanged?.([]);
    });
    this.onMessagesChanged = null;
  }
}

class MockNoopClass {
  constructor() {
    this.element = document.createElement('div');
  }

  mount() {}
  setMode() {}
  checkAuthStatus() {}
}

class MockSDK {
  async initialize() {
    return false;
  }
}

class MockChatPersistence {
  saveHistory = jest.fn();
  loadHistory = jest.fn(() => null);
  clearHistory = jest.fn();
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
  ChatPersistence: MockChatPersistence,
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

jest.unstable_mockModule('../cli/XTermContainer.js', () => ({
  XTermContainer: MockNoopClass,
}));

jest.unstable_mockModule('./TagContextExpander.js', () => ({
  tagContextExpander: {
    enhanceConversationWithTags: jest.fn(async () => null),
  },
}));

jest.unstable_mockModule('./ClaudeAgentSDK.js', () => ({
  ClaudeAgentSDK: MockSDK,
}));

jest.unstable_mockModule('../components/AgentCostDisplay.js', () => ({
  AgentCostDisplay: MockNoopClass,
}));

let EnhancedChatPanel;

beforeAll(async () => {
  ({ EnhancedChatPanel } = await import('./EnhancedChatPanel.js'));
});

describe('EnhancedChatPanel local AI chat sessions', () => {
  test('migrates existing localStorage messages into the first AI chat session', () => {
    const panel = new EnhancedChatPanel();
    panel.interface = {
      getMessages: jest.fn(() => [{
        id: 'm1',
        type: 'user',
        content: 'hello',
        timestamp: '2026-05-02T12:00:00.000Z',
      }]),
      loadMessages: jest.fn(),
    };

    panel.initializeChatSessions();

    const stored = JSON.parse(localStorage.getItem('gaimplan-ai-chat-sessions-v1'));
    expect(stored.sessions).toHaveLength(1);
    expect(stored.sessions[0].title).toBe('Session 1');
    expect(stored.sessions[0].messages[0].content).toBe('hello');
    expect(panel.interface.loadMessages).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ content: 'hello' })]),
      { persist: true }
    );
  });

  test('archive exports active AI chat session and starts a replacement session', async () => {
    invokeMock.mockResolvedValue('/vault/Chat History/chat-2026.md');
    const panel = new EnhancedChatPanel();
    panel.interface = {
      getMessages: jest.fn(() => [{
        id: 'm1',
        type: 'assistant',
        content: 'answer',
        timestamp: '2026-05-02T12:00:00.000Z',
      }]),
      loadMessages: jest.fn(),
    };
    panel.updateUI = jest.fn();
    panel.showNotification = jest.fn();
    panel.initializeChatSessions();

    await panel.archiveAiChatSession();

    expect(invokeMock).toHaveBeenCalledWith('export_chat_to_vault', expect.objectContaining({
      content: expect.stringContaining('answer'),
      filename: null,
    }));
    const stored = JSON.parse(localStorage.getItem('gaimplan-ai-chat-sessions-v1'));
    expect(stored.sessions.filter(session => session.status === 'archived')).toHaveLength(1);
    expect(stored.sessions.filter(session => session.status === 'active')).toHaveLength(1);
    expect(panel.interface.loadMessages).toHaveBeenLastCalledWith([], { persist: true });
  });

  test('archive uses live interface messages when stored session metadata is stale', async () => {
    invokeMock.mockResolvedValue('/vault/Chat History/chat-2026.md');
    const panel = new EnhancedChatPanel();
    panel.interface = {
      getMessages: jest.fn(() => [{
        id: 'live-message',
        type: 'user',
        content: 'live unsaved content',
        timestamp: '2026-05-02T12:00:00.000Z',
      }]),
      loadMessages: jest.fn(),
    };
    panel.updateUI = jest.fn();
    panel.showNotification = jest.fn();
    panel.initializeChatSessions();
    panel.getActiveChatSession().messages = [];
    panel.persistChatSessions();

    await panel.archiveAiChatSession();

    expect(invokeMock).toHaveBeenCalledWith('export_chat_to_vault', expect.objectContaining({
      content: expect.stringContaining('live unsaved content'),
      filename: null,
    }));
    const stored = JSON.parse(localStorage.getItem('gaimplan-ai-chat-sessions-v1'));
    const archived = stored.sessions.find(session => session.status === 'archived');
    expect(archived.messages).toEqual([
      expect.objectContaining({ id: 'live-message', content: 'live unsaved content' })
    ]);
  });

  test('delete purges the active AI chat session without archiving it', () => {
    window.confirm = jest.fn(() => true);
    const panel = new EnhancedChatPanel();
    panel.interface = {
      getMessages: jest.fn(() => [{
        id: 'm1',
        type: 'user',
        content: 'delete me',
        timestamp: '2026-05-02T12:00:00.000Z',
      }]),
      loadMessages: jest.fn(),
    };
    panel.updateUI = jest.fn();
    panel.showNotification = jest.fn();
    panel.initializeChatSessions();

    const deletedId = panel.activeChatSessionId;
    panel.deleteAiChatSession();

    const stored = JSON.parse(localStorage.getItem('gaimplan-ai-chat-sessions-v1'));
    expect(stored.sessions.some(session => session.id === deletedId)).toBe(false);
    expect(stored.sessions).toHaveLength(1);
    expect(stored.sessions[0].messages).toEqual([]);
    expect(panel.interface.loadMessages).toHaveBeenLastCalledWith([], { persist: true });
  });
});

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
});

describe('EnhancedChatPanel native Botcky provider routing', () => {
  test('mount leaves Botcky Gateway SDK uninstantiated but available for native host', async () => {
    invokeMock.mockImplementation(async command => {
      if (command === 'get_active_ai_provider') return 'openai';
      return { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4' };
    });

    const panel = new EnhancedChatPanel();
    const parent = document.createElement('div');

    await panel.mount(parent);

    expect(panel.providers.botckyGateway.sdk).toBeNull();
    expect(panel.providers.botckyGateway.status).toBe('not-configured');
  });

  test('loadSavedProvider activates native Botcky mode when backend active provider is Botcky', async () => {
    invokeMock.mockResolvedValue('botckyGateway');
    const panel = new EnhancedChatPanel();

    await panel.loadSavedProvider();

    expect(panel.currentProvider).toBe('botckyGateway');
    expect(panel.currentMode).toBe('botcky');
    expect(panel.providers.botckyGateway.sdk).toBeNull();
    expect(panel.providers.botckyGateway.status).toBe('ready');
    expect(localStorage.getItem('gaimplan-chat-mode')).toBe('botcky');
  });

  test('handleSendMessage switches to native Botcky UI without using legacy SDK chat', async () => {
    const panel = new EnhancedChatPanel();
    const addMessage = jest.fn();
    const initialize = jest.fn();
    const chat = jest.fn();
    const getSettings = jest.fn(() => ({ endpoint: 'http://192.168.1.4:3005', max_tokens: 8000 }));

    panel.interface = {
      addMessage,
      showTyping: jest.fn(),
    };
    panel.currentProvider = 'botckyGateway';
    panel.providers.botckyGateway.configured = true;
    panel.providers.botckyGateway.status = 'ready';
    panel.providers.botckyGateway.sdk = {
      initialize,
      chat,
      isReady: jest.fn(() => true),
      getSettings,
    };

    await panel.handleSendMessage('hello');

    expect(initialize).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('get_ai_settings_for_provider', expect.anything());
    expect(addMessage).not.toHaveBeenCalled();
    expect(panel.currentProvider).toBe('botckyGateway');
    expect(panel.currentMode).toBe('botcky');
  });

  test('initializeProviders selects Botcky as the native active provider', async () => {
    invokeMock.mockImplementation(async command => {
      if (command === 'get_ai_settings') {
        return { provider: 'botckyGateway', endpoint: 'http://127.0.0.1:7110', model: 'botcky-agent' };
      }
      if (command === 'get_ai_settings_for_provider') {
        return { provider: 'claudeAgent', endpoint: 'https://api.anthropic.com', model: 'claude-sonnet-4-5-20250929' };
      }
      return null;
    });

    const panel = new EnhancedChatPanel();
    panel.providers.openai.sdk = new MockSDK();
    panel.providers.gemini.sdk = new MockSDK();
    panel.providers.bedrock.sdk = new MockSDK();
    panel.providers.claudeAgent.sdk = new MockSDK();

    await panel.initializeProviders();

    expect(panel.currentProvider).toBe('botckyGateway');
    expect(panel.currentMode).toBe('botcky');
    expect(panel.providers.botckyGateway.sdk).toBeNull();
    expect(panel.providers.botckyGateway.configured).toBe(true);
    expect(panel.providers.botckyGateway.status).toBe('ready');
    expect(localStorage.getItem('gaimplan-chat-provider')).toBe('botckyGateway');
    expect(localStorage.getItem('gaimplan-chat-mode')).toBe('botcky');
  });
});
