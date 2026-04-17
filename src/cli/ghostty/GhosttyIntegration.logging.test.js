import { jest, describe, it, expect, beforeEach } from '@jest/globals';

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

// Import after mocking
const { existsSync } = await import('fs');
const { execSync } = await import('child_process');
const { GhosttyIntegration } = await import('./GhosttyIntegration.js');

describe('GhosttyIntegration - Error Handling and Logging', () => {
    let integration;
    let mockLogger;
    let mockErrorHandler;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
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
        
        // Create integration with mocks
        integration = new GhosttyIntegration({
            logger: mockLogger,
            errorHandler: mockErrorHandler
        });
        
        // Default mock implementations
        existsSync.mockReturnValue(false);
        execSync.mockImplementation(() => {
            throw new Error('Command not found');
        });
    });
    
    describe('binary detection logging', () => {
        it('should log detection process', async () => {
            await integration.detectBinary();
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'GhosttyIntegration: Starting binary detection'
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'GhosttyIntegration: Checking path',
                expect.any(String)
            );
        });
        
        it('should log successful detection', async () => {
            existsSync.mockReturnValueOnce(true);
            
            const result = await integration.detectBinary();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'GhosttyIntegration: Binary found at',
                expect.any(String)
            );
            expect(result).toBe(true);
        });
        
        it('should log when checking PATH', async () => {
            execSync.mockReturnValueOnce('/usr/local/bin/ghostty\n');
            
            await integration.detectBinary();
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'GhosttyIntegration: Checking system PATH'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'GhosttyIntegration: Binary found in PATH',
                '/usr/local/bin/ghostty'
            );
        });
        
        it('should log when binary not found', async () => {
            const result = await integration.detectBinary();
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'GhosttyIntegration: Binary not found in any location'
            );
            expect(result).toBe(false);
        });
    });
    
    describe('binary validation logging', () => {
        it('should log validation process', async () => {
            integration.detectedPath = '/path/to/ghostty';
            execSync.mockReturnValueOnce('ghostty 1.0.0');
            
            await integration.validateBinary();
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'GhosttyIntegration: Validating binary',
                '/path/to/ghostty'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'GhosttyIntegration: Binary validation successful'
            );
        });
        
        it('should log validation errors', async () => {
            integration.detectedPath = '/path/to/ghostty';
            const error = new Error('Permission denied');
            execSync.mockImplementation(() => { throw error; });
            
            const result = await integration.validateBinary();
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'GhosttyIntegration: Binary validation failed',
                error
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
                error,
                'GhosttyIntegration.validateBinary'
            );
            expect(result).toBe(false);
        });
        
        it('should handle missing binary path', async () => {
            const result = await integration.validateBinary();
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'GhosttyIntegration: Cannot validate - no binary path'
            );
            expect(result).toBe(false);
        });
    });
    
    describe('installation status logging', () => {
        it('should log comprehensive status check', async () => {
            existsSync.mockReturnValueOnce(true);
            execSync.mockReturnValueOnce('ghostty 1.2.3');
            
            const status = await integration.getInstallationStatus();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'GhosttyIntegration: Checking installation status'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'GhosttyIntegration: Installation status',
                expect.objectContaining({
                    installed: true,
                    version: '1.2.3',
                    valid: true
                })
            );
        });
        
        it('should log version extraction issues', async () => {
            existsSync.mockReturnValueOnce(true);
            execSync.mockReturnValueOnce('invalid version output');
            
            await integration.getInstallationStatus();
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'GhosttyIntegration: Could not extract version from output',
                'invalid version output'
            );
        });
        
        it('should handle version check errors gracefully', async () => {
            existsSync.mockReturnValueOnce(true);
            const error = new Error('Segmentation fault');
            execSync.mockImplementation(() => { throw error; });
            
            const status = await integration.getInstallationStatus();
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'GhosttyIntegration: Error checking version',
                error
            );
            expect(mockErrorHandler.handleWarning).toHaveBeenCalledWith(
                'Failed to get Ghostty version',
                'GhosttyIntegration.getInstallationStatus'
            );
            expect(status.installed).toBe(true);
            expect(status.valid).toBe(false);
        });
    });
    
    describe('error recovery', () => {
        it.skip('should retry on temporary failures', async () => {
            existsSync.mockReturnValueOnce(false);
            execSync
                .mockImplementationOnce(() => { throw new Error('Temporary failure'); })
                .mockReturnValueOnce('/usr/local/bin/ghostty\n');
            
            const result = await integration.detectBinary();
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'GhosttyIntegration: Retrying after temporary failure'
            );
            expect(result).toBe(true);
        });
        
        it('should handle permission errors specially', async () => {
            integration.detectedPath = '/path/to/ghostty';
            const error = new Error('EACCES: permission denied');
            execSync.mockImplementation(() => { throw error; });
            
            await integration.validateBinary();
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'GhosttyIntegration: Permission denied accessing binary'
            );
            expect(mockErrorHandler.handleError).toHaveBeenCalledTimes(2);
            expect(mockErrorHandler.handleError).toHaveBeenNthCalledWith(1,
                expect.objectContaining({
                    message: expect.stringContaining('Permission denied accessing Ghostty binary')
                }),
                'GhosttyIntegration.permissions'
            );
        });
        
        it('should provide installation hints', async () => {
            const result = await integration.detectBinary();
            
            expect(mockLogger.info).toHaveBeenCalledWith(
                'GhosttyIntegration: Installation hint',
                expect.stringContaining('Install Ghostty from')
            );
        });
    });
    
    describe('performance logging', () => {
        it.skip('should log detection time for slow operations', async () => {
            // Mock slow file system check
            existsSync.mockImplementation(() => {
                const start = Date.now();
                while (Date.now() - start < 100) {} // Simulate slow check
                return false;
            });
            
            await integration.detectBinary();
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'GhosttyIntegration: Slow detection',
                expect.objectContaining({
                    elapsed: expect.any(Number)
                })
            );
        });
    });
    
    describe('path handling', () => {
        it('should log path normalization', async () => {
            execSync.mockReturnValueOnce('  /path/with/spaces/ghostty  \n');
            
            await integration.detectBinary();
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'GhosttyIntegration: Normalized path',
                '/path/with/spaces/ghostty'
            );
        });
        
        it('should warn about unusual paths', async () => {
            existsSync.mockImplementation(path => 
                path === '/Users/testuser/Applications/Ghostty.app/Contents/MacOS/ghostty'
            );
            
            await integration.detectBinary();
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'GhosttyIntegration: Binary found in user-specific location',
                expect.any(String)
            );
        });
    });
});