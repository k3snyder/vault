import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * @typedef {Object} Plugin
 * @property {string} id - Unique plugin identifier
 * @property {string} name - Display name
 * @property {string} description - Plugin description
 * @property {boolean} enabled - Whether plugin is enabled
 * @property {string} version - Plugin version
 * @property {string} author - Plugin author
 */

/**
 * @typedef {Object} ResourceUsage
 * @property {number} memory - Memory usage in bytes
 * @property {number} cpu - CPU usage percentage
 * @property {number} storage - Storage usage in bytes
 */

/**
 * @typedef {'discover'|'installed'|'permissions'|'resources'} ViewType
 */

/**
 * @typedef {Object} PluginState
 * @property {Plugin[]} installedPlugins - List of installed plugins
 * @property {Plugin[]} availablePlugins - List of available plugins to install
 * @property {Object.<string, string[]>} permissions - Map of plugin ID to granted permissions
 * @property {Object.<string, ResourceUsage>} resources - Map of plugin ID to resource usage
 * @property {boolean} loading - Whether data is being loaded
 * @property {string|null} error - Error message if any
 * @property {string} searchQuery - Current search query
 * @property {ViewType} currentView - Currently active view
 */

// Initial state
const initialState = {
  installedPlugins: [],
  availablePlugins: [],
  permissions: {},
  resources: {},
  loading: true,
  error: null,
  searchQuery: '',
  currentView: 'installed'
};

// Action types
const ActionTypes = {
  SET_INSTALLED_PLUGINS: 'SET_INSTALLED_PLUGINS',
  SET_AVAILABLE_PLUGINS: 'SET_AVAILABLE_PLUGINS',
  SET_PERMISSIONS: 'SET_PERMISSIONS',
  SET_RESOURCES: 'SET_RESOURCES',
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_SEARCH_QUERY: 'SET_SEARCH_QUERY',
  SET_CURRENT_VIEW: 'SET_CURRENT_VIEW',
  UPDATE_PLUGIN: 'UPDATE_PLUGIN',
  ADD_PLUGIN: 'ADD_PLUGIN',
  REMOVE_PLUGIN: 'REMOVE_PLUGIN',
  UPDATE_PLUGIN_PERMISSION: 'UPDATE_PLUGIN_PERMISSION',
  UPDATE_RESOURCE_USAGE: 'UPDATE_RESOURCE_USAGE'
};

/**
 * Reducer for plugin state management
 * @param {PluginState} state 
 * @param {Object} action 
 * @returns {PluginState}
 */
function pluginReducer(state, action) {
  switch (action.type) {
    case ActionTypes.SET_INSTALLED_PLUGINS:
      return { ...state, installedPlugins: action.payload, loading: false };
    
    case ActionTypes.SET_AVAILABLE_PLUGINS:
      return { ...state, availablePlugins: action.payload };
    
    case ActionTypes.SET_PERMISSIONS:
      return { ...state, permissions: action.payload };
    
    case ActionTypes.SET_RESOURCES:
      return { ...state, resources: action.payload };
    
    case ActionTypes.SET_LOADING:
      return { ...state, loading: action.payload };
    
    case ActionTypes.SET_ERROR:
      return { ...state, error: action.payload, loading: false };
    
    case ActionTypes.CLEAR_ERROR:
      return { ...state, error: null };
    
    case ActionTypes.SET_SEARCH_QUERY:
      return { ...state, searchQuery: action.payload };
    
    case ActionTypes.SET_CURRENT_VIEW:
      const validViews = ['discover', 'installed', 'permissions', 'resources'];
      if (validViews.includes(action.payload)) {
        return { ...state, currentView: action.payload };
      }
      return state;
    
    case ActionTypes.UPDATE_PLUGIN:
      return {
        ...state,
        installedPlugins: state.installedPlugins.map(plugin =>
          plugin.id === action.payload.id ? { ...plugin, ...action.payload.updates } : plugin
        )
      };
    
    case ActionTypes.ADD_PLUGIN:
      return {
        ...state,
        installedPlugins: [...state.installedPlugins, action.payload]
      };
    
    case ActionTypes.REMOVE_PLUGIN:
      return {
        ...state,
        installedPlugins: state.installedPlugins.filter(plugin => plugin.id !== action.payload)
      };
    
    case ActionTypes.UPDATE_PLUGIN_PERMISSION:
      const { pluginId, capability, granted } = action.payload;
      const currentPermissions = state.permissions[pluginId] || [];
      
      let newPermissions;
      if (granted) {
        newPermissions = [...new Set([...currentPermissions, capability])];
      } else {
        newPermissions = currentPermissions.filter(p => p !== capability);
      }
      
      return {
        ...state,
        permissions: {
          ...state.permissions,
          [pluginId]: newPermissions
        }
      };
    
    case ActionTypes.UPDATE_RESOURCE_USAGE:
      return {
        ...state,
        resources: {
          ...state.resources,
          [action.payload.pluginId]: action.payload.usage
        }
      };
    
    default:
      return state;
  }
}

// Create context
const PluginContext = createContext(null);

/**
 * Plugin Provider Component
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function PluginProvider({ children }) {
  const [state, dispatch] = useReducer(pluginReducer, initialState);

  // Load installed plugins on mount
  useEffect(() => {
    loadInstalledPlugins();
  }, []);

  // Load installed plugins
  const loadInstalledPlugins = useCallback(async () => {
    try {
      dispatch({ type: ActionTypes.SET_LOADING, payload: true });
      const plugins = await invoke('plugin_list_installed');
      dispatch({ type: ActionTypes.SET_INSTALLED_PLUGINS, payload: plugins });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
    }
  }, []);

  // Load available plugins
  const loadAvailablePlugins = useCallback(async () => {
    try {
      const plugins = await invoke('plugin_list_available');
      dispatch({ type: ActionTypes.SET_AVAILABLE_PLUGINS, payload: plugins });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
    }
  }, []);

  // Load permissions
  const loadPermissions = useCallback(async () => {
    try {
      const permissions = await invoke('plugin_list_all_permissions');
      dispatch({ type: ActionTypes.SET_PERMISSIONS, payload: permissions });
    } catch (error) {
      console.error('Failed to load permissions:', error);
    }
  }, []);

  // Load resource usage
  const loadResourceUsage = useCallback(async () => {
    try {
      const resources = await invoke('plugin_get_all_resources');
      dispatch({ type: ActionTypes.SET_RESOURCES, payload: resources });
    } catch (error) {
      console.error('Failed to load resource usage:', error);
    }
  }, []);

  // Enable plugin
  const enablePlugin = useCallback(async (pluginId) => {
    try {
      await invoke('plugin_enable', { pluginId });
      dispatch({ 
        type: ActionTypes.UPDATE_PLUGIN, 
        payload: { id: pluginId, updates: { enabled: true } }
      });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: `Failed to enable plugin: ${error.message}` });
      throw error;
    }
  }, []);

  // Disable plugin
  const disablePlugin = useCallback(async (pluginId) => {
    try {
      await invoke('plugin_disable', { pluginId });
      dispatch({ 
        type: ActionTypes.UPDATE_PLUGIN, 
        payload: { id: pluginId, updates: { enabled: false } }
      });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: `Failed to disable plugin: ${error.message}` });
      throw error;
    }
  }, []);

  // Install plugin
  const installPlugin = useCallback(async (pluginId) => {
    try {
      const plugin = await invoke('plugin_install', { pluginId });
      dispatch({ type: ActionTypes.ADD_PLUGIN, payload: plugin });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: `Failed to install plugin: ${error.message}` });
      throw error;
    }
  }, []);

  // Uninstall plugin
  const uninstallPlugin = useCallback(async (pluginId) => {
    try {
      await invoke('plugin_uninstall', { pluginId });
      dispatch({ type: ActionTypes.REMOVE_PLUGIN, payload: pluginId });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: `Failed to uninstall plugin: ${error.message}` });
      throw error;
    }
  }, []);

  // Grant permission
  const grantPermission = useCallback(async (pluginId, capability) => {
    try {
      await invoke('plugin_grant_permission', { pluginId, capability });
      dispatch({
        type: ActionTypes.UPDATE_PLUGIN_PERMISSION,
        payload: { pluginId, capability, granted: true }
      });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: `Failed to grant permission: ${error.message}` });
      throw error;
    }
  }, []);

  // Revoke permission
  const revokePermission = useCallback(async (pluginId, capability) => {
    try {
      await invoke('plugin_revoke_permission', { pluginId, capability });
      dispatch({
        type: ActionTypes.UPDATE_PLUGIN_PERMISSION,
        payload: { pluginId, capability, granted: false }
      });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_ERROR, payload: `Failed to revoke permission: ${error.message}` });
      throw error;
    }
  }, []);

  // Update resource usage
  const updateResourceUsage = useCallback((pluginId, usage) => {
    dispatch({
      type: ActionTypes.UPDATE_RESOURCE_USAGE,
      payload: { pluginId, usage }
    });
  }, []);

  // Set current view
  const setCurrentView = useCallback((view) => {
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
  }, []);

  // Set search query
  const setSearchQuery = useCallback((query) => {
    dispatch({ type: ActionTypes.SET_SEARCH_QUERY, payload: query });
  }, []);

  // Set error
  const setError = useCallback((error) => {
    dispatch({ type: ActionTypes.SET_ERROR, payload: error });
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_ERROR });
  }, []);

  // Get filtered plugins based on search query
  const getFilteredPlugins = useCallback(() => {
    if (!state.searchQuery) {
      return state.installedPlugins;
    }

    const query = state.searchQuery.toLowerCase();
    return state.installedPlugins.filter(plugin => 
      plugin.name.toLowerCase().includes(query) ||
      plugin.description?.toLowerCase().includes(query) ||
      plugin.id.toLowerCase().includes(query)
    );
  }, [state.installedPlugins, state.searchQuery]);

  // Context value
  const value = {
    state,
    loadInstalledPlugins,
    loadAvailablePlugins,
    loadPermissions,
    loadResourceUsage,
    enablePlugin,
    disablePlugin,
    installPlugin,
    uninstallPlugin,
    grantPermission,
    revokePermission,
    updateResourceUsage,
    setCurrentView,
    setSearchQuery,
    setError,
    clearError,
    getFilteredPlugins
  };

  return (
    <PluginContext.Provider value={value}>
      {children}
    </PluginContext.Provider>
  );
}

/**
 * Hook to use plugin context
 * @returns {Object} Plugin context value
 */
export function usePluginContext() {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePluginContext must be used within a PluginProvider');
  }
  return context;
}