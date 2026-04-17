/**
 * Resource Manager for CLI Components
 * Manages memory usage, cleanup, and resource monitoring
 * Target: Keep total CLI memory usage under 100MB
 */

export class ResourceManager {
  constructor(options = {}) {
    this.maxMemoryUsage = options.maxMemoryUsage || 100 * 1024 * 1024; // 100MB
    this.cleanupInterval = options.cleanupInterval || 30000; // 30 seconds
    this.monitoringInterval = options.monitoringInterval || 5000; // 5 seconds
    
    // Resource tracking
    this.resources = new Map();
    this.memoryUsage = {
      current: 0,
      peak: 0,
      baseline: 0
    };
    
    // Cleanup strategies
    this.cleanupStrategies = new Map();
    this.isMonitoring = false;
    this.cleanupTimer = null;
    this.monitoringTimer = null;
    
    // Event handling
    this.eventListeners = new Map();
    
    // Logger
    this.logger = options.logger || null;
    
    // Initialize default cleanup strategies
    this.initializeDefaultStrategies();
  }

  initializeDefaultStrategies() {
    // Cache cleanup - remove old entries
    this.registerCleanupStrategy('cache', (resource) => {
      const cache = resource.instance;
      if (cache && typeof cache.clear === 'function') {
        const sizeBefore = cache.size || 0;
        cache.clear();
        return { itemsCleared: sizeBefore, memoryFreed: sizeBefore * 1024 };
      }
      return { itemsCleared: 0, memoryFreed: 0 };
    });

    // Buffer cleanup - trim buffers
    this.registerCleanupStrategy('buffer', (resource) => {
      const buffer = resource.instance;
      let memoryFreed = 0;
      
      if (Array.isArray(buffer)) {
        memoryFreed = buffer.length * 100; // Estimate
        buffer.length = 0;
      } else if (buffer && typeof buffer.clear === 'function') {
        memoryFreed = (buffer.size || buffer.length || 0) * 100;
        buffer.clear();
      }
      
      return { itemsCleared: 1, memoryFreed };
    });

    // DOM cleanup - remove unused elements
    this.registerCleanupStrategy('dom', (resource) => {
      const element = resource.instance;
      let elementsRemoved = 0;
      let memoryFreed = 0;
      
      if (element && element.children) {
        const childCount = element.children.length;
        
        // Keep only recent elements (last 100)
        if (childCount > 100) {
          const toRemove = childCount - 100;
          for (let i = 0; i < toRemove; i++) {
            element.removeChild(element.children[0]);
            elementsRemoved++;
            memoryFreed += 200; // Estimate per element
          }
        }
      }
      
      return { itemsCleared: elementsRemoved, memoryFreed };
    });

    // Event listener cleanup
    this.registerCleanupStrategy('events', (resource) => {
      const eventManager = resource.instance;
      let listenersRemoved = 0;
      
      if (eventManager && typeof eventManager.clear === 'function') {
        listenersRemoved = eventManager.size || 0;
        eventManager.clear();
      }
      
      return { itemsCleared: listenersRemoved, memoryFreed: listenersRemoved * 50 };
    });
  }

  /**
   * Register a resource for monitoring and cleanup
   */
  registerResource(id, instance, type, options = {}) {
    const resource = {
      id,
      instance,
      type,
      registeredAt: Date.now(),
      lastAccessed: Date.now(),
      priority: options.priority || 'normal', // high, normal, low
      persistent: options.persistent || false,
      estimatedSize: options.estimatedSize || 0,
      metadata: options.metadata || {}
    };

    this.resources.set(id, resource);
    this.updateMemoryUsage();

    if (this.logger) {
      this.logger.debug(`ResourceManager: Registered resource ${id} of type ${type}`);
    }

    this.emit('resourceRegistered', { id, type, estimatedSize: resource.estimatedSize });
  }

  /**
   * Unregister a resource
   */
  unregisterResource(id) {
    const resource = this.resources.get(id);
    if (!resource) return false;

    this.resources.delete(id);
    this.updateMemoryUsage();

    if (this.logger) {
      this.logger.debug(`ResourceManager: Unregistered resource ${id}`);
    }

    this.emit('resourceUnregistered', { id, type: resource.type });
    return true;
  }

  /**
   * Update last accessed time for a resource
   */
  touchResource(id) {
    const resource = this.resources.get(id);
    if (resource) {
      resource.lastAccessed = Date.now();
    }
  }

  /**
   * Register a cleanup strategy for a resource type
   */
  registerCleanupStrategy(type, cleanupFn) {
    this.cleanupStrategies.set(type, cleanupFn);
  }

  /**
   * Start resource monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.memoryUsage.baseline = this.getCurrentMemoryUsage();

    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.cleanupInterval);

    // Start memory monitoring
    this.monitoringTimer = setInterval(() => {
      this.monitorMemoryUsage();
    }, this.monitoringInterval);

    if (this.logger) {
      this.logger.info('ResourceManager: Started monitoring');
    }

    this.emit('monitoringStarted');
  }

  /**
   * Stop resource monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    if (this.logger) {
      this.logger.info('ResourceManager: Stopped monitoring');
    }

    this.emit('monitoringStopped');
  }

  /**
   * Monitor current memory usage
   */
  monitorMemoryUsage() {
    const current = this.getCurrentMemoryUsage();
    this.memoryUsage.current = current;

    if (current > this.memoryUsage.peak) {
      this.memoryUsage.peak = current;
    }

    // Check if memory usage is too high
    const threshold = this.maxMemoryUsage * 0.8; // 80% threshold
    if (current > threshold) {
      if (this.logger) {
        this.logger.warn(`ResourceManager: High memory usage detected: ${(current / 1024 / 1024).toFixed(2)}MB`);
      }

      this.emit('highMemoryUsage', { 
        current: current,
        threshold: threshold,
        percentage: (current / this.maxMemoryUsage) * 100
      });

      // Trigger aggressive cleanup
      this.performCleanup(true);
    }

    this.emit('memoryUsageUpdated', this.getMemoryStats());
  }

  /**
   * Get current memory usage
   */
  getCurrentMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    
    // Fallback for browser environment
    if (typeof performance !== 'undefined' && performance.memory) {
      return performance.memory.usedJSHeapSize;
    }
    
    // Estimate based on registered resources
    return Array.from(this.resources.values())
      .reduce((total, resource) => total + resource.estimatedSize, 0);
  }

  /**
   * Update memory usage estimate
   */
  updateMemoryUsage() {
    this.memoryUsage.current = this.getCurrentMemoryUsage();
  }

  /**
   * Perform cleanup of registered resources
   */
  performCleanup(aggressive = false) {
    const cleanupResults = {
      resourcesCleaned: 0,
      memoryFreed: 0,
      itemsCleared: 0,
      errors: []
    };

    const sortedResources = this.getSortedResourcesForCleanup(aggressive);

    for (const resource of sortedResources) {
      try {
        const strategy = this.cleanupStrategies.get(resource.type);
        if (!strategy) continue;

        const result = strategy(resource);
        
        cleanupResults.resourcesCleaned++;
        cleanupResults.memoryFreed += result.memoryFreed || 0;
        cleanupResults.itemsCleared += result.itemsCleared || 0;

        // Update resource metadata
        resource.lastCleaned = Date.now();

        if (this.logger) {
          this.logger.debug(`ResourceManager: Cleaned resource ${resource.id}, freed ${result.memoryFreed} bytes`);
        }

      } catch (error) {
        cleanupResults.errors.push({
          resourceId: resource.id,
          error: error.message
        });

        if (this.logger) {
          this.logger.error(`ResourceManager: Error cleaning resource ${resource.id}:`, error);
        }
      }
    }

    // Update memory usage after cleanup
    this.updateMemoryUsage();

    if (this.logger && cleanupResults.resourcesCleaned > 0) {
      this.logger.info(`ResourceManager: Cleanup completed - ${cleanupResults.resourcesCleaned} resources, ${(cleanupResults.memoryFreed / 1024 / 1024).toFixed(2)}MB freed`);
    }

    this.emit('cleanupCompleted', cleanupResults);
    return cleanupResults;
  }

  /**
   * Get resources sorted by cleanup priority
   */
  getSortedResourcesForCleanup(aggressive = false) {
    const now = Date.now();
    const resources = Array.from(this.resources.values());

    return resources
      .filter(resource => {
        // Skip persistent resources unless aggressive cleanup
        if (resource.persistent && !aggressive) {
          return false;
        }
        
        // Skip recently accessed resources unless aggressive
        const timeSinceAccess = now - resource.lastAccessed;
        const threshold = aggressive ? 10000 : 60000; // 10s vs 60s
        
        return timeSinceAccess > threshold;
      })
      .sort((a, b) => {
        // Sort by priority (low priority cleaned first)
        const priorityOrder = { low: 0, normal: 1, high: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        
        if (priorityDiff !== 0) return priorityDiff;
        
        // Then by last accessed time (oldest first)
        return a.lastAccessed - b.lastAccessed;
      });
  }

  /**
   * Force garbage collection if available
   */
  forceGarbageCollection() {
    if (typeof global !== 'undefined' && global.gc) {
      const before = this.getCurrentMemoryUsage();
      global.gc();
      const after = this.getCurrentMemoryUsage();
      
      const freed = before - after;
      
      if (this.logger && freed > 0) {
        this.logger.info(`ResourceManager: Garbage collection freed ${(freed / 1024 / 1024).toFixed(2)}MB`);
      }
      
      this.updateMemoryUsage();
      return freed;
    }
    
    return 0;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats() {
    return {
      current: this.memoryUsage.current,
      peak: this.memoryUsage.peak,
      baseline: this.memoryUsage.baseline,
      limit: this.maxMemoryUsage,
      usage: {
        bytes: this.memoryUsage.current,
        megabytes: this.memoryUsage.current / 1024 / 1024,
        percentage: (this.memoryUsage.current / this.maxMemoryUsage) * 100
      },
      resources: {
        total: this.resources.size,
        byType: this.getResourcesByType()
      }
    };
  }

  /**
   * Get resource count by type
   */
  getResourcesByType() {
    const byType = {};
    
    for (const resource of this.resources.values()) {
      byType[resource.type] = (byType[resource.type] || 0) + 1;
    }
    
    return byType;
  }

  /**
   * Get detailed resource information
   */
  getResourceInfo() {
    return Array.from(this.resources.values()).map(resource => ({
      id: resource.id,
      type: resource.type,
      priority: resource.priority,
      persistent: resource.persistent,
      estimatedSize: resource.estimatedSize,
      registeredAt: new Date(resource.registeredAt).toISOString(),
      lastAccessed: new Date(resource.lastAccessed).toISOString(),
      lastCleaned: resource.lastCleaned ? new Date(resource.lastCleaned).toISOString() : null,
      metadata: resource.metadata
    }));
  }

  /**
   * Cleanup all resources and stop monitoring
   */
  shutdown() {
    this.stopMonitoring();
    
    // Perform final cleanup
    const results = this.performCleanup(true);
    
    // Clear all resources
    this.resources.clear();
    this.cleanupStrategies.clear();
    this.eventListeners.clear();
    
    // Force garbage collection if available  
    this.forceGarbageCollection();
    
    if (this.logger) {
      this.logger.info('ResourceManager: Shutdown completed');
    }
    
    return results;
  }

  // Event handling methods
  emit(eventName, data) {
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        if (this.logger) {
          this.logger.error('ResourceManager: Error in event listener', error);
        }
      }
    });
  }

  on(eventName, listener) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(listener);
  }

  off(eventName, listener) {
    const listeners = this.eventListeners.get(eventName) || [];
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }
}