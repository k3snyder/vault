import { invoke } from '@tauri-apps/api/core';

export class PluginSettingsPanel {
  constructor() {
    this.state = {
      plugins: [],
      loading: true,
      error: null,
      searchQuery: '',
      selectedPlugin: null,
      showSettingsModal: false,
      pluginSettings: {}
    };
    
    this.container = null;
    this.listenersAttached = false;
    this.boundClickHandler = this.handleContainerClick.bind(this);
    this.boundChangeHandler = this.handleContainerChange.bind(this);
    this.boundInputHandler = this.handleContainerInput.bind(this);
  }

  async mount(container) {
    console.log('PluginSettingsPanel mounting...');
    this.container = container;
    this.attachEventListeners();
    
    // Show loading immediately
    this.state.loading = true;
    this.render();
    
    // Load plugins
    await this.loadPlugins();
  }

  async loadPlugins() {
    try {
      this.state.loading = true;
      this.state.error = null;
      this.render();
      
      console.log('Loading plugins...');
      
      const pluginList = await invoke('plugin_list');
      console.log('Loaded plugins:', pluginList);
      this.state.plugins = pluginList || [];
    } catch (err) {
      console.error('Failed to load plugins:', err);
      this.state.error = err.message || 'Failed to load plugins';
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  attachEventListeners() {
    if (!this.container || this.listenersAttached) {
      return;
    }

    this.container.addEventListener('click', this.boundClickHandler);
    this.container.addEventListener('change', this.boundChangeHandler);
    this.container.addEventListener('input', this.boundInputHandler);
    this.listenersAttached = true;
  }

  handleContainerClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target || !this.container.contains(target)) {
      return;
    }

    switch (target.dataset.action) {
      case 'refresh-plugins':
        this.loadPlugins();
        break;
      case 'clear-error':
        this.state.error = null;
        this.render();
        break;
      case 'open-plugin-settings':
        this.handleOpenSettings(target.dataset.pluginId);
        break;
      case 'uninstall-plugin':
        this.handleUninstallPlugin(target.dataset.pluginId);
        break;
      case 'close-modal':
        if (target.classList.contains('modal-overlay') && event.target !== target) {
          return;
        }
        this.closeModal();
        break;
      case 'save-settings':
        this.handleSaveSettings();
        break;
    }
  }

  handleContainerChange(event) {
    const target = event.target;
    if (!target.matches('[data-action]')) {
      return;
    }

    switch (target.dataset.action) {
      case 'toggle-plugin':
        this.handleTogglePlugin(target.dataset.pluginId, target.checked);
        break;
      case 'update-plugin-setting':
        this.handlePluginSettingChange(
          target.dataset.setting,
          target.type === 'checkbox'
            ? target.checked
            : target.dataset.valueType === 'number'
              ? parseInt(target.value, 10)
              : target.value
        );
        break;
    }
  }

  handleContainerInput(event) {
    const target = event.target;
    if (!target.matches('[data-action]')) {
      return;
    }

    if (target.dataset.action === 'search-plugins') {
      this.handleSearchChange(target.value);
    }
  }

  handlePluginSettingChange(key, value) {
    this.state.pluginSettings[key] = value;
  }

  async handleTogglePlugin(pluginId, enabled) {
    try {
      if (enabled) {
        await invoke('plugin_enable', { plugin_id: pluginId });
      } else {
        await invoke('plugin_disable', { plugin_id: pluginId });
      }
      await this.loadPlugins();
    } catch (err) {
      this.state.error = err.message || 'Failed to toggle plugin';
      this.render();
    }
  }

  async handleOpenSettings(pluginOrId) {
    const plugin = typeof pluginOrId === 'string'
      ? this.state.plugins.find(item => item.id === pluginOrId)
      : pluginOrId;

    if (!plugin) {
      return;
    }

    try {
      const settings = await invoke('plugin_get_settings', {
        plugin_id: plugin.id
      });
      this.state.pluginSettings = settings;
      this.state.selectedPlugin = plugin;
      this.state.showSettingsModal = true;
      this.render();
    } catch (err) {
      this.state.error = err.message || 'Failed to load plugin settings';
      this.render();
    }
  }

  async handleSaveSettings() {
    try {
      await invoke('plugin_update_settings', {
        settings: {
          plugin_id: this.state.selectedPlugin.id,
          settings: this.state.pluginSettings
        }
      });
      this.state.showSettingsModal = false;
      this.render();
    } catch (err) {
      this.state.error = err.message || 'Failed to save plugin settings';
      this.render();
    }
  }

  async handleUninstallPlugin(pluginId) {
    if (!confirm('Are you sure you want to uninstall this plugin?')) {
      return;
    }
    
    try {
      await invoke('plugin_uninstall', {
        plugin_id: pluginId
      });
      await this.loadPlugins();
    } catch (err) {
      this.state.error = err.message || 'Failed to uninstall plugin';
      this.render();
    }
  }

  handleSearchChange(query) {
    this.state.searchQuery = query;
    this.render();
  }

  closeModal() {
    this.state.showSettingsModal = false;
    this.render();
  }

  getFilteredPlugins() {
    let filtered = this.state.plugins;
    
    // Apply search filter
    if (this.state.searchQuery) {
      const query = this.state.searchQuery.toLowerCase();
      filtered = filtered.filter(plugin =>
        plugin.name.toLowerCase().includes(query) ||
        plugin.description.toLowerCase().includes(query) ||
        plugin.author.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }

  render() {
    if (!this.container) return;
    
    // Make this instance available globally for event handlers
    window.pluginSettingsPanel = this;
    
    if (this.state.loading) {
      this.container.innerHTML = `
        <div class="plugin-settings-container">
          <div class="plugin-loading">
            <div class="spinner"></div>
            <p>Loading plugins...</p>
          </div>
        </div>
      `;
      return;
    }

    const filteredPlugins = this.getFilteredPlugins();
    const installedPlugins = this.state.plugins.filter(p => p.enabled);

    this.container.innerHTML = `
      <div class="plugin-settings-container">
        <!-- Readwise Plugin Setup -->
        ${filteredPlugins.some(p => p.id === 'readwise') ? `
          <div class="settings-section readwise-setup">
            <h2 class="section-title">📚 Readwise Plugin Setup</h2>
            <div class="setup-steps">
              <div class="setup-step">
                <span class="step-number">1</span>
                <div class="step-content">
                  <h3>Get your Readwise API Token</h3>
                  <p>Visit <a href="https://readwise.io/access_token" target="_blank">readwise.io/access_token</a> and copy your token</p>
                </div>
              </div>
              <div class="setup-step">
                <span class="step-number">2</span>
                <div class="step-content">
                  <h3>Enable the Plugin</h3>
                  <p>Toggle the switch below to activate Readwise integration</p>
                </div>
              </div>
              <div class="setup-step">
                <span class="step-number">3</span>
                <div class="step-content">
                  <h3>Configure Settings</h3>
                  <p>Click "Options" to add your API token and customize sync preferences</p>
                </div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Community Plugins Section -->
        <div class="settings-section">
          <div class="section-header">
            <h2 class="section-title">Community Plugins</h2>
            <button type="button" class="btn-refresh" data-action="refresh-plugins" title="Refresh plugin list">
              ↻ Refresh
            </button>
          </div>
          <p class="section-description">Extend your vault with additional functionality</p>
          
          <!-- Search Bar -->
          <div class="plugin-search">
            <input type="text" 
                   placeholder="Search plugins..." 
                   value="${this.state.searchQuery}"
                   data-action="search-plugins">
          </div>

          ${this.state.error ? `
            <div class="plugin-error">
              ${this.state.error}
              <button type="button" data-action="clear-error">×</button>
            </div>
          ` : ''}
        </div>

        <!-- Installed Plugins Section -->
        <div class="settings-section">
          <div class="section-header">
            <h2 class="section-title">Installed Plugins</h2>
            <span class="plugin-count">${installedPlugins.length} ${installedPlugins.length === 1 ? 'plugin' : 'plugins'}</span>
          </div>
          
          ${filteredPlugins.length > 0 ? `
            <div class="plugin-list">
              ${filteredPlugins.map(plugin => this.renderPluginItem(plugin)).join('')}
            </div>
          ` : `
            <div class="plugin-empty">
              <p>No plugins found</p>
              <p class="empty-hint">The Readwise plugin should appear here if it's in the plugins/ folder</p>
            </div>
          `}
        </div>

        <!-- How to Install Plugins -->
        <div class="settings-section">
          <h2 class="section-title">How to Install Plugins</h2>
          
          <div class="install-instructions">
            <div class="instruction-box">
              <h3>Manual Installation</h3>
              <ol>
                <li>Download the plugin folder</li>
                <li>Place it in the <code>plugins/</code> directory</li>
                <li>Restart the app or click Refresh</li>
                <li>Enable the plugin using the toggle switch</li>
              </ol>
            </div>
            
            <div class="instruction-box">
              <h3>Current Plugin Directory</h3>
              <code class="path-display">${window.location.pathname.split('/').slice(0, -2).join('/')}/plugins/</code>
            </div>
          </div>
        </div>

        ${this.renderModals()}
      </div>
    `;
  }

  renderPluginItem(plugin) {
    const isEnabled = plugin.enabled;
    
    return `
      <div class="plugin-item ${isEnabled ? 'enabled' : ''}">
        <div class="plugin-item-header">
          <div class="plugin-info">
            <h3 class="plugin-name">${plugin.name}</h3>
            <p class="plugin-author">by ${plugin.author} • v${plugin.version}</p>
            <p class="plugin-description">${plugin.description}</p>
          </div>
          <div class="plugin-toggle">
            <label class="switch">
              <input type="checkbox" 
                     ${isEnabled ? 'checked' : ''}
                     data-action="toggle-plugin"
                     data-plugin-id="${plugin.id}">
              <span class="slider"></span>
            </label>
          </div>
        </div>
        ${isEnabled ? `
          <div class="plugin-item-actions">
            <button type="button" class="btn-text" data-action="open-plugin-settings" data-plugin-id="${plugin.id}">
              Options
            </button>
            <button type="button" class="btn-text danger" data-action="uninstall-plugin" data-plugin-id="${plugin.id}">
              Uninstall
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderModals() {
    let modals = '';

    // Settings Modal
    if (this.state.showSettingsModal && this.state.selectedPlugin) {
      modals += `
        <div class="modal-overlay" data-action="close-modal">
          <div class="modal-content">
            <div class="modal-header">
              <h2>${this.state.selectedPlugin.name} Settings</h2>
              <button type="button" class="modal-close" data-action="close-modal">×</button>
            </div>
            <div class="modal-body">
              ${this.renderPluginSettingsForm()}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn-cancel" data-action="close-modal">Cancel</button>
              <button type="button" class="btn-save" data-action="save-settings">Save Settings</button>
            </div>
          </div>
        </div>
      `;
    }

    return modals;
  }

  renderPluginSettingsForm() {
    if (!this.state.selectedPlugin) return '';
    
    // Special handling for Readwise plugin
    if (this.state.selectedPlugin.id === 'readwise') {
      return `
        <div class="settings-form">
          <div class="form-group">
            <label>API Token:</label>
            <input type="password" 
                   value="${this.state.pluginSettings.apiToken || ''}"
                   data-action="update-plugin-setting"
                   data-setting="apiToken"
                   placeholder="Get from readwise.io/access_token">
            <p class="form-hint">Your Readwise API token for authentication</p>
          </div>
          
          <div class="form-group">
            <label>Sync Frequency:</label>
            <input type="number" 
                   value="${this.state.pluginSettings.syncFrequency || 60}"
                   data-action="update-plugin-setting"
                   data-setting="syncFrequency"
                   data-value-type="number"
                   min="5" max="1440">
            <p class="form-hint">Minutes between automatic syncs</p>
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" 
                     ${this.state.pluginSettings.autoSync ? 'checked' : ''}
                     data-action="update-plugin-setting"
                     data-setting="autoSync">
              Enable Auto Sync
            </label>
            <p class="form-hint">Automatically sync highlights at the specified interval</p>
          </div>
          
          <div class="form-group">
            <label>Highlights Folder:</label>
            <input type="text" 
                   value="${this.state.pluginSettings.highlightsFolder || 'Readwise'}"
                   data-action="update-plugin-setting"
                   data-setting="highlightsFolder">
            <p class="form-hint">Folder where highlights will be saved</p>
          </div>
        </div>
      `;
    }
    
    return '<p class="no-settings">No settings available for this plugin.</p>';
  }
}

// Export singleton instance
export default new PluginSettingsPanel();
