import { invoke } from '@tauri-apps/api/core';
import pluginAPI from './api/pluginApi.js';
import toastManager from './components/Toast.js';
import { Modal, PermissionDialog, PluginSettingsModal } from './components/Modal.js';
import { fuzzySearchPlugins } from './utils/fuzzySearch.js';
import EntitlementManager from '../services/entitlement-manager.js';

/**
 * Bundled/Native plugins that are built into the app
 * These cannot be uninstalled and have special handling
 */
const BUNDLED_PLUGINS = {
  'pacasdb': {
    id: 'pacasdb',
    name: 'PACASDB',
    version: '1.0.0',
    author: 'Vault Team',
    description: 'Semantic search and cognitive memory for your vault. Enables AI-powered note discovery, related notes, and intelligent context tracking.',
    enabled: false,
    installed: true,
    permissions: ['vault:read', 'vault:write', 'network:request'],
    settings: [],
    status: 'inactive',
    icon: null,
    homepage: null,
    category: 'Premium',
    tags: ['semantic-search', 'ai', 'premium', 'cognitive-memory'],
    isBundled: true,
    requiresLicense: false,
    comingSoon: true,
  },
  'csv-support': {
    id: 'csv-support',
    name: 'CSV Editor Pro',
    version: '1.0.0',
    author: 'Vault Team',
    description: 'View and edit CSV files with a powerful tabular interface. Includes editing, row/column operations, schema inference, AI context generation, and unlimited rows.',
    enabled: true,
    installed: true,
    permissions: ['vault:read', 'vault:write'],
    settings: [],
    status: 'active',
    icon: null,
    homepage: null,
    category: 'Data',
    tags: ['csv', 'spreadsheet', 'data', 'editor'],
    isBundled: true,
    requiresLicense: false,
  }
};

/**
 * Plugin Context - Manages plugin state and operations
 */
export class PluginContext {
  constructor() {
    this.state = {
      installedPlugins: [],
      availablePlugins: [],
      permissions: {},
      resources: {},
      loading: true,
      error: null,
      searchQuery: '',
      currentView: 'installed',
      systemStatus: null,
      categories: []
    };

    this.listeners = [];
    this.toastManager = toastManager;
    this.api = pluginAPI;
    this.eventHandlers = null;
    this.isInitialized = false;
    this.entitlementManager = null;
  }

  /**
   * Get the entitlement manager, initializing if needed
   */
  async getEntitlementManager() {
    if (!this.entitlementManager) {
      this.entitlementManager = new EntitlementManager();
      await this.entitlementManager.initialize();
    }
    return this.entitlementManager;
  }

  /**
   * Check if user has premium access
   */
  async isPremiumEnabled() {
    const manager = await this.getEntitlementManager();
    return manager.isPremiumEnabled();
  }

  /**
   * Get bundled plugins with current enabled state from storage
   */
  async getBundledPlugins() {
    const bundledPlugins = [];

    for (const [id, plugin] of Object.entries(BUNDLED_PLUGINS)) {
      // Clone the plugin definition
      const pluginData = { ...plugin };

      // Load enabled state from localStorage (bundled plugins use localStorage)
      try {
        const key = `bundled_plugin_${id}`;
        const savedSettings = JSON.parse(localStorage.getItem(key) || '{}');
        if (savedSettings.enabled !== undefined) {
          pluginData.enabled = savedSettings.enabled;
          pluginData.status = savedSettings.enabled ? 'active' : 'inactive';
        }
      } catch (e) {
        // Settings not saved yet, use defaults
      }

      // For license-required plugins, check if license is active
      if (plugin.requiresLicense) {
        const isPremium = await this.isPremiumEnabled();
        // If enabled but no license, disable it
        if (pluginData.enabled && !isPremium) {
          pluginData.enabled = false;
          pluginData.status = 'inactive';
        }
      }

      bundledPlugins.push(pluginData);
    }

    return bundledPlugins;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify listeners of state changes
   */
  notify() {
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Update state and notify listeners
   */
  setState(updates) {
    this.state = { ...this.state, ...updates };
    this.notify();
  }

  /**
   * Initialize the context with backend data and event subscriptions
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      // Set up event handlers
      this.setupEventHandlers();
      
      // Subscribe to events
      await this.api.subscribeToEvents(this.eventHandlers);

      // Note: Resource monitoring is handled by ResourcesView when active
      // to avoid unnecessary re-renders on other views

      // Load initial data
      await this.loadAllData();
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize plugin context:', error);
      this.setState({ error: error.message });
    }
  }

  /**
   * Set up event handlers for backend events
   */
  setupEventHandlers() {
    this.eventHandlers = {
      'plugin-installed': (payload) => {
        this.loadInstalledPlugins();
        this.showToast(`${payload.name} installed successfully`, 'success');
      },
      'plugin-uninstalled': (payload) => {
        this.loadInstalledPlugins();
        this.showToast(`${payload.name} uninstalled`, 'info');
      },
      'plugin-enabled': (payload) => {
        this.updatePluginState(payload.id, { enabled: true });
        this.showToast(`${payload.name} enabled`, 'success');
      },
      'plugin-disabled': (payload) => {
        this.updatePluginState(payload.id, { enabled: false });
        this.showToast(`${payload.name} disabled`, 'info');
      },
      'plugin-error': (payload) => {
        this.showToast(`Plugin error: ${payload.message}`, 'error');
      },
      'plugin-update-available': (payload) => {
        this.updatePluginState(payload.id, { hasUpdate: true });
        this.showToast(`Update available for ${payload.name}`, 'info');
      },
      'plugin-resource-threshold': (payload) => {
        this.showToast(
          `${payload.name} is using high ${payload.resource}`,
          'warning'
        );
      },
      'plugin-permission-requested': async (payload) => {
        const granted = await this.requestPermissions(
          payload.plugin,
          payload.permissions
        );
        if (!granted) {
          this.showToast('Permission request denied', 'warning');
        }
      }
    };
  }

  /**
   * Update a plugin's state
   */
  updatePluginState(pluginId, updates) {
    const plugins = this.state.installedPlugins.map(plugin => 
      plugin.id === pluginId ? { ...plugin, ...updates } : plugin
    );
    this.setState({ installedPlugins: plugins });
  }

  /**
   * Load all data from backend
   */
  async loadAllData() {
    try {
      this.setState({ loading: true, error: null });

      const data = await this.api.refreshAllData();
      const categories = await this.api.getCategories();
      const systemStatus = await this.api.getSystemStatus();

      // Add bundled plugins (like PACASDB)
      const bundledPlugins = await this.getBundledPlugins();
      const bundledIds = new Set(bundledPlugins.map(p => p.id));
      const filteredPlugins = (data.installed || []).filter(p => !bundledIds.has(p.id));
      const allPlugins = [...bundledPlugins, ...filteredPlugins];

      this.setState({
        installedPlugins: allPlugins,
        permissions: data.permissions,
        resources: data.resources,
        categories,
        systemStatus,
        loading: false
      });
    } catch (error) {
      console.error('Failed to load data:', error);
      this.setState({
        error: error.message || 'Failed to load data',
        loading: false
      });
    }
  }

  /**
   * Load installed plugins
   */
  async loadInstalledPlugins() {
    try {
      const plugins = await this.api.listInstalledPlugins();

      // Add bundled plugins (like PACASDB)
      const bundledPlugins = await this.getBundledPlugins();

      // Merge, ensuring bundled plugins come first and aren't duplicated
      const bundledIds = new Set(bundledPlugins.map(p => p.id));
      const filteredPlugins = plugins.filter(p => !bundledIds.has(p.id));
      const allPlugins = [...bundledPlugins, ...filteredPlugins];

      this.setState({ installedPlugins: allPlugins });
    } catch (error) {
      console.error('Failed to load installed plugins:', error);
      this.showToast('Failed to load plugins', 'error');
    }
  }

  /**
   * Load available plugins
   */
  async loadAvailablePlugins(filters = {}) {
    try {
      const plugins = await this.api.listAvailablePlugins(filters);
      this.setState({ availablePlugins: plugins });
    } catch (error) {
      console.error('Failed to load available plugins:', error);
      this.showToast('Failed to load marketplace', 'error');
    }
  }

  /**
   * Load permissions for all plugins
   */
  async loadPermissions() {
    try {
      const permissions = await this.api.getAllPermissions();
      this.setState({ permissions });
    } catch (error) {
      console.error('Failed to load permissions:', error);
    }
  }

  /**
   * Load resource usage for all plugins
   */
  async loadResourceUsage() {
    try {
      const resources = await this.api.getAllResources();
      this.setState({ resources });
    } catch (error) {
      console.error('Failed to load resource usage:', error);
    }
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginId) {
    try {
      // For bundled plugins, use localStorage instead of backend API
      if (BUNDLED_PLUGINS[pluginId]) {
        const key = `bundled_plugin_${pluginId}`;
        const settings = JSON.parse(localStorage.getItem(key) || '{}');
        settings.enabled = true;
        localStorage.setItem(key, JSON.stringify(settings));
      } else {
        await this.api.enablePlugin(pluginId);
      }
      this.updatePluginState(pluginId, { enabled: true, status: 'active' });
    } catch (error) {
      console.error('Failed to enable plugin:', error);
      this.showToast('Failed to enable plugin', 'error');
      throw error;
    }
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginId) {
    try {
      // For bundled plugins, use localStorage instead of backend API
      if (BUNDLED_PLUGINS[pluginId]) {
        const key = `bundled_plugin_${pluginId}`;
        const settings = JSON.parse(localStorage.getItem(key) || '{}');
        settings.enabled = false;
        localStorage.setItem(key, JSON.stringify(settings));
      } else {
        await this.api.disablePlugin(pluginId);
      }
      this.updatePluginState(pluginId, { enabled: false, status: 'inactive' });
    } catch (error) {
      console.error('Failed to disable plugin:', error);
      this.showToast('Failed to disable plugin', 'error');
      throw error;
    }
  }

  /**
   * Install a plugin
   */
  async installPlugin(pluginId, options = {}) {
    try {
      this.showToast('Installing plugin...', 'info');
      const plugin = await this.api.installPlugin(pluginId, options);

      // Add to installed plugins
      const plugins = [...this.state.installedPlugins, plugin];
      this.setState({ installedPlugins: plugins });

      this.showToast('Plugin installed successfully', 'success');
      return plugin;
    } catch (error) {
      console.error('Failed to install plugin:', error);
      this.showToast('Failed to install plugin', 'error');
      throw error;
    }
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(pluginId) {
    try {
      await this.api.uninstallPlugin(pluginId);

      // Remove from installed plugins
      const plugins = this.state.installedPlugins.filter(p => p.id !== pluginId);
      this.setState({ installedPlugins: plugins });

      // Remove permissions and resources
      const permissions = { ...this.state.permissions };
      const resources = { ...this.state.resources };
      delete permissions[pluginId];
      delete resources[pluginId];
      this.setState({ permissions, resources });

      this.showToast('Plugin uninstalled', 'info');
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      this.showToast('Failed to uninstall plugin', 'error');
      throw error;
    }
  }

  /**
   * Grant permission to a plugin
   */
  async grantPermission(pluginId, capability) {
    try {
      await this.api.grantPermission(pluginId, capability);
      
      // Update permissions
      const currentPermissions = this.state.permissions[pluginId] || [];
      const newPermissions = [...new Set([...currentPermissions, capability])];
      
      this.setState({
        permissions: {
          ...this.state.permissions,
          [pluginId]: newPermissions
        }
      });
    } catch (error) {
      console.error('Failed to grant permission:', error);
      this.showToast('Failed to grant permission', 'error');
      throw error;
    }
  }

  /**
   * Revoke permission from a plugin
   */
  async revokePermission(pluginId, capability) {
    try {
      await this.api.revokePermission(pluginId, capability);
      
      // Update permissions
      const currentPermissions = this.state.permissions[pluginId] || [];
      const newPermissions = currentPermissions.filter(p => p !== capability);
      
      this.setState({
        permissions: {
          ...this.state.permissions,
          [pluginId]: newPermissions
        }
      });
    } catch (error) {
      console.error('Failed to revoke permission:', error);
      this.showToast('Failed to revoke permission', 'error');
      throw error;
    }
  }

  /**
   * Update resource usage for a plugin
   */
  updateResourceUsage(pluginId, usage) {
    this.setState({
      resources: {
        ...this.state.resources,
        [pluginId]: usage
      }
    });
  }

  /**
   * Set the current view
   */
  setCurrentView(view) {
    const validViews = ['discover', 'installed', 'permissions', 'resources'];
    if (validViews.includes(view)) {
      this.setState({ currentView: view });
    }
  }

  /**
   * Set search query
   */
  setSearchQuery(query) {
    this.setState({ searchQuery: query });
  }

  /**
   * Clear error
   */
  clearError() {
    this.setState({ error: null });
  }

  createReadwiseMarkdown(item) {
    const lines = [];
    const isBook = item.source_type === 'book' || item.category === 'books';
    const isArticle = item.source_type === 'article' || item.category === 'articles';
    const isPodcast = item.source_type === 'podcast' || item.category === 'podcasts';
    const isTweet = item.source_type === 'tweet' || item.category === 'tweets' || 
                   (item.source_url && item.source_url.includes('twitter.com'));
    
    // Use metadata format for books, articles, and podcasts
    const useMetadataFormat = isBook || isArticle || isPodcast;
    
    // Title
    lines.push(`# ${item.title || 'Untitled'}`);
    lines.push('');
    
    // Add cover image for books
    if (isBook && item.cover_image_url) {
      lines.push(`![rw-book-cover](${item.cover_image_url})`);
      lines.push('');
    }
    
    // Metadata section for books, articles, and podcasts
    if (useMetadataFormat) {
      lines.push('## Metadata');
      if (item.author) lines.push(`- Author: ${item.author}`);
      if (item.title) lines.push(`- Full Title: ${item.title}`);
      if (item.document_note) lines.push(`- Document Note: ${item.document_note}`);
      if (item.readable_title) lines.push(`- Title: ${item.readable_title}`);
      
      // Add category/type info
      if (item.source_type) lines.push(`- Type: ${item.source_type}`);
      if (item.category && item.category !== item.source_type) lines.push(`- Category: ${item.category}`);
      
      // Add tags if present
      const tags = [];
      if (item.book_tags && Array.isArray(item.book_tags)) {
        tags.push(...item.book_tags);
      }
      if (item.tags && Array.isArray(item.tags)) {
        tags.push(...item.tags);
      }
      if (tags.length > 0) {
        // Convert all tags to strings and remove duplicates
        const uniqueTags = [...new Set(tags.map(tag => String(tag)))];
        lines.push(`- Tags: ${uniqueTags.map(tag => `#${tag.replace(/\s+/g, '-')}`).join(' ')}`);
      }
      
      if (item.source_url) lines.push(`- URL: ${item.source_url}`);
      lines.push('');
    } else {
      // For tweets and other types, keep simpler metadata
      if (item.author) lines.push(`**Author:** ${item.author}`);
      if (item.source_type) lines.push(`**Type:** ${item.source_type}`);
      if (item.category) lines.push(`**Category:** ${item.category}`);
      if (item.source_url) lines.push(`**Source:** [Link](${item.source_url})`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    
    // Highlights
    if (item.highlights && item.highlights.length > 0) {
      lines.push('## Highlights');
      lines.push('');
      
      item.highlights.forEach((highlight, index) => {
        if (useMetadataFormat) {
          // For books, articles, and podcasts, use bullet points instead of blockquotes
          lines.push(`- ${highlight.text}`);
          
          // Add location as a link
          if (highlight.location) {
            const locationUrl = highlight.readwise_url || 
                              (item.asin ? `https://readwise.io/to_kindle?action=open&asin=${item.asin}&location=${highlight.location}` : null);
            if (locationUrl) {
              lines.push(`  ([Location ${highlight.location}](${locationUrl}))`);
            } else if (highlight.location) {
              lines.push(`  (Location ${highlight.location})`);
            }
          } else if (highlight.url) {
            // For articles/podcasts that might not have location but have URL
            lines.push(`  ([View Highlight](${highlight.url}))`);
          }
          
          // Add note if present
          if (highlight.note) {
            lines.push(`  **Note:** ${highlight.note}`);
          }
          
          lines.push('');
        } else {
          // For tweets and other types, keep blockquote format
          lines.push(`> ${highlight.text}`);
          lines.push('');
          
          if (highlight.note) {
            lines.push(`**Note:** ${highlight.note}`);
            lines.push('');
          }
          
          if (highlight.location) {
            lines.push(`*Location: ${highlight.location}*`);
            lines.push('');
          }
          
          // Add View Tweet link for tweets
          if (isTweet && highlight.url) {
            lines.push(`([View Tweet](${highlight.url}))`);
            lines.push('');
          }
          
          lines.push('---');
          lines.push('');
        }
      });
    }
    
    return lines.join('\n');
  }

  /**
   * Get filtered plugins based on search query
   */
  getFilteredPlugins() {
    if (!this.state.searchQuery) {
      return this.state.installedPlugins;
    }

    // Use fuzzy search for better matching
    return fuzzySearchPlugins(
      this.state.installedPlugins, 
      this.state.searchQuery,
      {
        keys: ['name', 'description', 'author', 'id', 'tags'],
        threshold: 3,
        limit: 100
      }
    );
  }
  
  /**
   * Get filtered available plugins for marketplace
   */
  getFilteredAvailablePlugins() {
    if (!this.state.searchQuery) {
      return this.state.availablePlugins;
    }

    // Use fuzzy search for marketplace
    return fuzzySearchPlugins(
      this.state.availablePlugins, 
      this.state.searchQuery,
      {
        keys: ['name', 'description', 'author', 'category', 'tags'],
        threshold: 3,
        limit: 100
      }
    );
  }

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info', duration = 3000) {
    return this.toastManager.show(message, type, duration);
  }

  /**
   * Open plugin settings modal
   */
  async openPluginSettings(plugin) {
    // First, get the saved settings from backend
    try {
      const savedSettings = await invoke('plugin_get_settings', {
        pluginId: plugin.id  // Use camelCase - Tauri converts to snake_case
      });
      
      console.log('Loaded saved settings:', savedSettings);
      
      // Update plugin's settings with saved values
      if (plugin.settings && Array.isArray(plugin.settings)) {
        plugin.settings = plugin.settings.map(s => ({
          ...s,
          value: savedSettings[s.id] !== undefined ? savedSettings[s.id] : s.value
        }));
      }
    } catch (error) {
      console.error('Failed to load saved settings:', error);
    }
    
    const modal = new PluginSettingsModal(plugin);
    modal.open();
    
    // Attach Initial Sync button handler after modal opens (for Readwise)
    if (plugin.id === 'readwise') {
      setTimeout(() => {
        const syncButton = modal.element?.querySelector('.initial-sync-button');
        console.log('Looking for Initial Sync button:', syncButton);
        if (syncButton) {
          console.log('Attaching click handler to Initial Sync button');
          syncButton.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Initial Sync button clicked!');
            
            try {
              const form = modal.element.querySelector('.plugin-settings-form');
              if (!form) {
                console.error('Settings form not found');
                this.showToast('Error: Settings form not found', 'error');
                return;
              }
              
              const formData = new FormData(form);
              const settings = {};
              
              // Process form data
              for (const [key, value] of formData.entries()) {
                settings[key] = value;
              }
              
              // Handle checkboxes
              const checkboxes = form.querySelectorAll('input[type="checkbox"]');
              checkboxes.forEach(checkbox => {
                settings[checkbox.name] = checkbox.checked;
              });
              
              const apiToken = settings.apiToken;
              
              if (!apiToken) {
                this.showToast('Please enter your Readwise API token first', 'warning');
                return; // Don't close modal
              }
              
              // First save the settings - wrap in 'settings' parameter
              await invoke('plugin_update_settings', {
                settings: {
                  plugin_id: plugin.id,
                  enabled: true,
                  settings: settings
                }
              });
              
              this.showToast('Settings saved. Starting Readwise sync...', 'info');
              
              // Perform the actual sync
              
              try {
                // Step 1: Verify the token
                const authResponse = await fetch('https://readwise.io/api/v2/auth', {
                  method: 'GET',
                  headers: {
                    'Authorization': `Token ${apiToken}`,
                    'Content-Type': 'application/json'
                  }
                });
                
                if (authResponse.status !== 204) {
                  throw new Error('Invalid API token. Please check your token at readwise.io/access_token');
                }
                
                // Step 2: Fetch ALL highlights with pagination (following Readwise API docs)
                let allItems = [];
                let nextPageCursor = null;
                let pageCount = 0;
                
                // Based on Readwise API docs: continue until nextPageCursor is null
                while (true) {
                  const params = new URLSearchParams();
                  // Don't set page_size - let API use its default
                  if (nextPageCursor) {
                    params.append('pageCursor', nextPageCursor);
                  }
                  
                  const exportResponse = await fetch(`https://readwise.io/api/v2/export?${params.toString()}`, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Token ${apiToken}`,
                      'Content-Type': 'application/json'
                    }
                  });
                  
                  if (!exportResponse.ok) {
                    console.error(`API error: ${exportResponse.status}`);
                    throw new Error(`Failed to fetch page ${pageCount + 1}: ${exportResponse.status}`);
                  }
                  
                  const pageData = await exportResponse.json();
                  pageCount++;
                  
                  // Add results to our collection
                  if (pageData.results && Array.isArray(pageData.results)) {
                    allItems = allItems.concat(pageData.results);
                  }
                  
                  // Show progress
                  this.showToast(`Fetching highlights... ${allItems.length} items loaded`, 'info');
                  
                  // Get next page cursor - API returns null when no more pages
                  nextPageCursor = pageData.nextPageCursor;
                  
                  // Stop when nextPageCursor is null (as per API docs)
                  if (!nextPageCursor) {
                    break;
                  }
                  
                  // Safety limit to prevent infinite loops
                  if (allItems.length > 5000) {
                    break;
                  }
                  
                  // Small delay to avoid rate limiting
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                // Step 3: Save to vault with folder organization
                let savedCount = 0;
                
                // First ensure the Readwise folder exists using Tauri v2 command
                try {
                  await invoke('create_new_folder', {
                    folderName: 'Readwise'  // Use camelCase for Tauri v2
                  });
                } catch (e) {
                  // Folder might already exist, that's fine
                }
                
                // Create subfolders by type
                const folderMap = {
                  'book': 'Books',
                  'books': 'Books',
                  'article': 'Articles',
                  'articles': 'Articles',
                  'podcast': 'Podcasts',
                  'podcasts': 'Podcasts',
                  'tweet': 'Tweets',
                  'tweets': 'Tweets',
                  'supplemental': 'Supplementals',
                  'supplementals': 'Supplementals',
                  'video': 'Videos',
                  'videos': 'Videos'
                };
                
                // Track which folders we've created
                const createdFolders = new Set();
                
                for (const item of allItems) {  // Use allItems instead of data.results
                  // Determine the subfolder based on source_type or category
                  const sourceType = (item.source_type || item.category || 'Other').toLowerCase();
                  const subfolder = folderMap[sourceType] || 'Other';
                  
                  // Create subfolder if needed
                  if (!createdFolders.has(subfolder)) {
                    try {
                      await invoke('create_new_folder', {
                        folderName: `Readwise/${subfolder}`
                      });
                      createdFolders.add(subfolder);
                    } catch (e) {
                      // Folder might already exist
                      createdFolders.add(subfolder);
                    }
                  }
                  
                  const filename = item.title
                    .replace(/[<>:"/\\|?*]/g, '-')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 100);
                  
                  const filePath = `Readwise/${subfolder}/${filename}.md`;
                  const content = this.createReadwiseMarkdown(item);
                  
                  try {
                    // Use Tauri v2's write_file_content command with camelCase params
                    await invoke('write_file_content', {
                      filePath: filePath,  // Changed from file_path to filePath
                      content: content
                    });
                    savedCount++;
                  } catch (err) {
                    // If file doesn't exist, create it first
                    try {
                      await invoke('create_new_file', {
                        fileName: filePath  // Changed from file_name to fileName
                      });
                      // Then write the content
                      await invoke('write_file_content', {
                        filePath: filePath,  // Changed from file_path to filePath
                        content: content
                      });
                      savedCount++;
                    } catch (err2) {
                      // Silent fail - file couldn't be saved
                    }
                  }
                }
                
                this.showToast(`Readwise sync complete! Saved ${savedCount} of ${allItems.length} items.`, 'success');
                
                // Add UUIDs to all imported files
                console.log('[Readwise] Adding UUIDs to imported files...');
                try {
                  const uuidResult = await invoke('add_uuids_to_vault', {
                    windowId: 'main',
                    skipExisting: true
                  });
                  console.log('[Readwise] UUID addition complete:', uuidResult);
                  if (uuidResult.added_uuids > 0) {
                    this.showToast(`Added UUIDs to ${uuidResult.added_uuids} files`, 'info');
                  }
                } catch (uuidError) {
                  console.error('[Readwise] Failed to add UUIDs:', uuidError);
                  // Don't show error to user, this is a background operation
                }
                
              } catch (syncError) {
                console.error('Sync error:', syncError);
                this.showToast(`Sync failed: ${syncError.message}`, 'error');
              }
              
              // Also save settings for future use
              settings.autoSync = true;
              settings.syncOnStartup = true;
              
              await invoke('plugin_update_settings', {
                settings: {
                  plugin_id: plugin.id,
                  enabled: true,
                  settings: settings
                }
              });
              
              // Enable the plugin
              await this.api.enablePlugin(plugin.id);
              
              // Update state
              const updatedPlugins = this.state.installedPlugins.map(p => {
                if (p.id === plugin.id) {
                  if (p.settings && Array.isArray(p.settings)) {
                    p.settings = p.settings.map(s => ({
                      ...s,
                      value: settings[s.id] !== undefined ? settings[s.id] : s.value
                    }));
                  }
                }
                return p;
              });
              this.setState({ installedPlugins: updatedPlugins });
              
            } catch (error) {
              console.error('Readwise sync failed:', error);
              this.showToast(`Failed to start sync: ${error.message || error}`, 'error');
            }
          });
        } else {
          console.error('Initial Sync button not found!');
        }
      }, 100); // Small delay to ensure modal is rendered
    }
    
    return new Promise((resolve) => {
      // Cancel button handler
      modal.options.actions[0].handler = () => {
        resolve(false);
        return true;
      };
      
      // Save Settings button handler (last button)
      modal.options.actions[modal.options.actions.length - 1].handler = async () => {
        const form = modal.element.querySelector('.plugin-settings-form');
        const formData = new FormData(form);
        const settings = {};
        
        // Process form data, handling checkboxes specially
        for (const [key, value] of formData.entries()) {
          settings[key] = value;
        }
        
        // Find all checkboxes and set their values (checked = true, unchecked = false)
        const checkboxes = form.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
          settings[checkbox.name] = checkbox.checked;
        });
        
        console.log('Saving settings:', settings);
        
        try {
          // The backend expects a PluginSettings object wrapped in 'settings' parameter
          await invoke('plugin_update_settings', {
            settings: {
              plugin_id: plugin.id,
              enabled: true,  // Include the enabled field
              settings: settings
            }
          });
          this.showToast('Settings saved successfully', 'success');
          
          // Update the plugin's settings in state
          const updatedPlugins = this.state.installedPlugins.map(p => {
            if (p.id === plugin.id) {
              // Update the plugin's settings array with new values
              if (p.settings && Array.isArray(p.settings)) {
                p.settings = p.settings.map(s => ({
                  ...s,
                  value: settings[s.id] !== undefined ? settings[s.id] : s.value
                }));
              }
            }
            return p;
          });
          this.setState({ installedPlugins: updatedPlugins });
          
          // Don't close modal after saving - let user decide when to close
          resolve(true);
        } catch (error) {
          console.error('Failed to save settings:', error);
          this.showToast('Failed to save settings', 'error');
          resolve(false);
        }
        return false; // Keep modal open after saving
      };
    });
  }

  /**
   * Request permissions for a plugin
   */
  async requestPermissions(plugin, permissions) {
    const dialog = new PermissionDialog(plugin, permissions);
    dialog.open();
    
    return new Promise((resolve) => {
      dialog.options.actions[0].handler = () => {
        resolve(false);
        return true;
      };
      
      dialog.options.actions[1].handler = async () => {
        try {
          for (const permission of permissions) {
            await this.grantPermission(plugin.id, permission.name);
          }
          this.showToast('Permissions granted', 'success');
          resolve(true);
        } catch (error) {
          this.showToast('Failed to grant permissions', 'error');
          resolve(false);
        }
        return true;
      };
    });
  }

  /**
   * Show confirmation dialog
   */
  async confirm(title, message, options = {}) {
    return Modal.confirm(title, message, options);
  }

  /**
   * Show alert dialog
   */
  async alert(title, message, options = {}) {
    return Modal.alert(title, message, options);
  }

  /**
   * Cleanup and destroy context
   */
  destroy() {
    // Stop resource monitoring
    this.api.stopResourceMonitoring();
    
    // Unsubscribe from events
    this.api.unsubscribeFromEvents();
    
    // Clear listeners
    this.listeners = [];
    
    // Reset state
    this.isInitialized = false;
  }
}