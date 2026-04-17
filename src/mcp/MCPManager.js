import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MCPClient } from './MCPClient.js';
import { MCPVaultFixer } from './MCPVaultFixer.js';
import { getBundledServers, getBundledServerIds } from './bundledServers.js';

/**
 * Central manager for all MCP operations in the frontend
 */
export class MCPManager {
  constructor() {
    /** @type {Map<string, MCPClient>} */
    this.clients = new Map();
    
    /** @type {Map<string, Object>} */
    this.capabilities = new Map();
    
    /** @type {Map<string, string>} */
    this.status = new Map();
    
    /** @type {EventTarget} */
    this.eventEmitter = new EventTarget();
    
    /** @type {Map<string, Function>} */
    this.eventUnsubscribers = new Map();
    
    /** @type {Set<Function>} Callbacks for status changes */
    this.statusChangeCallbacks = new Set();
    
    // Install vault fixer
    this.vaultFixer = new MCPVaultFixer(this);
    
    // Add convenience methods
    this.fixVault = () => this.vaultFixer.forceRestartWithCurrentVault();
    this.verifyVault = () => this.vaultFixer.verifyVaultPaths();
  }

  /**
   * Initialize the MCP manager
   */
  async initialize() {
    console.log('[MCPManager] Initializing...');
    
    // Note: vaultFixer already has the manager reference from constructor
    
    // First check and setup MCP servers if needed
    await this.setupMCPServersIfNeeded();
    
    // Load saved configurations
    await this.loadConfigurations();
    
    // Get initial server statuses
    await this.refreshStatuses();
  }
  
  /**
   * Check and setup MCP servers on first run
   */
  async setupMCPServersIfNeeded() {
    try {
      console.log('[MCPManager] Checking MCP server status...');
      
      // Check current status
      const status = await invoke('check_mcp_servers_status');
      console.log('[MCPManager] MCP servers status:', status);
      
      // Check if we have an error (servers directory not found)
      if (status.error) {
        console.warn('[MCPManager] MCP servers not found:', status.error);
        return;
      }
      
      // Check if any servers need installation
      const needsInstall = Object.values(status).some(s => s && s.needs_install);
      
      if (!needsInstall) {
        console.log('[MCPManager] All MCP servers already set up');
        return;
      }
      
      // Show setup notification
      console.log('[MCPManager] Setting up MCP servers for first run...');
      
      // If we have a loading modal, show it
      if (window.showNotification) {
        window.showNotification('Setting up MCP servers...', 'This may take a few minutes on first run.', 'info');
      }
      
      // Run setup
      const results = await invoke('setup_mcp_servers');
      console.log('[MCPManager] Setup results:', results);
      
      // Check for errors
      const errors = results.filter(r => r.includes('ERROR'));
      if (errors.length > 0) {
        console.error('[MCPManager] Some servers failed to install:', errors);
        if (window.showNotification) {
          window.showNotification('MCP Setup Warning', `Some servers failed to install: ${errors.join(', ')}`, 'warning');
        }
      } else {
        console.log('[MCPManager] All MCP servers installed successfully');
        if (window.showNotification) {
          window.showNotification('MCP Setup Complete', 'All servers installed successfully', 'success');
        }
      }
      
    } catch (error) {
      console.error('[MCPManager] Failed to setup MCP servers:', error);
      // Don't throw - allow app to continue without MCP
    }
  }

  /**
   * Connect to an MCP server
   * @param {string} serverId - Unique identifier for the server
   * @param {Object} config - Server configuration
   */
  async connectServer(serverId, config) {
    console.log(`[MCPManager] Connecting to server: ${serverId}`, config);
    
    // Check if already connected or connecting
    const currentStatus = this.status.get(serverId);
    if (currentStatus === 'connected' || currentStatus === 'connecting') {
      console.log(`[MCPManager] Server ${serverId} is already ${currentStatus}`);
      return;
    }
    
    // Update VAULT_PATH with current vault if needed
    if (config.transport?.env?.VAULT_PATH && window.currentVaultPath) {
      console.log(`[MCPManager] Updating VAULT_PATH from ${config.transport.env.VAULT_PATH} to ${window.currentVaultPath}`);
      config = JSON.parse(JSON.stringify(config)); // Deep clone to avoid modifying original
      config.transport.env.VAULT_PATH = window.currentVaultPath;
    }
    
    try {
      // Always try to stop the server first to ensure clean state
      console.log(`[MCPManager] Ensuring ${serverId} is stopped before starting`);
      try {
        await invoke('stop_mcp_server', { serverId });
        // Small delay to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (stopError) {
        // Ignore stop errors - server might not be running
        console.log(`[MCPManager] Stop attempt for ${serverId} (expected if not running):`, stopError.message);
      }
      
      // Clean up any existing client
      const existingClient = this.clients.get(serverId);
      if (existingClient) {
        try {
          await existingClient.disconnect();
        } catch (e) {
          console.log(`[MCPManager] Error disconnecting existing client:`, e);
        }
        this.clients.delete(serverId);
      }
      
      // Clean up event listeners
      this.cleanupServerEventListeners(serverId);
      
      // Create client instance early
      const client = new MCPClient(serverId, config);
      this.clients.set(serverId, client);
      
      // Set up event listeners BEFORE starting server to avoid race condition
      await this.setupServerEventListeners(serverId);
      
      // Update status
      this.status.set(serverId, 'connecting');
      this.emitStatusChange(serverId, 'connecting');

      // Transform config for Rust backend
      let rustConfig = JSON.parse(JSON.stringify(config));

      // Handle HTTP transport config transformation
      if (rustConfig.transport?.type === 'http') {
        // Convert api_key to headers format that Rust expects
        const headers = {
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-06-18'
        };

        // Add Authorization header if api_key is provided
        if (rustConfig.transport.api_key) {
          headers['Authorization'] = `Bearer ${rustConfig.transport.api_key}`;
        }

        rustConfig.transport = {
          type: 'http',
          url: rustConfig.transport.url,
          headers: headers
        };

        console.log(`[MCPManager] Transformed HTTP config:`, rustConfig.transport);
      }

      // Now start the server
      console.log(`[MCPManager] Starting server ${serverId}`);
      await invoke('start_mcp_server', {
        serverId,
        config: rustConfig
      });
      
      // Poll for status after a short delay to ensure we catch the connection
      setTimeout(async () => {
        console.log(`[MCPManager] Checking status for ${serverId} after delay...`);
        try {
          const info = await invoke('get_mcp_server_info', { serverId });
          console.log(`[MCPManager] Server info for ${serverId}:`, info);
          
          // The Rust backend returns status as an object with a 'status' field
          const statusValue = typeof info.status === 'object' ? info.status.status : info.status;
          console.log(`[MCPManager] Status value: ${statusValue}`);
          
          if (statusValue === 'Connected' || statusValue === 'connected') {
            console.log(`[MCPManager] Server ${serverId} is connected, updating status`);
            this.status.set(serverId, 'connected');
            this.emitStatusChange(serverId, 'connected');
          }
        } catch (error) {
          console.error(`[MCPManager] Failed to get server info:`, error);
        }
      }, 2000);
      
    } catch (error) {
      console.error(`[MCPManager] Failed to connect to ${serverId}:`, error);
      this.status.set(serverId, 'error');
      this.emitStatusChange(serverId, 'error', error.message);
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   * @param {string} serverId - Server to disconnect
   */
  async disconnectServer(serverId) {
    console.log(`[MCPManager] Disconnecting from server: ${serverId}`);
    
    try {
      // Stop server via Tauri backend
      await invoke('stop_mcp_server', { serverId });
      
      // Clean up client
      const client = this.clients.get(serverId);
      if (client) {
        await client.disconnect();
        this.clients.delete(serverId);
      }
      
      // Clean up event listeners
      this.cleanupServerEventListeners(serverId);
      
      // Update status
      this.status.set(serverId, 'disconnected');
      this.emitStatusChange(serverId, 'disconnected');
      
    } catch (error) {
      console.error(`[MCPManager] Failed to disconnect ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Stop all running MCP servers
   */
  async stopAllServers() {
    console.log('[MCPManager] Stopping all MCP servers...');
    
    // Get all server IDs
    const serverIds = Array.from(this.clients.keys());
    
    // Disconnect all servers
    for (const serverId of serverIds) {
      try {
        console.log(`[MCPManager] Stopping server: ${serverId}`);
        await this.disconnectServer(serverId);
      } catch (error) {
        console.error(`[MCPManager] Failed to stop server ${serverId}:`, error);
      }
    }
    
    // Clear all collections
    this.clients.clear();
    this.capabilities.clear();
    this.status.clear();
    
    console.log('[MCPManager] All servers stopped');
  }
  
  /**
   * Start all enabled servers from saved configuration
   */
  async startAllEnabledServers() {
    console.log('[MCPManager] Starting all enabled servers...');

    try {
      // Get current vault path
      const vaultPath = window.currentVaultPath || window.windowContext?.currentVault?.path;
      if (!vaultPath) {
        console.error('[MCPManager] No vault path available');
        return;
      }

      console.log('[MCPManager] Starting servers for vault:', vaultPath);

      // Get saved settings (contains user servers and registry)
      const settings = await invoke('get_mcp_settings');
      const enabledServerIds = new Set(settings?.mcpServerRegistry?.enabledServers || []);
      const bundledServerIds = new Set(getBundledServerIds());

      console.log('[MCPManager] Enabled servers from registry:', Array.from(enabledServerIds));
      console.log('[MCPManager] Bundled server IDs:', Array.from(bundledServerIds));

      // Get bundled server configs with variables expanded
      const bundledServers = await getBundledServers(vaultPath);
      const bundledConfigMap = new Map(bundledServers.map(s => [s.id, s]));

      // Start enabled bundled servers
      for (const serverId of enabledServerIds) {
        if (bundledServerIds.has(serverId)) {
          const config = bundledConfigMap.get(serverId);
          if (config) {
            try {
              console.log(`[MCPManager] Starting bundled server: ${serverId}`);
              await this.connectServer(serverId, config);
              console.log(`[MCPManager] Bundled server ${serverId} started successfully`);
            } catch (error) {
              console.error(`[MCPManager] Failed to start bundled server ${serverId}:`, error);
            }
          }
        }
      }

      // Start enabled user-defined servers from storage
      if (settings?.servers) {
        for (const [serverId, config] of Object.entries(settings.servers)) {
          // Skip bundled servers (handled above) and disabled servers
          if (bundledServerIds.has(serverId)) continue;
          if (!enabledServerIds.has(serverId)) continue;

          // Update config with current vault path
          const updatedConfig = JSON.parse(JSON.stringify(config));

          // Set working_dir for all stdio servers
          if (updatedConfig.transport?.type === 'stdio') {
            updatedConfig.transport.working_dir = vaultPath;
          }

          // Update VAULT_PATH in env
          if (updatedConfig.transport?.env) {
            updatedConfig.transport.env.VAULT_PATH = vaultPath;
          }

          try {
            console.log(`[MCPManager] Starting user server: ${serverId}`);
            await this.connectServer(serverId, updatedConfig);
            console.log(`[MCPManager] User server ${serverId} started successfully`);
          } catch (error) {
            console.error(`[MCPManager] Failed to start user server ${serverId}:`, error);
          }
        }
      }

      console.log('[MCPManager] All enabled servers started');
    } catch (error) {
      console.error('[MCPManager] Failed to start servers:', error);
    }
  }

  /**
   * Reconnect to a server
   * @param {string} serverId - Server to reconnect
   */
  async reconnectServer(serverId) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not found`);
    }
    
    await this.disconnectServer(serverId);
    await this.connectServer(serverId, client.config);
  }

  /**
   * Invoke a tool on a server
   * @param {string} serverId - Server ID
   * @param {string} toolName - Tool to invoke
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool result
   */
  async invokeTool(serverId, toolName, params) {
    console.log(`[MCPManager] Invoking tool ${toolName} on ${serverId}`, params);
    
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not connected`);
    }
    
    // Create tool invocation request
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    };
    
    // Send via client
    const response = await client.request(request);
    
    if (response.error) {
      throw new Error(`Tool invocation failed: ${response.error.message}`);
    }
    
    return response.result;
  }

  /**
   * Read a resource from a server
   * @param {string} serverId - Server ID
   * @param {string} resourceUri - Resource URI
   * @returns {Promise<Object>} Resource content
   */
  async readResource(serverId, resourceUri) {
    console.log(`[MCPManager] Reading resource ${resourceUri} from ${serverId}`);
    
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not connected`);
    }
    
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'resources/read',
      params: {
        uri: resourceUri
      }
    };
    
    const response = await client.request(request);
    
    if (response.error) {
      throw new Error(`Resource read failed: ${response.error.message}`);
    }
    
    return response.result;
  }

  /**
   * List available tools from a server
   * @param {string} serverId - Server ID
   * @returns {Promise<Array>} List of tools
   */
  async listTools(serverId) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not connected`);
    }
    
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {}
    };
    
    const response = await client.request(request);
    
    if (response.error) {
      throw new Error(`Failed to list tools: ${response.error.message}`);
    }
    
    return response.result.tools || [];
  }

  /**
   * List available resources from a server
   * @param {string} serverId - Server ID
   * @returns {Promise<Array>} List of resources
   */
  async listResources(serverId) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not connected`);
    }
    
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'resources/list',
      params: {}
    };
    
    const response = await client.request(request);
    
    if (response.error) {
      throw new Error(`Failed to list resources: ${response.error.message}`);
    }
    
    return response.result.resources || [];
  }

  /**
   * Load server configurations
   */
  async loadConfigurations() {
    // TODO: Load from settings storage
    console.log('[MCPManager] Loading configurations...');
  }

  /**
   * Save server configuration
   * @param {string} serverId - Server ID
   * @param {Object} config - Configuration to save
   */
  async saveConfiguration(serverId, config) {
    // TODO: Save to settings storage
    console.log(`[MCPManager] Saving configuration for ${serverId}`, config);
  }

  /**
   * Delete server configuration
   * @param {string} serverId - Server ID
   */
  async deleteConfiguration(serverId) {
    // TODO: Delete from settings storage
    console.log(`[MCPManager] Deleting configuration for ${serverId}`);
  }

  /**
   * Get tools for a specific server
   * @param {string} serverId - Server ID
   * @returns {Array} List of tools
   */
  async getServerTools(serverId) {
    console.log(`[MCPManager] Getting tools for ${serverId}`);
    
    try {
      // Check if server is connected using our status map
      const currentStatus = this.status.get(serverId);
      const isConnected = 
        (typeof currentStatus === 'object' && currentStatus.status === 'connected') ||
        (typeof currentStatus === 'string' && currentStatus === 'connected');
        
      if (!isConnected) {
        console.log(`[MCPManager] Server ${serverId} not connected`);
        return [];
      }
      
      // Send tools/list request
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list',
        params: {}
      });
      
      const response = await invoke('send_mcp_message', {
        serverId,
        message: message
      });
      
      console.log(`[MCPManager] Got tools response:`, response);
      
      // Parse the JSON response if it's a string
      let parsedResponse = response;
      if (typeof response === 'string') {
        try {
          parsedResponse = JSON.parse(response);
        } catch (e) {
          console.error(`[MCPManager] Failed to parse tools response:`, e);
          return [];
        }
      }
      
      // The response might be the direct result or wrapped in a response object
      let tools = [];
      if (parsedResponse?.tools) {
        tools = parsedResponse.tools;
      } else if (parsedResponse?.result?.tools) {
        tools = parsedResponse.result.tools;
      } else if (Array.isArray(parsedResponse)) {
        tools = parsedResponse;
      }
      
      console.log(`[MCPManager] Extracted ${tools.length} tools for ${serverId}:`, tools);
      return tools;
      
    } catch (error) {
      console.error(`[MCPManager] Failed to get tools for ${serverId}:`, error);
      return [];
    }
  }
  
  /**
   * Get resources for a specific server
   * @param {string} serverId - Server ID
   * @returns {Array} List of resources
   */
  async getServerResources(serverId) {
    console.log(`[MCPManager] Getting resources for ${serverId}`);
    
    try {
      // Check if server is connected using our status map
      const currentStatus = this.status.get(serverId);
      const isConnected = 
        (typeof currentStatus === 'object' && currentStatus.status === 'connected') ||
        (typeof currentStatus === 'string' && currentStatus === 'connected');
        
      if (!isConnected) {
        console.log(`[MCPManager] Server ${serverId} not connected`);
        return [];
      }
      
      // Send resources/list request
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'resources/list',
        params: {}
      });
      
      const response = await invoke('send_mcp_message', {
        serverId,
        message: message
      });
      
      console.log(`[MCPManager] Got resources response:`, response);
      
      // Parse the JSON response if it's a string
      let parsedResponse = response;
      if (typeof response === 'string') {
        try {
          parsedResponse = JSON.parse(response);
        } catch (e) {
          console.error(`[MCPManager] Failed to parse resources response:`, e);
          return [];
        }
      }
      
      // The response might be the direct result or wrapped in a response object
      let resources = [];
      if (parsedResponse?.resources) {
        resources = parsedResponse.resources;
      } else if (parsedResponse?.result?.resources) {
        resources = parsedResponse.result.resources;
      } else if (Array.isArray(parsedResponse)) {
        resources = parsedResponse;
      }
      
      console.log(`[MCPManager] Extracted ${resources.length} resources for ${serverId}:`, resources);
      return resources;
      
    } catch (error) {
      console.error(`[MCPManager] Failed to get resources for ${serverId}:`, error);
      return [];
    }
  }

  /**
   * Refresh server statuses
   */
  async refreshStatuses() {
    try {
      const statuses = await invoke('get_mcp_server_statuses');
      
      // Update local status map
      for (const [serverId, status] of Object.entries(statuses)) {
        this.status.set(serverId, status);
      }
      
    } catch (error) {
      console.error('[MCPManager] Failed to refresh statuses:', error);
    }
  }

  /**
   * Get server info
   * @param {string} serverId - Server ID
   * @returns {Promise<Object>} Server information
   */
  async getServerInfo(serverId) {
    try {
      const info = await invoke('get_mcp_server_info', { serverId });
      return info;
    } catch (error) {
      console.error(`[MCPManager] Failed to get info for ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Set up event listeners for a server
   * @param {string} serverId - Server ID
   */
  async setupServerEventListeners(serverId) {
    // Listen for server connection
    const connectUnlisten = await listen(`mcp-server-connected-${serverId}`, (event) => {
      console.log(`[MCPManager] 🎉 Server ${serverId} CONNECTED event received!`, event.payload);
      this.status.set(serverId, 'connected');
      this.capabilities.set(serverId, event.payload.capabilities);
      this.emitStatusChange(serverId, 'connected');
      console.log(`[MCPManager] Status updated to connected for ${serverId}`);
    });
    
    // Listen for server messages
    const messageUnlisten = await listen(`mcp-message-${serverId}`, (event) => {
      console.log(`[MCPManager] Message from ${serverId}`, event.payload);
      this.handleServerMessage(serverId, event.payload);
    });
    
    // Listen for server stop
    const stopUnlisten = await listen(`mcp-server-stopped-${serverId}`, (event) => {
      console.log(`[MCPManager] Server ${serverId} stopped`);
      this.status.set(serverId, 'stopped');
      this.emitStatusChange(serverId, 'stopped');
    });
    
    // Store unsubscribers
    this.eventUnsubscribers.set(`${serverId}-connect`, connectUnlisten);
    this.eventUnsubscribers.set(`${serverId}-message`, messageUnlisten);
    this.eventUnsubscribers.set(`${serverId}-stop`, stopUnlisten);
  }

  /**
   * Clean up event listeners for a server
   * @param {string} serverId - Server ID
   */
  cleanupServerEventListeners(serverId) {
    // Unsubscribe from events
    const connectUnsub = this.eventUnsubscribers.get(`${serverId}-connect`);
    const messageUnsub = this.eventUnsubscribers.get(`${serverId}-message`);
    const stopUnsub = this.eventUnsubscribers.get(`${serverId}-stop`);
    
    if (connectUnsub) connectUnsub();
    if (messageUnsub) messageUnsub();
    if (stopUnsub) stopUnsub();
    
    // Remove from map
    this.eventUnsubscribers.delete(`${serverId}-connect`);
    this.eventUnsubscribers.delete(`${serverId}-message`);
    this.eventUnsubscribers.delete(`${serverId}-stop`);
  }

  /**
   * Handle message from server
   * @param {string} serverId - Server ID
   * @param {Object} message - JSON-RPC message
   */
  handleServerMessage(serverId, message) {
    // Forward to appropriate client
    const client = this.clients.get(serverId);
    if (client) {
      client.handleMessage(message);
    }
  }

  /**
   * Emit status change event
   * @param {string} serverId - Server ID
   * @param {string} status - New status
   * @param {string} [error] - Error message if status is 'error'
   */
  emitStatusChange(serverId, status, error) {
    const event = new CustomEvent('status-change', {
      detail: { serverId, status, error }
    });
    this.eventEmitter.dispatchEvent(event);
    
    // Update MCP status bar
    if (window.updateMCPStatus) {
      window.updateMCPStatus();
    }
    
    // Notify all status change callbacks
    this.statusChangeCallbacks.forEach(callback => {
      try {
        callback(serverId, status, error);
      } catch (err) {
        console.error('Error in status change callback:', err);
      }
    });
    
    // Update chat panel MCP indicator if available
    if (window.chatPanel && typeof window.chatPanel.updateMCPIndicator === 'function') {
      // Defer slightly to ensure DOM is ready
      setTimeout(() => {
        if (window.chatPanel && typeof window.chatPanel.updateMCPIndicator === 'function') {
          window.chatPanel.updateMCPIndicator();
        }
      }, 50);
    }
  }

  /**
   * Fix vault path issues by killing stale processes and restarting
   * @param {string} newVaultPath - The correct vault path to use
   * @returns {Promise<Object>} Result of the fix operation
   */
  async fixVaultPath(newVaultPath) {
    console.log('[MCPManager] Fixing vault path to:', newVaultPath);
    return await mcpVaultFixer.fixVaultPath(newVaultPath);
  }
  
  /**
   * Quick fix for MCP issues - kill and restart all servers
   * @returns {Promise<boolean>} Success status
   */
  async quickFixMCP() {
    console.log('[MCPManager] Performing quick MCP fix...');
    return await mcpVaultFixer.quickFix();
  }
  
  /**
   * Detect if MCP servers have stale vault paths
   * @param {string} expectedPath - The expected vault path
   * @returns {Promise<Object>} Detection result
   */
  async detectStaleVaultPath(expectedPath) {
    return await mcpVaultFixer.detectStaleVaultPath(expectedPath);
  }
  
  /**
   * Force kill all MCP processes (nuclear option)
   * @returns {Promise<Array>} Kill results
   */
  async forceKillAllMCP() {
    console.warn('[MCPManager] Force killing all MCP processes...');
    return await mcpVaultFixer.killAllMCPProcesses();
  }

  /**
   * Listen for events
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  on(event, handler) {
    this.eventEmitter.addEventListener(event, handler);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  off(event, handler) {
    this.eventEmitter.removeEventListener(event, handler);
  }

  /**
   * Register a callback for status changes
   * @param {Function} callback - Callback function (serverId, status, error)
   */
  onStatusChange(callback) {
    this.statusChangeCallbacks.add(callback);
  }
  
  /**
   * Unregister a status change callback
   * @param {Function} callback - Callback function to remove
   */
  offStatusChange(callback) {
    this.statusChangeCallbacks.delete(callback);
  }
  
  /**
   * Emit custom event
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  emit(event, data) {
    const customEvent = new CustomEvent(event, { detail: data });
    this.eventEmitter.dispatchEvent(customEvent);
  }
}

// Create singleton instance
export const mcpManager = new MCPManager();