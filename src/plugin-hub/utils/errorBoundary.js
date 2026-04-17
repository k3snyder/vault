/**
 * Error Boundary Utility for Vanilla JavaScript
 * Provides error handling and recovery mechanisms
 */

class ErrorBoundary {
  constructor(options = {}) {
    this.errorHandlers = new Map();
    this.globalErrorHandler = options.onError || this.defaultErrorHandler;
    this.errorLog = [];
    this.maxErrorLogs = options.maxErrorLogs || 50;
    this.recoveryStrategies = new Map();
    
    // Set up global error handling
    this.setupGlobalHandlers();
  }
  
  /**
   * Set up global error handlers
   */
  setupGlobalHandlers() {
    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      this.handleError(event.error, {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
      event.preventDefault();
    });
    
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        type: 'unhandledRejection',
        promise: event.promise
      });
      event.preventDefault();
    });
  }
  
  /**
   * Default error handler
   */
  defaultErrorHandler(error, context) {
    console.error('Error caught by boundary:', error);
    console.error('Context:', context);
  }
  
  /**
   * Handle an error
   */
  handleError(error, context = {}) {
    // Log the error
    this.logError(error, context);
    
    // Try recovery strategies
    const recovered = this.tryRecover(error, context);
    
    if (!recovered) {
      // Call the global error handler
      this.globalErrorHandler(error, context);
    }
    
    return recovered;
  }
  
  /**
   * Log an error
   */
  logError(error, context) {
    const errorEntry = {
      timestamp: Date.now(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      context
    };
    
    this.errorLog.push(errorEntry);
    
    // Trim log if needed
    if (this.errorLog.length > this.maxErrorLogs) {
      this.errorLog.shift();
    }
  }
  
  /**
   * Try to recover from an error
   */
  tryRecover(error, context) {
    // Check for specific recovery strategies
    for (const [matcher, strategy] of this.recoveryStrategies) {
      if (matcher(error, context)) {
        try {
          strategy(error, context);
          return true;
        } catch (recoveryError) {
          console.error('Recovery strategy failed:', recoveryError);
        }
      }
    }
    
    return false;
  }
  
  /**
   * Register a recovery strategy
   */
  registerRecoveryStrategy(matcher, strategy) {
    this.recoveryStrategies.set(matcher, strategy);
  }
  
  /**
   * Wrap a function with error handling
   */
  wrap(fn, context = {}) {
    return (...args) => {
      try {
        const result = fn(...args);
        
        // Handle async functions
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            this.handleError(error, { ...context, args });
            throw error;
          });
        }
        
        return result;
      } catch (error) {
        this.handleError(error, { ...context, args });
        throw error;
      }
    };
  }
  
  /**
   * Wrap an async function with error handling
   */
  wrapAsync(fn, context = {}) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handleError(error, { ...context, args });
        throw error;
      }
    };
  }
  
  /**
   * Create a safe version of a function that won't throw
   */
  createSafe(fn, fallbackValue = null, context = {}) {
    return (...args) => {
      try {
        const result = fn(...args);
        
        // Handle async functions
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            this.handleError(error, { ...context, args });
            return fallbackValue;
          });
        }
        
        return result;
      } catch (error) {
        this.handleError(error, { ...context, args });
        return fallbackValue;
      }
    };
  }
  
  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {
      total: this.errorLog.length,
      byType: {},
      recentErrors: this.errorLog.slice(-10),
      errorRate: 0
    };
    
    // Calculate error types
    for (const entry of this.errorLog) {
      const type = entry.error.name || 'Unknown';
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    }
    
    // Calculate error rate (errors per minute)
    if (this.errorLog.length > 0) {
      const timeRange = Date.now() - this.errorLog[0].timestamp;
      stats.errorRate = (this.errorLog.length / (timeRange / 60000)).toFixed(2);
    }
    
    return stats;
  }
  
  /**
   * Clear error log
   */
  clearErrorLog() {
    this.errorLog = [];
  }
}

/**
 * Plugin-specific error boundary
 */
export class PluginErrorBoundary extends ErrorBoundary {
  constructor(pluginHub) {
    super({
      onError: (error, context) => {
        this.handlePluginError(error, context);
      }
    });
    
    this.pluginHub = pluginHub;
    this.setupRecoveryStrategies();
  }
  
  /**
   * Set up plugin-specific recovery strategies
   */
  setupRecoveryStrategies() {
    // Recover from API errors by retrying
    this.registerRecoveryStrategy(
      (error) => error.message && error.message.includes('Failed to fetch'),
      (error, context) => {
        console.log('Attempting to retry failed API call...');
        // Could implement retry logic here
      }
    );
    
    // Recover from state errors by resetting state
    this.registerRecoveryStrategy(
      (error) => error.message && error.message.includes('state'),
      (error, context) => {
        console.log('Attempting to recover state...');
        if (this.pluginHub && this.pluginHub.context) {
          this.pluginHub.context.clearError();
        }
      }
    );
    
    // Recover from view errors by switching to default view
    this.registerRecoveryStrategy(
      (error, context) => context && context.view,
      (error, context) => {
        console.log('Recovering from view error, switching to installed view...');
        if (this.pluginHub) {
          this.pluginHub.switchView('installed');
        }
      }
    );
  }
  
  /**
   * Handle plugin-specific errors
   */
  handlePluginError(error, context) {
    console.error('Plugin Error:', error);
    
    // Show user-friendly error message
    if (this.pluginHub && this.pluginHub.context) {
      const message = this.getUserFriendlyMessage(error);
      this.pluginHub.context.showToast(message, 'error', 5000);
    }
  }
  
  /**
   * Get user-friendly error message
   */
  getUserFriendlyMessage(error) {
    const errorMessages = {
      'NetworkError': 'Network connection issue. Please check your connection.',
      'Failed to fetch': 'Unable to connect to the server. Please try again.',
      'Permission denied': 'You don\'t have permission to perform this action.',
      'Plugin not found': 'The requested plugin could not be found.',
      'Invalid plugin': 'The plugin appears to be invalid or corrupted.',
      'Quota exceeded': 'Storage quota exceeded. Please free up some space.',
      'Timeout': 'The operation timed out. Please try again.'
    };
    
    // Check for known error patterns
    for (const [pattern, message] of Object.entries(errorMessages)) {
      if (error.message && error.message.includes(pattern)) {
        return message;
      }
    }
    
    // Default message
    return 'An unexpected error occurred. Please try again.';
  }
}

// Export singleton instance
export default ErrorBoundary;