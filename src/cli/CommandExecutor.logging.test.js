import { jest } from '@jest/globals';
import { CommandExecutor } from './CommandExecutor.js';

describe('CommandExecutor - Error Handling and Logging', () => {
    let executor;
    let mockParser;
    let mockGhosttyProcess;
    let mockLogger;
    let mockErrorHandler;
    
    beforeEach(() => {
        // Mock parser
        mockParser = {
            parseCommand: jest.fn()
        };
        
        // Mock Ghostty process
        mockGhosttyProcess = {
            write: jest.fn()
        };
        
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
            handleWarning: jest.fn(),
            createUserMessage: jest.fn().mockReturnValue('User-friendly error message')
        };
        
        // Create executor with mocks
        executor = new CommandExecutor({
            parser: mockParser,
            ghosttyProcess: mockGhosttyProcess,
            logger: mockLogger,
            errorHandler: mockErrorHandler
        });
    });
    
    describe('command execution logging', () => {
        it('should log command execution start', async () => {
            mockParser.parseCommand.mockReturnValue({
                command: 'ls',
                args: ['-la']
            });
            
            await executor.executeCommand('ls -la');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandExecutor: Executing command',
                'ls -la'
            );
        });
        
        it('should log successful command execution', async () => {
            mockParser.parseCommand.mockReturnValue({
                command: 'echo',
                args: ['hello']
            });
            
            await executor.executeCommand('echo hello');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'CommandExecutor: Command executed successfully',
                expect.objectContaining({
                    success: true,
                    command: 'echo hello'
                })
            );
        });
        
        it('should log built-in command execution', async () => {
            mockParser.parseCommand.mockReturnValue({
                command: 'clear',
                args: []
            });
            
            const clearHandler = jest.fn();
            executor.onClear(clearHandler);
            
            await executor.executeCommand('clear');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandExecutor: Executing built-in command',
                'clear'
            );
        });
        
        it('should log alias expansion', async () => {
            executor.addAlias('ll', 'ls -la');
            mockParser.parseCommand.mockReturnValue({
                command: 'll',
                args: []
            });
            
            await executor.executeCommand('ll');
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'CommandExecutor: Expanding alias',
                'll',
                'ls -la'
            );
        });
    });
    
    describe('error handling', () => {
        it('should handle empty command with logging', async () => {
            const result = await executor.executeCommand('');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandExecutor: Empty command received'
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe('Empty command');
        });
        
        it('should handle missing terminal process', async () => {
            executor.ghosttyProcess = null;
            
            const result = await executor.executeCommand('ls');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: No terminal process available'
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Terminal process not running'
                }),
                'CommandExecutor.executeCommand'
            );
            expect(result.success).toBe(false);
        });
        
        it('should handle parse errors', async () => {
            mockParser.parseCommand.mockReturnValue(null);
            
            const result = await executor.executeCommand('invalid command');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: Failed to parse command',
                'invalid command'
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Failed to parse command'
                }),
                'CommandExecutor.parseCommand'
            );
            expect(result.success).toBe(false);
        });
        
        it('should handle parser exceptions', async () => {
            const parseError = new Error('Parser crashed');
            mockParser.parseCommand.mockImplementation(() => {
                throw parseError;
            });
            
            const result = await executor.executeCommand('crash');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: Exception during command execution',
                parseError
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                parseError,
                'CommandExecutor.executeCommand'
            );
            expect(result.success).toBe(false);
        });
        
        it('should handle write errors to terminal', async () => {
            const writeError = new Error('Write failed');
            mockGhosttyProcess.write.mockImplementation(() => {
                throw writeError;
            });
            mockParser.parseCommand.mockReturnValue({
                command: 'test',
                args: []
            });
            
            const result = await executor.executeCommand('test');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: Failed to write to terminal',
                writeError
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                writeError,
                'CommandExecutor.write'
            );
            expect(result.success).toBe(false);
        });
    });
    
    describe('alias management logging', () => {
        it('should log alias addition', () => {
            executor.addAlias('ga', 'git add');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'CommandExecutor: Alias added',
                'ga',
                'git add'
            );
        });
        
        it('should log alias removal', () => {
            executor.addAlias('ga', 'git add');
            jest.clearAllMocks();
            
            executor.removeAlias('ga');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'CommandExecutor: Alias removed',
                'ga'
            );
        });
        
        it('should log alias clear', () => {
            executor.addAlias('ga', 'git add');
            executor.addAlias('gc', 'git commit');
            jest.clearAllMocks();
            
            executor.clearAliases();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'CommandExecutor: All aliases cleared'
            );
        });
        
        it('should warn when overwriting alias', () => {
            executor.addAlias('ga', 'git add');
            jest.clearAllMocks();
            
            executor.addAlias('ga', 'git add .');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandExecutor: Overwriting existing alias',
                'ga',
                'git add',
                'git add .'
            );
        });
    });
    
    describe('event handling errors', () => {
        it('should handle errors in event handlers', async () => {
            const handlerError = new Error('Handler failed');
            const failingHandler = jest.fn().mockImplementation(() => {
                throw handlerError;
            });
            
            executor.on('commandExecuted', failingHandler);
            mockParser.parseCommand.mockReturnValue({
                command: 'test',
                args: []
            });
            
            const result = await executor.executeCommand('test');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: Error in event handler',
                'commandExecuted',
                handlerError
            );
            expect(result.success).toBe(true); // Command should still succeed
        });
        
        it('should handle errors in built-in command handlers', async () => {
            const handlerError = new Error('Clear handler failed');
            const failingHandler = jest.fn().mockImplementation(() => {
                throw handlerError;
            });
            
            executor.onClear(failingHandler);
            mockParser.parseCommand.mockReturnValue({
                command: 'clear',
                args: []
            });
            
            const result = await executor.executeCommand('clear');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: Error in built-in command handler',
                'clear',
                handlerError
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                handlerError,
                'CommandExecutor.builtinHandler.clear'
            );
            expect(result.success).toBe(false);
        });
    });
    
    describe('recovery mechanisms', () => {
        it('should attempt recovery on write failure', async () => {
            mockGhosttyProcess.write
                .mockImplementationOnce(() => { throw new Error('First write failed'); })
                .mockImplementationOnce(() => true); // Second attempt succeeds
                
            mockParser.parseCommand.mockReturnValue({
                command: 'test',
                args: []
            });
            
            const result = await executor.executeCommand('test');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'CommandExecutor: Retrying command after write failure'
            );
            expect(mockGhosttyProcess.write).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
        });
        
        it('should give up after max retry attempts', async () => {
            const writeError = new Error('Persistent write failure');
            mockGhosttyProcess.write.mockImplementation(() => {
                throw writeError;
            });
            
            mockParser.parseCommand.mockReturnValue({
                command: 'test',
                args: []
            });
            
            const result = await executor.executeCommand('test');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'CommandExecutor: Max retry attempts reached',
                3
            );
            expect(mockGhosttyProcess.write).toHaveBeenCalledTimes(3);
            expect(result.success).toBe(false);
        });
    });
});