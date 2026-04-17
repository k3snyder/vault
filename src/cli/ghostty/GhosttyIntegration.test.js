import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock modules before importing
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn()
}));

jest.unstable_mockModule('child_process', () => ({
  execSync: jest.fn()
}));

jest.unstable_mockModule('os', () => ({
  homedir: jest.fn(() => '/Users/testuser')
}));

jest.unstable_mockModule('path', () => ({
  join: jest.fn((...args) => args.join('/'))
}));

const { existsSync } = await import('fs');
const { execSync } = await import('child_process');
const { homedir } = await import('os');
const { GhosttyIntegration } = await import('./GhosttyIntegration.js');

describe('GhosttyIntegration', () => {
  let ghostty;

  beforeEach(() => {
    jest.clearAllMocks();
    ghostty = new GhosttyIntegration();
  });

  describe('Binary Detection', () => {
    it('should detect Ghostty binary in /Applications on macOS', async () => {
      existsSync.mockReturnValue(true);
      
      const result = await ghostty.detectBinary();
      
      expect(result).toBe(true);
      expect(existsSync).toHaveBeenCalledWith('/Applications/Ghostty.app/Contents/MacOS/ghostty');
    });

    it('should detect Ghostty binary in user Applications folder', async () => {
      homedir.mockReturnValue('/Users/testuser');
      existsSync.mockImplementation(path => {
        if (path === '/Applications/Ghostty.app/Contents/MacOS/ghostty') return false;
        if (path === '/Users/testuser/Applications/Ghostty.app/Contents/MacOS/ghostty') return true;
        return false;
      });
      
      const result = await ghostty.detectBinary();
      
      expect(result).toBe(true);
      expect(existsSync).toHaveBeenCalledWith('/Users/testuser/Applications/Ghostty.app/Contents/MacOS/ghostty');
    });

    it('should detect Ghostty binary in PATH', async () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue(Buffer.from('/usr/local/bin/ghostty\n'));
      
      const result = await ghostty.detectBinary();
      
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which ghostty', { encoding: 'utf8' });
    });

    it('should return false when Ghostty is not found', async () => {
      existsSync.mockReturnValue(false);
      execSync.mockImplementation(() => {
        throw new Error('Command failed');
      });
      
      const result = await ghostty.detectBinary();
      
      expect(result).toBe(false);
    });
  });

  describe('Binary Validation', () => {
    it('should validate Ghostty binary version', async () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue(Buffer.from('ghostty 1.0.0\n'));
      
      const isValid = await ghostty.validateBinary();
      
      expect(isValid).toBe(true);
      expect(execSync).toHaveBeenCalledWith('/Applications/Ghostty.app/Contents/MacOS/ghostty --version', { encoding: 'utf8' });
    });

    it('should return false for invalid binary', async () => {
      existsSync.mockReturnValue(true);
      execSync.mockImplementation(() => {
        throw new Error('Not a valid Ghostty binary');
      });
      
      const isValid = await ghostty.validateBinary();
      
      expect(isValid).toBe(false);
    });

    it('should handle version check timeout gracefully', async () => {
      existsSync.mockReturnValue(true);
      execSync.mockImplementation(() => {
        throw new Error('ETIMEDOUT');
      });
      
      const isValid = await ghostty.validateBinary();
      
      expect(isValid).toBe(false);
    });
  });

  describe('Binary Path Resolution', () => {
    it('should return the correct binary path when found in /Applications', async () => {
      existsSync.mockImplementation(path => 
        path === '/Applications/Ghostty.app/Contents/MacOS/ghostty'
      );
      
      const path = await ghostty.getBinaryPath();
      
      expect(path).toBe('/Applications/Ghostty.app/Contents/MacOS/ghostty');
    });

    it('should return the correct binary path when found in user Applications', async () => {
      homedir.mockReturnValue('/Users/testuser');
      existsSync.mockImplementation(path => {
        if (path === '/Applications/Ghostty.app/Contents/MacOS/ghostty') return false;
        if (path === '/Users/testuser/Applications/Ghostty.app/Contents/MacOS/ghostty') return true;
        return false;
      });
      
      const path = await ghostty.getBinaryPath();
      
      expect(path).toBe('/Users/testuser/Applications/Ghostty.app/Contents/MacOS/ghostty');
    });

    it('should return the correct binary path when found in PATH', async () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue(Buffer.from('/usr/local/bin/ghostty\n'));
      
      const path = await ghostty.getBinaryPath();
      
      expect(path).toBe('/usr/local/bin/ghostty');
    });

    it('should return null when binary is not found', async () => {
      existsSync.mockReturnValue(false);
      execSync.mockImplementation(() => {
        throw new Error('Command failed');
      });
      
      const path = await ghostty.getBinaryPath();
      
      expect(path).toBeNull();
    });
  });

  describe('Installation Status', () => {
    it('should report installation status correctly when installed', async () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue(Buffer.from('ghostty 1.0.0\n'));
      
      const status = await ghostty.getInstallationStatus();
      
      expect(status).toEqual({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: '1.0.0',
        valid: true
      });
    });

    it('should report installation status correctly when not installed', async () => {
      existsSync.mockReturnValue(false);
      execSync.mockImplementation(() => {
        throw new Error('Command failed');
      });
      
      const status = await ghostty.getInstallationStatus();
      
      expect(status).toEqual({
        installed: false,
        path: null,
        version: null,
        valid: false
      });
    });

    it('should report invalid installation when binary exists but fails validation', async () => {
      existsSync.mockReturnValue(true);
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('--version')) {
          throw new Error('Invalid binary');
        }
        return Buffer.from('/Applications/Ghostty.app/Contents/MacOS/ghostty\n');
      });
      
      const status = await ghostty.getInstallationStatus();
      
      expect(status).toEqual({
        installed: true,
        path: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
        version: null,
        valid: false
      });
    });
  });
});