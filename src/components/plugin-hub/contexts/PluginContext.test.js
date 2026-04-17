import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { PluginProvider, usePluginContext } from './PluginContext';

// Mock Tauri API
jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn()
}));

describe('PluginContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial State', () => {
    test('should provide initial state', () => {
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      expect(result.current.state).toEqual({
        installedPlugins: [],
        availablePlugins: [],
        permissions: {},
        resources: {},
        loading: true,
        error: null,
        searchQuery: '',
        currentView: 'installed'
      });
    });

    test('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error;
      console.error = jest.fn();
      
      expect(() => {
        renderHook(() => usePluginContext());
      }).toThrow('usePluginContext must be used within a PluginProvider');
      
      console.error = originalError;
    });
  });

  describe('Plugin Loading', () => {
    test('should load installed plugins on mount', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      const mockPlugins = [
        { id: 'plugin1', name: 'Plugin 1', enabled: true },
        { id: 'plugin2', name: 'Plugin 2', enabled: false }
      ];
      invoke.mockResolvedValue(mockPlugins);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      // Initially loading
      expect(result.current.state.loading).toBe(true);
      
      // Wait for plugins to load
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      expect(result.current.state.loading).toBe(false);
      expect(result.current.state.installedPlugins).toEqual(mockPlugins);
      expect(invoke).toHaveBeenCalledWith('plugin_list_installed');
    });

    test('should handle plugin loading error', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockRejectedValue(new Error('Failed to load plugins'));
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      expect(result.current.state.loading).toBe(false);
      expect(result.current.state.error).toBe('Failed to load plugins');
    });
  });

  describe('Plugin Actions', () => {
    test('should enable plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([
        { id: 'plugin1', name: 'Plugin 1', enabled: false }
      ]);
      invoke.mockResolvedValueOnce(true);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      await act(async () => {
        await result.current.enablePlugin('plugin1');
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_enable', { pluginId: 'plugin1' });
      expect(result.current.state.installedPlugins[0].enabled).toBe(true);
    });

    test('should disable plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([
        { id: 'plugin1', name: 'Plugin 1', enabled: true }
      ]);
      invoke.mockResolvedValueOnce(true);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      await act(async () => {
        await result.current.disablePlugin('plugin1');
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_disable', { pluginId: 'plugin1' });
      expect(result.current.state.installedPlugins[0].enabled).toBe(false);
    });

    test('should install plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([]); // Initial empty list
      invoke.mockResolvedValueOnce({ id: 'new-plugin', name: 'New Plugin', enabled: true });
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      await act(async () => {
        await result.current.installPlugin('new-plugin');
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_install', { pluginId: 'new-plugin' });
      expect(result.current.state.installedPlugins).toHaveLength(1);
      expect(result.current.state.installedPlugins[0].id).toBe('new-plugin');
    });

    test('should uninstall plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([
        { id: 'plugin1', name: 'Plugin 1', enabled: true }
      ]);
      invoke.mockResolvedValueOnce(true);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      await act(async () => {
        await result.current.uninstallPlugin('plugin1');
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_uninstall', { pluginId: 'plugin1' });
      expect(result.current.state.installedPlugins).toHaveLength(0);
    });
  });

  describe('View Management', () => {
    test('should change current view', () => {
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      expect(result.current.state.currentView).toBe('installed');
      
      act(() => {
        result.current.setCurrentView('discover');
      });
      
      expect(result.current.state.currentView).toBe('discover');
    });

    test('should validate view name', () => {
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      act(() => {
        result.current.setCurrentView('invalid-view');
      });
      
      // Should remain on default view
      expect(result.current.state.currentView).toBe('installed');
    });
  });

  describe('Search Management', () => {
    test('should update search query', () => {
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      expect(result.current.state.searchQuery).toBe('');
      
      act(() => {
        result.current.setSearchQuery('readwise');
      });
      
      expect(result.current.state.searchQuery).toBe('readwise');
    });

    test('should filter installed plugins by search query', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([
        { id: 'readwise', name: 'Readwise', description: 'Sync highlights' },
        { id: 'daily-notes', name: 'Daily Notes', description: 'Create daily notes' }
      ]);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      act(() => {
        result.current.setSearchQuery('readwise');
      });
      
      const filtered = result.current.getFilteredPlugins();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('readwise');
    });

    test('should search case-insensitively', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([
        { id: 'readwise', name: 'Readwise', description: 'Sync highlights' }
      ]);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      act(() => {
        result.current.setSearchQuery('READWISE');
      });
      
      const filtered = result.current.getFilteredPlugins();
      expect(filtered).toHaveLength(1);
    });
  });

  describe('Permission Management', () => {
    test('should load plugin permissions', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      const mockPermissions = {
        'plugin1': ['vault:read', 'vault:write'],
        'plugin2': ['network:*']
      };
      invoke.mockResolvedValueOnce([]); // Installed plugins
      invoke.mockResolvedValueOnce(mockPermissions);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await result.current.loadPermissions();
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_list_all_permissions');
      expect(result.current.state.permissions).toEqual(mockPermissions);
    });

    test('should grant permission to plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([]); // Installed plugins
      invoke.mockResolvedValueOnce(true);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await result.current.grantPermission('plugin1', 'vault:read');
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_grant_permission', {
        pluginId: 'plugin1',
        capability: 'vault:read'
      });
      expect(result.current.state.permissions['plugin1']).toContain('vault:read');
    });

    test('should revoke permission from plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([]); // Installed plugins
      invoke.mockResolvedValueOnce({ 'plugin1': ['vault:read'] });
      invoke.mockResolvedValueOnce(true);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await result.current.loadPermissions();
      });
      
      await act(async () => {
        await result.current.revokePermission('plugin1', 'vault:read');
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_revoke_permission', {
        pluginId: 'plugin1',
        capability: 'vault:read'
      });
      expect(result.current.state.permissions['plugin1']).not.toContain('vault:read');
    });
  });

  describe('Resource Monitoring', () => {
    test('should load plugin resource usage', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      const mockResources = {
        'plugin1': { memory: 50000000, cpu: 15.5, storage: 1000000 },
        'plugin2': { memory: 30000000, cpu: 5.2, storage: 500000 }
      };
      invoke.mockResolvedValueOnce([]); // Installed plugins
      invoke.mockResolvedValueOnce(mockResources);
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await result.current.loadResourceUsage();
      });
      
      expect(invoke).toHaveBeenCalledWith('plugin_get_all_resources');
      expect(result.current.state.resources).toEqual(mockResources);
    });

    test('should update resource usage for specific plugin', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([]); // Installed plugins
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      const newUsage = { memory: 60000000, cpu: 20.0, storage: 1500000 };
      
      act(() => {
        result.current.updateResourceUsage('plugin1', newUsage);
      });
      
      expect(result.current.state.resources['plugin1']).toEqual(newUsage);
    });
  });

  describe('Error Handling', () => {
    test('should handle errors gracefully', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValueOnce([]); // Installed plugins
      invoke.mockRejectedValueOnce(new Error('Operation failed'));
      
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      await act(async () => {
        try {
          await result.current.enablePlugin('plugin1');
        } catch (error) {
          // Expected to throw
        }
      });
      
      expect(result.current.state.error).toBe('Failed to enable plugin: Operation failed');
    });

    test('should clear error state', () => {
      const wrapper = ({ children }) => <PluginProvider>{children}</PluginProvider>;
      const { result } = renderHook(() => usePluginContext(), { wrapper });
      
      act(() => {
        result.current.setError('Test error');
      });
      
      expect(result.current.state.error).toBe('Test error');
      
      act(() => {
        result.current.clearError();
      });
      
      expect(result.current.state.error).toBe(null);
    });
  });
});