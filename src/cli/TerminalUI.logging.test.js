import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing TerminalUI
jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyIntegration.js', () => ({
    GhosttyIntegration: jest.fn()
}));

jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyProcess.js', () => ({
    GhosttyProcess: jest.fn()
}));

jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/CommandParser.js', () => ({
    CommandParser: jest.fn()
}));

jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/CommandExecutor.js', () => ({
    CommandExecutor: jest.fn()
}));

// Import after mocking
const { GhosttyIntegration } = await import('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyIntegration.js');
const { GhosttyProcess } = await import('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyProcess.js');
const { CommandParser } = await import('/Users/ksnyder/code/aura-dev/src/cli/CommandParser.js');
const { CommandExecutor } = await import('/Users/ksnyder/code/aura-dev/src/cli/CommandExecutor.js');
const { TerminalUI } = await import('/Users/ksnyder/code/aura-dev/src/cli/TerminalUI.js');

describe('TerminalUI - Logging Integration', () => {
    let terminalUI;
    let container;
    let mockLogger;
    let mockErrorHandler;
    let mockGhosttyIntegration;
    let mockCommandExecutor;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Create container
        container = document.createElement('div');
        document.body.appendChild(container);
        
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
            createUserMessage: jest.fn().mockReturnValue('User-friendly error message'),
            formatErrorForDisplay: jest.fn().mockReturnValue('Formatted error')
        };
        
        // Mock GhosttyIntegration
        mockGhosttyIntegration = {
            getInstallationStatus: jest.fn().mockResolvedValue({
                installed: true,
                valid: true,
                version: '1.0.0'
            })
        };
        GhosttyIntegration.mockImplementation(() => mockGhosttyIntegration);
        
        // Mock CommandExecutor
        mockCommandExecutor = {
            executeCommand: jest.fn(),
            onClear: jest.fn(),
            onExit: jest.fn(),
            onHelp: jest.fn(),
            onCd: jest.fn()
        };
        CommandExecutor.mockImplementation(() => mockCommandExecutor);
        
        // Mock CommandParser
        CommandParser.mockImplementation(() => ({}));
        
        // Create terminal with logger and error handler
        terminalUI = new TerminalUI(container, {
            logger: mockLogger,
            errorHandler: mockErrorHandler
        });
    });
    
    afterEach(() => {
        document.body.removeChild(container);
        jest.clearAllMocks();
    });
    
    describe('initialization logging', () => {
        it('should log successful initialization', async () => {
            await terminalUI.initialize();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Initializing terminal UI'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Ghostty installation verified',
                expect.objectContaining({
                    installed: true,
                    valid: true,
                    version: '1.0.0'
                })
            );
        });
        
        it('should log error when Ghostty is not installed', async () => {
            mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
                installed: false,
                valid: false
            });
            
            await terminalUI.initialize();
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'TerminalUI: Ghostty not installed'
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('Ghostty not found')
                }),
                'TerminalUI.initialize'
            );
        });
        
        it('should log initialization errors', async () => {
            const error = new Error('Network error');
            mockGhosttyIntegration.getInstallationStatus.mockRejectedValue(error);
            
            await terminalUI.initialize();
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'TerminalUI: Failed to initialize',
                error
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                error,
                'TerminalUI.initialize'
            );
        });
    });
    
    describe('command execution logging', () => {
        beforeEach(async () => {
            await terminalUI.initialize();
            terminalUI.render();
        });
        
        it('should log command execution', async () => {
            mockCommandExecutor.executeCommand.mockResolvedValue({ success: true });
            terminalUI.isRunning = true;
            
            await terminalUI.sendCommand('ls -la');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Executing command',
                'ls -la'
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'TerminalUI: Command result',
                expect.objectContaining({ success: true })
            );
        });
        
        it('should log command errors', async () => {
            const error = new Error('Command failed');
            mockCommandExecutor.executeCommand.mockRejectedValue(error);
            terminalUI.isRunning = true;
            
            await terminalUI.sendCommand('invalid-command');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'TerminalUI: Command execution failed',
                'invalid-command',
                error
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                error,
                'TerminalUI.sendCommand'
            );
        });
        
        it('should log when terminal is not running', async () => {
            terminalUI.isRunning = false;
            
            const result = await terminalUI.sendCommand('ls');
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'TerminalUI: Command sent but terminal not running',
                'ls'
            );
            expect(result.success).toBe(false);
        });
    });
    
    describe('terminal lifecycle logging', () => {
        beforeEach(async () => {
            await terminalUI.initialize();
            terminalUI.render();
        });
        
        it('should log terminal start', async () => {
            const mockProcess = {
                spawn: jest.fn().mockResolvedValue(true),
                on: jest.fn()
            };
            GhosttyProcess.mockImplementation(() => mockProcess);
            
            await terminalUI.startTerminal();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Starting terminal'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Terminal started successfully'
            );
        });
        
        it('should log terminal start errors', async () => {
            const error = new Error('Spawn failed');
            const mockProcess = {
                spawn: jest.fn().mockRejectedValue(error),
                on: jest.fn()
            };
            GhosttyProcess.mockImplementation(() => mockProcess);
            
            await terminalUI.startTerminal();
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'TerminalUI: Failed to start terminal',
                error
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                error,
                'TerminalUI.startTerminal'
            );
        });
        
        it('should log terminal stop', async () => {
            terminalUI.ghosttyProcess = {
                stop: jest.fn(),
                destroy: jest.fn()
            };
            terminalUI.isRunning = true;
            
            await terminalUI.stopTerminal();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Stopping terminal'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Terminal stopped successfully'
            );
        });
    });
    
    describe('user interaction logging', () => {
        beforeEach(async () => {
            await terminalUI.initialize();
            terminalUI.render();
        });
        
        it('should log theme changes', () => {
            terminalUI.setTheme('light');
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'TerminalUI: Theme changed',
                'light'
            );
        });
    });
});