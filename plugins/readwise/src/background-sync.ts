// Background Sync Manager - Handles scheduled synchronization
import type { WorkspaceAPI, SettingsAPI } from '@vault/plugin-api';
import type { ReadwiseSettings, SyncResult } from './types';
import type { SyncEngine } from './sync-engine';

interface SyncStatus {
  isRunning: boolean;
  lastSync?: number;
  nextSync?: number;
  lastResult?: SyncResult;
  rateLimitedUntil?: number;
  failureCount: number;
}

interface SyncHistoryEntry {
  timestamp: number;
  result: SyncResult;
  duration: number;
  trigger: 'manual' | 'scheduled' | 'startup';
}

interface SyncStatistics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalHighlights: number;
  averageDuration: number;
  successRate: number;
}

type ConflictStrategy = 'local-first' | 'remote-first' | 'ask';

export class BackgroundSyncManager {
  private syncEngine: SyncEngine;
  private workspace: WorkspaceAPI;
  private settings: SettingsAPI;
  private config: ReadwiseSettings;
  private syncTimer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;
  private status: SyncStatus;
  private history: SyncHistoryEntry[] = [];
  private conflictStrategy: ConflictStrategy = 'ask';
  private syncQueue: Promise<SyncResult> | null = null;
  private backoffMultiplier = 1;
  private readonly MAX_HISTORY = 100;
  private readonly MIN_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly STARTUP_DELAY = 5000; // 5 seconds
  private readonly MAX_BACKOFF = 8; // Max 8x backoff

  constructor(
    syncEngine: SyncEngine,
    workspace: WorkspaceAPI,
    settings: SettingsAPI,
    config: ReadwiseSettings
  ) {
    this.syncEngine = syncEngine;
    this.workspace = workspace;
    this.settings = settings;
    this.config = config;
    this.status = {
      isRunning: false,
      failureCount: 0
    };
  }

  async start(): Promise<void> {
    await this.loadHistory();
    await this.loadState();

    // Schedule startup sync if enabled
    if (this.config.syncOnStartup && this.config.apiToken) {
      this.scheduleStartupSync();
    }

    // Start periodic sync if enabled
    if (this.config.autoSync && this.config.apiToken) {
      this.scheduleNextSync();
    }

    // Emit initial status
    await this.emitStatus();
  }

  async stop(): Promise<void> {
    // Clear timers
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }

    // Interrupt running sync
    if (this.status.isRunning) {
      this.syncEngine.interrupt();
    }

    // Save state
    await this.saveState();
    await this.saveHistory();
  }

  async pause(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    await this.saveState(true);
  }

  async resume(): Promise<void> {
    await this.loadState();
    
    if (this.config.autoSync && this.config.apiToken) {
      this.scheduleNextSync();
    }
  }

  async updateSettings(settings: ReadwiseSettings): Promise<void> {
    const oldFrequency = this.config.syncFrequency;
    const oldAutoSync = this.config.autoSync;
    
    this.config = settings;

    // Handle auto-sync changes
    if (settings.autoSync !== oldAutoSync) {
      if (settings.autoSync) {
        this.scheduleNextSync();
      } else {
        if (this.syncTimer) {
          clearTimeout(this.syncTimer);
          this.syncTimer = undefined;
        }
      }
    }
    // Handle frequency changes
    else if (settings.syncFrequency !== oldFrequency && settings.autoSync) {
      this.rescheduleSync();
    }
  }

  async triggerSync(showProgress = false): Promise<SyncResult> {
    // Check if we're rate limited
    if (this.status.rateLimitedUntil && Date.now() < this.status.rateLimitedUntil) {
      const waitTime = Math.ceil((this.status.rateLimitedUntil - Date.now()) / 1000);
      await this.workspace.showNotice(
        `Rate limited. Please wait ${waitTime} seconds.`,
        'warning'
      );
      return { success: false, error: 'Rate limited' };
    }

    // Check minimum interval
    if (this.status.lastSync) {
      const timeSinceLastSync = Date.now() - this.status.lastSync;
      if (timeSinceLastSync < this.MIN_SYNC_INTERVAL) {
        const waitTime = Math.ceil((this.MIN_SYNC_INTERVAL - timeSinceLastSync) / 1000);
        await this.workspace.showNotice(
          `Please wait ${waitTime} seconds before syncing again.`,
          'warning'
        );
        return { success: false, error: 'Too soon' };
      }
    }

    // Queue if already running
    if (this.syncQueue) {
      return this.syncQueue;
    }

    // Start sync
    this.syncQueue = this.performSync(showProgress, 'manual');
    
    try {
      return await this.syncQueue;
    } finally {
      this.syncQueue = null;
    }
  }

  private async performSync(
    showProgress: boolean,
    trigger: 'manual' | 'scheduled' | 'startup'
  ): Promise<SyncResult> {
    this.status.isRunning = true;
    await this.emitStatus();

    const startTime = Date.now();
    let progressId: string | undefined;

    if (showProgress) {
      progressId = await this.workspace.showProgress('Syncing Readwise highlights...');
    }

    try {
      const result = await this.syncEngine.sync();
      
      // Record success
      this.status.lastSync = Date.now();
      this.status.lastResult = result;
      this.status.failureCount = 0;
      this.backoffMultiplier = 1;

      // Add to history
      this.addToHistory({
        timestamp: Date.now(),
        result,
        duration: Date.now() - startTime,
        trigger
      });

      // Show notification for scheduled syncs
      if (trigger === 'scheduled' && result.processed && result.processed > 0) {
        await this.workspace.showNotice(
          `Readwise: Synced ${result.processed} highlights`,
          'success'
        );
      }

      return result;

    } catch (error: any) {
      const result: SyncResult = {
        success: false,
        error: error.message
      };

      // Handle rate limiting
      if (error.status === 429) {
        const retryAfter = error.retryAfter || 120;
        this.status.rateLimitedUntil = Date.now() + (retryAfter * 1000);
      }

      // Record failure
      this.status.lastResult = result;
      this.status.failureCount++;
      
      // Increase backoff
      if (this.status.failureCount > 1) {
        this.backoffMultiplier = Math.min(
          this.backoffMultiplier * 2,
          this.MAX_BACKOFF
        );
      }

      // Add to history
      this.addToHistory({
        timestamp: Date.now(),
        result,
        duration: Date.now() - startTime,
        trigger
      });

      // Show error for manual syncs
      if (trigger === 'manual') {
        await this.workspace.showNotice(
          `Sync failed: ${error.message}`,
          'error'
        );
      } else {
        await this.workspace.showNotice(
          'Background sync failed. Will retry later.',
          'error'
        );
      }

      return result;

    } finally {
      this.status.isRunning = false;
      
      if (progressId) {
        await this.workspace.hideProgress(progressId);
      }

      await this.emitStatus();

      // Schedule next sync if auto-sync enabled
      if (this.config.autoSync && trigger !== 'manual') {
        this.scheduleNextSync();
      }
    }
  }

  private scheduleStartupSync(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
    }

    this.startupTimer = setTimeout(async () => {
      await this.performSync(false, 'startup');
    }, this.STARTUP_DELAY);
  }

  private scheduleNextSync(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    // Calculate next sync time with backoff
    const baseInterval = this.config.syncFrequency * 60 * 1000;
    const backoffDelay = this.status.failureCount > 0 
      ? Math.min(this.backoffMultiplier * 2 * 60 * 1000, baseInterval)
      : 0;
    const nextInterval = baseInterval + backoffDelay;

    this.status.nextSync = Date.now() + nextInterval;

    this.syncTimer = setTimeout(async () => {
      await this.performSync(false, 'scheduled');
    }, nextInterval);
  }

  private rescheduleSync(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.scheduleNextSync();
  }

  async checkForConflicts(): Promise<boolean> {
    const state = await this.syncEngine.getSyncState();
    
    if (!state.lastSync) return false;

    // Check if local and remote have been modified since last sync
    const lastSync = new Date(state.lastSync).getTime();
    
    // This is simplified - in reality, you'd check actual file modification times
    return false;
  }

  async resolveConflict(conflict: any): Promise<void> {
    switch (this.conflictStrategy) {
      case 'local-first':
        await this.settings.set('conflict-resolution', conflict.localVersion);
        break;
      
      case 'remote-first':
        await this.settings.set('conflict-resolution', conflict.remoteVersion);
        break;
      
      case 'ask':
        await this.workspace.emit('readwise-conflict', conflict);
        // Wait for user resolution
        break;
    }
  }

  handleConflictResolution(choice: 'local' | 'remote'): void {
    // Handle user's conflict resolution choice
    // This would be called from UI
  }

  setConflictStrategy(strategy: ConflictStrategy): void {
    this.conflictStrategy = strategy;
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  async getSyncHistory(): Promise<SyncHistoryEntry[]> {
    return [...this.history];
  }

  getStatistics(): SyncStatistics {
    if (this.history.length === 0) {
      return {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        totalHighlights: 0,
        averageDuration: 0,
        successRate: 0
      };
    }

    const successful = this.history.filter(h => h.result.success);
    const totalHighlights = successful.reduce(
      (sum, h) => sum + (h.result.processed || 0),
      0
    );
    const totalDuration = this.history.reduce(
      (sum, h) => sum + h.duration,
      0
    );

    return {
      totalSyncs: this.history.length,
      successfulSyncs: successful.length,
      failedSyncs: this.history.length - successful.length,
      totalHighlights,
      averageDuration: Math.round((totalDuration / this.history.length * 100)) / 100,
      successRate: Math.round((successful.length / this.history.length * 100)) / 100
    };
  }

  private addToHistory(entry: SyncHistoryEntry): void {
    this.history.unshift(entry);
    
    // Limit history size
    if (this.history.length > this.MAX_HISTORY) {
      this.history = this.history.slice(0, this.MAX_HISTORY);
    }

    // Save history asynchronously
    this.saveHistory().catch(console.error);
  }

  async loadHistory(): Promise<void> {
    try {
      const saved = await this.settings.get('readwise-sync-history');
      if (saved && Array.isArray(saved)) {
        this.history = saved;
      }
    } catch (error) {
      console.error('Failed to load sync history:', error);
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await this.settings.set('readwise-sync-history', this.history);
    } catch (error) {
      console.error('Failed to save sync history:', error);
    }
  }

  private async loadState(): Promise<void> {
    try {
      const saved = await this.settings.get('readwise-background-sync-state');
      if (saved) {
        if (saved.lastSync) this.status.lastSync = saved.lastSync;
        if (saved.nextSync && saved.nextSync > Date.now()) {
          this.status.nextSync = saved.nextSync;
          // Resume scheduled sync
          const timeUntilNext = saved.nextSync - Date.now();
          if (timeUntilNext > 0 && this.config.autoSync) {
            this.syncTimer = setTimeout(async () => {
              await this.performSync(false, 'scheduled');
            }, timeUntilNext);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load sync state:', error);
    }
  }

  private async saveState(paused = false): Promise<void> {
    try {
      await this.settings.set('readwise-background-sync-state', {
        paused,
        lastSync: this.status.lastSync,
        nextSync: this.status.nextSync,
        failureCount: this.status.failureCount
      });
    } catch (error) {
      console.error('Failed to save sync state:', error);
    }
  }

  private async emitStatus(): Promise<void> {
    await this.workspace.emit('readwise-sync-status', this.status);
  }
}