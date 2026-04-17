/**
 * Performance comparison between original and optimized TerminalUI
 */

import { jest } from '@jest/globals';
import { TerminalUI } from '../TerminalUI.js';
import { OptimizedTerminalUI } from '../OptimizedTerminalUI.js';
import { PerformanceTestSuite, MemoryProfiler } from './PerformanceTestSuite.js';

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

describe('TerminalUI Performance Comparison', () => {
  let originalTerminal;
  let optimizedTerminal;
  let suite;
  let memoryProfiler;
  let originalElement;
  let optimizedElement;

  beforeEach(() => {
    originalElement = createMockElement();
    optimizedElement = createMockElement();
    
    originalTerminal = new TerminalUI(originalElement);
    optimizedTerminal = new OptimizedTerminalUI(optimizedElement);
    
    suite = new PerformanceTestSuite();
    memoryProfiler = new MemoryProfiler();
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    suite.reset();
    memoryProfiler.stop();
  });

  describe('Single Output Performance', () => {
    test('should compare performance for single output append', async () => {
      const text = 'Test output line\n';
      
      const originalMetrics = await suite.benchmark('original-single', async () => {
        originalTerminal.appendOutput(text);
      }, 1000);

      const optimizedMetrics = await suite.benchmark('optimized-single', async () => {
        optimizedTerminal.appendOutput(text);
      }, 1000);

      console.log('Single Output Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(originalMetrics.mean);
    });
  });

  describe('Bulk Output Performance', () => {
    test('should compare performance for bulk output', async () => {
      const lines = Array(100).fill().map((_, i) => `Line ${i}: This is a test output line with some content\n`);
      
      const originalMetrics = await suite.measure('original-bulk', async () => {
        lines.forEach(line => originalTerminal.appendOutput(line));
      });

      const optimizedMetrics = await suite.measure('optimized-bulk', async () => {
        lines.forEach(line => optimizedTerminal.appendOutput(line));
      });

      console.log('\nBulk Output Performance (100 lines):');
      console.log(`Original: ${originalMetrics.duration.toFixed(3)}ms`);
      console.log(`Optimized: ${optimizedMetrics.duration.toFixed(3)}ms`);
      console.log(`Improvement: ${((originalMetrics.duration - optimizedMetrics.duration) / originalMetrics.duration * 100).toFixed(1)}%`);

      expect(optimizedMetrics.duration).toBeLessThan(originalMetrics.duration);
      expect(optimizedMetrics.duration).toBeLessThan(100); // Target: <100ms
    });
  });

  describe('Large Output Stress Test', () => {
    test('should handle large outputs efficiently', async () => {
      const lines = Array(1000).fill().map((_, i) => `Large output line ${i}: ${'x'.repeat(50)}\n`);
      
      memoryProfiler.start();
      
      const originalMetrics = await suite.measure('original-large', async () => {
        lines.forEach(line => originalTerminal.appendOutput(line));
      });

      const originalMemory = memoryProfiler.stop();
      
      memoryProfiler.start();
      
      const optimizedMetrics = await suite.measure('optimized-large', async () => {
        lines.forEach(line => optimizedTerminal.appendOutput(line));
      });

      const optimizedMemory = memoryProfiler.stop();

      console.log('\nLarge Output Stress Test (1000 lines):');
      console.log(`Original: ${originalMetrics.duration.toFixed(3)}ms`);
      console.log(`Optimized: ${optimizedMetrics.duration.toFixed(3)}ms`);
      console.log(`Performance improvement: ${((originalMetrics.duration - optimizedMetrics.duration) / originalMetrics.duration * 100).toFixed(1)}%`);
      
      if (originalMemory && optimizedMemory) {
        console.log(`Memory usage - Original: ${(originalMemory.heap.delta / 1024 / 1024).toFixed(2)}MB`);
        console.log(`Memory usage - Optimized: ${(optimizedMemory.heap.delta / 1024 / 1024).toFixed(2)}MB`);
        console.log(`Memory improvement: ${((originalMemory.heap.delta - optimizedMemory.heap.delta) / originalMemory.heap.delta * 100).toFixed(1)}%`);
      }

      expect(optimizedMetrics.duration).toBeLessThan(originalMetrics.duration);
      
      if (originalMemory && optimizedMemory) {
        expect(optimizedMemory.heap.delta).toBeLessThan(originalMemory.heap.delta);
      }
    });
  });

  describe('Rapid Sequential Updates', () => {
    test('should handle rapid sequential updates', async () => {
      const originalMetrics = await suite.measure('original-rapid', async () => {
        for (let i = 0; i < 500; i++) {
          originalTerminal.appendOutput(`Rapid update ${i}\n`);
        }
      });

      const optimizedMetrics = await suite.measure('optimized-rapid', async () => {
        for (let i = 0; i < 500; i++) {
          optimizedTerminal.appendOutput(`Rapid update ${i}\n`);
        }
      });

      console.log('\nRapid Sequential Updates (500 updates):');
      console.log(`Original: ${originalMetrics.duration.toFixed(3)}ms`);
      console.log(`Optimized: ${optimizedMetrics.duration.toFixed(3)}ms`);
      console.log(`Improvement: ${((originalMetrics.duration - optimizedMetrics.duration) / originalMetrics.duration * 100).toFixed(1)}%`);

      expect(optimizedMetrics.duration).toBeLessThan(originalMetrics.duration);
      expect(optimizedMetrics.duration).toBeLessThan(100); // Target: <100ms
    });
  });

  describe('Clear Operation Performance', () => {
    test('should compare clear operation performance', async () => {
      // Pre-populate with content
      for (let i = 0; i < 100; i++) {
        originalTerminal.appendOutput(`Line ${i}\n`);
        optimizedTerminal.appendOutput(`Line ${i}\n`);
      }

      const originalMetrics = await suite.benchmark('original-clear', async () => {
        originalTerminal.clearOutput();
      }, 100);

      const optimizedMetrics = await suite.benchmark('optimized-clear', async () => {
        optimizedTerminal.clearOutput();
      }, 100);

      console.log('\nClear Operation Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(originalMetrics.mean);
    });
  });

  describe('Batching Effectiveness', () => {
    test('should demonstrate batching effectiveness', async () => {
      // Test without batching (simulate original behavior)
      const unbatchedMetrics = await suite.measure('unbatched', async () => {
        for (let i = 0; i < 50; i++) {
          optimizedTerminal.appendOutput(`Line ${i}\n`);
          // Force immediate render by flushing
          optimizedTerminal.flushOutput();
        }
      });

      // Test with batching (normal optimized behavior)
      const batchedMetrics = await suite.measure('batched', async () => {
        for (let i = 0; i < 50; i++) {
          optimizedTerminal.appendOutput(`Line ${i}\n`);
        }
        // Let batching work naturally
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      console.log('\nBatching Effectiveness:');
      console.log(`Without batching: ${unbatchedMetrics.duration.toFixed(3)}ms`);
      console.log(`With batching: ${batchedMetrics.duration.toFixed(3)}ms`);
      console.log(`Batching benefit: ${((unbatchedMetrics.duration - batchedMetrics.duration) / unbatchedMetrics.duration * 100).toFixed(1)}%`);

      expect(batchedMetrics.duration).toBeLessThan(unbatchedMetrics.duration);
    });
  });
});