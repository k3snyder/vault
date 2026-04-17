// CLIContainer.js - Container for CLI mode with Ghostty terminal
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { icons } from '../icons/icon-utils.js';

export class CLIContainer {
  constructor(options = {}) {
    this.vaultPath = options.vaultPath || '';
    this.windowId = options.windowId || '';
    this.mcpConfig = options.mcpConfig || null;
    this.container = null;
    this.terminalContainer = null;
    this.ghosttyProcess = null;
    this.isInitialized = false;
    this.eventListeners = [];
    
    // Callbacks
    this.onReady = options.onReady || (() => {});
    this.onError = options.onError || ((error) => console.error('CLI Error:', error));

    this.handleFocusGhostty = this.handleFocusGhostty.bind(this);
    this.handleRestartCLI = this.handleRestartCLI.bind(this);
  }
  
  async mount(container) {
    this.container = container;
    container.innerHTML = '';
    container.className = 'cli-container';
    
    // Create loading state
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'cli-loading';
    loadingDiv.innerHTML = `
      <div class="cli-loading-spinner"></div>
      <div class="cli-loading-text">Initializing CLI mode...</div>
    `;
    container.appendChild(loadingDiv);
    
    try {
      // Check if Ghostty is already running and stop it
      try {
        const status = await invoke('ghostty_status');
        if (status && status.process && status.process.running) {
          console.log('CLI: Stopping existing Ghostty process...');
          await invoke('ghostty_stop', { force: false });
          // Wait a bit for cleanup
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e) {
        console.log('CLI: No existing Ghostty process or failed to check:', e);
      }
      // Check Ghostty installation
      console.log('CLI: Checking Ghostty installation...');
      const status = await this.checkGhosttyInstallation();
      console.log('CLI: Ghostty status:', status);
      
      if (!status.installed) {
        throw new Error('Ghostty terminal is required for CLI mode. Please install Ghostty from https://ghostty.org or download from https://github.com/ghostty-org/ghostty');
      }
      
      // Check if Claude CLI is available
      console.log('CLI: Checking Claude CLI availability...');
      try {
        const claudeCheck = await invoke('check_command_exists', { command: 'claude' });
        console.log('CLI: Claude CLI check result:', claudeCheck);
        if (!claudeCheck) {
          throw new Error('Claude Code CLI is required. Please install Claude desktop app from https://claude.ai/download and ensure the "claude" command is available in your terminal.');
        }
      } catch (e) {
        console.error('CLI: Failed to check Claude CLI:', e);
        // The command might not exist, skip the check for now
        console.warn('CLI: Skipping Claude CLI check, will try to launch anyway...');
      }
      
      // Generate MCP configuration
      console.log('CLI: Generating MCP configuration...');
      await this.generateMCPConfig();
      
      // Create terminal container
      console.log('CLI: Creating terminal container...');
      this.terminalContainer = document.createElement('div');
      this.terminalContainer.className = 'cli-terminal-container';
      this.terminalContainer.id = `cli-terminal-${this.windowId}`;
      
      // Setup event listeners
      console.log('CLI: Setting up event listeners...');
      await this.setupEventListeners();
      
      // Spawn Ghostty process
      console.log('CLI: Spawning Ghostty process...');
      await this.spawnGhostty();
      
      // Replace loading with status message
      console.log('CLI: Mounting status container...');
      container.innerHTML = `
        <div class="cli-status">
          <div class="cli-status-icon">${icons.rocket({ size: 32 })}</div>
          <div class="cli-status-message">
            <h3>Claude Code CLI Launched</h3>
            <p>Ghostty terminal opened in a new window with Claude Code CLI.</p>
            <p class="cli-status-note">Working directory: ${this.vaultPath}</p>
            <p class="cli-status-note">MCP servers configured for vault access.</p>
          </div>
          <div class="cli-status-actions">
            <button class="cli-action-btn" data-action="focus-ghostty">Focus Terminal</button>
            <button class="cli-action-btn secondary" data-action="restart-cli">Restart CLI</button>
          </div>
        </div>
      `;
      this.bindActionButtons(container);
      
      this.isInitialized = true;
      console.log('CLI: Initialization complete');
      this.onReady();
      
    } catch (error) {
      console.error('Failed to initialize CLI mode:', error);
      this.showError(error.message);
      this.onError(error);
    }
  }
  
  async checkGhosttyInstallation() {
    try {
      const status = await invoke('ghostty_installation_status');
      console.log('Ghostty installation status:', status);
      return status;
    } catch (error) {
      console.error('Failed to check Ghostty installation:', error);
      return { installed: false, valid: false };
    }
  }
  
  async generateMCPConfig() {
    try {
      console.log('Generating MCP configuration for vault:', this.vaultPath);
      const configPath = await invoke('generate_mcp_config', {
        vaultPath: this.vaultPath,
        windowId: this.windowId
      });
      console.log('MCP config generated at:', configPath);
      
      // Store the config path for CLI launch
      this.mcpConfigPath = configPath;
      return configPath;
    } catch (error) {
      console.error('Failed to generate MCP config:', error);
      throw error;
    }
  }
  
  async setupEventListeners() {
    // Listen for Ghostty stdout
    const stdoutListener = await listen('ghostty:stdout', (event) => {
      console.log('Ghostty stdout:', event.payload.data);
      // In the future, we might process this output
    });
    this.eventListeners.push(stdoutListener);
    
    // Listen for Ghostty stderr
    const stderrListener = await listen('ghostty:stderr', (event) => {
      console.error('Ghostty stderr:', event.payload.data);
    });
    this.eventListeners.push(stderrListener);
    
    // Listen for Ghostty spawn event
    const spawnListener = await listen('ghostty:spawned', (event) => {
      console.log('Ghostty spawned:', event.payload);
      if (event.payload.success) {
        this.ghosttyProcess = { pid: event.payload.pid };
      }
    });
    this.eventListeners.push(spawnListener);
  }

  bindActionButtons(root) {
    const focusBtn = root.querySelector('[data-action="focus-ghostty"]');
    if (focusBtn) {
      focusBtn.addEventListener('click', this.handleFocusGhostty);
    }

    const restartBtn = root.querySelector('[data-action="restart-cli"]');
    if (restartBtn) {
      restartBtn.addEventListener('click', this.handleRestartCLI);
    }
  }

  handleFocusGhostty() {
    console.log('Focus Ghostty window');
  }

  async handleRestartCLI() {
    await this.stop();
    if (this.container) {
      await this.mount(this.container);
    }
  }
  
  async spawnGhostty() {
    try {
      // Prepare environment variables
      const env = {
        // Claude will automatically pick up .claude/settings.local.json from the vault directory
        // No need to pass config path explicitly
      };
      
      console.log('CLI: Spawn options:', {
        cwd: this.vaultPath,
        env: env
      });
      
      // Spawn Ghostty with Claude Code CLI
      // Note: Currently spawning in a new window as embedding requires libghostty
      const options = {
        // Only set cwd if we have a valid vault path, otherwise let it use default
        ...(this.vaultPath && this.vaultPath.trim() ? { cwd: this.vaultPath } : {}),
        args: [
          '--title', `Gaimplan CLI - ${this.vaultPath ? this.vaultPath.split('/').pop() : 'Default'}`,
          '-e', 'claude', 'code'  // Execute 'claude code' command
        ],
        env
      };
      
      console.log('CLI: Invoking ghostty_spawn...');
      
      // Add timeout to spawn
      const spawnPromise = invoke('ghostty_spawn', { options });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Ghostty spawn timeout after 10s')), 10000)
      );
      
      try {
        const result = await Promise.race([spawnPromise, timeoutPromise]);
        console.log('CLI: ghostty_spawn result:', result);
        
        if (!result) {
          throw new Error('Failed to spawn Ghostty process');
        }
      } catch (error) {
        console.error('CLI: Spawn timeout or error:', error);
        // If it's a timeout, check if process actually started
        try {
          const status = await invoke('ghostty_status');
          if (status && status.process && status.process.running) {
            console.log('CLI: Process started despite timeout');
            return; // Continue, process is running
          }
        } catch (e) {
          console.error('CLI: Failed to check status after timeout:', e);
        }
        throw new Error('Failed to spawn Ghostty - ' + error.message);
      }
      
      console.log('Ghostty process spawned successfully');
      
      // Give it a moment to initialize
      console.log('CLI: Waiting for process to initialize...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('CLI: Process initialization wait complete');
      
    } catch (error) {
      console.error('Failed to spawn Ghostty:', error);
      throw error;
    }
  }
  
  async stop() {
    try {
      if (this.ghosttyProcess) {
        await invoke('ghostty_stop', { force: false });
        this.ghosttyProcess = null;
      }
      
      // Clean up event listeners
      for (const listener of this.eventListeners) {
        listener();
      }
      this.eventListeners = [];
      
    } catch (error) {
      console.error('Failed to stop Ghostty:', error);
    }
  }
  
  showError(message) {
    if (this.container) {
      // Check if it's a Ghostty installation error
      const isGhosttyError = message.includes('Ghostty');
      
      this.container.innerHTML = `
        <div class="cli-error">
          <div class="cli-error-icon">${icons.alertTriangle({ size: 32 })}</div>
          <div class="cli-error-message">${message}</div>
          ${isGhosttyError ? `
            <div class="cli-error-help">
              <h4>How to install Ghostty:</h4>
              <ol>
                <li>Visit <a href="https://ghostty.org" target="_blank">ghostty.org</a> for official releases</li>
                <li>Or build from source at <a href="https://github.com/ghostty-org/ghostty" target="_blank">GitHub</a></li>
                <li>After installation, restart Gaimplan</li>
              </ol>
              <p class="cli-error-note">Note: Ghostty is currently in beta and may require building from source on some platforms.</p>
            </div>
          ` : ''}
          <button class="cli-error-retry" data-action="retry-cli">Retry</button>
        </div>
      `;

      const retryBtn = this.container.querySelector('[data-action="retry-cli"]');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          this.mount(this.container);
        });
      }
    }
  }
  
  async destroy() {
    await this.stop();
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.isInitialized = false;
  }
}
