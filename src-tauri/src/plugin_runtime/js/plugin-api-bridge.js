// Plugin API Bridge - JavaScript API for plugins to interact with Vault
// This script is injected into plugin WebViews to provide the API surface

(function() {
    'use strict';

    // Helper function to call Tauri commands
    async function invoke(cmd, args = {}) {
        // In WebView context, we'll use postMessage to communicate with the host
        return new Promise((resolve, reject) => {
            const messageId = Math.random().toString(36).substr(2, 9);
            
            const handler = (event) => {
                if (event.data && event.data.id === messageId) {
                    window.removeEventListener('message', handler);
                    if (event.data.error) {
                        reject(new Error(event.data.error));
                    } else {
                        resolve(event.data.result);
                    }
                }
            };
            
            window.addEventListener('message', handler);
            
            // Post message to parent
            window.parent.postMessage({
                type: 'plugin-api-call',
                id: messageId,
                command: cmd,
                args: args
            }, '*');
            
            // Timeout after 10 seconds
            setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('API call timeout'));
            }, 10000);
        });
    }

    // Get the plugin ID from the WebView context
    const PLUGIN_ID = window.__PLUGIN_ID__ || 'unknown';

    // Vault API
    const vault = {
        /**
         * Read a file from the vault
         * @param {string} path - Path to the file
         * @returns {Promise<string>} File content
         */
        async read(path) {
            return invoke('plugin_vault_read', { 
                plugin_id: PLUGIN_ID, 
                path 
            });
        },

        /**
         * Write content to a file in the vault
         * @param {string} path - Path to the file
         * @param {string} content - Content to write
         * @returns {Promise<void>}
         */
        async write(path, content) {
            return invoke('plugin_vault_write', { 
                plugin_id: PLUGIN_ID, 
                path, 
                content 
            });
        },

        /**
         * List files in a directory
         * @param {string} [path=''] - Directory path
         * @returns {Promise<string[]>} List of file paths
         */
        async list(path = '') {
            return invoke('plugin_vault_list', { 
                plugin_id: PLUGIN_ID, 
                path 
            });
        },

        /**
         * Delete a file from the vault
         * @param {string} path - Path to the file
         * @returns {Promise<void>}
         */
        async delete(path) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'vault.delete',
                params: { path }
            });
        },

        /**
         * Rename a file in the vault
         * @param {string} oldPath - Current path
         * @param {string} newPath - New path
         * @returns {Promise<void>}
         */
        async rename(oldPath, newPath) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'vault.rename',
                params: { oldPath, newPath }
            });
        },

        /**
         * Check if a file exists
         * @param {string} path - Path to check
         * @returns {Promise<boolean>}
         */
        async exists(path) {
            const result = await invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'vault.exists',
                params: { path }
            });
            return result.exists;
        },

        /**
         * Get file metadata
         * @param {string} path - Path to the file
         * @returns {Promise<Object>} File metadata
         */
        async getMetadata(path) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'vault.getMetadata',
                params: { path }
            });
        },

        /**
         * Watch for file changes
         * @param {string} path - Path to watch
         * @param {Function} callback - Callback for changes
         * @returns {Function} Unwatch function
         */
        watch(path, callback) {
            const watchId = Math.random().toString(36).substr(2, 9);
            
            // Register the watcher
            invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'vault.watch',
                params: { path, watchId }
            });
            
            // Set up event listener for file events
            const handler = (event) => {
                if (event.data && 
                    event.data.type === 'file-event' && 
                    event.data.watchId === watchId) {
                    callback(event.data.event);
                }
            };
            
            window.addEventListener('message', handler);
            
            // Return unwatch function
            return () => {
                window.removeEventListener('message', handler);
                invoke('plugin_ipc_call', {
                    plugin_id: PLUGIN_ID,
                    method: 'vault.unwatch',
                    params: { watchId }
                });
            };
        }
    };

    // Workspace API
    const workspace = {
        /**
         * Show a notice to the user
         * @param {string} message - Notice message
         * @param {number} [timeout=5000] - Timeout in milliseconds
         * @param {string} [type='info'] - Notice type (info, warning, error, success)
         * @returns {Promise<void>}
         */
        async showNotice(message, timeout = 5000, type = 'info') {
            return invoke('plugin_workspace_notice', {
                plugin_id: PLUGIN_ID,
                message,
                timeout,
                notice_type: type
            });
        },

        /**
         * Get the currently active file
         * @returns {Promise<string|null>} Path to active file
         */
        async getActiveFile() {
            const result = await invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'workspace.getActiveFile',
                params: {}
            });
            return result.path;
        },

        /**
         * Open a file in the editor
         * @param {string} path - File path to open
         * @returns {Promise<void>}
         */
        async openFile(path) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'workspace.openFile',
                params: { path }
            });
        },

        /**
         * Create a new modal
         * @param {Object} config - Modal configuration
         * @returns {Promise<Object>} Modal result
         */
        async createModal(config) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'workspace.createModal',
                params: config
            });
        },

        /**
         * Register a command
         * @param {Object} command - Command configuration
         * @returns {Promise<void>}
         */
        async registerCommand(command) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'workspace.registerCommand',
                params: command
            });
        },

        /**
         * Add a status bar item
         * @param {Object} item - Status bar item configuration
         * @returns {Promise<string>} Item ID
         */
        async addStatusBarItem(item) {
            const result = await invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'workspace.addStatusBarItem',
                params: item
            });
            return result.id;
        },

        /**
         * Add a ribbon item
         * @param {Object} item - Ribbon item configuration
         * @returns {Promise<string>} Item ID
         */
        async addRibbonItem(item) {
            const result = await invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'workspace.addRibbonItem',
                params: item
            });
            return result.id;
        }
    };

    // Settings API
    const settings = {
        /**
         * Get a setting value
         * @param {string} key - Setting key
         * @returns {Promise<any>} Setting value
         */
        async get(key) {
            return invoke('plugin_settings_get', {
                plugin_id: PLUGIN_ID,
                key
            });
        },

        /**
         * Set a setting value
         * @param {string} key - Setting key
         * @param {any} value - Setting value
         * @returns {Promise<void>}
         */
        async set(key, value) {
            return invoke('plugin_settings_set', {
                plugin_id: PLUGIN_ID,
                key,
                value
            });
        },

        /**
         * Get all settings
         * @returns {Promise<Object>} All settings
         */
        async getAll() {
            const result = await invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'settings.getAll',
                params: {}
            });
            return result.settings;
        },

        /**
         * Delete a setting
         * @param {string} key - Setting key to delete
         * @returns {Promise<void>}
         */
        async delete(key) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'settings.delete',
                params: { key }
            });
        },

        /**
         * Watch for setting changes
         * @param {string} key - Setting key to watch
         * @param {Function} callback - Callback for changes
         * @returns {Function} Unwatch function
         */
        watch(key, callback) {
            const watchId = Math.random().toString(36).substr(2, 9);
            
            // Register the watcher
            invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'settings.watch',
                params: { key, watchId }
            });
            
            // Set up event listener
            const handler = (event) => {
                if (event.data && 
                    event.data.type === 'settings-change' && 
                    event.data.watchId === watchId) {
                    callback(event.data.value);
                }
            };
            
            window.addEventListener('message', handler);
            
            // Return unwatch function
            return () => {
                window.removeEventListener('message', handler);
                invoke('plugin_ipc_call', {
                    plugin_id: PLUGIN_ID,
                    method: 'settings.unwatch',
                    params: { watchId }
                });
            };
        }
    };

    // Events API
    const events = {
        /**
         * Subscribe to an event
         * @param {string} event - Event name
         * @param {Function} callback - Event callback
         * @returns {Function} Unsubscribe function
         */
        on(event, callback) {
            const handler = (e) => {
                if (e.data && e.data.type === 'plugin-event' && e.data.event === event) {
                    callback(e.data.data);
                }
            };
            
            window.addEventListener('message', handler);
            
            return () => {
                window.removeEventListener('message', handler);
            };
        },

        /**
         * Emit an event
         * @param {string} event - Event name
         * @param {any} data - Event data
         * @returns {Promise<void>}
         */
        async emit(event, data) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'events.emit',
                params: { event, data }
            });
        }
    };

    // Network API (restricted)
    const network = {
        /**
         * Make an HTTP request (requires permission)
         * @param {Object} options - Request options
         * @returns {Promise<Object>} Response
         */
        async fetch(options) {
            return invoke('plugin_ipc_call', {
                plugin_id: PLUGIN_ID,
                method: 'network.fetch',
                params: options
            });
        }
    };

    // Expose APIs globally
    window.vault = vault;
    window.workspace = workspace;
    window.settings = settings;
    window.events = events;
    window.network = network;

    // Also expose as a single namespace
    window.VaultAPI = {
        vault,
        workspace,
        settings,
        events,
        network,
        version: '1.0.0'
    };

    // Notify that the API is ready
    window.dispatchEvent(new CustomEvent('vault-api-ready', {
        detail: { version: '1.0.0' }
    }));

    console.log('Vault Plugin API loaded successfully');
})();