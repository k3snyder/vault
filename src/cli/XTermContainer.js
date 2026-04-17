// XTermContainer.js - Embedded terminal using xterm.js
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './XTermContainer.css';
import MCPServerRegistry from '../mcp/MCPServerRegistry.js';
import MCPConfigGenerator from '../mcp/MCPConfigGenerator.js';

export class XTermContainer {
  constructor(options = {}) {
    this.vaultPath = options.vaultPath || '';
    this.windowId = options.windowId || '';
    this.mcpConfig = options.mcpConfig || null;
    this.container = null;
    this.terminal = null;
    this.fitAddon = null;
    this.sessionId = `pty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.isInitialized = false;
    this.eventListeners = [];
    this.resizeObserver = null;
    this.hasReceivedOutput = false;
    this.initialOutputTimeout = null;
    this.claudeAvailable = false; // Track if Claude CLI is available
    this.cliIsRunning = false; // Track if CLI is currently running
    this.notificationElement = null; // Store notification element reference

    // MCP Registry and Config Generator
    this.registry = new MCPServerRegistry();
    this.configGenerator = new MCPConfigGenerator(this.registry);

    // Callbacks
    this.onReady = options.onReady || (() => {});
    this.onError = options.onError || ((error) => console.error('Terminal Error:', error));

    // Bind methods
    this.handleConfigUpdated = this.handleConfigUpdated.bind(this);
    this.handleRestartCLI = this.handleRestartCLI.bind(this);

    // Listen for MCP config updates
    window.addEventListener('mcp-config-updated', this.handleConfigUpdated);
  }

  /**
   * Load MCP server registry from settings
   * @private
   * @returns {Promise<void>}
   */
  async loadRegistry() {
    try {
      console.log('XTerm: Loading MCP registry from settings...');

      // Get MCP settings from Tauri
      const settings = await invoke('get_mcp_settings');

      // Check if registry data exists
      if (settings.mcpServerRegistry) {
        console.log('XTerm: Restoring registry from saved state:', settings.mcpServerRegistry);
        this.registry = MCPServerRegistry.fromJSON(settings.mcpServerRegistry);
        // Update config generator with the restored registry
        this.configGenerator = new MCPConfigGenerator(this.registry);
      } else {
        console.log('XTerm: No saved registry found, using default bundled servers');
      }
    } catch (error) {
      console.warn('XTerm: Failed to load MCP registry, using defaults:', error);
    }
  }

  async mount(container) {
    this.container = container;
    container.innerHTML = '';
    container.className = 'xterm-container';

    try {
      // Load MCP registry from settings
      console.log('XTerm: Loading MCP registry...');
      try {
        await this.loadRegistry();
      } catch (error) {
        console.warn('XTerm: Failed to load MCP registry, using defaults:', error);
      }

      // Check if Claude CLI is available
      console.log('XTerm: Checking Claude CLI availability...');
      try {
        this.claudeAvailable = await invoke('check_command_exists', { command: 'claude' });
        console.log('XTerm: Claude CLI check result:', this.claudeAvailable);
      } catch (e) {
        console.warn('XTerm: Failed to check Claude CLI availability:', e);
        this.claudeAvailable = false;
      }

      if (!this.claudeAvailable) {
        console.warn('XTerm: Claude Code CLI not found. Terminal will start with fallback shell.');
      }

      // Create terminal
      console.log('XTerm: Creating terminal...');
      this.createTerminal();

      // Setup event listeners
      console.log('XTerm: Setting up event listeners...');
      await this.setupEventListeners();

      // Spawn PTY process (MCP config generation will happen inside spawnPty)
      console.log('XTerm: Spawning PTY process...');
      await this.spawnPty();

      this.isInitialized = true;
      console.log('XTerm: Initialization complete');
      this.onReady();

    } catch (error) {
      console.error('Failed to initialize terminal:', error);
      this.showError(error.message);
      this.onError(error);
    }
  }
  
  createTerminal() {
    // Create terminal instance with better sizing for sidebar
    this.terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selection: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      fontFamily: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Menlo, Consolas, "Courier New", monospace',
      fontSize: 14,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      scrollback: 10000,
      allowTransparency: true,
      windowsMode: false,
      rendererType: 'canvas',
      drawBoldTextInBrightColors: true
    });
    
    // Create container div
    const terminalDiv = document.createElement('div');
    terminalDiv.className = 'xterm-screen';
    this.container.appendChild(terminalDiv);
    
    // Open terminal in the div
    this.terminal.open(terminalDiv);
    
    // Add fit addon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    
    // Add web links addon
    const webLinksAddon = new WebLinksAddon();
    this.terminal.loadAddon(webLinksAddon);
    
    // Force refresh to fix character spacing
    this.terminal.refresh(0, this.terminal.rows - 1);
    
    // Handle terminal input
    this.terminal.onData((data) => {
      this.handleTerminalInput(data);
    });
    
    // Handle resize with debouncing
    let resizeTimeout;
    this.resizeObserver = new ResizeObserver((entries) => {
      if (this.fitAddon && this.terminal) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          requestAnimationFrame(() => {
            try {
              // Get the actual container dimensions
              const rect = this.container.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                // Let fitAddon handle the sizing - it knows about padding and scrollbars
                this.fitAddon.fit();
                this.handleResize();
                console.log('Terminal resized - dimensions:', {
                  rows: this.terminal.rows,
                  cols: this.terminal.cols,
                  width: rect.width,
                  height: rect.height,
                  fontSize: this.terminal.options.fontSize
                });
              }
            } catch (e) {
              console.warn('Failed to fit terminal:', e);
            }
          });
        }, 50); // Debounce resize events
      }
    });
    this.resizeObserver.observe(this.container);
    
    // Initial fit with multiple attempts to ensure proper sizing
    const attemptFit = (attempts = 0) => {
      if (attempts > 5) return;
      
      setTimeout(() => {
        if (this.fitAddon && this.terminal) {
          try {
            const rect = this.container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              // Clear any existing content that might affect measurements
              this.terminal.clear();
              
              // Fit the terminal - let fitAddon handle all calculations
              this.fitAddon.fit();
              
              // Force a refresh to recalculate character dimensions
              this.terminal.refresh(0, this.terminal.rows - 1);
              
              console.log('Initial terminal fit - dimensions:', {
                rows: this.terminal.rows,
                cols: this.terminal.cols,
                width: rect.width,
                height: rect.height
              });
            } else {
              // Container not ready, try again
              attemptFit(attempts + 1);
            }
          } catch (e) {
            console.warn('Initial fit attempt failed:', e);
            attemptFit(attempts + 1);
          }
        }
      }, 100 * (attempts + 1)); // Exponential backoff
    };
    
    attemptFit();
    
    // Write initial message
    this.terminal.writeln('Initializing Claude Code CLI...');
  }
  
  /**
   * Generate MCP configuration for the detected CLI agent
   * @private
   * @param {string} command - The CLI command being executed
   * @returns {Promise<void>}
   */
  async generateMCPConfigForAgent(command) {
    // Only generate config if we have a vault path
    if (!this.vaultPath || !this.vaultPath.trim()) {
      console.log('XTerm: No vault path, skipping MCP configuration');
      return;
    }

    try {
      console.log('XTerm: Generating MCP configuration for command:', command);

      // Detect CLI agent from command
      const agent = this.configGenerator.detectAgent(command);
      console.log('XTerm: Detected agent:', agent);

      // Get bundle path from Tauri
      const bundlePath = await invoke('get_bundle_path');
      console.log('XTerm: Bundle path:', bundlePath);

      // Determine which agents to generate configs for
      // If spawning a plain shell, generate for all supported agents
      // so user can run any CLI tool (claude, gemini, codex)
      const agentsToGenerate = agent === 'unknown'
        ? ['claude', 'gemini', 'codex']
        : [agent];

      for (const targetAgent of agentsToGenerate) {
        try {
          // Generate config for the agent
          const config = await this.configGenerator.generateConfig(
            targetAgent,
            this.vaultPath,
            bundlePath
          );
          console.log(`XTerm: Generated ${targetAgent} config:`, {
            path: config.path,
            format: config.format,
            contentLength: config.content.length
          });

          // Write config to filesystem
          await invoke('write_mcp_config', {
            path: config.path,
            content: config.content,
            format: config.format
          });
          console.log(`XTerm: MCP config written successfully to:`, config.path);
        } catch (agentError) {
          console.warn(`XTerm: Failed to generate config for ${targetAgent}:`, agentError);
        }
      }

    } catch (error) {
      console.error('XTerm: Failed to generate MCP config:', error);
      // Don't throw - we want the terminal to continue even if MCP config fails
      this.terminal?.writeln(`\r\n[Warning] Failed to generate MCP configuration: ${error.message}`);
    }
  }
  
  async setupEventListeners() {
    // Listen for PTY data
    const dataListener = await listen(`pty:data:${this.sessionId}`, (event) => {
      if (this.terminal) {
        this.terminal.write(event.payload);
        
        // Track that we've received output
        if (!this.hasReceivedOutput) {
          this.hasReceivedOutput = true;
          if (this.initialOutputTimeout) {
            clearTimeout(this.initialOutputTimeout);
            this.initialOutputTimeout = null;
          }
        }
      }
    });
    this.eventListeners.push(dataListener);
    
    // Listen for PTY exit
    const exitListener = await listen(`pty:exit:${this.sessionId}`, (event) => {
      console.log('PTY exited:', event.payload);
      if (this.terminal) {
        this.terminal.writeln('\r\n[Process exited]');
      }
    });
    this.eventListeners.push(exitListener);
    
    // Listen for PTY errors
    const errorListener = await listen(`pty:error:${this.sessionId}`, (event) => {
      console.error('PTY error:', event.payload);
      if (this.terminal) {
        this.terminal.writeln(`\r\n[Error: ${event.payload}]`);
      }
    });
    this.eventListeners.push(errorListener);
  }
  
  /**
   * Handle MCP config updated event
   * @private
   * @param {CustomEvent} event - The config updated event
   */
  handleConfigUpdated(event) {
    console.log('XTerm: Received mcp-config-updated event:', event.detail);

    // Only show notification if CLI is currently running
    if (this.cliIsRunning && event.detail.requiresRestart) {
      this.showRestartNotification();
    }
  }

  /**
   * Show CLI restart notification
   * @private
   */
  showRestartNotification() {
    console.log('XTerm: Showing restart notification');

    // Remove any existing notification
    if (this.notificationElement) {
      this.notificationElement.remove();
      this.notificationElement = null;
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'cli-restart-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">ℹ️</span>
        <span class="notification-message">MCP configuration updated. Restart CLI for changes to take effect.</span>
        <button class="restart-cli-btn">Restart CLI</button>
        <button class="close-notification-btn">✕</button>
      </div>
    `;

    // Add to container
    if (this.container) {
      this.container.appendChild(notification);
      this.notificationElement = notification;

      // Add event listeners
      const restartBtn = notification.querySelector('.restart-cli-btn');
      const closeBtn = notification.querySelector('.close-notification-btn');

      if (restartBtn) {
        restartBtn.addEventListener('click', this.handleRestartCLI);
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          notification.remove();
          this.notificationElement = null;
        });
      }

      // Add styles if not already added
      this.addNotificationStyles();
    }
  }

  /**
   * Add notification styles
   * @private
   */
  addNotificationStyles() {
    if (document.getElementById('cli-notification-styles')) return;

    const style = document.createElement('style');
    style.id = 'cli-notification-styles';
    style.textContent = `
      .cli-restart-notification {
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        animation: slideDown 0.3s ease;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 12px 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-size: 13px;
      }

      .notification-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      .notification-message {
        color: var(--text-primary);
        flex: 1;
        white-space: nowrap;
      }

      .restart-cli-btn {
        background: var(--accent-color);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
        flex-shrink: 0;
      }

      .restart-cli-btn:hover {
        background: #3562ce;
      }

      .close-notification-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
        line-height: 1;
        flex-shrink: 0;
        transition: color 0.2s;
      }

      .close-notification-btn:hover {
        color: var(--text-primary);
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Handle CLI restart
   * @private
   */
  async handleRestartCLI() {
    console.log('XTerm: Restarting CLI...');

    try {
      // Remove notification
      if (this.notificationElement) {
        this.notificationElement.remove();
        this.notificationElement = null;
      }

      // Kill current PTY session
      if (this.sessionId) {
        await invoke('pty_close', { sessionId: this.sessionId });
        this.cliIsRunning = false;
      }

      // Clear terminal
      if (this.terminal) {
        this.terminal.clear();
        this.terminal.writeln('Restarting CLI with updated MCP configuration...\r\n');
      }

      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 500));

      // Generate new session ID
      this.sessionId = `pty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.hasReceivedOutput = false;

      // Reload registry to get latest config
      await this.loadRegistry();

      // Spawn new PTY session
      await this.spawnPty();

      console.log('XTerm: CLI restarted successfully');
    } catch (error) {
      console.error('XTerm: Failed to restart CLI:', error);
      if (this.terminal) {
        this.terminal.writeln(`\r\n[Error] Failed to restart CLI: ${error.message}`);
      }
    }
  }

  async spawnPty() {
    try {
      // Mark CLI as running
      this.cliIsRunning = true;

      // First, let's try to check if claude command exists
      let claudeExists = false;
      try {
        claudeExists = await invoke('check_command_exists', { command: 'claude' });
        this.claudeAvailable = claudeExists;
        console.log('XTerm: Claude CLI available:', claudeExists);
      } catch (e) {
        console.warn('Could not check claude command:', e);
        this.claudeAvailable = false;
      }

      // Ensure terminal is properly fitted before getting dimensions
      if (this.fitAddon) {
        try {
          this.fitAddon.fit();
        } catch (e) {
          console.warn('Could not fit before spawn:', e);
        }
      }

      // Start with a plain shell - let user choose their preferred AI CLI (claude, gemini, codex)
      // Use zsh on macOS to match default user shell and avoid legacy bash quirks.
      const isMacOS = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');
      const shellCommand = isMacOS ? '/bin/zsh' : '/bin/bash';
      const shellArgs = ['-l']; // Login shell

      const options = {
        command: shellCommand,
        args: shellArgs,
        cwd: this.vaultPath && this.vaultPath.trim() ? this.vaultPath : undefined,
        env: {
          TERM: 'xterm',
          COLORTERM: 'truecolor'
        },
        rows: this.terminal.rows || 24,
        cols: this.terminal.cols || 80
      };

      // Generate MCP configuration before spawning PTY
      const fullCommand = `${options.command} ${options.args.join(' ')}`;
      await this.generateMCPConfigForAgent(fullCommand);

      console.log('XTerm: Spawning PTY with options:', options);

      const result = await invoke('pty_spawn', {
        sessionId: this.sessionId,
        options
      });

      console.log('XTerm: PTY spawn result:', result);

    } catch (error) {
      console.error('Failed to spawn PTY:', error);
      this.terminal.writeln(`\r\n[Error] Failed to start terminal: ${error}`);
      throw error;
    }
  }
  
  async handleTerminalInput(data) {
    if (this.sessionId) {
      try {
        await invoke('pty_write', {
          sessionId: this.sessionId,
          data
        });
      } catch (error) {
        console.error('Failed to write to PTY:', error);
      }
    }
  }
  
  async handleResize() {
    if (this.sessionId && this.terminal) {
      try {
        await invoke('pty_resize', {
          sessionId: this.sessionId,
          rows: this.terminal.rows,
          cols: this.terminal.cols
        });
      } catch (error) {
        console.error('Failed to resize PTY:', error);
      }
    }
  }
  
  async stop() {
    try {
      if (this.sessionId) {
        await invoke('pty_close', { sessionId: this.sessionId });
      }
      
      // Clean up event listeners
      for (const listener of this.eventListeners) {
        listener();
      }
      this.eventListeners = [];
      
      // Dispose terminal
      if (this.terminal) {
        this.terminal.dispose();
        this.terminal = null;
      }
      
    } catch (error) {
      console.error('Failed to stop terminal:', error);
    }
  }
  
  showError(message) {
    if (this.container) {
      this.container.innerHTML = `
        <div class="xterm-error">
          <div class="xterm-error-icon">⚠️</div>
          <div class="xterm-error-message">${message}</div>
          <button class="xterm-error-retry" data-action="retry-terminal">Retry</button>
        </div>
      `;

      const retryBtn = this.container.querySelector('[data-action="retry-terminal"]');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          this.mount(this.container);
        });
      }
    }
  }
  
  async destroy() {
    console.log('XTerm: Destroying terminal container');

    // Remove MCP config event listener
    window.removeEventListener('mcp-config-updated', this.handleConfigUpdated);

    // Clean up timeout if it exists
    if (this.initialOutputTimeout) {
      clearTimeout(this.initialOutputTimeout);
      this.initialOutputTimeout = null;
    }

    // Clean up resize observer if it exists
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Remove notification if it exists
    if (this.notificationElement) {
      this.notificationElement.remove();
      this.notificationElement = null;
    }

    await this.stop();

    if (this.fitAddon) {
      this.fitAddon.dispose();
      this.fitAddon = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }

    this.isInitialized = false;
    this.sessionId = null;
    this.cliIsRunning = false;
  }
}
