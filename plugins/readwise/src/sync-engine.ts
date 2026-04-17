// Readwise Sync Engine - Handles all synchronization logic
import type { 
  VaultAPI, 
  WorkspaceAPI, 
  SettingsAPI, 
  NetworkAPI 
} from '@vault/plugin-api';
import type { 
  ReadwiseSettings, 
  ReadwiseExport, 
  ReadwiseHighlight,
  SyncResult,
  SyncProgress 
} from './types';
import { ReadwiseAPI } from './api';
import { FileGenerator } from './file-generator';

interface SyncState {
  cursor?: string;
  interrupted: boolean;
  lastSync?: string;
  processedIds: Set<string>;
  errorCount: number;
}

interface BatchConfig {
  size: number;
  delayMs: number;
  maxMemoryMB: number;
}

export class SyncEngine {
  private vault: VaultAPI;
  private workspace: WorkspaceAPI;
  private settings: SettingsAPI;
  private network: NetworkAPI;
  private config: ReadwiseSettings;
  private api: ReadwiseAPI;
  private fileGenerator: FileGenerator;
  private state: SyncState;
  private cache: Map<string, Set<string>>;
  private interrupted = false;
  private rateLimitUntil = 0;
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL = 100; // ms
  private readonly MAX_RETRIES = 3;
  private readonly BATCH_CONFIG: BatchConfig = {
    size: 10,
    delayMs: 100,
    maxMemoryMB: 50
  };

  constructor(
    vault: VaultAPI,
    workspace: WorkspaceAPI,
    settings: SettingsAPI,
    network: NetworkAPI,
    config: ReadwiseSettings
  ) {
    this.vault = vault;
    this.workspace = workspace;
    this.settings = settings;
    this.network = network;
    this.config = config;
    this.api = new ReadwiseAPI(network, config.apiToken);
    this.fileGenerator = new FileGenerator(vault, config);
    this.state = {
      interrupted: false,
      processedIds: new Set(),
      errorCount: 0
    };
    this.cache = new Map();
  }

  async sync(incremental = false): Promise<SyncResult> {
    const progressId = await this.workspace.showProgress('Initializing Readwise sync...');
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      processed: 0,
      failed: 0,
      skipped: 0,
      newHighlights: 0,
      updatedHighlights: 0,
      deletedHighlights: 0,
      errors: [],
      retries: 0,
      batched: false,
      batchCount: 0
    };

    try {
      // Check authentication
      if (!this.config.apiToken) {
        throw new Error('Authentication failed: No API token configured');
      }

      // Load sync state
      await this.loadSyncState();

      // Emit starting progress
      await this.emitProgress({
        status: 'fetching',
        message: 'Fetching highlights from Readwise...',
        current: 0,
        total: 0
      });

      // Fetch exports with pagination
      const exports = await this.fetchExportsWithPagination(incremental, result);

      if (exports.length === 0) {
        await this.workspace.showNotice('No highlights to sync', 'info');
        result.success = true;
        return result;
      }

      // Process exports in batches
      result.batched = exports.length > this.BATCH_CONFIG.size;
      await this.processExportsInBatches(exports, result, progressId);

      // Save sync state
      await this.saveSyncState();

      // Update settings with last sync info
      await this.settings.set('readwise-settings', {
        ...this.config,
        lastSync: new Date().toISOString(),
        lastSyncCount: result.processed
      });

      result.success = true;

      // Emit completion
      await this.emitProgress({
        status: 'complete',
        message: `Synced ${result.processed} highlights`,
        processed: result.processed,
        failed: result.failed,
        duration: Date.now() - startTime
      });

      await this.workspace.showNotice(
        `✓ Synced ${result.processed} highlights from ${exports.length} sources`,
        'success'
      );

    } catch (error: any) {
      console.error('Sync failed:', error);
      result.error = error.message;
      
      if (error.status === 401) {
        result.error = 'Authentication failed: Invalid API token';
        await this.workspace.showNotice(result.error, 'error');
      } else if (error.status === 429) {
        this.handleRateLimit(error);
        result.error = 'Rate limited. Please try again later.';
        await this.workspace.showNotice(result.error, 'warning');
      } else {
        await this.workspace.showNotice(`Sync failed: ${error.message}`, 'error');
      }

      await this.emitProgress({
        status: 'error',
        message: result.error,
        error: error
      });

    } finally {
      await this.workspace.hideProgress(progressId);
    }

    return result;
  }

  private async fetchExportsWithPagination(
    incremental: boolean,
    result: SyncResult
  ): Promise<ReadwiseExport[]> {
    const exports: ReadwiseExport[] = [];
    let cursor = this.state.cursor;
    let updatedAfter: string | undefined;

    if (incremental && this.config.lastSync) {
      updatedAfter = this.config.lastSync;
    }

    do {
      // Apply rate limiting
      await this.applyRateLimit();

      // Fetch with retry logic
      const response = await this.fetchWithRetry(
        async () => {
          const params = new URLSearchParams();
          if (updatedAfter) params.append('updatedAfter', updatedAfter);
          if (cursor) params.append('pageCursor', cursor);

          const url = `https://readwise.io/api/v2/export?${params.toString()}`;
          return await this.network.fetch(url, {
            headers: {
              'Authorization': `Token ${this.config.apiToken}`
            }
          });
        },
        result
      );

      if (!response.ok) {
        const error: any = new Error(`API request failed: ${response.status}`);
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }

      const data = await response.json();
      
      if (data.results && Array.isArray(data.results)) {
        exports.push(...data.results);
      }

      cursor = data.nextPageCursor || null;
      this.state.cursor = cursor;

      // Check for interruption
      if (this.interrupted) {
        this.state.interrupted = true;
        break;
      }

    } while (cursor);

    return exports;
  }

  private async fetchWithRetry(
    fetchFn: () => Promise<Response>,
    result: SyncResult
  ): Promise<Response> {
    let lastError;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await fetchFn();
      } catch (error: any) {
        lastError = error;
        result.retries++;

        // Don't retry on auth errors
        if (error.status === 401) {
          throw error;
        }

        // Handle rate limits
        if (error.status === 429) {
          const retryAfter = parseInt(error.headers?.['Retry-After'] || '60');
          await this.delay(retryAfter * 1000);
          continue;
        }

        // Exponential backoff for other errors
        if (attempt < this.MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          await this.delay(delay);
        }
      }
    }

    throw lastError || new Error('Failed to fetch after retries');
  }

  private async processExportsInBatches(
    exports: ReadwiseExport[],
    result: SyncResult,
    progressId: string
  ): Promise<void> {
    const totalCount = exports.length;
    let processedCount = 0;

    for (let i = 0; i < exports.length; i += this.BATCH_CONFIG.size) {
      const batch = exports.slice(i, Math.min(i + this.BATCH_CONFIG.size, exports.length));
      result.batchCount++;

      for (const exp of batch) {
        try {
          // Update progress
          processedCount++;
          await this.emitProgress({
            status: 'processing',
            current: processedCount,
            total: totalCount,
            currentBook: exp.title,
            message: `Processing ${exp.title}...`
          });

          // Process export
          const processResult = await this.processExport(exp);
          
          result.processed += processResult.processed;
          result.skipped += processResult.skipped;
          result.newHighlights += processResult.new;
          result.updatedHighlights += processResult.updated;
          
        } catch (error: any) {
          console.error(`Failed to process ${exp.title}:`, error);
          result.failed++;
          result.errors = result.errors || [];
          result.errors.push(`${exp.title}: ${error.message}`);
        }

        // Check memory usage
        if (this.shouldYieldForMemory()) {
          await this.cleanupMemory();
        }
      }

      // Yield to UI between batches
      if (i + this.BATCH_CONFIG.size < exports.length) {
        await this.delay(this.BATCH_CONFIG.delayMs);
      }

      // Check for interruption
      if (this.interrupted) {
        break;
      }
    }
  }

  private async processExport(exp: ReadwiseExport): Promise<{
    processed: number;
    skipped: number;
    new: number;
    updated: number;
  }> {
    const result = {
      processed: 0,
      skipped: 0,
      new: 0,
      updated: 0
    };

    const filePath = this.getFilePath(exp);
    const existingContent = await this.getExistingContent(filePath);
    const existingHashes = this.extractExistingHashes(existingContent);

    // Filter highlights
    const newHighlights: ReadwiseHighlight[] = [];
    
    for (const highlight of exp.highlights) {
      const hash = this.generateContentHash(highlight);
      
      if (existingHashes.has(hash) || this.state.processedIds.has(hash)) {
        result.skipped++;
        continue;
      }

      if (!this.config.includeSupplementals && this.isSupplemental(highlight)) {
        result.skipped++;
        continue;
      }

      newHighlights.push(highlight);
      this.state.processedIds.add(hash);
      result.new++;
    }

    // Generate and write file if there are new highlights
    if (newHighlights.length > 0) {
      const exportWithNewHighlights = { ...exp, highlights: newHighlights };
      await this.fileGenerator.generateFile(exportWithNewHighlights);
      result.processed = newHighlights.length;
    }

    // Cache the file's hashes
    this.cache.set(filePath, new Set([...existingHashes, ...newHighlights.map(h => this.generateContentHash(h))]));

    return result;
  }

  generateContentHash(highlight: any): string {
    const content = `${highlight.text || ''}|${highlight.note || ''}|${highlight.location || ''}`;
    // Simple hash function for browser environment
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(16, '0').substring(0, 16);
  }

  isDuplicateHighlight(h1: any, h2: any): boolean {
    return this.generateContentHash(h1) === this.generateContentHash(h2);
  }

  private extractExistingHashes(content: string): Set<string> {
    const hashes = new Set<string>();
    
    // Extract readwise IDs
    const idRegex = /<!-- readwise-id: (\d+) -->/g;
    let match;
    while ((match = idRegex.exec(content)) !== null) {
      hashes.add(`id-${match[1]}`);
    }

    // Extract content hashes
    const hashRegex = /<!-- readwise-hash: ([a-f0-9]+) -->/g;
    while ((match = hashRegex.exec(content)) !== null) {
      hashes.add(match[1]);
    }

    return hashes;
  }

  private async getExistingContent(filePath: string): Promise<string> {
    // Check cache first
    if (this.cache.has(filePath)) {
      return ''; // We have the hashes cached, no need to read
    }

    try {
      if (await this.vault.exists(filePath)) {
        return await this.vault.read(filePath);
      }
    } catch (error) {
      console.error(`Failed to read ${filePath}:`, error);
    }

    return '';
  }

  private getFilePath(exp: ReadwiseExport): string {
    const folder = this.config.highlightsFolder;
    const filename = this.sanitizeFilename(exp.title);
    
    let subfolder = '';
    switch (this.config.groupBy) {
      case 'article':
        subfolder = exp.category === 'articles' ? 'Articles' : 'Books';
        break;
      case 'category':
        subfolder = exp.category || 'Uncategorized';
        break;
      case 'date':
        const date = new Date();
        subfolder = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
    }

    return subfolder 
      ? `${folder}/${subfolder}/${filename}.md`
      : `${folder}/${filename}.md`;
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }

  private isSupplemental(highlight: ReadwiseHighlight): boolean {
    return (highlight.note?.startsWith('.h ') || 
            highlight.note?.startsWith('.c ') ||
            highlight.location_type === 'supplemental') ?? false;
  }

  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Check if we're still rate limited
    if (this.rateLimitUntil > now) {
      await this.delay(this.rateLimitUntil - now);
    }

    // Ensure minimum interval between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      await this.delay(this.MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  private handleRateLimit(error: any): void {
    const retryAfter = parseInt(error.headers?.['Retry-After'] || '60');
    this.rateLimitUntil = Date.now() + (retryAfter * 1000);
  }

  private shouldYieldForMemory(): boolean {
    const used = process.memoryUsage();
    const heapUsedMB = used.heapUsed / 1024 / 1024;
    return heapUsedMB > this.BATCH_CONFIG.maxMemoryMB;
  }

  private async cleanupMemory(): Promise<void> {
    // Clear old cache entries
    if (this.cache.size > 100) {
      const entriesToKeep = 50;
      const entries = Array.from(this.cache.entries());
      this.cache = new Map(entries.slice(-entriesToKeep));
    }

    // Clear processed IDs if too large
    if (this.state.processedIds.size > 10000) {
      this.state.processedIds.clear();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Yield to event loop
    await this.delay(10);
  }

  private async emitProgress(progress: SyncProgress): Promise<void> {
    await this.workspace.emit('sync-progress', progress);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async loadSyncState(): Promise<void> {
    try {
      const saved = await this.settings.get('readwise-sync-state');
      if (saved) {
        this.state = {
          ...this.state,
          cursor: saved.cursor,
          lastSync: saved.lastSync,
          processedIds: new Set(saved.processedIds || []),
          errorCount: saved.errorCount || 0
        };
      }
    } catch (error) {
      console.error('Failed to load sync state:', error);
    }
  }

  async saveSyncState(): Promise<void> {
    try {
      await this.settings.set('readwise-sync-state', {
        cursor: this.state.cursor,
        lastSync: new Date().toISOString(),
        processedIds: Array.from(this.state.processedIds),
        errorCount: this.state.errorCount,
        interrupted: this.state.interrupted
      });
    } catch (error) {
      console.error('Failed to save sync state:', error);
    }
  }

  async getSyncState(): Promise<SyncState> {
    return { ...this.state };
  }

  interrupt(): void {
    this.interrupted = true;
    this.state.interrupted = true;
  }

  resume(): void {
    this.interrupted = false;
    this.state.interrupted = false;
  }
}