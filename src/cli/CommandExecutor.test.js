import { jest } from '@jest/globals';
import { CommandExecutor } from './CommandExecutor.js';
import { CommandParser } from './CommandParser.js';

describe('CommandExecutor', () => {
  let executor;
  let mockGhosttyProcess;
  let mockParser;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock GhosttyProcess
    mockGhosttyProcess = {
      write: jest.fn(),
      on: jest.fn(),
      spawn: jest.fn().mockResolvedValue(true),
      stop: jest.fn(),
      destroy: jest.fn()
    };

    // Create parser instance
    mockParser = new CommandParser();
    
    // Create executor with mocks
    executor = new CommandExecutor({
      parser: mockParser,
      ghosttyProcess: mockGhosttyProcess
    });
  });

  describe('executeCommand', () => {
    test('should execute simple command', async () => {
      const command = 'ls -la';
      const result = await executor.executeCommand(command);
      
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('ls -la\n');
      expect(result).toEqual({
        success: true,
        command: 'ls -la'
      });
    });

    test('should handle built-in clear command', async () => {
      const clearCallback = jest.fn();
      executor.onClear(clearCallback);
      
      const result = await executor.executeCommand('clear');
      
      expect(clearCallback).toHaveBeenCalled();
      expect(mockGhosttyProcess.write).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        command: 'clear',
        handled: 'builtin'
      });
    });

    test('should handle built-in exit command', async () => {
      const exitCallback = jest.fn();
      executor.onExit(exitCallback);
      
      const result = await executor.executeCommand('exit');
      
      expect(exitCallback).toHaveBeenCalled();
      expect(mockGhosttyProcess.write).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        command: 'exit',
        handled: 'builtin'
      });
    });

    test('should handle built-in help command', async () => {
      const helpCallback = jest.fn();
      executor.onHelp(helpCallback);
      
      const result = await executor.executeCommand('help');
      
      expect(helpCallback).toHaveBeenCalled();
      expect(mockGhosttyProcess.write).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        command: 'help',
        handled: 'builtin'
      });
    });

    test('should handle command with pipes', async () => {
      const command = 'ls -la | grep test';
      const result = await executor.executeCommand(command);
      
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('ls -la | grep test\n');
      expect(result).toEqual({
        success: true,
        command: 'ls -la | grep test'
      });
    });

    test('should handle command with redirection', async () => {
      const command = 'echo "test" > output.txt';
      const result = await executor.executeCommand(command);
      
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('echo "test" > output.txt\n');
      expect(result).toEqual({
        success: true,
        command: 'echo "test" > output.txt'
      });
    });

    test('should handle command chaining with &&', async () => {
      const command = 'npm test && npm build';
      const result = await executor.executeCommand(command);
      
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('npm test && npm build\n');
      expect(result).toEqual({
        success: true,
        command: 'npm test && npm build'
      });
    });

    test('should handle empty command', async () => {
      const result = await executor.executeCommand('');
      
      expect(mockGhosttyProcess.write).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        command: '',
        error: 'Empty command'
      });
    });

    test('should handle invalid command', async () => {
      const result = await executor.executeCommand('   ');
      
      expect(mockGhosttyProcess.write).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        command: '   ',
        error: 'Empty command'
      });
    });

    test('should handle command when process is not running', async () => {
      executor = new CommandExecutor({
        parser: mockParser,
        ghosttyProcess: null
      });
      
      const result = await executor.executeCommand('ls');
      
      expect(result).toEqual({
        success: false,
        command: 'ls',
        error: 'Terminal process not running'
      });
    });

    test('should emit commandExecuted event', async () => {
      const callback = jest.fn();
      executor.on('commandExecuted', callback);
      
      await executor.executeCommand('ls');
      
      expect(callback).toHaveBeenCalledWith({
        success: true,
        command: 'ls'
      });
    });

    test('should handle cd command specially', async () => {
      const cdCallback = jest.fn();
      executor.onCd(cdCallback);
      
      const result = await executor.executeCommand('cd /home');
      
      expect(cdCallback).toHaveBeenCalledWith('/home');
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('cd /home\n');
      expect(result).toEqual({
        success: true,
        command: 'cd /home',
        handled: 'special'
      });
    });

    test('should handle aliases', async () => {
      executor.addAlias('ll', 'ls -la');
      
      const result = await executor.executeCommand('ll');
      
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('ls -la\n');
      expect(result).toEqual({
        success: true,
        command: 'll',
        expanded: 'ls -la'
      });
    });

    test('should handle multiple aliases', async () => {
      executor.addAlias('gst', 'git status');
      executor.addAlias('gco', 'git checkout');
      
      await executor.executeCommand('gst');
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('git status\n');
      
      await executor.executeCommand('gco main');
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('git checkout main\n');
    });

    test('should throw error for write failures', async () => {
      mockGhosttyProcess.write.mockImplementation(() => {
        throw new Error('Write failed');
      });
      
      const result = await executor.executeCommand('ls');
      
      expect(result).toEqual({
        success: false,
        command: 'ls',
        error: 'Write failed'
      });
    });
  });

  describe('isBuiltinCommand', () => {
    test('should identify builtin commands', () => {
      expect(executor.isBuiltinCommand('clear')).toBe(true);
      expect(executor.isBuiltinCommand('exit')).toBe(true);
      expect(executor.isBuiltinCommand('help')).toBe(true);
      expect(executor.isBuiltinCommand('ls')).toBe(false);
      expect(executor.isBuiltinCommand('cd')).toBe(false);
    });
  });

  describe('event handling', () => {
    test('should support multiple event listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      
      executor.on('commandExecuted', listener1);
      executor.on('commandExecuted', listener2);
      
      executor.emit('commandExecuted', { test: true });
      
      expect(listener1).toHaveBeenCalledWith({ test: true });
      expect(listener2).toHaveBeenCalledWith({ test: true });
    });

    test('should support removing event listeners', () => {
      const listener = jest.fn();
      
      executor.on('commandExecuted', listener);
      executor.off('commandExecuted', listener);
      
      executor.emit('commandExecuted', { test: true });
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('alias management', () => {
    test('should add and remove aliases', () => {
      executor.addAlias('ll', 'ls -la');
      expect(executor.getAlias('ll')).toBe('ls -la');
      
      executor.removeAlias('ll');
      expect(executor.getAlias('ll')).toBeUndefined();
    });

    test('should list all aliases', () => {
      executor.addAlias('ll', 'ls -la');
      executor.addAlias('la', 'ls -a');
      
      const aliases = executor.getAllAliases();
      expect(aliases).toEqual({
        'll': 'ls -la',
        'la': 'ls -a'
      });
    });

    test('should clear all aliases', () => {
      executor.addAlias('ll', 'ls -la');
      executor.addAlias('la', 'ls -a');
      
      executor.clearAliases();
      
      expect(executor.getAllAliases()).toEqual({});
    });

    test('should expand aliases in commands', async () => {
      executor.addAlias('gst', 'git status');
      
      const result = await executor.executeCommand('gst --short');
      
      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('git status --short\n');
    });
  });
});