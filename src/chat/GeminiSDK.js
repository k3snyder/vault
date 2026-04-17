import { invoke } from '@tauri-apps/api/core';

export class GeminiSDK {
    constructor() {
        this.currentStream = null;
        this.settings = null;
        this.isInitialized = false;
        this.functions = [];
        this.functionHandler = null;
    }
    
    async initialize() {
        try {
            console.log('Initializing Gemini SDK...');
            this.settings = await invoke('get_ai_settings_for_provider', { provider: 'gemini' });
            // Rust returns snake_case field names
            this.isInitialized = !!this.settings?.api_key;
            console.log('Gemini SDK initialized:', this.isInitialized, 'has API key:', !!this.settings?.api_key);
            return this.isInitialized;
        } catch (error) {
            console.error('Failed to initialize Gemini SDK:', error);
            this.isInitialized = false;
            return false;
        }
    }
    
    async refreshSettings() {
        return await this.initialize();
    }
    
    getSettings() {
        return this.settings;
    }
    
    // Convert OpenAI-style messages to Gemini format
    convertMessagesToGeminiFormat(messages) {
        const contents = [];
        let currentRole = null;
        let currentParts = [];
        
        for (const msg of messages) {
            // Skip system messages for now, we'll handle them separately
            if (msg.role === 'system') continue;
            
            // Convert role names
            const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
            
            // Handle tool/function responses
            if (msg.role === 'tool') {
                // Tool responses go back as part of the conversation
                contents.push({
                    role: 'function',
                    parts: [{
                        functionResponse: {
                            name: msg.name || 'unknown_function',
                            response: typeof msg.content === 'string' ? 
                                JSON.parse(msg.content) : msg.content
                        }
                    }]
                });
            } else if (msg.tool_calls && msg.tool_calls.length > 0) {
                // Assistant message with function calls
                const functionCalls = msg.tool_calls.map(call => ({
                    functionCall: {
                        name: call.function.name,
                        args: typeof call.function.arguments === 'string' ? 
                            JSON.parse(call.function.arguments) : call.function.arguments
                    }
                }));
                contents.push({
                    role: 'model',
                    parts: functionCalls
                });
            } else if (msg.content) {
                // Regular text message
                contents.push({
                    role: geminiRole,
                    parts: [{ text: msg.content }]
                });
            }
        }
        
        return contents;
    }
    
    // Convert OpenAI-style functions to Gemini tool format
    convertFunctionsToGeminiTools(functions) {
        if (!functions || functions.length === 0) return [];
        
        return [{
            functionDeclarations: functions.map(func => ({
                name: func.name,
                description: func.description,
                parameters: func.parameters || {
                    type: "object",
                    properties: {},
                    required: []
                }
            }))
        }];
    }
    
    // Extract system prompt from messages
    extractSystemPrompt(messages) {
        const systemMessages = messages.filter(m => m.role === 'system');
        return systemMessages.map(m => m.content).join('\n');
    }
    
    async sendChat(messages, options = {}) {
        if (!this.isInitialized) {
            throw new Error('SDK not initialized. Call initialize() first.');
        }
        
        console.log('Starting Gemini chat with messages:', messages.length);
        
        const systemPrompt = this.extractSystemPrompt(messages);
        const contents = this.convertMessagesToGeminiFormat(messages);
        
        // Add system prompt as first user message if exists
        if (systemPrompt && contents.length > 0) {
            if (contents[0].role === 'user') {
                contents[0].parts.unshift({ text: `Instructions: ${systemPrompt}\n\n` });
            } else {
                contents.unshift({
                    role: 'user',
                    parts: [{ text: systemPrompt }]
                });
            }
        }
        
        const model = options.model || this.settings?.model || 'gemini-2.0-flash';
        const apiKey = this.settings?.api_key;

        if (!apiKey) {
            throw new Error('Gemini API key not configured');
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const requestBody = {
            contents: contents,
            generationConfig: {
                temperature: options.temperature || this.settings?.temperature || 0.7,
                maxOutputTokens: options.maxTokens || this.settings?.max_tokens || 2048,
                topP: 0.95,
                topK: 40
            }
        };
        
        // Add tools if functions are provided
        if (this.functions && this.functions.length > 0) {
            requestBody.tools = this.convertFunctionsToGeminiTools(this.functions);
            requestBody.toolConfig = {
                functionCallingConfig: {
                    mode: 'AUTO'
                }
            };
        }
        
        console.log('Sending request to Gemini:', url);
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const error = await response.text();
                console.error('Gemini API error:', error);
                throw new Error(`Gemini API error: ${response.status} - ${error}`);
            }
            
            const data = await response.json();
            console.log('Gemini response:', data);
            
            // Extract the response
            if (data.candidates && data.candidates.length > 0) {
                const candidate = data.candidates[0];
                
                // Check for function calls
                if (candidate.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.functionCall) {
                            // Return function call for handling
                            return {
                                type: 'function_call',
                                functionCall: {
                                    name: part.functionCall.name,
                                    arguments: JSON.stringify(part.functionCall.args)
                                }
                            };
                        }
                    }
                    
                    // Regular text response
                    const textParts = candidate.content.parts
                        .filter(part => part.text)
                        .map(part => part.text)
                        .join('');
                    
                    return {
                        type: 'text',
                        content: textParts
                    };
                }
            }
            
            throw new Error('No valid response from Gemini');
            
        } catch (error) {
            console.error('Error calling Gemini API:', error);
            throw error;
        }
    }
    
    async streamChat(messages, options = {}) {
        if (!this.isInitialized) {
            throw new Error('SDK not initialized. Call initialize() first.');
        }
        
        console.log('Starting Gemini streaming chat with messages:', messages.length);
        
        const systemPrompt = this.extractSystemPrompt(messages);
        const contents = this.convertMessagesToGeminiFormat(messages);
        
        // Add system prompt
        if (systemPrompt && contents.length > 0) {
            if (contents[0].role === 'user') {
                contents[0].parts.unshift({ text: `Instructions: ${systemPrompt}\n\n` });
            } else {
                contents.unshift({
                    role: 'user',
                    parts: [{ text: systemPrompt }]
                });
            }
        }
        
        const model = options.model || this.settings?.model || 'gemini-2.0-flash';
        const apiKey = this.settings?.api_key;

        if (!apiKey) {
            throw new Error('Gemini API key not configured');
        }

        // Use streamGenerateContent endpoint for streaming
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

        const requestBody = {
            contents: contents,
            generationConfig: {
                temperature: options.temperature || this.settings?.temperature || 0.7,
                maxOutputTokens: options.maxTokens || this.settings?.max_tokens || 2048,
                topP: 0.95,
                topK: 40
            }
        };
        
        // Add tools if functions are provided
        if (this.functions && this.functions.length > 0) {
            requestBody.tools = this.convertFunctionsToGeminiTools(this.functions);
            requestBody.toolConfig = {
                functionCallingConfig: {
                    mode: 'AUTO'
                }
            };
        }
        
        console.log('Streaming request to Gemini:', url);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const error = await response.text();
            console.error('Gemini streaming error:', error);
            throw new Error(`Gemini API error: ${response.status} - ${error}`);
        }
        
        // Return async generator for streaming
        return {
            [Symbol.asyncIterator]: async function* () {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                if (data === '[DONE]') {
                                    return;
                                }
                                
                                try {
                                    const parsed = JSON.parse(data);
                                    if (parsed.candidates?.[0]?.content?.parts) {
                                        for (const part of parsed.candidates[0].content.parts) {
                                            if (part.text) {
                                                yield { type: 'text', content: part.text };
                                            } else if (part.functionCall) {
                                                yield {
                                                    type: 'function_call',
                                                    functionCall: {
                                                        name: part.functionCall.name,
                                                        arguments: JSON.stringify(part.functionCall.args)
                                                    }
                                                };
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.error('Error parsing SSE data:', e, data);
                                }
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
            }
        };
    }
    
    // Format messages for Gemini (compatible with OpenAI SDK interface)
    async formatMessages(userMessage, context = [], tagContext = null) {
        const messages = [];
        
        // Get custom system prompt if available
        const systemPrompt = this.settings?.system_prompt || 
            `You are a helpful AI assistant integrated into a note-taking application.
You have access to the user's notes and can help them with various tasks.
When referencing files or folders, always use forward slashes (/) in paths.
Use "." for the vault root directory, not "root"`;
        
        // Add system prompt as first message
        messages.push({
            role: 'system',
            content: systemPrompt
        });
        
        // Add context if available
        if (context && context.length > 0) {
            const contextContent = context.map(note => 
                `File: ${note.title || note.path}\n\n${note.content}`
            ).join('\n\n---\n\n');
            
            messages.push({
                role: 'system',
                content: `CURRENT CONTEXT - The user is currently viewing and working with these notes:\n\n${contextContent}\n\nPrioritize the current context over conversation history.`
            });
        }
        
        // Add tag context if available
        if (tagContext) {
            if (tagContext.relatedTags && tagContext.relatedTags.length > 0) {
                const tagInfo = tagContext.relatedTags.map(t => 
                    `#${t.tag}: ${t.notes.map(n => n.title).join(', ')}`
                ).join('\n');
                
                messages.push({
                    role: 'system',
                    content: `TAG CONTEXT - Related notes by tags:\n${tagInfo}`
                });
            }
            
            if (tagContext.relatedNotes && tagContext.relatedNotes.length > 0) {
                const noteContent = tagContext.relatedNotes.map(note =>
                    `File: ${note.title}\n${note.content.substring(0, 500)}...`
                ).join('\n\n');
                
                messages.push({
                    role: 'system',
                    content: `RELATED NOTES:\n${noteContent}`
                });
            }
        }
        
        // Add user message
        messages.push({
            role: 'user',
            content: userMessage
        });
        
        const messageCount = messages.length;
        const hasContext = context && context.length > 0;
        const contextNotes = context ? context.length : 0;
        const model = this.settings?.model || 'gemini-2.0-flash';
        
        console.log('Formatted messages for Gemini:', {
            messageCount,
            hasContext,
            contextNotes,
            model
        });
        
        return messages;
    }
    
    // Set available functions for function calling
    setFunctions(functions) {
        this.functions = functions;
        console.log('Gemini SDK: Set', functions.length, 'functions');
    }
    
    // Set function handler
    setFunctionHandler(handler) {
        this.functionHandler = handler;
    }
    
    async executeFunction(functionName, args) {
        if (!this.functionHandler) {
            throw new Error('No function handler set');
        }
        return await this.functionHandler(functionName, args);
    }
    
    abortStream() {
        if (this.currentStream) {
            this.currentStream.abort();
            this.currentStream = null;
        }
    }
}