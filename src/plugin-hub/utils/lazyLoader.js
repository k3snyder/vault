/**
 * Lazy Loading Utility
 * Provides dynamic import and code splitting functionality
 */

class LazyLoader {
  constructor() {
    this.cache = new Map();
    this.loading = new Map();
  }
  
  /**
   * Load a module dynamically
   * @param {string} path - Module path
   * @returns {Promise} - Module promise
   */
  async loadModule(path) {
    // Check cache first
    if (this.cache.has(path)) {
      return this.cache.get(path);
    }
    
    // Check if already loading
    if (this.loading.has(path)) {
      return this.loading.get(path);
    }
    
    // Start loading
    const loadPromise = this.performLoad(path);
    this.loading.set(path, loadPromise);
    
    try {
      const module = await loadPromise;
      this.cache.set(path, module);
      this.loading.delete(path);
      return module;
    } catch (error) {
      this.loading.delete(path);
      throw error;
    }
  }
  
  /**
   * Perform the actual dynamic import
   */
  async performLoad(path) {
    try {
      // Use dynamic import
      const module = await import(/* @vite-ignore */ path);
      return module.default || module;
    } catch (error) {
      console.error(`Failed to load module: ${path}`, error);
      throw error;
    }
  }
  
  /**
   * Preload multiple modules
   */
  async preloadModules(paths) {
    const promises = paths.map(path => this.loadModule(path));
    return Promise.all(promises);
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
  
  /**
   * Get cache size
   */
  getCacheSize() {
    return this.cache.size;
  }
}

/**
 * View Loader - Specialized loader for plugin hub views
 */
export class ViewLoader extends LazyLoader {
  constructor() {
    super();
    this.viewBasePath = './views/';
  }
  
  /**
   * Load a view dynamically
   */
  async loadView(viewName) {
    const path = `${this.viewBasePath}${viewName}.js`;
    
    try {
      console.log(`Loading view: ${viewName}`);
      const ViewClass = await this.loadModule(path);
      return ViewClass;
    } catch (error) {
      console.error(`Failed to load view: ${viewName}`, error);
      // Return a fallback view
      return this.getFallbackView(viewName);
    }
  }
  
  /**
   * Get fallback view for errors
   */
  getFallbackView(viewName) {
    return class FallbackView {
      constructor(context) {
        this.context = context;
        this.element = null;
      }
      
      render() {
        const div = document.createElement('div');
        div.className = 'plugin-view error-view';
        div.innerHTML = `
          <div class="error-message">
            <h2>Failed to load ${viewName} view</h2>
            <p>Please try refreshing the page or contact support if the problem persists.</p>
          </div>
        `;
        this.element = div;
        return div;
      }
      
      update() {
        // No-op for fallback
      }
      
      destroy() {
        if (this.element) {
          this.element.remove();
          this.element = null;
        }
      }
    };
  }
  
  /**
   * Preload common views
   */
  async preloadCommonViews() {
    const commonViews = ['InstalledView', 'DiscoverView'];
    const paths = commonViews.map(view => `${this.viewBasePath}${view}.js`);
    return this.preloadModules(paths);
  }
}

/**
 * Component Loader - For lazy loading components
 */
export class ComponentLoader extends LazyLoader {
  constructor() {
    super();
    this.componentBasePath = '../components/';
  }
  
  /**
   * Load a component dynamically
   */
  async loadComponent(componentName) {
    const path = `${this.componentBasePath}${componentName}.js`;
    
    try {
      console.log(`Loading component: ${componentName}`);
      return await this.loadModule(path);
    } catch (error) {
      console.error(`Failed to load component: ${componentName}`, error);
      throw error;
    }
  }
  
  /**
   * Load multiple components
   */
  async loadComponents(componentNames) {
    const promises = componentNames.map(name => this.loadComponent(name));
    return Promise.all(promises);
  }
}

/**
 * Utility Loader - For lazy loading utilities
 */
export class UtilityLoader extends LazyLoader {
  constructor() {
    super();
    this.utilityBasePath = '../utils/';
  }
  
  /**
   * Load a utility dynamically
   */
  async loadUtility(utilityName) {
    const path = `${this.utilityBasePath}${utilityName}.js`;
    
    try {
      console.log(`Loading utility: ${utilityName}`);
      return await this.loadModule(path);
    } catch (error) {
      console.error(`Failed to load utility: ${utilityName}`, error);
      throw error;
    }
  }
  
  /**
   * Load heavy utilities on demand
   */
  async loadHeavyUtilities() {
    // Only load these when needed
    const heavyUtils = ['errorBoundary', 'accessibility'];
    return this.loadComponents(heavyUtils);
  }
}

// Export singleton instances
export const viewLoader = new ViewLoader();
export const componentLoader = new ComponentLoader();
export const utilityLoader = new UtilityLoader();

// Default export
export default {
  viewLoader,
  componentLoader,
  utilityLoader,
  LazyLoader,
  ViewLoader,
  ComponentLoader,
  UtilityLoader
};