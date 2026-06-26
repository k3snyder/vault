import { ClaudeAgentSDK } from '../ClaudeAgentSDK.js';
import { AIProvider } from './AIProvider.js';

export class ClaudeAgentProvider extends AIProvider {
  constructor(sdk = new ClaudeAgentSDK()) {
    super({ sdk, name: 'Claude' });
  }

  get currentModel() {
    return this.sdk?.currentModel;
  }

  async *stream({ message, context = [], options = {} } = {}) {
    yield* this.sdk.chat(message, context, options);
  }
}
