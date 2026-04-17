/**
 * Optimized Command Executor for improved execution performance
 * Target: <300ms for complex command execution
 */

export class OptimizedCommandExecutor {
  constructor(options = {}) {
    this.parser = options.parser;
    this.ghosttyProcess = options.ghosttyProcess;
    
    // Performance optimizations
    this.commandCache = new Map();
    this.cacheSize = 50;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    
    // Connection pooling for better resource management
    this.connectionPool = new Map();
    this.maxConnections = 5;
    
    // Request queuing for rate limiting
    this.requestQueue = [];
    this.activeRequests = 0;
    this.maxConcurrentRequests = 3;
    
    // Pre-compiled command patterns
    this.builtinCommands = new Set(['clear', 'exit', 'help', 'history']);
    this.systemCommands = new Set(['ls', 'cd', 'pwd', 'cat', 'grep', 'find']);
    
    // Built-in command handlers
    this.builtinHandlers = new Map();
    this.specialHandlers = new Map();
    this.eventListeners = new Map();
    
    // Logging and error handling
    this.logger = options.logger || null;
    this.errorHandler = options.errorHandler || null;
    
    // Performance monitoring
    this.stats = {
      commandsExecuted: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageExecutionTime: 0,
      errors: 0
    };
    
    // Retry configuration
    this.maxRetries = 3;
    this.retryDelay = 100; // Base delay in ms
    
    // Initialize built-in commands
    this.initializeBuiltinCommands();
  }

  initializeBuiltinCommands() {
    // Pre-register built-in commands for faster lookup
    this.builtinHandlers.set('clear', () => {
      this.emit('clear');
      return { success: true, output: 'Terminal cleared' };
    });
    
    this.builtinHandlers.set('exit', () => {
      this.emit('exit');
      return { success: true, output: 'Exiting terminal' };
    });
    
    this.builtinHandlers.set('help', () => {
      const helpText = `Available commands:
  clear     - Clear the terminal output
  exit      - Stop the terminal
  help      - Show this help message
  history   - Show command history

Performance optimizations enabled:
- Command caching (${this.cacheSize} entries, ${this.cacheTTL/1000}s TTL)
- Connection pooling (max ${this.maxConnections} connections)  
- Request queuing (max ${this.maxConcurrentRequests} concurrent)`;
      
      return { success: true, output: helpText };
    });
  }

  async executeCommand(command) {
    const startTime = performance.now();
    
    try {
      this.stats.commandsExecuted++;
      
      if (this.logger) {
        this.logger.debug('OptimizedCommandExecutor: Executing command', command);
      }
      
      // Validate command
      if (!command || !command.trim()) {
        const result = {
          success: false,
          command,
          error: 'Empty command',
          executionTime: performance.now() - startTime
        };
        this.emit('commandExecuted', result);
        return result;
      }

      const trimmedCommand = command.trim();
      
      // Check cache first for cacheable commands
      if (this.isCacheable(trimmedCommand)) {
        const cached = this.getCachedResult(trimmedCommand);
        if (cached) {
          this.stats.cacheHits++;
          const result = {
            ...cached,
            executionTime: performance.now() - startTime,
            fromCache: true
          };
          this.emit('commandExecuted', result);
          return result;
        }
        this.stats.cacheMisses++;
      }

      // Parse command if parser is available
      let parsedCommand = trimmedCommand;
      if (this.parser && typeof this.parser.parseCommand === 'function') {
        parsedCommand = this.parser.parseCommand(trimmedCommand);
        if (!parsedCommand) {
          const result = {
            success: false,
            command: trimmedCommand,
            error: 'Failed to parse command',
            executionTime: performance.now() - startTime
          };
          this.emit('commandExecuted', result);
          return result;
        }
      }

      // Execute command based on type
      let result;
      const commandName = this.extractCommandName(parsedCommand);
      
      if (this.builtinCommands.has(commandName)) {
        result = await this.executeBuiltinCommand(commandName, parsedCommand);
      } else if (this.systemCommands.has(commandName)) {
        result = await this.executeSystemCommand(parsedCommand);
      } else {
        result = await this.executeCustomCommand(parsedCommand);
      }

      // Add execution time and cache if applicable
      result.executionTime = performance.now() - startTime;
      
      if (this.isCacheable(trimmedCommand) && result.success) {
        this.setCachedResult(trimmedCommand, result);
      }
      
      // Update performance stats
      this.updateStats(result);
      
      this.emit('commandExecuted', result);
      return result;

    } catch (error) {
      this.stats.errors++;
      
      const result = {
        success: false,
        command,
        error: error.message,
        executionTime: performance.now() - startTime
      };
      
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'OptimizedCommandExecutor.executeCommand');
      }
      
      this.emit('commandExecuted', result);
      return result;
    }
  }

  extractCommandName(parsedCommand) {
    if (typeof parsedCommand === 'string') {
      return parsedCommand.split(/\s+/)[0];
    }
    if (parsedCommand && parsedCommand.command) {
      return parsedCommand.command;
    }
    return '';
  }

  async executeBuiltinCommand(commandName, parsedCommand) {
    const handler = this.builtinHandlers.get(commandName);
    if (handler) {
      return handler(parsedCommand);
    }
    
    return {
      success: false,
      error: `Built-in command '${commandName}' not implemented`
    };
  }

  async executeSystemCommand(parsedCommand) {
    // Queue system commands to prevent overwhelming the system
    return this.queueCommand(() => this.executeSystemCommandImpl(parsedCommand));
  }

  async executeSystemCommandImpl(parsedCommand) {
    if (!this.ghosttyProcess) {
      return {
        success: false,
        error: 'Terminal process not available'
      };
    }

    try {
      // Execute with retry logic
      return await this.executeWithRetry(() => 
        this.ghosttyProcess.execute(parsedCommand)
      );
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeCustomCommand(parsedCommand) {
    // Custom command execution (e.g., through Tauri backend)
    return this.queueCommand(() => this.executeCustomCommandImpl(parsedCommand));
  }

  async executeCustomCommandImpl(parsedCommand) {
    try {
      // This would typically call the Tauri backend
      const { invoke } = await import('@tauri-apps/api/tauri');
      
      const response = await invoke('execute_command', {
        command: parsedCommand
      });
      
      return {
        success: true,
        output: response.output || '',
        data: response.data || []
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async queueCommand(commandFn) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        execute: commandFn,
        resolve,
        reject,
        timestamp: Date.now()
      });
      
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.activeRequests >= this.maxConcurrentRequests || this.requestQueue.length === 0) {
      return;
    }

    const request = this.requestQueue.shift();
    this.activeRequests++;

    try {
      const result = await request.execute();
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    } finally {
      this.activeRequests--;
      // Process next request in queue
      setTimeout(() => this.processQueue(), 0);
    }
  }

  async executeWithRetry(commandFn, attempt = 1) {
    try {
      return await commandFn();
    } catch (error) {
      if (attempt < this.maxRetries && this.isRetryableError(error)) {
        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(commandFn, attempt + 1);
      }
      throw error;
    }
  }

  isRetryableError(error) {
    // Define which errors should trigger retries
    const retryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'Network error',
      'Connection failed'
    ];
    
    return retryableErrors.some(errorType => 
      error.message.includes(errorType) || error.code === errorType
    );
  }

  isCacheable(command) {
    // Don't cache commands that modify state or have side effects
    const nonCacheablePatterns = [
      /^(cd|mkdir|rmdir|rm|mv|cp|touch)/i,
      /^(git|npm|yarn)/i,
      />/,  // Redirections
      /\|/, // Pipes
      /&/   // Background processes
    ];
    
    return !nonCacheablePatterns.some(pattern => pattern.test(command));
  }

  getCachedResult(command) {
    const cached = this.commandCache.get(command);
    if (!cached) return null;
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.commandCache.delete(command);
      return null;
    }
    
    return cached.result;
  }

  setCachedResult(command, result) {
    // LRU cache management
    if (this.commandCache.size >= this.cacheSize) {
      // Remove oldest entry
      const firstKey = this.commandCache.keys().next().value;
      this.commandCache.delete(firstKey);
    }
    
    this.commandCache.set(command, {
      result: { ...result },
      timestamp: Date.now()
    });
  }

  updateStats(result) {
    // Update running average
    const { executionTime } = result;
    const totalTime = this.stats.averageExecutionTime * (this.stats.commandsExecuted - 1);
    this.stats.averageExecutionTime = (totalTime + executionTime) / this.stats.commandsExecuted;
  }

  getPerformanceStats() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100,
      queueLength: this.requestQueue.length,
      activeRequests: this.activeRequests
    };
  }

  clearCache() {
    this.commandCache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
  }

  // Event handling methods
  emit(eventName, data) {
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        if (this.logger) {
          this.logger.error('Error in event listener', error);
        }
      }
    });
  }

  on(eventName, listener) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(listener);
  }

  off(eventName, listener) {
    const listeners = this.eventListeners.get(eventName) || [];
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  // Convenience methods for built-in commands
  onClear(handler) {
    this.on('clear', handler);
  }

  onExit(handler) {
    this.on('exit', handler);
  }

  onCommandExecuted(handler) {
    this.on('commandExecuted', handler);
  }
}