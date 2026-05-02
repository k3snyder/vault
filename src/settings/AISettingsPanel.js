import { invoke } from '@tauri-apps/api/core';
import { icons } from '../icons/icon-utils.js';
import { BotckyGatewayNativeClient, normalizeGatewayApiKey } from '../botcky/botckyGatewayClient.js';

const BOTCKY_GATEWAY_DEFAULT_ENDPOINT = 'http://127.0.0.1:7110';
const BOTCKY_LEGACY_LOCAL_PORTS = new Set(['3002', '3005', '7112']);

export class AISettingsPanel {
    constructor() {
        this.state = {
            provider: 'openai',  // Track current provider
            endpoint: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4',
            temperature: 0.7,
            maxTokens: 2000,
            streamingEnabled: true,
            systemPrompt: null,
            headerName: '',
            headerValue: '',
            showApiKey: false,
            testing: false,
            saving: false,
            testStatus: null,
            showAdvanced: false,
            deletingBotckySessions: false,
            // Claude specific settings
            maxTurns: 10,
            // Tool permissions for Claude
            toolPermissions: {
                search_notes: true,
                get_note: true,
                get_current_note: true,
                list_tags: true,
                notes_by_tag: true,
                semantic_search: true,
                write_note: true,
                update_note: true,
                append_to_note: true
            }
        };
        
        this.container = null;
        this.callbacks = {
            onSave: null
        };
        this.activeProvider = null;  // Track the active provider
        this.listenersAttached = false;
        this.boundClickHandler = this.handleContainerClick.bind(this);
        this.boundChangeHandler = this.handleContainerChange.bind(this);
        this.boundInputHandler = this.handleContainerInput.bind(this);
    }
    
    async mount(container, callbacks = {}) {
        console.log('Mounting AI Settings Panel');
        if (this.container && this.container !== container) {
            this.detachEventListeners();
        }
        this.container = container;
        this.callbacks = { ...this.callbacks, ...callbacks };
        
        // Load the active provider
        await this.loadActiveProvider();
        await this.loadSettings();
        this.render();
        this.attachEventListeners();
    }
    
    async loadActiveProvider() {
        try {
            const activeProvider = await invoke('get_active_ai_provider');
            this.activeProvider = activeProvider;
            this.state.provider = activeProvider;
            console.log('Active AI provider:', activeProvider);
        } catch (error) {
            console.error('Failed to load active provider:', error);
            this.activeProvider = 'openai';
            this.state.provider = 'openai';
        }
    }
    
    async loadSettings() {
        try {
            const settings = await invoke('get_ai_settings');
            if (settings) {
                console.log('Loaded AI settings:', { ...settings, api_key: '***' });
                const provider = settings.provider || this.state.provider;
                const endpoint = provider === 'botckyGateway'
                    ? this.normalizeBotckyEndpoint(settings.endpoint)
                    : settings.endpoint;
                // Convert snake_case to camelCase for frontend use
                this.state = {
                    ...this.state,
                    provider,
                    endpoint,
                    apiKey: provider === 'botckyGateway'
                        ? normalizeGatewayApiKey(settings.api_key, endpoint) || ''
                        : settings.api_key || '',
                    model: settings.model,
                    temperature: settings.temperature,
                    maxTokens: settings.max_tokens,
                    streamingEnabled: settings.streaming_enabled !== undefined ? settings.streaming_enabled : true,
                    systemPrompt: settings.system_prompt || null,
                    headerName: (settings.headers && settings.headers[0] && settings.headers[0].name) || '',
                    headerValue: (settings.headers && settings.headers[0] && settings.headers[0].value) || '',
                    // Claude specific settings
                    maxTurns: settings.max_turns || 10,
                    toolPermissions: settings.tool_permissions || this.state.toolPermissions
                };
            }
        } catch (error) {
            console.error('Failed to load AI settings:', error);
        }
    }
    
    async saveSettings() {
        if (this.state.saving) {
            return;
        }

        this.state.saving = true;
        this.render();

        try {
            const endpoint = this.state.provider === 'botckyGateway'
                ? this.normalizeBotckyEndpoint(this.state.endpoint)
                : this.state.endpoint;
            const apiKey = this.state.provider === 'botckyGateway'
                ? normalizeGatewayApiKey(this.state.apiKey, endpoint)
                : this.state.apiKey || null;
            if (this.state.provider === 'botckyGateway') {
                this.state.endpoint = endpoint;
                this.state.apiKey = apiKey || '';
            }
            const settings = {
                provider: this.state.provider,
                endpoint,
                api_key: apiKey,
                model: this.state.model,
                temperature: this.state.temperature,
                max_tokens: this.state.maxTokens,
                streaming_enabled: true,  // Add missing field
                system_prompt: this.state.systemPrompt || null,  // Save custom system prompt
                headers: (this.state.headerName || this.state.headerValue) ? [
                    { name: this.state.headerName || '', value: this.state.headerValue || '' }
                ] : [],
                // Claude specific settings
                max_turns: this.state.maxTurns,
                tool_permissions: this.state.toolPermissions
            };
            
            console.log('Saving AI settings...');
            await invoke('save_ai_settings', { settings });
            
            // Update the active provider
            this.activeProvider = this.state.provider;

            // Call callback if provided
            if (this.callbacks.onSave) {
                await this.callbacks.onSave(settings);
            }

            this.showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings: ' + error, 'error');
        } finally {
            this.state.saving = false;
            this.render();
        }
    }
    
    async deleteAllBotckySessions() {
        if (this.state.provider !== 'botckyGateway' || this.state.deletingBotckySessions) {
            return;
        }

        const confirmed = typeof window.confirm === 'function'
            ? window.confirm('Delete all Vault Botcky sessions? This cannot be undone.')
            : true;
        if (!confirmed) {
            return;
        }

        this.state.deletingBotckySessions = true;
        this.render();

        try {
            const endpoint = this.normalizeBotckyEndpoint(this.state.endpoint);
            const apiKey = normalizeGatewayApiKey(this.state.apiKey, endpoint);
            const client = new BotckyGatewayNativeClient({ endpoint, apiKey, WebSocketCtor: null });
            const result = await client.deleteAllSessions({ platform: 'vault', status: null });
            this.showNotification(`Deleted ${result.deleted} Botcky session${result.deleted === 1 ? '' : 's'}`, 'success');
        } catch (error) {
            console.error('Failed to delete Botcky sessions:', error);
            this.showNotification('Failed to delete Botcky sessions: ' + error, 'error');
        } finally {
            this.state.deletingBotckySessions = false;
            this.render();
        }
    }

    async testConnection() {
        this.state.testing = true;
        this.state.testStatus = null;
        this.render();
        
        try {
            if (this.state.provider === 'botckyGateway') {
                this.state.testStatus = this.getBotckyNativeTestStatus();
                return;
            }

            const settings = {
                endpoint: this.state.endpoint,
                api_key: this.state.apiKey || null,
                model: this.state.model,
                temperature: this.state.temperature,
                max_tokens: this.state.maxTokens,
                headers: (this.state.headerName || this.state.headerValue) ? [
                    { name: this.state.headerName || '', value: this.state.headerValue || '' }
                ] : []
            };
            
            console.log('Testing AI connection...');
            const result = await invoke('test_ai_connection', { settings });
            console.log('Connection test result:', result);
            
            this.state.testStatus = result;
        } catch (error) {
            console.error('Connection test failed:', error);
            this.state.testStatus = {
                overall_status: {
                    success: false,
                    message: 'Test failed: ' + error
                }
            };
        } finally {
            this.state.testing = false;
            this.render();
        }
    }

    getBotckyNativeTestStatus() {
        const endpoint = this.normalizeBotckyEndpoint(this.state.endpoint);
        return {
            overall_status: {
                success: Boolean(endpoint),
                message: endpoint
                    ? 'Botcky native chat is configured. Save settings to switch the chat panel to Botcky.'
                    : 'Botcky Gateway endpoint is required.'
            },
            endpoint_status: {
                success: Boolean(endpoint),
                message: endpoint
                    ? `Native chat will connect to ${endpoint}/gateway/ws/chat.`
                    : 'Enter the Botcky Gateway base URL.'
            }
        };
    }

    
    async quickSetup(provider) {
        console.log('Quick setup for:', provider);
        
        // Update current provider
        this.state.provider = provider;
        
        try {
            // Load saved settings for this provider
            const settings = await invoke('get_ai_settings_for_provider', { provider });
            console.log(`Loaded settings for ${provider}:`, { ...settings, api_key: '***' });
            
            // Update state with loaded settings
            const selectedProvider = settings.provider || provider;
            const endpoint = selectedProvider === 'botckyGateway'
                ? this.normalizeBotckyEndpoint(settings.endpoint)
                : settings.endpoint;
            this.state = {
                ...this.state,
                provider: selectedProvider,
                endpoint,
                apiKey: selectedProvider === 'botckyGateway'
                    ? normalizeGatewayApiKey(settings.api_key, endpoint) || ''
                    : settings.api_key || '',
                model: settings.model,
                temperature: settings.temperature,
                maxTokens: settings.max_tokens,
                streamingEnabled: settings.streaming_enabled !== undefined ? settings.streaming_enabled : true,
                systemPrompt: settings.system_prompt || null,
                headerName: (settings.headers && settings.headers[0] && settings.headers[0].name) || '',
                headerValue: (settings.headers && settings.headers[0] && settings.headers[0].value) || '',
                // Claude specific settings
                maxTurns: settings.max_turns || 10,
                toolPermissions: settings.tool_permissions || this.state.toolPermissions
            };
        } catch (error) {
            console.error(`Failed to load settings for ${provider}:`, error);
            // If loading fails, use defaults
            this.setDefaultsForProvider(provider);
        }
        
        this.render();
    }
    
    setDefaultsForProvider(provider) {
        switch (provider) {
            case 'openai':
                this.state.endpoint = 'https://api.openai.com/v1';
                this.state.model = 'gpt-4';
                this.state.apiKey = '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 4096;
                break;
            case 'gemini':
                this.state.endpoint = 'https://generativelanguage.googleapis.com/v1beta/';
                this.state.model = 'gemini-2.0-flash';
                this.state.apiKey = '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 8192;
                break;
            case 'ollama':
                this.state.endpoint = 'http://localhost:11434/v1';
                this.state.model = 'llama3.2';
                this.state.apiKey = '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 4096;
                break;
            case 'lmstudio':
                this.state.endpoint = 'http://localhost:1234/v1';
                this.state.model = 'local-model';
                this.state.apiKey = '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 4096;
                break;
            case 'bedrock':
                this.state.endpoint = '';
                this.state.model = 'anthropic.claude-sonnet-4-20250514-v1:0';
                this.state.apiKey = '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 4096;
                break;
            case 'claudeAgent':
                this.state.endpoint = 'https://api.anthropic.com';
                this.state.model = 'claude-sonnet-4-5-20250929';
                this.state.apiKey = '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 8192;
                // Claude specific defaults
                this.state.maxTurns = 10;
                break;
            case 'botckyGateway':
                this.state.endpoint = BOTCKY_GATEWAY_DEFAULT_ENDPOINT;
                this.state.model = 'botcky-agent';
                this.state.apiKey = normalizeGatewayApiKey('', this.state.endpoint) || '';
                this.state.temperature = 0.7;
                this.state.maxTokens = 8000;
                break;
        }
    }
    
    updateEndpoint(value) {
        this.state.endpoint = value;
    }
    
    updateApiKey(value) {
        this.state.apiKey = value;
    }
    
    updateModel(value) {
        this.state.model = value;
    }
    
    updateTemperature(value) {
        this.state.temperature = parseFloat(value);
    }
    
    updateMaxTokens(value) {
        this.state.maxTokens = parseInt(value);
    }
    
    updateSystemPrompt(value) {
        this.state.systemPrompt = value;
    }

    updateHeaderName(value) {
        this.state.headerName = value;
    }

    updateHeaderValue(value) {
        this.state.headerValue = value;
    }

    // Claude Agent specific update methods
    updateMaxTurns(value) {
        this.state.maxTurns = parseInt(value);
    }

    toggleToolPermission(toolName) {
        this.state.toolPermissions[toolName] = !this.state.toolPermissions[toolName];
        this.render();
    }

    setAllToolPermissions(enabled) {
        Object.keys(this.state.toolPermissions).forEach(tool => {
            this.state.toolPermissions[tool] = enabled;
        });
        this.render();
    }

    getToolLabel(toolName) {
        const labels = {
            search_notes: 'Search Notes',
            get_note: 'Read Note',
            get_current_note: 'Read Current Note',
            list_tags: 'List Tags',
            notes_by_tag: 'Notes by Tag',
            semantic_search: 'Semantic Search (Premium)',
            write_note: 'Write Note',
            update_note: 'Update Note',
            append_to_note: 'Append to Note'
        };
        return labels[toolName] || toolName;
    }

    toggleApiKeyVisibility() {
        this.state.showApiKey = !this.state.showApiKey;
        this.render();
    }
    
    toggleAdvanced() {
        this.state.showAdvanced = !this.state.showAdvanced;
        this.render();
    }

    attachEventListeners() {
        if (!this.container || this.listenersAttached) {
            return;
        }

        this.container.addEventListener('click', this.boundClickHandler);
        this.container.addEventListener('change', this.boundChangeHandler);
        this.container.addEventListener('input', this.boundInputHandler);
        this.listenersAttached = true;
    }

    detachEventListeners() {
        if (!this.container || !this.listenersAttached) {
            this.listenersAttached = false;
            return;
        }

        this.container.removeEventListener('click', this.boundClickHandler);
        this.container.removeEventListener('change', this.boundChangeHandler);
        this.container.removeEventListener('input', this.boundInputHandler);
        this.listenersAttached = false;
    }

    async handleContainerClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target || !this.container.contains(target)) {
            return;
        }

        switch (target.dataset.action) {
            case 'quick-setup':
                await this.quickSetup(target.dataset.provider);
                break;
            case 'toggle-api-key-visibility':
                this.toggleApiKeyVisibility();
                break;
            case 'toggle-advanced':
                this.toggleAdvanced();
                break;
            case 'set-all-tool-permissions':
                this.setAllToolPermissions(target.dataset.enabled === 'true');
                break;
            case 'test-connection':
                await this.testConnection();
                break;
            case 'save-settings':
                await this.saveSettings();
                break;
            case 'delete-botcky-sessions':
                await this.deleteAllBotckySessions();
                break;
        }
    }

    handleContainerChange(event) {
        const target = event.target;

        if (!target.matches('[data-action]')) {
            return;
        }

        switch (target.dataset.action) {
            case 'update-endpoint':
                this.updateEndpoint(target.value);
                break;
            case 'update-api-key':
                this.updateApiKey(target.value);
                break;
            case 'update-header-name':
                this.updateHeaderName(target.value);
                break;
            case 'update-header-value':
                this.updateHeaderValue(target.value);
                break;
            case 'update-model':
                this.updateModel(target.value);
                break;
            case 'update-max-tokens':
                this.updateMaxTokens(target.value);
                break;
            case 'update-system-prompt':
                this.updateSystemPrompt(target.value);
                break;
            case 'toggle-tool-permission':
                this.toggleToolPermission(target.dataset.tool);
                break;
        }
    }

    handleContainerInput(event) {
        const target = event.target;

        if (!target.matches('[data-action]')) {
            return;
        }

        switch (target.dataset.action) {
            case 'update-endpoint':
                this.updateEndpoint(target.value);
                break;
            case 'update-api-key':
                this.updateApiKey(target.value);
                break;
            case 'update-header-name':
                this.updateHeaderName(target.value);
                break;
            case 'update-header-value':
                this.updateHeaderValue(target.value);
                break;
            case 'update-model':
                this.updateModel(target.value);
                break;
            case 'update-max-tokens':
                this.updateMaxTokens(target.value);
                break;
            case 'update-system-prompt':
                this.updateSystemPrompt(target.value);
                break;
            case 'update-max-turns':
                this.updateMaxTurns(target.value);
                this.updateRangeLabel(target, 'Max Turns');
                break;
            case 'update-temperature':
                this.updateTemperature(target.value);
                this.updateRangeLabel(target, 'Temperature');
                break;
        }
    }

    updateRangeLabel(input, labelText) {
        const label = input.closest('.form-group')?.querySelector('label');
        if (label) {
            label.textContent = `${labelText}: ${input.value}`;
        }
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
    
    getModelExamples(endpoint) {
        if (endpoint.includes('openai.com')) {
            return 'Examples: gpt-4, gpt-3.5-turbo, gpt-4-turbo-preview';
        } else if (endpoint.includes('generativelanguage.googleapis.com')) {
            return 'Examples: gemini-2.0-flash, gemini-2.5-flash, gemini-1.5-pro';
        } else if (endpoint.includes('/bedrock/')) {
            return 'Examples: anthropic.claude-3-7-sonnet-20250219-v1:0, anthropic.claude-3-5-sonnet-20241022-v2:0';
        } else if (endpoint.includes('11434')) {
            return 'Examples: llama2, mistral, codellama';
        } else if (endpoint.includes('1234')) {
            return 'Examples: Use model name from LM Studio';
        } else if (endpoint.includes('anthropic.com')) {
            return 'Examples: claude-sonnet-4-5-20250929, claude-opus-4-5-20251101, claude-haiku-3-5-20241022';
        } else if (this.state.provider === 'botckyGateway' || endpoint.includes('7110')) {
            return 'Botcky Gateway-native chat. Leave as botcky-agent unless your Botcky admin says otherwise.';
        }
        return 'Enter the model name for your AI provider';
    }

    normalizeBotckyEndpoint(endpoint) {
        const normalized = (endpoint || '').trim();
        if (!normalized) {
            return BOTCKY_GATEWAY_DEFAULT_ENDPOINT;
        }

        try {
            const parsed = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`);
            const localHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase());
            const gatewayRootPath = ['', '/', '/gateway'].includes(parsed.pathname || '');
            if (localHost && gatewayRootPath && BOTCKY_LEGACY_LOCAL_PORTS.has(parsed.port)) {
                parsed.hostname = '127.0.0.1';
                parsed.port = '7110';
                parsed.pathname = '';
                parsed.search = '';
                parsed.hash = '';
                return parsed.toString().replace(/\/$/, '');
            }
            if (gatewayRootPath && parsed.pathname === '/gateway') {
                parsed.pathname = '';
                parsed.search = '';
                parsed.hash = '';
                return parsed.toString().replace(/\/$/, '');
            }
        } catch {
            return normalized;
        }

        return normalized;
    }

    getEndpointLabel() {
        return this.state.provider === 'botckyGateway' ? 'Botcky Gateway Endpoint:' : 'API Endpoint:';
    }

    getEndpointPlaceholder() {
        return this.state.provider === 'botckyGateway'
            ? BOTCKY_GATEWAY_DEFAULT_ENDPOINT
            : 'https://api.openai.com/v1';
    }

    getEndpointHelp() {
        return this.state.provider === 'botckyGateway'
            ? 'Base URL for Botcky Gateway. Native chat uses /gateway/ws/chat.'
            : 'The base URL for your AI provider\'s API';
    }

    getApiKeyLabel() {
        return this.state.provider === 'botckyGateway' ? 'Gateway Frontend Key:' : 'API Key:';
    }

    getApiKeyPlaceholder() {
        return this.state.provider === 'botckyGateway' ? 'gateway frontend key' : 'sk-...';
    }

    getApiKeyHelp() {
        return this.state.provider === 'botckyGateway'
            ? 'Sent as the Botcky Gateway frontend/API key for session and websocket auth. Local devstack defaults to dev-gateway-key.'
            : 'Leave empty for local AI servers';
    }

    getSystemPromptHelp() {
        return this.state.provider === 'botckyGateway'
            ? 'Native Botcky prompt context is assembled by Botcky Gateway from Vault context; this field is stored but not sent by the native Botcky UI.'
            : 'This prompt will be used for all AI conversations. Dynamic content like tag context will be appended automatically.';
    }

    renderBotckySessionControls() {
        if (this.state.provider !== 'botckyGateway') return '';
        const endpoint = this.normalizeBotckyEndpoint(this.state.endpoint);
        return `
                    <div class="botcky-settings-note">
                        <strong>Vault Botcky sessions</strong>
                        <p>Session dropdown entries are loaded from <code>${endpoint}/gateway/chat/sessions?platform=vault&amp;status=active</code>. They are Vault-created Botcky Gateway threads, not dashboard sessions or Vault AI Chat exports.</p>
                        <button
                            type="button"
                            data-action="delete-botcky-sessions"
                            class="danger-btn"
                            ${this.state.deletingBotckySessions ? 'disabled' : ''}
                        >
                            ${this.state.deletingBotckySessions ? 'Deleting sessions...' : 'Delete All Vault Botcky Sessions'}
                        </button>
                    </div>
        `;
    }
    
    render() {
        if (!this.container) return;
        
        // Make this instance available globally for event handlers
        window.aiSettingsPanel = this;
        
        this.container.innerHTML = `
            <div class="ai-settings-panel ${this.state.provider === 'botckyGateway' ? 'botcky-provider-settings' : ''}">
                <h2>AI Chat Settings</h2>
                
                <div class="quick-setup">
                    <p>Quick Setup:</p>
                    <div class="quick-setup-buttons">
                        <button type="button" data-action="quick-setup" data-provider="openai"
                                class="quick-setup-btn ${this.state.provider === 'openai' ? 'selected' : ''} ${this.activeProvider === 'openai' ? 'active' : ''}">
                            <span class="provider-icon">${icons.bot({ size: 16 })}</span>
                            OpenAI
                            ${this.activeProvider === 'openai' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                        <button type="button" data-action="quick-setup" data-provider="gemini"
                                class="quick-setup-btn ${this.state.provider === 'gemini' ? 'selected' : ''} ${this.activeProvider === 'gemini' ? 'active' : ''}">
                            <span class="provider-icon">${icons.gem({ size: 16 })}</span>
                            Gemini
                            ${this.activeProvider === 'gemini' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                        <button type="button" data-action="quick-setup" data-provider="ollama"
                                class="quick-setup-btn ${this.state.provider === 'ollama' ? 'selected' : ''} ${this.activeProvider === 'ollama' ? 'active' : ''}">
                            <span class="provider-icon">${icons.cat({ size: 16 })}</span>
                            Ollama
                            ${this.activeProvider === 'ollama' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                        <button type="button" data-action="quick-setup" data-provider="lmstudio"
                                class="quick-setup-btn ${this.state.provider === 'lmstudio' ? 'selected' : ''} ${this.activeProvider === 'lmstudio' ? 'active' : ''}">
                            <span class="provider-icon">${icons.monitor({ size: 16 })}</span>
                            LM Studio
                            ${this.activeProvider === 'lmstudio' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                        <button type="button" data-action="quick-setup" data-provider="bedrock"
                                class="quick-setup-btn ${this.state.provider === 'bedrock' ? 'selected' : ''} ${this.activeProvider === 'bedrock' ? 'active' : ''}">
                            <span class="provider-icon">${icons.cloud({ size: 16 })}</span>
                            Bedrock (Claude)
                            ${this.activeProvider === 'bedrock' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                        <button type="button" data-action="quick-setup" data-provider="claudeAgent"
                                class="quick-setup-btn ${this.state.provider === 'claudeAgent' ? 'selected' : ''} ${this.activeProvider === 'claudeAgent' ? 'active' : ''}">
                            <span class="provider-icon">${icons.sparkles({ size: 16 })}</span>
                            Claude
                            ${this.activeProvider === 'claudeAgent' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                        <button type="button" data-action="quick-setup" data-provider="botckyGateway"
                                class="quick-setup-btn ${this.state.provider === 'botckyGateway' ? 'selected' : ''} ${this.activeProvider === 'botckyGateway' ? 'active' : ''}">
                            <span class="provider-icon">${icons.rocket({ size: 16 })}</span>
                            Botcky
                            ${this.activeProvider === 'botckyGateway' ? `<span class="active-badge">${icons.check({ size: 12 })}</span>` : ''}
                        </button>
                    </div>
                    <p class="quick-setup-info">
                        ${this.state.provider !== this.activeProvider ?
                            `<span class="warning">${icons.alertTriangle({ size: 14 })} You're editing ${this.state.provider} settings. Click Save to make it active.</span>` :
                            `<span class="info">Currently using ${this.activeProvider}</span>`}
                    </p>
                </div>
                
                <div class="settings-form">
                    <div class="form-group">
                        <label>${this.getEndpointLabel()}</label>
                        <input 
                            type="url" 
                            value="${this.state.endpoint}"
                            data-action="update-endpoint"
                            placeholder="${this.getEndpointPlaceholder()}"
                            class="form-input"
                        />
                        <small>${this.getEndpointHelp()}</small>
                    </div>
                    
                    <div class="form-group">
                        <label>${this.getApiKeyLabel()}</label>
                        <div class="api-key-input">
                            <input 
                                type="${this.state.showApiKey ? 'text' : 'password'}" 
                                value="${this.state.apiKey}"
                                data-action="update-api-key"
                                placeholder="${this.getApiKeyPlaceholder()}"
                                class="form-input"
                            />
                            <button type="button" data-action="toggle-api-key-visibility" class="toggle-visibility-btn">
                                ${this.state.showApiKey ? icons.lockKeyhole({ size: 14 }) : icons.eye({ size: 14 })}
                            </button>
                        </div>
                        <small>${this.getApiKeyHelp()}</small>
                    </div>
                    
                    ${this.renderBotckySessionControls()}
                    
                    <div class="form-group provider-legacy-field">
                        <label>Custom Header:</label>
                        <div style="display:flex; gap:8px;">
                            <input 
                                type="text" 
                                value="${this.state.headerName}"
                                data-action="update-header-name"
                                placeholder="Header name"
                                class="form-input"
                                style="flex:1;"
                            />
                            <input 
                                type="text" 
                                value="${this.state.headerValue}"
                                data-action="update-header-value"
                                placeholder="Header value"
                                class="form-input"
                                style="flex:1;"
                            />
                        </div>
                    <small>Optional. Leave blanks to disable. Useful for proxies.</small>
                </div>

                    <div class="form-group provider-legacy-field">
                        <label>Model Name:</label>
                        <input 
                            type="text" 
                            value="${this.state.model}"
                            data-action="update-model"
                            placeholder="gpt-4"
                            class="form-input"
                        />
                        <small>${this.getModelExamples(this.state.endpoint)}</small>
                    </div>

                    ${this.state.provider === 'claudeAgent' ? `
                    <div class="claude-agent-settings" style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--border-color);">
                        <h4 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                            ${icons.sparkles({ size: 14 })} Claude Settings
                        </h4>

                        <div class="form-group" style="margin-bottom: 12px;">
                            <label>Max Turns: ${this.state.maxTurns}</label>
                            <input
                                type="range"
                                min="1"
                                max="20"
                                step="1"
                                value="${this.state.maxTurns}"
                                data-action="update-max-turns"
                                class="form-slider"
                            />
                            <small>Maximum number of agent turns (tool uses) per conversation</small>
                        </div>

                        <div class="form-group" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <label style="font-weight: 600;">Tool Permissions</label>
                                <div style="display: flex; gap: 8px;">
                                    <button type="button" data-action="set-all-tool-permissions" data-enabled="true" class="small-btn" style="font-size: 11px; padding: 4px 8px;">Select All</button>
                                    <button type="button" data-action="set-all-tool-permissions" data-enabled="false" class="small-btn" style="font-size: 11px; padding: 4px 8px;">Clear All</button>
                                </div>
                            </div>
                            <div class="tool-permissions-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                                ${Object.entries(this.state.toolPermissions).map(([tool, enabled]) => `
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px;">
                                        <input
                                            type="checkbox"
                                            data-action="toggle-tool-permission"
                                            data-tool="${tool}"
                                            ${enabled ? 'checked' : ''}
                                            style="width: 14px; height: 14px;"
                                        />
                                        ${this.getToolLabel(tool)}
                                    </label>
                                `).join('')}
                            </div>
                            <small style="margin-top: 8px; display: block;">Only enabled tools will be available to Claude</small>
                        </div>
                    </div>
                    ` : ''}

                    <div class="form-group provider-legacy-field">
                        <label>System Prompt:</label>
                        <textarea 
                            value="${this.state.systemPrompt || 'You are a helpful AI assistant integrated into a note-taking app called Vault. You help users with their notes, writing, research, and questions. Always provide helpful, accurate, and relevant responses.'}"
                            data-action="update-system-prompt"
                            placeholder="Enter custom system prompt..."
                            class="form-input"
                            rows="6"
                        >${this.state.systemPrompt || 'You are a helpful AI assistant integrated into a note-taking app called Vault. You help users with their notes, writing, research, and questions. Always provide helpful, accurate, and relevant responses.'}</textarea>
                        <small>${this.getSystemPromptHelp()}</small>
                    </div>
                    
                    <div class="advanced-section provider-legacy-field">
                        <button type="button" data-action="toggle-advanced" class="advanced-toggle">
                            ${this.state.showAdvanced ? '▼' : '▶'} Advanced Settings
                        </button>
                        
                        ${this.state.showAdvanced ? `
                            <div class="advanced-settings">
                                <div class="form-group">
                                    <label>Temperature: ${this.state.temperature}</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value="${this.state.temperature}"
                                        data-action="update-temperature"
                                        class="form-slider"
                                    />
                                    <small>Controls randomness: 0 = focused, 2 = creative</small>
                                </div>
                                
                                <div class="form-group">
                                    <label>Max Tokens:</label>
                                    <input 
                                        type="number" 
                                        min="100" 
                                        max="8000" 
                                        value="${this.state.maxTokens}"
                                        data-action="update-max-tokens"
                                        class="form-input"
                                    />
                                    <small>Maximum response length in tokens</small>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="form-actions">
                        <button 
                            type="button"
                            data-action="test-connection"
                            class="test-btn ${this.state.testing ? 'testing' : ''}"
                            ${(this.state.testing || this.state.saving) ? 'disabled' : ''}
                        >
                            ${this.state.testing ? 'Testing...' : 'Test Connection'}
                        </button>
                        <button
                            type="button"
                            data-action="save-settings"
                            class="save-btn ${this.state.saving ? 'testing' : ''}"
                            ${this.state.saving ? 'disabled' : ''}
                        >
                            ${this.state.saving ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                    
                    ${this.state.testStatus ? this.renderTestStatus() : ''}
                    
                </div>
            </div>
        `;
    }
    
    renderTestStatus() {
        const status = this.state.testStatus;
        const overall = status.overall_status || status.overallStatus;

        if (!overall) return '';

        const successIcon = icons.checkCircle({ size: 14 });
        const errorIcon = icons.alertCircle({ size: 14 });

        return `
            <div class="test-status ${overall.success ? 'success' : 'error'}">
                <div class="test-result">
                    <span class="status-icon">${overall.success ? successIcon : errorIcon}</span>
                    <span class="status-message">${overall.message}</span>
                </div>

                ${status.endpoint_status ? `
                    <div class="test-detail">
                        <span class="detail-icon">${status.endpoint_status.success ? successIcon : errorIcon}</span>
                        Endpoint: ${status.endpoint_status.message}
                    </div>
                ` : ''}

                ${status.auth_status ? `
                    <div class="test-detail">
                        <span class="detail-icon">${status.auth_status.success ? successIcon : errorIcon}</span>
                        Authentication: ${status.auth_status.message}
                    </div>
                ` : ''}

                ${status.model_status ? `
                    <div class="test-detail">
                        <span class="detail-icon">${status.model_status.success ? successIcon : errorIcon}</span>
                        Model: ${status.model_status.message}
                    </div>
                ` : ''}
            </div>
        `;
    }
}
