// EnhancedChatPanel.js - Enhanced chat panel with multi-provider AI support
console.log('💬 Enhanced ChatPanel loading...');

import { ChatInterface } from './ChatInterface.js';
import { ClaudeAuth } from './ClaudeAuth.js';
import { ContextManager } from './ContextManager.js';
import { ChatPersistence } from './ChatPersistence.js';
import { OpenAISDK } from './OpenAISDK.js';
import { GeminiSDK } from './GeminiSDK.js';
import { BedrockClaudeSDK } from './BedrockClaudeSDK.js';
import { AISettingsPanel } from '../settings/AISettingsPanel.js';
import { ModeToggle } from '../components/ModeToggle.js';
import { XTermContainer } from '../cli/XTermContainer.js';

import { tagContextExpander } from './TagContextExpander.js';
import { ClaudeAgentSDK } from './ClaudeAgentSDK.js';
import { AgentCostDisplay } from '../components/AgentCostDisplay.js';
import { BotckyChatHost, createBotckyContextPayload, currentFolderFromPath } from '../botcky/index.js';

// Import Tauri API
import { invoke } from '@tauri-apps/api/core';

const BOTCKY_PROVIDER_ID = 'botckyGateway';
const AI_CHAT_SESSIONS_STORAGE_KEY = 'gaimplan-ai-chat-sessions-v1';
const AI_CHAT_ICONS = {
    bot: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>',
    archive: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>',
};

export class EnhancedChatPanel {
    constructor() {
        console.log('🔧 Initializing Enhanced ChatPanel');
        this.container = null;
        this.isAuthenticated = false;
        // Initialize visibility from saved state to prevent state mismatch
        this.isVisible = localStorage.getItem('gaimplan-chat-visible') === 'true';
        this.width = 350;
        this.minWidth = 280;
        this.maxWidth = 600;
        
        // AI Provider Management
        this.currentProvider = 'openai'; // Default provider
        this.providers = {
            openai: {
                name: 'OpenAI/Custom',
                sdk: null,
                configured: false,
                status: 'unknown'
            },
            gemini: {
                name: 'Google Gemini',
                sdk: null,
                configured: false,
                status: 'unknown'
            },
            bedrock: {
                name: 'Amazon Bedrock (Claude)',
                sdk: null,
                configured: false,
                status: 'unknown'
            },
            claudeAgent: {
                name: 'Claude',
                sdk: null,
                configured: false,
                status: 'unknown'
            },
            botckyGateway: {
                name: 'Botcky Agent',
                sdk: null,
                configured: false,
                status: 'unknown'
            }
        };
        
        // Components
        this.auth = null;
        this.interface = null;
        this.contextManager = null;
        this.persistence = null;
        this.settingsPanel = null;
        this.showingSettings = false;
        this.costDisplay = null; // AgentCostDisplay for Claude Agent
        
        // Resize state
        this.isResizing = false;
        
        // Mode management
        this.currentMode = localStorage.getItem('gaimplan-chat-mode') || 'chat';
        this.modeToggle = null;
        this.cliContainer = null;
        this.botckyHost = null;
        this.isBuildingCLI = false;
        this.startX = 0;
        this.startWidth = 0;
        
        // Vault listener
        this.vaultOpenedListener = null;
        this.botckyBackgroundUnsubscribe = null;

        // Context sizing
        this.contextCharLimit = 8000; // default until settings load

        // Local AI chat threads. Backed by WebView localStorage, which lives in
        // WebKit's localstorage.sqlite3 on macOS.
        this.chatSessions = [];
        this.activeChatSessionId = null;
        this.suppressChatSessionSave = false;
    }

    updateContextCharLimit(settings) {
        const DEFAULT_LIMIT = 8000;
        const MAX_LIMIT = 500000; // guardrail to avoid excessive payloads
        const CHARS_PER_TOKEN_ESTIMATE = 4;

        if (!settings) {
            this.contextCharLimit = DEFAULT_LIMIT;
            return;
        }

        const maxTokensRaw = settings.max_tokens ?? settings.maxTokens;
        const maxTokens = Number(maxTokensRaw);

        if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
            this.contextCharLimit = DEFAULT_LIMIT;
            return;
        }

        const computed = Math.floor(maxTokens * CHARS_PER_TOKEN_ESTIMATE);
        const clamped = Math.min(Math.max(computed, DEFAULT_LIMIT), MAX_LIMIT);

        this.contextCharLimit = clamped;
        console.log(`🧠 Context character limit set to ${this.contextCharLimit} (tokens: ${maxTokens})`);
    }

    getContextCharLimit() {
        if (!this.contextCharLimit) {
            const provider = this.providers?.[this.currentProvider];
            const providerSettings = provider?.sdk?.getSettings?.();
            this.updateContextCharLimit(providerSettings);
        }

        return this.contextCharLimit || 8000;
    }

    isProviderConfigured(providerKey = this.currentProvider) {
        const provider = this.providers?.[providerKey];
        if (!provider) {
            return false;
        }

        if (this.isBotckyProviderKey(providerKey)) {
            const configured = Boolean(provider.configured || provider.status === 'ready');
            provider.configured = configured;
            provider.status = configured ? 'ready' : 'not-configured';
            return configured;
        }

        let configured;

        if (typeof provider.sdk?.isReady === 'function') {
            configured = provider.sdk.isReady() || Boolean(provider.configured);
        } else if (typeof provider.sdk?.isInitialized === 'boolean') {
            configured = provider.sdk.isInitialized || Boolean(provider.configured);
        } else {
            configured = Boolean(provider.configured);
        }

        provider.configured = configured;

        if (configured) {
            provider.status = 'ready';
        } else if (provider.status === 'unknown') {
            provider.status = 'not-configured';
        }

        return configured;
    }

    hasProviderConfiguration(providerKey = this.currentProvider) {
        const provider = this.providers?.[providerKey];
        if (!provider) {
            return false;
        }

        if (this.isBotckyProviderKey(providerKey)) {
            const configured = Boolean(provider.configured || provider.status === 'ready');
            provider.configured = configured;
            provider.status = configured ? 'ready' : 'not-configured';
            return configured;
        }

        return this.isProviderConfigured(providerKey);
    }

    isBotckyProviderKey(providerKey) {
        return providerKey === BOTCKY_PROVIDER_ID;
    }

    syncBotckyVaultPath(vaultPath) {
        const normalizedVaultPath = typeof vaultPath === 'string' && vaultPath.trim()
            ? vaultPath.trim()
            : null;
        const sdk = this.providers?.botckyGateway?.sdk;

        if (!sdk || !normalizedVaultPath) {
            return;
        }

        sdk.vaultPath = normalizedVaultPath;

        if (sdk.baseConfig && typeof sdk.baseConfig === 'object') {
            sdk.baseConfig = {
                ...sdk.baseConfig,
                vault_path: normalizedVaultPath,
            };
        }

        if (sdk.botckyConfig && typeof sdk.botckyConfig === 'object') {
            sdk.botckyConfig = {
                ...sdk.botckyConfig,
                vault_path: normalizedVaultPath,
            };
        }

        if (sdk.settings && typeof sdk.settings === 'object') {
            sdk.settings = {
                ...sdk.settings,
                vault_path: normalizedVaultPath,
            };
        }
    }

    shouldReconnectBotckyForVaultChange() {
        const sdk = this.providers?.botckyGateway?.sdk;
        return Boolean(sdk?.isInitialized && typeof sdk.reloadVaultConfig === 'function');
    }
    
    async mount(parentElement) {
        console.log('📌 Mounting Enhanced ChatPanel');
        
        // Create main container (fills the right sidebar)
        this.container = document.createElement('div');
        this.container.className = `chat-panel enhanced right-sidebar-panel ${this.currentMode === 'cli' ? 'cli-mode' : ''}`;
        this.container.style.height = '100%';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        
        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'chat-content-wrapper';
        
        // Initialize components
        this.auth = new ClaudeAuth();
        this.interface = new ChatInterface();
        this.contextManager = new ContextManager();
        window.chatContextManager = this.contextManager;
        this.persistence = new ChatPersistence();
        this.settingsPanel = new AISettingsPanel();
        
        // Initialize SDKs
        this.providers.openai.sdk = new OpenAISDK();
        this.providers.gemini.sdk = new GeminiSDK();
        this.providers.bedrock.sdk = new BedrockClaudeSDK();
        this.providers.claudeAgent.sdk = new ClaudeAgentSDK();
        // Native Botcky chat is rendered by BotckyChatHost instead of the old
        // provider SDK path, so it intentionally has no SDK instance here.
        this.providers.botckyGateway.sdk = null;
        this.providers.botckyGateway.status = 'not-configured';

        // Set up authentication callback
        this.auth.onAuthStateChanged = (authenticated) => {
            console.log('🔐 Auth state changed:', authenticated);
            this.isAuthenticated = authenticated;
            this.updateUI();
        };
        
        // Set up message send callback
        this.interface.onSendMessage = async (message) => {
            console.log('📤 Sending message via', this.currentProvider);
            await this.handleSendMessage(message);
        };
        this.initializeChatSessions();
        this.interface.onMessagesChanged = (messages) => {
            this.persistActiveChatMessages(messages);
            this.refreshAiChatToolbarState();
        };
        
        // Set up context change callback
        this.contextManager.onContextChanged = (context) => {
            console.log('📎 Context changed:', context);
            this.interface.updateContext(context);
        };

        // Load saved provider selection before first render so the shell reflects
        // the persisted choice immediately. Provider initialization happens in the
        // background and should not block the sidebar from mounting.
        await this.loadSavedProvider();
        
        // Build initial UI
        this.buildUI(contentWrapper);
        
        // Assemble container (no resize handle for right sidebar)
        this.container.appendChild(contentWrapper);
        parentElement.appendChild(this.container);

        void this.initializeProviders()
            .then(() => this.updateUI())
            .catch(error => {
                console.warn('Background provider initialization failed:', error);
                this.updateUI();
            });
        
        // Check authentication status
        this.auth.checkAuthStatus();
        
        // Set up vault change listener
        this.setupVaultListener();
        
        // Load chat history
        setTimeout(() => {
            this.loadChatHistory();
        }, 100);
        
        console.log('✅ Enhanced ChatPanel mounted successfully');
    }

    handleBotckyBackgroundEvent(event) {
        if (!event || !this.interface) {
            return;
        }

        if (event.type === 'assistant_message' && typeof event.text === 'string' && event.text.trim()) {
            this.interface.addMessage({
                type: 'assistant',
                content: event.text,
                timestamp: new Date()
            });
            return;
        }

        if (event.type === 'task_update' && event.status === 'failed') {
            const errorText =
                event?.result?.error ||
                event?.result?.message ||
                `Task ${event.taskId || ''} failed.`.trim();
            this.interface.addMessage({
                type: 'error',
                content: errorText,
                timestamp: new Date()
            });
        }
    }
    
    async initializeProviders() {
        console.log('🚀 Initializing AI providers...');

        try {
            // Get settings first for all providers
            const settings = await invoke('get_ai_settings');

            // Initialize both SDKs
            const openaiInit = await this.providers.openai.sdk.initialize();
            this.providers.openai.configured = openaiInit;
            this.providers.openai.status = openaiInit ? 'ready' : 'not-configured';

            const geminiInit = await this.providers.gemini.sdk.initialize();
            this.providers.gemini.configured = geminiInit;
            this.providers.gemini.status = geminiInit ? 'ready' : 'not-configured';

            const bedrockInit = await this.providers.bedrock.sdk.initialize();
            this.providers.bedrock.configured = bedrockInit;
            this.providers.bedrock.status = bedrockInit ? 'ready' : 'not-configured';

            // Initialize Claude Agent SDK - get its own settings if claudeAgent is selected
            let claudeAgentApiKey = settings?.api_key;
            let claudeAgentModel = settings?.model || 'claude-sonnet-4-5-20250929';

            // If current provider is claudeAgent, the settings already have the right key
            // Otherwise, try to load Claude Agent specific settings
            if (settings?.provider !== 'claudeAgent') {
                try {
                    const claudeSettings = await invoke('get_ai_settings_for_provider', { provider: 'claudeAgent' });
                    if (claudeSettings?.api_key) {
                        claudeAgentApiKey = claudeSettings.api_key;
                        claudeAgentModel = claudeSettings.model || claudeAgentModel;
                    }
                } catch (e) {
                    console.log('No Claude Agent settings found, using current settings');
                }
            }

            const claudeAgentInit = await this.providers.claudeAgent.sdk.initialize({
                apiKey: claudeAgentApiKey,
                model: claudeAgentModel
            });
            this.providers.claudeAgent.configured = claudeAgentInit;
            this.providers.claudeAgent.status = claudeAgentInit ? 'ready' : 'not-configured';

            // Native Botcky uses BotckyChatHost and BotckyGatewayNativeClient, not
            // the old provider-SDK path. Load saved settings only
            // to decide whether the settings button should show it as ready.
            let botckySettings = this.isBotckyProviderKey(settings?.provider) ? settings : null;
            if (!botckySettings) {
                try {
                    botckySettings = await invoke('get_ai_settings_for_provider', { provider: BOTCKY_PROVIDER_ID });
                } catch (e) {
                    console.log('No Botcky Gateway settings found, using native defaults');
                }
            }
            const botckyEndpoint = typeof botckySettings?.endpoint === 'string' ? botckySettings.endpoint.trim() : '';
            this.providers.botckyGateway.sdk = null;
            this.providers.botckyGateway.configured = Boolean(botckyEndpoint);
            this.providers.botckyGateway.status = botckyEndpoint ? 'ready' : 'not-configured';

            // Determine which provider to use. Explicit provider selection wins;
            // endpoint heuristics remain only for older saved settings.
            this.updateContextCharLimit(settings);
            if (this.isBotckyProviderKey(settings?.provider)) {
                this.currentProvider = BOTCKY_PROVIDER_ID;
                this.currentMode = 'botcky';
                localStorage.setItem('gaimplan-chat-provider', BOTCKY_PROVIDER_ID);
                localStorage.setItem('gaimplan-chat-mode', 'botcky');
                console.log('🎯 Using native Botcky chat');
            } else if (settings?.provider === 'gemini') {
                this.currentProvider = 'gemini';
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
                if (settings?.endpoint?.includes('/openai/')) {
                    console.warn('⚠️ Gemini endpoint uses the legacy OpenAI-compatible path; AI Settings will normalize it on save.');
                }
                console.log('🎯 Using Gemini SDK');
            } else if (settings?.endpoint?.includes('generativelanguage.googleapis.com')) {
                // Check if the endpoint has the incorrect /openai/ path
                if (settings.endpoint.includes('/openai/')) {
                    console.warn('⚠️ Gemini endpoint incorrectly includes /openai/ path');
                    console.warn('Please update your Gemini endpoint in AI Settings to: https://generativelanguage.googleapis.com/v1beta/');
                    // For now, still use OpenAI SDK which will call the Rust backend
                    this.currentProvider = 'openai';
                } else {
                    this.currentProvider = 'gemini';
                    console.log('🎯 Detected Gemini API endpoint, using Gemini SDK');
                }
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
            } else if (settings?.endpoint?.includes('/bedrock/')) {
                this.currentProvider = 'bedrock';
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
                console.log('🎯 Detected Bedrock endpoint, using Bedrock Claude SDK');
            } else if (settings?.endpoint?.includes('amazonaws.com/bedrock')) {
                this.currentProvider = 'bedrock';
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
                console.log('🎯 Detected Bedrock host, using Bedrock Claude SDK');
            } else if (settings?.provider === 'claudeAgent' || settings?.endpoint?.includes('anthropic.com')) {
                this.currentProvider = 'claudeAgent';
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
                console.log('🎯 Using Claude Agent SDK');
            } else {
                this.currentProvider = 'openai';
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
                console.log('🎯 Using OpenAI SDK for endpoint:', settings?.endpoint);
            }
            
        } catch (error) {
            console.warn('Provider initialization failed:', error);
            this.providers.openai.configured = false;
            this.providers.openai.status = 'error';
            this.providers.gemini.configured = false;
            this.providers.gemini.status = 'error';
            this.providers.bedrock.configured = false;
            this.providers.bedrock.status = 'error';
            this.providers.claudeAgent.configured = false;
            this.providers.claudeAgent.status = 'error';
            this.providers.botckyGateway.configured = false;
            this.providers.botckyGateway.status = 'error';
            this.currentProvider = 'openai'; // Fallback to OpenAI
            if (this.currentMode === 'botcky') {
                this.currentMode = 'chat';
                localStorage.setItem('gaimplan-chat-mode', 'chat');
            }
        }

        console.log('Providers initialized:', {
            openai: this.providers.openai.status,
            gemini: this.providers.gemini.status,
            bedrock: this.providers.bedrock.status,
            claudeAgent: this.providers.claudeAgent.status,
            botckyGateway: this.providers.botckyGateway.status,
            current: this.currentProvider
        });
    }
    
    buildUI(wrapper) {
        if (this.botckyHost?.mounted) {
            this.botckyHost.unmount();
        }
        wrapper.innerHTML = '';
        
        if (this.showingSettings) {
            this.buildSettingsUI(wrapper);
        } else {
            console.log('💬 Showing enhanced chat interface');
            this.buildChatUI(wrapper);
        }
    }

    initializeChatSessions() {
        const legacyMessages = this.interface?.getMessages?.() || [];
        const persisted = this.readChatSessions();
        const activeSessions = persisted.sessions.filter(session => session.status !== 'archived');

        if (activeSessions.length > 0) {
            this.chatSessions = persisted.sessions;
            this.activeChatSessionId = activeSessions.some(session => session.id === persisted.activeSessionId)
                ? persisted.activeSessionId
                : activeSessions[0].id;
        } else {
            const session = this.createChatSession({
                title: 'Session 1',
                messages: legacyMessages,
                createdAt: this.firstMessageTimestamp(legacyMessages),
            });
            this.chatSessions = [session];
            this.activeChatSessionId = session.id;
        }

        this.persistChatSessions();
        this.loadActiveChatSessionIntoInterface();
    }

    readChatSessions() {
        try {
            const saved = localStorage.getItem(AI_CHAT_SESSIONS_STORAGE_KEY);
            if (!saved) {
                return { sessions: [], activeSessionId: null };
            }
            const parsed = JSON.parse(saved);
            const sessions = Array.isArray(parsed?.sessions)
                ? parsed.sessions.map(session => this.normalizeChatSession(session)).filter(Boolean)
                : [];
            return {
                sessions,
                activeSessionId: typeof parsed?.activeSessionId === 'string' ? parsed.activeSessionId : null,
            };
        } catch (error) {
            console.error('Failed to read AI chat sessions:', error);
            return { sessions: [], activeSessionId: null };
        }
    }

    normalizeChatSession(session) {
        if (!session || typeof session !== 'object') {
            return null;
        }
        const id = typeof session.id === 'string' && session.id.trim()
            ? session.id
            : `ai_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const messages = Array.isArray(session.messages)
            ? session.messages.map(message => this.sanitizeChatMessage(message)).filter(Boolean)
            : [];
        const createdAt = this.safeIsoTimestamp(session.createdAt) || this.firstMessageTimestamp(messages) || new Date().toISOString();
        const updatedAt = this.safeIsoTimestamp(session.updatedAt) || this.lastMessageTimestamp(messages) || createdAt;

        return {
            id,
            title: typeof session.title === 'string' && session.title.trim() ? session.title.trim() : 'Session',
            status: session.status === 'archived' ? 'archived' : 'active',
            createdAt,
            updatedAt,
            messages,
        };
    }

    sanitizeChatMessage(message) {
        if (!message || typeof message !== 'object') {
            return null;
        }
        const type = typeof message.type === 'string' ? message.type : '';
        if (!['user', 'assistant', 'error', 'task_created'].includes(type)) {
            return null;
        }
        return {
            id: message.id !== undefined && message.id !== null ? String(message.id) : undefined,
            type,
            content: message.content === undefined || message.content === null ? '' : String(message.content),
            timestamp: message.timestamp || new Date().toISOString(),
            name: typeof message.name === 'string' ? message.name : undefined,
            path: typeof message.path === 'string' ? message.path : undefined,
            title: typeof message.title === 'string' ? message.title : undefined,
            meta: message.meta && typeof message.meta === 'object' ? message.meta : undefined,
        };
    }

    createChatSession({ title, messages = [], createdAt = null, status = 'active' } = {}) {
        const now = new Date().toISOString();
        const normalizedMessages = messages.map(message => this.sanitizeChatMessage(message)).filter(Boolean);
        const sessionCreatedAt = this.safeIsoTimestamp(createdAt) || this.firstMessageTimestamp(normalizedMessages) || now;
        return {
            id: `ai_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            title: title || this.nextChatSessionTitle(),
            status,
            createdAt: sessionCreatedAt,
            updatedAt: this.lastMessageTimestamp(normalizedMessages) || sessionCreatedAt,
            messages: normalizedMessages,
        };
    }

    safeIsoTimestamp(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    firstMessageTimestamp(messages = []) {
        return messages
            .map(message => this.safeIsoTimestamp(message.timestamp))
            .filter(Boolean)
            .sort()[0] || null;
    }

    lastMessageTimestamp(messages = []) {
        return messages
            .map(message => this.safeIsoTimestamp(message.timestamp))
            .filter(Boolean)
            .sort()
            .at(-1) || null;
    }

    getActiveChatSessions() {
        return this.chatSessions
            .filter(session => session.status !== 'archived')
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    getActiveChatSession() {
        return this.chatSessions.find(session => session.id === this.activeChatSessionId) || null;
    }

    persistChatSessions() {
        const payload = {
            version: 1,
            activeSessionId: this.activeChatSessionId,
            sessions: this.chatSessions,
        };
        localStorage.setItem(AI_CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(payload));
    }

    persistActiveChatMessages(messages = []) {
        if (this.suppressChatSessionSave) {
            return;
        }
        const session = this.getActiveChatSession();
        if (!session) {
            return;
        }
        const normalizedMessages = messages.map(message => this.sanitizeChatMessage(message)).filter(Boolean);
        session.messages = normalizedMessages;
        session.updatedAt = this.lastMessageTimestamp(normalizedMessages) || new Date().toISOString();
        this.persistChatSessions();
    }

    loadActiveChatSessionIntoInterface() {
        const session = this.getActiveChatSession();
        if (!session || !this.interface?.loadMessages) {
            return;
        }
        this.suppressChatSessionSave = true;
        try {
            this.interface.loadMessages(session.messages || [], { persist: true });
        } finally {
            this.suppressChatSessionSave = false;
        }
    }

    saveActiveChatSession() {
        if (!this.interface?.getMessages) {
            return;
        }
        this.persistActiveChatMessages(this.interface.getMessages());
    }

    getLiveActiveChatMessages() {
        const liveMessages = typeof this.interface?.getMessages === 'function'
            ? this.interface.getMessages()
            : null;
        if (Array.isArray(liveMessages)) {
            return liveMessages.map(message => this.sanitizeChatMessage(message)).filter(Boolean);
        }
        return (this.getActiveChatSession()?.messages || [])
            .map(message => this.sanitizeChatMessage(message))
            .filter(Boolean);
    }

    nextChatSessionTitle() {
        const numbers = this.chatSessions
            .map(session => String(session.title || '').match(/^Session\s+(\d+)$/i)?.[1])
            .filter(Boolean)
            .map(Number);
        return `Session ${numbers.length ? Math.max(...numbers) + 1 : this.chatSessions.length + 1}`;
    }

    createAiChatSession() {
        this.saveActiveChatSession();
        const session = this.createChatSession({ title: this.nextChatSessionTitle(), messages: [] });
        this.chatSessions.push(session);
        this.activeChatSessionId = session.id;
        this.persistChatSessions();
        this.loadActiveChatSessionIntoInterface();
        this.updateUI();
    }

    selectAiChatSession(sessionId) {
        if (!sessionId || sessionId === this.activeChatSessionId) {
            return;
        }
        this.saveActiveChatSession();
        if (!this.chatSessions.some(session => session.id === sessionId && session.status !== 'archived')) {
            return;
        }
        this.activeChatSessionId = sessionId;
        this.persistChatSessions();
        this.loadActiveChatSessionIntoInterface();
    }

    async archiveAiChatSession() {
        const session = this.getActiveChatSession();
        if (!session) {
            return;
        }
        const liveMessages = this.getLiveActiveChatMessages();
        session.messages = liveMessages;
        session.updatedAt = this.lastMessageTimestamp(liveMessages) || new Date().toISOString();
        this.persistChatSessions();

        if (session.messages.length > 0) {
            await this.exportChatSession(session);
        }
        session.status = 'archived';
        session.updatedAt = new Date().toISOString();

        const replacement = this.createChatSession({ title: this.nextChatSessionTitle(), messages: [] });
        this.chatSessions.push(replacement);
        this.activeChatSessionId = replacement.id;
        this.persistChatSessions();
        this.loadActiveChatSessionIntoInterface();
        this.updateUI();
        this.showNotification(session.messages.length > 0 ? 'Chat archived to Chat History' : 'Empty chat archived');
    }

    deleteAiChatSession() {
        const session = this.getActiveChatSession();
        if (!session) {
            return;
        }
        if (!window.confirm('Delete this AI chat session? This cannot be undone.')) {
            return;
        }
        this.chatSessions = this.chatSessions.filter(candidate => candidate.id !== session.id);
        let nextSession = this.getActiveChatSessions()[0];
        if (!nextSession) {
            nextSession = this.createChatSession({ title: 'Session 1', messages: [] });
            this.chatSessions.push(nextSession);
        }
        this.activeChatSessionId = nextSession.id;
        this.persistChatSessions();
        this.loadActiveChatSessionIntoInterface();
        this.updateUI();
        this.showNotification('Chat session deleted');
    }

    createAiChatToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'chat-toolbar ai-chat-session-toolbar';

        const title = document.createElement('div');
        title.className = 'ai-chat-toolbar-title';
        title.innerHTML = AI_CHAT_ICONS.bot;
        const titleText = document.createElement('strong');
        titleText.textContent = 'Chat';
        const statusDot = document.createElement('span');
        statusDot.className = 'ai-chat-status-dot';
        statusDot.title = 'Local chat sessions';
        title.appendChild(titleText);
        title.appendChild(statusDot);

        const select = document.createElement('select');
        select.className = 'ai-chat-session-select';
        select.value = this.activeChatSessionId || '';
        select.setAttribute('aria-label', 'AI chat session');
        select.addEventListener('change', event => this.selectAiChatSession(event.target.value));

        const sessions = this.getActiveChatSessions();
        sessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.id;
            option.textContent = session.title || 'Session';
            select.appendChild(option);
        });

        const newButton = this.createAiToolbarIconButton('plus', 'New session', () => this.createAiChatSession());
        const archiveButton = this.createAiToolbarIconButton('archive', 'Archive session', () => {
            this.archiveAiChatSession().catch(error => {
                console.error('Failed to archive AI chat session:', error);
                this.showNotification('Failed to archive chat', 'error');
            });
        });
        const deleteButton = this.createAiToolbarIconButton('trash', 'Delete session', () => this.deleteAiChatSession(), true);

        toolbar.appendChild(title);
        toolbar.appendChild(select);
        toolbar.appendChild(newButton);
        toolbar.appendChild(archiveButton);
        toolbar.appendChild(deleteButton);
        return toolbar;
    }

    refreshAiChatToolbarState() {
        const toolbar = this.container?.querySelector?.('.ai-chat-session-toolbar');
        if (!toolbar || this.currentMode !== 'chat') {
            return;
        }

        const select = toolbar.querySelector('.ai-chat-session-select');
        if (select) {
            const activeSessions = this.getActiveChatSessions();
            const existingValue = select.value;
            select.innerHTML = '';
            activeSessions.forEach(session => {
                const option = document.createElement('option');
                option.value = session.id;
                option.textContent = session.title || 'Session';
                select.appendChild(option);
            });
            select.value = this.activeChatSessionId || existingValue || '';
        }
    }

    createAiToolbarIconButton(iconName, label, onClick, danger = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `chat-toolbar-btn icon-only ai-chat-toolbar-icon-btn${danger ? ' danger' : ''}`;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = AI_CHAT_ICONS[iconName] || '';
        button.addEventListener('click', onClick);
        return button;
    }
    
    buildChatUI(wrapper) {
        // Add header
        const header = this.createEnhancedHeader();
        wrapper.appendChild(header);
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.className = 'chat-content-container';
        contentContainer.id = 'chat-content-container';
        
        if (this.currentMode === 'chat') {
            // Check if current provider is configured
            const provider = this.providers[this.currentProvider];
            const providerHasConfiguration = this.hasProviderConfiguration(this.currentProvider);

            if (!providerHasConfiguration) {
                // Show configuration prompt
                const configPrompt = this.createConfigPrompt();
                contentContainer.appendChild(configPrompt);
            } else {
                contentContainer.appendChild(this.createAiChatToolbar());

                // Add chat interface
                const chatContainer = document.createElement('div');
                chatContainer.className = 'chat-interface-container';
                this.interface.mount(chatContainer);
                contentContainer.appendChild(chatContainer);

                // Add context manager
                const contextContainer = document.createElement('div');
                contextContainer.className = 'chat-context-container';
                this.contextManager.mount(contextContainer);
                contentContainer.appendChild(contextContainer);
            }
        } else if (this.currentMode === 'botcky') {
            this.buildBotckyUI(contentContainer).catch(error => {
                console.error('Failed to build native Botcky UI:', error);
                contentContainer.textContent = `Failed to open Botcky: ${error?.message || error}`;
            });
        } else {
            // CLI mode
            this.buildCLIUI(contentContainer).catch(error => {
                console.error('Failed to build CLI UI:', error);
            });
        }
        
        wrapper.appendChild(contentContainer);
    }

    async buildBotckyUI(container) {
        container.classList.add('botcky-content-container');

        if (this.cliContainer) {
            await this.cliContainer.stop();
        }

        if (this.botckyHost?.mounted) {
            this.botckyHost.unmount();
        }

        const hostContainer = document.createElement('div');
        hostContainer.className = 'botcky-host-container';
        container.appendChild(hostContainer);

        this.botckyHost = new BotckyChatHost({
            contextProvider: ({ sessionId, threadId, includeNoteContent } = {}) => this.buildBotckyVaultContext({
                sessionId,
                threadId,
                includeNoteContent,
            }),
            contextUiProvider: () => this.buildBotckyContextUiState(),
            onAddContext: () => this.openBotckyContextDialog(),
            onRemoveContext: path => this.interface?.removeFromContext?.(path),
            onRemoveActiveNoteContext: note => this.interface?.excludeActiveNoteFromContext?.(note),
            onIncludeActiveNoteContext: note => this.interface?.includeActiveNoteContext?.(note),
            onSettings: () => this.showSettings()
        });

        await this.botckyHost.mount(hostContainer);
    }

    openBotckyContextDialog() {
        if (this.contextManager) {
            window.chatContextManager = this.contextManager;
        }
        this.interface?.showContextDialog?.();
    }

    buildBotckyContextUiState() {
        const activeNote = this.getActiveNoteContextMetadata();
        const activePath = activeNote?.path || '';
        const selectedNotes = (this.interface?.currentContext || [])
            .filter(note => note && note.type !== 'active' && note.path !== activePath);

        return {
            activeNote,
            activeNoteIncluded: activeNote
                ? this.interface?.shouldIncludeActiveNoteContext?.(activeNote) !== false
                : false,
            selectedNotes,
        };
    }

    getActiveNoteContextMetadata() {
        try {
            const activeTabManager = window.paneManager?.getActiveTabManager?.();
            const activeTab = activeTabManager?.getActiveTab?.();
            if (activeTab?.title) {
                return {
                    title: activeTab.title,
                    name: activeTab.title,
                    path: activeTab.filePath,
                    type: 'active',
                };
            }
        } catch (error) {
            console.warn('Failed to read active note metadata for Botcky context UI:', error);
        }

        if (window.currentFile) {
            const name = window.currentFile.split('/').pop();
            return {
                title: name?.replace(/\.md$/i, '') || name,
                name,
                path: window.currentFile,
                type: 'active',
            };
        }

        return null;
    }

    async buildBotckyVaultContext({ sessionId, threadId, includeNoteContent = true } = {}) {
        const vaultInfo = await this.getBotckyVaultInfo();
        const activeNote = includeNoteContent
            ? await this.getActiveNoteContent()
            : this.getActiveNoteContextMetadata();
        const activeNoteForContext = activeNote && this.interface?.shouldIncludeActiveNoteContext?.(activeNote) !== false
            ? activeNote
            : null;
        const allContext = includeNoteContent
            ? await this.getAllContext({ activeNote })
            : this.getSelectedContextMetadata(activeNote);
        const activePath = activeNote?.path || '';
        const currentFolder = this.resolveBotckyCurrentFolder(activePath, vaultInfo);

        return createBotckyContextPayload({
            activeNote: activeNoteForContext,
            selectedNotes: (this.interface?.currentContext || []).filter(note => note?.type !== 'active' && note?.path !== activePath),
            contextNotes: allContext.filter(note => note?.path !== activePath),
            vaultInfo,
            sessionId: sessionId || `vault-${Date.now()}`,
            threadId: threadId || sessionId || `thread-${Date.now()}`,
            currentFolder,
        });
    }

    getSelectedContextMetadata(activeNote = null) {
        const activePath = activeNote?.path || '';
        return (this.interface?.currentContext || [])
            .filter(note => note && note.type !== 'active' && note.path !== activePath)
            .map(note => ({
                title: note.title || note.name,
                name: note.name || note.title,
                path: note.path,
                type: note.type,
                content: '',
            }));
    }

    async getBotckyVaultInfo() {
        if (window.windowContext?.getVaultInfo) {
            try {
                const vaultInfo = await window.windowContext.getVaultInfo();
                if (vaultInfo?.path) {
                    return vaultInfo;
                }
            } catch (error) {
                console.warn('Failed to read Botcky vault info from window context:', error);
            }
        }

        if (window.currentVaultPath) {
            return {
                path: window.currentVaultPath,
                id: window.currentVaultPath,
                name: window.currentVaultPath.split('/').filter(Boolean).pop() || 'Vault',
            };
        }

        try {
            return await invoke('get_vault_info');
        } catch (error) {
            console.warn('Failed to read Botcky vault info from backend:', error);
            return {};
        }
    }

    resolveBotckyCurrentFolder(activePath, vaultInfo = {}) {
        const folder = currentFolderFromPath(activePath);
        if (!folder) {
            return '.';
        }

        const vaultPath = vaultInfo?.path?.replace(/\\/g, '/');
        const normalizedFolder = folder.replace(/\\/g, '/');
        if (vaultPath && normalizedFolder.startsWith(`${vaultPath}/`)) {
            return normalizedFolder.slice(vaultPath.length + 1) || '.';
        }
        return normalizedFolder || '.';
    }
    
    async buildCLIUI(container) {
        // Prevent multiple builds
        if (this.isBuildingCLI) {
            console.log('CLI Mode: Already building CLI, skipping...');
            return;
        }
        
        if (!this.cliContainer) {
            this.isBuildingCLI = true;
            
            // Get current vault path from window context first
            let vaultPath = '';
            
            // Try window context first
            if (window.windowContext) {
                console.log('CLI Mode: windowContext exists, getting vault info...');
                try {
                    const vaultInfo = await window.windowContext.getVaultInfo();
                    console.log('CLI Mode: vaultInfo from windowContext:', vaultInfo);
                    if (vaultInfo && vaultInfo.path) {
                        vaultPath = vaultInfo.path;
                        console.log('CLI Mode: Got vault path from windowContext:', vaultPath);
                    }
                } catch (error) {
                    console.error('Failed to get vault info from windowContext:', error);
                }
            } else if (window.currentVaultPath) {
                vaultPath = window.currentVaultPath;
                console.log('CLI Mode: Got vault path from window.currentVaultPath:', vaultPath);
            }
            
            // If no vault path from context, try to get from backend
            if (!vaultPath) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const vaultInfo = await invoke('get_vault_info');
                    if (vaultInfo && vaultInfo.path) {
                        vaultPath = vaultInfo.path;
                    }
                } catch (error) {
                    console.error('Failed to get vault info:', error);
                }
            }
            
            const windowId = window.windowContext?.windowId || window.windowId || 'main';
            
            console.log('CLI Mode: Using vault path:', vaultPath);
            console.log('CLI Mode: vaultPath type:', typeof vaultPath);
            console.log('CLI Mode: vaultPath length:', vaultPath?.length);
            console.log('CLI Mode: windowContext available:', !!window.windowContext);
            console.log('CLI Mode: window.currentVaultPath available:', !!window.currentVaultPath);
            
            // Use XTermContainer for embedded terminal
            this.cliContainer = new XTermContainer({
                vaultPath: vaultPath,
                windowId: windowId,
                onReady: () => {
                    console.log('Terminal ready');
                    this.isBuildingCLI = false;
                },
                onError: (error) => {
                    console.error('Terminal error:', error);
                    this.isBuildingCLI = false;
                    // Fallback to chat mode on error
                    this.modeToggle.setMode('chat');
                    this.currentMode = 'chat';
                    this.updateUI();
                }
            });
            
            try {
                await this.cliContainer.mount(container);
            } catch (error) {
                console.error('Failed to mount CLI container:', error);
                this.isBuildingCLI = false;
                this.cliContainer = null;
            }
        } else {
            await this.cliContainer.mount(container);
        }
    }
    
    async handleModeToggle(mode) {
        console.log(`🔄 Toggling mode to: ${mode}`);
        
        // Save current mode
        this.currentMode = mode;
        localStorage.setItem('gaimplan-chat-mode', mode);
        
        // Clean up previous mode
        if (mode === 'cli' && this.interface) {
            // Save chat state before switching
            this.saveConversation();
        } else if (mode === 'chat' && this.cliContainer) {
            // Stop CLI process
            await this.cliContainer.stop();
        }
        
        // Update UI
        this.updateUI();
    }

    async switchToBotckyMode() {
        console.log('🤖 Switching to native Botcky mode');
        this.currentProvider = BOTCKY_PROVIDER_ID;
        this.providers.botckyGateway.sdk = null;
        this.providers.botckyGateway.configured = true;
        this.providers.botckyGateway.status = 'ready';
        this.currentMode = 'botcky';
        localStorage.setItem('gaimplan-chat-provider', BOTCKY_PROVIDER_ID);
        localStorage.setItem('gaimplan-chat-mode', 'botcky');
        if (this.cliContainer) {
            await this.cliContainer.stop();
        }
        this.updateUI();
    }
    
    buildSettingsUI(wrapper) {
        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'settings-container';
        
        // Add back button
        const backButton = document.createElement('button');
        backButton.className = 'back-button';
        backButton.innerHTML = '← Back to Chat';
        backButton.onclick = () => this.hideSettings();
        
        settingsContainer.appendChild(backButton);
        
        // Create scrollable content area
        const scrollableContent = document.createElement('div');
        scrollableContent.className = 'settings-scrollable-content';
        scrollableContent.style.flex = '1';
        scrollableContent.style.overflow = 'hidden';
        
        // Mount settings panel
        this.settingsPanel.mount(scrollableContent, {
            onSave: async (settings) => {
                console.log('Settings saved, refreshing providers...');
                this.updateContextCharLimit(settings);

                await this.refreshProviders({ skipUIUpdate: true });

                // The just-saved provider should remain the frontend source of truth
                // for the transition back into chat. Re-querying backend state here can
                // transiently pick up stale provider info and bounce the UI into the
                // generic config prompt.
                this.currentProvider = settings.provider || this.currentProvider;
                localStorage.setItem('gaimplan-chat-provider', this.currentProvider);
                const selectedProvider = this.providers[this.currentProvider];

                if (this.isBotckyProviderKey(this.currentProvider)) {
                    this.providers.botckyGateway.sdk = null;
                    this.providers.botckyGateway.configured = true;
                    this.providers.botckyGateway.status = 'ready';
                    this.currentMode = 'botcky';
                    localStorage.setItem('gaimplan-chat-mode', 'botcky');
                    if (this.cliContainer) {
                        await this.cliContainer.stop();
                    }
                    this.hideSettings();
                    return;
                }

                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }

                if (!this.isProviderConfigured(this.currentProvider)) {
                    throw new Error(`${selectedProvider?.name || this.currentProvider} is not ready yet. Check your settings and try again.`);
                }

                if (selectedProvider?.sdk?.getSettings) {
                    this.updateContextCharLimit(selectedProvider.sdk.getSettings());
                }

                this.hideSettings();
            }
        });
        
        settingsContainer.appendChild(scrollableContent);
        wrapper.appendChild(settingsContainer);
    }
    
    createEnhancedHeader() {
        const header = document.createElement('div');
        header.className = 'chat-header simple';
        
        // Left side - title and model selector
        const leftSection = document.createElement('div');
        leftSection.className = 'chat-header-left';
        
        const title = document.createElement('h3');
        title.className = 'chat-title';
        title.textContent = 'AI Chat';
        
        leftSection.appendChild(title);

        // Mode toggle - reuse existing instance to prevent listener accumulation
        if (!this.modeToggle) {
            this.modeToggle = new ModeToggle({
                initialMode: this.currentMode === 'cli' ? 'cli' : 'chat',
                onToggle: (mode) => this.handleModeToggle(mode)
            });
        } else {
            // Update mode in case it changed
            this.modeToggle.setMode(this.currentMode === 'cli' ? 'cli' : 'chat');
        }
        leftSection.appendChild(this.modeToggle.element);

        const actions = document.createElement('div');
        actions.className = 'chat-actions';
        actions.appendChild(this.createHeaderSettingsButton());

        header.appendChild(leftSection);
        header.appendChild(actions);
        
        return header;
    }

    createHeaderSettingsButton() {
        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'chat-toolbar-btn icon-only chat-header-settings-btn';
        settingsBtn.title = 'AI Settings';
        settingsBtn.setAttribute('aria-label', 'AI Settings');

        const settingsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        settingsSvg.setAttribute('width', '14');
        settingsSvg.setAttribute('height', '14');
        settingsSvg.setAttribute('viewBox', '0 0 24 24');
        settingsSvg.setAttribute('fill', 'currentColor');

        const settingsPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        settingsPath.setAttribute('d', 'M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z');
        settingsSvg.appendChild(settingsPath);
        settingsBtn.appendChild(settingsSvg);
        settingsBtn.addEventListener('click', () => this.showSettings());

        return settingsBtn;
    }
    
    createConfigPrompt() {
        const prompt = document.createElement('div');
        prompt.className = 'config-prompt simple';

        const content = document.createElement('div');
        content.className = 'config-content';

        const icon = document.createElement('div');
        icon.className = 'config-icon';
        icon.textContent = '🤖';

        const heading = document.createElement('h3');
        heading.textContent = 'Set up AI chat';

        const description = document.createElement('p');
        description.textContent = 'Connect your AI provider to start chatting';

        const configureButton = document.createElement('button');
        configureButton.type = 'button';
        configureButton.className = 'config-button';
        configureButton.textContent = 'Configure';
        configureButton.addEventListener('click', () => this.showSettings());

        content.appendChild(icon);
        content.appendChild(heading);
        content.appendChild(description);
        content.appendChild(configureButton);
        prompt.appendChild(content);
        
        return prompt;
    }
    
    buildProviderOptions() {
        // Only show OpenAI/Custom option, not Claude
        return `<option value="openai">OpenAI/Custom</option>`;
    }
    
    getProviderStatusIcon() {
        this.isProviderConfigured(this.currentProvider);
        const provider = this.providers[this.currentProvider];
        
        switch (provider.status) {
            case 'ready':
                return '🟢';
            case 'not-configured':
                return '⚫';
            case 'error':
                return '🔴';
            default:
                return '🟡';
        }
    }
    
    async switchProvider(providerKey) {
        console.log('🔄 Switching to provider:', providerKey);

        if (this.isBotckyProviderKey(providerKey)) {
            await this.switchToBotckyMode();
            return;
        }

        this.currentProvider = providerKey;

        if (this.currentMode === 'botcky') {
            this.currentMode = 'chat';
            localStorage.setItem('gaimplan-chat-mode', 'chat');
        }

        const provider = this.providers[providerKey];
        if (provider?.sdk?.getSettings) {
            this.updateContextCharLimit(provider.sdk.getSettings());
        }

        // Update UI
        this.updateUI();
        
        // Save preference
        localStorage.setItem('gaimplan-chat-provider', providerKey);
    }
    
    async refreshProviders(options = {}) {
        console.log('🔄 Refreshing providers...');
        await this.initializeProviders();
        if (!options.skipUIUpdate) {
            this.updateUI();
        }
    }
    
    showSettings() {
        console.log('⚙️ Showing settings');
        this.showingSettings = true;
        this.updateUI();
    }
    
    hideSettings() {
        console.log('⚙️ Hiding settings');
        this.showingSettings = false;
        this.updateUI();
    }
    
    async handleSendMessage(message) {
        try {
            const provider = this.providers[this.currentProvider];

            console.log('Current provider:', this.currentProvider, provider);

            if (this.isBotckyProviderKey(this.currentProvider)) {
                await this.switchToBotckyMode();
                return;
            }

            // Sync context size with latest provider settings (after potential edits)
            if (provider?.sdk?.getSettings) {
                this.updateContextCharLimit(provider.sdk.getSettings());
            }

            if (!this.hasProviderConfiguration(this.currentProvider)) {
                this.interface.addMessage({
                    type: 'error',
                    content: `${provider.name} is not configured. Please check your settings.`,
                    timestamp: new Date()
                });
                return;
            }
            
            if (!provider.sdk) {
                this.interface.addMessage({
                    type: 'error',
                    content: `${provider.name} SDK is not initialized. Please refresh the page.`,
                    timestamp: new Date()
                });
                return;
            }
            
            // Add user message to the interface
            this.interface.addMessage({
                type: 'user',
                content: message,
                timestamp: new Date()
            });
            
            // Show thinking indicator IMMEDIATELY after user message
            const settings = provider.sdk.getSettings();
            const isOllama = settings?.endpoint?.includes('ollama') || settings?.endpoint?.includes('11434');
            this.interface.showTyping(isOllama);
            
            // Small delay to ensure UI updates are visible
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Get context from ChatInterface (what's shown in the pills)
            const allContext = await this.getAllContext();
            console.log('All context from pills:', allContext);
            console.log('Context details:');
            allContext.forEach((ctx, i) => {
                console.log(`  Context ${i}: ${ctx.title} - ${ctx.content?.length || 0} chars`);
            });
            
            // 🏷️ TAG CONTEXT EXPANSION
            const tagEnhancement = await tagContextExpander.enhanceConversationWithTags(message, allContext);
            if (tagEnhancement) {
                console.log('🎯 Tag enhancement applied:', tagEnhancement.relatedTags.map(t => `#${t.tag}`).join(', '));
                
                // Add tag context message to show discovered tags
                if (tagEnhancement.relatedTags.length > 0) {
                    const tagsList = tagEnhancement.relatedTags.map(t => `#${t.tag}`).join(', ');
                    this.interface.addMessage({
                        type: 'context',
                        content: `🏷️ Related tags: ${tagsList}`,
                        timestamp: new Date()
                    });
                }
                
                // Add any additional context notes found via tags
                if (tagEnhancement.additionalContext.length > 0) {
                    const additionalFiles = tagEnhancement.additionalContext.map(note => note.file).join(', ');
                    this.interface.addMessage({
                        type: 'context',
                        content: `📎 Additional context via tags: ${additionalFiles}`,
                        timestamp: new Date()
                    });
                }
            }
            
            // Add context message to show which files were included
            if (allContext.length > 0) {
                const contextFileNames = allContext.map(ctx => ctx.title).join(', ');
                this.interface.addMessage({
                    type: 'context',
                    content: `Context: ${contextFileNames}`,
                    timestamp: new Date()
                });
            }
            
            
            let response = '';

            if (this.currentProvider === 'claudeAgent') {
                // Use agent-like SDK with streaming
                const isClaudeAgentProvider = true;
                const providerErrorPrefix = 'Claude';
                console.log(`🤖 Using ${provider.name} SDK`);

                // Create a streaming message
                const messageId = 'msg_' + Date.now();
                const streamingMessage = {
                    id: messageId,
                    type: 'assistant',
                    content: '',
                    timestamp: new Date()
                };
                let messageAdded = false;

                if (isClaudeAgentProvider) {
                    this.interface.addMessage(streamingMessage);
                    this.interface.hideTyping();
                    messageAdded = true;
                }

                try {
                    for await (const event of provider.sdk.chat(message, allContext)) {
                        switch (event.type) {
                            case 'start':
                                console.log(`🚀 ${provider.name} started, model:`, event.model);
                                if (isClaudeAgentProvider) {
                                    // Initialize or reset cost display for Claude only
                                    if (!this.costDisplay) {
                                        this.costDisplay = new AgentCostDisplay({
                                            model: event.model || this.providers.claudeAgent.sdk.currentModel
                                        });
                                        // Add to chat interface header or messages area
                                        this.interface.addElement(this.costDisplay.getElement());
                                    }
                                    this.costDisplay.setModel(event.model || this.providers.claudeAgent.sdk.currentModel);
                                    this.costDisplay.show();
                                    if (event.usage) {
                                        this.costDisplay.update(event.usage);
                                    }
                                }
                                break;

                            case 'chunk':
                                // Streaming text chunk
                                if (!messageAdded) {
                                    this.interface.addMessage(streamingMessage);
                                    this.interface.hideTyping();
                                    messageAdded = true;
                                }
                                streamingMessage.content += event.text;
                                this.interface.updateMessage(messageId, streamingMessage.content);
                                break;

                            case 'tool_start':
                                // Deprecated - now handled by tool_use
                                console.log('🔧 Tool started:', event.toolName);
                                break;

                            case 'tool_use':
                                // Create tool use card with running status
                                console.log('🔧 Tool use:', event.toolName, event.toolInput);
                                this.interface.addToolUse(event.id, event.toolName, event.toolInput);
                                break;

                            case 'tool_result':
                                // Update tool card with result
                                console.log('✅ Tool result:', event.toolName, event.id);
                                this.interface.updateToolResult(event.id, event.result);
                                break;

                            case 'task_created':
                                console.log('📋 Task created:', event.meta);
                                this.interface.addTaskCreated(event.meta);
                                this.interface.hideTyping();
                                break;

                            case 'assistant':
                                // Complete message - extract text content
                                if (event.content && Array.isArray(event.content)) {
                                    const textContent = event.content
                                        .filter(block => block.type === 'text')
                                        .map(block => block.text)
                                        .join('');
                                    if (textContent) {
                                        if (!messageAdded) {
                                            this.interface.addMessage(streamingMessage);
                                            this.interface.hideTyping();
                                            messageAdded = true;
                                        }
                                        streamingMessage.content = textContent;
                                        this.interface.updateMessage(messageId, streamingMessage.content);
                                    }
                                }
                                break;

                            case 'result':
                                // Final result with statistics
                                if (typeof event.text === 'string' && event.text.trim()) {
                                    if (!messageAdded) {
                                        this.interface.addMessage(streamingMessage);
                                        this.interface.hideTyping();
                                        messageAdded = true;
                                    }
                                }
                                if (typeof event.text === 'string' && messageAdded && event.text !== streamingMessage.content) {
                                    streamingMessage.content = event.text;
                                    this.interface.updateMessage(messageId, streamingMessage.content);
                                } else if (!messageAdded) {
                                    this.interface.hideTyping();
                                }
                                console.log('📊 Result:', {
                                    success: event.success,
                                    cost: event.cost,
                                    turns: event.turns
                                });
                                // Update cost display with final usage for Claude only
                                if (isClaudeAgentProvider && this.costDisplay && event.usage) {
                                    this.costDisplay.update(event.usage);
                                }
                                break;

                            case 'error':
                                console.error(`❌ ${provider.name} error:`, event.error);
                                if (messageAdded) {
                                    this.interface.finalizeStreamingMessage(messageId);
                                } else {
                                    this.interface.hideTyping();
                                }
                                this.interface.addMessage({
                                    type: 'error',
                                    content: event.error,
                                    timestamp: new Date()
                                });
                                return;

                            case 'aborted':
                                console.log('🛑 Request aborted');
                                if (messageAdded) {
                                    this.interface.finalizeStreamingMessage(messageId);
                                } else {
                                    this.interface.hideTyping();
                                }
                                return;
                        }
                    }

                    // Finalize the streaming message
                    if (messageAdded) {
                        this.interface.finalizeStreamingMessage(messageId);
                    } else {
                        this.interface.hideTyping();
                    }

                } catch (agentError) {
                    console.error(`${provider.name} error:`, agentError);
                    if (messageAdded) {
                        this.interface.finalizeStreamingMessage(messageId);
                    } else {
                        this.interface.hideTyping();
                    }
                    this.interface.addMessage({
                        type: 'error',
                        content: `${providerErrorPrefix} error: ${agentError.message}`,
                        timestamp: new Date()
                    });
                }
            } else if (this.currentProvider === 'claude') {
                // Use Claude SDK
                response = await provider.sdk.sendMessage(message, allContext);
                this.interface.hideTyping();
                this.interface.addMessage({
                    type: 'assistant',
                    content: response,
                    timestamp: new Date()
                });
            } else if (this.currentProvider === 'bedrock') {
                // Use Bedrock Claude SDK (non-streaming)
                response = await provider.sdk.sendMessage(message, allContext, tagEnhancement);
                this.interface.hideTyping();
                this.interface.addMessage({
                    type: 'assistant',
                    content: response,
                    timestamp: new Date()
                });
            } else if (this.currentProvider === 'gemini') {
                // Use Gemini SDK with streaming
                console.log('🤖 Using Gemini SDK');

                // Get conversation history
                const conversationHistory = this.interface.getMessages() || [];
                const formattedHistory = conversationHistory
                    .filter(msg => msg.type !== 'error' && msg.type !== 'context')
                    .map(msg => ({
                        role: msg.type === 'user' ? 'user' : 'assistant',
                        content: msg.content
                    }));

                // Format messages for Gemini
                const messages = await provider.sdk.formatMessages(message, allContext, tagEnhancement);

                // Add history
                const historyWithoutCurrent = formattedHistory.filter(
                    msg => !(msg.role === 'user' && msg.content === message)
                );

                const fullMessages = [
                    ...messages.filter(m => m.role === 'system'),
                    ...historyWithoutCurrent.slice(-10),
                    messages.find(m => m.role === 'user')
                ].filter(Boolean);

                // Create streaming message (add to UI when first chunk arrives)
                const messageId = 'msg_' + Date.now();
                const streamingMessage = {
                    id: messageId,
                    type: 'assistant',
                    content: '',
                    timestamp: new Date()
                };
                let messageAdded = false;

                try {
                    const stream = await provider.sdk.streamChat(fullMessages);

                    for await (const chunk of stream) {
                        if (chunk.type === 'text') {
                            // Add message to UI on first chunk (keeps "Thinking..." visible until then)
                            if (!messageAdded) {
                                this.interface.addMessage(streamingMessage);
                                messageAdded = true;
                            }
                            streamingMessage.content += chunk.content;
                            this.interface.updateMessage(messageId, streamingMessage.content);
                        } else if (chunk.type === 'function_call') {
                            console.log('Function call in stream:', chunk.functionCall);
                        }
                    }

                    console.log('✅ Gemini streaming complete - final content length:', streamingMessage.content.length);
                    this.interface.finalizeStreamingMessage(messageId);

                } catch (geminiError) {
                    console.error('Gemini streaming error:', geminiError);
                    // Hide typing indicator if message wasn't added yet
                    if (!messageAdded) {
                        this.interface.hideTyping();
                    } else {
                        this.interface.finalizeStreamingMessage(messageId);
                    }
                    this.interface.addMessage({
                        type: 'error',
                        content: `Gemini error: ${geminiError.message}`,
                        timestamp: new Date()
                    });
                }
            } else if (this.currentProvider === 'openai') {
                // Use OpenAI SDK
                // Get conversation history for context (excluding errors and context messages)
                const conversationHistory = this.interface.getMessages() || [];
                const formattedHistory = conversationHistory
                    .filter(msg => msg.type !== 'error' && msg.type !== 'context') // Exclude error and context messages
                    .map(msg => ({
                        role: msg.type === 'user' ? 'user' : 'assistant',
                        content: msg.content
                    }));
                
                // Format messages with history and tag context
                console.log('Formatting messages with context:', allContext.length, 'notes');
                const messages = await provider.sdk.formatMessages(message, allContext, tagEnhancement);
                console.log('Formatted messages:', messages.length, 'total');
                
                // Add conversation history before the current message (but after system messages)
                const systemMessages = messages.filter(m => m.role === 'system');
                const currentUserMessage = messages.find(m => m.role === 'user');
                
                // Only include history messages that aren't the current message
                const historyWithoutCurrent = formattedHistory.filter(
                    msg => !(msg.role === 'user' && msg.content === message)
                );
                
                const fullMessages = [
                    ...systemMessages,
                    ...historyWithoutCurrent.slice(-10), // Include last 10 messages for context
                    currentUserMessage
                ].filter(Boolean);
                
                // Debug: Check if context is in messages
                const hasContextMessage = fullMessages.some(msg => 
                    msg.role === 'system' && msg.content.includes('CURRENT CONTEXT')
                );
                console.log('Has context in fullMessages?', hasContextMessage);
                
                console.log('Sending messages to OpenAI:', fullMessages);
                console.log('Messages array length:', fullMessages.length);
                
                if (!fullMessages || fullMessages.length === 0) {
                    throw new Error('No messages to send');
                }
                
                // Log model info
                const settings = provider.sdk.getSettings();
                const model = settings?.model || '';
                console.log(`Model: ${model}`);
                
                try {
                    let response;
                    
                    // Check if we should use streaming based on the provider
                    const useStreaming = this.shouldUseStreaming(provider.sdk);
                    
                    if (useStreaming) {
                        await this.handleStreamingResponse(provider.sdk, fullMessages);
                    } else {
                        response = await provider.sdk.sendChat(fullMessages);
                        
                        // Handle non-streaming response
                        if (response && response.choices && response.choices[0]) {
                            const content = response.choices[0].message?.content || '';
                            this.interface.addMessage({
                                type: 'assistant',
                                content: content,
                                timestamp: new Date()
                            });
                        } else if (response && response.content) {
                            this.interface.addMessage({
                                type: 'assistant',
                                content: response.content,
                                timestamp: new Date()
                            });
                        }
                    }
                } catch (chatError) {
                    console.error('Chat error:', chatError);
                    this.interface.hideTyping();
                    throw chatError;
                }
            }
            
            // Save conversation
            this.saveConversation();
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.interface.hideTyping();
            this.interface.addMessage({
                type: 'error',
                content: `Error: ${error.message}`,
                timestamp: new Date()
            });
        }
    }
    
    shouldUseStreaming(sdk) {
        // Check if the provider supports streaming
        const settings = sdk.getSettings();
        if (!settings) return true; // Default to streaming
        
        // Ollama native endpoints don't support streaming well
        const isOllamaNative = (settings.endpoint?.includes('ollama') || settings.endpoint?.includes('11434')) 
                               && !settings.endpoint?.includes('/v1');
        
        // Only use streaming for OpenAI-compatible endpoints
        return !isOllamaNative;
    }
    
    async getAllContext({ activeNote: providedActiveNote = undefined } = {}) {
        // Get all context from the ChatInterface (what's shown in the pills)
        const contextNotes = [];

        // Get active note
        console.log('Getting all context...');
        const activeNote = providedActiveNote !== undefined
            ? providedActiveNote
            : await this.getActiveNoteContent();
        console.log('Active note:', activeNote ? `Found: ${activeNote.title}` : 'None');

        if (activeNote && this.interface?.shouldIncludeActiveNoteContext?.(activeNote) !== false) {
            contextNotes.push(activeNote);
        }

        // Get mentioned notes from currentContext
        const mentionedNotes = this.interface.currentContext || [];
        console.log('Mentioned notes:', mentionedNotes.length);

        for (const note of mentionedNotes) {
            if (!note || note.type === 'active' || (activeNote?.path && note.path === activeNote.path)) {
                continue;
            }
            // Check if this is a CSV file - get rich context if available
            const isCsv = note.path?.toLowerCase().endsWith('.csv');

            if (isCsv) {
                const csvContext = await this.getCsvContext(note.path, note.title || note.name);
                if (csvContext) {
                    contextNotes.push(csvContext);
                    continue;
                }
            }

            // Default: get raw file content
            const content = await this.getNoteContent(note.path);
            if (content) {
                contextNotes.push({
                    title: note.title || note.name,
                    content: content,
                    path: note.path,
                    type: isCsv ? 'csv' : 'markdown'
                });
            }
        }

        console.log('Total context notes:', contextNotes.length);
        return contextNotes;
    }

    /**
     * Get rich AI context for a CSV file.
     * For premium users, returns structured context with schema, sample data, and metadata.
     * For free users, falls back to raw file content.
     *
     * @param {string} path - Path to the CSV file
     * @param {string} title - Display title for the file
     * @returns {Object|null} Context object with title, content, path, and type
     */
    async getCsvContext(path, title) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');

            // Try to get rich AI context (premium feature)
            const aiContext = await invoke('get_csv_ai_context', {
                path: path,
                maxSampleRows: 10
            });

            console.log('Got rich CSV AI context for:', title);

            // Format the AI context as markdown for the chat
            let content = `## CSV File: ${title}\n\n`;

            if (aiContext.schema_summary) {
                content += `### Schema\n${aiContext.schema_summary}\n\n`;
            }

            if (aiContext.column_descriptions && aiContext.column_descriptions.length > 0) {
                content += `### Columns\n`;
                for (const col of aiContext.column_descriptions) {
                    content += `- **${col.name}** (${col.data_type}): ${col.description || 'No description'}\n`;
                }
                content += '\n';
            }

            if (aiContext.sample_data_markdown) {
                content += `### Sample Data\n${aiContext.sample_data_markdown}\n\n`;
            }

            if (aiContext.row_count !== undefined) {
                content += `### Statistics\n- Total rows: ${aiContext.row_count}\n`;
            }

            if (aiContext.relationship_context) {
                content += `\n### Relationships\n${aiContext.relationship_context}\n`;
            }

            return {
                title: title,
                content: content,
                path: path,
                type: 'csv',
                isPremium: true
            };

        } catch (error) {
            // Check if this is a premium feature error
            const errorMessage = error?.message || error?.toString() || '';
            const isPremiumError = errorMessage.includes('premium') ||
                                   errorMessage.includes('Premium') ||
                                   errorMessage.includes('subscription');

            if (isPremiumError) {
                console.log('CSV AI context requires premium, falling back to basic content');

                // Fall back to raw file content for free users
                const rawContent = await this.getNoteContent(path);
                if (rawContent) {
                    return {
                        title: title,
                        content: `## CSV File: ${title}\n\n(Premium feature: Rich CSV context is available with CSV Editor Pro)\n\n### Raw Content Preview:\n\`\`\`csv\n${rawContent}\n\`\`\``,
                        path: path,
                        type: 'csv',
                        isPremium: false
                    };
                }
            } else {
                console.error('Error getting CSV context:', error);
            }

            return null;
        }
    }
    
    async getActiveNoteContent() {
        // Get current note content from CodeMirror or CSV editor
        console.log('Getting active note content...');

        if (!window.paneManager) {
            console.log('No paneManager found');
            return null;
        }

        const activeTabManager = window.paneManager.getActiveTabManager();
        console.log('Active tab manager:', activeTabManager);

        if (!activeTabManager) {
            console.log('No active tab manager');
            return null;
        }

        const activeTab = activeTabManager.getActiveTab();
        console.log('Active tab:', activeTab);

        if (!activeTab) {
            console.log('No active tab');
            return null;
        }

        const title = activeTab.title || 'Current Note';
        const filePath = activeTab.filePath;

        // Check if this is a CSV file - use rich context if available
        const isCsv = filePath?.toLowerCase().endsWith('.csv');
        if (isCsv) {
            console.log('Active file is CSV, getting rich context...');
            const csvContext = await this.getCsvContext(filePath, title);
            if (csvContext) {
                return csvContext;
            }
            // Fall through to raw content if getCsvContext fails
        }

        // Try to get content from editor first
        let content = '';

        if (activeTab.editor) {
            // activeTab.editor is a MarkdownEditor instance
            // Use the getContent method if available
            if (typeof activeTab.editor.getContent === 'function') {
                content = activeTab.editor.getContent();
            } else if (activeTab.editor.view) {
                content = activeTab.editor.view.state.doc.toString();
            } else if (activeTab.editor.state) {
                content = activeTab.editor.state.doc.toString();
            }
        }

        // If we couldn't get content from editor, try reading from file
        if ((!content || content.length === 0) && filePath) {
            console.log('No content from editor, trying to read from file:', filePath);
            try {
                content = await this.getNoteContent(filePath);
                console.log('Got content from file:', content?.length || 0, 'chars');
            } catch (error) {
                console.error('Failed to read file:', error);
            }
        }

        if (!content || content.length === 0) {
            console.error('No content found! This is why context is lost.');
            return null;
        }

        const truncatedContent = this.truncateContextContent(content);
        console.log('Got content from:', title, 'Length:', truncatedContent.length);

        return {
            title: title,
            content: truncatedContent,
            path: filePath,
            type: isCsv ? 'csv' : 'markdown'
        };
    }

    truncateContextContent(content) {
        if (typeof content !== 'string') {
            return '';
        }

        const maxLength = this.getContextCharLimit();
        return content.length > maxLength
            ? content.substring(0, maxLength) + '...[truncated]'
            : content;
    }
    
    async getNoteContent(path) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const content = await invoke('read_file_content', {
                filePath: path
            });
            
            return this.truncateContextContent(content);
        } catch (error) {
            console.error('Error reading note content:', error);
            return null;
        }
    }
    
    
    showAddToNoteButton(messageId, content) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'message-actions';

            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.textContent = 'Add to Note';
            addButton.addEventListener('click', () => this.addToActiveNote(messageId));

            buttonContainer.appendChild(addButton);
            messageEl.appendChild(buttonContainer);
        }
    }
    
    async addToActiveNote(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        const content = messageEl.querySelector('.message-content').textContent;
        
        if (window.paneManager) {
            const activeTab = window.paneManager.getActiveTabManager()?.getActiveTab();
            if (activeTab && activeTab.editor) {
                const view = activeTab.editor;
                const state = view.state;
                const cursorPos = state.selection.main.head;
                
                const transaction = state.update({
                    changes: {
                        from: cursorPos,
                        to: cursorPos,
                        insert: `\n\n${content}\n\n`
                    }
                });
                
                view.dispatch(transaction);
                this.showNotification('Added to note');
            } else {
                this.showNotification('No active note to add to', 'error');
            }
        }
    }
    
    showNotification(message, type = 'success') {
        console.log(`📢 ${type}: ${message}`);
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `chat-notification ${type}`;
        notification.textContent = message;
        
        // Add to container
        if (this.container) {
            this.container.appendChild(notification);
            
            // Remove after 3 seconds
            setTimeout(() => {
                notification.remove();
            }, 3000);
        }
    }
    
    updateUI() {
        if (!this.container) return;
        
        // Update container class for CLI mode
        this.container.className = `chat-panel enhanced right-sidebar-panel ${this.currentMode === 'cli' ? 'cli-mode' : ''}`;
        
        // Also update the right sidebar class for proper width
        const rightSidebar = document.getElementById('right-sidebar');
        if (rightSidebar) {
            if (this.currentMode === 'cli') {
                rightSidebar.classList.add('cli-mode');
            } else {
                rightSidebar.classList.remove('cli-mode');
            }
        }
        
        const wrapper = this.container.querySelector('.chat-content-wrapper');
        if (wrapper) {
            this.buildUI(wrapper);
        }
        
    }
    
    setupVaultListener() {
        // Listen for vault-opened events from WindowContext
        if (window.windowContext) {
            this.vaultOpenedListener = async (vaultInfo) => {
                console.log('EnhancedChatPanel: Vault opened event received:', vaultInfo);
                
                window.currentVaultPath = vaultInfo.path;
                
                // If we're in CLI mode and have a CLI container, reset it
                if (this.currentMode === 'cli' && this.cliContainer) {
                    console.log('EnhancedChatPanel: Resetting CLI for new vault:', vaultInfo.path);
                    
                    // Stop the current CLI session
                    await this.cliContainer.destroy();
                    this.cliContainer = null;
                    
                    // Add a small delay to ensure proper cleanup
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Rebuild the entire UI to ensure proper state
                    this.updateUI();
                }
            };
            
            window.windowContext.on('vault-opened', this.vaultOpenedListener);
        }
    }
    
    // Toggle right sidebar visibility
    toggle() {
        try {
            console.log(`🔄 Toggling chat panel visibility: ${this.isVisible} -> ${!this.isVisible}`);
            
            this.isVisible = !this.isVisible;
            const rightSidebar = document.getElementById('right-sidebar');
            const chatToggleBtns = document.querySelectorAll('.chat-toggle-btn');

            if (!rightSidebar) {
                console.error('❌ Right sidebar element not found');
                return;
            }

            if (this.isVisible) {
                rightSidebar.classList.add('visible');
                // Apply saved width if available
                const savedWidth = localStorage.getItem('chatPanelWidth');
                if (savedWidth) {
                    rightSidebar.style.width = savedWidth + 'px';
                }
                this.updateUI();
                console.log('✅ Chat panel shown');
            } else {
                rightSidebar.classList.remove('visible');
                // Remove inline width style to ensure CSS takes over
                rightSidebar.style.width = '';
                console.log('✅ Chat panel hidden');
            }

            // Update ALL button active states
            chatToggleBtns.forEach(btn => {
                if (this.isVisible) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
            
            // Save visibility state
            localStorage.setItem('gaimplan-chat-visible', this.isVisible.toString());
            
            console.log('💬 Chat panel toggled:', this.isVisible ? 'visible' : 'hidden');
            
        } catch (error) {
            console.error('❌ Error toggling chat panel:', error);
            // Reset state on error
            this.isVisible = !this.isVisible;
            throw error;
        }
    }
    
    async loadSavedProvider() {
        // Load the active provider from backend
        try {
            const activeProvider = await invoke('get_active_ai_provider');
            // Convert backend format to frontend format (e.g., "claude_agent" -> "claudeAgent")
            const providerKey = typeof activeProvider === 'string'
                ? activeProvider
                : activeProvider?.toLowerCase?.() || 'openai';

            // Check if this provider exists in our providers map
            if (this.providers[providerKey]) {
                this.currentProvider = providerKey;
                console.log('Loaded active provider from backend:', providerKey);

                if (this.isBotckyProviderKey(providerKey)) {
                    this.providers.botckyGateway.sdk = null;
                    this.providers.botckyGateway.configured = true;
                    this.providers.botckyGateway.status = 'ready';
                    this.currentMode = 'botcky';
                    localStorage.setItem('gaimplan-chat-mode', 'botcky');
                } else if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
            } else {
                console.log('Unknown provider from backend:', activeProvider, '- defaulting to openai');
                this.currentProvider = 'openai';
                if (this.currentMode === 'botcky') {
                    this.currentMode = 'chat';
                    localStorage.setItem('gaimplan-chat-mode', 'chat');
                }
            }
        } catch (error) {
            console.error('Failed to load active provider:', error);
            this.currentProvider = 'openai';
        }

        // Load saved visibility state
        const savedVisibility = localStorage.getItem('gaimplan-chat-visible');
        if (savedVisibility === 'true') {
            this.isVisible = true;
            const rightSidebar = document.getElementById('right-sidebar');
            const chatToggleBtns = document.querySelectorAll('.chat-toggle-btn');

            if (rightSidebar) {
                rightSidebar.classList.add('visible');
            }
            // Update ALL chat toggle buttons
            chatToggleBtns.forEach(btn => btn.classList.add('active'));
        }
    }
    
    clearChat() {
        this.createAiChatSession();
    }

    async exportChatSession(session = this.getActiveChatSession()) {
        if (!session || !session.messages || session.messages.length === 0) {
            return null;
        }
        const providerName = this.providers[this.currentProvider]?.name || this.currentProvider;
        const markdown = this.buildChatExportMarkdown(session, providerName);
        const filePath = await invoke('export_chat_to_vault', {
            content: markdown,
            filename: null
        });

        console.log('✅ Chat exported successfully to:', filePath);
        window.dispatchEvent(new CustomEvent('vault-files-changed'));
        if (window.refreshFileTree) {
            console.log('📁 Directly refreshing file tree...');
            window.refreshFileTree();
        }
        return filePath;
    }

    buildChatExportMarkdown(session, providerName) {
        let markdown = '# Chat Export\n\n';
        markdown += `**Session**: ${session.title || 'AI Chat Session'}\n`;
        markdown += `**Date**: ${new Date().toLocaleString()}\n`;
        markdown += `**Provider**: ${providerName}\n`;
        markdown += `**Messages**: ${session.messages.length}\n\n`;

        markdown += '## Conversation\n\n';
        session.messages.forEach(msg => {
            const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
            if (msg.type === 'user') {
                markdown += `### You - ${timestamp}\n${msg.content}\n\n`;
            } else if (msg.type === 'assistant') {
                markdown += `### AI - ${timestamp}\n${msg.content}\n\n`;
            } else if (msg.type === 'error') {
                markdown += `### Error - ${timestamp}\n${msg.content}\n\n`;
            } else if (msg.type === 'task_created') {
                markdown += `### Task - ${timestamp}\n${msg.content}\n\n`;
            }
        });

        return markdown;
    }
    
    clearAllChatHistory() {
        this.interface.clearMessages();
        this.persistence.clearHistory();
        localStorage.removeItem(AI_CHAT_SESSIONS_STORAGE_KEY);
    }
    
    async exportChat() {
        console.log('💾 Exporting chat...');
        
        try {
            this.saveActiveChatSession();
            const session = this.getActiveChatSession();
            if (!session?.messages?.length) {
                alert('No messages to export');
                return;
            }
            
            await this.exportChatSession(session);
            this.showNotification('Chat exported to Chat History folder');
        } catch (error) {
            console.error('Error exporting chat:', error);
            this.showNotification('Failed to export chat', 'error');
        }
    }
    
    saveConversation() {
        // Save current conversation
        const messages = this.interface.getMessages();
        this.persistActiveChatMessages(messages);
        this.persistence.saveHistory({ messages });
    }
    
    loadChatHistory() {
        if (this.chatSessions.length > 0) {
            this.loadActiveChatSessionIntoInterface();
            return;
        }

        const history = this.persistence.loadHistory();
        if (history?.messages?.length > 0) {
            const session = this.createChatSession({
                title: 'Session 1',
                messages: history.messages,
                createdAt: this.firstMessageTimestamp(history.messages),
            });
            this.chatSessions = [session];
            this.activeChatSessionId = session.id;
            this.persistChatSessions();
            this.loadActiveChatSessionIntoInterface();
        }
    }
    
    async handleStreamingResponse(sdk, messages) {
        console.log('🌊 Starting streaming response');
        
        // Hide typing indicator
        this.interface.hideTyping();
        
        // Create a new message for streaming
        const messageId = 'msg_' + Date.now();
        const streamingMessage = {
            id: messageId,
            type: 'assistant',
            content: '',
            timestamp: new Date()
        };
        
        // Add empty message to UI
        this.interface.addMessage(streamingMessage);
        
        // Check if using Gemini SDK
        const isGeminiSDK = sdk instanceof GeminiSDK;
        
        if (isGeminiSDK) {
            // Handle Gemini streaming
            try {
                const stream = await sdk.streamChat(messages);
                
                for await (const chunk of stream) {
                    if (chunk.type === 'text') {
                        streamingMessage.content += chunk.content;
                        this.interface.updateMessage(messageId, streamingMessage.content);
                    } else if (chunk.type === 'function_call') {
                        // Handle function calls if needed
                        console.log('Function call in stream:', chunk.functionCall);
                    }
                }
                
                console.log('✅ Gemini streaming complete - final content length:', streamingMessage.content.length);
                if (streamingMessage.content.length === 0) {
                    console.warn('⚠️ No content received during streaming - this may indicate an API issue');
                }
                this.interface.finalizeStreamingMessage(messageId);
                
            } catch (error) {
                console.error('Gemini streaming error:', error);
                this.interface.finalizeStreamingMessage(messageId);
                this.interface.addMessage({
                    type: 'error',
                    content: `Stream error: ${error.message}`,
                    timestamp: new Date()
                });
                throw error;
            }
        } else {
            // Handle OpenAI SDK streaming (existing code)
            const callbacks = {
                onToken: (token) => {
                    console.log('📝 Received token:', token);
                    // Accumulate content
                    streamingMessage.content += token;
                    // Update the message in the UI
                    this.interface.updateMessage(messageId, streamingMessage.content);
                },
                
                onError: (error) => {
                    console.error('Streaming error:', error);
                    this.interface.finalizeStreamingMessage(messageId);
                    this.interface.addMessage({
                        type: 'error',
                        content: `Stream error: ${error.message}`,
                        timestamp: new Date()
                    });
                },
                
                onDone: () => {
                    console.log('✅ Streaming complete - final content length:', streamingMessage.content.length);
                    if (streamingMessage.content.length === 0) {
                        console.warn('⚠️ No content received during streaming - this may indicate an API issue');
                    }
                    this.interface.finalizeStreamingMessage(messageId);
                }
            };
            
            // Start streaming
            try {
                await sdk.sendChatStream(messages, callbacks);
            } catch (error) {
                console.error('Failed to start stream:', error);
                this.interface.hideTyping();
                throw error;
            }
        }
    }
    
    async destroy() {
        console.log('🧹 Destroying EnhancedChatPanel');
        
        // Clean up vault listener
        if (this.vaultOpenedListener && window.windowContext) {
            window.windowContext.off('vault-opened', this.vaultOpenedListener);
            this.vaultOpenedListener = null;
        }

        if (this.botckyBackgroundUnsubscribe) {
            this.botckyBackgroundUnsubscribe();
            this.botckyBackgroundUnsubscribe = null;
        }
        
        // Clean up CLI container if exists
        if (this.cliContainer) {
            await this.cliContainer.destroy();
            this.cliContainer = null;
        }

        if (this.botckyHost) {
            this.botckyHost.destroy();
            this.botckyHost = null;
        }

        for (const provider of Object.values(this.providers || {})) {
            if (provider?.sdk?.disconnect) {
                await provider.sdk.disconnect();
            }
        }
        
        // Reset building flag
        this.isBuildingCLI = false;
        
        // Clean up other components
        if (this.interface) {
            this.interface.destroy();
        }
        
        if (this.contextManager) {
            // Add destroy method if contextManager has one
        }
        
        // Clear container
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
        
        // Remove global reference
    }
}
