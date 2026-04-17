/**
 * PacasDBSettings - Settings modal for PACASDB Premium plugin
 *
 * This modal provides:
 * - License Status section with Update License / Deactivate License buttons
 * - Connection Status with Test Connection button
 * - Database Statistics showing document count
 * - Vault Synchronization with Sync Vault Now button
 */

import { invoke } from '@tauri-apps/api/core';
import { Modal } from './Modal.js';
import EntitlementManager from '../../services/entitlement-manager.js';
import PACASDBClient from '../../services/pacasdb-client.js';
import VaultSync from '../../services/vault-sync.js';
import LicenseStatusBadge from '../../components/LicenseStatusBadge.js';
import ActivationDialog from '../../components/ActivationDialog.js';

class PacasDBSettings {
  constructor(context) {
    this.context = context;
    this.modal = null;
    this.element = null;

    // State
    this.state = {
      connected: false,
      docCount: 0,
      indexSize: 0,
      lastSync: null,
      isTesting: false,
      isSyncing: false,
      vaultPath: null
    };

    // Services
    this.entitlementManager = null;
    this.pacasdbClient = null;
    this.vaultSync = null;
    this.activationDialog = null;
    this.licenseStatusBadge = null;
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

    // Get vault path
    try {
      if (window.currentVaultPath) {
        this.state.vaultPath = window.currentVaultPath;
      } else {
        const vaultInfo = await invoke('get_vault_info');
        if (vaultInfo && vaultInfo.path) {
          this.state.vaultPath = vaultInfo.path;
        }
      }
    } catch (error) {
      console.error('Failed to get vault path:', error);
    }

    // Initialize PACASDB client
    if (window.pacasdbClient) {
      this.pacasdbClient = window.pacasdbClient;
    } else if (!this.pacasdbClient) {
      this.pacasdbClient = new PACASDBClient(this.entitlementManager);
    }

    // Initialize VaultSync
    if (window.vaultSync) {
      this.vaultSync = window.vaultSync;
    } else if (!this.vaultSync && this.pacasdbClient) {
      this.vaultSync = new VaultSync(this.pacasdbClient);
    }

    // Initialize activation dialog
    if (!this.activationDialog) {
      this.activationDialog = new ActivationDialog(this.entitlementManager);
    }

    // Check connection status
    if (this.pacasdbClient) {
      this.state.connected = this.pacasdbClient.isConnected();
    }
  }

  /**
   * Open the settings modal
   */
  async open() {
    await this.initialize();

    this.modal = new Modal({
      title: 'PACASDB Premium Settings',
      content: this.renderContent(),
      size: 'large',
      className: 'pacasdb-settings-modal',
      actions: [
        {
          id: 'close',
          label: 'Close',
          className: 'modal-action-primary',
          handler: () => true
        }
      ],
      onClose: () => {
        this.cleanup();
      }
    });

    this.modal.open();
    this.element = this.modal.element;

    // Mount license badge after modal is open
    this.mountLicenseBadge();

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Render the modal content
   */
  renderContent() {
    const licenseStatus = this.entitlementManager
      ? this.entitlementManager.getStatus()
      : { status: 'unlicensed' };
    const isPremium = this.entitlementManager
      ? this.entitlementManager.isPremiumEnabled()
      : false;
    const isUnlicensed = licenseStatus.status === 'unlicensed';
    const isLicensed = licenseStatus.status === 'licensed';

    return `
      <div class="pacasdb-settings-content">
        <!-- License Status Section -->
        <div class="settings-section">
          <div class="section-header">
            <h3>License Status</h3>
            <div id="pacasdb-license-badge"></div>
          </div>
          <div class="settings-group">
            <p class="section-description">
              PACASDB provides semantic search and cognitive memory capabilities for your vault.
            </p>
            <div class="license-controls">
              ${isUnlicensed ? `
                <button class="modal-action modal-action-primary" data-action="start-trial">
                  Start 30-Day Free Trial
                </button>
              ` : ''}
              <button class="modal-action modal-action-secondary" data-action="activate-license">
                ${isLicensed ? 'Update License' : 'Activate License'}
              </button>
              ${isPremium ? `
                <button class="modal-action modal-action-secondary" data-action="deactivate-license">
                  Deactivate License
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        ${isPremium ? `
          <!-- Connection Status Section -->
          <div class="settings-section">
            <h3>Connection Status</h3>
            <div class="settings-group">
              <div class="connection-status-row">
                <span class="status-indicator ${this.state.connected ? 'connected' : 'disconnected'}">
                  ${this.state.connected ? 'Connected' : 'Disconnected'}
                </span>
                <button class="modal-action modal-action-secondary" data-action="test-connection"
                        ${this.state.isTesting ? 'disabled' : ''}>
                  ${this.state.isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
              <p class="form-help">
                PACASDB server should be running on <code>localhost:8000</code>
              </p>
            </div>
          </div>

          ${this.state.connected ? `
            <!-- Database Statistics Section -->
            <div class="settings-section">
              <h3>Database Statistics</h3>
              <div class="settings-group">
                <div class="database-stats">
                  <div class="stat-item">
                    <span class="stat-label">Documents:</span>
                    <span class="stat-value" id="pacasdb-doc-count">${this.state.docCount}</span>
                  </div>
                  ${this.state.indexSize > 0 ? `
                    <div class="stat-item">
                      <span class="stat-label">Index Size:</span>
                      <span class="stat-value">${this.formatBytes(this.state.indexSize)}</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>

            <!-- Vault Synchronization Section -->
            <div class="settings-section">
              <h3>Vault Synchronization</h3>
              <div class="settings-group">
                <div class="sync-controls">
                  <button class="modal-action modal-action-primary" data-action="sync-vault"
                          ${this.state.isSyncing ? 'disabled' : ''}>
                    ${this.state.isSyncing ? 'Syncing...' : 'Sync Vault Now'}
                  </button>
                  ${this.state.lastSync ? `
                    <span class="last-sync">Last synced: ${this.state.lastSync}</span>
                  ` : ''}
                </div>
                <p class="form-help">
                  Manually sync all markdown files in your vault to PACASDB
                </p>
              </div>
            </div>
          ` : `
            <!-- Setup Instructions (when not connected) -->
            <div class="settings-section">
              <h3>Setup Instructions</h3>
              <div class="settings-group setup-instructions">
                <p>To use PACASDB features, you need to run the PACASDB server:</p>
                <ol>
                  <li>Install Docker if not already installed</li>
                  <li>Run: <code>docker run -p 8000:8000 pacasdb/pacasdb</code></li>
                  <li>Click "Test Connection" above to verify</li>
                </ol>
              </div>
            </div>
          `}
        ` : `
          <!-- Premium Required Message -->
          <div class="settings-section">
            <div class="premium-required">
              <p>
                <strong>Premium features are not active.</strong>
              </p>
              <p>
                Start a free 30-day trial or activate your license to access PACASDB features.
              </p>
            </div>
          </div>
        `}
      </div>
    `;
  }

  /**
   * Mount the license status badge
   */
  mountLicenseBadge() {
    const container = this.element?.querySelector('#pacasdb-license-badge');
    if (container && this.entitlementManager) {
      if (this.licenseStatusBadge) {
        this.licenseStatusBadge.destroy();
      }
      this.licenseStatusBadge = new LicenseStatusBadge(container, this.entitlementManager);
      this.licenseStatusBadge.render();
    }
  }

  /**
   * Attach event listeners to modal buttons
   */
  attachEventListeners() {
    if (!this.element) return;

    // Start Trial
    this.element.querySelector('[data-action="start-trial"]')?.addEventListener('click', async () => {
      await this.startTrial();
    });

    // Activate License
    this.element.querySelector('[data-action="activate-license"]')?.addEventListener('click', async () => {
      await this.showActivationDialog();
    });

    // Deactivate License
    this.element.querySelector('[data-action="deactivate-license"]')?.addEventListener('click', async () => {
      await this.deactivateLicense();
    });

    // Test Connection
    this.element.querySelector('[data-action="test-connection"]')?.addEventListener('click', async () => {
      await this.testConnection();
    });

    // Sync Vault
    this.element.querySelector('[data-action="sync-vault"]')?.addEventListener('click', async () => {
      await this.syncVaultNow();
    });
  }

  /**
   * Start free trial
   */
  async startTrial() {
    try {
      await this.entitlementManager.startTrial();
      this.context.showToast('Trial activated! You now have 30 days of premium access.', 'success');

      // Auto-enable the PACASDB plugin when trial is started
      await this.context.enablePlugin('pacasdb');

      this.refreshContent();
    } catch (error) {
      console.error('Failed to start trial:', error);
      this.context.showToast('Failed to start trial: ' + error.message, 'error');
    }
  }

  /**
   * Show activation dialog
   */
  async showActivationDialog() {
    this.activationDialog.onSuccess = async () => {
      this.context.showToast('License activated successfully!', 'success');

      // Auto-enable the PACASDB plugin when license is activated
      await this.context.enablePlugin('pacasdb');

      this.refreshContent();
    };
    this.activationDialog.show();
  }

  /**
   * Deactivate license
   */
  async deactivateLicense() {
    const confirmed = confirm('Are you sure you want to deactivate your license? This will remove premium features.');
    if (!confirmed) return;

    try {
      await this.entitlementManager.deactivateLicense();

      // Auto-disable the PACASDB plugin when license is deactivated
      await this.context.disablePlugin('pacasdb');

      this.context.showToast('License deactivated successfully.', 'success');
      this.refreshContent();
    } catch (error) {
      console.error('Failed to deactivate license:', error);
      this.context.showToast('Failed to deactivate license: ' + error.message, 'error');
    }
  }

  /**
   * Test connection to PACASDB server
   */
  async testConnection() {
    try {
      this.state.isTesting = true;
      this.updateButton('test-connection', 'Testing...', true);

      if (!this.pacasdbClient) {
        await this.initialize();
      }

      if (!this.pacasdbClient) {
        throw new Error('PACASDB client not available');
      }

      const connected = await this.pacasdbClient.connect();
      this.state.connected = connected;

      if (connected) {
        this.context.showToast('Successfully connected to PACASDB server', 'success');
        await this.fetchDatabaseStats();
        this.refreshContent();
      } else {
        this.context.showToast('Failed to connect to PACASDB server. Make sure it is running on localhost:8000.', 'error');
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      this.context.showToast('Connection test failed: ' + error.message, 'error');
      this.state.connected = false;
    } finally {
      this.state.isTesting = false;
      this.updateButton('test-connection', 'Test Connection', false);
    }
  }

  /**
   * Fetch database statistics
   */
  async fetchDatabaseStats() {
    try {
      if (!this.pacasdbClient || !this.pacasdbClient.isConnected()) {
        return;
      }

      const stats = await this.pacasdbClient.getStats();
      if (stats) {
        this.state.docCount = stats.document_count || 0;
        this.state.indexSize = stats.index_size || 0;
      }
    } catch (error) {
      console.error('Failed to fetch database stats:', error);
    }
  }

  /**
   * Sync vault to PACASDB
   */
  async syncVaultNow() {
    try {
      this.state.isSyncing = true;
      this.updateButton('sync-vault', 'Syncing...', true);

      if (!this.vaultSync) {
        await this.initialize();
      }

      if (!this.vaultSync) {
        throw new Error('VaultSync not available');
      }

      const summary = await this.vaultSync.syncAllDocuments(this.state.vaultPath);

      this.state.lastSync = new Date().toLocaleString();
      this.state.docCount = summary.indexed;

      this.context.showToast(
        `Sync complete! Indexed ${summary.indexed} documents (${summary.failed} failed)`,
        summary.failed > 0 ? 'warning' : 'success'
      );

      this.refreshContent();
    } catch (error) {
      console.error('Vault sync failed:', error);
      this.context.showToast('Vault sync failed: ' + error.message, 'error');
    } finally {
      this.state.isSyncing = false;
      this.updateButton('sync-vault', 'Sync Vault Now', false);
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
      this.mountLicenseBadge();
      this.attachEventListeners();
    }
  }

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Cleanup when modal is closed
   */
  cleanup() {
    if (this.licenseStatusBadge) {
      this.licenseStatusBadge.destroy();
      this.licenseStatusBadge = null;
    }
    this.element = null;
    this.modal = null;
  }
}

export default PacasDBSettings;
