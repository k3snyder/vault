// Background Sync Tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackgroundSyncManager } from './background-sync';
import type { SyncEngine } from './sync-engine';
import type { WorkspaceAPI, SettingsAPI } from '@vault/plugin-api';
import type { ReadwiseSettings, SyncResult } from './types';

// Mock SyncEngine
const mockSyncEngine: SyncEngine = {
  sync: vi.fn(),
  getSyncState: vi.fn(),
  interrupt: vi.fn(),
  resume: vi.fn(),
  generateContentHash: vi.fn(),
  isDuplicateHighlight: vi.fn(),
  loadSyncState: vi.fn(),
  saveSyncState: vi.fn()
} as any;

// Mock APIs
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

const defaultSettings: ReadwiseSettings = {
  apiToken: 'test-token',
  syncFrequency: 60, // minutes
  autoSync: true,
  syncOnStartup: false,
  highlightsFolder: 'Readwise',
  dateFormat: 'YYYY-MM-DD',
  groupBy: 'book',
  appendToExisting: true,
  includeSupplementals: true
};

describe('BackgroundSyncManager', () => {
  let syncManager: BackgroundSyncManager;
  let dateNowSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000000000000);
    
    syncManager = new BackgroundSyncManager(
      mockSyncEngine,
      mockWorkspace,
      mockSettings,
      defaultSettings
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    syncManager.stop();
  });

  describe('Periodic Sync', () => {
    it('should schedule sync at configured intervals', async () => {
      await syncManager.start();

      // Fast-forward time by sync frequency
      vi.advanceTimersByTime(60 * 60 * 1000); // 60 minutes

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);

      // Fast-forward again
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(2);
    });

    it('should update interval when frequency changes', async () => {
      await syncManager.start();

      // Change frequency to 30 minutes
      await syncManager.updateSettings({
        ...defaultSettings,
        syncFrequency: 30
      });

      vi.clearAllMocks();

      // Fast-forward 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('should stop sync when auto-sync disabled', async () => {
      await syncManager.start();

      await syncManager.updateSettings({
        ...defaultSettings,
        autoSync: false
      });

      vi.clearAllMocks();

      // Fast-forward time
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(mockSyncEngine.sync).not.toHaveBeenCalled();
    });

    it('should handle sync failures gracefully', async () => {
      mockSyncEngine.sync.mockRejectedValue(new Error('Sync failed'));

      await syncManager.start();

      vi.advanceTimersByTime(60 * 60 * 1000);

      // Wait for async operations
      await vi.runAllTimersAsync();

      expect(mockWorkspace.showNotice).toHaveBeenCalledWith(
        expect.stringContaining('Background sync failed'),
        'error'
      );

      // Should continue scheduling
      vi.advanceTimersByTime(60 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(2);
    });
  });

  describe('Sync on Startup', () => {
    it('should sync on startup when enabled', async () => {
      const settings = {
        ...defaultSettings,
        syncOnStartup: true
      };

      syncManager = new BackgroundSyncManager(
        mockSyncEngine,
        mockWorkspace,
        mockSettings,
        settings
      );

      await syncManager.start();

      // Should trigger immediate sync
      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('should delay startup sync to avoid overload', async () => {
      const settings = {
        ...defaultSettings,
        syncOnStartup: true
      };

      syncManager = new BackgroundSyncManager(
        mockSyncEngine,
        mockWorkspace,
        mockSettings,
        settings
      );

      await syncManager.start();

      // Initial call should be scheduled, not immediate
      expect(mockSyncEngine.sync).not.toHaveBeenCalled();

      // Fast-forward startup delay (5 seconds)
      vi.advanceTimersByTime(5000);

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('should not sync on startup when disabled', async () => {
      await syncManager.start();

      vi.advanceTimersByTime(5000);

      expect(mockSyncEngine.sync).not.toHaveBeenCalled();
    });
  });

  describe('Sync Status Management', () => {
    it('should track sync status', async () => {
      const syncResult: SyncResult = {
        success: true,
        processed: 10,
        newHighlights: 5
      };

      mockSyncEngine.sync.mockResolvedValue(syncResult);

      await syncManager.start();
      await syncManager.triggerSync();

      const status = syncManager.getStatus();

      expect(status.lastSync).toBeDefined();
      expect(status.lastResult).toEqual(syncResult);
      expect(status.isRunning).toBe(false);
      expect(status.nextSync).toBeDefined();
    });

    it('should update status indicator during sync', async () => {
      mockSyncEngine.sync.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { success: true, processed: 5 };
      });

      await syncManager.start();
      const syncPromise = syncManager.triggerSync();

      expect(syncManager.getStatus().isRunning).toBe(true);

      await syncPromise;

      expect(syncManager.getStatus().isRunning).toBe(false);
    });

    it('should emit status events', async () => {
      await syncManager.start();
      await syncManager.triggerSync();

      expect(mockWorkspace.emit).toHaveBeenCalledWith(
        'readwise-sync-status',
        expect.objectContaining({
          isRunning: expect.any(Boolean),
          lastSync: expect.any(Number)
        })
      );
    });

    it('should show progress during manual sync', async () => {
      mockWorkspace.showProgress.mockResolvedValue('progress-123');

      await syncManager.triggerSync(true);

      expect(mockWorkspace.showProgress).toHaveBeenCalledWith(
        expect.stringContaining('Syncing Readwise')
      );
      expect(mockWorkspace.hideProgress).toHaveBeenCalledWith('progress-123');
    });
  });

  describe('Resource Throttling', () => {
    it('should respect minimum interval between syncs', async () => {
      await syncManager.start();

      // Trigger multiple syncs rapidly
      await syncManager.triggerSync();
      await syncManager.triggerSync();
      await syncManager.triggerSync();

      // Only first should execute immediately
      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('should queue sync if one is running', async () => {
      let resolveSync: any;
      mockSyncEngine.sync.mockImplementation(() => 
        new Promise(resolve => { resolveSync = resolve; })
      );

      await syncManager.start();

      // Start first sync
      const sync1 = syncManager.triggerSync();

      // Try to start second sync
      const sync2 = syncManager.triggerSync();

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);

      // Resolve first sync
      resolveSync({ success: true });
      await sync1;

      // Second sync should now execute
      resolveSync({ success: true });
      await sync2;

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(2);
    });

    it('should implement exponential backoff on failures', async () => {
      mockSyncEngine.sync
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce({ success: true });

      await syncManager.start();

      // First attempt
      vi.advanceTimersByTime(60 * 60 * 1000);
      await vi.runAllTimersAsync();

      // Second attempt (with backoff)
      vi.advanceTimersByTime(2 * 60 * 1000); // 2 min backoff
      await vi.runAllTimersAsync();

      // Third attempt (with longer backoff)
      vi.advanceTimersByTime(4 * 60 * 1000); // 4 min backoff
      await vi.runAllTimersAsync();

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(3);
    });

    it('should respect API rate limits', async () => {
      const rateLimitError: any = new Error('Rate limited');
      rateLimitError.status = 429;
      rateLimitError.retryAfter = 120; // 2 minutes

      mockSyncEngine.sync.mockRejectedValueOnce(rateLimitError);

      await syncManager.start();
      await syncManager.triggerSync();

      // Should wait for rate limit period
      const status = syncManager.getStatus();
      expect(status.rateLimitedUntil).toBeDefined();

      // Try sync before rate limit expires
      await syncManager.triggerSync();
      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);

      // Fast-forward past rate limit
      vi.advanceTimersByTime(120 * 1000);

      await syncManager.triggerSync();
      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(2);
    });
  });

  describe('Conflict Resolution', () => {
    it('should detect concurrent modifications', async () => {
      const syncState = {
        lastSync: '2025-01-01T00:00:00Z',
        localModified: '2025-01-01T01:00:00Z',
        remoteModified: '2025-01-01T02:00:00Z'
      };

      mockSyncEngine.getSyncState.mockResolvedValue(syncState);

      const hasConflict = await syncManager.checkForConflicts();

      expect(hasConflict).toBe(true);
    });

    it('should resolve conflicts based on strategy', async () => {
      syncManager.setConflictStrategy('local-first');

      await syncManager.resolveConflict({
        localVersion: { text: 'Local text' },
        remoteVersion: { text: 'Remote text' }
      });

      expect(mockSettings.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ text: 'Local text' })
      );
    });

    it('should prompt user for conflict resolution', async () => {
      syncManager.setConflictStrategy('ask');

      const resolvePromise = syncManager.resolveConflict({
        localVersion: { text: 'Local' },
        remoteVersion: { text: 'Remote' }
      });

      expect(mockWorkspace.emit).toHaveBeenCalledWith(
        'readwise-conflict',
        expect.any(Object)
      );

      // Simulate user choice
      syncManager.handleConflictResolution('remote');

      await resolvePromise;

      expect(mockSettings.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ text: 'Remote' })
      );
    });
  });

  describe('Sync History', () => {
    it('should log sync history', async () => {
      const result: SyncResult = {
        success: true,
        processed: 10,
        newHighlights: 5
      };

      mockSyncEngine.sync.mockResolvedValue(result);

      await syncManager.start();
      await syncManager.triggerSync();

      const history = await syncManager.getSyncHistory();

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        timestamp: expect.any(Number),
        result,
        duration: expect.any(Number),
        trigger: 'manual'
      });
    });

    it('should limit history size', async () => {
      mockSyncEngine.sync.mockResolvedValue({ success: true });

      await syncManager.start();

      // Trigger many syncs
      for (let i = 0; i < 150; i++) {
        await syncManager.triggerSync();
      }

      const history = await syncManager.getSyncHistory();

      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should persist history across sessions', async () => {
      const savedHistory = [
        {
          timestamp: Date.now() - 86400000,
          result: { success: true, processed: 5 },
          duration: 1000,
          trigger: 'scheduled'
        }
      ];

      mockSettings.get.mockResolvedValue(savedHistory);

      await syncManager.loadHistory();

      const history = await syncManager.getSyncHistory();

      expect(history).toEqual(savedHistory);
    });

    it('should calculate sync statistics', async () => {
      const history = [
        { result: { success: true, processed: 10 }, duration: 1000 },
        { result: { success: true, processed: 20 }, duration: 2000 },
        { result: { success: false }, duration: 500 }
      ];

      mockSettings.get.mockResolvedValue(history);
      await syncManager.loadHistory();

      const stats = syncManager.getStatistics();

      expect(stats).toMatchObject({
        totalSyncs: 3,
        successfulSyncs: 2,
        failedSyncs: 1,
        totalHighlights: 30,
        averageDuration: 1166.67,
        successRate: 0.67
      });
    });
  });

  describe('Lifecycle Management', () => {
    it('should clean up resources on stop', async () => {
      await syncManager.start();

      vi.advanceTimersByTime(30 * 60 * 1000);

      await syncManager.stop();

      // Clear mocks to check no further calls
      vi.clearAllMocks();

      // Advance time - should not trigger sync
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(mockSyncEngine.sync).not.toHaveBeenCalled();
    });

    it('should interrupt running sync on stop', async () => {
      let resolveSync: any;
      mockSyncEngine.sync.mockImplementation(() =>
        new Promise(resolve => { resolveSync = resolve; })
      );

      await syncManager.start();

      // Start a sync
      const syncPromise = syncManager.triggerSync();

      // Stop manager
      await syncManager.stop();

      expect(mockSyncEngine.interrupt).toHaveBeenCalled();

      // Resolve the sync
      resolveSync({ success: false, error: 'Interrupted' });

      await syncPromise;
    });

    it('should save state on pause', async () => {
      await syncManager.start();
      await syncManager.pause();

      expect(mockSettings.set).toHaveBeenCalledWith(
        'readwise-background-sync-state',
        expect.objectContaining({
          paused: true,
          lastSync: expect.any(Number)
        })
      );
    });

    it('should resume from saved state', async () => {
      mockSettings.get.mockResolvedValue({
        paused: false,
        lastSync: Date.now() - 30 * 60 * 1000, // 30 min ago
        nextSync: Date.now() + 30 * 60 * 1000  // 30 min from now
      });

      await syncManager.start();

      // Should schedule next sync for saved time
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockSyncEngine.sync).toHaveBeenCalledTimes(1);
    });
  });
});