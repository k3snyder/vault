// BedrockClaudeSDK.js - Amazon Bedrock (Claude) integration via proxy
import { invoke } from '@tauri-apps/api/core';

export class BedrockClaudeSDK {
  constructor() {
    this.settings = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Load provider-specific settings to avoid relying on active provider
      try {
        this.settings = await invoke('get_ai_settings_for_provider', { provider: 'bedrock' });
      } catch (e) {
        // Fallback to active provider if provider-specific fetch fails
        this.settings = await invoke('get_ai_settings');
      }
      this.isInitialized = !!this.settings;
      return this.isInitialized;
    } catch (error) {
      console.error('Failed to initialize BedrockClaudeSDK:', error);
      this.isInitialized = false;
      return false;
    }
  }

  getSettings() {
    return this.settings;
  }

  buildPrompt(userMessage, contextNotes = [], tagEnhancement = null) {
    const settings = this.getSettings() || {};
    const systemPrompt = settings.system_prompt || 'You are a helpful assistant integrated into a local-first notes app. Provide concise, accurate answers. Prefer actionable lists. If context notes are provided, prioritize them over chat history.';

    let prompt = '';
    prompt += `${systemPrompt}\n\n`;

    if (tagEnhancement?.additionalContext && tagEnhancement.additionalContext.length > 0) {
      prompt += `Tags: ${tagEnhancement.additionalContext.join(', ')}\n\n`;
    }

    if (contextNotes && contextNotes.length > 0) {
      const contextContent = contextNotes.map(note => {
        const title = note.title || note.name || 'Untitled Note';
        const content = note.content || '';
        return `Note: ${title}\n${content}`;
      }).join('\n\n---\n\n');
      prompt += `CURRENT CONTEXT - The user is currently viewing and asking about the following note(s):\n\n${contextContent}\n\n---\n\n`;
    }

    prompt += `USER: ${userMessage}\n`;
    prompt += 'ASSISTANT:';

    return prompt;
  }

  async sendMessage(userMessage, contextNotes = [], tagEnhancement = null) {
    if (!this.isInitialized) throw new Error('SDK not initialized');
    const settings = this.getSettings();
    if (!settings?.endpoint) throw new Error('Bedrock endpoint not configured');
    if (!settings?.api_key) throw new Error('Bedrock API key not configured');
    if (!settings?.model) throw new Error('Bedrock model not configured');

    const base = settings.endpoint.replace(/\/$/, '');
    const url = `${base}/model/${encodeURIComponent(settings.model)}/converse`;

    const prompt = this.buildPrompt(userMessage, contextNotes, tagEnhancement);

    const headers = {
      'Authorization': `Bearer ${settings.api_key}`,
      'Content-Type': 'application/json'
    };
    // Parse URL if needed (no automatic proxy headers; use custom headers from settings)
    try {
      // eslint-disable-next-line no-new
      new URL(base);
    } catch (e) {
      // ignore URL parse errors
    }

    // Add any custom headers
    if (settings.headers && Array.isArray(settings.headers)) {
      for (const kv of settings.headers) {
        if (!kv || !kv.name) continue;
        if (kv.name.toLowerCase() === 'authorization' || kv.name.toLowerCase() === 'content-type') continue;
        headers[kv.name] = kv.value ?? '';
      }
    }

    const body = {
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }]
        }
      ]
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Bedrock API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    // Expected shape (per provided example): output.message.content[0].text
    const text = data?.output?.message?.content?.[0]?.text;
    if (!text) {
      throw new Error('No text in Bedrock response');
    }
    return text;
  }
}
