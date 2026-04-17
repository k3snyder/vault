import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock localStorage before importing anything
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  clear: jest.fn()
};
global.localStorage = localStorageMock;
// Also set it on window for jsdom environment
if (typeof window !== 'undefined') {
  window.localStorage = localStorageMock;
}

// Mock the dependencies before importing TerminalUI
jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyIntegration.js', () => ({
  GhosttyIntegration: jest.fn()
}));

jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyProcess.js', () => ({
  GhosttyProcess: jest.fn()
}));

// Import after mocking
const { GhosttyIntegration } = await import('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyIntegration.js');
const { GhosttyProcess } = await import('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyProcess.js');
const { TerminalUI } = await import('/Users/ksnyder/code/aura-dev/src/cli/TerminalUI.js');

describe('TerminalUI', () => {
  let terminalUI;
  let mockContainer;
  let mockGhosttyIntegration;
  let mockGhosttyProcess;

  // Helper function to create keyboard events with target
  const createKeyboardEvent = (key, target) => {
    const event = new KeyboardEvent('keydown', { key });
    Object.defineProperty(event, 'target', { value: target, enumerable: true });
    Object.defineProperty(event, 'preventDefault', { value: jest.fn(), enumerable: true });
    return event;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    
    // Create mock Ghostty integration
    mockGhosttyIntegration = {
      detectBinary: jest.fn(),
      validateBinary: jest.fn(),
      getBinaryPath: jest.fn(),
      getInstallationStatus: jest.fn()
    };
    GhosttyIntegration.mockImplementation(() => mockGhosttyIntegration);

    // Create mock Ghostty process
    mockGhosttyProcess = {
      spawn: jest.fn(),
      stop: jest.fn(),
      write: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      destroy: jest.fn(),
      isRunning: jest.fn()
    };
    GhosttyProcess.mockImplementation(() => mockGhosttyProcess);

    // Create mock container element
    const mockElements = new Map();
    
    mockContainer = {
      innerHTML: '',
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      querySelector: jest.fn((selector) => {
        // Create or return mock elements
        if (!mockElements.has(selector)) {
          if (selector === '.terminal-control-button') {
            mockElements.set(selector, {
              textContent: 'Start Terminal',
              addEventListener: jest.fn(),
              click: jest.fn()
            });
          } else if (selector === '.terminal-output') {
            mockElements.set(selector, {
              innerHTML: '',
              scrollTop: 0,
              scrollHeight: 1000,
              clientHeight: 300,
              appendChild: jest.fn(),
              classList: { contains: jest.fn(() => true) }
            });
          } else if (selector === '.terminal-input') {
            mockElements.set(selector, {
              value: '',
              type: 'text',
              placeholder: 'Enter command...',
              addEventListener: jest.fn(),
              focus: jest.fn()
            });
          } else if (selector === '.terminal-status') {
            mockElements.set(selector, {
              textContent: '',
              classList: {
                add: jest.fn(),
                remove: jest.fn(),
                contains: jest.fn()
              }
            });
          }
        }
        return mockElements.get(selector) || null;
      }),
      querySelectorAll: jest.fn(() => []),
      style: {},
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(() => false)
      }
    };

    terminalUI = new TerminalUI(mockContainer, { storage: localStorageMock });
  });

  afterEach(() => {
    if (terminalUI) {
      terminalUI.destroy();
    }
  });

  describe('Initialization', () => {
    it('should create terminal UI with container element', () => {
      expect(terminalUI).toBeDefined();
      expect(terminalUI.container).toBe(mockContainer);
    });

    it('should initialize with default state', () => {
      expect(terminalUI.isInitialized).toBe(false);
      expect(terminalUI.isRunning).toBe(false);
      expect(terminalUI.ghosttyIntegration).toBeDefined();
      expect(terminalUI.ghosttyProcess).toBeNull();
    });

    it('should set up basic UI structure', () => {
      expect(mockContainer.classList.add).toHaveBeenCalledWith('terminal-ui-container');
      expect(mockContainer.classList.add).toHaveBeenCalledWith('terminal-theme-dark');
    });
  });

  describe('Ghostty Detection', () => {
    it('should detect Ghostty installation on initialization', async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });

      await terminalUI.initialize();

      expect(mockGhosttyIntegration.getInstallationStatus).toHaveBeenCalled();
      expect(terminalUI.isInitialized).toBe(true);
    });

    it('should handle missing Ghostty installation', async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: false,
        path: null,
        version: null,
        valid: false
      });

      await terminalUI.initialize();

      expect(terminalUI.isInitialized).toBe(false);
      expect(mockContainer.innerHTML).toContain('Ghostty not found');
    });

    it('should handle invalid Ghostty installation', async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: null,
        valid: false
      });

      await terminalUI.initialize();

      expect(terminalUI.isInitialized).toBe(false);
      expect(mockContainer.innerHTML).toContain('Ghostty installation is invalid');
    });
  });

  describe('Terminal Rendering', () => {
    beforeEach(async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
    });

    it('should render terminal interface after successful initialization', () => {
      terminalUI.render();

      expect(mockContainer.innerHTML).toContain('terminal-header');
      expect(mockContainer.innerHTML).toContain('terminal-body');
      expect(mockContainer.innerHTML).toContain('terminal-status');
    });

    it('should display Ghostty version in header', () => {
      terminalUI.render();

      expect(mockContainer.innerHTML).toContain('Ghostty Terminal');
      expect(mockContainer.innerHTML).toContain('v1.0.0');
    });

    it('should create start/stop button', () => {
      terminalUI.render();

      const button = mockContainer.querySelector('.terminal-control-button');
      expect(button).toBeDefined();
      expect(button.textContent).toBe('Start Terminal');
    });

    it('should create terminal output area', () => {
      terminalUI.render();

      const output = mockContainer.querySelector('.terminal-output');
      expect(output).toBeDefined();
    });

    it('should create terminal input area', () => {
      terminalUI.render();

      const input = mockContainer.querySelector('.terminal-input');
      expect(input).toBeDefined();
      expect(input.type).toBe('text');
      expect(input.placeholder).toBe('Enter command...');
    });
  });

  describe('Terminal Lifecycle', () => {
    beforeEach(async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();
    });

    it('should start terminal process when start button is clicked', async () => {
      mockGhosttyProcess.spawn.mockResolvedValue(true);

      await terminalUI.startTerminal();

      expect(mockGhosttyProcess.spawn).toHaveBeenCalled();
      expect(terminalUI.isRunning).toBe(true);
      
      const button = mockContainer.querySelector('.terminal-control-button');
      expect(button.textContent).toBe('Stop Terminal');
    });

    it('should stop terminal process when stop button is clicked', async () => {
      // Start terminal first
      mockGhosttyProcess.spawn.mockResolvedValue(true);
      await terminalUI.startTerminal();

      // Now stop it
      mockGhosttyProcess.stop.mockReturnValue(true);
      await terminalUI.stopTerminal();

      expect(mockGhosttyProcess.stop).toHaveBeenCalled();
      expect(terminalUI.isRunning).toBe(false);
      
      const button = mockContainer.querySelector('.terminal-control-button');
      expect(button.textContent).toBe('Start Terminal');
    });

    it('should handle terminal start failure', async () => {
      mockGhosttyProcess.spawn.mockResolvedValue(false);

      await terminalUI.startTerminal();

      expect(terminalUI.isRunning).toBe(false);
      
      const status = mockContainer.querySelector('.terminal-status');
      expect(status.textContent).toContain('Failed to start terminal');
    });

    it('should handle terminal stop failure', async () => {
      // Start terminal first
      mockGhosttyProcess.spawn.mockResolvedValue(true);
      await terminalUI.startTerminal();

      // Fail to stop
      mockGhosttyProcess.stop.mockImplementation(() => { throw new Error('Failed to stop'); });
      
      // stopTerminal will throw the error
      await expect(terminalUI.stopTerminal()).rejects.toThrow('Failed to stop');

      expect(terminalUI.isRunning).toBe(true);
      
      const status = mockContainer.querySelector('.terminal-status');
      expect(status.textContent).toContain('Failed to stop terminal');
    });
  });

  describe('Terminal I/O', () => {
    beforeEach(async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();
      mockGhosttyProcess.spawn.mockResolvedValue(true);
      await terminalUI.startTerminal();
    });

    it('should send commands to terminal on Enter key', async () => {
      const input = mockContainer.querySelector('.terminal-input');
      input.value = 'ls -la';

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      await terminalUI.handleInputKeydown(enterEvent);

      expect(mockGhosttyProcess.write).toHaveBeenCalledWith('ls -la\n');
      expect(input.value).toBe('');
    });

    it('should not send empty commands', async () => {
      const input = mockContainer.querySelector('.terminal-input');
      input.value = '';

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      await terminalUI.handleInputKeydown(enterEvent);

      expect(mockGhosttyProcess.write).not.toHaveBeenCalled();
    });

    it('should display command output in terminal', () => {
      const output = mockContainer.querySelector('.terminal-output');
      
      terminalUI.appendOutput('Hello from terminal');

      expect(output.appendChild).toHaveBeenCalled();
      const appendedElement = output.appendChild.mock.calls[0][0];
      expect(appendedElement.textContent).toBe('Hello from terminal');
    });

    it('should handle terminal output events', () => {
      const outputHandler = mockGhosttyProcess.on.mock.calls.find(
        call => call[0] === 'output'
      )?.[1];

      expect(outputHandler).toBeDefined();

      const output = mockContainer.querySelector('.terminal-output');
      outputHandler('Terminal output line');

      expect(output.appendChild).toHaveBeenCalled();
    });

    it('should handle terminal error events', () => {
      const errorHandler = mockGhosttyProcess.on.mock.calls.find(
        call => call[0] === 'error'
      )?.[1];

      expect(errorHandler).toBeDefined();

      const status = mockContainer.querySelector('.terminal-status');
      errorHandler(new Error('Terminal error'));

      expect(status.textContent).toContain('Terminal error');
      expect(status.classList.add).toHaveBeenCalledWith('error');
    });
  });

  describe('Command History', () => {
    beforeEach(async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();
      mockGhosttyProcess.spawn.mockResolvedValue(true);
      await terminalUI.startTerminal();
    });

    it('should maintain command history', async () => {
      const input = mockContainer.querySelector('.terminal-input');

      // Send multiple commands
      input.value = 'pwd';
      await terminalUI.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

      input.value = 'ls';
      await terminalUI.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(terminalUI.commandHistory).toEqual(['pwd', 'ls']);
    });

    it('should navigate history with up arrow', () => {
      terminalUI.commandHistory = ['pwd', 'ls', 'cd /'];
      terminalUI.historyIndex = -1;

      const input = mockContainer.querySelector('.terminal-input');
      
      terminalUI.handleInputKeydown(createKeyboardEvent('ArrowUp', input));
      expect(input.value).toBe('cd /');

      terminalUI.handleInputKeydown(createKeyboardEvent('ArrowUp', input));
      expect(input.value).toBe('ls');

      terminalUI.handleInputKeydown(createKeyboardEvent('ArrowUp', input));
      expect(input.value).toBe('pwd');
    });

    it('should navigate history with down arrow', () => {
      terminalUI.commandHistory = ['pwd', 'ls', 'cd /'];
      terminalUI.historyIndex = 0;

      const input = mockContainer.querySelector('.terminal-input');
      
      terminalUI.handleInputKeydown(createKeyboardEvent('ArrowDown', input));
      expect(input.value).toBe('ls');

      terminalUI.handleInputKeydown(createKeyboardEvent('ArrowDown', input));
      expect(input.value).toBe('cd /');

      terminalUI.handleInputKeydown(createKeyboardEvent('ArrowDown', input));
      expect(input.value).toBe('');
    });

    it('should limit command history size', async () => {
      const input = mockContainer.querySelector('.terminal-input');

      // Send 100+ commands
      for (let i = 0; i < 110; i++) {
        input.value = `command${i}`;
        await terminalUI.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
      }

      expect(terminalUI.commandHistory.length).toBe(100);
      expect(terminalUI.commandHistory[0]).toBe('command10');
      expect(terminalUI.commandHistory[99]).toBe('command109');
    });
  });

  describe('UI Interactions', () => {
    beforeEach(async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();
    });

    it('should auto-scroll output to bottom on new content', () => {
      const output = mockContainer.querySelector('.terminal-output');
      output.scrollTop = 0;
      output.scrollHeight = 1000;
      output.clientHeight = 300;

      terminalUI.appendOutput('New line');

      expect(output.scrollTop).toBe(700); // scrollHeight - clientHeight
    });

    it('should clear terminal output on clear command', async () => {
      mockGhosttyProcess.spawn.mockResolvedValue(true);
      await terminalUI.startTerminal();

      const output = mockContainer.querySelector('.terminal-output');
      output.innerHTML = 'Previous content';

      const input = mockContainer.querySelector('.terminal-input');
      input.value = 'clear';
      await terminalUI.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(output.innerHTML).toBe('');
    });

    it('should handle resize events', () => {
      const resizeHandler = jest.fn();
      terminalUI.on('resize', resizeHandler);

      window.dispatchEvent(new Event('resize'));

      expect(resizeHandler).toHaveBeenCalled();
    });

    it('should clean up event listeners on destroy', () => {
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
      
      terminalUI.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });
  });

  describe('Error Handling', () => {
    it('should handle initialization errors gracefully', async () => {
      mockGhosttyIntegration.getInstallationStatus.mockRejectedValue(
        new Error('Failed to check installation')
      );

      await terminalUI.initialize();

      expect(terminalUI.isInitialized).toBe(false);
      expect(mockContainer.innerHTML).toContain('Failed to initialize terminal');
    });

    it('should handle process creation errors', async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();

      GhosttyProcess.mockImplementationOnce(() => {
        throw new Error('Failed to create process');
      });

      await terminalUI.startTerminal();

      expect(terminalUI.isRunning).toBe(false);
      
      const status = mockContainer.querySelector('.terminal-status');
      expect(status.textContent).toContain('Failed to start terminal');
    });

    it('should handle command send errors', async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();
      mockGhosttyProcess.spawn.mockResolvedValue(true);
      await terminalUI.startTerminal();

      mockGhosttyProcess.write.mockImplementation(() => { throw new Error('Send failed'); });

      const input = mockContainer.querySelector('.terminal-input');
      input.value = 'test command';
      await terminalUI.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

      const status = mockContainer.querySelector('.terminal-status');
      expect(status.textContent).toContain('Failed to send command');
    });
  });

  describe('Theme Support', () => {
    beforeEach(async () => {
      mockGhosttyIntegration.getInstallationStatus.mockResolvedValue({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
      await terminalUI.initialize();
      terminalUI.render();
    });

    it('should apply dark theme by default', () => {
      expect(mockContainer.classList.add).toHaveBeenCalledWith('terminal-theme-dark');
    });

    it('should switch to light theme', () => {
      terminalUI.setTheme('light');

      expect(mockContainer.classList.remove).toHaveBeenCalledWith('terminal-theme-dark');
      expect(mockContainer.classList.add).toHaveBeenCalledWith('terminal-theme-light');
    });

    it('should persist theme preference', () => {
      terminalUI.setTheme('light');
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('terminal-theme', 'light');
    });
  });
});