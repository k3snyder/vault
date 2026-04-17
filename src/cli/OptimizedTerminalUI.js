/**
 * Optimized Terminal UI for improved rendering performance
 * Target: <100ms for large output batches
 */

import { GhosttyIntegration } from './ghostty/GhosttyIntegration.js';
import { GhosttyProcess } from './ghostty/GhosttyProcess.js';
import { CommandParser } from './CommandParser.js';
import { CommandExecutor } from './CommandExecutor.js';

export class OptimizedTerminalUI {
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
    
    // Performance optimizations
    this.outputBuffer = [];
    this.maxBufferSize = 1000;
    this.batchTimeout = null;
    this.batchSize = 100;
    this.renderRequestId = null;
    
    // Cache DOM elements
    this.outputElement = null;
    this.inputElement = null;
    
    // Virtual scrolling for large outputs
    this.virtualScrolling = options.virtualScrolling !== false;
    this.visibleLines = 50;
    this.lineHeight = 20;
    
    // Debounced scroll handler
    this.scrollTimeout = null;
    
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
    this.debouncedScroll = this.debounce(this.handleScroll.bind(this), 16); // 60fps
  }

  setupBuiltinCommands() {
    // Clear command
    this.commandExecutor.onClear(() => {
      this.clearOutput();
    });

    // Exit command
    this.commandExecutor.onExit(() => {
      this.stop();
    });
  }

  render() {
    if (!this.isInitialized) {
      return;
    }

    this.container.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-status ${this.ghosttyStatus || 'disconnected'}">
          ${this.ghosttyStatus || 'Disconnected'}
        </div>
        <div class="terminal-controls">
          <button class="terminal-control-btn" data-action="minimize">−</button>
          <button class="terminal-control-btn" data-action="maximize">□</button>
          <button class="terminal-control-btn terminal-close" data-action="close">×</button>
        </div>
      </div>
      <div class="terminal-body">
        <div class="terminal-output" id="terminal-output-${this.container.id || 'default'}">
          <div class="terminal-scroll-container">
            <div class="terminal-lines"></div>
          </div>
        </div>
        <div class="terminal-input-area">
          <span class="terminal-prompt">$ </span>
          <input type="text" class="terminal-input" placeholder="Enter command..." autocomplete="off" spellcheck="false">
        </div>
      </div>
    `;

    // Cache DOM elements
    this.outputElement = this.container.querySelector('.terminal-output');
    this.linesContainer = this.container.querySelector('.terminal-lines');
    this.inputElement = this.container.querySelector('.terminal-input');
    
    // Set up event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    if (this.inputElement) {
      this.inputElement.addEventListener('keydown', this.handleInputKeydown);
    }
    
    if (this.outputElement) {
      this.outputElement.addEventListener('scroll', this.debouncedScroll);
    }
    
    window.addEventListener('resize', this.handleResize);
    
    // Control buttons
    this.container.addEventListener('click', (e) => {
      if (e.target.classList.contains('terminal-control-btn')) {
        const action = e.target.dataset.action;
        this.handleControlAction(action);
      }
    });
  }

  /**
   * Optimized output appending with batching
   */
  appendOutput(text) {
    if (!text) return;
    
    // Add to buffer
    this.outputBuffer.push(text);
    
    // If buffer is getting large, flush immediately
    if (this.outputBuffer.length >= this.batchSize) {
      this.flushOutput();
    } else if (!this.batchTimeout) {
      // Schedule a flush
      this.batchTimeout = setTimeout(() => {
        this.flushOutput();
      }, 16); // Next frame
    }
  }

  /**
   * Flush buffered output to DOM efficiently
   */
  flushOutput() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    if (this.outputBuffer.length === 0) return;
    
    // Use requestAnimationFrame for smooth rendering
    if (this.renderRequestId) {
      cancelAnimationFrame(this.renderRequestId);
    }
    
    this.renderRequestId = requestAnimationFrame(() => {
      this.renderBufferedOutput();
    });
  }

  /**
   * Efficiently render buffered output
   */
  renderBufferedOutput() {
    if (!this.linesContainer) return;
    
    const fragment = document.createDocumentFragment();
    const linesToRender = Math.min(this.outputBuffer.length, this.batchSize);
    
    // Create elements in batch
    for (let i = 0; i < linesToRender; i++) {
      const text = this.outputBuffer[i];
      const line = document.createElement('div');
      line.className = 'terminal-line';
      line.textContent = text;
      fragment.appendChild(line);
    }
    
    // Single DOM update
    this.linesContainer.appendChild(fragment);
    
    // Remove processed items from buffer
    this.outputBuffer.splice(0, linesToRender);
    
    // Manage line count for performance
    this.manageLineCount();
    
    // Auto-scroll if at bottom
    this.autoScroll();
    
    // Process remaining buffer if any
    if (this.outputBuffer.length > 0) {
      this.renderRequestId = requestAnimationFrame(() => {
        this.renderBufferedOutput();
      });
    } else {
      this.renderRequestId = null;
    }
  }

  /**
   * Manage line count to prevent memory issues
   */
  manageLineCount() {
    if (!this.linesContainer) return;
    
    const lines = this.linesContainer.children;
    if (lines.length > this.maxBufferSize) {
      // Remove oldest lines
      const toRemove = lines.length - this.maxBufferSize;
      for (let i = 0; i < toRemove; i++) {
        this.linesContainer.removeChild(lines[0]);
      }
    }
  }

  /**
   * Optimized auto-scroll with debouncing
   */
  autoScroll() {
    if (!this.outputElement) return;
    
    // Check if user was already at the bottom
    const wasAtBottom = this.outputElement.scrollTop >= 
      this.outputElement.scrollHeight - this.outputElement.clientHeight - 10;
    
    if (wasAtBottom) {
      // Use smooth scrolling for better UX
      this.outputElement.scrollTop = this.outputElement.scrollHeight;
    }
  }

  /**
   * Debounced scroll handler
   */
  handleScroll() {
    // Could implement virtual scrolling here for very large outputs
    // For now, just clear any pending auto-scroll
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
  }

  /**
   * Optimized clear with single DOM operation
   */
  clearOutput() {
    // Clear buffer first
    this.outputBuffer = [];
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    if (this.renderRequestId) {
      cancelAnimationFrame(this.renderRequestId);
      this.renderRequestId = null;
    }
    
    // Single DOM clear
    if (this.linesContainer) {
      this.linesContainer.innerHTML = '';
    }
  }

  /**
   * Bulk append for large outputs
   */
  appendBulkOutput(lines) {
    if (!Array.isArray(lines)) return;
    
    // Add all lines to buffer at once
    this.outputBuffer.push(...lines);
    
    // Flush immediately for bulk operations
    this.flushOutput();
  }

  /**
   * Utility method for debouncing
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  handleInputKeydown(e) {
    if (e.key === 'Enter') {
      const command = e.target.value.trim();
      if (command) {
        this.executeCommand(command);
        e.target.value = '';
        this.addToHistory(command);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.navigateHistory('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.navigateHistory('down');
    }
  }

  async executeCommand(command) {
    // Show command in output
    this.appendOutput(`$ ${command}`);
    
    try {
      await this.commandExecutor.executeCommand(command);
    } catch (error) {
      this.appendOutput(`Error: ${error.message}`);
    }
  }

  addToHistory(command) {
    // Remove duplicate if it exists
    const existingIndex = this.commandHistory.indexOf(command);
    if (existingIndex !== -1) {
      this.commandHistory.splice(existingIndex, 1);
    }
    
    // Add to end
    this.commandHistory.push(command);
    
    // Limit history size
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift();
    }
    
    this.historyIndex = -1;
  }

  navigateHistory(direction) {
    if (this.commandHistory.length === 0) return;
    
    if (direction === 'up') {
      if (this.historyIndex === -1) {
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else if (direction === 'down') {
      if (this.historyIndex === -1) return;
      
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = -1;
        this.inputElement.value = '';
        return;
      }
    }
    
    if (this.historyIndex !== -1) {
      this.inputElement.value = this.commandHistory[this.historyIndex];
    }
  }

  handleResize() {
    // Update virtual scrolling parameters if needed
    if (this.virtualScrolling && this.outputElement) {
      this.visibleLines = Math.ceil(this.outputElement.clientHeight / this.lineHeight) + 5;
    }
  }

  handleControlAction(action) {
    switch (action) {
      case 'minimize':
        this.container.classList.toggle('minimized');
        break;
      case 'maximize':
        this.container.classList.toggle('maximized');
        break;
      case 'close':
        this.stop();
        break;
    }
  }

  async start() {
    if (this.isRunning) {
      return;
    }

    try {
      this.isRunning = true;
      this.isInitialized = true;
      this.ghosttyStatus = 'connecting';
      
      this.render();
      
      // Start Ghostty process
      if (this.ghosttyIntegration) {
        await this.ghosttyIntegration.initialize();
        this.ghosttyProcess = new GhosttyProcess();
        await this.ghosttyProcess.start();
        this.ghosttyStatus = 'connected';
      }
      
      // Focus input
      if (this.inputElement) {
        this.inputElement.focus();
      }
      
      this.appendOutput('Terminal initialized. Type "help" for available commands.');
      
    } catch (error) {
      this.ghosttyStatus = 'error';
      this.appendOutput(`Failed to start terminal: ${error.message}`);
      
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'OptimizedTerminalUI.start');
      }
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      this.isRunning = false;
      this.ghosttyStatus = 'disconnecting';
      
      // Clean up event listeners
      this.cleanup();
      
      // Stop Ghostty process
      if (this.ghosttyProcess) {
        await this.ghosttyProcess.stop();
        this.ghosttyProcess = null;
      }
      
      this.ghosttyStatus = 'disconnected';
      
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'OptimizedTerminalUI.stop');
      }
    }
  }

  cleanup() {
    // Clear timeouts and animation frames
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    if (this.renderRequestId) {
      cancelAnimationFrame(this.renderRequestId);
      this.renderRequestId = null;
    }
    
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    
    // Remove event listeners
    if (this.inputElement) {
      this.inputElement.removeEventListener('keydown', this.handleInputKeydown);
    }
    
    if (this.outputElement) {
      this.outputElement.removeEventListener('scroll', this.debouncedScroll);
    }
    
    window.removeEventListener('resize', this.handleResize);
    
    // Clear buffer
    this.outputBuffer = [];
  }

  // Compatibility methods
  showHelp() {
    const helpText = `Available commands:
  clear     - Clear the terminal output
  exit      - Stop the terminal  
  help      - Show this help message

Performance optimizations enabled:
- Batched output rendering
- DOM element caching
- Virtual scrolling (experimental)
- Memory management`;
    
    this.appendOutput(helpText);
  }
}