import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

/**
 * Server Configuration Dialog
 * Modal dialog for adding/editing MCP server configurations
 */
export class ServerConfigDialog {
  constructor() {
    this.container = null;
    this.config = {
      id: '',
      name: '',
      enabled: true,
      transport: {
        type: 'stdio',
        command: '',
        args: [],
        env: {},
        working_dir: null
      },
      capabilities: {
        tools: true,
        resources: true,
        prompts: false,
        sampling: false
      },
      permissions: {
        read: true,
        write: false,
        delete: false,
        external_access: false
      }
    };
    
    this.isEditMode = false;
    this.onSave = null;
    this.onCancel = null;
    this.onRemove = null;
  }

  /**
   * Show the dialog
   * @param {Object} config - Existing configuration (for edit mode)
   * @param {Function} onSave - Callback when saved
   * @param {Function} onCancel - Callback when cancelled
   * @param {Function} onRemove - Callback when server removed (edit mode only)
   */
  show(config = null, onSave = null, onCancel = null, onRemove = null) {
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.onRemove = onRemove;
    
    if (config) {
      this.config = JSON.parse(JSON.stringify(config)); // Deep clone
      this.isEditMode = true;
    } else {
      this.resetConfig();
      this.isEditMode = false;
    }
    
    this.render();
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig() {
    this.config = {
      id: 'server-' + Date.now(),
      name: '',
      enabled: true,
      transport: {
        type: 'stdio',
        command: '',
        args: [],
        env: {},
        working_dir: null
      },
      capabilities: {
        tools: true,
        resources: true,
        prompts: false,
        sampling: false
      },
      permissions: {
        read: true,
        write: false,
        delete: false,
        external_access: false
      }
    };
  }

  /**
   * Render the dialog
   */
  render() {
    // Remove existing dialog if any
    this.cleanup();
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'server-config-dialog';
    
    dialog.innerHTML = `
      <div class="dialog-header">
        <h2>${this.isEditMode ? 'Edit' : 'Add'} MCP Server</h2>
        <button class="close-button" data-action="cancel-dialog">✕</button>
      </div>
      
      <div class="dialog-content">
        <div class="form-section">
          <h3>Basic Information</h3>
          
          <div class="form-group">
            <label for="server-name">Server Name <span class="required">*</span></label>
            <input 
              type="text" 
              id="server-name" 
              value="${this.config.name}"
              placeholder="e.g., Vault Tools, Git Helper"
              data-field="name"
            />
          </div>
          
          <div class="form-group">
            <label>
              <input 
                type="checkbox" 
                ${this.config.enabled ? 'checked' : ''}
                data-field="enabled"
              />
              Enable this server
            </label>
          </div>
        </div>
        
        <div class="form-section">
          <h3>Transport Configuration</h3>
          
          <div class="form-group">
            <label>Transport Type</label>
            <div class="radio-group">
              <label>
                <input 
                  type="radio" 
                  name="transport-type" 
                  value="stdio"
                  ${this.config.transport.type === 'stdio' ? 'checked' : ''}
                  data-field="transport-type"
                />
                Local (stdio)
              </label>
              <label>
                <input 
                  type="radio" 
                  name="transport-type" 
                  value="http"
                  ${this.config.transport.type === 'http' ? 'checked' : ''}
                  data-field="transport-type"
                />
                Remote (HTTP/SSE)
              </label>
            </div>
          </div>
          
          ${this.config.transport.type === 'stdio' ? this.renderStdioConfig() : this.renderHttpConfig()}
        </div>
        
        <div class="form-section">
          <h3>Capabilities</h3>
          <div class="checkbox-group">
            <label>
              <input 
                type="checkbox" 
                ${this.config.capabilities.tools ? 'checked' : ''}
                data-section="capabilities"
                data-field="tools"
              />
              Tools - Execute functions and commands
            </label>
            <label>
              <input 
                type="checkbox" 
                ${this.config.capabilities.resources ? 'checked' : ''}
                data-section="capabilities"
                data-field="resources"
              />
              Resources - Read data and files
            </label>
            <label>
              <input 
                type="checkbox" 
                ${this.config.capabilities.prompts ? 'checked' : ''}
                data-section="capabilities"
                data-field="prompts"
              />
              Prompts - Provide prompt templates
            </label>
            <label>
              <input 
                type="checkbox" 
                ${this.config.capabilities.sampling ? 'checked' : ''}
                data-section="capabilities"
                data-field="sampling"
              />
              Sampling - Control AI generation
            </label>
          </div>
        </div>
        
        <div class="form-section">
          <h3>Permissions</h3>
          <div class="checkbox-group">
            <label>
              <input 
                type="checkbox" 
                ${this.config.permissions.read ? 'checked' : ''}
                data-section="permissions"
                data-field="read"
              />
              Read Files
            </label>
            <label>
              <input 
                type="checkbox" 
                ${this.config.permissions.write ? 'checked' : ''}
                data-section="permissions"
                data-field="write"
              />
              Create Files
            </label>
            <label>
              <input 
                type="checkbox" 
                ${this.config.permissions.delete ? 'checked' : ''}
                data-section="permissions"
                data-field="delete"
              />
              Delete Files
            </label>
            <label>
              <input 
                type="checkbox" 
                ${this.config.permissions.external_access ? 'checked' : ''}
                data-section="permissions"
                data-field="external_access"
              />
              External Network Access
            </label>
          </div>
        </div>
        
        <div class="test-section" id="test-section">
          <!-- Test results will be shown here -->
        </div>
      </div>
      
      <div class="dialog-footer">
        ${this.isEditMode && !this.config.builtin ? `
          <button class="danger-button" data-action="remove-server">
            Remove Server
          </button>
        ` : ''}
        <div class="footer-spacer"></div>
        <button class="secondary-button" data-action="cancel-dialog">
          Cancel
        </button>
        <button class="secondary-button" data-action="test-connection">
          Test Connection
        </button>
        <button class="primary-button" data-action="save-dialog">
          ${this.isEditMode ? 'Update' : 'Add'} Server
        </button>
      </div>
    `;
    
    // Add styles
    this.addStyles();
    
    // Append to overlay
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Store reference
    this.container = overlay;
    
    // Make instance available globally for event handlers
    window.serverConfigDialog = this;

    this.setupDialogEventListeners(overlay, dialog);
    
    // Focus on name input
    setTimeout(() => {
      const nameInput = document.getElementById('server-name');
      if (nameInput) nameInput.focus();
    }, 100);
  }

  /**
   * Render stdio configuration fields
   */
  renderStdioConfig() {
    return `
      <div class="form-group">
        <label for="server-command">Command <span class="required">*</span></label>
        <div class="input-with-button">
          <input 
            type="text" 
            id="server-command" 
            value="${this.config.transport.command}"
            placeholder="e.g., node, python, /usr/local/bin/mcp-server"
            data-field="command"
          />
          <button class="browse-button" data-action="browse-command">
            Browse...
          </button>
        </div>
      </div>
      
      <div class="form-group">
        <label for="server-args">Arguments</label>
        <input 
          type="text" 
          id="server-args" 
          value="${this.config.transport.args.join(' ')}"
          placeholder="e.g., ./servers/vault-tools/index.js --verbose"
          data-field="args"
        />
        <small>Space-separated command arguments</small>
      </div>
      
      <div class="form-group">
        <label>Environment Variables</label>
        <div id="env-vars-list">
          ${Object.entries(this.config.transport.env || {}).map(([key, value]) => `
            <div class="env-var-item" data-env-key="${key}">
              <input type="text" value="${key}" placeholder="KEY" data-field="env-key">
              <span>=</span>
              <input type="text" value="${value}" placeholder="VALUE" data-field="env-value">
              <button class="remove-button" data-action="remove-env-var">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="add-button" data-action="add-env-var">
          + Add Variable
        </button>
      </div>
      
      <div class="form-group">
        <label for="server-workdir">Working Directory</label>
        <div class="input-with-button">
          <input 
            type="text" 
            id="server-workdir" 
            value="${this.config.transport.working_dir || ''}"
            placeholder="e.g., /path/to/project (optional)"
            data-field="working_dir"
          />
          <button class="browse-button" data-action="browse-workdir">
            Browse...
          </button>
        </div>
        <small>Leave empty to use default</small>
      </div>
    `;
  }

  /**
   * Render HTTP configuration fields
   */
  renderHttpConfig() {
    return `
      <div class="form-group">
        <label for="server-url">Server URL <span class="required">*</span></label>
        <input 
          type="text" 
          id="server-url" 
          value="${this.config.transport.url || ''}"
          placeholder="e.g., http://localhost:8080/mcp"
          data-field="url"
        />
      </div>
      
      <div class="form-group">
        <label for="server-api-key">API Key (optional)</label>
        <input 
          type="password" 
          id="server-api-key" 
          value="${this.config.transport.api_key || ''}"
          placeholder="Optional authentication key"
          data-field="api_key"
        />
      </div>
    `;
  }

  setupDialogEventListeners(overlay, dialog) {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.cancel();
      }
    });

    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !dialog.contains(button)) {
        return;
      }

      const action = button.dataset.action;
      const envItem = button.closest('.env-var-item');

      switch (action) {
        case 'cancel-dialog':
          event.preventDefault();
          this.cancel();
          break;
        case 'save-dialog':
          event.preventDefault();
          this.save();
          break;
        case 'test-connection':
          event.preventDefault();
          this.testConnection();
          break;
        case 'remove-server':
          event.preventDefault();
          this.removeServer();
          break;
        case 'browse-command':
          event.preventDefault();
          this.browseCommand();
          break;
        case 'browse-workdir':
          event.preventDefault();
          this.browseWorkDir();
          break;
        case 'add-env-var':
          event.preventDefault();
          this.addEnvVar();
          break;
        case 'remove-env-var':
          event.preventDefault();
          if (envItem?.dataset.envKey) {
            this.removeEnvVar(envItem.dataset.envKey);
          }
          break;
      }
    });

    dialog.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.id === 'server-name') {
        this.updateConfig('name', target.value);
        return;
      }

      if (target.dataset.field === 'enabled') {
        this.updateConfig('enabled', target.checked);
        return;
      }

      if (target.dataset.field === 'transport-type' && target instanceof HTMLInputElement) {
        this.updateTransport('type', target.value);
        return;
      }

      if (target.dataset.section === 'capabilities' && target instanceof HTMLInputElement) {
        this.updateCapability(target.dataset.field, target.checked);
        return;
      }

      if (target.dataset.section === 'permissions' && target instanceof HTMLInputElement) {
        this.updatePermission(target.dataset.field, target.checked);
        return;
      }

      if (target.dataset.field === 'command') {
        this.updateTransport('command', target.value);
        return;
      }

      if (target.dataset.field === 'args') {
        this.updateTransport('args', target.value.split(' ').filter(a => a));
        return;
      }

      if (target.dataset.field === 'working_dir') {
        this.updateTransport('working_dir', target.value || null);
        return;
      }

      if (target.dataset.field === 'url') {
        this.updateTransport('url', target.value);
        return;
      }

      if (target.dataset.field === 'api_key') {
        this.updateTransport('api_key', target.value);
        return;
      }

      if (target.dataset.field === 'env-key' || target.dataset.field === 'env-value') {
        const envItem = target.closest('.env-var-item');
        if (!envItem || !(target instanceof HTMLInputElement)) {
          return;
        }

        const currentKey = envItem.dataset.envKey;
        if (target.dataset.field === 'env-key') {
          this.updateEnvVar(target, 'key', currentKey);
          envItem.dataset.envKey = target.value;
        } else {
          this.updateEnvVar(target, 'value', currentKey);
        }
      }
    });
  }

  /**
   * Add component styles
   */
  addStyles() {
    if (document.getElementById('server-config-dialog-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'server-config-dialog-styles';
    style.textContent = `
      .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100001;
        animation: fadeIn 0.2s ease;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .server-config-dialog {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        width: 600px;
        max-width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        animation: slideIn 0.3s ease;
      }
      
      @keyframes slideIn {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      
      .dialog-header {
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .dialog-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      
      .dialog-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }
      
      .dialog-footer {
        padding: 20px;
        border-top: 1px solid var(--border-color);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      .footer-spacer {
        flex: 1;
      }

      .danger-button {
        padding: 8px 16px;
        background: transparent;
        border: 1px solid #EF4444;
        border-radius: 6px;
        color: #EF4444;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .danger-button:hover {
        background: #EF4444;
        color: white;
      }

      .form-section {
        margin-bottom: 24px;
      }
      
      .form-section h3 {
        margin: 0 0 16px 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      
      .form-group {
        margin-bottom: 16px;
      }
      
      .form-group label {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
        font-weight: 500;
      }
      
      .form-group input[type="text"],
      .form-group input[type="password"] {
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        font-size: 13px;
        color: var(--text-primary);
      }
      
      .form-group input[type="text"]:focus,
      .form-group input[type="password"]:focus {
        outline: none;
        border-color: var(--accent-color);
      }
      
      .form-group small {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        color: var(--text-secondary);
      }
      
      .required {
        color: #ef4444;
      }
      
      .radio-group,
      .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .radio-group label,
      .checkbox-group label {
        display: flex;
        align-items: center;
        cursor: pointer;
        font-size: 13px;
      }
      
      .radio-group input,
      .checkbox-group input {
        margin-right: 8px;
      }
      
      .input-with-button {
        display: flex;
        gap: 8px;
      }
      
      .input-with-button input {
        flex: 1;
      }
      
      .browse-button {
        padding: 8px 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        white-space: nowrap;
      }
      
      .browse-button:hover {
        background: var(--bg-tertiary);
      }
      
      .env-var-item {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      
      .env-var-item input {
        flex: 1;
        padding: 6px 10px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 12px;
      }
      
      .remove-button {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px 8px;
        font-size: 16px;
      }
      
      .remove-button:hover {
        color: #ef4444;
      }
      
      .add-button {
        padding: 6px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      
      .add-button:hover {
        background: var(--bg-tertiary);
      }
      
      .test-section {
        margin-top: 20px;
        padding: 16px;
        background: var(--bg-secondary);
        border-radius: 6px;
        display: none;
      }
      
      .test-section.show {
        display: block;
      }
      
      .test-section h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
      }
      
      .test-result {
        font-size: 13px;
        line-height: 1.6;
      }
      
      .test-result.success {
        color: #22c55e;
      }
      
      .test-result.error {
        color: #ef4444;
      }
      
      .test-result ul {
        margin: 8px 0;
        padding-left: 20px;
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * Update configuration
   */
  updateConfig(key, value) {
    this.config[key] = value;
  }

  /**
   * Update transport configuration
   */
  updateTransport(key, value) {
    this.config.transport[key] = value;
    if (key === 'type') {
      // Re-render transport section
      this.render();
    }
  }

  /**
   * Update capability
   */
  updateCapability(key, value) {
    this.config.capabilities[key] = value;
  }

  /**
   * Update permission
   */
  updatePermission(key, value) {
    this.config.permissions[key] = value;
  }

  /**
   * Add environment variable
   */
  addEnvVar() {
    // Ensure env object exists
    if (!this.config.transport.env) {
      this.config.transport.env = {};
    }
    
    const key = `VAR_${Object.keys(this.config.transport.env).length + 1}`;
    this.config.transport.env[key] = '';
    this.render();
  }

  /**
   * Update environment variable
   */
  updateEnvVar(input, type, oldKey) {
    const value = input.value;
    
    // Ensure env object exists
    if (!this.config.transport.env) {
      this.config.transport.env = {};
    }
    
    if (type === 'key') {
      // Key changed - need to update the object
      const oldValue = this.config.transport.env[oldKey];
      delete this.config.transport.env[oldKey];
      if (value) {
        this.config.transport.env[value] = oldValue;
      }
    } else {
      // Value changed
      this.config.transport.env[oldKey] = value;
    }
  }

  /**
   * Remove environment variable
   */
  removeEnvVar(key) {
    delete this.config.transport.env[key];
    this.render();
  }

  /**
   * Browse for command
   */
  async browseCommand() {
    try {
      const file = await open({
        multiple: false,
        directory: false
      });
      
      if (file) {
        document.getElementById('server-command').value = file;
        this.config.transport.command = file;
      }
    } catch (error) {
      console.error('Failed to browse for command:', error);
    }
  }

  /**
   * Browse for working directory
   */
  async browseWorkDir() {
    try {
      const dir = await open({
        multiple: false,
        directory: true
      });
      
      if (dir) {
        document.getElementById('server-workdir').value = dir;
        this.config.transport.working_dir = dir;
      }
    } catch (error) {
      console.error('Failed to browse for directory:', error);
    }
  }

  /**
   * Test connection
   */
  async testConnection() {
    const testSection = document.getElementById('test-section');
    testSection.className = 'test-section show';
    testSection.innerHTML = '<div class="test-result">Testing connection...</div>';
    
    try {
      // Validate required fields
      if (!this.config.name) {
        throw new Error('Server name is required');
      }
      
      if (this.config.transport.type === 'stdio' && !this.config.transport.command) {
        throw new Error('Command is required for stdio transport');
      }
      
      if (this.config.transport.type === 'http' && !this.config.transport.url) {
        throw new Error('URL is required for HTTP transport');
      }
      
      // Test connection using MCP manager
      const { mcpManager } = await import('./MCPManager.js');

      // Check if already connected
      const wasConnected = mcpManager.status.get(this.config.id) === 'connected';

      if (!wasConnected) {
        // Get paths for variable expansion
        const vaultPath = window.currentVaultPath || window.windowContext?.currentVault?.path;
        const bundlePath = await this._getBundlePath();

        // Expand ${BUNDLE_PATH} and ${VAULT_PATH} variables
        let testConfig = this._expandConfigVariables(this.config, vaultPath, bundlePath);

        // CRITICAL: Set working_dir for stdio transports to current vault
        if (testConfig.transport?.type === 'stdio' && vaultPath) {
          testConfig.transport.working_dir = vaultPath;
          // For bundled servers, remove VAULT_PATH since they use working_dir
          if (testConfig.builtin && testConfig.transport.env) {
            delete testConfig.transport.env.VAULT_PATH;
          }
        }
        await mcpManager.connectServer(this.config.id, testConfig);

        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Get server info
      const info = await mcpManager.getServerInfo(this.config.id);

      // Get available tools
      const tools = await mcpManager.listTools(this.config.id);

      // Get available resources (only if server supports them)
      let resources = [];
      if (this.config.capabilities?.resources) {
        try {
          resources = await mcpManager.listResources(this.config.id);
        } catch (resourceError) {
          console.log(`[ServerConfigDialog] Server doesn't support resources:`, resourceError.message);
        }
      }

      const resourceText = this.config.capabilities?.resources
        ? `<li>${resources.length} resources</li>`
        : '';

      testSection.innerHTML = `
        <h4>✅ Connection Successful</h4>
        <div class="test-result success">
          <strong>Server Info:</strong><br>
          Name: ${info.name}<br>
          Version: ${info.version}<br>
          <br>
          <strong>Discovered:</strong>
          <ul>
            <li>${tools.length} tools</li>
            ${resourceText}
          </ul>
        </div>
      `;
      
      // Disconnect only if we connected
      if (!wasConnected) {
        await mcpManager.disconnectServer(this.config.id);
      }

    } catch (error) {
      testSection.innerHTML = `
        <h4>❌ Connection Failed</h4>
        <div class="test-result error">
          ${error.message}
        </div>
      `;

      // Clean up: disconnect if we connected during the test
      try {
        const { mcpManager } = await import('./MCPManager.js');
        const currentStatus = mcpManager.status.get(this.config.id);
        if (currentStatus === 'connected' || currentStatus === 'connecting') {
          await mcpManager.disconnectServer(this.config.id);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get bundle path from Tauri
   * @private
   */
  async _getBundlePath() {
    try {
      return await invoke('get_bundle_path');
    } catch (error) {
      console.error('[ServerConfigDialog] Failed to get bundle path:', error);
      return '';
    }
  }

  /**
   * Expand ${BUNDLE_PATH} and ${VAULT_PATH} variables in config
   * @private
   */
  _expandConfigVariables(config, vaultPath, bundlePath) {
    const expanded = JSON.parse(JSON.stringify(config));

    const expand = (str) => {
      if (typeof str !== 'string') return str;
      return str
        .replace(/\$\{VAULT_PATH\}/g, vaultPath || '')
        .replace(/\$\{BUNDLE_PATH\}/g, bundlePath || '');
    };

    if (expanded.transport) {
      if (expanded.transport.command) {
        expanded.transport.command = expand(expanded.transport.command);
      }
      if (expanded.transport.args && Array.isArray(expanded.transport.args)) {
        expanded.transport.args = expanded.transport.args.map(arg => expand(arg));
      }
      if (expanded.transport.env) {
        for (const key in expanded.transport.env) {
          expanded.transport.env[key] = expand(expanded.transport.env[key]);
        }
      }
    }

    return expanded;
  }

  /**
   * Save configuration
   */
  async save() {
    try {
      // Validate required fields
      if (!this.config.name) {
        alert('Please enter a server name');
        return;
      }
      
      if (this.config.transport.type === 'stdio' && !this.config.transport.command) {
        alert('Please enter a command for the server');
        return;
      }
      
      if (this.config.transport.type === 'http' && !this.config.transport.url) {
        alert('Please enter a URL for the server');
        return;
      }
      
      // Call save callback
      if (this.onSave) {
        await this.onSave(this.config);
      }
      
      // Close dialog
      this.cleanup();
      
    } catch (error) {
      console.error('Failed to save configuration:', error);
      alert('Failed to save configuration: ' + error.message);
    }
  }

  /**
   * Remove server and close dialog
   */
  async removeServer() {
    const serverName = this.config.name || this.config.id;
    if (!confirm(`Are you sure you want to remove "${serverName}"? This cannot be undone.`)) {
      return;
    }

    if (this.onRemove) {
      await this.onRemove(this.config.id);
    }
    this.cleanup();
  }

  /**
   * Cancel and close dialog
   */
  cancel() {
    if (this.onCancel) {
      this.onCancel();
    }
    this.cleanup();
  }

  /**
   * Clean up dialog
   */
  cleanup() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    delete window.serverConfigDialog;
  }
}

// Create singleton instance
export const serverConfigDialog = new ServerConfigDialog();
