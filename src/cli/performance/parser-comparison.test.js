/**
 * Performance comparison between original and optimized CommandParser
 */

import { jest } from '@jest/globals';
import { CommandParser } from '../CommandParser.js';
import { OptimizedCommandParser } from '../OptimizedCommandParser.js';
import { PerformanceTestSuite } from './PerformanceTestSuite.js';

describe('CommandParser Performance Comparison', () => {
  let originalParser;
  let optimizedParser;
  let suite;

  beforeEach(() => {
    originalParser = new CommandParser();
    optimizedParser = new OptimizedCommandParser();
    suite = new PerformanceTestSuite();
  });

  afterEach(() => {
    suite.reset();
  });

  describe('Simple Commands', () => {
    test('should compare performance for simple commands', async () => {
      const command = 'search "test query"';
      
      const originalMetrics = await suite.benchmark('original-simple', async () => {
        originalParser.parseCommand(command);
      }, 1000);

      const optimizedMetrics = await suite.benchmark('optimized-simple', async () => {
        optimizedParser.parseCommand(command);
      }, 1000);

      console.log('Simple Command Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(originalMetrics.mean);
    });
  });

  describe('Complex Commands', () => {
    test('should compare performance for complex commands', async () => {
      const command = 'search "long query with multiple terms" --type note --date 2024-01-01 --limit 100 --sort relevance';
      
      const originalMetrics = await suite.benchmark('original-complex', async () => {
        originalParser.parseCommand(command);
      }, 1000);

      const optimizedMetrics = await suite.benchmark('optimized-complex', async () => {
        optimizedParser.parseCommand(command);
      }, 1000);

      console.log('\nComplex Command Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(originalMetrics.mean);
      expect(optimizedMetrics.mean).toBeLessThan(50); // Target threshold
    });
  });

  describe('Piped Commands', () => {
    test('should compare performance for piped commands', async () => {
      const command = 'search "test" | grep "pattern" | sort --reverse';
      
      const originalMetrics = await suite.benchmark('original-piped', async () => {
        originalParser.parseCommand(command);
      }, 1000);

      const optimizedMetrics = await suite.benchmark('optimized-piped', async () => {
        optimizedParser.parseCommand(command);
      }, 1000);

      console.log('\nPiped Command Performance:');
      console.log(`Original: ${originalMetrics.mean.toFixed(3)}ms (p95: ${originalMetrics.p95.toFixed(3)}ms)`);
      console.log(`Optimized: ${optimizedMetrics.mean.toFixed(3)}ms (p95: ${optimizedMetrics.p95.toFixed(3)}ms)`);
      console.log(`Improvement: ${((originalMetrics.mean - optimizedMetrics.mean) / originalMetrics.mean * 100).toFixed(1)}%`);

      expect(optimizedMetrics.mean).toBeLessThan(originalMetrics.mean);
    });
  });

  describe('Cache Effectiveness', () => {
    test('should demonstrate cache effectiveness', async () => {
      const command = 'search "cached query" --type note --limit 50';
      
      // First run - no cache
      const firstRun = await suite.measure('first-run', async () => {
        optimizedParser.parseCommand(command);
      });

      // Subsequent runs - should hit cache
      const cachedMetrics = await suite.benchmark('cached-runs', async () => {
        optimizedParser.parseCommand(command);
      }, 1000);

      console.log('\nCache Effectiveness:');
      console.log(`First run: ${firstRun.duration.toFixed(3)}ms`);
      console.log(`Cached runs: ${cachedMetrics.mean.toFixed(3)}ms`);
      console.log(`Cache speedup: ${(firstRun.duration / cachedMetrics.mean).toFixed(1)}x`);

      expect(cachedMetrics.mean).toBeLessThan(firstRun.duration * 0.5);
    });
  });

  describe('Batch Processing', () => {
    test('should compare batch processing performance', async () => {
      const commands = [
        'ls -la',
        'search "test query"',
        'open "file.md"',
        'export --format pdf --output "./export.pdf"',
        'grep "pattern" | sort | uniq',
        'echo "hello world" > output.txt',
        'cat file1.txt file2.txt | wc -l'
      ];

      const originalMetrics = await suite.measure('original-batch', async () => {
        for (let i = 0; i < 100; i++) {
          commands.forEach(cmd => originalParser.parseCommand(cmd));
        }
      });

      const optimizedMetrics = await suite.measure('optimized-batch', async () => {
        for (let i = 0; i < 100; i++) {
          commands.forEach(cmd => optimizedParser.parseCommand(cmd));
        }
      });

      console.log('\nBatch Processing Performance (700 commands):');
      console.log(`Original: ${originalMetrics.duration.toFixed(3)}ms (${(originalMetrics.duration / 700).toFixed(3)}ms per command)`);
      console.log(`Optimized: ${optimizedMetrics.duration.toFixed(3)}ms (${(optimizedMetrics.duration / 700).toFixed(3)}ms per command)`);
      console.log(`Improvement: ${((originalMetrics.duration - optimizedMetrics.duration) / originalMetrics.duration * 100).toFixed(1)}%`);

      expect(optimizedMetrics.duration).toBeLessThan(originalMetrics.duration);
      expect(optimizedMetrics.duration / 700).toBeLessThan(1); // Less than 1ms per command
    });
  });
});