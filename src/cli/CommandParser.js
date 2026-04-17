export class CommandParser {
  constructor(options = {}) {
    this.specialChars = {
      pipe: '|',
      redirectOut: '>',
      redirectAppend: '>>',
      background: '&',
      chainAnd: '&&',
      chainOr: '||',
      separator: ';'
    };
    
    // Logging and error handling
    this.logger = options.logger || null;
    this.errorHandler = options.errorHandler || null;
  }

  parseCommand(input) {
    const startTime = performance.now();
    
    if (this.logger) {
      this.logger.debug('CommandParser: Parsing command', input);
    }
    
    if (!this.isValidCommand(input)) {
      return null;
    }

    const trimmed = input.trim();
    const result = {
      raw: input
    };

    // Handle special operators (order matters!)
    // Check for chained commands first (they contain |)
    if (trimmed.includes('&&')) {
      const parsed = this.parseChainedCommand(trimmed, '&&', result);
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    if (trimmed.includes('||')) {
      const parsed = this.parseChainedCommand(trimmed, '||', result);
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    if (trimmed.includes(';')) {
      const parsed = this.parseChainedCommand(trimmed, ';', result);
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    // Then check for single pipe
    if (trimmed.includes('|')) {
      const parsed = this.parsePipedCommand(trimmed, result);
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    // Then redirections
    if (trimmed.includes('>>')) {
      const parsed = this.parseRedirectCommand(trimmed, '>>', result);
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    if (trimmed.includes('>')) {
      const parsed = this.parseRedirectCommand(trimmed, '>', result);
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    // Handle background operator
    if (trimmed.endsWith(' &')) {
      if (this.logger) {
        this.logger.debug('CommandParser: Background command detected');
      }
      const withoutBackground = trimmed.slice(0, -2).trim();
      const parsed = { ...this.parseSimpleCommand(withoutBackground), ...result, background: true };
      this.logParsingCompletion(parsed, input, startTime);
      return parsed;
    }

    // Parse simple command
    const parsed = { ...this.parseSimpleCommand(trimmed), ...result };
    this.logParsingCompletion(parsed, input, startTime);
    return parsed;
  }
  
  logParsingCompletion(parsed, input, startTime) {
    if (this.logger) {
      const elapsed = performance.now() - startTime;
      const complexity = this.determineComplexity(parsed);
      // Always log for long commands or high complexity
      if (complexity === 'high' || input.trim().length > 70 || (parsed.pipe && parsed.redirect)) {
        this.logger.debug('CommandParser: Command parsed', { elapsed, complexity });
      }
    }
  }
  
  determineComplexity(parsed) {
    // Check for chains or multiple pipes (high complexity)
    if (parsed.chain) {
      return 'high';
    }
    
    // Check for nested pipes (command | command | command)
    if (parsed.pipe) {
      let current = parsed.pipe;
      let pipeCount = 1;
      while (current && current.pipe) {
        pipeCount++;
        current = current.pipe;
      }
      if (pipeCount > 1) {
        return 'high';
      }
    }
    
    // Check for redirects with pipes
    if (parsed.pipe && parsed.redirect) {
      return 'high';
    }
    
    if (parsed.pipe || parsed.redirect) {
      return 'medium';
    }
    return 'low';
  }

  parseSimpleCommand(input) {
    const tokens = this.tokenize(input);
    if (tokens.length === 0) {
      return null;
    }

    const command = tokens[0];
    const { options, remaining } = this.extractOptions(tokens.slice(1));

    return {
      command,
      args: remaining,
      options
    };
  }

  parsePipedCommand(input, result) {
    if (this.logger) {
      this.logger.debug('CommandParser: Parsing piped command');
    }
    
    // Find single pipe not part of || operator
    let pipeIndex = -1;
    for (let i = 0; i < input.length; i++) {
      if (input[i] === '|' && input[i+1] !== '|' && (i === 0 || input[i-1] !== '|')) {
        pipeIndex = i;
        break;
      }
    }

    if (pipeIndex === -1) {
      return this.parseSimpleCommand(input);
    }

    const firstPart = input.slice(0, pipeIndex).trim();
    const secondPart = input.slice(pipeIndex + 1).trim();
    
    // Check for empty parts
    if (!secondPart) {
      if (this.logger) {
        this.logger.error('CommandParser: Missing command after pipe operator');
      }
      if (this.errorHandler) {
        this.errorHandler.handleWarning('Incomplete pipe command', 'CommandParser.parsePipedCommand');
      }
    }

    const firstCommand = this.parseSimpleCommand(firstPart);
    const secondCommand = this.parseCommand(secondPart);  // Recursively parse to handle more pipes/redirects

    // Handle case where pipe has no following command
    if (!secondCommand && !secondPart) {
      if (this.logger) {
        this.logger.info('CommandParser: Recovered from parsing error, returning partial result');
      }
      return {...firstCommand, ...result};
    }

    return {
      ...firstCommand,
      ...result,
      pipe: secondCommand
    };
  }

  parseRedirectCommand(input, operator, result) {
    if (this.logger) {
      this.logger.debug('CommandParser: Parsing redirect command', operator);
    }
    
    const parts = input.split(operator);
    if (parts.length < 2) {
      return this.parseSimpleCommand(input);
    }

    const command = this.parseSimpleCommand(parts[0].trim());
    const target = parts[1].trim();
    
    // Check for empty target
    if (!target) {
      if (this.logger) {
        this.logger.error('CommandParser: Missing redirect target');
      }
      if (this.errorHandler) {
        this.errorHandler.handleWarning('No target specified for redirection', 'CommandParser.parseRedirectCommand');
      }
    }

    return {
      ...command,
      ...result,
      redirect: {
        type: operator,
        target
      }
    };
  }

  parseChainedCommand(input, operator, result) {
    if (this.logger) {
      this.logger.debug('CommandParser: Parsing chained command', operator);
    }
    
    // Find the operator position, considering it might be inside quotes
    let operatorIndex = -1;
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      
      // Handle quotes
      if ((char === '"' || char === "'") && (i === 0 || input[i-1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = null;
        }
      }

      // Check for operator when not in quotes
      if (!inQuotes && input.slice(i, i + operator.length) === operator) {
        operatorIndex = i;
        break;
      }
    }

    if (operatorIndex === -1) {
      return this.parseSimpleCommand(input);
    }

    const firstPart = input.slice(0, operatorIndex).trim();
    const secondPart = input.slice(operatorIndex + operator.length).trim();

    const firstCommand = this.parseSimpleCommand(firstPart);
    const secondCommand = this.parseCommand(secondPart);

    return {
      ...firstCommand,
      ...result,
      chain: {
        operator,
        next: {
          ...secondCommand,
          raw: secondPart
        }
      }
    };
  }

  tokenize(input) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;
    let escaped = false;
    let hasUnclosedQuotes = false;
    let hasMixedQuotes = false;
    let quoteDepth = [];

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        continue;
      }

      if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = null;
        continue;
      }

      if (char === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }
    
    // Check for trailing escape
    if (escaped) {
      if (this.logger) {
        this.logger.warn('CommandParser: Trailing escape character', input);
      }
    }
    
    // Check for unclosed quotes
    if (inQuotes) {
      hasUnclosedQuotes = true;
      if (this.logger) {
        this.logger.error('CommandParser: Unclosed quotes detected', input);
        // Provide error context
        const position = input.lastIndexOf(quoteChar);
        const near = input.slice(Math.max(0, position - 10), position + 10);
        this.logger.info('CommandParser: Error context', { position, near });
      }
      if (this.errorHandler) {
        this.errorHandler.handleWarning('Unclosed quotes in command', 'CommandParser.tokenize');
      }
    }

    if (current) {
      tokens.push(current);
    }
    
    // Check for special characters
    if (tokens.some(token => token.includes('$') || token.includes('~'))) {
      if (this.logger) {
        this.logger.debug('CommandParser: Special characters in arguments detected');
      }
    }
    
    // Detect complex quote nesting
    if (input.includes('"') && input.includes("'")) {
      if (this.logger) {
        this.logger.warn('CommandParser: Mixed quote types detected', input);
        this.logger.debug('CommandParser: Complex quote nesting detected');
      }
    }

    return tokens;
  }

  isValidCommand(input) {
    if (!input || typeof input !== 'string') {
      if (this.logger) {
        this.logger.warn('CommandParser: Invalid input', input);
      }
      return false;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      if (this.logger) {
        this.logger.warn('CommandParser: Empty command');
      }
      return false;
    }
    
    // Log very long commands
    if (trimmed.length > 1000) {
      if (this.logger) {
        this.logger.warn('CommandParser: Processing very long command', trimmed.length);
      }
    }

    // Check if it's only special characters
    const specialOnly = /^[|>&;]+$/.test(trimmed);
    if (specialOnly) {
      if (this.logger) {
        this.logger.warn('CommandParser: Command contains only special characters', trimmed);
      }
    }
    return !specialOnly;
  }

  extractOptions(tokens) {
    const options = {};
    const remaining = [];
    let skipNext = false;
    let foundDoubleDash = false;

    for (let i = 0; i < tokens.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const token = tokens[i];

      // Handle double dash
      if (token === '--') {
        foundDoubleDash = true;
        remaining.push(...tokens.slice(i + 1));
        break;
      }

      // After double dash, everything is an argument
      if (foundDoubleDash) {
        remaining.push(token);
        continue;
      }

      // Long option with equals
      if (token.startsWith('--') && token.includes('=')) {
        const [key, ...valueParts] = token.slice(2).split('=');
        const value = valueParts.join('=');
        if (!value && this.logger) {
          this.logger.warn('CommandParser: Empty value for option', key);
        }
        options[key] = value;
        continue;
      }

      // Long option
      if (token.startsWith('--')) {
        const key = token.slice(2);
        // Check if next token exists and is not an option
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
          options[key] = tokens[i + 1];
          skipNext = true;
        } else {
          options[key] = true;
        }
        continue;
      }

      // Short options
      if (token.startsWith('-') && token.length > 1 && !token.match(/^-\d/)) {
        const chars = token.slice(1).split('');
        
        // Check if this is a single option that expects a value
        // Only consume next token if it's clearly a value (common patterns like -m, -p, -o)
        const valueExpectingOptions = ['m', 'p', 'o', 'n', 'f', 'e', 'd', 'g'];
        if (chars.length === 1 && 
            valueExpectingOptions.includes(chars[0]) &&
            i + 1 < tokens.length && 
            !tokens[i + 1].startsWith('-')) {
          options[chars[0]] = tokens[i + 1];
          skipNext = true;
        } else {
          // Multiple short options combined or single flags
          chars.forEach(char => {
            options[char] = true;
          });
        }
        continue;
      }

      // Regular argument
      remaining.push(token);
    }
    
    // Handle isolated dash
    if (remaining.includes('-') && this.logger) {
      this.logger.warn('CommandParser: Isolated dash treated as argument');
    }
    
    // Log parsed options
    if (this.logger && Object.keys(options).length > 0) {
      this.logger.debug('CommandParser: Parsed options', options);
    }

    return { options, remaining };
  }
}