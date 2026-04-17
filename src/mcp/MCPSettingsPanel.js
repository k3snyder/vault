import { invoke } from '@tauri-apps/api/core';
import { mcpManager } from './MCPManager.js';
import { serverConfigDialog } from './ServerConfigDialog.js';
import { bundledServers, getBundledServers, getBundledServerIds } from './bundledServers.js';
import MCPServerRegistry from './MCPServerRegistry.js';
import MCPConfigGenerator from './MCPConfigGenerator.js';

/**
 * MCP Settings Panel Component
 * Manages MCP server configurations and status
 */
export class MCPSettingsPanel {
  constructor() {
    this.container = null;
    this.servers = new Map();
    this.serverCapabilities = new Map(); // Store tools and resources count
    this.isVisible = false;

    // Initialize MCP Server Registry
    this.registry = new MCPServerRegistry();

    // Bind methods
    this.hide = this.hide.bind(this);
    this.show = this.show.bind(this);
    this.toggle = this.toggle.bind(this);
    this.handleToggle = this.handleToggle.bind(this);
    this.handleRemove = this.handleRemove.bind(this);
  }

  /**
   * Mount the settings panel to a container
   * @param {HTMLElement} container - Container element
   */
  async mount(container) {
    this.container = container;
    this.render();

    // Load registry state from settings (new architecture)
    await this.loadRegistry();

    // Load existing server configurations
    await this.loadServers();

    // Set up event listeners
    this.setupEventListeners();

    // Listen for server status changes
    mcpManager.on('status-change', (event) => {
      console.log(`[MCPSettingsPanel] Received status-change event:`, event.detail);
      this.updateServerStatus(event.detail.serverId, event.detail.status);
    });
  }

  /**
   * Render the settings panel
   */
  render() {
    const html = `
      <div class="mcp-settings-panel ${this.isVisible ? 'visible' : ''}" id="mcp-settings-panel">
        <div class="mcp-settings-header">
          <h2>MCP Settings</h2>
          <button class="close-button" aria-label="Close settings">✕</button>
        </div>
        
        <div class="mcp-settings-content">
          <div class="mcp-toggle-section">
            <label class="toggle-label">
              <input type="checkbox" id="mcp-enabled" checked>
              <span>Enable MCP Integration</span>
            </label>
          </div>
          
          <div class="mcp-servers-section">
            <h3>Configured Servers</h3>
            <div class="mcp-servers-list" id="mcp-servers-list">
              <!-- Server items will be rendered here -->
            </div>
          </div>
          
          <div class="mcp-actions">
            <button class="primary-button" id="add-server-btn">
              <span>➕</span> Add Server
            </button>
            <button class="secondary-button" id="import-config-btn">
              Import Config
            </button>
            <button class="secondary-button" id="export-config-btn">
              Export Config
            </button>
          </div>
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
    this.addStyles();
  }

  /**
   * Add component styles
   */
  addStyles() {
    if (document.getElementById('mcp-settings-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'mcp-settings-styles';
    style.textContent = `
      .mcp-settings-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        width: 600px;
        max-width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 100000;
        pointer-events: none;
      }
      
      .mcp-settings-panel.visible {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
        pointer-events: auto;
      }
      
      .mcp-settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
      }
      
      .mcp-settings-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      
      .close-button {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
      }
      
      .close-button:hover {
        background: var(--bg-secondary);
        color: var(--text-primary);
      }
      
      .mcp-settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }
      
      .mcp-toggle-section {
        margin-bottom: 24px;
      }
      
      .toggle-label {
        display: flex;
        align-items: center;
        cursor: pointer;
        user-select: none;
      }
      
      .toggle-label input[type="checkbox"] {
        margin-right: 8px;
      }
      
      .mcp-servers-section {
        margin-bottom: 24px;
      }
      
      .mcp-servers-section h3 {
        margin: 0 0 16px 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      
      .mcp-servers-list {
        border: 1px solid var(--border-color);
        border-radius: 6px;
        overflow: hidden;
      }
      
      .mcp-server-item {
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
      }
      
      .mcp-server-item:last-child {
        border-bottom: none;
      }
      
      .server-header {
        display: flex;
        align-items: center;
        padding: 16px;
      }
      
      .server-header:hover {
        background: var(--bg-tertiary);
      }
      
      .server-status {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 12px;
        flex-shrink: 0;
      }
      
      .server-status.connected {
        background: #22C55E;
      }
      
      .server-status.disconnected {
        background: #EF4444;
      }
      
      .server-status.connecting {
        background: #F59E0B;
        animation: pulse 1.5s infinite;
      }
      
      .server-status.disabled {
        background: #9CA3AF;
      }
      
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
      
      .server-info {
        flex: 1;
      }
      
      .server-name {
        font-weight: 500;
        margin-bottom: 4px;
      }
      
      .server-details {
        font-size: 12px;
        color: var(--text-secondary);
        display: flex;
        gap: 4px;
      }
      
      .capabilities-text {
        color: var(--text-primary);
        font-weight: 500;
      }
      
      .server-actions {
        display: flex;
        gap: 8px;
      }
      
      .server-action-btn {
        background: none;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
      }
      
      .server-action-btn:hover {
        background: var(--bg-primary);
        border-color: var(--accent-color);
      }
      
      /* Toggle switch styles */
      .server-toggle {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 20px;
        margin-right: 8px;
      }
      
      .server-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      
      .toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        transition: .3s;
      }
      
      .toggle-slider:before {
        position: absolute;
        content: "";
        height: 14px;
        width: 14px;
        left: 3px;
        bottom: 2px;
        background-color: var(--text-secondary);
        border-radius: 50%;
        transition: .3s;
      }
      
      .server-toggle input:checked + .toggle-slider {
        background-color: var(--accent-color);
        border-color: var(--accent-color);
      }
      
      .server-toggle input:checked + .toggle-slider:before {
        background-color: white;
        transform: translateX(18px);
      }
      
      .expand-tools-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 6px 12px;
        margin-top: 8px;
        cursor: pointer;
        font-size: 12px;
        color: var(--text-primary);
        transition: all 0.2s;
        width: fit-content;
      }
      
      .expand-tools-btn:hover {
        background: var(--bg-primary);
        border-color: var(--accent-color);
        color: var(--accent-color);
      }
      
      .expand-icon {
        display: inline-block;
        transition: transform 0.2s;
        font-size: 10px;
      }
      
      .expand-tools-btn[data-expanded="true"] .expand-icon {
        transform: rotate(90deg);
      }
      
      .expand-text {
        font-weight: 500;
      }
      
      .server-tools-list {
        padding: 0 16px 16px 52px;
        background: var(--bg-primary);
        border-top: 1px solid var(--border-color);
      }
      
      .tools-loading {
        padding: 12px;
        color: var(--text-secondary);
        font-size: 13px;
      }
      
      .no-tools {
        padding: 12px;
        color: var(--text-secondary);
        font-size: 13px;
        font-style: italic;
      }
      
      .tools-section {
        margin-top: 12px;
      }
      
      .tools-section-header {
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 8px;
        font-size: 13px;
      }
      
      .tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
      }
      
      .tool-item {
        padding: 8px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: default;
        transition: all 0.2s;
      }
      
      .tool-item:hover {
        background: var(--bg-tertiary);
        border-color: var(--accent-color);
      }
      
      .tool-name {
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 12px;
        color: var(--accent-color);
        font-weight: 500;
      }
      
      .tool-description {
        font-size: 11px;
        color: var(--text-secondary);
        margin-top: 4px;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      
      .mcp-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }
      
      .primary-button, .secondary-button {
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .primary-button {
        background: var(--accent-color);
        color: white;
      }
      
      .primary-button:hover {
        background: #3562ce;
      }
      
      .secondary-button {
        background: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }
      
      .secondary-button:hover {
        background: var(--bg-tertiary);
      }
      
      .empty-state {
        text-align: center;
        padding: 40px;
        color: var(--text-secondary);
      }
      
      .empty-state p {
        margin-bottom: 20px;
      }

      /* New server card styles for registry architecture */
      .mcp-server-card {
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
        transition: background 0.2s;
      }

      .mcp-server-card:last-child {
        border-bottom: none;
      }

      .mcp-server-card:hover {
        background: var(--bg-tertiary);
      }

      .server-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
      }

      .server-info {
        flex: 1;
        min-width: 0;
      }

      .server-display-name {
        font-weight: 500;
        font-size: 14px;
        color: var(--text-primary);
        margin-bottom: 4px;
      }

      .server-description {
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.4;
      }

      .server-controls {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .server-toggle-checkbox {
        position: relative;
      }

      .add-server-container {
        padding: 16px;
        border-top: 1px solid var(--border-color);
        background: var(--bg-primary);
      }

      .add-custom-server-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 16px;
        background: var(--bg-secondary);
        border: 1px dashed var(--border-color);
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
        transition: all 0.2s;
      }

      .add-custom-server-btn:hover {
        background: var(--bg-tertiary);
        border-color: var(--accent-color);
        color: var(--accent-color);
      }

      .add-icon {
        font-size: 16px;
      }

      /* Status indicator styles */
      .server-status-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 12px;
        flex-shrink: 0;
        transition: background-color 0.3s ease;
      }

      .server-status-indicator.connected {
        background: #22C55E;
        box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
      }

      .server-status-indicator.disconnected {
        background: #6B7280;
      }

      .server-status-indicator.connecting {
        background: #F59E0B;
        animation: pulse-status 1.5s infinite;
      }

      .server-status-indicator.disabled {
        background: #9CA3AF;
        opacity: 0.5;
      }

      .server-status-indicator.error {
        background: #EF4444;
      }

      @keyframes pulse-status {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.9); }
      }

      /* Clickable card header */
      .server-card-header {
        display: flex;
        align-items: center;
        padding: 16px;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      .server-card-header:hover {
        background: var(--bg-tertiary);
      }

      .server-card-header:focus {
        outline: 2px solid var(--accent-color);
        outline-offset: -2px;
      }

      /* Expand chevron */
      .expand-chevron {
        font-size: 12px;
        color: var(--text-secondary);
        margin-left: 8px;
        padding: 4px;
        cursor: pointer;
        user-select: none;
      }

      .expand-chevron:hover {
        color: var(--text-primary);
      }

      /* Capabilities badge */
      .caps-badge {
        font-size: 11px;
        background: var(--accent-color);
        color: white;
        padding: 2px 6px;
        border-radius: 10px;
        font-weight: 500;
      }

      /* Server details panel */
      .server-details-panel {
        background: var(--bg-primary);
        border-top: 1px solid var(--border-color);
        overflow: hidden;
        animation: slideDown 0.2s ease;
      }

      @keyframes slideDown {
        from { opacity: 0; max-height: 0; }
        to { opacity: 1; max-height: 500px; }
      }

      .server-details-content {
        padding: 16px 16px 16px 38px;
      }

      .detail-section {
        margin-bottom: 16px;
      }

      .detail-section:last-child {
        margin-bottom: 0;
      }

      .detail-section-header {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-secondary);
        margin-bottom: 8px;
        letter-spacing: 0.5px;
      }

      .detail-row {
        display: flex;
        align-items: flex-start;
        margin-bottom: 6px;
        font-size: 13px;
      }

      .detail-label {
        color: var(--text-secondary);
        min-width: 80px;
        flex-shrink: 0;
      }

      .detail-value {
        color: var(--text-primary);
        word-break: break-all;
      }

      .detail-value code {
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 12px;
        background: var(--bg-secondary);
        padding: 2px 6px;
        border-radius: 3px;
      }

      .detail-value.status-connected {
        color: #22C55E;
      }

      .detail-value.status-disconnected {
        color: #6B7280;
      }

      .detail-value.status-connecting {
        color: #F59E0B;
      }

      .detail-value.status-error {
        color: #EF4444;
      }

      /* Capabilities grid */
      .capabilities-grid {
        display: flex;
        gap: 16px;
      }

      .capability-item {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-secondary);
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--border-color);
      }

      .capability-icon {
        font-size: 16px;
      }

      .capability-count {
        font-weight: 600;
        font-size: 18px;
        color: var(--accent-color);
      }

      .capability-label {
        font-size: 12px;
        color: var(--text-secondary);
      }

      /* Detail action buttons */
      .detail-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
        flex-wrap: wrap;
      }

      .detail-action-btn {
        padding: 6px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .detail-action-btn:hover {
        background: var(--bg-tertiary);
        border-color: var(--accent-color);
      }

      .detail-action-btn.test-btn {
        background: var(--accent-color);
        color: white;
        border-color: var(--accent-color);
      }

      .detail-action-btn.test-btn:hover {
        background: #2d8a2d;
        border-color: #2d8a2d;
      }

      /* Test result inline */
      .test-result-inline {
        margin-top: 12px;
        display: none;
      }

      .test-loading {
        color: var(--text-secondary);
        font-size: 13px;
        padding: 8px;
        background: var(--bg-secondary);
        border-radius: 4px;
      }

      .test-success {
        color: #22C55E;
        font-size: 13px;
        padding: 12px;
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid rgba(34, 197, 94, 0.3);
        border-radius: 6px;
      }

      .test-success .test-details {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: 4px;
      }

      .test-error {
        color: #EF4444;
        font-size: 13px;
        padding: 12px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 6px;
      }

      /* Tools dialog overlay */
      .tools-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100002;
        animation: fadeIn 0.2s ease;
      }

      .tools-dialog {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        width: 600px;
        max-width: 90vw;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      }

      .tools-dialog-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .tools-dialog-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }

      .tools-dialog-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
      }

      .tools-dialog .tools-section {
        margin-bottom: 20px;
      }

      .tools-dialog .tools-section:last-child {
        margin-bottom: 0;
      }

      .tools-dialog .tools-section h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
      }

      .empty-tools {
        text-align: center;
        padding: 40px;
        color: var(--text-secondary);
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.close-button');
    if (closeBtn) {
      closeBtn.addEventListener('click', this.hide);
    }
    
    // MCP enabled toggle
    const enableToggle = this.container.querySelector('#mcp-enabled');
    if (enableToggle) {
      enableToggle.addEventListener('change', (e) => {
        this.handleEnableToggle(e.target.checked);
      });
    }
    
    // Add server button
    const addBtn = this.container.querySelector('#add-server-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.showAddServerDialog();
      });
    }
    
    // Import/Export buttons
    const importBtn = this.container.querySelector('#import-config-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        this.handleImportConfig();
      });
    }
    
    const exportBtn = this.container.querySelector('#export-config-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.handleExportConfig();
      });
    }
    
    // Click outside to close (with delay to avoid immediate trigger)
    setTimeout(() => {
      document.addEventListener('click', (e) => {
        const panel = this.container.querySelector('.mcp-settings-panel');
        if (this.isVisible && panel && !panel.contains(e.target)) {
          // Don't hide if clicking on the MCP settings button in AI settings
          const mcpButton = e.target.closest('.mcp-settings-btn');
          // Also check for the chat header MCP button
          const chatMcpButton = e.target.closest('.chat-action-btn[title="MCP Settings"]');
          if (mcpButton || chatMcpButton) {
            return;
          }
          this.hide();
        }
      });
    }, 100);
  }

  /**
   * Generate vault ID from path (matches backend logic)
   * @param {string} vaultPath - Path to vault
   * @returns {string} 8-character vault ID
   */
  generateVaultId(vaultPath) {
    // Simple hash function for browser
    let hash = 0;
    for (let i = 0; i < vaultPath.length; i++) {
      const char = vaultPath.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
  }


  /**
   * Load server configurations
   */
  async loadServers() {
    try {
      // Load from settings storage
      const settings = await invoke('get_mcp_settings');
      console.log('Loaded MCP settings:', settings);

      // Clear existing servers
      this.servers.clear();

      // Get current vault path for all operations
      const vaultPath = await this.getCurrentVaultPath();

      // Get bundled server IDs to identify which saved configs are stale bundled servers
      const bundledServerIds = new Set(bundledServers.map(s => s.id));

      // Load servers from settings, but SKIP and DELETE bundled servers (they come from bundledServers.js)
      if (settings.servers) {
        for (const [id, config] of Object.entries(settings.servers)) {
          // Skip AND DELETE bundled servers - they should only come from bundledServers.js
          if (bundledServerIds.has(id)) {
            console.log(`Deleting stale bundled server config from storage: ${id}`);
            // Delete from Rust storage (async, don't wait)
            this.deleteConfiguration(id).catch(e =>
              console.warn(`Failed to delete stale config for ${id}:`, e)
            );
            continue;
          }

          // CRITICAL: Set working_dir for all stdio servers to use vault path
          if (config.transport?.type === 'stdio' && vaultPath) {
            config.transport.working_dir = vaultPath;
          }

          // Ensure transport args is always an array
          if (config.transport && !Array.isArray(config.transport.args)) {
            config.transport.args = [];
          }

          this.servers.set(id, config);
        }
      }

      // Set enabled state
      const enableToggle = this.container.querySelector('#mcp-enabled');
      if (enableToggle) {
        enableToggle.checked = settings.enabled !== false;
      }

      // ALWAYS load bundled servers fresh from bundledServers.js
      // This ensures we use correct paths (not stale saved configs with ${BUNDLE_PATH})
      if (vaultPath) {
        const bundled = await getBundledServers(vaultPath);

        for (const server of bundled) {
          // Use fresh bundled config (never from Rust storage)
          this.servers.set(server.id, server);
        }
        console.log(`Loaded ${bundled.length} bundled servers with fresh configs`);
      } else {
        // No vault path yet - load bundled server definitions for display purposes
        // They'll be properly initialized when a vault is opened
        for (const server of bundledServers) {
          this.servers.set(server.id, { ...server, enabled: false });
        }
        console.log(`Loaded ${bundledServers.length} bundled servers (no vault path yet)`);
      }

      // Sync server.enabled with registry.enabledServers
      // This ensures the two sources of truth are consistent
      for (const [id, config] of this.servers.entries()) {
        config.enabled = this.registry.enabledServers.has(id);
      }

      this.renderServerList();

      // Get current status
      await mcpManager.refreshStatuses();

      // Auto-connect enabled servers (only on first load)
      if (!this.serversLoaded) {
        this.serversLoaded = true;

        // Get current vault path before connecting
        const currentVaultPath = await this.getCurrentVaultPath();

        if (!currentVaultPath) {
          console.warn('⚠️ No vault path available, skipping auto-connect');
        } else {
          // Get bundle path for variable expansion
          const bundlePath = await this._getBundlePath();

          // Auto-connect enabled servers from registry
          for (const serverId of this.registry.enabledServers) {
            try {
              const rawConfig = this._getServerConfig(serverId);
              if (!rawConfig) continue;

              // Expand ${VAULT_PATH} and ${BUNDLE_PATH} variables
              const config = this._expandConfigVariables(rawConfig, currentVaultPath, bundlePath);

              // Set working_dir for stdio transports
              if (config.transport?.type === 'stdio') {
                config.transport.working_dir = currentVaultPath;

                // Bundled servers use working_dir, not VAULT_PATH env
                if (config.builtin && config.transport.env) {
                  delete config.transport.env.VAULT_PATH;
                }
              }

              await mcpManager.connectServer(serverId, config);
            } catch (error) {
              console.error(`Failed to auto-connect server ${serverId}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load MCP settings:', error);
    }
  }

  /**
   * Render the server list using the new registry architecture
   * @returns {string} HTML string for server list
   */
  renderServerList() {
    const listContainer = this.container.querySelector('#mcp-servers-list');
    if (!listContainer) return '';

    // Get all servers from registry (both bundled and user)
    const allServers = this._getAllServersFromRegistry();

    if (allServers.length === 0) {
      const emptyHtml = `
        <div class="empty-state">
          <p>No MCP servers configured yet.</p>
          <button class="primary-button" id="add-first-server-btn">
            <span>➕</span> Add Your First Server
          </button>
        </div>
      `;
      listContainer.innerHTML = emptyHtml;
      const addFirstServerBtn = listContainer.querySelector('#add-first-server-btn');
      if (addFirstServerBtn) {
        addFirstServerBtn.addEventListener('click', () => {
          this.showAddServerDialog();
        });
      }
      return emptyHtml;
    }

    // Build server cards HTML
    const serverCardsHtml = allServers.map(({ name, config }) => {
      const isEnabled = this.registry.enabledServers.has(name);
      const isUserServer = !config.builtin;

      // Get status from mcpManager
      const currentStatus = mcpManager.status.get(name);
      let status = 'disconnected';
      if (typeof currentStatus === 'object' && currentStatus.status) {
        status = currentStatus.status.toLowerCase();
      } else if (typeof currentStatus === 'string') {
        status = currentStatus.toLowerCase();
      }

      // Get capabilities count if available
      const caps = this.serverCapabilities.get(name);
      const capsText = caps ? `${caps.toolsCount} tools` : '';

      // Check if this server is expanded
      const isExpanded = this.expandedServers?.has(name) || false;

      return `
        <div class="mcp-server-card ${isExpanded ? 'expanded' : ''}" data-server-name="${name}">
          <div class="server-card-header"
               role="button"
               tabindex="0"
               aria-expanded="${isExpanded}"
               aria-controls="server-details-${name}">
            <div class="server-status-indicator ${isEnabled ? status : 'disabled'}"
                 title="${isEnabled ? this.formatStatus(status) : 'Disabled'}"></div>
            <div class="server-info">
              <div class="server-display-name">${config.displayName || name}</div>
              <div class="server-description">
                ${config.description || 'No description'}
                ${status === 'connected' && capsText ? ` · <span class="caps-badge">${capsText}</span>` : ''}
              </div>
            </div>
            <div class="server-controls">
              <label class="server-toggle" title="Enable/Disable Server">
                <input
                  type="checkbox"
                  class="server-toggle-checkbox"
                  data-server-name="${name}"
                  ${isEnabled ? 'checked' : ''}
                >
                <span class="toggle-slider"></span>
              </label>
            </div>
            <span class="expand-chevron" title="Click to ${isExpanded ? 'collapse' : 'expand'}">${isExpanded ? '▼' : '▶'}</span>
          </div>
          <div class="server-details-panel"
               id="server-details-${name}"
               style="display: ${isExpanded ? 'block' : 'none'}">
            <div class="server-details-content">
              ${this._renderServerDetails(name, config, status)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add "Add Custom Server" button
    const html = `
      ${serverCardsHtml}
      <div class="add-server-container">
        <button class="add-custom-server-btn" id="add-custom-server-btn">
          <span class="add-icon">➕</span>
          <span class="add-text">Add Custom Server</span>
        </button>
      </div>
    `;

    listContainer.innerHTML = html;

    // Attach event listeners to toggles and remove buttons
    this._attachServerListEventListeners(listContainer);

    return html;
  }

  /**
   * Render server details panel content
   * @private
   */
  _renderServerDetails(serverName, config, status) {
    // Get legacy server config if available (has more details)
    const legacyConfig = this.servers.get(serverName);
    const transport = legacyConfig?.transport || config;

    // Determine command info
    let commandInfo = '';
    if (config.command || transport?.command) {
      const cmd = config.command || transport.command;
      const args = config.args || transport?.args || [];
      commandInfo = `
        <div class="detail-row">
          <span class="detail-label">Command:</span>
          <code class="detail-value">${cmd}</code>
        </div>
        ${args.length > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Args:</span>
          <code class="detail-value">${args.join(' ')}</code>
        </div>
        ` : ''}
      `;
    } else if (transport?.url) {
      commandInfo = `
        <div class="detail-row">
          <span class="detail-label">URL:</span>
          <code class="detail-value">${transport.url}</code>
        </div>
      `;
    }

    // Get tools/resources if connected
    const caps = this.serverCapabilities.get(serverName);
    let toolsSection = '';
    if (status === 'connected' && caps) {
      toolsSection = `
        <div class="detail-section">
          <div class="detail-section-header">Capabilities</div>
          <div class="capabilities-grid">
            <div class="capability-item">
              <span class="capability-icon">🔧</span>
              <span class="capability-count">${caps.toolsCount}</span>
              <span class="capability-label">Tools</span>
            </div>
            <div class="capability-item">
              <span class="capability-icon">📦</span>
              <span class="capability-count">${caps.resourcesCount || 0}</span>
              <span class="capability-label">Resources</span>
            </div>
          </div>
        </div>
      `;
    }

    // Test result placeholder
    const testResultId = `test-result-${serverName}`;

    return `
      <div class="detail-section">
        <div class="detail-section-header">Configuration</div>
        ${commandInfo}
        <div class="detail-row">
          <span class="detail-label">Status:</span>
          <span class="detail-value status-${status}">${this.formatStatus(status)}</span>
        </div>
      </div>
      ${toolsSection}
      <div class="detail-actions">
        <button class="detail-action-btn" data-action="edit" data-server-name="${serverName}">
          ⚙️ Settings
        </button>
        <button class="detail-action-btn test-btn" data-action="test-inline" data-server-name="${serverName}">
          🧪 Test Connection
        </button>
        ${status === 'connected' ? `
        <button class="detail-action-btn" data-action="view-tools" data-server-name="${serverName}">
          🔧 View Tools
        </button>
        ` : ''}
      </div>
      <div class="test-result-inline" id="${testResultId}"></div>
    `;
  }

  /**
   * Get all servers from registry (bundled + user)
   * @private
   * @returns {Array<{name: string, config: ServerConfig}>}
   */
  _getAllServersFromRegistry() {
    const servers = [];

    // Add all servers from this.servers map (contains bundled servers from bundledServers.js)
    for (const [name, config] of this.servers.entries()) {
      servers.push({ name, config });
    }

    // Add user servers from registry that aren't already in this.servers
    for (const [name, config] of this.registry.userServers.entries()) {
      if (!this.servers.has(name)) {
        servers.push({ name, config });
      }
    }

    return servers;
  }

  /**
   * Expand ${VAULT_PATH} and ${BUNDLE_PATH} variables in a config
   * @private
   * @param {Object} config - Server config to expand
   * @param {string} vaultPath - Current vault path
   * @param {string} bundlePath - Bundle resources path
   * @returns {Object} Config with expanded variables
   */
  _expandConfigVariables(config, vaultPath, bundlePath) {
    const expanded = JSON.parse(JSON.stringify(config)); // Deep clone

    const expand = (str) => {
      if (typeof str !== 'string') return str;
      return str
        .replace(/\$\{VAULT_PATH\}/g, vaultPath || '')
        .replace(/\$\{BUNDLE_PATH\}/g, bundlePath || '');
    };

    // Expand transport fields
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
   * Get bundle path from Tauri
   * @private
   * @returns {Promise<string>} Bundle path
   */
  async _getBundlePath() {
    try {
      return await invoke('get_bundle_path');
    } catch (error) {
      console.error('[MCPSettingsPanel] Failed to get bundle path:', error);
      return '';
    }
  }

  /**
   * Get server config from the appropriate source
   * Prefers this.servers (loaded from bundledServers.js with correct paths) over registry
   * @private
   * @param {string} serverId - Server identifier
   * @returns {Object|null} Server config or null if not found
   */
  _getServerConfig(serverId) {
    // Check this.servers FIRST - contains correct configs from bundledServers.js
    // with working paths (no unexpanded ${BUNDLE_PATH} variables)
    const serverConfig = this.servers.get(serverId);
    if (serverConfig) {
      return {
        ...serverConfig,
        enabled: this.registry.enabledServers.has(serverId),
        permissions: serverConfig.permissions || {
          read: true,
          write: serverConfig.builtin !== false,
          delete: false,
          external_access: false
        },
        capabilities: serverConfig.capabilities || {
          tools: true,
          resources: false,
          prompts: false,
          sampling: false
        }
      };
    }

    // Check user servers in registry (for user-added servers not in this.servers)
    if (this.registry.userServers.has(serverId)) {
      const userServer = this.registry.userServers.get(serverId);
      return {
        ...userServer,
        enabled: this.registry.enabledServers.has(serverId),
        permissions: userServer.permissions || {
          read: true,
          write: false,
          delete: false,
          external_access: false
        },
        capabilities: userServer.capabilities || {
          tools: true,
          resources: false,
          prompts: false,
          sampling: false
        }
      };
    }

    // Not found in servers map or registry
    return null;
  }

  /**
   * Attach event listeners to server list elements
   * @private
   * @param {HTMLElement} listContainer - The server list container
   */
  _attachServerListEventListeners(listContainer) {
    // Initialize expanded servers set if not exists
    if (!this.expandedServers) {
      this.expandedServers = new Set();
    }

    // Clickable server card headers (for expand/collapse)
    const cardHeaders = listContainer.querySelectorAll('.server-card-header');
    cardHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        // Don't toggle if clicking on controls
        if (e.target.closest('.server-controls')) return;

        const card = header.closest('.mcp-server-card');
        const serverName = card.dataset.serverName;
        this._toggleServerExpand(serverName);
      });

      // Keyboard accessibility
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const card = header.closest('.mcp-server-card');
          const serverName = card.dataset.serverName;
          this._toggleServerExpand(serverName);
        }
      });
    });

    // Toggle switches
    const toggles = listContainer.querySelectorAll('.server-toggle-checkbox');
    toggles.forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const serverName = e.target.dataset.serverName;
        const enabled = e.target.checked;
        this.handleToggle(serverName, enabled);
      });
    });

    // Detail action buttons
    const detailActionBtns = listContainer.querySelectorAll('.detail-action-btn');
    detailActionBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.dataset.action;
        const serverName = btn.dataset.serverName;

        switch (action) {
          case 'edit':
            this.showEditServerDialog(serverName);
            break;
          case 'test-inline':
            await this._handleInlineTest(serverName, btn);
            break;
          case 'view-tools':
            await this._showToolsDialog(serverName);
            break;
        }
      });
    });

    // Add Custom Server button
    const addBtn = listContainer.querySelector('#add-custom-server-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.showAddServerDialog();
      });
    }
  }

  /**
   * Toggle server card expand/collapse
   * @private
   */
  _toggleServerExpand(serverName) {
    if (!this.expandedServers) {
      this.expandedServers = new Set();
    }

    if (this.expandedServers.has(serverName)) {
      this.expandedServers.delete(serverName);
    } else {
      this.expandedServers.add(serverName);
      // Update capabilities when expanding
      this.updateServerCapabilities(serverName);
    }

    // Re-render to update UI - use requestAnimationFrame to ensure DOM update
    requestAnimationFrame(() => {
      this.renderServerList();
    });
  }

  /**
   * Handle inline test for a server
   * @private
   */
  async _handleInlineTest(serverName, button) {
    const testResultEl = document.getElementById(`test-result-${serverName}`);
    const originalText = button.textContent;

    // Update button state
    button.disabled = true;
    button.textContent = '⏳ Testing...';

    // Show result area
    if (testResultEl) {
      testResultEl.style.display = 'block';
      testResultEl.innerHTML = '<div class="test-loading">Testing connection...</div>';
    }

    try {
      // Get server config using helper
      const server = this._getServerConfig(serverName);
      if (!server) {
        throw new Error('Server configuration not found');
      }

      // Check if already connected
      const currentStatus = mcpManager.status.get(serverName);
      const wasConnected = currentStatus === 'connected' ||
        (typeof currentStatus === 'object' && currentStatus.status === 'connected');

      if (!wasConnected) {
        // Connect for testing
        const vaultPath = await this.getCurrentVaultPath();
        const bundlePath = await this._getBundlePath();

        // Expand ${VAULT_PATH} and ${BUNDLE_PATH} variables
        let testConfig = this._expandConfigVariables(server, vaultPath, bundlePath);

        if (testConfig.transport?.type === 'stdio' && vaultPath) {
          testConfig.transport.working_dir = vaultPath;
          // Bundled servers are Rust binaries that use working_dir, not VAULT_PATH env
          if (testConfig.builtin && testConfig.transport.env) {
            delete testConfig.transport.env.VAULT_PATH;
          }
        }

        await mcpManager.connectServer(serverName, testConfig);

        // Wait for connection
        let connected = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const status = mcpManager.status.get(serverName);
          if (status === 'connected' || (typeof status === 'object' && status.status === 'connected')) {
            connected = true;
            break;
          }
        }

        if (!connected) {
          throw new Error('Connection timeout');
        }
      }

      // Test the connection
      const tools = await mcpManager.listTools(serverName);
      let resources = [];
      try {
        resources = await mcpManager.listResources(serverName);
      } catch (e) {
        // Resources might not be supported
      }

      // Update capabilities
      this.serverCapabilities.set(serverName, {
        toolsCount: tools.length,
        resourcesCount: resources.length
      });

      // Show success
      if (testResultEl) {
        testResultEl.innerHTML = `
          <div class="test-success">
            ✅ Connection successful!
            <div class="test-details">Found ${tools.length} tools and ${resources.length} resources</div>
          </div>
        `;
      }

      // Disconnect if we connected for testing
      if (!wasConnected) {
        await mcpManager.disconnectServer(serverName);
      }

      // Refresh UI to show updated status
      setTimeout(() => this.renderServerList(), 1500);

    } catch (error) {
      if (testResultEl) {
        testResultEl.innerHTML = `
          <div class="test-error">
            ❌ Test failed: ${error.message}
          </div>
        `;
      }
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /**
   * Show tools dialog for a server
   * @private
   */
  async _showToolsDialog(serverName) {
    try {
      const tools = await mcpManager.listTools(serverName);
      let resources = [];
      try {
        resources = await mcpManager.listResources(serverName);
      } catch (e) {
        // Resources might not be supported
      }

      // Create modal
      const overlay = document.createElement('div');
      overlay.className = 'tools-dialog-overlay';

      const toolsHtml = tools.map(tool => `
        <div class="tool-item">
          <div class="tool-name">${tool.name}</div>
          <div class="tool-description">${tool.description || 'No description'}</div>
        </div>
      `).join('');

      const resourcesHtml = resources.map(resource => `
        <div class="tool-item">
          <div class="tool-name">${resource.name || resource.uri}</div>
          <div class="tool-description">${resource.description || resource.mimeType || 'No description'}</div>
        </div>
      `).join('');

      overlay.innerHTML = `
        <div class="tools-dialog">
          <div class="tools-dialog-header">
            <h3>Tools & Resources - ${serverName}</h3>
            <button class="close-button" data-action="close-tools-dialog">✕</button>
          </div>
          <div class="tools-dialog-content">
            ${tools.length > 0 ? `
              <div class="tools-section">
                <h4>🔧 Tools (${tools.length})</h4>
                <div class="tools-grid">${toolsHtml}</div>
              </div>
            ` : ''}
            ${resources.length > 0 ? `
              <div class="tools-section">
                <h4>📦 Resources (${resources.length})</h4>
                <div class="tools-grid">${resourcesHtml}</div>
              </div>
            ` : ''}
            ${tools.length === 0 && resources.length === 0 ? `
              <div class="empty-tools">No tools or resources available</div>
            ` : ''}
          </div>
        </div>
      `;

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

      const closeBtn = overlay.querySelector('[data-action="close-tools-dialog"]');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          overlay.remove();
        });
      }

      document.body.appendChild(overlay);
    } catch (error) {
      this.showNotification(`Failed to load tools: ${error.message}`, 'error');
    }
  }

  /**
   * Handle server toggle (enable/disable)
   * @param {string} serverName - Server identifier
   * @param {boolean} enabled - Enable (true) or disable (false)
   */
  async handleToggle(serverName, enabled) {
    console.log(`[MCPSettingsPanel] Toggling server ${serverName} to ${enabled}`);

    try {
      // Update registry state
      this.registry.setServerEnabled(serverName, enabled);

      // Also update the server config in this.servers to keep in sync
      const serverConfig = this.servers.get(serverName);
      if (serverConfig) {
        serverConfig.enabled = enabled;
        this.servers.set(serverName, serverConfig);
      }

      // Persist to settings
      await this.saveRegistry();

      // Re-render to reflect changes
      this.renderServerList();

      // Show notification
      const action = enabled ? 'enabled' : 'disabled';
      this.showNotification(`Server ${serverName} ${action}`, 'info');
    } catch (error) {
      console.error(`[MCPSettingsPanel] Failed to toggle server ${serverName}:`, error);
      // Revert the change in UI
      this.renderServerList();
    }
  }

  /**
   * Handle server removal
   * @param {string} serverName - Server identifier to remove
   */
  async handleRemove(serverName) {
    console.log(`[MCPSettingsPanel] Removing server ${serverName}`);

    // Confirm with user
    if (!confirm(`Are you sure you want to remove server "${serverName}"?`)) {
      return;
    }

    try {
      // Remove from registry
      this.registry.removeUserServer(serverName);

      // Persist to settings
      await this.saveRegistry();

      // Re-render to reflect changes
      this.renderServerList();

      // Show notification
      this.showNotification(`Server ${serverName} removed`, 'info');
    } catch (error) {
      console.error(`[MCPSettingsPanel] Failed to remove server ${serverName}:`, error);
      // Reload registry from settings to revert
      await this.loadRegistry();
      this.renderServerList();
    }
  }

  /**
   * Load registry state from settings
   * @private
   * @returns {Promise<void>}
   */
  async loadRegistry() {
    try {
      console.log('[MCPSettingsPanel] Loading registry from settings...');

      // Get MCP settings from Tauri
      const settings = await invoke('get_mcp_settings');

      // Check if registry data exists
      if (settings.mcpServerRegistry) {
        console.log('[MCPSettingsPanel] Restoring registry from saved state:', settings.mcpServerRegistry);
        this.registry = MCPServerRegistry.fromJSON(settings.mcpServerRegistry);
      } else {
        console.log('[MCPSettingsPanel] No saved registry found, using default registry');
        this.registry = new MCPServerRegistry();
      }

      console.log('[MCPSettingsPanel] Registry loaded successfully');
    } catch (error) {
      console.error('[MCPSettingsPanel] Failed to load registry:', error);
      // Fall back to empty registry on error
      this.registry = new MCPServerRegistry();
      this.showNotification('Failed to load server settings, using defaults', 'warning');
    }
  }

  /**
   * Save registry state to settings
   * @private
   * @returns {Promise<void>}
   */
  async saveRegistry() {
    try {
      console.log('[MCPSettingsPanel] Saving registry to settings...');

      // Serialize registry to JSON
      const registryData = this.registry.toJSON();
      console.log('[MCPSettingsPanel] Registry data to save:', registryData);

      // Get current MCP settings
      const settings = await invoke('get_mcp_settings');

      // Add registry data to settings
      settings.mcpServerRegistry = registryData;

      // Save back to Tauri store
      await invoke('save_mcp_settings', { settings });

      console.log('[MCPSettingsPanel] Registry saved successfully');

      // Emit config updated event
      this.emitConfigUpdated();
    } catch (error) {
      console.error('[MCPSettingsPanel] Failed to save registry:', error);
      this.showNotification('Failed to save settings', 'error');
      throw error;
    }
  }

  /**
   * Emit config updated event to notify other components
   * @private
   */
  emitConfigUpdated() {
    console.log('[MCPSettingsPanel] Emitting mcp-config-updated event');

    // Get list of enabled server names
    const enabledServers = Array.from(this.registry.enabledServers);

    // Create event payload
    const detail = {
      enabledServers: enabledServers,
      requiresRestart: true // MCP config changes always require CLI restart
    };

    // Dispatch custom event
    const event = new CustomEvent('mcp-config-updated', { detail });
    window.dispatchEvent(event);

    console.log('[MCPSettingsPanel] Event dispatched with payload:', detail);
  }

  /**
   * Legacy method - now calls saveRegistry()
   * @private
   * @deprecated Use saveRegistry() instead
   */
  async _saveRegistryToSettings() {
    return this.saveRegistry();
  }

  /**
   * Legacy renderServerList implementation (keeping for backward compatibility)
   * This will be removed once full migration to registry is complete
   * @deprecated Use the new renderServerList() with registry instead
   */
  _renderServerListLegacy() {
    const listContainer = this.container.querySelector('#mcp-servers-list');
    if (!listContainer) return;

    if (this.servers.size === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <p>No MCP servers configured yet.</p>
          <button class="primary-button" id="add-first-server-btn">
            <span>➕</span> Add Your First Server
          </button>
        </div>
      `;
      const addFirstServerBtn = listContainer.querySelector('#add-first-server-btn');
      if (addFirstServerBtn) {
        addFirstServerBtn.addEventListener('click', () => {
          this.showAddServerDialog();
        });
      }
      return;
    }
    
    const serverItems = Array.from(this.servers.entries()).map(([id, server]) => {
      // Get the actual current status from mcpManager
      const currentStatus = mcpManager.status.get(id);
      let status;
      
      // Handle both string and object status formats
      if (typeof currentStatus === 'object' && currentStatus.status) {
        status = currentStatus.status.toLowerCase();
      } else if (typeof currentStatus === 'string') {
        status = currentStatus.toLowerCase();
      } else {
        status = 'disconnected';
      }
      
      const statusClass = server.enabled ? status : 'disabled';
      
      // Get stored capabilities count
      const storedCaps = this.serverCapabilities.get(id);
      let capsText = '';
      if (status === 'connected') {
        if (storedCaps) {
          capsText = ` | ${storedCaps.toolsCount} Tools${storedCaps.resourcesCount > 0 ? `, ${storedCaps.resourcesCount} Resources` : ''}`;
        } else {
          capsText = ' | Loading...';
        }
      } else {
        capsText = ` | ${server.capabilities.tools ? 'Tools' : ''} ${server.capabilities.resources ? 'Resources' : ''}`.trim();
        if (capsText) capsText = ' | ' + capsText;
      }
      
      return `
        <div class="mcp-server-item" data-server-id="${id}">
          <div class="server-header">
            <div class="server-status ${statusClass}"></div>
            <div class="server-info">
              <div class="server-name">${server.name}</div>
              <div class="server-details">
                <span class="status-text">Status: ${this.formatStatus(statusClass)}</span>
                <span class="capabilities-text" id="caps-${id}">${capsText}</span>
              </div>
              ${status === 'connected' ? `
                <button class="expand-tools-btn" title="Show/Hide Tools" data-action="expand" data-server-id="${id}">
                  <span class="expand-icon">▶</span>
                  <span class="expand-text">Show Tools & Resources</span>
                </button>
              ` : ''}
            </div>
            <div class="server-actions">
              <label class="server-toggle" title="Enable/Disable Server">
                <input type="checkbox" 
                  class="server-enabled-checkbox" 
                  data-server-id="${id}" 
                  ${server.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <button class="server-action-btn" title="Settings" data-action="settings" data-server-id="${id}">⚙️</button>
              <button class="server-action-btn" title="Test Connection" data-action="test" data-server-id="${id}">🧪</button>
              <button class="server-action-btn" title="Delete" data-action="delete" data-server-id="${id}">🗑️</button>
            </div>
          </div>
          <div class="server-tools-list" id="tools-${id}" style="display: none;">
            <div class="tools-loading">Loading tools...</div>
          </div>
        </div>
      `;
    }).join('');
    
    listContainer.innerHTML = serverItems;
    
    // Add action listeners
    listContainer.querySelectorAll('.server-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        const serverId = e.currentTarget.dataset.serverId;
        this.handleServerAction(action, serverId);
      });
    });
    
    // Add expand button listeners
    listContainer.querySelectorAll('.expand-tools-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const serverId = e.currentTarget.dataset.serverId;
        this.handleServerAction('expand', serverId);
      });
    });
    
    // Add toggle listeners for enable/disable
    listContainer.querySelectorAll('.server-enabled-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', async (e) => {
        const serverId = e.currentTarget.dataset.serverId;
        const enabled = e.currentTarget.checked;
        await this.toggleServerEnabled(serverId, enabled);
      });
    });
  }

  /**
   * Format status for display
   */
  formatStatus(status) {
    const statusMap = {
      connected: '● Connected',
      disconnected: '○ Disconnected',
      connecting: '◐ Connecting',
      disabled: '○ Disabled',
      error: '⚠️ Error'
    };
    return statusMap[status] || status;
  }

  /**
   * Handle server action
   */
  async handleServerAction(action, serverId) {
    switch (action) {
      case 'expand':
        await this.toggleServerTools(serverId);
        break;
      case 'settings':
        this.showEditServerDialog(serverId);
        break;
      case 'test':
        await this.testServerConnection(serverId);
        break;
      case 'delete':
        await this.deleteServer(serverId);
        break;
    }
  }

  /**
   * Toggle server enabled/disabled state
   */
  async toggleServerEnabled(serverId, enabled) {

    const server = this._getServerConfig(serverId);
    if (!server) {
      console.error(`[MCPSettingsPanel] Server not found: ${serverId}`);
      return;
    }

    // Update the server configuration
    server.enabled = enabled;

    // Update registry enabled state
    this.registry.setServerEnabled(serverId, enabled);
    await this.saveRegistry();

    // IMPORTANT: Don't save bundled server configs to Rust storage!
    // Bundled servers should ONLY come from bundledServers.js at runtime.
    // Only save user-defined (non-bundled) servers to storage.
    const bundledIds = getBundledServerIds();
    if (!bundledIds.includes(serverId)) {
      await this.saveConfiguration(serverId, server);
    } else {
      console.log(`[MCPSettingsPanel] Skipping save for bundled server: ${serverId} (enabled=${enabled})`);
    }
    
    // Connect or disconnect based on enabled state
    if (enabled) {
      try {
        // Get current vault path and bundle path
        const vaultPath = await this.getCurrentVaultPath();
        if (!vaultPath) {
          throw new Error('No vault path available - please open a vault first');
        }
        const bundlePath = await this._getBundlePath();

        // Expand ${VAULT_PATH} and ${BUNDLE_PATH} variables
        const expandedConfig = this._expandConfigVariables(server, vaultPath, bundlePath);

        // CRITICAL: Set working_dir for ALL stdio transports to current vault
        if (expandedConfig.transport?.type === 'stdio') {
          expandedConfig.transport.working_dir = vaultPath;
          console.log(`🔧 [toggleServer] Setting working_dir for ${serverId} to: ${vaultPath}`);

          // Bundled servers are Rust binaries that use working_dir, not VAULT_PATH env
          if (expandedConfig.builtin && expandedConfig.transport.env) {
            delete expandedConfig.transport.env.VAULT_PATH;
          }
        }

        await mcpManager.connectServer(serverId, expandedConfig);
      } catch (error) {
        console.error(`[MCPSettingsPanel] Failed to connect server ${serverId}:`, error);
        this.showNotification(`Failed to connect ${server.name}: ${error}`, 'error');
        // Reset the toggle
        const checkbox = document.querySelector(`.server-enabled-checkbox[data-server-id="${serverId}"]`);
        if (checkbox) checkbox.checked = false;
        server.enabled = false;
        // Update registry and save (but don't save bundled server config to storage)
        this.registry.setServerEnabled(serverId, false);
        await this.saveRegistry();
        if (!getBundledServerIds().includes(serverId)) {
          await this.saveConfiguration(serverId, server);
        }
      }
    } else {
      try {
        await mcpManager.disconnectServer(serverId);
      } catch (error) {
        console.error(`[MCPSettingsPanel] Failed to disconnect server ${serverId}:`, error);
      }
    }
  }
  
  /**
   * Toggle the tools list for a server
   */
  async toggleServerTools(serverId) {
    console.log(`[MCPSettingsPanel] Toggling tools for server: ${serverId}`);
    
    const toolsDiv = document.getElementById(`tools-${serverId}`);
    const expandBtn = document.querySelector(`[data-action="expand"][data-server-id="${serverId}"]`);
    const expandIcon = expandBtn?.querySelector('.expand-icon');
    const expandText = expandBtn?.querySelector('.expand-text');
    
    if (!toolsDiv) {
      console.error(`[MCPSettingsPanel] Tools div not found for server: ${serverId}`);
      return;
    }
    
    const isHidden = toolsDiv.style.display === 'none';
    console.log(`[MCPSettingsPanel] Tools currently hidden: ${isHidden}`);
    
    if (isHidden) {
      // Show tools
      toolsDiv.style.display = 'block';
      if (expandBtn) {
        expandBtn.setAttribute('data-expanded', 'true');
        if (expandText) expandText.textContent = 'Hide Tools & Resources';
      }
      
      // Load tools if not already loaded
      if (toolsDiv.querySelector('.tools-loading')) {
        console.log(`[MCPSettingsPanel] Loading tools for ${serverId}...`);
        await this.loadServerTools(serverId);
      }
    } else {
      // Hide tools
      toolsDiv.style.display = 'none';
      if (expandBtn) {
        expandBtn.setAttribute('data-expanded', 'false');
        if (expandText) expandText.textContent = 'Show Tools & Resources';
      }
    }
  }
  
  /**
   * Load and display tools for a server
   */
  async loadServerTools(serverId) {
    const toolsDiv = document.getElementById(`tools-${serverId}`);
    if (!toolsDiv) return;
    
    try {
      // Check if server is connected
      const currentStatus = mcpManager.status.get(serverId);
      let isConnected = false;
      
      if (typeof currentStatus === 'object' && currentStatus.status) {
        isConnected = currentStatus.status.toLowerCase() === 'connected';
      } else if (typeof currentStatus === 'string') {
        isConnected = currentStatus.toLowerCase() === 'connected';
      }
      
      if (!isConnected) {
        toolsDiv.innerHTML = '<div class="no-tools">Server not connected</div>';
        return;
      }
      
      // Get tools from the server
      const tools = await mcpManager.getServerTools(serverId);
      const resources = await mcpManager.getServerResources(serverId);
      
      if (!tools.length && !resources.length) {
        toolsDiv.innerHTML = '<div class="no-tools">No tools or resources available</div>';
        return;
      }
      
      // Build tools HTML
      let html = '';
      
      if (tools.length > 0) {
        html += '<div class="tools-section">';
        html += `<div class="tools-section-header">🔧 Tools (${tools.length})</div>`;
        html += '<div class="tools-grid">';
        
        tools.forEach(tool => {
          html += `
            <div class="tool-item" title="${tool.description || 'No description'}">
              <div class="tool-name">${tool.name}</div>
              ${tool.description ? `<div class="tool-description">${tool.description}</div>` : ''}
            </div>
          `;
        });
        
        html += '</div></div>';
      }
      
      if (resources.length > 0) {
        html += '<div class="tools-section">';
        html += `<div class="tools-section-header">📦 Resources (${resources.length})</div>`;
        html += '<div class="tools-grid">';
        
        resources.forEach(resource => {
          html += `
            <div class="tool-item" title="${resource.description || 'No description'}">
              <div class="tool-name">${resource.name}</div>
              ${resource.description ? `<div class="tool-description">${resource.description}</div>` : ''}
            </div>
          `;
        });
        
        html += '</div></div>';
      }
      
      toolsDiv.innerHTML = html;
      
    } catch (error) {
      console.error(`Failed to load tools for ${serverId}:`, error);
      toolsDiv.innerHTML = '<div class="error">Failed to load tools</div>';
    }
  }

  /**
   * Update capabilities display for all connected servers
   */
  async updateAllServerCapabilities() {
    console.log('[MCPSettingsPanel] Updating capabilities for all connected servers');
    
    for (const [serverId, server] of this.servers.entries()) {
      const currentStatus = mcpManager.status.get(serverId);
      let isConnected = false;
      
      // Check if server is connected
      if (typeof currentStatus === 'object' && currentStatus.status) {
        isConnected = currentStatus.status.toLowerCase() === 'connected';
      } else if (typeof currentStatus === 'string') {
        isConnected = currentStatus.toLowerCase() === 'connected';
      }
      
      if (isConnected) {
        await this.updateServerCapabilities(serverId);
      }
    }
  }
  
  /**
   * Update capabilities display for a specific server
   */
  async updateServerCapabilities(serverId) {
    try {
      const capsElement = document.getElementById(`caps-${serverId}`);
      if (!capsElement) return;
      
      // Double-check server is still connected
      const currentStatus = mcpManager.status.get(serverId);
      let isConnected = false;
      
      if (typeof currentStatus === 'object' && currentStatus.status) {
        isConnected = currentStatus.status.toLowerCase() === 'connected';
      } else if (typeof currentStatus === 'string') {
        isConnected = currentStatus.toLowerCase() === 'connected';
      }
      
      if (!isConnected) {
        console.log(`[MCPSettingsPanel] Server ${serverId} is not connected, skipping capabilities`);
        return;
      }
      
      // Get tool and resource counts
      console.log(`[MCPSettingsPanel] Fetching capabilities for ${serverId}...`);
      
      let tools = [];
      let resources = [];
      
      try {
        tools = await mcpManager.listTools(serverId);
        console.log(`[MCPSettingsPanel] Got ${tools.length} tools for ${serverId}`);
      } catch (err) {
        console.error(`[MCPSettingsPanel] Failed to list tools for ${serverId}:`, err);
      }
      
      try {
        resources = await mcpManager.listResources(serverId);
        console.log(`[MCPSettingsPanel] Got ${resources.length} resources for ${serverId}`);
      } catch (err) {
        // Resources might not be supported by all servers
        console.log(`[MCPSettingsPanel] No resources for ${serverId} (might not be supported)`);
      }
      
      // Store capabilities count
      this.serverCapabilities.set(serverId, {
        toolsCount: tools.length,
        resourcesCount: resources.length
      });
      
      // Format the display
      const parts = [];
      if (tools.length > 0 || resources.length > 0) {
        if (tools.length > 0) parts.push(`${tools.length} Tools`);
        if (resources.length > 0) parts.push(`${resources.length} Resources`);
        capsElement.textContent = ` | ${parts.join(', ')}`;
      } else {
        capsElement.textContent = ' | No capabilities';
      }
      
      console.log(`[MCPSettingsPanel] Updated ${serverId}: ${capsElement.textContent}`);
    } catch (error) {
      console.error(`[MCPSettingsPanel] Failed to update capabilities for ${serverId}:`, error);
    }
  }

  /**
   * Update server status in UI
   */
  updateServerStatus(serverId, status) {
    console.log(`[MCPSettingsPanel] Updating server status: ${serverId} -> ${status}`);

    if (!this.container) {
      console.error(`[MCPSettingsPanel] Container is null, cannot update status`);
      return;
    }

    // Cards use data-server-name attribute
    const serverItem = this.container.querySelector(`[data-server-name="${serverId}"]`);
    if (!serverItem) {
      // Panel might be hidden, just log and skip
      console.log(`[MCPSettingsPanel] Server card not found for ${serverId} (panel may be hidden)`);
      return;
    }

    // Update the status indicator dot
    const statusIndicator = serverItem.querySelector('.server-status-indicator');
    if (statusIndicator) {
      // Remove old status classes
      statusIndicator.classList.remove('connected', 'disconnected', 'connecting', 'error', 'stopped');
      // Add new status class
      statusIndicator.classList.add(status.toLowerCase());
      statusIndicator.title = this.formatStatus(status);
      console.log(`[MCPSettingsPanel] Updated status indicator for ${serverId} to: ${status}`);
    }

    // Update status text in details panel if expanded
    const statusValueEl = serverItem.querySelector('.detail-value.status-connected, .detail-value.status-disconnected, .detail-value.status-error, .detail-value.status-connecting');
    if (statusValueEl) {
      statusValueEl.className = `detail-value status-${status.toLowerCase()}`;
      statusValueEl.textContent = this.formatStatus(status);
    }
  }

  /**
   * Show add server dialog using the full ServerConfigDialog (supports stdio and HTTP)
   */
  showAddServerDialog() {
    console.log('[MCPSettingsPanel] Opening Add Custom Server dialog');

    serverConfigDialog.show(null, async (config) => {
      try {
        // Generate a unique server ID from the name
        const serverId = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        console.log('[MCPSettingsPanel] Adding server:', serverId, config);

        // Transform config for Rust backend (convert api_key to headers for HTTP)
        let rustConfig = JSON.parse(JSON.stringify(config));
        if (rustConfig.transport?.type === 'http') {
          const headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': '2025-06-18'
          };
          if (rustConfig.transport.api_key) {
            headers['Authorization'] = `Bearer ${rustConfig.transport.api_key}`;
          }
          rustConfig.transport = {
            type: 'http',
            url: rustConfig.transport.url,
            headers: headers
          };
        }

        // Build server config for registry
        const serverConfig = {
          type: rustConfig.transport.type,
          displayName: config.name,
          description: '',
          command: rustConfig.transport.command || '',
          url: rustConfig.transport.url || '',
          headers: rustConfig.transport.headers || {},
          args: rustConfig.transport.args || [],
          env: rustConfig.transport.env || {}
        };

        // Add to registry
        this.registry.addUserServer(serverId, serverConfig);

        // Enable by default
        this.registry.setServerEnabled(serverId, true);

        // Save to settings
        await this.saveRegistry();

        // Build complete config for Rust backend (must match MCPServerConfig struct)
        const completeConfig = {
          id: serverId,
          name: config.name,
          enabled: config.enabled !== false,
          transport: rustConfig.transport,
          capabilities: config.capabilities || {
            tools: true,
            resources: true,
            prompts: false,
            sampling: false
          },
          permissions: config.permissions || {
            read: true,
            write: false,
            delete: false,
            external_access: false
          }
        };

        // Also save to the legacy servers map for backward compatibility
        this.servers.set(serverId, completeConfig);
        await this.saveConfiguration(serverId, completeConfig);

        // Re-render server list
        this.renderServerList();

        // Show notification
        this.showNotification(`Server "${config.name}" added successfully`, 'success');

      } catch (error) {
        console.error('[MCPSettingsPanel] Failed to add server:', error);
        this.showNotification(`Failed to add server: ${error.message}`, 'error');
      }
    });
  }

  /**
   * Add styles for Add Server dialog
   * @private
   */
  _addAddServerDialogStyles() {
    if (document.getElementById('add-server-dialog-styles')) return;

    const style = document.createElement('style');
    style.id = 'add-server-dialog-styles';
    style.textContent = `
      .add-server-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100002;
        animation: fadeIn 0.2s ease;
      }

      .add-server-dialog {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        width: 500px;
        max-width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        animation: slideIn 0.3s ease;
      }

      .add-server-dialog-header {
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .add-server-dialog-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .add-server-dialog-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }

      .add-server-dialog-footer {
        padding: 20px;
        border-top: 1px solid var(--border-color);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      .add-server-dialog .form-group {
        margin-bottom: 16px;
      }

      .add-server-dialog .form-group label {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
        font-weight: 500;
      }

      .add-server-dialog .form-group input[type="text"],
      .add-server-dialog .form-group textarea {
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        font-size: 13px;
        color: var(--text-primary);
        font-family: inherit;
      }

      .add-server-dialog .form-group textarea {
        resize: vertical;
        font-family: monospace;
      }

      .add-server-dialog .form-group input:focus,
      .add-server-dialog .form-group textarea:focus {
        outline: none;
        border-color: var(--accent-color);
      }

      .add-server-dialog .form-group small {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        color: var(--text-secondary);
      }

      .add-server-dialog .required {
        color: #ef4444;
      }

      .env-var-row {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      .env-var-row input {
        flex: 1;
        padding: 6px 10px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 12px;
        font-family: monospace;
      }

      .env-var-row button {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px 8px;
        font-size: 16px;
      }

      .env-var-row button:hover {
        color: #ef4444;
      }

      .validation-result {
        margin-top: 16px;
        padding: 12px;
        border-radius: 6px;
        font-size: 13px;
      }

      .validation-result.success {
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid #22c55e;
        color: #22c55e;
      }

      .validation-result.error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid #ef4444;
        color: #ef4444;
      }

      .validation-result ul {
        margin: 8px 0 0 0;
        padding-left: 20px;
      }

      .validation-result li {
        margin: 4px 0;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Add environment variable row
   * @private
   */
  _addEnvVarRow() {
    const envList = document.getElementById('add-server-env-list');
    if (!envList) return;

    const row = document.createElement('div');
    row.className = 'env-var-row';
    row.innerHTML = `
      <input type="text" class="env-key" placeholder="KEY" autocomplete="off">
      <input type="text" class="env-value" placeholder="VALUE" autocomplete="off">
      <button class="remove-env-var">✕</button>
    `;

    // Attach remove handler
    const removeBtn = row.querySelector('.remove-env-var');
    removeBtn.onclick = () => row.remove();

    envList.appendChild(row);
  }

  /**
   * Handle server addition from dialog
   * @param {HTMLElement} overlay - Dialog overlay element
   */
  async handleAddServer(overlay) {
    console.log('[MCPSettingsPanel] handleAddServer called');

    try {
      // Get form data
      const name = document.getElementById('add-server-name').value.trim();
      const displayName = document.getElementById('add-server-display-name').value.trim();
      const description = document.getElementById('add-server-description').value.trim();
      const command = document.getElementById('add-server-command').value.trim();
      const argsText = document.getElementById('add-server-args').value.trim();

      // Validate required fields
      if (!name) {
        alert('Server name is required');
        return;
      }

      if (!command) {
        alert('Command is required');
        return;
      }

      // Parse arguments (one per line)
      const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(a => a) : [];

      // Parse environment variables
      const env = {};
      const envRows = document.querySelectorAll('.env-var-row');
      envRows.forEach(row => {
        const key = row.querySelector('.env-key').value.trim();
        const value = row.querySelector('.env-value').value.trim();
        if (key) {
          env[key] = value;
        }
      });

      // Build server config
      const config = {
        type: 'stdio',
        displayName: displayName || name,
        description: description || '',
        command: command,
        args: args,
        env: env
      };

      console.log('[MCPSettingsPanel] Adding server:', name, config);

      // Add to registry
      this.registry.addUserServer(name, config);

      // Enable by default
      this.registry.setServerEnabled(name, true);

      // Save to settings
      await this._saveRegistryToSettings();

      // Close dialog
      overlay.remove();

      // Re-render server list
      this.renderServerList();

      // Show notification
      this.showNotification(`Server "${displayName || name}" added successfully`, 'success');

    } catch (error) {
      console.error('[MCPSettingsPanel] Failed to add server:', error);
      alert(`Failed to add server: ${error.message}`);
    }
  }

  /**
   * Handle test connection from dialog
   * @param {HTMLElement} overlay - Dialog overlay element
   */
  async handleTestConnection(overlay) {
    console.log('[MCPSettingsPanel] handleTestConnection called');

    const validationResult = document.getElementById('validation-result');
    if (!validationResult) return;

    try {
      // Get form data
      const name = document.getElementById('add-server-name').value.trim();
      const command = document.getElementById('add-server-command').value.trim();
      const argsText = document.getElementById('add-server-args').value.trim();

      // Validate required fields
      if (!name) {
        throw new Error('Server name is required');
      }

      if (!command) {
        throw new Error('Command is required');
      }

      // Parse arguments
      const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(a => a) : [];

      // Parse environment variables
      const env = {};
      const envRows = document.querySelectorAll('.env-var-row');
      envRows.forEach(row => {
        const key = row.querySelector('.env-key').value.trim();
        const value = row.querySelector('.env-value').value.trim();
        if (key) {
          env[key] = value;
        }
      });

      // Build server config for validation
      const config = {
        type: 'stdio',
        command: command,
        args: args,
        env: env
      };

      // Show testing message
      validationResult.style.display = 'block';
      validationResult.className = 'validation-result';
      validationResult.innerHTML = 'Testing connection...';

      // Call validation command
      const result = await invoke('validate_mcp_server', { name, config });

      console.log('[MCPSettingsPanel] Validation result:', result);

      // Display results
      if (result.valid) {
        validationResult.className = 'validation-result success';
        validationResult.innerHTML = '✓ Server configuration is valid';

        if (result.warnings && result.warnings.length > 0) {
          validationResult.innerHTML += '<ul>' +
            result.warnings.map(w => `<li>${w}</li>`).join('') +
            '</ul>';
        }
      } else {
        validationResult.className = 'validation-result error';
        validationResult.innerHTML = '✗ Validation failed:';

        if (result.errors && result.errors.length > 0) {
          validationResult.innerHTML += '<ul>' +
            result.errors.map(e => `<li>${e}</li>`).join('') +
            '</ul>';
        }
      }

    } catch (error) {
      console.error('[MCPSettingsPanel] Validation error:', error);
      validationResult.style.display = 'block';
      validationResult.className = 'validation-result error';
      validationResult.innerHTML = `✗ Validation failed: ${error.message}`;
    }
  }

  /**
   * Show edit server dialog
   */
  showEditServerDialog(serverId) {
    // Get server config using helper
    const server = this._getServerConfig(serverId);
    if (!server) {
      console.error(`[showEditServerDialog] No config found for ${serverId}`);
      return;
    }
    console.log(`[showEditServerDialog] Using config for ${serverId}:`, server);

    // Ensure the server config has the current enabled state from registry
    server.enabled = this.registry.enabledServers.has(serverId);

    serverConfigDialog.show(
      server,
      async (config) => {
        // Update the configuration
        this.servers.set(serverId, config);

        // Sync enabled state with registry
        this.registry.setServerEnabled(serverId, config.enabled);

        // Save to persistent storage
        await this.saveConfiguration(serverId, config);
        await this.saveRegistry();

        // Re-render the list
        this.renderServerList();

        // Show success notification
        this.showNotification(`Updated server: ${config.name}`, 'success');

        // If status changed, handle connection
        const currentStatus = mcpManager.status.get(serverId);

        if (!config.enabled && (currentStatus === 'connected' || currentStatus === 'error')) {
          // Disconnect if disabling
          try {
            await mcpManager.disconnectServer(serverId);
          } catch (error) {
            console.log('Error disconnecting:', error);
          }
        } else if (config.enabled && currentStatus === 'disconnected') {
          // Connect if enabling and currently disconnected
          try {
            // CRITICAL: Set working_dir for stdio transports to current vault
            const vaultPath = await this.getCurrentVaultPath();
            const bundlePath = await this._getBundlePath();

            // Expand variables in config before connecting
            let connectConfig = this._expandConfigVariables(config, vaultPath, bundlePath);

            if (connectConfig.transport?.type === 'stdio' && vaultPath) {
              connectConfig.transport.working_dir = vaultPath;
              console.log(`[showEditServerDialog] Setting working_dir for ${serverId} to: ${vaultPath}`);
              // Bundled servers are Rust binaries that use working_dir, not VAULT_PATH env
              if (config.builtin && connectConfig.transport.env) {
                delete connectConfig.transport.env.VAULT_PATH;
              }
            }
            await mcpManager.connectServer(serverId, connectConfig);
          } catch (error) {
            console.error('Failed to connect to server:', error);
            this.showNotification(`Failed to connect: ${error.message}`, 'error');
          }
        }
        // Don't try to reconnect servers that are already connected, connecting, or in error state
      },
      null, // onCancel
      async (serverIdToRemove) => {
        // onRemove callback
        await this.handleRemove(serverIdToRemove);
      }
    );
  }

  /**
   * Test server connection
   */
  async testServerConnection(serverId) {
    const server = this._getServerConfig(serverId);
    if (!server) return;

    try {
      // Check if server is already connected
      const currentStatus = mcpManager.status.get(serverId);
      const wasConnected = currentStatus === 'connected';

      this.showNotification(`Testing ${server.name}...`, 'info');

      if (!wasConnected) {
        // Get current vault path and bundle path for variable expansion
        const currentVaultPath = await this.getCurrentVaultPath();
        const bundlePath = await this._getBundlePath();

        let testConfig = {
          enabled: server.enabled,
          transport: JSON.parse(JSON.stringify(server.transport)), // Deep clone
          capabilities: server.capabilities,
          permissions: server.permissions || {
            read: true,
            write: false,
            delete: false,
            external_access: false
          }
        };

        // Expand variables (${BUNDLE_PATH}, ${VAULT_PATH}) before connecting
        testConfig = this._expandConfigVariables(testConfig, currentVaultPath, bundlePath);

        // CRITICAL: Set working_dir for stdio transports
        if (testConfig.transport?.type === 'stdio' && currentVaultPath) {
          testConfig.transport.working_dir = currentVaultPath;
          console.log(`🔧 [testServer] Setting working_dir for ${serverId} to: ${currentVaultPath}`);

          // Bundled servers are Rust binaries that use working_dir, not VAULT_PATH env
          if (server.builtin && testConfig.transport.env) {
            delete testConfig.transport.env.VAULT_PATH;
          }
        }

        // Server is not connected, connect it for testing
        await mcpManager.connectServer(serverId, testConfig);
        
        // Wait for connection to establish
        let connected = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (mcpManager.status.get(serverId) === 'connected') {
            connected = true;
            break;
          }
        }
        
        if (!connected) {
          throw new Error('Connection timeout');
        }
      }
      
      // Now test the server capabilities
      try {
        // Get server info (testing connection)
        await mcpManager.getServerInfo(serverId);
        
        // List available tools
        const tools = await mcpManager.listTools(serverId);
        
        // List available resources if supported
        let resources = [];
        if (server.capabilities && server.capabilities.resources) {
          try {
            resources = await mcpManager.listResources(serverId);
          } catch (resourceError) {
            console.log(`[MCPSettingsPanel] Server ${serverId} doesn't support resources:`, resourceError.message);
          }
        }
        
        // Show detailed success message
        const resourceText = server.capabilities?.resources ? ` and ${resources.length} resources` : '';
        this.showNotification(
          `✅ ${server.name} is working! Found ${tools.length} tools${resourceText}`, 
          'success'
        );
        
      } catch (testError) {
        // Connection succeeded but testing failed
        this.showNotification(
          `⚠️ ${server.name} connected but test failed: ${testError.message}`, 
          'warning'
        );
      }
      
      // Only disconnect if it wasn't originally connected
      if (!wasConnected) {
        await mcpManager.disconnectServer(serverId);
      }
      
    } catch (error) {
      this.showNotification(`❌ Failed to connect to ${server.name}: ${error.message}`, 'error');
    }
  }

  /**
   * Delete server
   */
  async deleteServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) return;
    
    if (confirm(`Are you sure you want to delete "${server.name}"?`)) {
      // Disconnect if connected
      if (mcpManager.status.get(serverId) === 'connected') {
        await mcpManager.disconnectServer(serverId);
      }
      
      // Remove from local state
      this.servers.delete(serverId);
      
      // Remove from persistent storage
      await this.deleteConfiguration(serverId);
      
      // Re-render
      this.renderServerList();
      
      this.showNotification(`Deleted server: ${server.name}`, 'info');
    }
  }

  /**
   * Handle enable toggle
   */
  async handleEnableToggle(enabled) {
    console.log('MCP enabled:', enabled);
    
    try {
      // Get current settings
      const settings = await invoke('get_mcp_settings');
      settings.enabled = enabled;
      
      // Save updated settings
      await invoke('save_mcp_settings', { settings });
      
      this.showNotification(`MCP integration ${enabled ? 'enabled' : 'disabled'}`, 'info');
    } catch (error) {
      console.error('Failed to save MCP enabled state:', error);
      this.showNotification('Failed to save settings', 'error');
    }
  }

  /**
   * Handle import config
   */
  async handleImportConfig() {
    // TODO: Implement config import
    console.log('Import config');
  }

  /**
   * Handle export config
   */
  async handleExportConfig() {
    // TODO: Implement config export
    console.log('Export config');
  }

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (window.showNotification) {
      window.showNotification(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }

  /**
   * Show the settings panel
   */
  show() {
    console.log('MCPSettingsPanel.show() called');
    console.log('Container exists?', !!this.container);
    
    this.isVisible = true;
    const panel = this.container.querySelector('.mcp-settings-panel');
    console.log('Panel element found?', !!panel);
    
    if (panel) {
      panel.classList.add('visible');
      console.log('Added visible class to panel');
      
      // Refresh the server list after a short delay to ensure we have latest status
      setTimeout(() => {
        console.log('[MCPSettingsPanel] Refreshing server list to show current status');
        this.renderServerList();
        
        // Update capabilities for all connected servers with a longer delay
        // to ensure servers are properly connected
        setTimeout(() => {
          this.updateAllServerCapabilities();
        }, 1000);
      }, 100);
    } else {
      console.error('Panel element not found!');
    }
  }

  /**
   * Hide the settings panel
   */
  hide() {
    console.log('MCPSettingsPanel.hide() called');
    this.isVisible = false;
    const panel = this.container.querySelector('.mcp-settings-panel');
    if (panel) {
      panel.classList.remove('visible');
    }
  }

  /**
   * Toggle panel visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  /**
   * Get current vault path
   */
  async getCurrentVaultPath() {
    try {
      // Check if we have a vault path in the window object
      if (window.currentVaultPath) {
        return window.currentVaultPath;
      }
      
      // Try to get from vault info
      const vaultInfo = await invoke('get_vault_info');
      if (vaultInfo && vaultInfo.path) {
        return vaultInfo.path;
      }
    } catch (error) {
      console.error('Failed to get vault path:', error);
    }
    
    return null;
  }
  
  /**
   * Save server configuration to persistent storage
   */
  async saveConfiguration(serverId, config) {
    try {
      await invoke('save_mcp_server_config', { serverId, config });
      console.log(`Saved configuration for server: ${serverId}`);
    } catch (error) {
      console.error('Failed to save server configuration:', error);
      throw error;
    }
  }
  
  /**
   * Delete server configuration from persistent storage
   */
  async deleteConfiguration(serverId) {
    try {
      await invoke('delete_mcp_server_config', { serverId });
      console.log(`Deleted configuration for server: ${serverId}`);
    } catch (error) {
      console.error('Failed to delete server configuration:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const mcpSettingsPanel = new MCPSettingsPanel();
