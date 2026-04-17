import { jest } from '@jest/globals';
import Logger from './Logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock fs module
jest.mock('fs');

describe('Logger', () => {
    let logger;
    let mockWriteStream;
    const mockDate = new Date('2025-01-15T10:30:45.123Z');
    
    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Mock Date
        jest.useFakeTimers();
        jest.setSystemTime(mockDate);
        
        // Mock write stream
        mockWriteStream = {
            write: jest.fn(),
            end: jest.fn(),
            on: jest.fn()
        };
        
        // Mock fs functions
        fs.existsSync = jest.fn().mockReturnValue(true);
        fs.mkdirSync = jest.fn();
        fs.createWriteStream = jest.fn().mockReturnValue(mockWriteStream);
        
        // Create logger instance
        logger = new Logger();
    });
    
    afterEach(() => {
        jest.useRealTimers();
    });
    
    describe('constructor', () => {
        test('should create logs directory if it does not exist', () => {
            fs.existsSync.mockReturnValue(false);
            
            new Logger();
            
            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('logs'),
                { recursive: true }
            );
        });
        
        test('should not create logs directory if it already exists', () => {
            fs.existsSync.mockReturnValue(true);
            
            new Logger();
            
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
        
        test('should create log file with timestamp', () => {
            new Logger();
            
            expect(fs.createWriteStream).toHaveBeenCalledWith(
                expect.stringMatching(/logs\/cli-\d{8}-\d{6}\.log/),
                { flags: 'a' }
            );
        });
    });
    
    describe('log levels', () => {
        test('should log info messages', () => {
            logger.info('Test info message');
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('[INFO]')
            );
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('Test info message')
            );
        });
        
        test('should log error messages', () => {
            logger.error('Test error message');
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR]')
            );
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('Test error message')
            );
        });
        
        test('should log warning messages', () => {
            logger.warn('Test warning message');
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('[WARN]')
            );
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('Test warning message')
            );
        });
        
        test('should log debug messages', () => {
            logger.debug('Test debug message');
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('[DEBUG]')
            );
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('Test debug message')
            );
        });
    });
    
    describe('log format', () => {
        test('should include timestamp in log entries', () => {
            logger.info('Test message');
            
            const logCall = mockWriteStream.write.mock.calls[0][0];
            expect(logCall).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
        });
        
        test('should format log entries correctly', () => {
            logger.info('Test message');
            
            const expectedFormat = '[2025-01-15T10:30:45.123Z] [INFO] Test message\n';
            expect(mockWriteStream.write).toHaveBeenCalledWith(expectedFormat);
        });
    });
    
    describe('error handling', () => {
        test('should handle write stream errors gracefully', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            
            // Simulate write stream error
            mockWriteStream.write.mockImplementation(() => {
                throw new Error('Write failed');
            });
            
            expect(() => logger.info('Test message')).not.toThrow();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to write to log file:',
                expect.any(Error)
            );
            
            consoleErrorSpy.mockRestore();
        });
        
        test('should handle file creation errors', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            
            fs.createWriteStream.mockImplementation(() => {
                throw new Error('Cannot create file');
            });
            
            expect(() => new Logger()).not.toThrow();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to create log file:',
                expect.any(Error)
            );
            
            consoleErrorSpy.mockRestore();
        });
    });
    
    describe('close', () => {
        test('should close the write stream', () => {
            logger.close();
            
            expect(mockWriteStream.end).toHaveBeenCalled();
        });
        
        test('should handle close errors gracefully', () => {
            mockWriteStream.end.mockImplementation(() => {
                throw new Error('Close failed');
            });
            
            expect(() => logger.close()).not.toThrow();
        });
    });
    
    describe('getLogPath', () => {
        test('should return the current log file path', () => {
            const logPath = logger.getLogPath();
            
            expect(logPath).toMatch(/logs\/cli-\d{8}-\d{6}\.log$/);
        });
    });
    
    describe('object logging', () => {
        test('should stringify objects when logging', () => {
            const obj = { key: 'value', nested: { prop: 123 } };
            logger.info('Object data:', obj);
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining(JSON.stringify(obj))
            );
        });
        
        test('should handle circular references in objects', () => {
            const obj = { name: 'test' };
            obj.circular = obj;
            
            expect(() => logger.info('Circular:', obj)).not.toThrow();
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('[Circular Reference]')
            );
        });
    });
    
    describe('multiple arguments', () => {
        test('should concatenate multiple arguments', () => {
            logger.info('Message', 'with', 'multiple', 'parts');
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('Message with multiple parts')
            );
        });
        
        test('should handle mixed types in arguments', () => {
            logger.info('Status:', 200, { success: true });
            
            expect(mockWriteStream.write).toHaveBeenCalledWith(
                expect.stringContaining('Status: 200 {"success":true}')
            );
        });
    });
});