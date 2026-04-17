// Settings UI Component for Readwise Plugin
import React, { useState, useEffect, useCallback } from 'react';
import type { ReadwiseSettings } from './types';

interface SettingsComponentProps {
  settings: ReadwiseSettings;
  onSettingsChange: (settings: Partial<ReadwiseSettings>) => Promise<void>;
}

export const SettingsComponent: React.FC<SettingsComponentProps> = ({ 
  settings: initialSettings, 
  onSettingsChange 
}) => {
  const [settings, setSettings] = useState<ReadwiseSettings>(initialSettings);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  const handleChange = useCallback((key: keyof ReadwiseSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSettingsChange(settings);
      setTestResult('Settings saved successfully');
    } catch (error) {
      setTestResult(`Failed to save: ${error}`);
    } finally {
      setSaving(false);
    }
  }, [settings, onSettingsChange]);

  const handleTestConnection = useCallback(async () => {
    if (!settings.apiToken) {
      setTestResult('Please enter an API token');
      return;
    }

    setTesting(true);
    setTestResult('Testing connection...');

    try {
      // Test the API connection
      const response = await fetch('https://readwise.io/api/v2/auth', {
        headers: {
          'Authorization': `Token ${settings.apiToken}`
        }
      });

      if (response.ok) {
        setTestResult('✓ Connection successful');
      } else {
        setTestResult('✗ Invalid API token');
      }
    } catch (error) {
      setTestResult(`✗ Connection failed: ${error}`);
    } finally {
      setTesting(false);
    }
  }, [settings.apiToken]);

  return (
    <div className="readwise-settings">
      <h2>Readwise Settings</h2>
      
      <div className="setting-group">
        <h3>Authentication</h3>
        
        <div className="setting-item">
          <label htmlFor="api-token">API Token</label>
          <div className="setting-control">
            <input
              id="api-token"
              type="password"
              value={settings.apiToken || ''}
              onChange={(e) => handleChange('apiToken', e.target.value)}
              placeholder="Enter your Readwise API token"
            />
            <a 
              href="https://readwise.io/access_token" 
              target="_blank" 
              rel="noopener noreferrer"
              className="button-link"
            >
              Get Token
            </a>
          </div>
          <div className="setting-description">
            Your Readwise API token for authentication
          </div>
          <button 
            onClick={handleTestConnection} 
            disabled={testing || !settings.apiToken}
            className="button-secondary"
          >
            Test Connection
          </button>
          {testResult && (
            <div className={`test-result ${testResult.includes('✓') ? 'success' : testResult.includes('✗') ? 'error' : ''}`}>
              {testResult}
            </div>
          )}
        </div>
      </div>

      <div className="setting-group">
        <h3>Sync Options</h3>
        
        <div className="setting-item">
          <label htmlFor="auto-sync">
            <input
              id="auto-sync"
              type="checkbox"
              checked={settings.autoSync}
              onChange={(e) => handleChange('autoSync', e.target.checked)}
            />
            Enable automatic sync
          </label>
          <div className="setting-description">
            Automatically sync highlights at regular intervals
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="sync-frequency">Sync Frequency (minutes)</label>
          <input
            id="sync-frequency"
            type="number"
            min="5"
            max="1440"
            value={settings.syncFrequency}
            onChange={(e) => handleChange('syncFrequency', parseInt(e.target.value))}
            disabled={!settings.autoSync}
          />
          <div className="setting-description">
            How often to sync highlights (5-1440 minutes)
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="sync-startup">
            <input
              id="sync-startup"
              type="checkbox"
              checked={settings.syncOnStartup}
              onChange={(e) => handleChange('syncOnStartup', e.target.checked)}
            />
            Sync on startup
          </label>
          <div className="setting-description">
            Sync highlights when Vault starts
          </div>
        </div>
      </div>

      <div className="setting-group">
        <h3>File Organization</h3>
        
        <div className="setting-item">
          <label htmlFor="highlights-folder">Highlights Folder</label>
          <input
            id="highlights-folder"
            type="text"
            value={settings.highlightsFolder}
            onChange={(e) => handleChange('highlightsFolder', e.target.value)}
            placeholder="Readwise"
          />
          <div className="setting-description">
            Folder where highlights will be saved
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="group-by">Group By</label>
          <select
            id="group-by"
            value={settings.groupBy}
            onChange={(e) => handleChange('groupBy', e.target.value as any)}
          >
            <option value="book">Book/Article</option>
            <option value="article">Type (Book vs Article)</option>
            <option value="category">Category</option>
            <option value="date">Date</option>
          </select>
          <div className="setting-description">
            How to organize highlight files
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="date-format">Date Format</label>
          <input
            id="date-format"
            type="text"
            value={settings.dateFormat}
            onChange={(e) => handleChange('dateFormat', e.target.value)}
            placeholder="YYYY-MM-DD"
          />
          <div className="setting-description">
            Format for dates in notes (YYYY, MM, DD, HH, mm, ss)
          </div>
        </div>
      </div>

      <div className="setting-group">
        <h3>Content Options</h3>
        
        <div className="setting-item">
          <label htmlFor="append-existing">
            <input
              id="append-existing"
              type="checkbox"
              checked={settings.appendToExisting}
              onChange={(e) => handleChange('appendToExisting', e.target.checked)}
            />
            Append to existing files
          </label>
          <div className="setting-description">
            Add new highlights to existing files instead of overwriting
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="include-supplementals">
            <input
              id="include-supplementals"
              type="checkbox"
              checked={settings.includeSupplementals}
              onChange={(e) => handleChange('includeSupplementals', e.target.checked)}
            />
            Include supplemental highlights
          </label>
          <div className="setting-description">
            Include Readwise's supplemental highlights and notes
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="custom-template">Custom Template (Optional)</label>
          <textarea
            id="custom-template"
            value={settings.customTemplate || ''}
            onChange={(e) => handleChange('customTemplate', e.target.value)}
            placeholder="Leave empty to use default template. Supports Mustache syntax."
            rows={10}
          />
          <div className="setting-description">
            Custom Mustache template for generating highlight files
          </div>
        </div>
      </div>

      {settings.lastSync && (
        <div className="setting-group">
          <h3>Sync Status</h3>
          <div className="sync-status">
            <p>Last sync: {new Date(settings.lastSync).toLocaleString()}</p>
            {settings.lastSyncCount !== undefined && (
              <p>Highlights synced: {settings.lastSyncCount}</p>
            )}
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button 
          onClick={handleSave} 
          disabled={saving}
          className="button-primary"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

// Non-React version for compatibility with plugin architecture
export class SettingsComponentVanilla {
  private container: HTMLElement;
  private settings: ReadwiseSettings;
  private onSettingsChange: (settings: Partial<ReadwiseSettings>) => Promise<void>;

  constructor(
    container: HTMLElement, 
    settings: ReadwiseSettings, 
    onSettingsChange: (settings: Partial<ReadwiseSettings>) => Promise<void>
  ) {
    this.container = container;
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
    this.render();
  }

  private render(): void {
    // For now, we'll use the React component
    // In production, this would render without React dependency
    this.container.innerHTML = `
      <div class="readwise-settings">
        <h2>Readwise Settings</h2>
        <p>Settings UI will be rendered here</p>
      </div>
    `;
  }
}

// Export the vanilla version as default for plugin compatibility
export { SettingsComponentVanilla as SettingsComponent };