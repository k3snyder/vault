/**
 * CsvSupportSettings - Settings modal for CSV Editor Pro plugin
 *
 * This modal provides:
 * - Statistics section with file count and schemas count
 * - Import Defaults section with delimiter and encoding options
 * - Premium Settings (for premium users): auto-infer toggle, bulk actions
 * - Premium Upsell (for free users): feature list with trial button
 */

import { invoke } from '@tauri-apps/api/core';
import { Modal } from './Modal.js';
import EntitlementManager from '../../services/entitlement-manager.js';

class CsvSupportSettings {
  constructor(context) {
    this.context = context;
    this.modal = null;
    this.element = null;

    // State
    this.state = {
      fileCount: 0,
      schemasCount: 0,
      delimiter: ',',
      encoding: 'utf-8',
      autoInferSchema: true,
      isSaving: false,
      isReinferring: false,
      isClearing: false
    };

    // Services
    this.entitlementManager = null;
  }

  /**
   * Initialize required services
   */
  async initialize() {
    // Initialize entitlement manager
    if (!this.entitlementManager) {
      this.entitlementManager = new EntitlementManager();
      await this.entitlementManager.initialize();
    }

    // Load saved settings
    await this.loadSettings();

    // Load statistics
    await this.loadStatistics();
  }

  /**
   * Load saved settings from storage
   */
  async loadSettings() {
    try {
      // csv-support is a bundled plugin - use localStorage
      const key = 'bundled_plugin_csv-support';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      if (settings) {
        this.state.delimiter = settings.delimiter || ',';
        this.state.encoding = settings.encoding || 'utf-8';
        this.state.autoInferSchema = settings.autoInferSchema !== false;
      }
    } catch (error) {
      console.error('Failed to load CSV settings:', error);
    }
  }

  /**
   * Load CSV statistics
   */
  async loadStatistics() {
    try {
      const stats = await invoke('csv_get_statistics');
      if (stats) {
        this.state.fileCount = stats.file_count || 0;
        this.state.schemasCount = stats.schemas_count || 0;
      }
    } catch (error) {
      // Stats command may not exist yet - use defaults
      console.debug('CSV statistics not available:', error);
    }
  }

  /**
   * Open the settings modal
   */
  async open() {
    await this.initialize();

    this.modal = new Modal({
      title: 'CSV Editor Pro Settings',
      content: this.renderContent(),
      size: 'large',
      className: 'csv-settings-modal',
      actions: [
        {
          id: 'cancel',
          label: 'Cancel',
          className: 'modal-action-secondary',
          handler: () => true
        },
        {
          id: 'save',
          label: 'Save Settings',
          className: 'modal-action-primary',
          handler: () => {
            this.saveSettings();
            return false; // Don't close immediately, wait for save
          }
        }
      ],
      onClose: () => {
        this.cleanup();
      }
    });

    this.modal.open();
    this.element = this.modal.element;

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Render the modal content
   */
  renderContent() {
    const isPremium = this.entitlementManager
      ? this.entitlementManager.isPremiumEnabled()
      : false;

    return `
      <div class="csv-settings-content">
        <!-- Statistics Section -->
        <div class="settings-section">
          <h3>Statistics</h3>
          <div class="settings-group">
            <div class="csv-stats">
              <div class="stat-item">
                <span class="stat-label">CSV Files:</span>
                <span class="stat-value" id="csv-file-count">${this.state.fileCount}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Saved Schemas:</span>
                <span class="stat-value" id="csv-schemas-count">${this.state.schemasCount}</span>
                ${!isPremium ? '<span class="stat-badge premium-only">Premium</span>' : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Import Defaults Section -->
        <div class="settings-section">
          <h3>Import Defaults</h3>
          <div class="settings-group">
            <div class="setting-field">
              <label for="csv-delimiter">Default Delimiter</label>
              <select id="csv-delimiter" name="delimiter">
                <option value="," ${this.state.delimiter === ',' ? 'selected' : ''}>Comma (,)</option>
                <option value=";" ${this.state.delimiter === ';' ? 'selected' : ''}>Semicolon (;)</option>
                <option value="\t" ${this.state.delimiter === '\t' ? 'selected' : ''}>Tab</option>
                <option value="|" ${this.state.delimiter === '|' ? 'selected' : ''}>Pipe (|)</option>
              </select>
              <p class="setting-description">Delimiter used when opening CSV files</p>
            </div>
            <div class="setting-field">
              <label for="csv-encoding">Default Encoding</label>
              <select id="csv-encoding" name="encoding">
                <option value="utf-8" ${this.state.encoding === 'utf-8' ? 'selected' : ''}>UTF-8</option>
                <option value="utf-16" ${this.state.encoding === 'utf-16' ? 'selected' : ''}>UTF-16</option>
                <option value="iso-8859-1" ${this.state.encoding === 'iso-8859-1' ? 'selected' : ''}>ISO-8859-1 (Latin-1)</option>
                <option value="windows-1252" ${this.state.encoding === 'windows-1252' ? 'selected' : ''}>Windows-1252</option>
              </select>
              <p class="setting-description">Character encoding for reading CSV files</p>
            </div>
          </div>
        </div>

        ${isPremium ? this.renderPremiumSettings() : this.renderPremiumUpsell()}
      </div>
    `;
  }

  /**
   * Render premium settings section (for premium users)
   */
  renderPremiumSettings() {
    return `
      <!-- Schema Settings Section (Premium) -->
      <div class="settings-section">
        <h3>Schema Settings</h3>
        <div class="settings-group">
          <div class="setting-field setting-toggle-field">
            <label for="csv-auto-infer">
              <span>Auto-infer Schema</span>
              <input type="checkbox"
                     id="csv-auto-infer"
                     name="autoInferSchema"
                     ${this.state.autoInferSchema ? 'checked' : ''}>
              <span class="setting-toggle-slider"></span>
            </label>
            <p class="setting-description">Automatically detect column types and generate schema when opening CSV files</p>
          </div>
        </div>
      </div>

      <!-- Bulk Actions Section (Premium) -->
      <div class="settings-section">
        <h3>Bulk Actions</h3>
        <div class="settings-group">
          <div class="bulk-actions">
            <button class="modal-action modal-action-secondary" data-action="reinfer-all"
                    ${this.state.isReinferring ? 'disabled' : ''}>
              ${this.state.isReinferring ? 'Re-inferring...' : 'Re-infer All Schemas'}
            </button>
            <button class="modal-action modal-action-danger" data-action="clear-all"
                    ${this.state.isClearing ? 'disabled' : ''}>
              ${this.state.isClearing ? 'Clearing...' : 'Clear All Schemas'}
            </button>
          </div>
          <p class="setting-description">
            Re-infer will update all saved schemas based on current file contents.
            Clear will remove all saved schemas.
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Render premium upsell section (for free users)
   */
  renderPremiumUpsell() {
    return `
      <!-- Premium Features Section -->
      <div class="settings-section premium-upsell">
        <h3>Premium Features</h3>
        <div class="settings-group">
          <p class="upsell-intro">
            Upgrade to unlock powerful AI-powered features:
          </p>
          <div class="feature-matrix">
            <div class="feature-column free-column">
              <h4>Free</h4>
              <ul class="feature-list">
                <li class="feature-included">
                  <span class="feature-icon">&#10003;</span>
                  View and edit CSV files
                </li>
                <li class="feature-included">
                  <span class="feature-icon">&#10003;</span>
                  Add/delete rows and columns
                </li>
                <li class="feature-included">
                  <span class="feature-icon">&#10003;</span>
                  Keyboard navigation
                </li>
                <li class="feature-included">
                  <span class="feature-icon">&#10003;</span>
                  Up to 10,000 rows
                </li>
                <li class="feature-excluded">
                  <span class="feature-icon">&#10007;</span>
                  Schema inference
                </li>
                <li class="feature-excluded">
                  <span class="feature-icon">&#10007;</span>
                  AI context generation
                </li>
                <li class="feature-excluded">
                  <span class="feature-icon">&#10007;</span>
                  Unlimited rows
                </li>
              </ul>
            </div>
            <div class="feature-column premium-column">
              <h4>Premium</h4>
              <ul class="feature-list">
                <li class="feature-included">
                  <span class="feature-icon">&#10003;</span>
                  All free features
                </li>
                <li class="feature-included highlight">
                  <span class="feature-icon">&#10003;</span>
                  Auto schema inference
                </li>
                <li class="feature-included highlight">
                  <span class="feature-icon">&#10003;</span>
                  AI-powered context
                </li>
                <li class="feature-included highlight">
                  <span class="feature-icon">&#10003;</span>
                  Semantic role detection
                </li>
                <li class="feature-included highlight">
                  <span class="feature-icon">&#10003;</span>
                  Column relationships
                </li>
                <li class="feature-included highlight">
                  <span class="feature-icon">&#10003;</span>
                  JSON export with schema
                </li>
                <li class="feature-included highlight">
                  <span class="feature-icon">&#10003;</span>
                  Unlimited rows
                </li>
              </ul>
            </div>
          </div>
          <div class="upsell-actions">
            <button class="modal-action modal-action-primary" data-action="start-trial">
              Start 30-Day Free Trial
            </button>
            <a href="https://vault.app/premium" target="_blank" class="modal-action modal-action-secondary">
              Learn More
            </a>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners to modal elements
   */
  attachEventListeners() {
    if (!this.element) return;

    // Start Trial
    this.element.querySelector('[data-action="start-trial"]')?.addEventListener('click', async () => {
      await this.startTrial();
    });

    // Re-infer All Schemas
    this.element.querySelector('[data-action="reinfer-all"]')?.addEventListener('click', async () => {
      await this.reinferAllSchemas();
    });

    // Clear All Schemas
    this.element.querySelector('[data-action="clear-all"]')?.addEventListener('click', async () => {
      await this.clearAllSchemas();
    });

    // Track input changes for settings
    this.element.querySelector('#csv-delimiter')?.addEventListener('change', (e) => {
      this.state.delimiter = e.target.value;
    });

    this.element.querySelector('#csv-encoding')?.addEventListener('change', (e) => {
      this.state.encoding = e.target.value;
    });

    this.element.querySelector('#csv-auto-infer')?.addEventListener('change', (e) => {
      this.state.autoInferSchema = e.target.checked;
    });
  }

  /**
   * Start free trial
   */
  async startTrial() {
    try {
      await this.entitlementManager.startTrial();
      this.context.showToast('Trial activated! You now have 30 days of premium access.', 'success');
      this.refreshContent();
    } catch (error) {
      console.error('Failed to start trial:', error);
      this.context.showToast('Failed to start trial: ' + error.message, 'error');
    }
  }

  /**
   * Re-infer all schemas
   */
  async reinferAllSchemas() {
    try {
      this.state.isReinferring = true;
      this.updateButton('reinfer-all', 'Re-inferring...', true);

      await invoke('csv_reinfer_all_schemas');

      // Reload statistics
      await this.loadStatistics();

      this.context.showToast('All schemas have been re-inferred.', 'success');
      this.refreshContent();
    } catch (error) {
      console.error('Failed to re-infer schemas:', error);
      this.context.showToast('Failed to re-infer schemas: ' + error.message, 'error');
    } finally {
      this.state.isReinferring = false;
      this.updateButton('reinfer-all', 'Re-infer All Schemas', false);
    }
  }

  /**
   * Clear all schemas
   */
  async clearAllSchemas() {
    const confirmed = confirm('Are you sure you want to clear all saved schemas? This cannot be undone.');
    if (!confirmed) return;

    try {
      this.state.isClearing = true;
      this.updateButton('clear-all', 'Clearing...', true);

      await invoke('csv_clear_all_schemas');

      // Reset schema count
      this.state.schemasCount = 0;

      this.context.showToast('All schemas have been cleared.', 'success');
      this.refreshContent();
    } catch (error) {
      console.error('Failed to clear schemas:', error);
      this.context.showToast('Failed to clear schemas: ' + error.message, 'error');
    } finally {
      this.state.isClearing = false;
      this.updateButton('clear-all', 'Clear All Schemas', false);
    }
  }

  /**
   * Save settings
   */
  async saveSettings() {
    try {
      this.state.isSaving = true;

      // csv-support is a bundled plugin - use localStorage
      const key = 'bundled_plugin_csv-support';
      const existingSettings = JSON.parse(localStorage.getItem(key) || '{}');
      const newSettings = {
        ...existingSettings,
        delimiter: this.state.delimiter,
        encoding: this.state.encoding,
        autoInferSchema: this.state.autoInferSchema
      };
      localStorage.setItem(key, JSON.stringify(newSettings));

      this.context.showToast('Settings saved successfully.', 'success');
      this.modal.close();
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.context.showToast('Failed to save settings: ' + error.message, 'error');
    } finally {
      this.state.isSaving = false;
    }
  }

  /**
   * Update a button's state
   */
  updateButton(action, text, disabled) {
    const button = this.element?.querySelector(`[data-action="${action}"]`);
    if (button) {
      button.textContent = text;
      button.disabled = disabled;
    }
  }

  /**
   * Refresh the modal content
   */
  refreshContent() {
    const contentEl = this.modal?.element?.querySelector('.modal-content');
    if (contentEl) {
      contentEl.innerHTML = this.renderContent();
      this.attachEventListeners();
    }
  }

  /**
   * Cleanup when modal is closed
   */
  cleanup() {
    this.element = null;
    this.modal = null;
  }
}

export default CsvSupportSettings;
