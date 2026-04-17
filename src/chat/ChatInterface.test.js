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
});
