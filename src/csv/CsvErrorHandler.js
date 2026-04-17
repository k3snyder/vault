/**
 * CsvErrorHandler.js - Error handling utility for CSV Editor Pro
 *
 * Provides:
 * - User-friendly error messages
 * - Retry with exponential backoff for transient errors
 * - Proper error logging with context
 * - Graceful degradation patterns
 */

import toastManager from '../plugin-hub/components/Toast.js';

/**
 * Error types for CSV operations
 */
export const CsvErrorType = {
  LOAD_ERROR: 'LOAD_ERROR',
  SAVE_ERROR: 'SAVE_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  PERMISSION_ERROR: 'PERMISSION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * User-friendly error messages mapped by error type and pattern
 */
const ERROR_MESSAGES = {
  [CsvErrorType.LOAD_ERROR]: {
    default: 'Unable to load the CSV file. Please check if the file exists and try again.',
    suggestions: ['Verify the file path is correct', 'Check if the file is accessible', 'Try closing and reopening the file']
  },
  [CsvErrorType.SAVE_ERROR]: {
    default: 'Unable to save changes. Your edits are preserved - please try again.',
    suggestions: ['Check if you have write permissions', 'Verify the file is not open in another application', 'Try saving to a different location']
  },
  [CsvErrorType.PARSE_ERROR]: {
    default: 'The CSV file appears to be malformed or has an unsupported format.',
    suggestions: ['Check if the file is a valid CSV', 'Verify the delimiter format', 'Try opening the file in a text editor to inspect']
  },
  [CsvErrorType.SCHEMA_ERROR]: {
    default: 'Unable to process the column schema.',
    suggestions: ['Try regenerating the schema', 'Clear the schema and start fresh']
  },
  [CsvErrorType.PERMISSION_ERROR]: {
    default: 'Permission denied. You may not have access to this file.',
    suggestions: ['Check your file permissions', 'Contact your administrator if this is a shared file']
  },
  [CsvErrorType.NETWORK_ERROR]: {
    default: 'A network issue occurred. Please check your connection.',
    suggestions: ['Verify your internet connection', 'Try again in a few moments']
  },
  [CsvErrorType.VALIDATION_ERROR]: {
    default: 'The data entered is not valid.',
    suggestions: ['Check the format of your input', 'Ensure required fields are filled']
  },
  [CsvErrorType.PREMIUM_REQUIRED]: {
    default: 'This feature requires a premium license.',
    suggestions: ['Start a free trial to access this feature', 'Upgrade to unlock all features']
  },
  [CsvErrorType.FILE_NOT_FOUND]: {
    default: 'The file could not be found.',
    suggestions: ['Check if the file was moved or deleted', 'Verify the file path']
  },
  [CsvErrorType.UNKNOWN_ERROR]: {
    default: 'An unexpected error occurred.',
    suggestions: ['Try again', 'If the problem persists, restart the application']
  }
};

/**
 * Patterns to detect error types from error messages
 */
const ERROR_PATTERNS = [
  { pattern: /not found|no such file|ENOENT/i, type: CsvErrorType.FILE_NOT_FOUND },
  { pattern: /permission|access denied|EACCES|EPERM/i, type: CsvErrorType.PERMISSION_ERROR },
  { pattern: /network|fetch|connection|ECONNREFUSED/i, type: CsvErrorType.NETWORK_ERROR },
  { pattern: /parse|malformed|invalid csv|unexpected token/i, type: CsvErrorType.PARSE_ERROR },
  { pattern: /schema|column|type inference/i, type: CsvErrorType.SCHEMA_ERROR },
  { pattern: /premium|license|trial|subscription/i, type: CsvErrorType.PREMIUM_REQUIRED },
  { pattern: /validation|invalid|required field/i, type: CsvErrorType.VALIDATION_ERROR },
  { pattern: /save|write|store/i, type: CsvErrorType.SAVE_ERROR },
  { pattern: /load|read|open/i, type: CsvErrorType.LOAD_ERROR }
];

/**
 * Map Rust CsvError codes to error types
 * These match the serialized format from src-tauri/src/csv/types.rs CsvError enum
 * with #[serde(tag = "code", content = "details", rename_all = "camelCase")]
 */
const ERROR_CODE_MAP = {
  'premiumRequired': CsvErrorType.PREMIUM_REQUIRED,
  'schemaNotFound': CsvErrorType.SCHEMA_ERROR,
  'schemaParseError': CsvErrorType.SCHEMA_ERROR,
  'parseError': CsvErrorType.PARSE_ERROR,
  'readError': CsvErrorType.FILE_NOT_FOUND,
  'writeError': CsvErrorType.SAVE_ERROR,
  'noVaultSelected': CsvErrorType.UNKNOWN_ERROR,
  'pathViolation': CsvErrorType.PERMISSION_ERROR,
  'lockPoisoned': CsvErrorType.UNKNOWN_ERROR
};

/**
 * Classify an error into an error type
 * @param {Error|string} error - The error to classify
 * @param {string} context - Additional context about the operation
 * @returns {string} The error type
 */
export function classifyError(error, context = '') {
  // First check for Rust CsvError code (from Tauri IPC)
  if (error && typeof error === 'object' && error.code) {
    const mappedType = ERROR_CODE_MAP[error.code];
    if (mappedType) {
      return mappedType;
    }
  }

  // Fall back to message-based pattern matching
  const errorMessage = typeof error === 'string' ? error : (error?.message || '');
  const combinedContext = `${errorMessage} ${context}`.toLowerCase();

  for (const { pattern, type } of ERROR_PATTERNS) {
    if (pattern.test(combinedContext)) {
      return type;
    }
  }

  return CsvErrorType.UNKNOWN_ERROR;
}

/**
 * Get a user-friendly error message
 * @param {string} errorType - The classified error type
 * @param {Error|string} originalError - The original error
 * @returns {Object} Object with message and suggestions
 */
export function getUserFriendlyMessage(errorType, originalError = null) {
  const errorInfo = ERROR_MESSAGES[errorType] || ERROR_MESSAGES[CsvErrorType.UNKNOWN_ERROR];

  return {
    message: errorInfo.default,
    suggestions: errorInfo.suggestions,
    technicalDetails: originalError ? (typeof originalError === 'string' ? originalError : originalError.message) : null
  };
}

/**
 * Extract message from various error formats
 * @param {Error|string|Object} error - The error object
 * @returns {string} The error message
 */
function extractErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (!error) return 'Unknown error';

  // Standard JS Error
  if (error.message) return error.message;

  // Rust CsvError format: { code, details }
  // Details format varies by error type - see src-tauri/src/csv/types.rs
  if (error.code) {
    const details = error.details || {};
    switch (error.code) {
      case 'premiumRequired':
        return `Premium feature required: ${details.feature || 'this feature'}`;
      case 'schemaNotFound':
        return `Schema not found for: ${details.path || 'this file'}`;
      case 'schemaParseError':
        return details.message || 'Failed to parse schema file';
      case 'parseError':
        return details.message || 'Failed to parse CSV data';
      case 'readError':
        return details.message || 'Failed to read CSV file';
      case 'writeError':
        return details.message || 'Failed to write CSV file';
      case 'noVaultSelected':
        return 'No vault is currently selected';
      case 'pathViolation':
        return `Path outside vault boundary: ${details.path || 'unknown'}`;
      case 'lockPoisoned':
        return 'Internal state error - please restart the application';
      default:
        return details.message || `Error: ${error.code}`;
    }
  }

  return 'Unknown error';
}

/**
 * Error log entry structure
 */
class ErrorLogEntry {
  constructor(error, context, errorType) {
    this.timestamp = new Date().toISOString();
    this.errorType = errorType;
    this.message = extractErrorMessage(error);
    this.stack = error?.stack || null;
    this.context = context;
    this.id = `csv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      errorType: this.errorType,
      message: this.message,
      context: this.context
    };
  }
}

/**
 * CSV Error Handler class
 * Provides centralized error handling for CSV Editor
 */
export class CsvErrorHandler {
  constructor(options = {}) {
    this.errorLog = [];
    this.maxLogSize = options.maxLogSize || 100;
    this.onError = options.onError || null;
    this.enableToasts = options.enableToasts !== false;
    this.enableConsoleLog = options.enableConsoleLog !== false;

    // Retry configuration
    this.defaultRetryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 10000, // 10 seconds
      backoffMultiplier: 2
    };
  }

  /**
   * Log an error with context
   * @param {Error|string} error - The error
   * @param {Object} context - Additional context
   * @returns {ErrorLogEntry} The log entry
   */
  logError(error, context = {}) {
    const errorType = classifyError(error, context.operation || '');
    const entry = new ErrorLogEntry(error, context, errorType);

    // Add to log
    this.errorLog.unshift(entry);

    // Trim log if needed
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(0, this.maxLogSize);
    }

    // Console logging
    if (this.enableConsoleLog) {
      console.error(`[CSV Editor] ${entry.errorType}:`, {
        message: entry.message,
        context: entry.context,
        timestamp: entry.timestamp
      });
      if (error?.stack) {
        console.debug('[CSV Editor] Stack trace:', error.stack);
      }
    }

    // Callback
    if (this.onError) {
      this.onError(entry);
    }

    return entry;
  }

  /**
   * Handle an error with user feedback
   * @param {Error|string} error - The error
   * @param {Object} options - Handler options
   * @returns {Object} Error info with user-friendly message
   */
  handleError(error, options = {}) {
    const {
      operation = 'operation',
      showToast = true,
      toastDuration = 5000,
      context = {}
    } = options;

    // Log the error
    const entry = this.logError(error, { operation, ...context });

    // Get user-friendly message
    const friendlyInfo = getUserFriendlyMessage(entry.errorType, error);

    // Show toast notification
    if (this.enableToasts && showToast) {
      toastManager.error(friendlyInfo.message, toastDuration);
    }

    return {
      ...friendlyInfo,
      errorType: entry.errorType,
      logId: entry.id
    };
  }

  /**
   * Check if an error is transient (worth retrying)
   * @param {Error|string} error - The error to check
   * @returns {boolean} True if the error is transient
   */
  isTransientError(error) {
    const errorType = classifyError(error);
    const transientTypes = [
      CsvErrorType.NETWORK_ERROR,
      CsvErrorType.SAVE_ERROR, // File locks are often temporary
      CsvErrorType.LOAD_ERROR  // File system hiccups can be temporary
    ];

    // Also check for specific transient patterns
    const errorMessage = typeof error === 'string' ? error : (error?.message || '');
    const transientPatterns = [
      /timeout/i,
      /EBUSY/i,
      /EAGAIN/i,
      /temporary/i,
      /try again/i,
      /rate limit/i,
      /too many requests/i
    ];

    if (transientPatterns.some(pattern => pattern.test(errorMessage))) {
      return true;
    }

    return transientTypes.includes(errorType);
  }

  /**
   * Execute an operation with retry logic
   * @param {Function} operation - Async function to execute
   * @param {Object} options - Retry options
   * @returns {Promise} Result of the operation
   */
  async withRetry(operation, options = {}) {
    const config = { ...this.defaultRetryConfig, ...options };
    const { maxRetries, baseDelay, maxDelay, backoffMultiplier } = config;
    const operationName = options.operationName || 'operation';

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();

        // Log successful retry if not first attempt
        if (attempt > 0) {
          console.log(`[CSV Editor] ${operationName} succeeded on attempt ${attempt + 1}`);
        }

        return result;
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (attempt < maxRetries && this.isTransientError(error)) {
          // Calculate delay with exponential backoff
          const delay = Math.min(
            baseDelay * Math.pow(backoffMultiplier, attempt),
            maxDelay
          );

          // Add jitter (up to 20% of delay)
          const jitter = delay * 0.2 * Math.random();
          const totalDelay = delay + jitter;

          console.log(
            `[CSV Editor] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
            `retrying in ${Math.round(totalDelay)}ms...`
          );

          // Show retry toast on first failure
          if (attempt === 0 && this.enableToasts) {
            toastManager.warning(`${operationName} failed, retrying...`, 2000);
          }

          await this.delay(totalDelay);
        } else {
          // Non-transient error or max retries reached
          break;
        }
      }
    }

    // All retries exhausted
    throw lastError;
  }

  /**
   * Helper to create a delay promise
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a graceful degradation wrapper
   * Returns fallback value on error instead of throwing
   * @param {Function} operation - Async function to execute
   * @param {any} fallbackValue - Value to return on error
   * @param {Object} options - Options
   * @returns {Promise} Result or fallback value
   */
  async withGracefulDegradation(operation, fallbackValue, options = {}) {
    const { operationName = 'operation', logError = true, showToast = false } = options;

    try {
      return await operation();
    } catch (error) {
      if (logError) {
        this.logError(error, { operation: operationName, gracefullyDegraded: true });
      }

      if (showToast && this.enableToasts) {
        toastManager.warning(`${operationName} unavailable, using default behavior`, 3000);
      }

      console.warn(
        `[CSV Editor] ${operationName} failed, gracefully degrading to fallback:`,
        fallbackValue
      );

      return fallbackValue;
    }
  }

  /**
   * Show a confirmation dialog for retry
   * @param {string} message - Message to show
   * @param {Object} options - Dialog options
   * @returns {Promise<boolean>} True if user wants to retry
   */
  async promptRetry(message, options = {}) {
    const { suggestions = [] } = options;

    let fullMessage = message;
    if (suggestions.length > 0) {
      fullMessage += '\n\nSuggestions:\n' + suggestions.map(s => `- ${s}`).join('\n');
    }
    fullMessage += '\n\nWould you like to try again?';

    return window.confirm(fullMessage);
  }

  /**
   * Get error log entries
   * @param {Object} filter - Optional filter
   * @returns {Array} Filtered error entries
   */
  getErrorLog(filter = {}) {
    let entries = [...this.errorLog];

    if (filter.errorType) {
      entries = entries.filter(e => e.errorType === filter.errorType);
    }

    if (filter.since) {
      const sinceTime = new Date(filter.since).getTime();
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
    }

    if (filter.limit) {
      entries = entries.slice(0, filter.limit);
    }

    return entries;
  }

  /**
   * Clear the error log
   */
  clearErrorLog() {
    this.errorLog = [];
  }

  /**
   * Export error log for debugging
   * @returns {string} JSON string of error log
   */
  exportErrorLog() {
    return JSON.stringify(this.errorLog.map(e => e.toJSON()), null, 2);
  }
}

// Create singleton instance
export const csvErrorHandler = new CsvErrorHandler();

// Export default
export default csvErrorHandler;
