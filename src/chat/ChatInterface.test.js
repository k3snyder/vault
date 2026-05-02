/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../icons/icon-utils.js', () => {
  const iconFn = (name) => jest.fn(() => `<svg data-icon="${name}"></svg>`);
  const icons = new Proxy({}, {
    get: (_, prop) => iconFn(String(prop))
  });

  return { icons };
});

jest.unstable_mockModule('../components/ToolUseCard.js', () => ({
  ToolUseCard: class MockToolUseCard {
    constructor() {
      this.element = document.createElement('div');
      this.element.className = 'tool-use-card';
    }

    getElement() {
      return this.element;
    }

    setResult() {}
    setStatus() {}
  }
}));

let ChatInterface;

beforeAll(async () => {
  ({ ChatInterface } = await import('./ChatInterface.js'));
});

describe('ChatInterface XSS hardening', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.spyOn(global, 'setInterval').mockReturnValue(1);
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
  });

  afterEach(() => {
    delete window.paneManager;
    delete window.chatContextManager;
    jest.restoreAllMocks();
  });

  function mountChatWithMessages(messages = []) {
    if (messages.length > 0) {
      localStorage.setItem('gaimplan-chat-messages', JSON.stringify(messages));
    }

    const chat = new ChatInterface();
    const container = document.createElement('div');
    document.body.appendChild(container);
    chat.mount(container);
    return { chat, container };
  }

  test('renders assistant HTML payloads as inert text and safe markdown nodes', () => {
    const { chat, container } = mountChatWithMessages();

    chat.addMessage({
      id: 'assistant-1',
      type: 'assistant',
      content: 'Hello <img src=x onerror=alert(1)> **bold** `code` [docs](https://example.com)'
    });

    const content = container.querySelector('[data-message-id="assistant-1"] .message-content');

    expect(content).toBeTruthy();
    expect(content.querySelector('img')).toBeNull();
    expect(content.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(content.querySelector('strong')).toBeTruthy();
    expect(content.querySelector('code.inline-code')).toBeTruthy();
    expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(content.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('rejects javascript: links in assistant markdown', () => {
    const { chat, container } = mountChatWithMessages();

    chat.addMessage({
      id: 'assistant-2',
      type: 'assistant',
      content: '[click me](javascript:alert(1))'
    });

    const content = container.querySelector('[data-message-id="assistant-2"] .message-content');

    expect(content).toBeTruthy();
    expect(content.querySelector('a')).toBeNull();
    expect(content.textContent).toContain('click me');
    expect(content.textContent).not.toContain('javascript:');
  });

  test('uses the safe renderer during streaming updates', () => {
    const { chat, container } = mountChatWithMessages();

    chat.addMessage({
      id: 'stream-1',
      type: 'assistant',
      content: 'Initial'
    });

    chat.updateMessage('stream-1', 'Updated <img src=x onerror=alert(1)> [docs](javascript:alert(1)) **bold**');

    const content = container.querySelector('[data-message-id="stream-1"] .message-content');

    expect(content).toBeTruthy();
    expect(content.querySelector('img')).toBeNull();
    expect(content.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(content.querySelector('strong')).toBeTruthy();
    expect(content.querySelector('.streaming-cursor')).toBeTruthy();

    chat.finalizeStreamingMessage('stream-1');

    expect(content.querySelector('.streaming-cursor')).toBeNull();
  });

  test('renders previously saved malicious content safely on reload', () => {
    const { container } = mountChatWithMessages([
      {
        id: 'saved-1',
        type: 'assistant',
        content: 'Stored <img src=x onerror=alert(1)> [docs](javascript:alert(1))'
      }
    ]);

    const content = container.querySelector('[data-message-id="saved-1"] .message-content');

    expect(content).toBeTruthy();
    expect(content.querySelector('img')).toBeNull();
    expect(content.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(content.textContent).toContain('Stored');
    expect(content.textContent).toContain('docs');
  });

  test('renders persisted task-created cards', () => {
    const { container } = mountChatWithMessages([
      {
        id: 'task-1',
        type: 'task_created',
        content: 'Tell me a joke',
        meta: {
          gateway_task_id: 'gwy_123',
          name: 'Tell me a joke',
        }
      }
    ]);

    const content = container.querySelector('[data-message-id="task-1"] .message-content');

    expect(content).toBeTruthy();
    expect(content.querySelector('.task-created-card')).toBeTruthy();
    expect(content.textContent).toContain('Tell me a joke');
    expect(content.textContent).toContain('Task ID: gwy_123');
  });

  test('renders date separators for thread start and day changes while message times stay hover-only', () => {
    const { container } = mountChatWithMessages([
      {
        id: 'day-two-assistant',
        type: 'assistant',
        content: 'new day',
        timestamp: '2026-05-04T13:05:00.000Z'
      },
      {
        id: 'day-one-user',
        type: 'user',
        content: 'hello',
        timestamp: '2026-05-02T12:23:16.000Z'
      }
    ]);

    const separators = [...container.querySelectorAll('.chat-date-separator')];
    expect(separators).toHaveLength(2);
    expect(separators[0].textContent).toContain('2026');
    expect(separators[0].textContent).toContain('May');

    const renderedMessages = [...container.querySelectorAll('[data-message-id]')].map(element => element.dataset.messageId);
    expect(renderedMessages).toEqual(['day-one-user', 'day-two-assistant']);

    expect(container.querySelector('[data-message-id="day-two-assistant"] .message-header')).toBeNull();

    const hoverTime = container.querySelector('[data-message-id="day-two-assistant"] .message-hover-time');
    expect(hoverTime).toBeTruthy();
    expect(hoverTime.textContent).not.toContain('May');
    expect(hoverTime.textContent).not.toContain('2026');
  });

  test('can load an explicit session message list and notify persistence callbacks', () => {
    const { chat, container } = mountChatWithMessages([
      { id: 'old', type: 'user', content: 'old session' }
    ]);
    const onMessagesChanged = jest.fn();
    chat.onMessagesChanged = onMessagesChanged;

    chat.loadMessages([
      {
        id: 'new',
        type: 'assistant',
        content: 'new session',
        timestamp: '2026-05-02T12:00:00.000Z'
      }
    ]);

    expect(container.querySelector('[data-message-id="old"]')).toBeNull();
    expect(container.querySelector('[data-message-id="new"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('gaimplan-chat-messages'))).toEqual([
      expect.objectContaining({ id: 'new', content: 'new session' })
    ]);
    expect(onMessagesChanged).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'new', content: 'new session' })
    ]);
  });

  test('lets the active editor note be removed from AI context while the tab remains open', () => {
    window.paneManager = {
      getActiveTabManager: () => ({
        getActiveTab: () => ({
          title: 'Active Note.md',
          filePath: 'Notes/Active Note.md'
        })
      })
    };

    const { chat, container } = mountChatWithMessages();
    chat.updateContext([
      { title: 'Active Note.md', path: 'Notes/Active Note.md', type: 'active' },
      { title: 'Other Note.md', path: 'Notes/Other Note.md' }
    ]);

    expect(container.querySelectorAll('.context-pill.active-note')).toHaveLength(1);
    expect(container.textContent).toContain('Active Note.md');
    expect(container.textContent).toContain('Other Note.md');

    container.querySelector('.context-pill.active-note .remove-context').click();

    expect(chat.shouldIncludeActiveNoteContext({
      title: 'Active Note.md',
      path: 'Notes/Active Note.md'
    })).toBe(false);
    expect(container.querySelector('.context-pill.active-note')).toBeNull();
    expect(container.textContent).toContain('Active note +');
    expect(container.textContent).toContain('Other Note.md');

    container.querySelector('.context-pill.excluded-active-note').click();

    expect(chat.shouldIncludeActiveNoteContext({
      title: 'Active Note.md',
      path: 'Notes/Active Note.md'
    })).toBe(true);
    expect(container.querySelectorAll('.context-pill.active-note')).toHaveLength(1);
  });
});
