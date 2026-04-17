import { jest } from '@jest/globals';
import { TerminalUI } from './TerminalUI.js';
import { CommandParser } from './CommandParser.js';
import { CommandExecutor } from './CommandExecutor.js';

describe('TerminalUI Integration', () => {
  let container;
  let terminalUI;
  let mockStorage;

  beforeEach(() => {
    // Create DOM container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Create mock storage
    mockStorage = {
      getItem: jest.fn(),
      setItem: jest.fn()
    };

    // Create TerminalUI instance
    terminalUI = new TerminalUI(container, { storage: mockStorage });
  });

  afterEach(() => {
    // Clean up
    if (terminalUI) {
      terminalUI.destroy();
    }
    document.body.removeChild(container);
  });

  describe('Command Processing Integration', () => {
    test('should have CommandParser instance', () => {
      expect(terminalUI.commandParser).toBeDefined();
      expect(terminalUI.commandParser).toBeInstanceOf(CommandParser);
    });

    test('should have CommandExecutor instance', () => {
      expect(terminalUI.commandExecutor).toBeDefined();
      expect(terminalUI.commandExecutor).toBeInstanceOf(CommandExecutor);
    });

    test('should parse and execute commands through sendCommand', async () => {
      // Mock the ghosttyProcess
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn(),
        spawn: jest.fn().mockResolvedValue(true),
        stop: jest.fn(),
        destroy: jest.fn()
      };
      // Update commandExecutor with the process
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      terminalUI.isRunning = true;

      // Test simple command
      await terminalUI.sendCommand('ls -la');
      expect(terminalUI.ghosttyProcess.write).toHaveBeenCalledWith('ls -la\n');
    });

    test('should handle parsed command results', async () => {
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      terminalUI.isRunning = true;

      // Test command with options
      const result = await terminalUI.sendCommand('git commit -m "test message"');
      expect(terminalUI.ghosttyProcess.write).toHaveBeenCalledWith('git commit -m "test message"\n');
    });

    test('should handle built-in commands through CommandExecutor', async () => {
      terminalUI.isRunning = true;
      terminalUI.ghosttyProcess = { write: jest.fn() };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      const clearOutputSpy = jest.spyOn(terminalUI, 'clearOutput');
      
      await terminalUI.sendCommand('clear');
      
      expect(clearOutputSpy).toHaveBeenCalled();
    });

    test('should handle aliases', async () => {
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      terminalUI.isRunning = true;

      // Add alias
      terminalUI.commandExecutor.addAlias('ll', 'ls -la');

      // Use alias
      await terminalUI.sendCommand('ll');
      expect(terminalUI.ghosttyProcess.write).toHaveBeenCalledWith('ls -la\n');
    });

    test('should handle command history', async () => {
      terminalUI.isRunning = true;
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;

      // Add commands to history
      await terminalUI.sendCommand('echo test1');
      await terminalUI.sendCommand('echo test2');
      await terminalUI.sendCommand('echo test3');

      expect(terminalUI.commandHistory).toEqual(['echo test1', 'echo test2', 'echo test3']);
    });

    test('should handle piped commands', async () => {
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      terminalUI.isRunning = true;

      await terminalUI.sendCommand('ls -la | grep test');
      expect(terminalUI.ghosttyProcess.write).toHaveBeenCalledWith('ls -la | grep test\n');
    });

    test('should handle command chaining', async () => {
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      terminalUI.isRunning = true;

      await terminalUI.sendCommand('npm test && npm build');
      expect(terminalUI.ghosttyProcess.write).toHaveBeenCalledWith('npm test && npm build\n');
    });

    test('should emit parsed command events', async () => {
      terminalUI.ghosttyProcess = {
        write: jest.fn(),
        on: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      terminalUI.isRunning = true;

      const commandExecutedHandler = jest.fn();
      terminalUI.commandExecutor.on('commandExecuted', commandExecutedHandler);

      await terminalUI.sendCommand('echo "Hello World"');

      expect(commandExecutedHandler).toHaveBeenCalledWith({
        success: true,
        command: 'echo "Hello World"'
      });
    });

    test('should handle exit command', async () => {
      terminalUI.isRunning = true;
      terminalUI.ghosttyProcess = { 
        write: jest.fn(),
        stop: jest.fn(),
        destroy: jest.fn()
      };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      const stopTerminalSpy = jest.spyOn(terminalUI, 'stopTerminal').mockImplementation(async () => {
        terminalUI.isRunning = false;
      });
      
      await terminalUI.sendCommand('exit');
      
      expect(stopTerminalSpy).toHaveBeenCalled();
    });

    test('should display help on help command', async () => {
      terminalUI.isRunning = true;
      terminalUI.ghosttyProcess = { write: jest.fn() };
      terminalUI.commandExecutor.ghosttyProcess = terminalUI.ghosttyProcess;
      const appendOutputSpy = jest.spyOn(terminalUI, 'appendOutput');
      
      await terminalUI.sendCommand('help');
      
      expect(appendOutputSpy).toHaveBeenCalled();
      const helpText = appendOutputSpy.mock.calls[0][0];
      expect(helpText).toContain('Available commands:');
    });

    test('should handle invalid commands gracefully', async () => {
      terminalUI.isRunning = true;
      
      const result = await terminalUI.sendCommand('   ');
      
      // Should not crash and should return error result
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    test('should integrate with GhosttyProcess when initialized', async () => {
      // Mock successful initialization
      terminalUI.ghosttyStatus = {
        installed: true,
        valid: true,
        version: '1.0.0'
      };
      terminalUI.isInitialized = true;

      terminalUI.render();
      
      const button = container.querySelector('.terminal-control-button');
      expect(button).toBeDefined();
      expect(button.textContent).toBe('Start Terminal');
    });
  });

  describe('UI Integration', () => {
    test('should update UI based on command execution results', async () => {
      terminalUI.ghosttyStatus = {
        installed: true,
        valid: true,
        version: '1.0.0'
      };
      terminalUI.isInitialized = true;
      terminalUI.render();

      const statusElement = container.querySelector('.terminal-status');
      expect(statusElement).toBeDefined();
    });

    test('should handle keyboard shortcuts with command parsing', async () => {
      terminalUI.ghosttyStatus = {
        installed: true,
        valid: true,
        version: '1.0.0'
      };
      terminalUI.isInitialized = true;
      terminalUI.isRunning = true;
      terminalUI.render();

      const input = container.querySelector('.terminal-input');
      
      // Add command to history
      terminalUI.commandHistory = ['git status', 'npm test'];
      terminalUI.historyIndex = -1;

      // Simulate arrow up
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      input.dispatchEvent(event);

      expect(input.value).toBe('npm test');
    });
  });
});