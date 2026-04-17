import { PluginContext } from './PluginContext.js';
import { viewLoader } from './utils/lazyLoader.js';
import { icons } from '../icons/icon-utils.js';
import './PluginHub.css';
import './components/PluginCard.css';
import './components/LoadingStates.css';
import './components/Toast.css';
import './components/Modal.css';
import './views/views.css';

/**
 * Plugin Hub - Main container for plugin management interface
 */
export class PluginHub {
  constructor() {
    this.container = null;
    this.context = new PluginContext();
    this.currentView = 'installed'; // Start with installed view which is simpler
    this.searchQuery = '';
    this.keyboardHandlers = {};
    this.isOpen = false;
    
    // Initialize error boundary (lazy loaded)
    this.errorBoundary = null;
    
    // Views will be lazy loaded
    this.views = {};
    this.viewClasses = {};
    
    this.currentViewInstance = null;
    
    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.switchView = this.switchView.bind(this);
    this.handleSearch = this.handleSearch.bind(this);
    this.close = this.close.bind(this);
    
    // Initialize lazy loading
    this.initializeLazyLoading();
  }
  
  /**
   * Initialize lazy loading and error boundary
   */
  async initializeLazyLoading() {
    // Preload common views for better performance
    viewLoader.preloadCommonViews().catch(console.error);
    
    // Lazy load error boundary
    try {
      const { PluginErrorBoundary } = await import('./utils/errorBoundary.js');
      this.errorBoundary = new PluginErrorBoundary(this);
      
      // Wrap methods with error handling
      this.handleKeyDown = this.errorBoundary.wrap(this.handleKeyDown);
      this.switchView = this.errorBoundary.wrap(this.switchView);
      this.handleSearch = this.errorBoundary.wrap(this.handleSearch);
      this.close = this.errorBoundary.wrap(this.close);
    } catch (error) {
      console.error('Failed to load error boundary:', error);
    }
  }

  /**
   * Initialize and open the Plugin Hub
   */
  async open() {
    if (this.isOpen) return;
    
    this.isOpen = true;
    
    // Create container
    this.createContainer();
    
    // Show the container immediately with high visibility
    this.container.style.display = 'block';
    this.container.style.visibility = 'visible';
    this.container.style.opacity = '1';
    
    // Set up keyboard navigation
    this.setupKeyboardNavigation();
    
    // Initialize context with backend connection
    try {
      await this.context.initialize();
    } catch (error) {
      console.error('Failed to initialize context:', error);
    }
    
    // Subscribe to context changes
    this.unsubscribe = this.context.subscribe(() => {
      this.updateCurrentView();
    });
    
    // Render the UI
    try {
      this.render();
    } catch (error) {
      console.error('Failed to render Plugin Hub:', error);
      // Show error UI
      this.container.innerHTML = `
        <div class="plugin-hub-container">
          <div class="plugin-hub-header">
            <h1>Plugin Hub</h1>
            <button class="close-button" data-action="close-plugin-hub" type="button">×</button>
          </div>
          <div class="plugin-hub-content">
            <div class="error-message">Failed to load Plugin Hub. Please check console for errors.</div>
          </div>
        </div>
      `;
      this.attachEventListeners();
    }
    
    console.log('Plugin Hub opened successfully');
    console.log('Container element:', this.container);
    console.log('Container display:', this.container.style.display);
    console.log('Container visibility:', this.container.style.visibility);
    console.log('Container in DOM:', document.body.contains(this.container));
    
    // Add global test function for debugging settings_schema
    window.testPluginSchema = async () => {
      const plugins = await this.context.api.listInstalledPlugins();
      console.log('=== PLUGIN DATA TEST ===');
      plugins.forEach(plugin => {
        console.log(`\nPlugin: ${plugin.name} (${plugin.id})`);
        console.log('  settings:', plugin.settings);
        console.log('  settings_schema:', plugin.settings_schema);
      });
      return plugins;
    };
  }

  /**
   * Close the Plugin Hub
   */
  close() {
    if (!this.isOpen) return;
    
    this.isOpen = false;
    
    // Remove keyboard listeners
    document.removeEventListener('keydown', this.handleKeyDown);
    
    // Unsubscribe from context
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    
    // Destroy current view
    if (this.currentViewInstance && this.currentViewInstance.destroy) {
      this.currentViewInstance.destroy();
    }
    
    // Cleanup context
    this.context.destroy();
    
    // Hide and remove container
    if (this.container) {
      this.container.style.display = 'none';
      this.container.remove();
      this.container = null;
    }
    
    console.log('Plugin Hub closed');
  }

  /**
   * Create the container element
   */
  createContainer() {
    // Remove existing container if present
    const existing = document.getElementById('plugin-hub-container');
    if (existing) {
      existing.remove();
    }
    
    // Create new container
    this.container = document.createElement('div');
    this.container.id = 'plugin-hub-container';
    this.container.className = 'plugin-hub-overlay';
    this.container.style.display = 'none'; // Start hidden
    this.container.style.zIndex = '999999'; // Ensure high z-index inline
    
    // Add to document
    document.body.appendChild(this.container);
    
    console.log('Plugin Hub container created and added to DOM');
  }

  /**
   * Set up keyboard navigation
   */
  setupKeyboardNavigation() {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Handle keyboard events
   */
  handleKeyDown(e) {
    // Don't handle if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        this.close();
        e.preventDefault();
      }
      return;
    }
    
    // Number keys for view switching (without modifiers)
    if (e.key >= '1' && e.key <= '2' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const views = ['discover', 'installed'];
      const index = parseInt(e.key) - 1;
      if (views[index]) {
        e.preventDefault();
        this.switchView(views[index]);
        this.announceViewChange(views[index]);
      }
      return;
    }
    
    // Cmd+K or Ctrl+K for search focus
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.focusSearch();
      return;
    }
    
    // Forward slash for search (when not in input)
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.focusSearch();
      return;
    }
    
    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
  }

  /**
   * Switch to a different view
   */
  switchView(view) {
    this.currentView = view;
    this.context.setCurrentView(view);
    this.render();
    this.announceViewChange(view);
  }

  /**
   * Announce view change for accessibility
   */
  announceViewChange(view) {
    const announcement = document.getElementById('plugin-hub-announcement');
    if (announcement) {
      announcement.textContent = `Switched to ${view} view`;
      setTimeout(() => {
        announcement.textContent = '';
      }, 1000);
    }
  }

  /**
   * Focus the search input
   */
  focusSearch() {
    const searchInput = this.container.querySelector('.plugin-search-input');
    if (searchInput) {
      searchInput.focus();
    }
  }

  /**
   * Handle search input
   */
  handleSearch(query) {
    this.searchQuery = query;
    this.context.setSearchQuery(query);
    this.updateCurrentView();
  }

  /**
   * Render the entire Plugin Hub
   */
  render() {
    try {
      this.container.innerHTML = `
        <div class="plugin-hub-modal">
          <!-- Screen reader announcements -->
          <div id="plugin-hub-announcement" role="status" aria-live="polite" aria-atomic="true" class="sr-only"></div>

          <!-- Close button (positioned absolutely in top-right) -->
          <button class="plugin-hub-close" aria-label="Close Plugin Hub">×</button>

          <!-- Header -->
          <header class="plugin-hub-header">
            <h1 class="plugin-hub-title">Plugin Hub</h1>
            <div class="plugin-search-container">
              <input
                type="search"
                class="plugin-search-input"
                placeholder="Search plugins..."
                value="${this.searchQuery}"
                aria-label="Search plugins"
              />
            </div>
          </header>
          
          <!-- Main Layout -->
          <div class="plugin-hub-layout">
            <!-- Navigation Sidebar -->
            <nav class="plugin-nav-sidebar" role="navigation" aria-label="Plugin views">
              ${this.renderNavigation()}
            </nav>
            
            <!-- Content Area -->
            <main class="plugin-hub-content" role="main" aria-label="Plugin content">
              <!-- View content will be rendered here -->
            </main>
          </div>
        </div>
      `;
      
      // Add event listeners
      this.attachEventListeners();
      
      // Render the current view (don't await to prevent blocking)
      this.renderCurrentView().catch(error => {
        console.error('Failed to render initial view:', error);
      });
    } catch (error) {
      console.error('Failed to render Plugin Hub:', error);
      // Show minimal UI even if render fails
      this.container.innerHTML = `
      <div class="plugin-hub-modal">
          <header class="plugin-hub-header">
            <h1 class="plugin-hub-title">Plugin Hub</h1>
            <button class="plugin-hub-close" data-action="close-plugin-hub" type="button">×</button>
          </header>
          <div class="plugin-hub-content">
            <div class="error-message">Failed to load Plugin Hub interface</div>
          </div>
        </div>
      `;
    }
  }

  /**
   * Render navigation sidebar
   */
  renderNavigation() {
    const views = [
      { id: 'discover', label: 'Discover', icon: icons.search({ size: 16 }), hotkey: '1' },
      { id: 'installed', label: 'Installed', icon: icons.package({ size: 16 }), hotkey: '2' }
    ];
    
    return views.map(view => `
      <button 
        class="plugin-nav-item ${this.currentView === view.id ? 'active' : ''}" 
        data-view="${view.id}"
        role="tab"
        aria-selected="${this.currentView === view.id ? 'true' : 'false'}"
        aria-controls="plugin-content"
        aria-current="${this.currentView === view.id ? 'page' : 'false'}"
        title="${view.label} (${view.hotkey})"
      >
        <span class="nav-icon">${view.icon}</span>
        <span class="nav-label">${view.label}</span>
        <span class="nav-hotkey">${view.hotkey}</span>
      </button>
    `).join('');
  }

  /**
   * Render the current view content
   */
  async renderCurrentView() {
    const content = this.container?.querySelector('.plugin-hub-content');
    if (!content) return '';
    
    // Destroy previous view if it exists
    if (this.currentViewInstance && this.currentViewInstance.destroy) {
      this.currentViewInstance.destroy();
    }
    
    // Show loading state
    content.innerHTML = '<div class="loading-indicator">Loading view...</div>';
    
    try {
      // Lazy load view if not already loaded
      if (!this.views[this.currentView]) {
        const viewName = this.getViewClassName(this.currentView);
        const ViewClass = await this.loadView(viewName);
        this.viewClasses[this.currentView] = ViewClass;
        this.views[this.currentView] = new ViewClass(this.context);
      }
      
      // Get the view instance
      this.currentViewInstance = this.views[this.currentView];
      
      if (this.currentViewInstance) {
        // Clear content and append view element
        content.innerHTML = '';
        const viewElement = this.currentViewInstance.render();
        content.appendChild(viewElement);
      }
    } catch (error) {
      console.error('Failed to render view:', error);
      content.innerHTML = '<div class="error-message">Failed to load view</div>';
    }
    
    return '';
  }
  
  /**
   * Get view class name from view id
   */
  getViewClassName(viewId) {
    const viewMap = {
      'discover': 'DiscoverView',
      'installed': 'InstalledView'
    };
    return viewMap[viewId] || 'InstalledView';
  }
  
  /**
   * Lazy load a view
   */
  async loadView(viewName) {
    try {
      let module;
      switch(viewName) {
        case 'DiscoverView':
          module = await import('./views/DiscoverView.js');
          break;
        case 'InstalledView':
          module = await import('./views/InstalledView.js');
          break;
        default:
          module = await import('./views/InstalledView.js');
      }
      return module.default || module;
    } catch (error) {
      console.error(`Failed to load view ${viewName}:`, error);
      throw error;
    }
  }
  
  /**
   * Update the current view without re-rendering the entire hub
   */
  updateCurrentView() {
    if (this.currentViewInstance && this.currentViewInstance.update) {
      this.currentViewInstance.update();
    }
  }

  /**
   * Attach event listeners to rendered elements
   */
  attachEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.plugin-hub-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', this.close);
    }

    const fallbackCloseBtn = this.container.querySelector('[data-action="close-plugin-hub"]');
    if (fallbackCloseBtn) {
      fallbackCloseBtn.addEventListener('click', this.close);
    }
    
    // Navigation buttons
    const navButtons = this.container.querySelectorAll('.plugin-nav-item');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        this.switchView(view);
      });
    });
    
    // Search input
    const searchInput = this.container.querySelector('.plugin-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleSearch(e.target.value);
      });
    }
  }

  /**
   * Handle plugin enable/disable toggle
   */
  async handlePluginToggle(pluginId, enabled) {
    try {
      if (enabled) {
        await this.context.enablePlugin(pluginId);
      } else {
        await this.context.disablePlugin(pluginId);
      }
    } catch (error) {
      console.error('Failed to toggle plugin:', error);
      // Revert the toggle
      this.updateCurrentView();
    }
  }

  /**
   * Handle plugin settings
   */
  handlePluginSettings(pluginId) {
    const plugin = this.context.state.installedPlugins.find(p => p.id === pluginId);
    if (plugin) {
      this.context.openPluginSettings(plugin);
    }
  }

  /**
   * Handle plugin uninstall
   */
  async handlePluginUninstall(pluginId) {
    const plugin = this.context.state.installedPlugins.find(p => p.id === pluginId);
    if (!plugin) return;
    
    const confirmed = await this.context.confirm(
      'Uninstall Plugin',
      `Are you sure you want to uninstall ${plugin.name}?`,
      { confirmLabel: 'Uninstall', cancelLabel: 'Cancel' }
    );
    
    if (confirmed) {
      try {
        await this.context.uninstallPlugin(pluginId);
      } catch (error) {
        console.error('Failed to uninstall plugin:', error);
      }
    }
  }
}

// Create singleton instance
const pluginHub = new PluginHub();

// Export for global access
window.PluginHub = PluginHub;
window.pluginHub = pluginHub;

// Default export for main.js
export default pluginHub;
