import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Import Tauri mocks
import { invoke, core } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';

// Mock GhosttyProcess
jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyProcess.js', () => ({
  GhosttyProcess: jest.fn().mockImplementation(() => {
    const process = new EventEmitter();
    process.spawn = jest.fn().mockResolvedValue(true);
    process.stop = jest.fn().mockReturnValue(true);
    process.write = jest.fn().mockReturnValue(true);
    process.isRunning = jest.fn().mockReturnValue(false);
    process.getPid = jest.fn().mockReturnValue(null);
    process.getProcessInfo = jest.fn().mockReturnValue({
      running: false,
      pid: null,
      uptime: 0,
      startTime: null
    });
    process.destroy = jest.fn();
    return process;
  })
}));

// Mock GhosttyIntegration
jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyIntegration.js', () => ({
  GhosttyIntegration: jest.fn().mockImplementation(() => ({
    getInstallationStatus: jest.fn().mockResolvedValue({
      installed: true,
      path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
      version: '1.0.0',
      valid: true
    })
  }))
}));

const { GhosttyIPCBridge } = await import('./GhosttyIPCBridge.js');

describe('GhosttyIPCBridge', () => {
  let bridge;
  let mockProcess;
  let mockIntegration;
  let unlistenFn;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock unlisten function
    unlistenFn = jest.fn();
    listen.mockResolvedValue(unlistenFn);
    
    bridge = new GhosttyIPCBridge();
    mockProcess = bridge.ghosttyProcess;
    mockIntegration = bridge.integration;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should register IPC command handlers on init', async () => {
      await bridge.init();
      
      expect(invoke).toHaveBeenCalledWith('register_ghostty_commands');
    });

    it('should set up event listeners', async () => {
      await bridge.init();
      
      expect(listen).toHaveBeenCalledWith('ghostty:spawn', expect.any(Function));
      expect(listen).toHaveBeenCalledWith('ghostty:stop', expect.any(Function));
      expect(listen).toHaveBeenCalledWith('ghostty:write', expect.any(Function));
      expect(listen).toHaveBeenCalledWith('ghostty:status', expect.any(Function));
    });

    it('should handle initialization errors', async () => {
      invoke.mockRejectedValueOnce(new Error('Registration failed'));
      
      await expect(bridge.init()).rejects.toThrow('Registration failed');
    });
  });

  describe('Command Handling', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should handle spawn command', async () => {
      const spawnHandler = listen.mock.calls.find(call => call[0] === 'ghostty:spawn')[1];
      
      await spawnHandler({ payload: { cwd: '/Users/test' } });
      
      expect(mockProcess.spawn).toHaveBeenCalledWith({ cwd: '/Users/test' });
      expect(emit).toHaveBeenCalledWith('ghostty:spawned', { success: true });
    });

    it('should handle spawn failure', async () => {
      const spawnHandler = listen.mock.calls.find(call => call[0] === 'ghostty:spawn')[1];
      mockProcess.spawn.mockResolvedValueOnce(false);
      
      await spawnHandler({ payload: {} });
      
      expect(emit).toHaveBeenCalledWith('ghostty:spawned', { 
        success: false,
        error: 'Failed to spawn Ghostty process'
      });
    });

    it('should handle stop command', async () => {
      const stopHandler = listen.mock.calls.find(call => call[0] === 'ghostty:stop')[1];
      
      await stopHandler({ payload: { force: false } });
      
      expect(mockProcess.stop).toHaveBeenCalledWith(false);
      expect(emit).toHaveBeenCalledWith('ghostty:stopped', { success: true });
    });

    it('should handle write command', async () => {
      const writeHandler = listen.mock.calls.find(call => call[0] === 'ghostty:write')[1];
      
      await writeHandler({ payload: { data: 'echo "Hello"\n' } });
      
      expect(mockProcess.write).toHaveBeenCalledWith('echo "Hello"\n');
      expect(emit).toHaveBeenCalledWith('ghostty:write-complete', { success: true });
    });

    it('should handle status command', async () => {
      const statusHandler = listen.mock.calls.find(call => call[0] === 'ghostty:status')[1];
      
      await statusHandler({});
      
      expect(emit).toHaveBeenCalledWith('ghostty:status-response', {
        installation: {
          installed: true,
          path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
          version: '1.0.0',
          valid: true
        },
        process: {
          running: false,
          pid: null,
          uptime: 0,
          startTime: null
        }
      });
    });
  });

  describe('Process Event Forwarding', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should forward stdout data to frontend', () => {
      const data = Buffer.from('Output from Ghostty');
      mockProcess.emit('stdout', data);
      
      expect(emit).toHaveBeenCalledWith('ghostty:stdout', {
        data: data.toString()
      });
    });

    it('should forward stderr data to frontend', () => {
      const data = Buffer.from('Error from Ghostty');
      mockProcess.emit('stderr', data);
      
      expect(emit).toHaveBeenCalledWith('ghostty:stderr', {
        data: data.toString()
      });
    });

    it('should forward exit event to frontend', () => {
      mockProcess.emit('exit', 0, null);
      
      expect(emit).toHaveBeenCalledWith('ghostty:exit', {
        code: 0,
        signal: null
      });
    });

    it('should forward error event to frontend', () => {
      const error = new Error('Process error');
      mockProcess.emit('error', error);
      
      expect(emit).toHaveBeenCalledWith('ghostty:error', {
        error: error.message
      });
    });
  });

  describe('Frontend API Methods', () => {
    it('should provide spawn method for frontend', async () => {
      const result = await bridge.spawnGhostty({ cwd: '/Users/test' });
      
      expect(mockProcess.spawn).toHaveBeenCalledWith({ cwd: '/Users/test' });
      expect(result).toBe(true);
    });

    it('should provide stop method for frontend', () => {
      const result = bridge.stopGhostty(true);
      
      expect(mockProcess.stop).toHaveBeenCalledWith(true);
      expect(result).toBe(true);
    });

    it('should provide write method for frontend', () => {
      const result = bridge.writeToGhostty('ls -la\n');
      
      expect(mockProcess.write).toHaveBeenCalledWith('ls -la\n');
      expect(result).toBe(true);
    });

    it('should provide status method for frontend', async () => {
      const status = await bridge.getGhosttyStatus();
      
      expect(status).toEqual({
        installation: {
          installed: true,
          path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
          version: '1.0.0',
          valid: true
        },
        process: {
          running: false,
          pid: null,
          uptime: 0,
          startTime: null
        }
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should handle missing payload in commands', async () => {
      const writeHandler = listen.mock.calls.find(call => call[0] === 'ghostty:write')[1];
      
      await writeHandler({ payload: {} });
      
      expect(emit).toHaveBeenCalledWith('ghostty:write-complete', {
        success: false,
        error: 'No data provided'
      });
    });

    it('should handle process errors gracefully', async () => {
      const spawnHandler = listen.mock.calls.find(call => call[0] === 'ghostty:spawn')[1];
      mockProcess.spawn.mockRejectedValueOnce(new Error('Spawn error'));
      
      await spawnHandler({ payload: {} });
      
      expect(emit).toHaveBeenCalledWith('ghostty:spawned', {
        success: false,
        error: 'Spawn error'
      });
    });
  });

  describe('Cleanup', () => {
    it('should clean up event listeners on destroy', async () => {
      await bridge.init();
      
      await bridge.destroy();
      
      expect(unlistenFn).toHaveBeenCalledTimes(4); // One for each registered listener
    });

    it('should handle cleanup when not initialized', async () => {
      await expect(bridge.destroy()).resolves.not.toThrow();
    });
  });
});