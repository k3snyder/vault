import { PluginContext } from './PluginContext.js';
import InstalledView from './views/InstalledView.js';
import DiscoverView from './views/DiscoverView.js';
import PermissionsView from './views/PermissionsView.js';
import ResourcesView from './views/ResourcesView.js';
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
    this.currentView = 'installed';
    this.searchQuery = '';
    this.keyboardHandlers = {};
    this.isOpen = false;
    
    // Initialize views
    this.views = {
      discover: new DiscoverView(this.context),
      installed: new InstalledView(this.context),
      permissions: new PermissionsView(this.context),
      resources: new ResourcesView(this.context)
    };
    
    this.currentViewInstance = null;
    
    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.switchView = this.switchView.bind(this);
    this.handleSearch = this.handleSearch.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Initialize and open the Plugin Hub
   */
  async open() {
    if (this.isOpen) return;
    
    this.isOpen = true;
    
    // Create container
    this.createContainer();
    
    // Set up keyboard navigation
    this.setupKeyboardNavigation();
    
    // Initialize context with backend connection
    await this.context.initialize();
    
    // Subscribe to context changes
    this.unsubscribe = this.context.subscribe(() => {
      this.updateCurrentView();
    });
    
    // Render the UI
    this.render();
    
    // Show the container
    this.container.style.display = 'block';
    
    console.log('Plugin Hub opened');
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
    
    // Add to document
    document.body.appendChild(this.container);
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
    // Ignore if input is focused
    const activeElement = document.activeElement;
    if (activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.contentEditable === 'true'
    )) {
      // Special case: Escape in search clears it
      if (e.key === 'Escape' && activeElement.classList.contains('plugin-search-input')) {
        activeElement.value = '';
        this.handleSearch('');
        e.preventDefault();
        return;
      }
      return;
    }
    
    // Handle shortcuts
    switch(e.key) {
      case '1':
        this.switchView('discover');
        e.preventDefault();
        break;
      case '2':
        this.switchView('installed');
        e.preventDefault();
        break;
      case '3':
        this.switchView('permissions');
        e.preventDefault();
        break;
      case '4':
        this.switchView('resources');
        e.preventDefault();
        break;
      case '/':
        this.focusSearch();
        e.preventDefault();
        break;
      case 'Escape':
        this.close();
        e.preventDefault();
        break;
    }
  }

  /**
   * Switch to a different view
   */
  switchView(view) {
    this.currentView = view;
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
    this.renderCurrentView();
  }

  /**
   * Render the entire Plugin Hub
   */
  render() {
    this.container.innerHTML = `
      <div class="plugin-hub-modal">
        <!-- Screen reader announcements -->
        <div id="plugin-hub-announcement" role="status" aria-live="polite" aria-atomic="true" class="sr-only"></div>
        
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
          <button class="plugin-hub-close" aria-label="Close Plugin Hub">×</button>
        </header>
        
        <!-- Main Layout -->
        <div class="plugin-hub-layout">
          <!-- Navigation Sidebar -->
          <nav class="plugin-nav-sidebar" role="navigation" aria-label="Plugin views">
            ${this.renderNavigation()}
          </nav>
          
          <!-- Content Area -->
          <main class="plugin-hub-content" role="main" aria-label="Plugin content">
            ${this.renderCurrentView()}
          </main>
        </div>
        
        <!-- Footer with keyboard hints -->
        <footer class="plugin-hub-footer">
          <span>Press <kbd>1-4</kbd> to switch views</span>
          <span><kbd>/</kbd> to search</span>
          <span><kbd>Esc</kbd> to close</span>
        </footer>
      </div>
    `;
    
    // Add event listeners
    this.attachEventListeners();
  }

  /**
   * Render navigation sidebar
   */
  renderNavigation() {
    const views = [
      { id: 'discover', label: 'Discover', icon: '🔍', hotkey: '1' },
      { id: 'installed', label: 'Installed', icon: '📦', hotkey: '2' },
      { id: 'permissions', label: 'Permissions', icon: '🔒', hotkey: '3' },
      { id: 'resources', label: 'Resources', icon: '📊', hotkey: '4' }
    ];
    
    return views.map(view => `
      <button 
        class="plugin-nav-item ${this.currentView === view.id ? 'active' : ''}"
        data-view="${view.id}"
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
  renderCurrentView() {
    const content = this.container?.querySelector('.plugin-hub-content');
    if (!content) return '';
    
    // Destroy previous view if it exists
    if (this.currentViewInstance && this.currentViewInstance.destroy) {
      this.currentViewInstance.destroy();
    }
    
    // Get the view instance
    this.currentViewInstance = this.views[this.currentView];
    
    if (this.currentViewInstance) {
      // Clear content and append view element
      content.innerHTML = '';
      const viewElement = this.currentViewInstance.render();
      content.appendChild(viewElement);
    } else {
      content.innerHTML = '<div class="error-message">View not found</div>';
    }
    
    return '';
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
    return `
      <div class="plugin-view" data-testid="discover-view">
        <h2>Discover Plugins</h2>
        <p>Browse and install new plugins to extend Vault's functionality.</p>
        <div class="plugin-grid">
          <p class="placeholder-message">Plugin marketplace coming soon...</p>
        </div>
      </div>
    `;
  }

  /**
   * Render Installed view
   */
  renderInstalledView() {
    const { state } = this.context;
    
    if (state.loading) {
      return `
        <div class="plugin-view" data-testid="installed-view">
          <div class="loading-indicator" data-testid="loading-indicator">Loading plugins...</div>
        </div>
      `;
    }
    
    if (state.error) {
      return `
        <div class="plugin-view" data-testid="installed-view">
          <div class="error-message">Error: ${state.error}</div>
        </div>
      `;
    }
    
    const filteredPlugins = this.context.getFilteredPlugins();
    
    if (filteredPlugins.length === 0) {
      return `
        <div class="plugin-view" data-testid="installed-view">
          <h2>Installed Plugins</h2>
          <p class="empty-message">
            ${state.searchQuery ? 'No plugins found matching your search.' : 'No plugins installed yet.'}
          </p>
        </div>
      `;
    }
    
    return `
      <div class="plugin-view" data-testid="installed-view">
        <h2>Installed Plugins</h2>
        <div class="plugin-list">
          ${filteredPlugins.map(plugin => this.renderPluginCard(plugin)).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Render a plugin card
   */
  renderPluginCard(plugin) {
    return `
      <div class="plugin-card" data-plugin-id="${plugin.id}">
        <div class="plugin-card-header">
          <h3>${plugin.name}</h3>
          <label class="plugin-toggle">
            <input 
              type="checkbox" 
              ${plugin.enabled ? 'checked' : ''}
              data-plugin-id="${plugin.id}"
              class="plugin-enable-toggle"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <p class="plugin-description">${plugin.description || 'No description available'}</p>
        <div class="plugin-meta">
          <span class="plugin-version">v${plugin.version || '1.0.0'}</span>
          <span class="plugin-author">by ${plugin.author || 'Unknown'}</span>
        </div>
        <div class="plugin-actions">
          <button class="plugin-settings-btn" data-plugin-id="${plugin.id}">Settings</button>
          <button class="plugin-uninstall-btn" data-plugin-id="${plugin.id}">Uninstall</button>
        </div>
      </div>
    `;
  }

  /**
   * Render Permissions view
   */
  renderPermissionsView() {
    const { state } = this.context;
    
    return `
      <div class="plugin-view" data-testid="permissions-view">
        <h2>Plugin Permissions</h2>
        <p>Manage permissions and access controls for your installed plugins.</p>
        <div class="permissions-matrix">
          ${this.renderPermissionsMatrix()}
        </div>
      </div>
    `;
  }

  /**
   * Render permissions matrix
   */
  renderPermissionsMatrix() {
    const { state } = this.context;
    
    if (Object.keys(state.permissions).length === 0) {
      return '<p class="empty-message">No plugin permissions configured.</p>';
    }
    
    // TODO: Implement permissions matrix
    return '<p class="placeholder-message">Permissions matrix coming soon...</p>';
  }

  /**
   * Render Resources view
   */
  renderResourcesView() {
    const { state } = this.context;
    
    return `
      <div class="plugin-view" data-testid="resources-view">
        <h2>Resource Usage</h2>
        <p>Monitor plugin resource consumption and performance.</p>
        <div class="resource-monitors">
          ${this.renderResourceMonitors()}
        </div>
      </div>
    `;
  }

  /**
   * Render resource monitors
   */
  renderResourceMonitors() {
    const { state } = this.context;
    
    if (Object.keys(state.resources).length === 0) {
      return '<p class="empty-message">No resource data available.</p>';
    }
    
    // TODO: Implement resource monitors
    return '<p class="placeholder-message">Resource monitoring coming soon...</p>';
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
    
    // Plugin toggles
    const toggles = this.container.querySelectorAll('.plugin-enable-toggle');
    toggles.forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const pluginId = e.target.dataset.pluginId;
        const enabled = e.target.checked;
        await this.handlePluginToggle(pluginId, enabled);
      });
    });
    
    // Settings buttons
    const settingsButtons = this.container.querySelectorAll('.plugin-settings-btn');
    settingsButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pluginId = e.target.dataset.pluginId;
        this.openPluginSettings(pluginId);
      });
    });
    
    // Uninstall buttons
    const uninstallButtons = this.container.querySelectorAll('.plugin-uninstall-btn');
    uninstallButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pluginId = e.target.dataset.pluginId;
        await this.handlePluginUninstall(pluginId);
      });
    });
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
      this.renderCurrentView();
    } catch (error) {
      console.error('Failed to toggle plugin:', error);
      // TODO: Show error toast
    }
  }

  /**
   * Open plugin settings
   */
  openPluginSettings(pluginId) {
    console.log('Opening settings for plugin:', pluginId);
    // TODO: Implement settings modal
  }

  /**
   * Handle plugin uninstall
   */
  async handlePluginUninstall(pluginId) {
    if (!confirm('Are you sure you want to uninstall this plugin?')) {
      return;
    }
    
    try {
      await this.context.uninstallPlugin(pluginId);
      this.renderCurrentView();
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      // TODO: Show error toast
    }
  }
}

// Create singleton instance
const pluginHub = new PluginHub();

// Export for use in main app
export default pluginHub;