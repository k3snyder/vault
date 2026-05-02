import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { BotckyChatApp } from './BotckyChatApp.js';
import { DEFAULT_BOTCKY_GATEWAY_ENDPOINT, normalizeGatewayApiKey, normalizeGatewayBaseUrl } from './botckyGatewayClient.js';

export class BotckyChatHost {
  constructor({
    endpoint,
    apiKey,
    contextProvider,
    contextUiProvider,
    onAddContext,
    onRemoveContext,
    onRemoveActiveNoteContext,
    onIncludeActiveNoteContext,
    onSettings,
    ReactRoot = createRoot,
  } = {}) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.contextProvider = contextProvider || (async () => ({}));
    this.contextUiProvider = contextUiProvider;
    this.onAddContext = onAddContext;
    this.onRemoveContext = onRemoveContext;
    this.onRemoveActiveNoteContext = onRemoveActiveNoteContext;
    this.onIncludeActiveNoteContext = onIncludeActiveNoteContext;
    this.onSettings = onSettings;
    this.ReactRoot = ReactRoot;
    this.root = null;
    this.container = null;
    this.mounted = false;
  }

  async mount(container) {
    this.container = container;
    const settings = await this.loadSettings();
    const endpoint = normalizeGatewayBaseUrl(this.endpoint || settings.endpoint || DEFAULT_BOTCKY_GATEWAY_ENDPOINT);
    const apiKey = normalizeGatewayApiKey(this.apiKey || settings.api_key || null, endpoint);
    this.root = this.ReactRoot(container);
    this.root.render(React.createElement(BotckyChatApp, {
      endpoint,
      apiKey,
      contextProvider: this.contextProvider,
      contextUiProvider: this.contextUiProvider,
      onAddContext: this.onAddContext,
      onRemoveContext: this.onRemoveContext,
      onRemoveActiveNoteContext: this.onRemoveActiveNoteContext,
      onIncludeActiveNoteContext: this.onIncludeActiveNoteContext,
      onSettings: this.onSettings,
    }));
    this.mounted = true;
  }

  async loadSettings() {
    try {
      return await invoke('get_ai_settings_for_provider', { provider: 'botckyGateway' });
    } catch {
      return { endpoint: DEFAULT_BOTCKY_GATEWAY_ENDPOINT, api_key: null };
    }
  }

  unmount() {
    if (this.root) this.root.unmount();
    this.root = null;
    this.container = null;
    this.mounted = false;
  }

  destroy() {
    this.unmount();
  }
}
