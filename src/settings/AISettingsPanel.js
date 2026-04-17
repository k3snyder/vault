import { invoke } from '@tauri-apps/api/core';
import { icons } from '../icons/icon-utils.js';

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
        this.boundMouseOverHandler = this.handleContainerMouseOver.bind(this);
        this.boundMouseOutHandler = this.handleContainerMouseOut.bind(this);
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
                const endpoint = settings.provider === 'botckyGateway'
                    ? this.normalizeBotckyEndpoint(settings.endpoint)
                    : settings.endpoint;
                // Convert snake_case to camelCase for frontend use
                this.state = {
                    ...this.state,
                    provider: settings.provider || this.state.provider,
                    endpoint,
                    apiKey: settings.api_key || '',
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
            const settings = {
                provider: this.state.provider,
                endpoint,
                api_key: this.state.apiKey || null,
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
    
    async testConnection() {
        this.state.testing = true;
        this.state.testStatus = null;
        this.render();
        
        try {
            if (this.state.provider === 'botckyGateway') {
                this.state.testStatus = await this.testBotckyConnection();
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

    async testBotckyConnection() {
        const endpoint = this.normalizeBotckyEndpoint(this.state.endpoint);
        if (!endpoint) {
            throw new Error('Botcky connector endpoint is required');
        }

        if (endpoint !== this.state.endpoint) {
            this.state.endpoint = endpoint;
        }

        const wsUrl = new URL(
            endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
                ? endpoint
                : endpoint.startsWith('https://')
                    ? `wss://${endpoint.slice('https://'.length)}`
                    : endpoint.startsWith('http://')
                        ? `ws://${endpoint.slice('http://'.length)}`
                        : `ws://${endpoint}`
        );
        wsUrl.pathname = `${(wsUrl.pathname || '').replace(/\/+$/, '')}/ws/vault`.replace('//ws/vault', '/ws/vault');

        const timezone = (() => {
            try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            } catch {
                return 'UTC';
            }
        })();
        const handshakeId = `botcky_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        return new Promise((resolve, reject) => {
            let settled = false;
            let socket = null;

            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                try {
                    socket?.close(1000, 'test-complete');
                } catch {
                    // ignore close failures
                }
                fn(value);
            };

            const timeoutId = setTimeout(() => {
                finish(reject, new Error('Timed out waiting for Botcky connector handshake'));
            }, 10000);

            try {
                socket = new WebSocket(wsUrl.toString());
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
                return;
            }

            socket.onopen = () => {
                socket.send(JSON.stringify({
                    type: 'client.hello',
                    request_id: handshakeId,
                    client_secret: this.state.apiKey || undefined,
                    workspace_id: 'vault-desktop',
                    vault_id: 'vault-test',
                    user_id: 'test-user',
                    thread_id: handshakeId,
                    room_id: handshakeId,
                    user_email: 'test@vault.local',
                    timezone,
                    default_priority: 'p2',
                    is_main_session: true
                }));
            };

            socket.onmessage = event => {
                let message = null;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (!message || typeof message !== 'object') {
                    return;
                }

                if (message.type === 'client.ready' || message.type === 'session.resumed') {
                    finish(resolve, {
                        endpoint_status: {
                            stage: 'endpoint',
                            success: true,
                            message: 'Connector websocket reachable'
                        },
                        auth_status: {
                            stage: 'auth',
                            success: true,
                            message: 'client.hello accepted'
                        },
                        model_status: {
                            stage: 'model',
                            success: true,
                            message: 'Connector-managed in Botcky'
                        },
                        overall_status: {
                            stage: 'overall',
                            success: true,
                            message: 'Botcky Vault connector reachable'
                        }
                    });
                    return;
                }

                if (message.type === 'error') {
                    const detail = message.detail || message.message || message.error || 'Connector returned an error';
                    finish(reject, new Error(detail));
                }
            };

            socket.onerror = () => {
                finish(reject, new Error('Botcky connector websocket failed to open'));
            };

            socket.onclose = event => {
                if (settled) return;
                const detail = event?.reason || `Botcky connector websocket closed (${event?.code ?? 'unknown'})`;
                finish(reject, new Error(detail));
            };
        });
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
            const endpoint = provider === 'botckyGateway'
                ? this.normalizeBotckyEndpoint(settings.endpoint)
                : settings.endpoint;
            this.state = {
                ...this.state,
                provider: settings.provider || provider,
                endpoint,
                apiKey: settings.api_key || '',
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
                this.state.endpoint = 'http://localhost:3005';
                this.state.model = 'botcky-agent';
                this.state.apiKey = '';
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
        this.container.addEventListener('mouseover', this.boundMouseOverHandler);
        this.container.addEventListener('mouseout', this.boundMouseOutHandler);
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
        this.container.removeEventListener('mouseover', this.boundMouseOverHandler);
        this.container.removeEventListener('mouseout', this.boundMouseOutHandler);
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
            case 'mcp-settings':
                console.log('MCP button clicked');
                console.log('window.mcpSettings:', window.mcpSettings);
                window.mcpSettings?.show();
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

    handleContainerMouseOver(event) {
        const button = event.target.closest('.mcp-settings-btn');
        if (!button || !this.container.contains(button)) {
            return;
        }

        if (event.relatedTarget && button.contains(event.relatedTarget)) {
            return;
        }

        button.style.background = 'var(--bg-tertiary)';
    }

    handleContainerMouseOut(event) {
        const button = event.target.closest('.mcp-settings-btn');
        if (!button || !this.container.contains(button)) {
            return;
        }

        if (event.relatedTarget && button.contains(event.relatedTarget)) {
            return;
        }

        button.style.background = 'var(--bg-secondary)';
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
        } else if (this.state.provider === 'botckyGateway' || endpoint.includes('3005') || endpoint.includes('vault-connector')) {
            return 'Connector-managed in Botcky. Leave as botcky-agent unless your Botcky admin says otherwise.';
        }
        return 'Enter the model name for your AI provider';
    }

    normalizeBotckyEndpoint(endpoint) {
        const normalized = (endpoint || '').trim();
        if (!normalized) {
            return 'http://localhost:3005';
        }

        try {
            const parsed = new URL(normalized);
            if (parsed.port === '3002' && ['', '/', '/gateway'].includes(parsed.pathname || '')) {
                parsed.port = '3005';
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
        return this.state.provider === 'botckyGateway' ? 'Connector Endpoint:' : 'API Endpoint:';
    }

    getEndpointPlaceholder() {
        return this.state.provider === 'botckyGateway'
            ? 'http://localhost:3005'
            : 'https://api.openai.com/v1';
    }

    getEndpointHelp() {
        return this.state.provider === 'botckyGateway'
            ? 'Base URL for the Botcky Vault connector service'
            : 'The base URL for your AI provider\'s API';
    }

    getApiKeyLabel() {
        return this.state.provider === 'botckyGateway' ? 'Client Secret:' : 'API Key:';
    }

    getApiKeyPlaceholder() {
        return this.state.provider === 'botckyGateway' ? 'connector secret' : 'sk-...';
    }

    getApiKeyHelp() {
        return this.state.provider === 'botckyGateway'
            ? 'Matches VAULT_CLIENT_SHARED_SECRET on the Botcky Vault connector. Leave empty only if the connector allows unauthenticated clients.'
            : 'Leave empty for local AI servers';
    }

    getSystemPromptHelp() {
        return this.state.provider === 'botckyGateway'
            ? 'Botcky connector-specific prompt additions come from .botcky.json system_prompt_append; this generic field is not sent to the connector.'
            : 'This prompt will be used for all AI conversations. Dynamic content like MCP tools and tag context will be appended automatically.';
    }
    
    render() {
        if (!this.container) return;
        
        // Make this instance available globally for event handlers
        window.aiSettingsPanel = this;
        
        this.container.innerHTML = `
            <div class="ai-settings-panel">
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
                    
                    <div class="form-group">
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

                    <div class="form-group">
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

                    <div class="form-group">
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
                    
                    <div class="advanced-section">
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
                    
                    <div class="mcp-section" style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border-color);">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">MCP Integration</h3>
                                <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">
                                    Configure Model Context Protocol servers for enhanced AI capabilities
                                </p>
                            </div>
                            <button type="button" data-action="mcp-settings" class="mcp-settings-btn" style="
                                background: var(--bg-secondary);
                                border: 1px solid var(--border-color);
                                padding: 8px 16px;
                                border-radius: 6px;
                                cursor: pointer;
                                font-size: 13px;
                                display: flex;
                                align-items: center;
                                gap: 6px;
                                transition: all 0.2s;
                            ">
                                ${icons.settings({ size: 14 })} MCP Settings
                            </button>
                        </div>
                    </div>
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
