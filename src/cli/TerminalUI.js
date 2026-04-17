import { GhosttyIntegration } from './ghostty/GhosttyIntegration.js';
import { GhosttyProcess } from './ghostty/GhosttyProcess.js';
import { CommandParser } from './CommandParser.js';
import { CommandExecutor } from './CommandExecutor.js';

export class TerminalUI {
  constructor(container, options = {}) {
    this.container = container;
    this.isInitialized = false;
    this.isRunning = false;
    this.ghosttyIntegration = new GhosttyIntegration();
    this.ghosttyProcess = null;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.maxHistorySize = 100;
    this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.theme = (this.storage ? this.storage.getItem('terminal-theme') : null) || 'dark';
    this.ghosttyStatus = null;
    this.eventListeners = new Map();
    
    // Logging and error handling
    this.logger = options.logger || null;
    this.errorHandler = options.errorHandler || null;
    
    // Initialize command processing components
    this.commandParser = new CommandParser();
    this.commandExecutor = new CommandExecutor({
      parser: this.commandParser
    });
    
    // Set up built-in command handlers
    this.setupBuiltinCommands();
    
    // Set up basic UI structure
    this.container.classList.add('terminal-ui-container');
    this.container.classList.add(`terminal-theme-${this.theme}`);
    
    // Bind event handlers
    this.handleInputKeydown = this.handleInputKeydown.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  setupBuiltinCommands() {
    // Clear command
    this.commandExecutor.onClear(() => {
      this.clearOutput();
    });

    // Exit command
    this.commandExecutor.onExit(() => {
      this.stopTerminal();
    });

    // Help command
    this.commandExecutor.onHelp(() => {
      this.showHelp();
    });

    // CD command (special handling)
    this.commandExecutor.onCd((path) => {
      // Could emit event or update UI to show current directory
      this.emit('directoryChanged', path);
    });
  }

  async initialize() {
    try {
      if (this.logger) {
        this.logger.info('TerminalUI: Initializing terminal UI');
      }
      
      // Check Ghostty installation status
      this.ghosttyStatus = await this.ghosttyIntegration.getInstallationStatus();
      
      if (!this.ghosttyStatus.installed) {
        const errorMsg = 'Ghostty not found. Please install Ghostty to use the terminal.';
        const error = new Error(errorMsg);
        
        if (this.logger) {
          this.logger.error('TerminalUI: Ghostty not installed');
        }
        if (this.errorHandler) {
          this.errorHandler.handleError(error, 'TerminalUI.initialize');
        }
        
        this.container.innerHTML = `<div class="terminal-error">${errorMsg}</div>`;
        return;
      }
      
      if (!this.ghosttyStatus.valid) {
        const errorMsg = 'Ghostty installation is invalid. Please reinstall Ghostty.';
        this.container.innerHTML = `<div class="terminal-error">${errorMsg}</div>`;
        return;
      }
      
      if (this.logger) {
        this.logger.info('TerminalUI: Ghostty installation verified', this.ghosttyStatus);
      }
      
      this.isInitialized = true;
    } catch (error) {
      if (this.logger) {
        this.logger.error('TerminalUI: Failed to initialize', error);
      }
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'TerminalUI.initialize');
      }
      
      const errorMsg = 'Failed to initialize terminal: ' + error.message;
      this.container.innerHTML = `<div class="terminal-error">${errorMsg}</div>`;
    }
  }

  render() {
    if (!this.isInitialized) {
      return;
    }

    this.container.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-title">Ghostty Terminal</div>
        <div class="terminal-version">v${this.ghosttyStatus.version || 'unknown'}</div>
        <button class="terminal-control-button">Start Terminal</button>
      </div>
      <div class="terminal-body">
        <div class="terminal-output"></div>
        <div class="terminal-input-container">
          <input type="text" class="terminal-input" placeholder="Enter command..." />
        </div>
      </div>
      <div class="terminal-status"></div>
    `;

    // Attach event listeners
    const button = this.container.querySelector('.terminal-control-button');
    button.addEventListener('click', () => this.toggleTerminal());

    const input = this.container.querySelector('.terminal-input');
    input.addEventListener('keydown', this.handleInputKeydown);

    // Set up resize handler
    window.addEventListener('resize', this.handleResize);
  }

  async toggleTerminal() {
    if (this.isRunning) {
      await this.stopTerminal();
    } else {
      await this.startTerminal();
    }
  }

  async startTerminal() {
    try {
      if (this.logger) {
        this.logger.info('TerminalUI: Starting terminal');
      }
      
      // Create new Ghostty process
      this.ghosttyProcess = new GhosttyProcess(this.ghosttyIntegration);
      
      // Update CommandExecutor with the new process
      this.commandExecutor.ghosttyProcess = this.ghosttyProcess;
      
      // Set up event handlers
      this.ghosttyProcess.on('stdout', (data) => {
        const output = data.toString();
        if (this.logger) {
          this.logger.debug('TerminalUI: stdout', output);
        }
        this.appendOutput(output);
      });
      
      this.ghosttyProcess.on('stderr', (data) => {
        const output = data.toString();
        if (this.logger) {
          this.logger.warn('TerminalUI: stderr', output);
        }
        this.appendOutput(output);
      });
      
      this.ghosttyProcess.on('output', (data) => {
        this.appendOutput(data);
      });
      
      this.ghosttyProcess.on('error', (error) => {
        if (this.logger) {
          this.logger.error('TerminalUI: Process error', error);
        }
        if (this.errorHandler) {
          this.errorHandler.handleError(error, 'TerminalUI.process');
        }
        this.showError(error.message);
      });
      
      // Start the process
      const started = await this.ghosttyProcess.spawn();
      if (!started) {
        throw new Error('Failed to start terminal process');
      }
      this.isRunning = true;
      
      if (this.logger) {
        this.logger.info('TerminalUI: Terminal started successfully');
      }
      
      // Update UI
      const button = this.container.querySelector('.terminal-control-button');
      button.textContent = 'Stop Terminal';
      
      // Focus input
      const input = this.container.querySelector('.terminal-input');
      input.focus();
    } catch (error) {
      if (this.logger) {
        this.logger.error('TerminalUI: Failed to start terminal', error);
      }
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'TerminalUI.startTerminal');
      }
      this.showError('Failed to start terminal: ' + error.message);
    }
  }

  async stopTerminal() {
    try {
      if (this.logger) {
        this.logger.info('TerminalUI: Stopping terminal');
      }
      
      if (this.ghosttyProcess) {
        try {
          this.ghosttyProcess.stop();
        } catch (stopError) {
          // If stop fails, still try to clean up
          if (this.logger) {
            this.logger.error('TerminalUI: Failed to stop terminal', stopError);
          }
          if (this.errorHandler) {
            this.errorHandler.handleError(stopError, 'TerminalUI.stopTerminal');
          }
          this.showError('Failed to stop terminal: ' + stopError.message);
          throw stopError;
        }
        this.ghosttyProcess.destroy();
        this.ghosttyProcess = null;
        // Clear CommandExecutor reference
        this.commandExecutor.ghosttyProcess = null;
      }
      this.isRunning = false;
      
      if (this.logger) {
        this.logger.info('TerminalUI: Terminal stopped successfully');
      }
      
      // Update UI
      const button = this.container.querySelector('.terminal-control-button');
      if (button) {
        button.textContent = 'Start Terminal';
      }
    } catch (error) {
      // Keep running state true if stop failed
      if (error.message.includes('Failed to stop')) {
        // Don't change isRunning state
      } else {
        this.isRunning = false;
      }
      throw error;
    }
  }

  async handleInputKeydown(event) {
    const input = event.target || this.container.querySelector('.terminal-input');
    
    if (!input) {
      return;
    }
    
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        const command = input.value.trim();
        if (command) {
          await this.sendCommand(command);
          input.value = '';
        }
        break;
        
      case 'ArrowUp':
        event.preventDefault();
        if (this.commandHistory.length > 0) {
          if (this.historyIndex === -1) {
            this.historyIndex = this.commandHistory.length - 1;
          } else if (this.historyIndex > 0) {
            this.historyIndex--;
          }
          input.value = this.commandHistory[this.historyIndex];
        }
        break;
        
      case 'ArrowDown':
        event.preventDefault();
        if (this.historyIndex !== -1) {
          if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            input.value = this.commandHistory[this.historyIndex];
          } else {
            this.historyIndex = -1;
            input.value = '';
          }
        }
        break;
    }
  }

  async sendCommand(command) {
    try {
      // Add to history (but not empty commands)
      if (command.trim()) {
        this.commandHistory.push(command);
        if (this.commandHistory.length > this.maxHistorySize) {
          this.commandHistory.shift();
        }
        this.historyIndex = -1;
      }
      
      // Use CommandExecutor to handle the command
      if (this.isRunning) {
        if (this.logger) {
          this.logger.info('TerminalUI: Executing command', command);
        }
        
        const result = await this.commandExecutor.executeCommand(command);
        
        if (this.logger) {
          this.logger.debug('TerminalUI: Command result', result);
        }
        
        if (!result.success && result.error) {
          this.showError('Failed to send command: ' + result.error);
        }
        return result;
      } else {
        if (this.logger) {
          this.logger.warn('TerminalUI: Command sent but terminal not running', command);
        }
        return {
          success: false,
          command,
          error: 'Terminal not running'
        };
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error('TerminalUI: Command execution failed', command, error);
      }
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'TerminalUI.sendCommand');
      }
      this.showError('Failed to send command: ' + error.message);
      return {
        success: false,
        command,
        error: error.message
      };
    }
  }

  appendOutput(text) {
    const output = this.container.querySelector('.terminal-output');
    if (output) {
      const line = document.createElement('div');
      line.className = 'terminal-line';
      line.textContent = text;
      output.appendChild(line);
      
      // Auto-scroll to bottom
      output.scrollTop = output.scrollHeight - output.clientHeight;
    }
  }

  clearOutput() {
    const output = this.container.querySelector('.terminal-output');
    if (output) {
      output.innerHTML = '';
    }
  }

  showHelp() {
    const helpText = `Available commands:
  clear     - Clear the terminal output
  exit      - Stop the terminal
  help      - Show this help message
  
Additional features:
  - Command history (use up/down arrows)
  - Aliases support (use commandExecutor.addAlias())
  - Pipe operators (|)
  - Command chaining (&&, ||, ;)
  - Redirection (>, >>)
  - Background execution (&)

Terminal powered by Ghostty`;
    
    this.appendOutput(helpText);
  }

  showError(message) {
    // Try to update status element first
    const status = this.container.querySelector('.terminal-status');
    if (status) {
      status.textContent = message;
      status.classList.add('error');
    } else {
      // If no status element, show error in container
      this.container.innerHTML = `<div class="terminal-error">${message}</div>`;
    }
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.storage) {
      this.storage.setItem('terminal-theme', theme);
    }
    
    if (this.logger) {
      this.logger.info('TerminalUI: Theme changed', theme);
    }
    
    // Update classes
    this.container.classList.remove('terminal-theme-dark');
    this.container.classList.remove('terminal-theme-light');
    this.container.classList.add(`terminal-theme-${theme}`);
  }

  handleResize() {
    if (this.logger) {
      this.logger.debug('TerminalUI: Window resized');
    }
    this.emit('resize');
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  emit(event, ...args) {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  destroy() {
    if (this.logger) {
      this.logger.info('TerminalUI: Destroying terminal UI');
    }
    
    // Clean up event listeners
    window.removeEventListener('resize', this.handleResize);
    
    // Stop terminal process
    if (this.ghosttyProcess) {
      try {
        this.ghosttyProcess.stop();
      } catch (error) {
        // Ignore stop errors during destroy
      }
      try {
        this.ghosttyProcess.destroy();
      } catch (error) {
        // Ignore destroy errors
      }
      this.ghosttyProcess = null;
    }
    
    // Clear container
    this.container.innerHTML = '';
    
    if (this.logger) {
      this.logger.debug('TerminalUI: Cleanup completed');
    }
  }
}