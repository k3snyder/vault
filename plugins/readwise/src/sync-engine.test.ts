// Readwise Sync Engine Tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncEngine } from './sync-engine';
import type { 
  VaultAPI, 
  WorkspaceAPI, 
  SettingsAPI, 
  NetworkAPI 
} from '@vault/plugin-api';
import type { ReadwiseSettings, ReadwiseExport } from './types';

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

const defaultSettings: ReadwiseSettings = {
  apiToken: 'test-token',
  syncFrequency: 60,
  autoSync: false,
  syncOnStartup: false,
  highlightsFolder: 'Readwise',
  dateFormat: 'YYYY-MM-DD',
  groupBy: 'book',
  appendToExisting: true,
  includeSupplementals: true
};

describe('SyncEngine', () => {
  let syncEngine: SyncEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    syncEngine = new SyncEngine(
      mockVault,
      mockWorkspace,
      mockSettings,
      mockNetwork,
      defaultSettings
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Incremental Sync', () => {
    it('should use cursor-based pagination for large datasets', async () => {
      const page1: ReadwiseExport[] = Array(100).fill(null).map((_, i) => ({
        user_book_id: i,
        title: `Book ${i}`,
        highlights: []
      }));

      const page2: ReadwiseExport[] = Array(50).fill(null).map((_, i) => ({
        user_book_id: i + 100,
        title: `Book ${i + 100}`,
        highlights: []
      }));

      mockNetwork.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: page1,
            nextPageCursor: 'cursor-123'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: page2,
            nextPageCursor: null
          })
        });

      const result = await syncEngine.sync();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(150);
      expect(mockNetwork.fetch).toHaveBeenCalledTimes(2);
      expect(mockNetwork.fetch).toHaveBeenCalledWith(
        expect.stringContaining('pageCursor=cursor-123'),
        expect.any(Object)
      );
    });

    it('should sync only new highlights when incremental flag is set', async () => {
      const lastSync = '2025-01-01T00:00:00Z';
      mockSettings.get.mockResolvedValue({ lastSync });

      const newHighlights: ReadwiseExport[] = [{
        user_book_id: 1,
        title: 'New Book',
        highlights: [
          { id: 1, text: 'New highlight', updated: '2025-01-02T00:00:00Z' }
        ]
      }];

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: newHighlights,
          nextPageCursor: null
        })
      });

      const result = await syncEngine.sync(true);

      expect(result.success).toBe(true);
      expect(result.newHighlights).toBe(1);
      expect(mockNetwork.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`updatedAfter=${lastSync}`),
        expect.any(Object)
      );
    });

    it('should track sync cursor for resume capability', async () => {
      const exports: ReadwiseExport[] = [{
        user_book_id: 1,
        title: 'Book 1',
        highlights: []
      }];

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: 'cursor-456'
        })
      });

      // Simulate interruption
      syncEngine.interrupt();

      const state = await syncEngine.getSyncState();
      expect(state.cursor).toBe('cursor-456');
      expect(state.interrupted).toBe(true);
    });
  });

  describe('Idempotency and Duplicate Detection', () => {
    it('should detect duplicate highlights using content hash', async () => {
      const highlight1 = {
        id: 1,
        text: 'This is a highlight',
        note: 'My note',
        location: 100
      };

      const highlight2 = {
        id: 2,
        text: 'This is a highlight', // Same text
        note: 'My note', // Same note
        location: 100 // Same location
      };

      const isDuplicate = syncEngine.isDuplicateHighlight(highlight1, highlight2);
      expect(isDuplicate).toBe(true);
    });

    it('should skip already synced highlights', async () => {
      const existingContent = `
# Book Title
## Highlights
<!-- readwise-id: 123 -->
> Existing highlight
<!-- readwise-hash: abc123def456 -->
      `;

      mockVault.exists.mockResolvedValue(true);
      mockVault.read.mockResolvedValue(existingContent);

      const exports: ReadwiseExport[] = [{
        user_book_id: 1,
        title: 'Book Title',
        highlights: [
          { id: 123, text: 'Existing highlight' }, // Should skip
          { id: 124, text: 'New highlight' } // Should process
        ]
      }];

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      const result = await syncEngine.sync();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(1); // Only new highlight
      expect(result.skipped).toBe(1); // Existing highlight skipped
    });

    it('should handle content hash collisions gracefully', async () => {
      const highlight1 = {
        id: 1,
        text: 'Text A',
        note: 'Note A'
      };

      const highlight2 = {
        id: 2,
        text: 'Text B',
        note: 'Note B'
      };

      // Even if hashes collide (unlikely), IDs should differentiate
      const hash1 = syncEngine.generateContentHash(highlight1);
      const hash2 = syncEngine.generateContentHash(highlight2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Batch Processing', () => {
    it('should process large datasets in batches', async () => {
      const largeExport: ReadwiseExport = {
        user_book_id: 1,
        title: 'Large Book',
        highlights: Array(1000).fill(null).map((_, i) => ({
          id: i,
          text: `Highlight ${i}`
        }))
      };

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [largeExport],
          nextPageCursor: null
        })
      });

      const result = await syncEngine.sync();

      expect(result.success).toBe(true);
      expect(result.batched).toBe(true);
      expect(result.batchCount).toBeGreaterThan(1);
    });

    it('should yield to UI between batches', async () => {
      const yieldSpy = vi.spyOn(global, 'setTimeout');

      const exports: ReadwiseExport[] = Array(20).fill(null).map((_, i) => ({
        user_book_id: i,
        title: `Book ${i}`,
        highlights: Array(50).fill(null).map((_, j) => ({
          id: i * 50 + j,
          text: `Highlight ${j}`
        }))
      }));

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      await syncEngine.sync();

      // Should have yielded between batches
      expect(yieldSpy).toHaveBeenCalled();
    });

    it('should maintain progress during batch processing', async () => {
      const progressUpdates: any[] = [];
      mockWorkspace.emit.mockImplementation(async (event, data) => {
        if (event === 'sync-progress') {
          progressUpdates.push(data);
        }
      });

      const exports: ReadwiseExport[] = Array(10).fill(null).map((_, i) => ({
        user_book_id: i,
        title: `Book ${i}`,
        highlights: []
      }));

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      await syncEngine.sync();

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1].status).toBe('complete');
    });
  });

  describe('Error Handling and Retry Logic', () => {
    it('should retry with exponential backoff on network errors', async () => {
      let attempts = 0;
      mockNetwork.fetch.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
        return {
          ok: true,
          json: async () => ({
            results: [],
            nextPageCursor: null
          })
        };
      });

      const result = await syncEngine.sync();

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
      expect(result.retries).toBe(2);
    });

    it('should respect rate limits and retry after delay', async () => {
      mockNetwork.fetch
        .mockRejectedValueOnce({
          status: 429,
          headers: { 'Retry-After': '2' }
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [],
            nextPageCursor: null
          })
        });

      const start = Date.now();
      const result = await syncEngine.sync();
      const duration = Date.now() - start;

      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(2000);
    });

    it('should handle partial failures gracefully', async () => {
      const exports: ReadwiseExport[] = [
        { user_book_id: 1, title: 'Book 1', highlights: [] },
        { user_book_id: 2, title: 'Book 2', highlights: [] },
        { user_book_id: 3, title: 'Book 3', highlights: [] }
      ];

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      // Simulate failure on second book
      let writeCount = 0;
      mockVault.write.mockImplementation(async () => {
        writeCount++;
        if (writeCount === 2) {
          throw new Error('Write failed');
        }
      });

      const result = await syncEngine.sync();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toContain('Book 2');
    });

    it('should not retry on authentication errors', async () => {
      mockNetwork.fetch.mockRejectedValue({
        status: 401,
        message: 'Unauthorized'
      });

      const result = await syncEngine.sync();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
      expect(mockNetwork.fetch).toHaveBeenCalledTimes(1); // No retry
    });
  });

  describe('Progress Notifications', () => {
    it('should emit detailed progress updates', async () => {
      const progressEvents: any[] = [];
      mockWorkspace.emit.mockImplementation(async (event, data) => {
        if (event === 'sync-progress') {
          progressEvents.push(data);
        }
      });

      const exports: ReadwiseExport[] = [
        { user_book_id: 1, title: 'Book 1', highlights: [] },
        { user_book_id: 2, title: 'Book 2', highlights: [] }
      ];

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      await syncEngine.sync();

      expect(progressEvents).toContainEqual(
        expect.objectContaining({
          status: 'fetching',
          message: expect.stringContaining('Fetching')
        })
      );

      expect(progressEvents).toContainEqual(
        expect.objectContaining({
          status: 'processing',
          current: 1,
          total: 2,
          currentBook: 'Book 1'
        })
      );

      expect(progressEvents).toContainEqual(
        expect.objectContaining({
          status: 'complete',
          processed: 2
        })
      );
    });

    it('should show progress bar updates', async () => {
      mockWorkspace.showProgress.mockResolvedValue('progress-123');

      const exports: ReadwiseExport[] = Array(100).fill(null).map((_, i) => ({
        user_book_id: i,
        title: `Book ${i}`,
        highlights: []
      }));

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      await syncEngine.sync();

      expect(mockWorkspace.showProgress).toHaveBeenCalled();
      expect(mockWorkspace.hideProgress).toHaveBeenCalledWith('progress-123');
    });
  });

  describe('Performance Optimizations', () => {
    it('should cache frequently accessed data', async () => {
      const exports: ReadwiseExport[] = [{
        user_book_id: 1,
        title: 'Book 1',
        highlights: Array(100).fill(null).map((_, i) => ({
          id: i,
          text: `Highlight ${i}`
        }))
      }];

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: exports,
          nextPageCursor: null
        })
      });

      // First sync
      await syncEngine.sync();

      // Second sync should use cache for duplicate detection
      mockVault.read.mockClear();
      await syncEngine.sync();

      expect(mockVault.read).toHaveBeenCalledTimes(0); // Used cache
    });

    it('should throttle API requests', async () => {
      const requestTimes: number[] = [];
      mockNetwork.fetch.mockImplementation(async () => {
        requestTimes.push(Date.now());
        return {
          ok: true,
          json: async () => ({
            results: [],
            nextPageCursor: requestTimes.length < 3 ? `cursor-${requestTimes.length}` : null
          })
        };
      });

      await syncEngine.sync();

      // Check that requests are throttled
      for (let i = 1; i < requestTimes.length; i++) {
        const timeDiff = requestTimes[i] - requestTimes[i - 1];
        expect(timeDiff).toBeGreaterThanOrEqual(100); // Min 100ms between requests
      }
    });

    it('should optimize memory usage for large datasets', async () => {
      const hugeExport: ReadwiseExport = {
        user_book_id: 1,
        title: 'Huge Book',
        highlights: Array(10000).fill(null).map((_, i) => ({
          id: i,
          text: `Highlight ${i}`.repeat(100) // Large text
        }))
      };

      mockNetwork.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [hugeExport],
          nextPageCursor: null
        })
      });

      const memoryBefore = process.memoryUsage().heapUsed;
      await syncEngine.sync();
      const memoryAfter = process.memoryUsage().heapUsed;

      // Memory increase should be reasonable (less than 100MB)
      expect(memoryAfter - memoryBefore).toBeLessThan(100 * 1024 * 1024);
    });
  });
});