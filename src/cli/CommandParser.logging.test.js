import { jest } from '@jest/globals';
import { CommandParser } from './CommandParser.js';

describe('CommandParser - Error Handling and Logging', () => {
    let parser;
    let mockLogger;
    let mockErrorHandler;
    
    beforeEach(() => {
        // Mock logger
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn()
        };
        
        // Mock error handler
        mockErrorHandler = {
            handleError: jest.fn(),
            handleWarning: jest.fn()
        };
        
        // Create parser with mocks
        parser = new CommandParser({
            logger: mockLogger,
            errorHandler: mockErrorHandler
        });
    });
    
    describe('input validation logging', () => {
        it('should log debug info for valid commands', () => {
            parser.parseCommand('ls -la');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Parsing command',
                'ls -la'
            );
        });
        
        it('should log warnings for invalid input', () => {
            const result = parser.parseCommand(null);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Invalid input',
                null
            );
            expect(result).toBeNull();
        });
        
        it('should log warnings for empty commands', () => {
            const result = parser.parseCommand('   ');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Empty command'
            );
            expect(result).toBeNull();
        });
        
        it('should log warnings for special characters only', () => {
            const result = parser.parseCommand('|||');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Command contains only special characters',
                '|||'
            );
            expect(result).toBeNull();
        });
    });
    
    describe('parsing error handling', () => {
        it('should handle unclosed quotes gracefully', () => {
            const result = parser.parseCommand('echo "hello world');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandParser: Unclosed quotes detected',
                'echo "hello world'
            );
            expect(mockErrorHandler.handleWarning).toHaveBeenCalledWith(
                'Unclosed quotes in command',
                'CommandParser.tokenize'
            );
            expect(result).not.toBeNull();
            expect(result.command).toBe('echo');
        });
        
        it('should handle unmatched quotes', () => {
            const result = parser.parseCommand('echo "hello \'world"');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Mixed quote types detected',
                expect.any(String)
            );
            expect(result).not.toBeNull();
        });
        
        it('should handle incomplete escape sequences', () => {
            const result = parser.parseCommand('echo hello\\');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Trailing escape character',
                'echo hello\\'
            );
            expect(result).not.toBeNull();
            expect(result.args).toContain('hello');
        });
        
        it('should handle malformed operators', () => {
            const result = parser.parseCommand('ls |');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandParser: Missing command after pipe operator'
            );
            expect(mockErrorHandler.handleWarning).toHaveBeenCalledWith(
                'Incomplete pipe command',
                'CommandParser.parsePipedCommand'
            );
            expect(result).not.toBeNull();
        });
        
        it('should handle empty redirect targets', () => {
            const result = parser.parseCommand('echo hello >');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandParser: Missing redirect target'
            );
            expect(mockErrorHandler.handleWarning).toHaveBeenCalledWith(
                'No target specified for redirection',
                'CommandParser.parseRedirectCommand'
            );
            expect(result).not.toBeNull();
        });
    });
    
    describe('complex command logging', () => {
        it('should log pipe command parsing', () => {
            parser.parseCommand('ls | grep test');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Parsing piped command'
            );
        });
        
        it('should log redirect command parsing', () => {
            parser.parseCommand('echo hello > output.txt');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Parsing redirect command',
                '>'
            );
        });
        
        it('should log chained command parsing', () => {
            parser.parseCommand('mkdir test && cd test');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Parsing chained command',
                '&&'
            );
        });
        
        it('should log background command detection', () => {
            parser.parseCommand('npm start &');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Background command detected'
            );
        });
    });
    
    describe('tokenization errors', () => {
        it('should handle extremely long commands', () => {
            const longCommand = 'echo ' + 'a'.repeat(10000);
            const result = parser.parseCommand(longCommand);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Processing very long command',
                expect.any(Number)
            );
            expect(result).not.toBeNull();
        });
        
        it('should handle deeply nested quotes', () => {
            const nested = 'echo "a \'b "c \'d\' e" f\' g"';
            const result = parser.parseCommand(nested);
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Complex quote nesting detected'
            );
            expect(result).not.toBeNull();
        });
        
        it('should handle special characters in arguments', () => {
            const result = parser.parseCommand('echo $HOME/path');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Special characters in arguments detected'
            );
            expect(result).not.toBeNull();
        });
    });
    
    describe('option parsing errors', () => {
        it('should handle malformed long options', () => {
            const result = parser.parseCommand('command --option=');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Empty value for option',
                'option'
            );
            expect(result.options.option).toBe('');
        });
        
        it('should handle invalid short options', () => {
            const result = parser.parseCommand('command -');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandParser: Isolated dash treated as argument'
            );
            expect(result.args).toContain('-');
        });
        
        it('should handle mixed option styles gracefully', () => {
            const result = parser.parseCommand('command -abc --def -g hi --jkl=value');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Parsed options',
                expect.objectContaining({
                    a: true,
                    b: true,
                    c: true,
                    def: true,
                    g: 'hi',
                    jkl: 'value'
                })
            );
            expect(result).not.toBeNull();
        });
    });
    
    describe('error recovery', () => {
        it('should recover from parsing errors and return partial result', () => {
            const result = parser.parseCommand('ls -la | ');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'CommandParser: Recovered from parsing error, returning partial result'
            );
            expect(result).not.toBeNull();
            expect(result.command).toBe('ls');
        });
        
        it('should provide helpful context on errors', () => {
            parser.parseCommand('echo "unclosed');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'CommandParser: Error context',
                expect.objectContaining({
                    position: expect.any(Number),
                    near: expect.any(String)
                })
            );
        });
    });
    
    describe('performance logging', () => {
        it('should log parsing time for complex commands', () => {
            const complex = 'find . -name "*.js" -type f | xargs grep -l "test" | sort | uniq > results.txt';
            parser.parseCommand(complex);
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandParser: Command parsed',
                expect.objectContaining({
                    elapsed: expect.any(Number),
                    complexity: 'high'
                })
            );
        });
    });
});