import { GeminiSDK } from '../GeminiSDK.js';
import { AIProvider } from './AIProvider.js';
import { buildProviderMessages, normalizeErrorText } from './provider-events.js';

export class GeminiProvider extends AIProvider {
  constructor(sdk = new GeminiSDK()) {
    super({ sdk, name: 'Google Gemini' });
  }

  async buildMessages(request) {
    return buildProviderMessages(this.sdk, request);
  }

  async *stream(request) {
    try {
      const messages = await this.buildMessages(request);
      yield { type: 'start', model: this.getSettings()?.model };

      const stream = await this.sdk.streamChat(messages);
      let text = '';

      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          const content = chunk.content || chunk.text || '';
          text += content;
          yield { type: 'chunk', text: content };
        } else if (chunk.type === 'function_call') {
          yield {
            type: 'tool_use',
            id: chunk.functionCall?.name || `gemini-function-${Date.now()}`,
            toolName: chunk.functionCall?.name,
            toolInput: parseToolArguments(chunk.functionCall?.arguments),
          };
        }
      }

      yield { type: 'result', success: true, text };
    } catch (error) {
      yield { type: 'error', error: normalizeErrorText(error, 'Gemini stream failed') };
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
