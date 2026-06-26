export class AIProvider {
  constructor({ sdk, name }) {
    this.sdk = sdk;
    this.name = name;
  }

  get isInitialized() {
    return Boolean(this.sdk?.isInitialized);
  }

  getSettings() {
    return this.sdk?.getSettings?.() || null;
  }

  initialize(...args) {
    return this.sdk.initialize(...args);
  }

  isReady() {
    if (typeof this.sdk?.isReady === 'function') {
      return this.sdk.isReady();
    }
    return Boolean(this.sdk?.isInitialized);
  }

  async disconnect() {
    if (typeof this.sdk?.disconnect === 'function') {
      await this.sdk.disconnect();
    }
  }

  abort() {
    this.sdk?.abort?.();
    this.sdk?.abortStream?.();
    this.sdk?.stopStream?.();
    this.sdk?.cancelStream?.();
  }

  async *stream() {
    throw new Error(`${this.name} provider has not implemented stream()`);
  }
}
