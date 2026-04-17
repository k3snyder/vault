import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Plugin API - Comprehensive wrapper for all Tauri plugin commands
 */
class PluginAPI {
    constructor() {
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000
        };
        
        this.eventListeners = new Map();
        this.resourcePollingInterval = null;
        this.isConnected = true;
        this.circuitBreaker = {
            failures: 0,
            threshold: 5,
            timeout: 5000, // Reduced from 30s to 5s for faster recovery
            isOpen: false,
            lastFailure: null
        };
    }

    /**
     * Execute a Tauri command with retry logic and error handling
     */
    async executeCommand(command, args = {}, options = {}) {
        // Check circuit breaker
        if (this.circuitBreaker.isOpen) {
            const elapsed = Date.now() - this.circuitBreaker.lastFailure;
            if (elapsed < this.circuitBreaker.timeout) {
                throw new Error('Service temporarily unavailable. Circuit breaker is open.');
            } else {
                // Reset circuit breaker after timeout
                this.circuitBreaker.isOpen = false;
                this.circuitBreaker.failures = 0;
            }
        }

        const maxRetries = options.maxRetries || this.retryConfig.maxRetries;
        const baseDelay = options.baseDelay || this.retryConfig.baseDelay;
        
        let lastError;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await invoke(command, args);
                
                // Reset circuit breaker on success
                this.circuitBreaker.failures = 0;
                this.circuitBreaker.isOpen = false;
                
                return result;
            } catch (error) {
                lastError = error;
                console.error(`Command ${command} failed (attempt ${attempt + 1}/${maxRetries + 1}):`, error);
                
                // Update circuit breaker
                this.circuitBreaker.failures++;
                this.circuitBreaker.lastFailure = Date.now();
                
                if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
                    this.circuitBreaker.isOpen = true;
                    console.error('Circuit breaker opened due to repeated failures');
                    throw new Error('Too many consecutive failures. Service is being protected.');
                }
                
                // Don't retry if it's the last attempt or if it's a non-retryable error
                if (attempt === maxRetries || this.isNonRetryableError(error)) {
                    throw error;
                }
                
                // Calculate exponential backoff delay
                const delay = Math.min(baseDelay * Math.pow(2, attempt), this.retryConfig.maxDelay);
                await this.sleep(delay);
            }
        }
        
        throw lastError;
    }

    /**
     * Check if an error is non-retryable
     */
    isNonRetryableError(error) {
        const message = error.message || error.toString();
        const nonRetryablePatterns = [
            'permission denied',
            'not found',
            'invalid argument',
            'already exists',
            'validation failed'
        ];
        
        return nonRetryablePatterns.some(pattern => 
            message.toLowerCase().includes(pattern)
        );
    }

    /**
     * Sleep utility for delays
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============= Plugin Management Commands =============

    /**
     * List all installed plugins
     */
    async listInstalledPlugins() {
        try {
            // First try to refresh the plugin list from filesystem
            console.log('Refreshing plugin list from filesystem...');
            const refreshed = await this.executeCommand('plugin_refresh');
            console.log('Refreshed plugins:', refreshed);
            
            // Transform settings_schema to settings array for UI
            const plugins = (refreshed || []).map(plugin => {
                console.log('Plugin data from backend:', JSON.stringify(plugin, null, 2));
                
                // Always prefer settings_schema if it exists
                if (plugin.settings_schema) {
                    console.log('Found settings_schema, transforming:', plugin.settings_schema);
                    plugin.settings = this.transformSettingsSchema(plugin.settings_schema);
                    console.log('Transformed settings:', plugin.settings);
                } else if (plugin.settings && typeof plugin.settings === 'object' && !Array.isArray(plugin.settings)) {
                    // If no schema but settings is an object, try to convert it
                    console.log('No schema, but settings is object:', plugin.settings);
                    // Keep settings as is if it's already an array
                }
                return plugin;
            });
            
            return plugins;
        } catch (error) {
            console.error('Failed to refresh plugins, trying list:', error);
            // Fall back to just listing
            try {
                const plugins = await this.executeCommand('plugin_list');
                console.log('Listed plugins:', plugins);
                
                // Transform settings_schema to settings array for UI
                const transformedPlugins = (plugins || []).map(plugin => {
                    if (plugin.settings_schema && !plugin.settings) {
                        plugin.settings = this.transformSettingsSchema(plugin.settings_schema);
                    }
                    return plugin;
                });
                
                return transformedPlugins;
            } catch (fallbackError) {
                console.error('Failed to list plugins:', fallbackError);
                return [];
            }
        }
    }
    
    /**
     * Transform settings_schema object to settings array for UI
     */
    transformSettingsSchema(schema) {
        if (!schema || typeof schema !== 'object') return [];
        
        console.log('=== TRANSFORM SETTINGS SCHEMA ===');
        console.log('Input schema:', JSON.stringify(schema, null, 2));
        
        const settings = [];
        for (const [key, config] of Object.entries(schema)) {
            console.log(`Processing field ${key}:`, config);
            
            const setting = {
                id: key,
                label: this.formatLabel(key),
                type: config.type || 'text',
                value: config.default || '',
                placeholder: config.placeholder || '',
                description: config.description || '',
                required: config.required || false
            };
            
            // Handle specific field types
            if (config.type === 'boolean') {
                console.log(`  -> Setting ${key} as toggle (boolean)`);
                setting.type = 'toggle';
                setting.value = config.default === true;
            }
            if (config.type === 'select' && config.options) {
                setting.options = config.options;
            }
            if (config.type === 'number') {
                setting.min = config.min;
                setting.max = config.max;
            }
            if (config.secret) {
                setting.type = 'password';
            }
            if (config.type === 'text') {
                setting.type = 'textarea';
            }
            
            console.log(`  Final setting for ${key}:`, setting);
            settings.push(setting);
        }
        
        console.log('=== FINAL TRANSFORMED SETTINGS ===');
        console.log(JSON.stringify(settings, null, 2));
        
        return settings;
    }
    
    /**
     * Format a camelCase key into a readable label
     */
    formatLabel(key) {
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/Api /g, 'API ')
            .trim();
    }

    /**
     * List all available plugins from marketplace
     */
    async listAvailablePlugins(filters = {}) {
        try {
            const plugins = await this.executeCommand('plugin_list_available', filters);
            return plugins || [];
        } catch (error) {
            console.error('Failed to list available plugins:', error);
            return [];
        }
    }

    /**
     * Get detailed information about a plugin
     */
    async getPluginDetails(pluginId) {
        return this.executeCommand('plugin_get_details', { pluginId });
    }

    /**
     * Install a plugin
     */
    async installPlugin(pluginId, options = {}) {
        return this.executeCommand('plugin_install', { 
            pluginId,
            ...options 
        });
    }

    /**
     * Uninstall a plugin
     */
    async uninstallPlugin(pluginId) {
        return this.executeCommand('plugin_uninstall', { plugin_id: pluginId });
    }

    /**
     * Enable a plugin
     */
    async enablePlugin(pluginId) {
        return this.executeCommand('plugin_enable', { pluginId: pluginId });
    }

    /**
     * Disable a plugin
     */
    async disablePlugin(pluginId) {
        return this.executeCommand('plugin_disable', { pluginId: pluginId });
    }

    /**
     * Update a plugin
     */
    async updatePlugin(pluginId) {
        return this.executeCommand('plugin_update', { pluginId });
    }

    /**
     * Check for plugin updates
     */
    async checkForUpdates() {
        return this.executeCommand('plugin_check_updates');
    }

    // ============= Permission Management Commands =============

    /**
     * Get permissions for a plugin
     */
    async getPluginPermissions(pluginId) {
        try {
            const permissions = await this.executeCommand('plugin_get_permissions', { pluginId });
            return permissions || [];
        } catch (error) {
            console.error(`Failed to get permissions for ${pluginId}:`, error);
            return [];
        }
    }

    /**
     * Grant permission to a plugin
     */
    async grantPermission(pluginId, capability) {
        return this.executeCommand('plugin_grant_permission', { 
            pluginId, 
            capability 
        });
    }

    /**
     * Revoke permission from a plugin
     */
    async revokePermission(pluginId, capability) {
        return this.executeCommand('plugin_revoke_permission', { 
            pluginId, 
            capability 
        });
    }

    /**
     * Get all permissions matrix
     */
    async getAllPermissions() {
        try {
            const permissions = await this.executeCommand('plugin_list_all_permissions');
            return permissions || {};
        } catch (error) {
            console.error('Failed to get all permissions:', error);
            return {};
        }
    }

    /**
     * Request permissions for a plugin
     */
    async requestPermissions(pluginId, permissions) {
        return this.executeCommand('plugin_request_permissions', {
            pluginId,
            permissions
        });
    }

    // ============= Resource Management Commands =============

    /**
     * Get resource usage for a plugin
     */
    async getPluginResources(pluginId) {
        try {
            const resources = await this.executeCommand('plugin_get_resources', { pluginId });
            return resources || {
                memory: { used: 0, limit: 100 },
                cpu: 0,
                storage: { used: 0, limit: 500 }
            };
        } catch (error) {
            console.error(`Failed to get resources for ${pluginId}:`, error);
            return {
                memory: { used: 0, limit: 100 },
                cpu: 0,
                storage: { used: 0, limit: 500 }
            };
        }
    }

    /**
     * Get all plugin resources
     */
    async getAllResources() {
        try {
            const resources = await this.executeCommand('plugin_get_all_resources');
            return resources || {};
        } catch (error) {
            console.error('Failed to get all resources:', error);
            return {};
        }
    }

    /**
     * Set resource limits for a plugin
     */
    async setResourceLimits(pluginId, limits) {
        return this.executeCommand('plugin_set_resource_limits', {
            pluginId,
            limits
        });
    }

    /**
     * Restart a plugin
     */
    async restartPlugin(pluginId) {
        return this.executeCommand('plugin_restart', { pluginId });
    }

    // ============= Settings Management Commands =============

    /**
     * Get plugin settings
     */
    async getPluginSettings(pluginId) {
        try {
            const settings = await this.executeCommand('plugin_get_settings', { pluginId });
            return settings || {};
        } catch (error) {
            console.error(`Failed to get settings for ${pluginId}:`, error);
            return {};
        }
    }

    /**
     * Update plugin settings
     */
    async updatePluginSettings(pluginId, settings) {
        return this.executeCommand('plugin_update_settings', {
            pluginId,
            settings
        });
    }

    /**
     * Get plugin configuration schema
     */
    async getPluginConfigSchema(pluginId) {
        try {
            const schema = await this.executeCommand('plugin_get_config_schema', { pluginId });
            return schema || [];
        } catch (error) {
            console.error(`Failed to get config schema for ${pluginId}:`, error);
            return [];
        }
    }

    // ============= Search and Discovery Commands =============

    /**
     * Search plugins in marketplace
     */
    async searchPlugins(query, filters = {}) {
        try {
            const results = await this.executeCommand('plugin_search', {
                query,
                ...filters
            });
            return results || [];
        } catch (error) {
            console.error('Failed to search plugins:', error);
            return [];
        }
    }

    /**
     * Get plugin categories
     */
    async getCategories() {
        try {
            const categories = await this.executeCommand('plugin_get_categories');
            return categories || [];
        } catch (error) {
            console.error('Failed to get categories:', error);
            return [];
        }
    }

    /**
     * Get featured plugins
     */
    async getFeaturedPlugins() {
        try {
            const featured = await this.executeCommand('plugin_get_featured');
            return featured || [];
        } catch (error) {
            console.error('Failed to get featured plugins:', error);
            return [];
        }
    }

    // ============= Event Management =============

    /**
     * Subscribe to plugin events
     */
    async subscribeToEvents(eventHandlers) {
        const events = [
            'plugin-installed',
            'plugin-uninstalled',
            'plugin-enabled',
            'plugin-disabled',
            'plugin-updated',
            'plugin-error',
            'plugin-resource-threshold',
            'plugin-permission-requested',
            'plugin-permission-granted',
            'plugin-permission-revoked',
            'plugin-update-available'
        ];

        for (const eventName of events) {
            if (eventHandlers[eventName]) {
                const unlisten = await listen(eventName, (event) => {
                    console.log(`Received event ${eventName}:`, event.payload);
                    eventHandlers[eventName](event.payload);
                });
                
                this.eventListeners.set(eventName, unlisten);
            }
        }
    }

    /**
     * Unsubscribe from all events
     */
    unsubscribeFromEvents() {
        for (const [eventName, unlisten] of this.eventListeners) {
            unlisten();
        }
        this.eventListeners.clear();
    }

    // ============= Resource Monitoring =============

    /**
     * Start resource monitoring
     */
    startResourceMonitoring(callback, interval = 2000) {
        if (this.resourcePollingInterval) {
            this.stopResourceMonitoring();
        }

        this.resourcePollingInterval = setInterval(async () => {
            try {
                const resources = await this.getAllResources();
                callback(resources);
            } catch (error) {
                console.error('Resource monitoring error:', error);
            }
        }, interval);

        // Initial fetch
        this.getAllResources().then(callback).catch(console.error);
    }

    /**
     * Stop resource monitoring
     */
    stopResourceMonitoring() {
        if (this.resourcePollingInterval) {
            clearInterval(this.resourcePollingInterval);
            this.resourcePollingInterval = null;
        }
    }

    // ============= Health and Status =============

    /**
     * Check backend health
     */
    async checkHealth() {
        try {
            await this.executeCommand('plugin_health_check');
            this.isConnected = true;
            return true;
        } catch (error) {
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Get system status
     */
    async getSystemStatus() {
        try {
            const status = await this.executeCommand('plugin_get_system_status');
            return status || {
                version: 'unknown',
                pluginsEnabled: true,
                totalPlugins: 0,
                activePlugins: 0
            };
        } catch (error) {
            console.error('Failed to get system status:', error);
            return {
                version: 'unknown',
                pluginsEnabled: false,
                totalPlugins: 0,
                activePlugins: 0
            };
        }
    }

    // ============= Utility Methods =============

    /**
     * Refresh all plugin data
     */
    async refreshAllData() {
        const [installed, permissions, resources] = await Promise.allSettled([
            this.listInstalledPlugins(),
            this.getAllPermissions(),
            this.getAllResources()
        ]);

        return {
            installed: installed.status === 'fulfilled' ? installed.value : [],
            permissions: permissions.status === 'fulfilled' ? permissions.value : {},
            resources: resources.status === 'fulfilled' ? resources.value : {}
        };
    }

    /**
     * Reset circuit breaker
     */
    resetCircuitBreaker() {
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.lastFailure = null;
    }
}

// Create singleton instance
const pluginAPI = new PluginAPI();

export default pluginAPI;