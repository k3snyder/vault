import { OpenAISDK } from '../OpenAISDK.js';
import { AIProvider } from './AIProvider.js';
import {
  buildProviderMessages,
  extractResponseText,
  normalizeErrorText,
} from './provider-events.js';

class AsyncEventQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }

    this.items.push(item);
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true });
    }
  }

  async next() {
    const item = this.items.shift();
    if (item) {
      return { value: item, done: false };
    }

    if (this.closed) {
      return { done: true };
    }

    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class OpenAIProvider extends AIProvider {
  constructor(sdk = new OpenAISDK()) {
    super({ sdk, name: 'OpenAI/Custom' });
  }

  shouldUseStreaming() {
    const settings = this.getSettings();
    if (!settings) {
      return true;
    }

    const endpoint = settings.endpoint || '';
    const isOllamaNative =
      (endpoint.includes('ollama') || endpoint.includes('11434')) && !endpoint.includes('/v1');
    return !isOllamaNative;
  }

  async buildMessages(request) {
    return buildProviderMessages(this.sdk, request);
  }

  async *stream(request) {
    const messages = await this.buildMessages(request);
    if (!messages.length) {
      yield { type: 'error', error: 'No messages to send' };
      return;
    }

    yield { type: 'start', model: this.getSettings()?.model };

    if (!this.shouldUseStreaming()) {
      try {
        const response = await this.sdk.sendChat(messages);
        const text = extractResponseText(response);
        if (text) {
          yield { type: 'chunk', text };
        }
        yield { type: 'result', success: true, text };
      } catch (error) {
        yield { type: 'error', error: normalizeErrorText(error, 'OpenAI chat failed') };
      }
      return;
    }

    const queue = new AsyncEventQueue();
    let text = '';

    this.sdk
      .sendChatStream(messages, {
        onToken: (token) => {
          text += token;
          queue.push({ type: 'chunk', text: token });
        },
        onFunctionCall: (functionCall) => {
          queue.push({
            type: 'tool_use',
            id: functionCall.name || `function-${Date.now()}`,
            toolName: functionCall.name,
            toolInput: parseToolArguments(functionCall.arguments),
          });
        },
        onToolCall: (toolCall) => {
          queue.push({
            type: 'tool_use',
            id: toolCall.id || toolCall.name || `tool-${Date.now()}`,
            toolName: toolCall.name,
            toolInput: parseToolArguments(toolCall.arguments),
          });
        },
        onError: (error) => {
          queue.push({ type: 'error', error: normalizeErrorText(error, 'OpenAI stream failed') });
          queue.close();
        },
        onDone: () => {
          queue.push({ type: 'result', success: true, text });
          queue.close();
        },
      })
      .catch((error) => {
        queue.push({ type: 'error', error: normalizeErrorText(error, 'OpenAI stream failed') });
        queue.close();
      });

    while (true) {
      const { value, done } = await queue.next();
      if (done) {
        break;
      }
      yield value;
      if (value.type === 'error') {
        break;
      }
    }
  }
}

function parseToolArguments(args) {
  if (!args || typeof args !== 'string') {
    return args || {};
  }

  try {
    return JSON.parse(args);
  } catch (error) {
    return { arguments: args };
  }
}
