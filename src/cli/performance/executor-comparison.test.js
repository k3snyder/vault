/**
 * Performance comparison between original and optimized CommandExecutor
 */

import { jest } from '@jest/globals';
import { CommandExecutor } from '../CommandExecutor.js';
import { OptimizedCommandExecutor } from '../OptimizedCommandExecutor.js';
import { PerformanceTestSuite } from './PerformanceTestSuite.js';

// Mock Tauri API
jest.mock('@tauri-apps/api/tauri', () => ({
  invoke: jest.fn()
}));

describe('CommandExecutor Performance Comparison', () => {
  let originalExecutor;
  let optimizedExecutor;
  let suite;
  let mockInvoke;

  beforeEach(async () => {
    const tauriModule = await import('@tauri-apps/api/tauri');
    mockInvoke = tauriModule.invoke;
    
    originalExecutor = new CommandExecutor();
    optimizedExecutor = new OptimizedCommandExecutor();
    suite = new PerformanceTestSuite();
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    suite.reset();
  });

  describe('Built-in Command Performance', () => {
    test('should compare performance for built-in commands', async () => {
      const originalMetrics = await suite.benchmark('original-builtin', async () => {
        await originalExecutor.executeCommand('help');
      }, 500);

      const optimizedMetrics = await suite.benchmark('optimized-builtin', async () => {
        await optimizedExecutor.executeCommand('help');
      }, 500);

      console.log('Built-in Command Performance (help):');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(originalMetrics.mean);
      expect(optimizedMetrics.mean).toBeLessThan(50); // Target: fast built-in commands
    });
  });

  describe('System Command Performance', () => {
    test('should compare performance for system commands', async () => {
      mockInvoke.mockResolvedValue({ 
        success: true, 
        output: 'file1.txt file2.txt',
        data: ['file1.txt', 'file2.txt']
      });

      const originalMetrics = await suite.benchmark('original-system', async () => {
        await originalExecutor.executeCommand('ls -la');
      }, 100);

      const optimizedMetrics = await suite.benchmark('optimized-system', async () => {
        await optimizedExecutor.executeCommand('ls -la');
      }, 100);

      console.log('\nSystem Command Performance (ls -la):');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(300); // Target: <300ms
    });
  });

  describe('Concurrent Execution Performance', () => {
    test('should handle concurrent executions efficiently', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const originalMetrics = await suite.measure('original-concurrent', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(originalExecutor.executeCommand(`search query${i}`));
        }
        await Promise.all(promises);
      });

      const optimizedMetrics = await suite.measure('optimized-concurrent', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(optimizedExecutor.executeCommand(`search query${i}`));
        }
        await Promise.all(promises);
      });

      console.log('\nConcurrent Execution Performance (10 commands):');
      console.log(`Original: ${originalMetrics.duration.toFixed(3)}ms`);
      console.log(`Optimized: ${optimizedMetrics.duration.toFixed(3)}ms`);
      console.log(`Improvement: ${((originalMetrics.duration - optimizedMetrics.duration) / originalMetrics.duration * 100).toFixed(1)}%`);

      expect(optimizedMetrics.duration).toBeLessThan(500); // Should benefit from queuing
    });
  });

  describe('Cache Effectiveness', () => {
    test('should demonstrate cache effectiveness', async () => {
      mockInvoke.mockResolvedValue({ 
        success: true, 
        output: 'search results',
        data: ['result1', 'result2']
      });

      const cacheableCommand = 'search "test query"';

      // First execution - no cache
      const firstRun = await suite.measure('first-execution', async () => {
        await optimizedExecutor.executeCommand(cacheableCommand);
      });

      // Subsequent executions - should hit cache
      const cachedMetrics = await suite.benchmark('cached-executions', async () => {
        await optimizedExecutor.executeCommand(cacheableCommand);
      }, 100);

      console.log('\nCache Effectiveness:');
      console.log(`First execution: ${firstRun.duration.toFixed(3)}ms`);
      console.log(`Cached executions: ${cachedMetrics.mean.toFixed(3)}ms`);
      console.log(`Cache speedup: ${(firstRun.duration / cachedMetrics.mean).toFixed(1)}x`);

      const stats = optimizedExecutor.getPerformanceStats();
      console.log(`Cache hit rate: ${stats.cacheHitRate.toFixed(1)}%`);

      expect(cachedMetrics.mean).toBeLessThan(firstRun.duration * 0.5);
      expect(stats.cacheHitRate).toBeGreaterThan(90);
    });
  });

  describe('Error Handling Performance', () => {
    test('should handle errors efficiently', async () => {
      mockInvoke.mockRejectedValue(new Error('Command failed'));

      const originalMetrics = await suite.benchmark('original-error', async () => {
        try {
          await originalExecutor.executeCommand('failing-command');
        } catch (error) {
          // Expected to fail
        }
      }, 50);

      const optimizedMetrics = await suite.benchmark('optimized-error', async () => {
        await optimizedExecutor.executeCommand('failing-command');
        // Optimized version returns error result instead of throwing
      }, 50);

      console.log('\nError Handling Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(100); // Fast error handling
    });
  });

  describe('Complex Command Performance', () => {
    test('should handle complex commands efficiently', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const complexCommand = 'search "complex query with multiple terms" --type note --date 2024-01-01 --limit 100 --sort relevance';

      const originalMetrics = await suite.benchmark('original-complex', async () => {
        await originalExecutor.executeCommand(complexCommand);
      }, 100);

      const optimizedMetrics = await suite.benchmark('optimized-complex', async () => {
        await optimizedExecutor.executeCommand(complexCommand);
      }, 100);

      console.log('\nComplex Command Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(300); // Target: <300ms
    });
  });

  describe('Batch Processing Performance', () => {
    test('should handle batch command processing', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const commands = [
        'help',
        'clear',
        'search "test"',
        'ls -la',
        'grep "pattern"'
      ];

      const originalMetrics = await suite.measure('original-batch', async () => {
        for (let i = 0; i < 20; i++) {
          for (const cmd of commands) {
            await originalExecutor.executeCommand(cmd);
          }
        }
      });

      const optimizedMetrics = await suite.measure('optimized-batch', async () => {
        for (let i = 0; i < 20; i++) {
          for (const cmd of commands) {
            await optimizedExecutor.executeCommand(cmd);
          }
        }
      });

      console.log('\nBatch Processing Performance (100 commands):');
      console.log(`Original: ${originalMetrics.duration.toFixed(3)}ms (${(originalMetrics.duration / 100).toFixed(3)}ms per command)`);
      console.log(`Optimized: ${optimizedMetrics.duration.toFixed(3)}ms (${(optimizedMetrics.duration / 100).toFixed(3)}ms per command)`);
      console.log(`Improvement: ${((originalMetrics.duration - optimizedMetrics.duration) / originalMetrics.duration * 100).toFixed(1)}%`);

      const stats = optimizedExecutor.getPerformanceStats();
      console.log(`Average execution time: ${stats.averageExecutionTime.toFixed(3)}ms`);
      console.log(`Commands executed: ${stats.commandsExecuted}`);
      console.log(`Cache hit rate: ${stats.cacheHitRate.toFixed(1)}%`);

      expect(optimizedMetrics.duration).toBeLessThan(originalMetrics.duration);
      expect(optimizedMetrics.duration / 100).toBeLessThan(50); // Less than 50ms per command average
    });
  });
});