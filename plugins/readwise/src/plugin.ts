// VaultReadwisePlugin - Main plugin implementation
import type { 
  VaultAPI, 
  WorkspaceAPI, 
  SettingsAPI, 
  NetworkAPI,
  PluginContext,
  Plugin,
  Command,
  StatusBarItem,
  SettingsTab
} from '@vault/plugin-api';
import type { 
  ReadwiseSettings, 
  ReadwiseHighlight, 
  ReadwiseBook, 
  ReadwiseExport,
  SyncResult,
  SyncProgress 
} from './types';
import { ReadwiseAPI } from './api';
import { FileGenerator } from './file-generator';
import { SettingsComponent } from './settings';
import { SyncEngine } from './sync-engine';

const DEFAULT_SETTINGS: ReadwiseSettings = {
  syncFrequency: 60,
  autoSync: false,
  syncOnStartup: false,
  highlightsFolder: 'Readwise',
  dateFormat: 'YYYY-MM-DD',
  groupBy: 'book',
  appendToExisting: true,
  includeSupplementals: true
};

export class VaultReadwisePlugin implements Plugin {
  private context?: PluginContext;
  private settings: ReadwiseSettings = DEFAULT_SETTINGS;
  private api?: ReadwiseAPI;
  private fileGenerator?: FileGenerator;
  private syncEngine?: SyncEngine;
  private syncTimer?: NodeJS.Timeout;
  private statusBarItem?: StatusBarItem;
  private loaded = false;
  private syncing = false;
  private retryAfter = 0;
  private eventListeners = new Map<string, Set<Function>>();

  async onload(context: PluginContext): Promise<void> {
    this.context = context;
    
    // Verify required permissions
    this.verifyPermissions();
    
    // Load settings
    await this.loadSettings();
    
    // Initialize API, file generator, and sync engine
    this.api = new ReadwiseAPI(context.network, this.settings.apiToken);
    this.fileGenerator = new FileGenerator(context.vault, this.settings);
    this.syncEngine = new SyncEngine(
      context.vault,
      context.workspace,
      context.settings,
      context.network,
      this.settings
    );
    
    // Register commands
    await this.registerCommands();
    
    // Register status bar item
    await this.registerStatusBar();
    
    // Register settings tab
    await this.registerSettingsTab();
    
    // Start auto sync if enabled
    if (this.settings.autoSync && this.settings.apiToken) {
      this.startAutoSync();
    }
    
    // Sync on startup if enabled
    if (this.settings.syncOnStartup && this.settings.apiToken) {
      setTimeout(() => this.syncHighlights(), 5000);
    }
    
    this.loaded = true;
  }

  async onunload(): Promise<void> {
    // Stop auto sync
    this.stopAutoSync();
    
    // Clear event listeners
    this.eventListeners.clear();
    
    // Clean up resources
    this.context = undefined;
    this.api = undefined;
    this.fileGenerator = undefined;
    this.statusBarItem = undefined;
    
    this.loaded = false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private verifyPermissions(): void {
    const required = [
      'vault.read',
      'vault.write',
      'network.fetch',
      'settings.store'
    ];
    
    const permissions = this.context?.manifest.permissions || [];
    const missing = required.filter(p => !permissions.includes(p));
    
    if (missing.length > 0) {
      throw new Error(`Missing required permissions: ${missing.join(', ')}`);
    }
  }

  private async loadSettings(): Promise<void> {
    if (!this.context) return;
    
    try {
      const saved = await this.context.settings.get('readwise-settings');
      if (saved) {
        this.settings = { ...DEFAULT_SETTINGS, ...saved };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  private async registerCommands(): Promise<void> {
    if (!this.context) return;
    
    // Sync all highlights
    await this.context.workspace.registerCommand({
      id: 'readwise-sync',
      name: 'Sync Readwise highlights',
      callback: async () => {
        await this.syncHighlights();
      }
    });
    
    // Sync new highlights only
    await this.context.workspace.registerCommand({
      id: 'readwise-sync-new',
      name: 'Sync new highlights only',
      callback: async () => {
        await this.syncHighlights(true);
      }
    });
    
    // Open settings
    await this.context.workspace.registerCommand({
      id: 'readwise-settings',
      name: 'Open Readwise settings',
      callback: async () => {
        // Settings tab will handle this
        this.context?.workspace.emit('open-settings', { tab: 'readwise-settings' });
      }
    });
  }

  private async registerStatusBar(): Promise<void> {
    if (!this.context) return;
    
    this.statusBarItem = await this.context.workspace.registerStatusBarItem({
      id: 'readwise-status',
      text: 'Readwise',
      tooltip: 'Click to sync Readwise highlights',
      position: 'right',
      onClick: async () => {
        await this.syncHighlights();
      }
    });
  }

  private async registerSettingsTab(): Promise<void> {
    if (!this.context) return;
    
    await this.context.workspace.registerSettingsTab({
      id: 'readwise-settings',
      name: 'Readwise',
      component: (container: HTMLElement) => {
        return new SettingsComponent(container, this.settings, async (newSettings) => {
          await this.updateSettings(newSettings);
        });
      }
    });
  }

  async updateSettings(newSettings: Partial<ReadwiseSettings>): Promise<void> {
    if (!this.context) return;
    
    const oldSettings = { ...this.settings };
    this.settings = { ...this.settings, ...newSettings };
    
    // Save settings
    await this.context.settings.set('readwise-settings', this.settings);
    
    // Update API token if changed
    if (this.api && newSettings.apiToken !== undefined) {
      this.api.setToken(newSettings.apiToken);
    }
    
    // Update file generator settings
    if (this.fileGenerator) {
      this.fileGenerator.updateSettings(this.settings);
    }
    
    // Handle auto sync changes
    if (oldSettings.autoSync !== this.settings.autoSync ||
        oldSettings.syncFrequency !== this.settings.syncFrequency) {
      if (this.settings.autoSync && this.settings.apiToken) {
        this.startAutoSync();
      } else {
        this.stopAutoSync();
      }
    }
  }

  getSettings(): ReadwiseSettings {
    return { ...this.settings };
  }

  async authenticate(): Promise<void> {
    if (!this.context) return;
    
    // Open Readwise access token page
    await this.context.workspace.openExternal('https://readwise.io/access_token');
  }

  async saveToken(token: string): Promise<void> {
    await this.updateSettings({ apiToken: token });
  }

  async validateToken(token: string): Promise<boolean> {
    if (!this.context) return false;
    
    try {
      const response = await this.context.network.fetch(
        'https://readwise.io/api/v2/auth',
        {
          headers: {
            'Authorization': `Token ${token}`
          }
        }
      );
      
      return response.ok && response.status === 204;
    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  }

  async syncHighlights(newOnly = false): Promise<SyncResult> {
    if (!this.context || !this.syncEngine) {
      return { success: false, error: 'Plugin not initialized' };
    }
    
    if (!this.settings.apiToken) {
      await this.context.workspace.showNotice('Please configure your Readwise API token', 'error');
      return { success: false, error: 'No API token configured' };
    }
    
    // Check network permission
    if (!this.context.manifest.permissions.includes('network.fetch')) {
      return { success: false, error: 'Network permission required' };
    }
    
    if (this.syncing) {
      await this.context.workspace.showNotice('Sync already in progress', 'warning');
      return { success: false, error: 'Sync already in progress' };
    }
    
    this.syncing = true;
    this.updateStatusBar('Syncing...');
    
    try {
      // Use the sync engine
      const result = await this.syncEngine.sync(newOnly);
      
      // Update status bar with results
      this.updateStatusBar();
      
      // Emit sync complete event
      this.emit('sync-complete', result);
      
      return result;
      
    } finally {
      this.syncing = false;
      this.updateStatusBar();
    }
  }


  private startAutoSync(): void {
    this.stopAutoSync();
    
    const intervalMs = this.settings.syncFrequency * 60 * 1000;
    this.syncTimer = setInterval(() => {
      this.syncHighlights();
    }, intervalMs);
  }

  private stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  getSyncTimer(): NodeJS.Timeout | null {
    return this.syncTimer || null;
  }

  getRetryAfter(): number {
    return Math.ceil(this.retryAfter - Date.now() / 1000);
  }

  private updateStatusBar(text?: string): void {
    if (!this.statusBarItem) return;
    
    if (text) {
      this.statusBarItem.setText(text);
    } else if (this.settings.lastSync) {
      const date = new Date(this.settings.lastSync);
      const formatted = date.toLocaleDateString();
      this.statusBarItem.setText(`Readwise (${formatted})`);
    } else {
      this.statusBarItem.setText('Readwise');
    }
  }

  addEventListener(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }
}

// Export for plugin entry point
export default VaultReadwisePlugin;