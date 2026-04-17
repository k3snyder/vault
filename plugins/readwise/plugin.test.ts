// Readwise Plugin Tests - Comprehensive test suite for plugin lifecycle and functionality
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaultReadwisePlugin } from './plugin';
import type { 
  VaultAPI, 
  WorkspaceAPI, 
  SettingsAPI, 
  NetworkAPI,
  PluginContext,
  PluginManifest
} from '@vault/plugin-api';

// Mock APIs
const mockVault: VaultAPI = {
  read: vi.fn(),
  write: vi.fn(),
  append: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  listNotes: vi.fn(),
  searchNotes: vi.fn()
};

const mockWorkspace: WorkspaceAPI = {
  showNotice: vi.fn(),
  showProgress: vi.fn(),
  hideProgress: vi.fn(),
  openFile: vi.fn(),
  openExternal: vi.fn(),
  getActiveFile: vi.fn(),
  registerCommand: vi.fn(),
  registerStatusBarItem: vi.fn(),
  registerSettingsTab: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
};

const mockSettings: SettingsAPI = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(),
  list: vi.fn(),
  onChange: vi.fn(),
  offChange: vi.fn()
};

const mockNetwork: NetworkAPI = {
  fetch: vi.fn(),
  download: vi.fn(),
  upload: vi.fn()
};

const mockContext: PluginContext = {
  vault: mockVault,
  workspace: mockWorkspace,
  settings: mockSettings,
  network: mockNetwork,
  manifest: {
    id: 'readwise',
    name: 'Readwise',
    version: '1.0.0',
    author: 'Vault',
    description: 'Sync your Readwise highlights to Vault',
    permissions: ['vault.read', 'vault.write', 'network.fetch', 'settings.store'],
    main: 'plugin.js'
  } as PluginManifest
};

describe('VaultReadwisePlugin', () => {
  let plugin: VaultReadwisePlugin;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    plugin = new VaultReadwisePlugin();
  });

  afterEach(() => {
    // Clean up
    vi.restoreAllMocks();
  });

  describe('Plugin Lifecycle', () => {
    it('should initialize successfully', async () => {
      await plugin.onload(mockContext);
      expect(plugin.isLoaded()).toBe(true);
    });

    it('should register commands on load', async () => {
      await plugin.onload(mockContext);
      
      expect(mockWorkspace.registerCommand).toHaveBeenCalledWith({
        id: 'readwise-sync',
        name: 'Sync Readwise highlights',
        callback: expect.any(Function)
      });

      expect(mockWorkspace.registerCommand).toHaveBeenCalledWith({
        id: 'readwise-sync-new',
        name: 'Sync new highlights only',
        callback: expect.any(Function)
      });

      expect(mockWorkspace.registerCommand).toHaveBeenCalledWith({
        id: 'readwise-settings',
        name: 'Open Readwise settings',
        callback: expect.any(Function)
      });
    });

    it('should register status bar item', async () => {
      await plugin.onload(mockContext);
      
      expect(mockWorkspace.registerStatusBarItem).toHaveBeenCalledWith({
        id: 'readwise-status',
        text: 'Readwise',
        tooltip: 'Click to sync Readwise highlights',
        position: 'right',
        onClick: expect.any(Function)
      });
    });

    it('should register settings tab', async () => {
      await plugin.onload(mockContext);
      
      expect(mockWorkspace.registerSettingsTab).toHaveBeenCalledWith({
        id: 'readwise-settings',
        name: 'Readwise',
        component: expect.any(Function)
      });
    });

    it('should load saved settings on initialization', async () => {
      const savedSettings = {
        apiToken: 'test-token',
        syncFrequency: 60,
        autoSync: true,
        lastSync: '2025-01-01T00:00:00Z'
      };

      mockSettings.get.mockResolvedValue(savedSettings);

      await plugin.onload(mockContext);

      expect(mockSettings.get).toHaveBeenCalledWith('readwise-settings');
      expect(plugin.getSettings()).toEqual(savedSettings);
    });

    it('should clean up resources on unload', async () => {
      await plugin.onload(mockContext);
      await plugin.onunload();

      expect(plugin.isLoaded()).toBe(false);
      expect(plugin.getSyncTimer()).toBeNull();
    });

    it('should stop auto sync on unload', async () => {
      const savedSettings = {
        apiToken: 'test-token',
        syncFrequency: 60,
        autoSync: true
      };

      mockSettings.get.mockResolvedValue(savedSettings);

      await plugin.onload(mockContext);
      expect(plugin.getSyncTimer()).toBeDefined();

      await plugin.onunload();
      expect(plugin.getSyncTimer()).toBeNull();
    });
  });

  describe('OAuth Authentication', () => {
    it('should initiate OAuth flow', async () => {
      await plugin.onload(mockContext);
      
      mockWorkspace.openExternal.mockResolvedValue(true);
      
      await plugin.authenticate();
      
      expect(mockWorkspace.openExternal).toHaveBeenCalledWith(
        expect.stringContaining('readwise.io/access_token')
      );
    });

    it('should save token securely', async () => {
      await plugin.onload(mockContext);
      
      const token = 'test-api-token';
      await plugin.saveToken(token);
      
      expect(mockSettings.set).toHaveBeenCalledWith('readwise-settings', 
        expect.objectContaining({
          apiToken: token
        })
      );
    });

    it('should validate token with API', async () => {
      await plugin.onload(mockContext);
      
      const token = 'valid-token';
      mockNetwork.fetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      });

      const isValid = await plugin.validateToken(token);
      
      expect(isValid).toBe(true);
      expect(mockNetwork.fetch).toHaveBeenCalledWith(
        'https://readwise.io/api/v2/auth',
        expect.objectContaining({
          headers: {
            'Authorization': `Token ${token}`
          }
        })
      );
    });

    it('should handle invalid token', async () => {
      await plugin.onload(mockContext);
      
      const token = 'invalid-token';
      mockNetwork.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' })
      });

      const isValid = await plugin.validateToken(token);
      
      expect(isValid).toBe(false);
    });
  });

  describe('Settings Management', () => {
    it('should update settings', async () => {
      await plugin.onload(mockContext);
      
      const newSettings = {
        apiToken: 'new-token',
        syncFrequency: 30,
        autoSync: false
      };

      await plugin.updateSettings(newSettings);
      
      expect(mockSettings.set).toHaveBeenCalledWith('readwise-settings', newSettings);
      expect(plugin.getSettings()).toEqual(newSettings);
    });

    it('should restart auto sync when frequency changes', async () => {
      await plugin.onload(mockContext);
      
      const initialSettings = {
        apiToken: 'token',
        syncFrequency: 60,
        autoSync: true
      };

      await plugin.updateSettings(initialSettings);
      const firstTimer = plugin.getSyncTimer();

      await plugin.updateSettings({
        ...initialSettings,
        syncFrequency: 30
      });

      const secondTimer = plugin.getSyncTimer();
      expect(secondTimer).not.toBe(firstTimer);
    });

    it('should stop auto sync when disabled', async () => {
      await plugin.onload(mockContext);
      
      const initialSettings = {
        apiToken: 'token',
        syncFrequency: 60,
        autoSync: true
      };

      await plugin.updateSettings(initialSettings);
      expect(plugin.getSyncTimer()).toBeDefined();

      await plugin.updateSettings({
        ...initialSettings,
        autoSync: false
      });

      expect(plugin.getSyncTimer()).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      await plugin.onload(mockContext);
      
      mockNetwork.fetch.mockRejectedValue(new Error('Network error'));
      
      const result = await plugin.syncHighlights();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(mockWorkspace.showNotice).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync'),
        'error'
      );
    });

    it('should handle API rate limits', async () => {
      await plugin.onload(mockContext);
      
      mockNetwork.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: {
          'Retry-After': '60'
        },
        json: async () => ({ error: 'Rate limited' })
      });

      const result = await plugin.syncHighlights();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limited');
      expect(plugin.getRetryAfter()).toBe(60);
    });

    it('should retry with exponential backoff', async () => {
      await plugin.onload(mockContext);
      
      let attempts = 0;
      mockNetwork.fetch.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return {
          ok: true,
          json: async () => ({ highlights: [] })
        };
      });

      const result = await plugin.syncHighlights();
      
      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('should handle malformed API responses', async () => {
      await plugin.onload(mockContext);
      
      mockNetwork.fetch.mockResolvedValue({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); }
      });

      const result = await plugin.syncHighlights();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid response');
    });
  });

  describe('Permission Checks', () => {
    it('should verify required permissions on load', async () => {
      const limitedContext = {
        ...mockContext,
        manifest: {
          ...mockContext.manifest,
          permissions: ['vault.read'] // Missing required permissions
        }
      };

      await expect(plugin.onload(limitedContext)).rejects.toThrow(
        'Missing required permissions'
      );
    });

    it('should check network permission before API calls', async () => {
      const limitedContext = {
        ...mockContext,
        manifest: {
          ...mockContext.manifest,
          permissions: ['vault.read', 'vault.write', 'settings.store']
        }
      };

      await plugin.onload(limitedContext);
      
      const result = await plugin.syncHighlights();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network permission required');
    });
  });

  describe('Resource Management', () => {
    it('should respect memory limits', async () => {
      await plugin.onload(mockContext);
      
      // Simulate large response
      const largeResponse = {
        highlights: new Array(10000).fill({
          id: 'test',
          text: 'x'.repeat(1000),
          note: 'x'.repeat(1000)
        })
      };

      mockNetwork.fetch.mockResolvedValue({
        ok: true,
        json: async () => largeResponse
      });

      const result = await plugin.syncHighlights();
      
      // Should process in batches
      expect(result.processed).toBeLessThanOrEqual(1000);
      expect(result.batched).toBe(true);
    });

    it('should implement request throttling', async () => {
      await plugin.onload(mockContext);
      
      const startTime = Date.now();
      
      // Make multiple requests
      await Promise.all([
        plugin.syncHighlights(),
        plugin.syncHighlights(),
        plugin.syncHighlights()
      ]);

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should take at least 2 seconds due to throttling
      expect(duration).toBeGreaterThanOrEqual(2000);
    });

    it('should clean up event listeners', async () => {
      await plugin.onload(mockContext);
      
      const listener = vi.fn();
      plugin.addEventListener('sync-complete', listener);
      
      await plugin.onunload();
      
      plugin.emit('sync-complete', {});
      expect(listener).not.toHaveBeenCalled();
    });
  });
});