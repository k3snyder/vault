import { invoke } from '@tauri-apps/api/core';

/**
 * EntitlementManager - Manages license status and premium feature access
 *
 * Responsibilities:
 * - Fetch license status from Rust backend via Tauri IPC
 * - Poll license status hourly for validation
 * - Provide reactive state management for UI updates
 * - Prevent duplicate polling intervals
 *
 * Singleton pattern ensures one polling interval across the app.
 */
class EntitlementManager {
  constructor() {
    this.status = { type: 'Unlicensed' };
    this.listeners = [];
    this.pollingInterval = null;
  }

  /**
   * Initialize the entitlement manager
   * Fetches initial status and sets up hourly polling
   */
  async initialize() {
    try {
      // Fetch initial license status
      const status = await invoke('get_license_status');
      this.status = status;
      this.notifyListeners();

      // Set up hourly polling (3600000ms = 1 hour)
      // Only create interval if one doesn't already exist
      if (!this.pollingInterval) {
        this.pollingInterval = setInterval(async () => {
          try {
            const status = await invoke('get_license_status');
            this.status = status;
            this.notifyListeners();
          } catch (error) {
            console.error('Failed to poll license status:', error);
            // Keep existing status on error
          }
        }, 3600000);
      }
    } catch (error) {
      console.error('Failed to initialize entitlement manager:', error);
      // Set status to invalid on error
      this.status = {
        type: 'Invalid',
        reason: error.message || 'Failed to fetch license status'
      };
      this.notifyListeners();
    }
  }

  /**
   * Get current license status
   * @returns {Object} Current license status
   */
  getStatus() {
    return this.status;
  }

  /**
   * Check if premium features are enabled
   * @returns {boolean} True if user has valid premium license
   */
  isPremiumEnabled() {
    if (!this.status || typeof this.status !== 'object') {
      return false;
    }
    // Backend returns lowercase status field: 'trial', 'licensed', 'graceperiod'
    return ['trial', 'licensed', 'graceperiod'].includes(this.status.status);
  }

  /**
   * Get days remaining for Trial or GracePeriod status
   * @returns {number|null} Days remaining or null if not applicable
   */
  getDaysRemaining() {
    if (!this.status || typeof this.status !== 'object') {
      return null;
    }

    // Backend returns lowercase status field
    switch (this.status.status) {
      case 'trial':
        return this.status.days_remaining || null;

      case 'graceperiod':
        if (this.status.grace_expires_at) {
          const expiresAt = new Date(this.status.grace_expires_at);
          const now = new Date();
          const diffMs = expiresAt - now;
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          return Math.max(0, diffDays);
        }
        return null;

      case 'expired':
        return 0;

      default:
        return null;
    }
  }

  /**
   * Get user-friendly status message
   * @returns {string} Human-readable status message
   */
  getStatusMessage() {
    if (!this.status || typeof this.status !== 'object') {
      return 'Unknown Status';
    }

    // Backend returns lowercase status field
    switch (this.status.status) {
      case 'unlicensed':
        return 'No active license';

      case 'trial':
        const trialDays = this.status.days_remaining || 0;
        return `Trial: ${trialDays} days remaining`;

      case 'licensed':
        return 'Premium Active';

      case 'expired':
        return 'License Expired';

      case 'graceperiod':
        const graceDays = this.getDaysRemaining();
        return `Grace Period: ${graceDays} days remaining`;

      case 'invalid':
        return 'Invalid License';

      default:
        return 'Unknown Status';
    }
  }

  /**
   * Add listener for status changes
   * @param {Function} callback - Called when status changes
   * @returns {Function} Unsubscribe function
   */
  addListener(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Notify all listeners of status change
   */
  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.status);
      } catch (error) {
        console.error('Error in entitlement listener:', error);
      }
    });
  }

  /**
   * Cleanup polling interval
   * Should be called when app is closing or manager is being destroyed
   */
  cleanup() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Manually refresh license status
   * Useful for immediate validation after activation
   */
  async refresh() {
    try {
      const status = await invoke('get_license_status');
      this.status = status;
      this.notifyListeners();
      return status;
    } catch (error) {
      console.error('Failed to refresh license status:', error);
      throw error;
    }
  }

  /**
   * Activate a license key
   * @param {string} key - License key to activate
   * @returns {Promise<Object>} License info on success
   */
  async activateLicense(key) {
    try {
      const result = await invoke('activate_license', { key });
      await this.refresh(); // Refresh status after activation
      return result;
    } catch (error) {
      console.error('Failed to activate license:', error);
      throw error;
    }
  }

  /**
   * Deactivate current license
   * @returns {Promise<Object>} Deactivation result
   */
  async deactivateLicense() {
    try {
      const result = await invoke('deactivate_license');
      await this.refresh(); // Refresh status after deactivation
      return result;
    } catch (error) {
      console.error('Failed to deactivate license:', error);
      throw error;
    }
  }

  /**
   * Start free trial
   * @returns {Promise<Object>} Trial status
   */
  async startTrial() {
    try {
      const result = await invoke('start_trial_cmd');
      await this.refresh(); // Refresh status after trial start
      return result;
    } catch (error) {
      console.error('Failed to start trial:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default EntitlementManager;
