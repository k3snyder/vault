// ClaudeAgentSDK.js - Claude Agent SDK integration wrapper
// Uses @anthropic-ai/sdk for direct API calls with tool use support
//
// SECURITY: Path validation is handled in Rust backend (vault_agent_commands.rs)
// Do NOT add JavaScript path validation - it can be bypassed.
// The Rust backend enforces:
// - No path traversal (..)
// - No absolute paths
// - Path must stay within vault directory

console.log('ClaudeAgentSDK loading...');

import Anthropic from '@anthropic-ai/sdk';
import { invoke } from '@tauri-apps/api/core';
import { markdownUtils } from '../editor/markdown-extensions.js';

// Security limits - these are also enforced in Rust
const MAX_TOOL_CALLS_PER_TURN = 10;
const MAX_TURNS_DEFAULT = 10;
const MAX_TURNS_ABSOLUTE = 25; // Hard limit even if settings say higher

export class ClaudeAgentSDK {
  constructor() {
    console.log('Initializing ClaudeAgentSDK');
    this.settings = null;
    this.client = null;
    this.abortController = null;
    this.currentModel = 'claude-sonnet-4-5-20250929';
    this.isInitialized = false;
    this.tools = [];
    this.toolHandlers = {};
  }

  /**
   * Initialize the SDK with settings
   * @param {Object} settings - Configuration settings including API key
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(settings) {
    console.log('Initializing Claude Agent SDK...');

    try {
      // Validate required settings
      if (!settings) {
        console.error('No settings provided');
        return false;
      }

      // Support both API key and OAuth token authentication
      // OAuth token (from `claude setup-token`) uses Bearer auth for Max subscription
      // API key (sk-ant-...) uses X-Api-Key header for pay-as-you-go
      const hasApiKey = settings.apiKey && settings.apiKey.trim();
      const hasAuthToken = settings.authToken && settings.authToken.trim();

      if (!hasApiKey && !hasAuthToken) {
        console.error('Either API key or OAuth token is required');
        return false;
      }

      // Detect if the "apiKey" field contains an OAuth token (not starting with sk-ant-)
      // This allows users to paste OAuth tokens in the API key field
      let effectiveApiKey = null;
      let effectiveAuthToken = null;

      if (hasAuthToken) {
        effectiveAuthToken = settings.authToken.trim();
        console.log('Using OAuth token authentication (Bearer)');
      } else if (hasApiKey) {
        const key = settings.apiKey.trim();
        // Detect token type:
        // - sk-ant-oat... = OAuth Token (from `claude setup-token`) → Bearer auth
        // - sk-ant-api... = API key (from console.anthropic.com) → X-Api-Key
        // - sk-ant-... (other) = Legacy API key → X-Api-Key
        if (key.startsWith('sk-ant-oat')) {
          // OAuth Access Token - use Bearer authentication
          effectiveAuthToken = key;
          console.log('🔐 Detected OAuth token (sk-ant-oat...), using Bearer auth for Max subscription');
        } else if (key.startsWith('sk-ant-')) {
          // Traditional API key
          effectiveApiKey = key;
          console.log('🔑 Using API key authentication (X-Api-Key)');
        } else {
          // Unknown format - try as OAuth token
          effectiveAuthToken = key;
          console.log('⚠️ Unknown token format, trying Bearer auth');
        }
      }

      // Store settings with enforced limits
      this.settings = {
        apiKey: effectiveApiKey,
        authToken: effectiveAuthToken,
        model: settings.model || 'claude-sonnet-4-5-20250929',
        maxTurns: Math.min(settings.maxTurns || MAX_TURNS_DEFAULT, MAX_TURNS_ABSOLUTE),
        maxToolCallsPerTurn: Math.min(settings.maxToolCallsPerTurn || MAX_TOOL_CALLS_PER_TURN, MAX_TOOL_CALLS_PER_TURN),
        systemPromptAddition: settings.systemPromptAddition || '',
        allowedTools: settings.allowedTools || null,
        ...settings
      };

      // Set model
      this.currentModel = this.settings.model;

      // Create Anthropic client with appropriate auth method
      // IMPORTANT: Must explicitly set apiKey to null when using authToken
      // otherwise the SDK may still try to use X-Api-Key header
      const clientOptions = {
        dangerouslyAllowBrowser: true
      };

      if (effectiveAuthToken) {
        clientOptions.authToken = effectiveAuthToken;
        clientOptions.apiKey = null; // Explicitly null to prevent X-Api-Key header
        // Add required headers for OAuth authentication
        clientOptions.defaultHeaders = {
          'anthropic-version': '2023-06-01'
        };
        console.log('🔐 Anthropic client configured with authToken (Bearer auth)');
      } else {
        clientOptions.apiKey = effectiveApiKey;
        clientOptions.authToken = null;
        console.log('🔑 Anthropic client configured with apiKey (X-Api-Key)');
      }

      console.log('Client options:', {
        hasAuthToken: !!clientOptions.authToken,
        hasApiKey: !!clientOptions.apiKey,
        authTokenLength: clientOptions.authToken?.length,
        apiKeyPrefix: clientOptions.apiKey?.substring(0, 10)
      });

      this.client = new Anthropic(clientOptions);

      // Create tool definitions
      this.createToolDefinitions();

      this.isInitialized = true;
      console.log('Claude Agent SDK initialized with model:', this.currentModel);
      return true;
    } catch (error) {
      console.error('Failed to initialize Claude Agent SDK:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Get current settings
   * @returns {Object|null} - Current settings or null if not initialized
   */
  getSettings() {
    return this.settings;
  }

  /**
   * Refresh settings from the backend
   * @returns {Promise<boolean>} - Success status
   */
  async refreshSettings() {
    try {
      const settings = await invoke('get_ai_settings_multi', { provider: 'claudeAgent' });
      if (settings) {
        return this.initialize(settings);
      }
      return false;
    } catch (error) {
      console.error('Failed to refresh Claude Agent settings:', error);
      return false;
    }
  }

  /**
   * Create all tool definitions for the API
   */
  createToolDefinitions() {
    console.log('Creating tool definitions...');

    // Define tools in Claude API format
    this.tools = [
      {
        name: "mcp__vault__search_notes",
        description: "Search through notes in the vault by name. Returns matching note names and paths.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query to match against note names" },
            limit: { type: "number", description: "Maximum number of results to return", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: "mcp__vault__get_note",
        description: "Read the content of a specific note by its path. Returns the full markdown content.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the note file relative to vault root (e.g., 'folder/note.md')" }
          },
          required: ["path"]
        }
      },
      {
        name: "mcp__vault__get_current_note",
        description: "Get the content of the note currently open in the editor. Returns the note's path, title, and content.",
        input_schema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "mcp__vault__list_tags",
        description: "List all tags used in the vault. Returns tag names with their usage counts.",
        input_schema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of tags to return", default: 50 }
          }
        }
      },
      {
        name: "mcp__vault__notes_by_tag",
        description: "Find all notes that have a specific tag.",
        input_schema: {
          type: "object",
          properties: {
            tag: { type: "string", description: "Tag to search for (with or without # prefix)" },
            limit: { type: "number", description: "Maximum number of results", default: 20 }
          },
          required: ["tag"]
        }
      },
      {
        name: "mcp__vault__semantic_search",
        description: "Search notes using semantic/meaning-based search (requires premium).",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language query to search for" },
            limit: { type: "number", description: "Maximum results", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: "mcp__vault__write_note",
        description: "Create a new note in the vault with the specified content.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path for the new note (e.g., 'folder/note.md')" },
            content: { type: "string", description: "Markdown content for the note" }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "mcp__vault__update_note",
        description: "Replace the entire content of an existing note.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the note to update" },
            content: { type: "string", description: "New markdown content" }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "mcp__vault__append_to_note",
        description: "Append content to the end of an existing note.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the note" },
            content: { type: "string", description: "Content to append" }
          },
          required: ["path", "content"]
        }
      },
      // CSV Editor Pro tools (Premium features)
      {
        name: "mcp__vault__list_csv_files",
        description: "List all CSV files in the vault. Returns file information including path, name, size, and whether a schema exists.",
        input_schema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "mcp__vault__get_csv_schema",
        description: "Get the schema for a CSV file. Returns column definitions with data types, semantic roles, and descriptions. Premium feature - creates schema if missing when createIfMissing is true.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the CSV file relative to vault root (e.g., 'data/sales.csv')" },
            createIfMissing: { type: "boolean", description: "If true and no schema exists, infer and create one (requires premium)", default: false }
          },
          required: ["path"]
        }
      },
      {
        name: "mcp__vault__get_csv_context",
        description: "Get AI-optimized context for a CSV file. Returns rich metadata including schema summary, column descriptions, sample data as markdown table, and relationship context. Premium feature - ideal for understanding CSV structure before analysis.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the CSV file relative to vault root (e.g., 'data/sales.csv')" },
            maxSampleRows: { type: "number", description: "Maximum number of sample rows to include in context", default: 10 }
          },
          required: ["path"]
        }
      }
    ];

    // Register tool handlers - All use secure Rust backend commands
    this.toolHandlers = {
      "mcp__vault__search_notes": this.handleSearchNotes.bind(this),
      "mcp__vault__get_note": this.handleGetNote.bind(this),
      "mcp__vault__get_current_note": this.handleGetCurrentNote.bind(this),
      "mcp__vault__list_tags": this.handleListTags.bind(this),
      "mcp__vault__notes_by_tag": this.handleNotesByTag.bind(this),
      "mcp__vault__semantic_search": this.handleSemanticSearch.bind(this),
      "mcp__vault__write_note": this.handleWriteNote.bind(this),
      "mcp__vault__update_note": this.handleUpdateNote.bind(this),
      "mcp__vault__append_to_note": this.handleAppendToNote.bind(this),
      // CSV Editor Pro handlers
      "mcp__vault__list_csv_files": this.handleListCsvFiles.bind(this),
      "mcp__vault__get_csv_schema": this.handleGetCsvSchema.bind(this),
      "mcp__vault__get_csv_context": this.handleGetCsvContext.bind(this)
    };

    console.log('Created', this.tools.length, 'tool definitions');
  }

  // Tool Handlers - All path validation is done in Rust backend

  async handleSearchNotes(args) {
    console.log('search_notes called:', args);
    try {
      if (!args.query || args.query.trim() === '') {
        return JSON.stringify({ results: [], message: "Empty query provided" });
      }
      // Use existing search command (path-safe - only returns results within vault)
      const results = await invoke('searchNotesByName', { searchTerm: args.query });
      const limitedResults = results.slice(0, args.limit || 10);
      console.log('search_notes found', limitedResults.length, 'results');
      return JSON.stringify({ results: limitedResults, total: results.length, query: args.query });
    } catch (error) {
      console.error('search_notes error:', error);
      return JSON.stringify({ error: error.message || 'Search failed', query: args.query });
    }
  }

  async handleGetNote(args) {
    console.log('get_note called:', args);
    try {
      if (!args.path) {
        return JSON.stringify({ error: "Path is required" });
      }
      // SECURITY: Path validation is done in Rust backend (agent_read_note)
      // Do NOT add JavaScript validation here - it can be bypassed
      const result = await invoke('agentReadNote', { filePath: args.path });

      if (!result.success) {
        console.log('get_note failed:', result.message);
        return JSON.stringify({ error: result.message, path: args.path });
      }

      console.log('get_note read', result.length, 'characters');
      return JSON.stringify({
        path: result.path,
        content: result.content,
        length: result.length
      });
    } catch (error) {
      console.error('get_note error:', error);
      return JSON.stringify({ error: error.message || 'Failed to read note', path: args.path });
    }
  }

  async handleGetCurrentNote() {
    console.log('get_current_note called');
    try {
      if (!window.paneManager) {
        return JSON.stringify({ error: "No editor available", hasNote: false });
      }
      const activeTabManager = window.paneManager.getActiveTabManager();
      if (!activeTabManager) {
        return JSON.stringify({ error: "No active tab manager", hasNote: false });
      }
      const activeTab = activeTabManager.getActiveTab();
      if (!activeTab || !activeTab.editor) {
        return JSON.stringify({ error: "No note currently open", hasNote: false });
      }
      const content = activeTab.editor.getContent();
      const path = activeTab.filePath;
      const title = activeTab.title || path.split('/').pop();
      return JSON.stringify({ path, title, content, length: content.length, hasNote: true });
    } catch (error) {
      console.error('get_current_note error:', error);
      return JSON.stringify({ error: error.message || 'Failed to get current note' });
    }
  }

  async handleListTags(args) {
    console.log('list_tags called:', args);
    try {
      // Use new secure Rust command
      const tags = await invoke('agent_list_tags', { limit: args?.limit || 50 });
      console.log('list_tags found', tags.length, 'tags');
      return JSON.stringify({ tags, total: tags.length });
    } catch (error) {
      console.error('list_tags error:', error);
      return JSON.stringify({ error: error.message || 'Failed to list tags' });
    }
  }

  async handleNotesByTag(args) {
    console.log('notes_by_tag called:', args);
    try {
      if (!args.tag) {
        return JSON.stringify({ error: "Tag is required" });
      }
      // Use new secure Rust command
      const notes = await invoke('agent_notes_by_tag', {
        tag: args.tag,
        limit: args.limit || 20
      });
      console.log('notes_by_tag found', notes.length, 'notes');
      return JSON.stringify({ tag: args.tag, notes, total: notes.length });
    } catch (error) {
      console.error('notes_by_tag error:', error);
      return JSON.stringify({ error: error.message || 'Failed to find notes by tag', tag: args.tag });
    }
  }

  async handleSemanticSearch(args) {
    console.log('semantic_search called:', args);
    try {
      if (!args.query) {
        return JSON.stringify({ error: "Query is required" });
      }
      // Use new secure Rust command
      const results = await invoke('agent_semantic_search', {
        query: args.query,
        limit: args.limit || 10
      });
      console.log('semantic_search found', results.length, 'results');
      return JSON.stringify({ results, query: args.query });
    } catch (error) {
      console.error('semantic_search error:', error);
      // This will typically fail with "requires premium" message from Rust
      return JSON.stringify({ error: error.message || 'Semantic search failed', query: args.query });
    }
  }

  async handleWriteNote(args) {
    console.log('write_note called:', args);
    try {
      if (!args.path || !args.content) {
        return JSON.stringify({ error: "Path and content are required" });
      }
      // SECURITY: Path validation is done in Rust backend (agent_write_note)
      // Do NOT add JavaScript validation here - it can be bypassed
      const result = await invoke('agentWriteNote', {
        filePath: args.path,
        content: args.content
      });

      if (!result.success) {
        console.log('write_note failed:', result.message);
        return JSON.stringify({ error: result.message, path: args.path });
      }

      console.log('write_note created:', args.path);
      return JSON.stringify({
        success: true,
        path: result.path,
        message: result.message
      });
    } catch (error) {
      console.error('write_note error:', error);
      return JSON.stringify({ error: error.message || 'Failed to create note', path: args.path });
    }
  }

  async handleUpdateNote(args) {
    console.log('update_note called:', args);
    try {
      if (!args.path || !args.content) {
        return JSON.stringify({ error: "Path and content are required" });
      }
      // SECURITY: Path validation is done in Rust backend (agent_update_note)
      // Do NOT add JavaScript validation here - it can be bypassed
      const result = await invoke('agentUpdateNote', {
        filePath: args.path,
        content: args.content
      });

      if (!result.success) {
        console.log('update_note failed:', result.message);
        return JSON.stringify({ error: result.message, path: args.path });
      }

      console.log('update_note updated:', args.path);
      return JSON.stringify({
        success: true,
        path: result.path,
        message: result.message
      });
    } catch (error) {
      console.error('update_note error:', error);
      return JSON.stringify({ error: error.message || 'Failed to update note', path: args.path });
    }
  }

  async handleAppendToNote(args) {
    console.log('append_to_note called:', args);
    try {
      if (!args.path || !args.content) {
        return JSON.stringify({ error: "Path and content are required" });
      }
      // SECURITY: Path validation is done in Rust backend (agent_append_to_note)
      // Do NOT add JavaScript validation here - it can be bypassed
      const result = await invoke('agentAppendToNote', {
        filePath: args.path,
        content: args.content
      });

      if (!result.success) {
        console.log('append_to_note failed:', result.message);
        return JSON.stringify({ error: result.message, path: args.path });
      }

      console.log('append_to_note appended to:', args.path);
      return JSON.stringify({
        success: true,
        path: result.path,
        message: result.message
      });
    } catch (error) {
      console.error('append_to_note error:', error);
      return JSON.stringify({ error: error.message || 'Failed to append to note', path: args.path });
    }
  }

  // CSV Editor Pro Tool Handlers

  async handleListCsvFiles() {
    console.log('list_csv_files called');
    try {
      const files = await invoke('list_csv_files');
      console.log('list_csv_files found', files.length, 'CSV files');

      // Format as markdown list for easy AI consumption
      const formatted = files.map(f => {
        const schemaStatus = f.hasSchema ? ' (has schema)' : '';
        return `- ${f.path}${schemaStatus} - ${this.formatFileSize(f.size)}`;
      }).join('\n');

      return JSON.stringify({
        files,
        count: files.length,
        formatted: `## CSV Files in Vault\n\n${formatted || 'No CSV files found.'}`
      });
    } catch (error) {
      console.error('list_csv_files error:', error);
      return JSON.stringify({ error: error.message || 'Failed to list CSV files' });
    }
  }

  async handleGetCsvSchema(args) {
    console.log('get_csv_schema called:', args);
    try {
      if (!args.path) {
        return JSON.stringify({ error: "Path is required" });
      }

      const schema = await invoke('get_csv_schema', {
        path: args.path,
        createIfMissing: args.createIfMissing || false
      });

      console.log('get_csv_schema loaded schema for:', args.path);

      // Format column info for AI consumption
      const columnSummary = schema.columns.map(col => {
        const role = col.semanticRole?.role || 'unknown';
        const type = col.dataType?.type || 'text';
        return `- **${col.name}** (${type}, ${role}): ${col.description || 'No description'}`;
      }).join('\n');

      return JSON.stringify({
        schema,
        path: args.path,
        columnCount: schema.columns.length,
        hasRelationships: schema.relationships?.length > 0,
        readOnly: schema.readOnly,
        formatted: `## Schema: ${args.path}\n\n### Columns\n\n${columnSummary}`
      });
    } catch (error) {
      console.error('get_csv_schema error:', error);
      // Handle premium required error gracefully
      const errorMsg = error.message || error.toString();
      if (errorMsg.includes('PremiumRequired') || errorMsg.includes('premium')) {
        return JSON.stringify({
          error: 'Schema features require CSV Editor Pro premium subscription',
          path: args.path,
          premiumRequired: true
        });
      }
      return JSON.stringify({ error: errorMsg || 'Failed to get CSV schema', path: args.path });
    }
  }

  async handleGetCsvContext(args) {
    console.log('get_csv_context called:', args);
    try {
      if (!args.path) {
        return JSON.stringify({ error: "Path is required" });
      }

      const context = await invoke('get_csv_ai_context', {
        path: args.path,
        maxSampleRows: args.maxSampleRows || 10
      });

      console.log('get_csv_context generated context for:', args.path);

      // Build comprehensive markdown context
      let markdown = `# CSV Context: ${context.filePath}\n\n`;

      if (context.description) {
        markdown += `## Description\n\n${context.description}\n\n`;
      }

      if (context.schemaSummary) {
        markdown += `## Schema Summary\n\n${context.schemaSummary}\n\n`;
      }

      if (context.columns?.length > 0) {
        markdown += `## Columns\n\n`;
        markdown += `| Column | Type | Role | Description |\n`;
        markdown += `|--------|------|------|-------------|\n`;
        for (const col of context.columns) {
          markdown += `| ${col.name} | ${col.dataType} | ${col.role} | ${col.description || '-'} |\n`;
        }
        markdown += '\n';
      }

      if (context.sampleData) {
        markdown += `## Sample Data\n\n${context.sampleData}\n\n`;
      }

      if (context.relationships?.length > 0) {
        markdown += `## Relationships\n\n`;
        for (const rel of context.relationships) {
          markdown += `- **${rel.name}**: ${rel.description}\n`;
        }
        markdown += '\n';
      }

      return JSON.stringify({
        context,
        path: args.path,
        formatted: markdown
      });
    } catch (error) {
      console.error('get_csv_context error:', error);
      // Handle premium required error gracefully
      const errorMsg = error.message || error.toString();
      if (errorMsg.includes('PremiumRequired') || errorMsg.includes('premium')) {
        return JSON.stringify({
          error: 'AI Context features require CSV Editor Pro premium subscription',
          path: args.path,
          premiumRequired: true
        });
      }
      return JSON.stringify({ error: errorMsg || 'Failed to get CSV context', path: args.path });
    }
  }

  /**
   * Format file size in human-readable format
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * Execute a tool by name
   */
  async executeTool(toolName, toolInput) {
    console.log('Executing tool:', toolName, toolInput);
    const handler = this.toolHandlers[toolName];
    if (!handler) {
      console.error('Unknown tool:', toolName);
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    return await handler(toolInput);
  }

  /**
   * Get allowed tools based on settings
   */
  getAllowedTools() {
    if (!this.settings?.allowedTools) {
      return this.tools.map(t => t.name);
    }
    return this.settings.allowedTools;
  }

  /**
   * Filter tools based on allowed list
   */
  getFilteredTools() {
    const allowed = this.getAllowedTools();
    console.log('Allowed tools:', allowed);
    return this.tools.filter(t => allowed.includes(t.name));
  }

  /**
   * Check if SDK is ready
   */
  isReady() {
    return this.isInitialized && this.client !== null;
  }

  /**
   * Update settings
   */
  updateSettings(settings) {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
      // Enforce limits
      this.settings.maxTurns = Math.min(this.settings.maxTurns || MAX_TURNS_DEFAULT, MAX_TURNS_ABSOLUTE);
      this.settings.maxToolCallsPerTurn = Math.min(
        this.settings.maxToolCallsPerTurn || MAX_TOOL_CALLS_PER_TURN,
        MAX_TOOL_CALLS_PER_TURN
      );

      if (settings.model) {
        this.currentModel = settings.model;
      }
      if (settings.apiKey && settings.apiKey !== this.settings.apiKey) {
        this.client = new Anthropic({
          apiKey: settings.apiKey,
          dangerouslyAllowBrowser: true
        });
      }
    }
  }

  /**
   * Abort current request
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Main chat method - handles the agentic loop with streaming
   * @param {string} message - User message
   * @param {Array} context - Context notes
   * @param {Object} options - Additional options
   * @yields {Object} - Processed events for UI
   */
  async *chat(message, context = [], options = {}) {
    if (!this.isReady()) {
      yield { type: 'error', error: 'SDK not initialized. Please configure API key in settings.' };
      return;
    }

    console.log('Chat called with:', message);
    console.log('With context:', context.length, 'notes');

    this.abortController = new AbortController();

    try {
      // Build system prompt
      let systemPrompt = `You are a helpful assistant integrated into a note-taking application called Vault. You have access to tools that let you search, read, and modify notes in the user's vault.

When the user asks about their notes or wants you to help with their knowledge base, use the available tools to search and access their content.

Be concise and helpful. When summarizing content, extract the key points and present them clearly.`;

      if (this.settings?.systemPromptAddition) {
        systemPrompt += '\n\n' + this.settings.systemPromptAddition;
      }

      // Build initial messages
      const messages = [];

      // Add context as a system message if provided
      if (context && context.length > 0) {
        const contextText = context.map(note => {
          return `--- ${note.title || note.path || 'Note'} ---\n${note.content}`;
        }).join('\n\n');

        messages.push({
          role: 'user',
          content: `Here is the context from my notes:\n\n${contextText}\n\nNow, here is my question: ${message}`
        });
      } else {
        messages.push({
          role: 'user',
          content: message
        });
      }

      // Get filtered tools
      const tools = this.getFilteredTools();

      let turnCount = 0;
      const maxTurns = this.settings?.maxTurns || MAX_TURNS_DEFAULT;
      const maxToolCallsPerTurn = this.settings?.maxToolCallsPerTurn || MAX_TOOL_CALLS_PER_TURN;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalToolCalls = 0;

      console.log('Starting SDK query with model:', this.currentModel);
      console.log('Limits: maxTurns=%d, maxToolCallsPerTurn=%d', maxTurns, maxToolCallsPerTurn);

      // Agentic loop
      while (turnCount < maxTurns) {
        turnCount++;
        console.log(`Turn ${turnCount}/${maxTurns}`);

        // Make streaming API call
        const stream = this.client.messages.stream({
          model: this.currentModel,
          max_tokens: 8192,
          system: systemPrompt,
          messages: messages,
          tools: tools.length > 0 ? tools : undefined
        });

        let assistantMessage = { role: 'assistant', content: [] };
        let currentText = '';
        let toolUseBlocks = [];

        // Process stream events
        for await (const event of stream) {
          // Check for abort
          if (this.abortController?.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'text') {
              currentText = '';
            } else if (event.content_block.type === 'tool_use') {
              toolUseBlocks.push({
                type: 'tool_use',
                id: event.content_block.id,
                name: event.content_block.name,
                input: ''
              });
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              currentText += event.delta.text;
              // Yield streaming text - use 'chunk' to match UI expectations
              yield {
                type: 'chunk',
                text: event.delta.text,
                accumulated: currentText
              };
            } else if (event.delta.type === 'input_json_delta') {
              // Accumulate tool input JSON
              const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
              if (lastTool) {
                lastTool.input += event.delta.partial_json;
              }
            }
          } else if (event.type === 'content_block_stop') {
            if (currentText) {
              assistantMessage.content.push({ type: 'text', text: currentText });
            }
          } else if (event.type === 'message_delta') {
            if (event.usage) {
              totalOutputTokens += event.usage.output_tokens || 0;
            }
          } else if (event.type === 'message_start') {
            if (event.message?.usage) {
              totalInputTokens += event.message.usage.input_tokens || 0;
            }
          }
        }

        // Finalize tool use blocks
        for (const toolBlock of toolUseBlocks) {
          try {
            toolBlock.input = JSON.parse(toolBlock.input || '{}');
          } catch (e) {
            toolBlock.input = {};
          }
          assistantMessage.content.push(toolBlock);
        }

        // Add assistant message to history
        messages.push(assistantMessage);

        // Check if we need to handle tool use
        const hasToolUse = toolUseBlocks.length > 0;

        if (!hasToolUse) {
          // No tool use - we're done
          console.log('Chat query completed (no tool use)');

          yield {
            type: 'result',
            success: true,
            text: currentText,
            usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
            turns: turnCount,
            totalToolCalls
          };
          return;
        }

        // SECURITY: Enforce per-turn tool call limit
        if (toolUseBlocks.length > maxToolCallsPerTurn) {
          console.warn(`Tool call limit exceeded: ${toolUseBlocks.length} > ${maxToolCallsPerTurn}`);
          yield {
            type: 'warning',
            message: `Tool call limit exceeded. Processing first ${maxToolCallsPerTurn} of ${toolUseBlocks.length} requested tools.`
          };
          toolUseBlocks = toolUseBlocks.slice(0, maxToolCallsPerTurn);
        }

        // Handle tool use
        console.log('Processing', toolUseBlocks.length, 'tool calls');
        totalToolCalls += toolUseBlocks.length;

        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          // Yield tool use event
          yield {
            type: 'tool_use',
            toolName: toolUse.name,
            toolInput: toolUse.input,
            id: toolUse.id
          };

          // Execute tool
          const result = await this.executeTool(toolUse.name, toolUse.input);

          // Yield tool result event
          yield {
            type: 'tool_result',
            toolName: toolUse.name,
            result: result,
            id: toolUse.id
          };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result
          });
        }

        // Add tool results to messages
        messages.push({
          role: 'user',
          content: toolResults
        });
      }

      // Max turns reached
      console.log('Max turns reached');
      yield {
        type: 'result',
        success: true,
        text: 'Maximum conversation turns reached.',
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        turns: turnCount,
        totalToolCalls,
        maxTurnsReached: true
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Chat query aborted');
        yield { type: 'aborted', message: 'Request was cancelled' };
      } else {
        console.error('Chat error:', error);
        yield { type: 'error', error: error.message || 'Chat query failed' };
      }
    } finally {
      this.abortController = null;
    }
  }
}
