import Logger from './Logger.js';

class ErrorHandler {
    constructor(logger = null) {
        this.logger = logger || new Logger();
        this.errors = [];
    }
    
    handleError(error, context) {
        // Store error in registry
        this.errors.push({
            error,
            context,
            timestamp: new Date()
        });
        
        // Log the error
        if (error instanceof Error) {
            this.logger.error(`Error in ${context}:`, error.message);
            if (error.stack) {
                this.logger.error('Stack trace:', error.stack);
            }
        } else {
            this.logger.error(`Error in ${context}:`, error || 'Unknown error');
        }
    }
    
    handleWarning(message, context) {
        this.logger.warn(`Warning in ${context}:`, message);
    }
    
    createUserMessage(error) {
        if (!error) {
            return 'An unexpected error occurred. Please try again.';
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Map common error types to user-friendly messages
        if (errorMessage.includes('ENOENT')) {
            return 'File or directory not found';
        }
        
        if (errorMessage.includes('EACCES')) {
            return 'Permission denied. Try running with appropriate permissions.';
        }
        
        if (errorMessage.includes('ECONNREFUSED')) {
            return 'Connection refused. Please check if the service is running.';
        }
        
        if (errorMessage.includes('ETIMEDOUT')) {
            return 'Operation timed out. Please try again.';
        }
        
        if (errorMessage.includes('EADDRINUSE')) {
            return 'Port is already in use. Please choose a different port.';
        }
        
        // Default message
        return 'An unexpected error occurred. Please try again.';
    }
    
    getErrorSummary() {
        return this.errors.map(entry => ({
            context: entry.context,
            message: entry.error instanceof Error ? entry.error.message : String(entry.error),
            timestamp: entry.timestamp
        }));
    }
    
    clearErrors() {
        this.errors = [];
    }
    
    hasErrors() {
        return this.errors.length > 0;
    }
    
    getLastError() {
        if (this.errors.length === 0) {
            return null;
        }
        return this.errors[this.errors.length - 1];
    }
    
    formatErrorForDisplay(error, context) {
        const userMessage = this.createUserMessage(error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        const lines = [
            '',
            '┌─────────────────────────────────────────────────────────┐',
            `│ Error in ${context.padEnd(46)} │`,
            '├─────────────────────────────────────────────────────────┤',
            `│ ${userMessage.padEnd(55)} │`,
            '├─────────────────────────────────────────────────────────┤',
            `│ Technical: ${errorMessage.slice(0, 44).padEnd(44)} │`,
            '└─────────────────────────────────────────────────────────┘',
            ''
        ];
        
        return lines.join('\n');
    }
}

export default ErrorHandler;