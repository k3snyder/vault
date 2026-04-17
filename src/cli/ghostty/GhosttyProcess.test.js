import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock modules before importing
jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn()
}));

jest.unstable_mockModule('/Users/ksnyder/code/aura-dev/src/cli/ghostty/GhosttyIntegration.js', () => ({
  GhosttyIntegration: jest.fn().mockImplementation(() => ({
    detectBinary: jest.fn().mockResolvedValue(true),
    getBinaryPath: jest.fn().mockResolvedValue('/Applications/Ghostty.app/Contents/MacOS/ghostty'),
    validateBinary: jest.fn().mockResolvedValue(true)
  }))
}));

const { spawn } = await import('child_process');
const { GhosttyIntegration } = await import('./GhosttyIntegration.js');
const { GhosttyProcess } = await import('./GhosttyProcess.js');

describe('GhosttyProcess', () => {
  let ghosttyProcess;
  let mockChildProcess;
  let mockIntegration;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock child process
    mockChildProcess = new EventEmitter();
    mockChildProcess.pid = 1234;
    mockChildProcess.kill = jest.fn().mockReturnValue(true);
    mockChildProcess.stdin = {
      write: jest.fn(),
      end: jest.fn()
    };
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    
    spawn.mockReturnValue(mockChildProcess);
    
    // Set up integration mock
    mockIntegration = new GhosttyIntegration();
    ghosttyProcess = new GhosttyProcess(mockIntegration);
  });

  afterEach(() => {
    if (ghosttyProcess.process) {
      ghosttyProcess.stop();
    }
  });

  describe('Process Spawning', () => {
    it('should spawn Ghostty process with default configuration', async () => {
      const result = await ghosttyProcess.spawn();
      
      expect(result).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        expect.any(Array),
        expect.objectContaining({
          detached: false,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      );
    });

    it('should spawn Ghostty with custom working directory', async () => {
      const options = { cwd: '/Users/test/projects' };
      
      await ghosttyProcess.spawn(options);
      
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: '/Users/test/projects'
        })
      );
    });

    it('should spawn Ghostty with custom arguments', async () => {
      const options = { args: ['--config', '/path/to/config'] };
      
      await ghosttyProcess.spawn(options);
      
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        ['--config', '/path/to/config'],
        expect.any(Object)
      );
    });

    it('should fail to spawn if binary is not detected', async () => {
      mockIntegration.detectBinary.mockResolvedValue(false);
      
      const result = await ghosttyProcess.spawn();
      
      expect(result).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should fail to spawn if binary path is null', async () => {
      mockIntegration.getBinaryPath.mockResolvedValue(null);
      
      const result = await ghosttyProcess.spawn();
      
      expect(result).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should handle spawn errors gracefully', async () => {
      spawn.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      
      const result = await ghosttyProcess.spawn();
      
      expect(result).toBe(false);
    });
  });

  describe('Process Management', () => {
    it('should track process state correctly', async () => {
      expect(ghosttyProcess.isRunning()).toBe(false);
      
      await ghosttyProcess.spawn();
      
      expect(ghosttyProcess.isRunning()).toBe(true);
      expect(ghosttyProcess.getPid()).toBe(1234);
    });

    it('should stop running process', async () => {
      await ghosttyProcess.spawn();
      
      const result = ghosttyProcess.stop();
      
      expect(result).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(ghosttyProcess.isRunning()).toBe(false);
    });

    it('should handle stop when no process is running', () => {
      const result = ghosttyProcess.stop();
      
      expect(result).toBe(false);
      expect(mockChildProcess.kill).not.toHaveBeenCalled();
    });

    it('should force kill process with SIGKILL', async () => {
      await ghosttyProcess.spawn();
      
      const result = ghosttyProcess.stop(true);
      
      expect(result).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should restart process', async () => {
      await ghosttyProcess.spawn();
      const firstPid = ghosttyProcess.getPid();
      
      // Simulate new process on restart
      const newMockProcess = new EventEmitter();
      newMockProcess.pid = 5678;
      newMockProcess.kill = jest.fn().mockReturnValue(true);
      newMockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      newMockProcess.stdout = new EventEmitter();
      newMockProcess.stderr = new EventEmitter();
      spawn.mockReturnValue(newMockProcess);
      
      const result = await ghosttyProcess.restart();
      
      expect(result).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalled();
      expect(ghosttyProcess.getPid()).toBe(5678);
    });
  });

  describe('Event Handling', () => {
    it('should emit spawn event when process starts', async () => {
      const spawnHandler = jest.fn();
      ghosttyProcess.on('spawn', spawnHandler);
      
      await ghosttyProcess.spawn();
      
      expect(spawnHandler).toHaveBeenCalledWith(1234);
    });

    it('should emit exit event when process exits', async () => {
      const exitHandler = jest.fn();
      ghosttyProcess.on('exit', exitHandler);
      
      await ghosttyProcess.spawn();
      mockChildProcess.emit('exit', 0, null);
      
      expect(exitHandler).toHaveBeenCalledWith(0, null);
      expect(ghosttyProcess.isRunning()).toBe(false);
    });

    it('should emit error event on process error', async () => {
      const errorHandler = jest.fn();
      ghosttyProcess.on('error', errorHandler);
      
      await ghosttyProcess.spawn();
      const error = new Error('Process error');
      mockChildProcess.emit('error', error);
      
      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should forward stdout data', async () => {
      const dataHandler = jest.fn();
      ghosttyProcess.on('stdout', dataHandler);
      
      await ghosttyProcess.spawn();
      const data = Buffer.from('Hello from Ghostty');
      mockChildProcess.stdout.emit('data', data);
      
      expect(dataHandler).toHaveBeenCalledWith(data);
    });

    it('should forward stderr data', async () => {
      const dataHandler = jest.fn();
      ghosttyProcess.on('stderr', dataHandler);
      
      await ghosttyProcess.spawn();
      const data = Buffer.from('Error from Ghostty');
      mockChildProcess.stderr.emit('data', data);
      
      expect(dataHandler).toHaveBeenCalledWith(data);
    });
  });

  describe('Input Handling', () => {
    it('should write to stdin when process is running', async () => {
      await ghosttyProcess.spawn();
      
      const result = ghosttyProcess.write('echo "Hello"\n');
      
      expect(result).toBe(true);
      expect(mockChildProcess.stdin.write).toHaveBeenCalledWith('echo "Hello"\n');
    });

    it('should not write to stdin when process is not running', () => {
      const result = ghosttyProcess.write('echo "Hello"\n');
      
      expect(result).toBe(false);
    });

    it('should handle write errors gracefully', async () => {
      await ghosttyProcess.spawn();
      mockChildProcess.stdin.write.mockImplementation(() => {
        throw new Error('Broken pipe');
      });
      
      const result = ghosttyProcess.write('echo "Hello"\n');
      
      expect(result).toBe(false);
    });
  });

  describe('Process Information', () => {
    it('should return process info when running', async () => {
      await ghosttyProcess.spawn();
      
      const info = ghosttyProcess.getProcessInfo();
      
      expect(info).toEqual({
        running: true,
        pid: 1234,
        uptime: expect.any(Number),
        startTime: expect.any(Date)
      });
    });

    it('should return minimal info when not running', () => {
      const info = ghosttyProcess.getProcessInfo();
      
      expect(info).toEqual({
        running: false,
        pid: null,
        uptime: 0,
        startTime: null
      });
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources on destroy', async () => {
      await ghosttyProcess.spawn();
      
      ghosttyProcess.destroy();
      
      expect(mockChildProcess.kill).toHaveBeenCalled();
      expect(ghosttyProcess.isRunning()).toBe(false);
      expect(ghosttyProcess.listenerCount('spawn')).toBe(0);
    });

    it('should handle multiple destroy calls safely', async () => {
      await ghosttyProcess.spawn();
      
      ghosttyProcess.destroy();
      ghosttyProcess.destroy();
      
      expect(mockChildProcess.kill).toHaveBeenCalledTimes(1);
    });
  });
});