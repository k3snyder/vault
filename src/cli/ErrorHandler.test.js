import { jest } from '@jest/globals';
import ErrorHandler from './ErrorHandler.js';

describe('ErrorHandler', () => {
    let errorHandler;
    let mockLogger;
    let consoleErrorSpy;
    
    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Create mock logger
        mockLogger = {
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn()
        };
        
        // Spy on console.error
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        
        // Create error handler instance with mock logger
        errorHandler = new ErrorHandler(mockLogger);
    });
    
    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });
    
    describe('constructor', () => {
        test('should use provided logger instance', () => {
            expect(errorHandler.logger).toBe(mockLogger);
        });
        
        test('should initialize error registry', () => {
            expect(errorHandler.errors).toBeDefined();
            expect(errorHandler.errors).toBeInstanceOf(Array);
            expect(errorHandler.errors).toHaveLength(0);
        });
    });
    
    describe('handleError', () => {
        test('should log error with context', () => {
            const error = new Error('Test error');
            const context = 'TestComponent';
            
            errorHandler.handleError(error, context);
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                `Error in ${context}:`,
                error.message
            );
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Stack trace:',
                error.stack
            );
        });
        
        test('should store error in registry', () => {
            const error = new Error('Test error');
            const context = 'TestComponent';
            
            errorHandler.handleError(error, context);
            
            expect(errorHandler.errors).toHaveLength(1);
            expect(errorHandler.errors[0]).toMatchObject({
                error,
                context,
                timestamp: expect.any(Date)
            });
        });
        
        test('should handle non-Error objects', () => {
            const errorString = 'String error';
            const context = 'TestComponent';
            
            errorHandler.handleError(errorString, context);
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                `Error in ${context}:`,
                errorString
            );
        });
        
        test('should handle null/undefined errors', () => {
            errorHandler.handleError(null, 'TestComponent');
            errorHandler.handleError(undefined, 'TestComponent');
            
            expect(mockLogger.error).toHaveBeenCalledTimes(2);
        });
    });
    
    describe('handleWarning', () => {
        test('should log warning with context', () => {
            const message = 'Test warning';
            const context = 'TestComponent';
            
            errorHandler.handleWarning(message, context);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                `Warning in ${context}:`,
                message
            );
        });
        
        test('should not store warnings in error registry', () => {
            errorHandler.handleWarning('Test warning', 'TestComponent');
            
            expect(errorHandler.errors).toHaveLength(0);
        });
    });
    
    describe('createUserMessage', () => {
        test('should return user-friendly message for known error types', () => {
            const error = new Error('ENOENT: no such file or directory');
            
            const message = errorHandler.createUserMessage(error);
            
            expect(message).toBe('File or directory not found');
        });
        
        test('should return user-friendly message for permission errors', () => {
            const error = new Error('EACCES: permission denied');
            
            const message = errorHandler.createUserMessage(error);
            
            expect(message).toBe('Permission denied. Try running with appropriate permissions.');
        });
        
        test('should return user-friendly message for network errors', () => {
            const error = new Error('ECONNREFUSED');
            
            const message = errorHandler.createUserMessage(error);
            
            expect(message).toBe('Connection refused. Please check if the service is running.');
        });
        
        test('should return generic message for unknown errors', () => {
            const error = new Error('Unknown error type');
            
            const message = errorHandler.createUserMessage(error);
            
            expect(message).toBe('An unexpected error occurred. Please try again.');
        });
        
        test('should handle non-Error objects', () => {
            const message = errorHandler.createUserMessage('String error');
            
            expect(message).toBe('An unexpected error occurred. Please try again.');
        });
    });
    
    describe('getErrorSummary', () => {
        test('should return summary of all errors', () => {
            errorHandler.handleError(new Error('Error 1'), 'Component1');
            errorHandler.handleError(new Error('Error 2'), 'Component2');
            
            const summary = errorHandler.getErrorSummary();
            
            expect(summary).toHaveLength(2);
            expect(summary[0]).toMatchObject({
                context: 'Component1',
                message: 'Error 1',
                timestamp: expect.any(Date)
            });
            expect(summary[1]).toMatchObject({
                context: 'Component2',
                message: 'Error 2',
                timestamp: expect.any(Date)
            });
        });
        
        test('should return empty array when no errors', () => {
            const summary = errorHandler.getErrorSummary();
            
            expect(summary).toHaveLength(0);
        });
    });
    
    describe('clearErrors', () => {
        test('should clear all stored errors', () => {
            errorHandler.handleError(new Error('Error 1'), 'Component1');
            errorHandler.handleError(new Error('Error 2'), 'Component2');
            
            errorHandler.clearErrors();
            
            expect(errorHandler.errors).toHaveLength(0);
        });
    });
    
    describe('hasErrors', () => {
        test('should return true when errors exist', () => {
            errorHandler.handleError(new Error('Test'), 'Component');
            
            expect(errorHandler.hasErrors()).toBe(true);
        });
        
        test('should return false when no errors exist', () => {
            expect(errorHandler.hasErrors()).toBe(false);
        });
    });
    
    describe('getLastError', () => {
        test('should return the most recent error', () => {
            errorHandler.handleError(new Error('First error'), 'Component1');
            errorHandler.handleError(new Error('Last error'), 'Component2');
            
            const lastError = errorHandler.getLastError();
            
            expect(lastError.error.message).toBe('Last error');
            expect(lastError.context).toBe('Component2');
        });
        
        test('should return null when no errors exist', () => {
            expect(errorHandler.getLastError()).toBeNull();
        });
    });
    
    describe('formatErrorForDisplay', () => {
        test('should format error for terminal display', () => {
            const error = new Error('Test error');
            const context = 'TestComponent';
            
            const formatted = errorHandler.formatErrorForDisplay(error, context);
            
            expect(formatted).toContain('Error in TestComponent');
            expect(formatted).toContain('Test error');
            expect(formatted).toContain('─'); // Box drawing character
        });
        
        test('should include user-friendly message', () => {
            const error = new Error('ENOENT: no such file');
            const context = 'FileReader';
            
            const formatted = errorHandler.formatErrorForDisplay(error, context);
            
            expect(formatted).toContain('File or directory not found');
        });
    });
});