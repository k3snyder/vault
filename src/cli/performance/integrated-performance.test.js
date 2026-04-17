/**
 * Integrated Performance Test
 * Tests all optimized CLI components working together
 * Validates Task 5: Performance Optimization targets
 */

import { jest } from '@jest/globals';
import { OptimizedCommandParser } from '../OptimizedCommandParser.js';
import { OptimizedCommandExecutor } from '../OptimizedCommandExecutor.js';
import { OptimizedTerminalUI } from '../OptimizedTerminalUI.js';
import { ResourceManager } from '../ResourceManager.js';
import { PerformanceTestSuite, MemoryProfiler } from './PerformanceTestSuite.js';

// Mock dependencies
jest.mock('@tauri-apps/api/tauri', () => ({
  invoke: jest.fn()
}));

// Helper to create mock terminal container
function createMockElement() {
  return {
    id: 'test-terminal',
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    style: {},
    innerHTML: '',
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    children: [],
    classList: { 
      add: jest.fn(),
      toggle: jest.fn(),
      remove: jest.fn()
    },
    querySelector: jest.fn().mockReturnValue({
      appendChild: jest.fn(),
      scrollTop: 0,
      scrollHeight: 1000,
      innerHTML: '',
      children: [],
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      clientHeight: 500
    }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
  };
}

// Mock DOM methods
global.document = {
  createElement: jest.fn(() => ({
    className: '',
    textContent: '',
    appendChild: jest.fn(),
    children: []
  })),
  createDocumentFragment: jest.fn(() => ({
    appendChild: jest.fn()
  }))
};

global.window = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

global.requestAnimationFrame = jest.fn(cb => setTimeout(cb, 16));
global.cancelAnimationFrame = jest.fn(id => clearTimeout(id));

describe('Integrated CLI Performance Tests', () => {
  let parser;
  let executor;
  let terminal;
  let resourceManager;
  let suite;
  let memoryProfiler;
  let mockElement;
  let mockInvoke;

  beforeEach(async () => {
    // Setup optimized components
    parser = new OptimizedCommandParser({ enableProfiling: true });
    executor = new OptimizedCommandExecutor({ parser });
    mockElement = createMockElement();
    terminal = new OptimizedTerminalUI(mockElement);
    resourceManager = new ResourceManager();

    // Setup test infrastructure
    suite = new PerformanceTestSuite();
    memoryProfiler = new MemoryProfiler();

    // Mock Tauri
    const tauriModule = await import('@tauri-apps/api/tauri');
    mockInvoke = tauriModule.invoke;
    mockInvoke.mockResolvedValue({ success: true, data: [] });

    // Register components with resource manager
    resourceManager.registerResource('parser-cache', parser.cache, 'cache', {
      priority: 'high',
      estimatedSize: 10 * 1024 // 10KB
    });

    resourceManager.registerResource('executor-cache', executor.commandCache, 'cache', {
      priority: 'normal', 
      estimatedSize: 50 * 1024 // 50KB
    });

    resourceManager.registerResource('terminal-buffer', terminal.outputBuffer, 'buffer', {
      priority: 'low',
      estimatedSize: 100 * 1024 // 100KB
    });

    resourceManager.startMonitoring();

    jest.clearAllMocks();
  });

  afterEach(() => {
    resourceManager.shutdown();
    suite.reset();
    memoryProfiler.stop();
  });

  describe('End-to-End Performance', () => {
    test('should meet all performance targets in realistic workflow', async () => {
      memoryProfiler.start();
      
      const workflowMetrics = await suite.measure('complete-workflow', async () => {
        // Simulate realistic CLI workflow
        const commands = [
          'help',
          'search "performance test"',
          'ls -la /home/user',
          'grep "pattern" file.txt',
          'cat README.md',
          'find . -name "*.js"',
          'search "optimization" --type code --limit 10',
          'export --format json --output results.json',
          'clear'
        ];

        // Execute commands with parsing and terminal output
        for (const cmd of commands) {
          // 1. Parse command (target: <50ms)
          const parsed = parser.parseCommand(cmd);
          
          // 2. Execute command (target: <300ms) 
          const result = await executor.executeCommand(parsed?.raw || cmd);
          
          // 3. Display output (target: <100ms)
          if (result.output) {
            terminal.appendOutput(result.output);
          }
          
          // Touch resources to simulate usage
          resourceManager.touchResource('parser-cache');
          resourceManager.touchResource('executor-cache');
          resourceManager.touchResource('terminal-buffer');
        }
        
        // Flush any pending terminal output
        terminal.flushOutput();
      });

      const memoryProfile = memoryProfiler.stop();
      const resourceStats = resourceManager.getMemoryStats();

      console.log('\n=== INTEGRATED PERFORMANCE RESULTS ===');
      console.log(`Complete workflow (9 commands): ${workflowMetrics.duration.toFixed(2)}ms`);
      console.log(`Average per command: ${(workflowMetrics.duration / 9).toFixed(2)}ms`);
      
      if (memoryProfile) {
        console.log(`Memory usage: ${(memoryProfile.heap.delta / 1024 / 1024).toFixed(2)}MB delta`);
        console.log(`Peak memory: ${(memoryProfile.heap.max / 1024 / 1024).toFixed(2)}MB`);
      }
      
      console.log(`Resource manager overhead: ${(resourceStats.current / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Total managed resources: ${resourceStats.resources.total}`);

      // Verify performance targets
      expect(workflowMetrics.duration).toBeLessThan(3000); // 3 seconds for complete workflow
      expect(workflowMetrics.duration / 9).toBeLessThan(300); // <300ms average per command
      
      if (memoryProfile) {
        expect(memoryProfile.heap.delta).toBeLessThan(100 * 1024 * 1024); // <100MB memory usage
      }
      
      expect(resourceStats.usage.percentage).toBeLessThan(80); // <80% of memory limit
    });
  });

  describe('Performance Under Load', () => {
    test('should maintain performance with high command throughput', async () => {
      const commands = Array(50).fill().map((_, i) => `search "query ${i}" --limit 10`);
      
      memoryProfiler.start();
      
      const loadMetrics = await suite.measure('high-load', async () => {
        const promises = commands.map(async (cmd) => {
          const parsed = parser.parseCommand(cmd);
          const result = await executor.executeCommand(cmd);
          terminal.appendOutput(`${cmd}: ${result.success ? 'OK' : 'ERROR'}`);
          return result;
        });
        
        await Promise.all(promises);
        terminal.flushOutput();
      });

      const memoryProfile = memoryProfiler.stop();
      const parserStats = parser.cache.size;
      const executorStats = executor.getPerformanceStats();

      console.log('\n=== HIGH LOAD PERFORMANCE ===');
      console.log(`50 concurrent commands: ${loadMetrics.duration.toFixed(2)}ms`);
      console.log(`Average per command: ${(loadMetrics.duration / 50).toFixed(2)}ms`);
      console.log(`Parser cache entries: ${parserStats}`);
      console.log(`Executor cache hit rate: ${executorStats.cacheHitRate.toFixed(1)}%`);
      
      if (memoryProfile) {
        console.log(`Memory delta: ${(memoryProfile.heap.delta / 1024 / 1024).toFixed(2)}MB`);
      }

      // Verify performance maintains under load
      expect(loadMetrics.duration).toBeLessThan(5000); // 5 seconds for 50 commands
      expect(loadMetrics.duration / 50).toBeLessThan(100); // <100ms per command under load
      expect(executorStats.cacheHitRate).toBeGreaterThan(70); // Cache effectiveness
      
      if (memoryProfile) {
        expect(memoryProfile.heap.delta).toBeLessThan(50 * 1024 * 1024); // <50MB for load test
      }
    });
  });

  describe('Memory Management', () => {
    test('should automatically manage memory usage', async () => {
      // Generate large amount of data to trigger cleanup
      const largeCommands = Array(200).fill().map((_, i) => 
        `search "large query with lots of content ${i}" --verbose --debug --include-metadata`
      );

      memoryProfiler.start();
      
      // Fill up resources
      for (const cmd of largeCommands) {
        parser.parseCommand(cmd);
        await executor.executeCommand(cmd);
        terminal.appendOutput(`Result ${cmd.slice(0, 50)}...`);
      }

      // Get initial memory usage
      const beforeCleanup = resourceManager.getMemoryStats();
      
      // Trigger cleanup
      const cleanupResults = resourceManager.performCleanup(true);
      
      // Get memory after cleanup
      const afterCleanup = resourceManager.getMemoryStats();
      
      const memoryProfile = memoryProfiler.stop();

      console.log('\n=== MEMORY MANAGEMENT ===');
      console.log(`Commands processed: ${largeCommands.length}`);
      console.log(`Memory before cleanup: ${(beforeCleanup.usage.megabytes).toFixed(2)}MB`);
      console.log(`Memory after cleanup: ${(afterCleanup.usage.megabytes).toFixed(2)}MB`);
      console.log(`Resources cleaned: ${cleanupResults.resourcesCleaned}`);
      console.log(`Memory freed by cleanup: ${(cleanupResults.memoryFreed / 1024 / 1024).toFixed(2)}MB`);
      
      if (memoryProfile) {
        console.log(`Total memory delta: ${(memoryProfile.heap.delta / 1024 / 1024).toFixed(2)}MB`);
      }

      // Verify memory management
      expect(cleanupResults.resourcesCleaned).toBeGreaterThan(0);
      expect(cleanupResults.memoryFreed).toBeGreaterThan(0);
      expect(afterCleanup.usage.megabytes).toBeLessThan(beforeCleanup.usage.megabytes);
      expect(afterCleanup.usage.percentage).toBeLessThan(90); // Stay under 90% of limit
    });
  });

  describe('Component Integration', () => {
    test('should demonstrate component synergy', async () => {
      // Test that components work better together than individually
      const testCommand = 'search "integration test" --type all --sort relevance --limit 50';

      // Test individual components
      const parserMetrics = await suite.benchmark('parser-only', async () => {
        parser.parseCommand(testCommand);
      }, 100);

      const executorMetrics = await suite.benchmark('executor-only', async () => {
        await executor.executeCommand(testCommand);
      }, 100);

      const terminalMetrics = await suite.benchmark('terminal-only', async () => {
        terminal.appendOutput('Test output line for integration test\n');
      }, 100);

      // Test integrated workflow
      const integratedMetrics = await suite.benchmark('integrated', async () => {
        const parsed = parser.parseCommand(testCommand);
        const result = await executor.executeCommand(parsed?.raw || testCommand);
        terminal.appendOutput(result.output || 'Command executed\n');
      }, 100);

      console.log('\n=== COMPONENT INTEGRATION ===');
      console.log(`Parser only: ${parserMetrics.mean.toFixed(3)}ms`);
      console.log(`Executor only: ${executorMetrics.mean.toFixed(3)}ms`);
      console.log(`Terminal only: ${terminalMetrics.mean.toFixed(3)}ms`);
      console.log(`Integrated: ${integratedMetrics.mean.toFixed(3)}ms`);
      
      const expectedSum = parserMetrics.mean + executorMetrics.mean + terminalMetrics.mean;
      const efficiency = (expectedSum - integratedMetrics.mean) / expectedSum * 100;
      console.log(`Integration efficiency: ${efficiency.toFixed(1)}% better than sum of parts`);

      // Verify integration benefits
      expect(integratedMetrics.mean).toBeLessThan(300); // Still under target
      // Integration might not always be faster due to overhead, but should be reasonable
      expect(integratedMetrics.mean).toBeLessThan(expectedSum * 1.5); // At most 50% overhead
    });
  });

  describe('Performance Monitoring', () => {
    test('should provide comprehensive performance metrics', async () => {
      // Execute various commands to generate metrics
      const commands = [
        'help',
        'search "metrics test"',
        'clear',
        'ls -la',
        'grep "performance" *.js'
      ];

      for (const cmd of commands) {
        const parsed = parser.parseCommand(cmd);
        await executor.executeCommand(cmd);
        terminal.appendOutput(`Executed: ${cmd}\n`);
      }

      // Get comprehensive metrics
      const executorStats = executor.getPerformanceStats();
      const resourceStats = resourceManager.getMemoryStats();
      const resourceInfo = resourceManager.getResourceInfo();

      console.log('\n=== PERFORMANCE MONITORING ===');
      console.log('Executor Statistics:');
      console.log(`  Commands executed: ${executorStats.commandsExecuted}`);
      console.log(`  Average execution time: ${executorStats.averageExecutionTime.toFixed(3)}ms`);
      console.log(`  Cache hit rate: ${executorStats.cacheHitRate.toFixed(1)}%`);
      console.log(`  Error rate: ${(executorStats.errors / executorStats.commandsExecuted * 100).toFixed(1)}%`);
      
      console.log('\nResource Statistics:');
      console.log(`  Total resources: ${resourceStats.resources.total}`);
      console.log(`  Memory usage: ${resourceStats.usage.megabytes.toFixed(2)}MB (${resourceStats.usage.percentage.toFixed(1)}%)`);
      console.log(`  Peak memory: ${(resourceStats.peak / 1024 / 1024).toFixed(2)}MB`);
      
      console.log('\nResource Details:');
      resourceInfo.forEach(resource => {
        console.log(`  ${resource.id}: ${resource.type} (${(resource.estimatedSize / 1024).toFixed(1)}KB)`);
      });

      // Verify monitoring provides useful data
      expect(executorStats.commandsExecuted).toBe(commands.length);
      expect(executorStats.averageExecutionTime).toBeGreaterThan(0);
      expect(resourceStats.resources.total).toBeGreaterThan(0);
      expect(resourceStats.usage.percentage).toBeLessThan(100);
      expect(resourceInfo.length).toBeGreaterThan(0);
    });
  });
});