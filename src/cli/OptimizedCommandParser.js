/**
 * Optimized Command Parser for improved performance
 * Target: <50ms parsing for complex commands
 */

export class OptimizedCommandParser {
  constructor(options = {}) {
    // Pre-compile regex patterns for better performance
    this.patterns = {
      whitespace: /\s+/,
      quotedString: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g,
      shortOption: /^-[a-zA-Z]$/,
      longOption: /^--[a-zA-Z][\w-]*$/,
      optionWithValue: /^(--?[a-zA-Z][\w-]*)=(.+)$/
    };
    
    // Cache for parsed commands to avoid re-parsing
    this.cache = new Map();
    this.cacheSize = 100; // Limit cache size
    
    // Pre-allocate arrays for tokenization
    this.tokenBuffer = new Array(50);
    
    // Logging and error handling
    this.logger = options.logger || null;
    this.errorHandler = options.errorHandler || null;
    this.enableProfiling = options.enableProfiling || false;
  }

  parseCommand(input) {
    if (!input || typeof input !== 'string') {
      return null;
    }
    
    // Check cache first
    const cached = this.cache.get(input);
    if (cached) {
      return { ...cached }; // Return copy to prevent mutations
    }
    
    const startTime = this.enableProfiling ? performance.now() : 0;
    
    // Trim once and reuse
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    
    // Fast path for simple commands without special operators
    const hasSpecialOps = this.hasSpecialOperators(trimmed);
    
    let result;
    if (!hasSpecialOps) {
      result = this.parseSimpleCommandFast(trimmed);
    } else {
      result = this.parseComplexCommand(trimmed);
    }
    
    result.raw = input;
    
    // Update cache
    this.updateCache(input, result);
    
    if (this.enableProfiling && this.logger) {
      const elapsed = performance.now() - startTime;
      if (elapsed > 10) { // Only log slow parses
        this.logger.debug(`CommandParser: Slow parse detected (${elapsed.toFixed(2)}ms)`);
      }
    }
    
    return result;
  }

  hasSpecialOperators(str) {
    // Single pass check for all operators
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '|' || char === '>' || char === '&' || char === ';') {
        return true;
      }
    }
    return false;
  }

  parseSimpleCommandFast(input) {
    const tokens = this.tokenizeFast(input);
    
    if (tokens.length === 0) {
      return { command: '', args: [], options: {} };
    }
    
    const command = tokens[0];
    const args = [];
    const options = {};
    
    // Process tokens in single pass
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (token[0] === '-') {
        // Option detected
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
          // Option with value
          options[token] = tokens[++i];
        } else {
          // Boolean option
          options[token] = true;
        }
      } else {
        // Regular argument
        args.push(token);
      }
    }
    
    return { command, args, options };
  }

  tokenizeFast(input) {
    let tokenCount = 0;
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let escape = false;
    
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      
      if (escape) {
        current += char;
        escape = false;
        continue;
      }
      
      if (char === '\\') {
        escape = true;
        continue;
      }
      
      if (!inQuote && (char === '"' || char === "'")) {
        inQuote = true;
        quoteChar = char;
        continue;
      }
      
      if (inQuote && char === quoteChar) {
        inQuote = false;
        quoteChar = '';
        continue;
      }
      
      if (!inQuote && char === ' ') {
        if (current) {
          this.tokenBuffer[tokenCount++] = current;
          current = '';
        }
        continue;
      }
      
      current += char;
    }
    
    if (current) {
      this.tokenBuffer[tokenCount++] = current;
    }
    
    // Return only the filled portion
    return this.tokenBuffer.slice(0, tokenCount);
  }

  parseComplexCommand(input) {
    // Handle complex commands with operators
    // This is called less frequently, so we can afford more checks
    
    // Check for pipe chains first
    if (input.includes('&&')) {
      return this.parseChainedCommand(input, '&&');
    }
    
    if (input.includes('||')) {
      return this.parseChainedCommand(input, '||');
    }
    
    if (input.includes(';')) {
      return this.parseChainedCommand(input, ';');
    }
    
    if (input.includes('|')) {
      return this.parsePipedCommand(input);
    }
    
    // Handle redirections
    if (input.includes('>>')) {
      return this.parseRedirectCommand(input, '>>');
    }
    
    if (input.includes('>')) {
      return this.parseRedirectCommand(input, '>');
    }
    
    // Handle background
    if (input.endsWith(' &')) {
      const withoutBackground = input.slice(0, -2).trim();
      return { ...this.parseSimpleCommandFast(withoutBackground), background: true };
    }
    
    return this.parseSimpleCommandFast(input);
  }

  parseChainedCommand(input, operator) {
    const parts = this.splitByOperator(input, operator);
    const firstCommand = this.parseCommand(parts[0]);
    const secondCommand = this.parseCommand(parts[1]);
    
    return {
      ...firstCommand,
      chain: {
        operator,
        next: secondCommand
      }
    };
  }

  parsePipedCommand(input) {
    const parts = this.splitByOperator(input, '|');
    const firstCommand = this.parseSimpleCommandFast(parts[0]);
    const secondCommand = this.parseCommand(parts[1]);
    
    return {
      ...firstCommand,
      pipe: secondCommand
    };
  }

  parseRedirectCommand(input, operator) {
    const parts = this.splitByOperator(input, operator);
    const command = this.parseSimpleCommandFast(parts[0]);
    const target = parts[1].trim();
    
    return {
      ...command,
      redirect: {
        type: operator === '>>' ? 'append' : 'output',
        target
      }
    };
  }

  splitByOperator(input, operator) {
    // Fast split that respects quotes
    const index = this.findOperatorIndex(input, operator);
    if (index === -1) {
      return [input, ''];
    }
    
    return [
      input.substring(0, index).trim(),
      input.substring(index + operator.length).trim()
    ];
  }

  findOperatorIndex(input, operator) {
    let inQuote = false;
    let quoteChar = '';
    
    for (let i = 0; i < input.length - operator.length + 1; i++) {
      const char = input[i];
      
      if (!inQuote && (char === '"' || char === "'")) {
        inQuote = true;
        quoteChar = char;
        continue;
      }
      
      if (inQuote && char === quoteChar && input[i - 1] !== '\\') {
        inQuote = false;
        continue;
      }
      
      if (!inQuote && input.substring(i, i + operator.length) === operator) {
        return i;
      }
    }
    
    return -1;
  }

  updateCache(key, value) {
    // LRU cache implementation
    if (this.cache.size >= this.cacheSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }

  clearCache() {
    this.cache.clear();
  }

  // Utility methods for compatibility
  isValidCommand(input) {
    return input && typeof input === 'string' && input.trim().length > 0;
  }

  extractOptions(tokens, startIndex = 1) {
    const args = [];
    const options = {};
    
    for (let i = startIndex; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (token === '--') {
        // Everything after -- is an argument
        args.push(...tokens.slice(i + 1));
        break;
      }
      
      if (token[0] === '-') {
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
          options[token] = tokens[++i];
        } else {
          options[token] = true;
        }
      } else {
        args.push(token);
      }
    }
    
    return { args, options };
  }
}