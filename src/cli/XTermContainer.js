// XTermContainer.js - Embedded terminal using xterm.js
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './XTermContainer.css';

export class XTermContainer {
  constructor(options = {}) {
    this.vaultPath = options.vaultPath || '';
    this.windowId = options.windowId || '';
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
    // Callbacks
    this.onReady = options.onReady || (() => {});
    this.onError = options.onError || ((error) => console.error('Terminal Error:', error));

  }

  async mount(container) {
    this.container = container;
    container.innerHTML = '';
    container.className = 'xterm-container';

    try {
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
  
  async spawnPty() {
    try {
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
  }
}
