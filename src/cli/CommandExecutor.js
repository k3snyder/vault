export class CommandExecutor {
  constructor(options = {}) {
    this.parser = options.parser;
    this.ghosttyProcess = options.ghosttyProcess;
    this.aliases = new Map();
    this.eventListeners = new Map();
    
    // Built-in command handlers
    this.builtinHandlers = new Map();
    this.specialHandlers = new Map();
    
    // Register default built-in commands
    this.builtinCommands = ['clear', 'exit', 'help'];
    
    // Logging and error handling
    this.logger = options.logger || null;
    this.errorHandler = options.errorHandler || null;
    
    // Retry configuration
    this.maxRetries = 3;
  }

  async executeCommand(command) {
    try {
      if (this.logger) {
        this.logger.debug('CommandExecutor: Executing command', command);
      }
      
      // Check for empty command
      if (!command || !command.trim()) {
        if (this.logger) {
          this.logger.warn('CommandExecutor: Empty command received');
        }
        const result = {
          success: false,
          command,
          error: 'Empty command'
        };
        this.emit('commandExecuted', result);
        return result;
      }

      // Check if terminal process is running
      if (!this.ghosttyProcess) {
        const error = new Error('Terminal process not running');
        if (this.logger) {
          this.logger.error('CommandExecutor: No terminal process available');
        }
        if (this.errorHandler) {
          this.errorHandler.handleError(error, 'CommandExecutor.executeCommand');
        }
        const result = {
          success: false,
          command,
          error: error.message
        };
        this.emit('commandExecuted', result);
        return result;
      }

      // Parse the command
      const parsed = this.parser.parseCommand(command);
      if (!parsed) {
        const error = new Error('Failed to parse command');
        if (this.logger) {
          this.logger.error('CommandExecutor: Failed to parse command', command);
        }
        if (this.errorHandler) {
          this.errorHandler.handleError(error, 'CommandExecutor.parseCommand');
        }
        const result = {
          success: false,
          command,
          error: error.message
        };
        this.emit('commandExecuted', result);
        return result;
      }

      // Check for aliases
      let expandedCommand = command;
      if (this.aliases.has(parsed.command)) {
        const aliasValue = this.aliases.get(parsed.command);
        // Replace the command with the alias, keeping any additional arguments and options
        const remainingParts = command.split(/\s+/).slice(1).join(' ');
        expandedCommand = remainingParts ? `${aliasValue} ${remainingParts}` : aliasValue;
        
        if (this.logger) {
          this.logger.debug('CommandExecutor: Expanding alias', parsed.command, aliasValue);
        }
      }

      // Check for built-in commands
      if (this.isBuiltinCommand(parsed.command)) {
        if (this.logger) {
          this.logger.debug('CommandExecutor: Executing built-in command', parsed.command);
        }
        
        const handler = this.builtinHandlers.get(parsed.command);
        if (handler) {
          try {
            handler(parsed);
          } catch (handlerError) {
            if (this.logger) {
              this.logger.error('CommandExecutor: Error in built-in command handler', parsed.command, handlerError);
            }
            if (this.errorHandler) {
              this.errorHandler.handleError(handlerError, `CommandExecutor.builtinHandler.${parsed.command}`);
            }
            const result = {
              success: false,
              command,
              error: handlerError.message
            };
            this.emit('commandExecuted', result);
            return result;
          }
        }
        const result = {
          success: true,
          command,
          handled: 'builtin'
        };
        this.emit('commandExecuted', result);
        return result;
      }

      // Check for special commands (like cd)
      if (parsed.command === 'cd' && this.specialHandlers.has('cd')) {
        const handler = this.specialHandlers.get('cd');
        const path = parsed.args[0] || '~';
        handler(path);
        // Still send to terminal
        this.ghosttyProcess.write(command + '\n');
        const result = {
          success: true,
          command,
          handled: 'special'
        };
        this.emit('commandExecuted', result);
        return result;
      }

      // Execute the command (possibly expanded from alias) with retry logic
      let retryCount = 0;
      let writeSuccess = false;
      let lastError = null;
      
      while (retryCount < this.maxRetries && !writeSuccess) {
        try {
          this.ghosttyProcess.write(expandedCommand + '\n');
          writeSuccess = true;
        } catch (writeError) {
          lastError = writeError;
          retryCount++;
          
          if (retryCount < this.maxRetries) {
            if (this.logger) {
              this.logger.warn('CommandExecutor: Retrying command after write failure');
            }
          } else {
            if (this.logger) {
              this.logger.error('CommandExecutor: Max retry attempts reached', this.maxRetries);
              this.logger.error('CommandExecutor: Failed to write to terminal', writeError);
            }
            if (this.errorHandler) {
              this.errorHandler.handleError(writeError, 'CommandExecutor.write');
            }
          }
        }
      }
      
      if (!writeSuccess) {
        const result = {
          success: false,
          command,
          error: lastError ? lastError.message : 'Failed to write to terminal'
        };
        this.emit('commandExecuted', result);
        return result;
      }
      
      const result = {
        success: true,
        command
      };
      
      // Add expanded info if alias was used
      if (expandedCommand !== command) {
        result.expanded = expandedCommand;
      }
      
      if (this.logger) {
        this.logger.info('CommandExecutor: Command executed successfully', result);
      }
      
      this.emit('commandExecuted', result);
      return result;

    } catch (error) {
      if (this.logger) {
        this.logger.error('CommandExecutor: Exception during command execution', error);
      }
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'CommandExecutor.executeCommand');
      }
      const result = {
        success: false,
        command,
        error: error.message
      };
      this.emit('commandExecuted', result);
      return result;
    }
  }

  isBuiltinCommand(command) {
    return this.builtinCommands.includes(command);
  }

  // Event handling
  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  off(event, handler) {
    if (!this.eventListeners.has(event)) {
      return;
    }
    const handlers = this.eventListeners.get(event);
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  emit(event, ...args) {
    if (!this.eventListeners.has(event)) {
      return;
    }
    const handlers = this.eventListeners.get(event);
    handlers.forEach(handler => {
      try {
        handler(...args);
      } catch (error) {
        if (this.logger) {
          this.logger.error('CommandExecutor: Error in event handler', event, error);
        }
        // Don't throw - allow other handlers to execute
      }
    });
  }

  // Built-in command handlers
  onClear(handler) {
    this.builtinHandlers.set('clear', handler);
  }

  onExit(handler) {
    this.builtinHandlers.set('exit', handler);
  }

  onHelp(handler) {
    this.builtinHandlers.set('help', handler);
  }

  onCd(handler) {
    this.specialHandlers.set('cd', handler);
  }

  // Alias management
  addAlias(alias, command) {
    if (this.aliases.has(alias)) {
      const oldValue = this.aliases.get(alias);
      if (this.logger) {
        this.logger.warn('CommandExecutor: Overwriting existing alias', alias, oldValue, command);
      }
    } else {
      if (this.logger) {
        this.logger.info('CommandExecutor: Alias added', alias, command);
      }
    }
    this.aliases.set(alias, command);
  }

  removeAlias(alias) {
    if (this.logger) {
      this.logger.info('CommandExecutor: Alias removed', alias);
    }
    this.aliases.delete(alias);
  }

  getAlias(alias) {
    return this.aliases.get(alias);
  }

  getAllAliases() {
    const result = {};
    this.aliases.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  clearAliases() {
    if (this.logger) {
      this.logger.info('CommandExecutor: All aliases cleared');
    }
    this.aliases.clear();
  }
}