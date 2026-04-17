/**
 * Performance Test Suite for CLI Components
 * Measures and validates performance of critical CLI operations
 */

class PerformanceTestSuite {
  constructor() {
    this.results = new Map();
    this.thresholds = {
      commandParsing: 50, // ms
      terminalOutput: 100, // ms
      commandExecution: 300, // ms
      memoryUsage: 100 * 1024 * 1024, // 100MB
      startupTime: 3000 // ms
    };
  }

  /**
   * Measure operation performance
   * @param {string} operation - Operation name
   * @param {Function} fn - Function to measure
   * @returns {Promise<Object>} Performance metrics
   */
  async measure(operation, fn) {
    const startMemory = process.memoryUsage();
    const startTime = performance.now();
    
    try {
      const result = await fn();
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      
      const metrics = {
        operation,
        duration: endTime - startTime,
        memoryDelta: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external,
          rss: endMemory.rss - startMemory.rss
        },
        timestamp: new Date().toISOString(),
        result
      };
      
      this.results.set(operation, metrics);
      return metrics;
    } catch (error) {
      const endTime = performance.now();
      
      const metrics = {
        operation,
        duration: endTime - startTime,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      
      this.results.set(operation, metrics);
      throw error;
    }
  }

  /**
   * Run multiple iterations for statistical accuracy
   * @param {string} operation - Operation name
   * @param {Function} fn - Function to measure
   * @param {number} iterations - Number of iterations
   * @returns {Promise<Object>} Aggregated metrics
   */
  async benchmark(operation, fn, iterations = 100) {
    const runs = [];
    
    // Warm up run
    await fn();
    
    for (let i = 0; i < iterations; i++) {
      const metrics = await this.measure(`${operation}_${i}`, fn);
      runs.push(metrics);
    }
    
    const durations = runs.map(r => r.duration);
    const aggregated = {
      operation,
      iterations,
      min: Math.min(...durations),
      max: Math.max(...durations),
      mean: durations.reduce((a, b) => a + b, 0) / durations.length,
      median: this.getMedian(durations),
      p95: this.getPercentile(durations, 95),
      p99: this.getPercentile(durations, 99),
      timestamp: new Date().toISOString()
    };
    
    this.results.set(operation, aggregated);
    return aggregated;
  }

  /**
   * Calculate median value
   * @param {number[]} values - Array of values
   * @returns {number} Median value
   */
  getMedian(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    return sorted[mid];
  }

  /**
   * Calculate percentile value
   * @param {number[]} values - Array of values
   * @param {number} percentile - Percentile to calculate (0-100)
   * @returns {number} Percentile value
   */
  getPercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  /**
   * Validate performance against thresholds
   * @param {string} operation - Operation to validate
   * @returns {Object} Validation result
   */
  validate(operation) {
    const metrics = this.results.get(operation);
    if (!metrics) {
      return { valid: false, error: 'No metrics found for operation' };
    }
    
    const threshold = this.thresholds[operation];
    if (!threshold) {
      return { valid: true, warning: 'No threshold defined for operation' };
    }
    
    const duration = metrics.mean || metrics.duration;
    const valid = duration <= threshold;
    
    return {
      valid,
      threshold,
      actual: duration,
      percentOver: valid ? 0 : ((duration - threshold) / threshold) * 100
    };
  }

  /**
   * Generate performance report
   * @returns {Object} Performance report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {},
      details: {},
      validations: {}
    };
    
    for (const [operation, metrics] of this.results) {
      // Skip individual runs
      if (operation.includes('_')) continue;
      
      report.details[operation] = metrics;
      
      const validation = this.validate(operation);
      report.validations[operation] = validation;
      
      report.summary[operation] = {
        duration: metrics.mean || metrics.duration,
        valid: validation.valid
      };
    }
    
    report.summary.allPassed = Object.values(report.validations)
      .every(v => v.valid);
    
    return report;
  }

  /**
   * Reset test results
   */
  reset() {
    this.results.clear();
  }
}

/**
 * Memory profiler for tracking memory usage
 */
class MemoryProfiler {
  constructor() {
    this.baseline = null;
    this.samples = [];
    this.interval = null;
  }

  /**
   * Start memory profiling
   * @param {number} sampleInterval - Sampling interval in ms
   */
  start(sampleInterval = 100) {
    this.baseline = process.memoryUsage();
    this.samples = [];
    
    this.interval = setInterval(() => {
      const current = process.memoryUsage();
      this.samples.push({
        timestamp: Date.now(),
        heapUsed: current.heapUsed,
        heapTotal: current.heapTotal,
        external: current.external,
        rss: current.rss
      });
    }, sampleInterval);
  }

  /**
   * Stop memory profiling
   * @returns {Object} Memory profile summary
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    if (this.samples.length === 0) {
      return null;
    }
    
    const heapUsed = this.samples.map(s => s.heapUsed);
    const rss = this.samples.map(s => s.rss);
    
    return {
      samples: this.samples.length,
      duration: this.samples[this.samples.length - 1].timestamp - this.samples[0].timestamp,
      heap: {
        min: Math.min(...heapUsed),
        max: Math.max(...heapUsed),
        mean: heapUsed.reduce((a, b) => a + b, 0) / heapUsed.length,
        delta: this.samples[this.samples.length - 1].heapUsed - this.baseline.heapUsed
      },
      rss: {
        min: Math.min(...rss),
        max: Math.max(...rss),
        mean: rss.reduce((a, b) => a + b, 0) / rss.length,
        delta: this.samples[this.samples.length - 1].rss - this.baseline.rss
      }
    };
  }

  /**
   * Get memory usage snapshots
   * @returns {Array} Memory samples
   */
  getSnapshots() {
    return [...this.samples];
  }
}

export { PerformanceTestSuite, MemoryProfiler };