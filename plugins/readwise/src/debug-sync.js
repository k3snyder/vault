// Debug version of the sync functionality
// This adds extensive logging to trace the sync process

export class DebugSyncHandler {
  constructor(pluginContext) {
    this.context = pluginContext;
    console.log('[DebugSync] Handler initialized');
  }

  async performSync() {
    console.log('[DebugSync] === Starting sync process ===');
    
    try {
      // Step 1: Load settings
      console.log('[DebugSync] Step 1: Loading settings...');
      const settings = await this.loadSettings();
      console.log('[DebugSync] Settings loaded:', JSON.stringify(settings, null, 2));
      
      // Check for API token
      if (!settings.apiToken) {
        console.error('[DebugSync] ❌ No API token found in settings!');
        return { success: false, error: 'No API token configured' };
      }
      
      console.log('[DebugSync] ✓ API token found:', settings.apiToken.slice(0, 10) + '...');
      
      // Step 2: Test API connection
      console.log('[DebugSync] Step 2: Testing API connection...');
      const connectionOk = await this.testConnection(settings.apiToken);
      
      if (!connectionOk) {
        console.error('[DebugSync] ❌ API connection failed!');
        return { success: false, error: 'API connection failed' };
      }
      
      console.log('[DebugSync] ✓ API connection successful');
      
      // Step 3: Fetch data
      console.log('[DebugSync] Step 3: Fetching data from Readwise...');
      const data = await this.fetchData(settings.apiToken);
      console.log('[DebugSync] ✓ Fetched', data.count, 'items');
      
      // Step 4: Process data
      console.log('[DebugSync] Step 4: Processing data...');
      const processed = await this.processData(data, settings);
      console.log('[DebugSync] ✓ Processed', processed.length, 'items');
      
      // Step 5: Save to vault
      console.log('[DebugSync] Step 5: Saving to vault...');
      const saved = await this.saveToVault(processed, settings);
      console.log('[DebugSync] ✓ Saved', saved, 'files');
      
      console.log('[DebugSync] === Sync completed successfully ===');
      return { success: true, itemsProcessed: processed.length, filesSaved: saved };
      
    } catch (error) {
      console.error('[DebugSync] ❌ Sync failed with error:', error);
      console.error('[DebugSync] Stack trace:', error.stack);
      return { success: false, error: error.message };
    }
  }
  
  async loadSettings() {
    // Try different methods to load settings
    console.log('[DebugSync] Attempting to load settings...');
    
    // Method 1: From plugin context
    if (this.context && this.context.settings) {
      console.log('[DebugSync] Trying context.settings.get()...');
      try {
        const settings = await this.context.settings.get('readwise-settings');
        if (settings) {
          console.log('[DebugSync] ✓ Loaded from context.settings');
          return settings;
        }
      } catch (error) {
        console.log('[DebugSync] context.settings.get() failed:', error.message);
      }
    }
    
    // Method 2: From window.pluginSettings (frontend)
    if (typeof window !== 'undefined' && window.pluginSettings) {
      console.log('[DebugSync] Trying window.pluginSettings...');
      const settings = window.pluginSettings.readwise;
      if (settings) {
        console.log('[DebugSync] ✓ Loaded from window.pluginSettings');
        return settings;
      }
    }
    
    // Method 3: From localStorage
    if (typeof localStorage !== 'undefined') {
      console.log('[DebugSync] Trying localStorage...');
      const stored = localStorage.getItem('readwise-settings');
      if (stored) {
        const settings = JSON.parse(stored);
        console.log('[DebugSync] ✓ Loaded from localStorage');
        return settings;
      }
    }
    
    console.log('[DebugSync] ❌ No settings found in any location');
    return {};
  }
  
  async testConnection(token) {
    console.log('[DebugSync] Testing connection with token:', token.slice(0, 10) + '...');
    
    try {
      const response = await fetch('https://readwise.io/api/v2/auth', {
        method: 'GET',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('[DebugSync] Auth response status:', response.status);
      return response.status === 204;
    } catch (error) {
      console.error('[DebugSync] Connection test error:', error);
      return false;
    }
  }
  
  async fetchData(token) {
    console.log('[DebugSync] Fetching export data...');
    
    const response = await fetch('https://readwise.io/api/v2/export?page_size=10', {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('[DebugSync] Raw API response:', JSON.stringify(data).slice(0, 500) + '...');
    return data;
  }
  
  async processData(data, settings) {
    console.log('[DebugSync] Processing data with settings:', {
      groupBy: settings.groupBy,
      folder: settings.highlightsFolder
    });
    
    const processed = [];
    
    if (data.results && Array.isArray(data.results)) {
      for (const item of data.results) {
        processed.push({
          title: item.title,
          author: item.author,
          highlights: item.highlights || [],
          type: item.source_type
        });
      }
    }
    
    return processed;
  }
  
  async saveToVault(items, settings) {
    console.log('[DebugSync] Saving items to vault...');
    console.log('[DebugSync] Target folder:', settings.highlightsFolder);
    
    // For now, just log what we would save
    let savedCount = 0;
    
    for (const item of items) {
      console.log(`[DebugSync] Would save: ${item.title} by ${item.author}`);
      console.log(`[DebugSync]   - ${item.highlights.length} highlights`);
      savedCount++;
    }
    
    return savedCount;
  }
}

// Export a function to attach to the Initial Sync button
export function attachDebugSync() {
  console.log('[DebugSync] Attaching debug sync handler...');
  
  // Find the Initial Sync button
  const syncButton = document.querySelector('.initial-sync-button');
  
  if (syncButton) {
    console.log('[DebugSync] Found Initial Sync button, attaching handler...');
    
    // Remove any existing handlers
    const newButton = syncButton.cloneNode(true);
    syncButton.parentNode.replaceChild(newButton, syncButton);
    
    // Add our debug handler
    newButton.addEventListener('click', async (e) => {
      console.log('[DebugSync] === Initial Sync button clicked ===');
      e.preventDefault();
      
      // Create a debug sync handler
      const handler = new DebugSyncHandler(window.pluginContext || {});
      
      // Disable button and show loading
      newButton.disabled = true;
      newButton.textContent = 'Syncing...';
      
      // Perform sync
      const result = await handler.performSync();
      
      // Show result
      if (result.success) {
        newButton.textContent = '✓ Sync Complete';
        console.log('[DebugSync] Sync successful:', result);
      } else {
        newButton.textContent = '✗ Sync Failed';
        console.error('[DebugSync] Sync failed:', result.error);
      }
      
      // Re-enable after 2 seconds
      setTimeout(() => {
        newButton.disabled = false;
        newButton.textContent = 'Initial Sync';
      }, 2000);
    });
    
    console.log('[DebugSync] ✓ Debug handler attached');
  } else {
    console.log('[DebugSync] ❌ Initial Sync button not found');
  }
}

// Auto-attach when the script loads
if (typeof document !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachDebugSync);
  } else {
    // DOM already loaded
    setTimeout(attachDebugSync, 100);
  }
}