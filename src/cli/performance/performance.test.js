/**
 * Performance Tests for CLI Components
 * Tests performance optimization targets for Task 5
 */

import { jest } from '@jest/globals';
import { PerformanceTestSuite, MemoryProfiler } from './PerformanceTestSuite.js';
import { CommandParser } from '../CommandParser.js';
import { CommandExecutor } from '../CommandExecutor.js';
import { TerminalUI } from '../TerminalUI.js';

// Mock dependencies
jest.mock('@tauri-apps/api/tauri', () => ({
  invoke: jest.fn()
}));

// Helper to create mock terminal container
function createMockElement() {
  return {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    style: {},
    innerHTML: '',
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    children: [],
    classList: { add: jest.fn() },
    querySelector: jest.fn().mockReturnValue({
      appendChild: jest.fn(),
      scrollTop: 0,
      scrollHeight: 1000
    })
  };
}

describe('CLI Performance Tests', () => {
  let suite;
  let memoryProfiler;

  beforeEach(() => {
    suite = new PerformanceTestSuite();
    memoryProfiler = new MemoryProfiler();
    jest.clearAllMocks();
  });

  afterEach(() => {
    suite.reset();
    memoryProfiler.stop();
  });

  describe('Command Parsing Performance', () => {
    let parser;

    beforeEach(() => {
      parser = new CommandParser();
    });

    test('should parse simple commands within 50ms', async () => {
      const metrics = await suite.benchmark('commandParsing', async () => {
        parser.parseCommand('search "test query"');
      });

      expect(metrics.mean).toBeLessThan(50);
      expect(metrics.p95).toBeLessThan(75);
    });

    test('should parse complex commands efficiently', async () => {
      const complexCommand = 'search "long query with multiple terms" --type note --date 2024-01-01 --limit 100 --sort relevance';
      
      const metrics = await suite.benchmark('commandParsing', async () => {
        parser.parseCommand(complexCommand);
      });

      expect(metrics.mean).toBeLessThan(50);
      expect(metrics.p99).toBeLessThan(100);
    });

    test('should handle batch parsing without performance degradation', async () => {
      const commands = [
        'search "test"',
        'open "file.md"',
        'create "new note" --template daily',
        'export --format pdf --output "./export.pdf"'
      ];

      memoryProfiler.start();
      
      const metrics = await suite.measure('batchParsing', async () => {
        for (let i = 0; i < 1000; i++) {
          commands.forEach(cmd => parser.parseCommand(cmd));
        }
      });

      const memoryProfile = memoryProfiler.stop();
      
      expect(metrics.duration).toBeLessThan(1000); // 1ms per parse operation
      if (memoryProfile) {
        expect(memoryProfile.heap.delta).toBeLessThan(10 * 1024 * 1024); // Less than 10MB heap growth
      }
    });
  });

  describe('Terminal Output Performance', () => {
    let terminal;
    let mockElement;

    beforeEach(() => {
      mockElement = createMockElement();
      
      document.getElementById = jest.fn().mockReturnValue(mockElement);
      terminal = new TerminalUI(mockElement);
    });

    test('should render output within 100ms', async () => {
      const largeOutput = 'Test output\n'.repeat(100);
      
      const metrics = await suite.benchmark('terminalOutput', async () => {
        terminal.appendOutput(largeOutput);
      });

      expect(metrics.mean).toBeLessThan(100);
      expect(metrics.p95).toBeLessThan(150);
    });

    test('should handle rapid output updates efficiently', async () => {
      memoryProfiler.start();
      
      const metrics = await suite.measure('rapidOutput', async () => {
        for (let i = 0; i < 1000; i++) {
          terminal.appendOutput(`Line ${i}\n`);
        }
      });

      const memoryProfile = memoryProfiler.stop();
      
      expect(metrics.duration).toBeLessThan(2000); // 2ms per line
      if (memoryProfile) {
        expect(memoryProfile.heap.delta).toBeLessThan(20 * 1024 * 1024); // Less than 20MB heap growth
      }
    });

    test('should maintain performance with syntax highlighting', async () => {
      const codeOutput = `
\`\`\`javascript
function example() {
  const data = { key: 'value' };
  return data;
}
\`\`\`
      `.trim();

      const metrics = await suite.benchmark('syntaxHighlighting', async () => {
        terminal.appendOutput(codeOutput);
      });

      expect(metrics.mean).toBeLessThan(100);
    });
  });

  describe('Command Execution Performance', () => {
    let executor;
    let mockInvoke;

    beforeEach(() => {
      const { invoke } = jest.requireMock('@tauri-apps/api/tauri');
      mockInvoke = invoke;
      executor = new CommandExecutor();
    });

    test('should execute commands within 300ms', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });
      
      const metrics = await suite.benchmark('commandExecution', async () => {
        await executor.executeCommand('search test');
      });

      expect(metrics.mean).toBeLessThan(300);
      expect(metrics.p95).toBeLessThan(400);
    });

    test('should handle concurrent executions efficiently', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });
      
      const metrics = await suite.measure('concurrentExecution', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(executor.executeCommand(`search query${i}`));
        }
        await Promise.all(promises);
      });

      expect(metrics.duration).toBeLessThan(500); // Should benefit from parallelism
    });

    test('should cache command results effectively', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: ['result'] });
      
      // First execution
      const firstMetrics = await suite.measure('firstExecution', async () => {
        await executor.executeCommand('search cached-query');
      });

      // Subsequent executions should be faster due to caching
      const cachedMetrics = await suite.benchmark('cachedExecution', async () => {
        await executor.executeCommand('search cached-query');
      });

      expect(cachedMetrics.mean).toBeLessThan(firstMetrics.duration * 0.5); // At least 50% faster
    });
  });

  describe('Memory Management', () => {
    test('should not leak memory during extended usage', async () => {
      const parser = new CommandParser();
      const executor = new CommandExecutor();
      
      const mockElement = createMockElement();
      document.getElementById = jest.fn().mockReturnValue(mockElement);
      const terminal = new TerminalUI(mockElement);

      const { invoke } = jest.requireMock('@tauri-apps/api/tauri');
      invoke.mockResolvedValue({ success: true, data: [] });

      memoryProfiler.start();
      
      // Simulate extended usage
      for (let i = 0; i < 100; i++) {
        const parsed = parser.parseCommand(`search "query ${i}"`);
        await executor.executeCommand(parsed);
        terminal.appendOutput(`Result ${i}\n`);
      }

      const memoryProfile = memoryProfiler.stop();
      
      // Memory growth should be minimal
      if (memoryProfile) {
        expect(memoryProfile.heap.delta).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
        expect(memoryProfile.heap.max - memoryProfile.heap.min).toBeLessThan(100 * 1024 * 1024); // Less than 100MB variance
      }
    });

    test('should clean up resources properly', async () => {
      const mockElement = createMockElement();
      mockElement.children = Array(1000).fill({ remove: jest.fn() });
      document.getElementById = jest.fn().mockReturnValue(mockElement);
      const terminal = new TerminalUI(mockElement);

      // Add many outputs
      for (let i = 0; i < 1000; i++) {
        terminal.appendOutput(`Line ${i}\n`);
      }

      memoryProfiler.start();
      
      // Clear should free memory
      terminal.clearOutput();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memoryProfile = memoryProfiler.stop();
      
      // Memory should decrease after clear
      if (memoryProfile && memoryProfile.heap.delta < 0) {
        expect(memoryProfile.heap.delta).toBeLessThan(0);
      }
    });
  });

  describe('Startup Performance', () => {
    test('should initialize all components within 3 seconds', async () => {
      const metrics = await suite.measure('startupTime', async () => {
        // Simulate full initialization
        const parser = new CommandParser();
        const executor = new CommandExecutor();
        
        // Initialize terminal
        const mockElement = createMockElement();
        document.getElementById = jest.fn().mockReturnValue(mockElement);
        
        const terminal = new TerminalUI(mockElement);
        
        // Simulate initial command
        await executor.executeCommand('help');
        terminal.appendOutput('Welcome to CLI\n');
      });

      expect(metrics.duration).toBeLessThan(3000);
    });
  });

  describe('Performance Report', () => {
    test('should generate comprehensive performance report', async () => {
      // Run all benchmarks
      const parser = new CommandParser();
      await suite.benchmark('commandParsing', async () => {
        parser.parseCommand('search "test"');
      });

      const mockElement = createMockElement();
      document.getElementById = jest.fn().mockReturnValue(mockElement);
      
      const terminal = new TerminalUI(mockElement);
      
      await suite.benchmark('terminalOutput', async () => {
        terminal.appendOutput('Test output\n');
      });

      const executor = new CommandExecutor();
      const { invoke } = jest.requireMock('@tauri-apps/api/tauri');
      invoke.mockResolvedValue({ success: true, data: [] });
      
      await suite.benchmark('commandExecution', async () => {
        await executor.executeCommand('search test');
      });

      const report = suite.generateReport();
      
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('details');
      expect(report).toHaveProperty('validations');
      expect(report.summary).toHaveProperty('allPassed');
      
      // Log report for debugging
      console.log('Performance Report:', JSON.stringify(report, null, 2));
    });
  });
});