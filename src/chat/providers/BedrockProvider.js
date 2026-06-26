import { BedrockClaudeSDK } from '../BedrockClaudeSDK.js';
import { AIProvider } from './AIProvider.js';
import { normalizeErrorText } from './provider-events.js';

export class BedrockProvider extends AIProvider {
  constructor(sdk = new BedrockClaudeSDK()) {
    super({ sdk, name: 'Amazon Bedrock (Claude)' });
  }

  async *stream({ message, context = [], tagEnhancement = null } = {}) {
    try {
      yield { type: 'start', model: this.getSettings()?.model };
      const text = await this.sdk.sendMessage(message, context, tagEnhancement);
      if (text) {
        yield { type: 'chunk', text };
      }
      yield { type: 'result', success: true, text };
    } catch (error) {
      yield { type: 'error', error: normalizeErrorText(error, 'Bedrock chat failed') };
    }
  }
}
