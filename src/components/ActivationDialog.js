/**
 * ActivationDialog - Modal dialog for activating premium license
 * Shows input for license key and handles activation flow
 */
export default class ActivationDialog {
  constructor(entitlementManager) {
    this.entitlementManager = entitlementManager;
    this.modal = null;
    this.input = null;
    this.activateBtn = null;
    this.errorContainer = null;
    this.successContainer = null;
    this.onSuccess = null; // Callback when activation succeeds
    this.onClose = null; // Callback when dialog closes
  }

  /**
   * Show the activation dialog
   */
  show() {
    if (this.modal) {
      return; // Already showing
    }

    // Create modal backdrop
    this.modal = document.createElement('div');
    this.modal.className = 'activation-dialog-modal';
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    // Dialog content
    const content = document.createElement('div');
    content.className = 'dialog-content';
    content.addEventListener('click', (e) => e.stopPropagation());

    // Header
    const header = document.createElement('div');
    header.className = 'dialog-header';

    const title = document.createElement('h2');
    title.textContent = 'Activate Premium License';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    content.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'dialog-body';

    const description = document.createElement('p');
    description.textContent = 'Enter your license key to activate premium features:';
    body.appendChild(description);

    // Input field
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'license-key-input';
    this.input.placeholder = 'Enter your license key';
    this.input.addEventListener('input', () => this.clearError());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.activate();
      }
    });
    body.appendChild(this.input);

    // Error container
    this.errorContainer = document.createElement('div');
    this.errorContainer.className = 'error-container';
    body.appendChild(this.errorContainer);

    // Success container
    this.successContainer = document.createElement('div');
    this.successContainer.className = 'success-container';
    body.appendChild(this.successContainer);

    content.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'dialog-footer';

    const purchaseLink = document.createElement('a');
    purchaseLink.href = 'https://vaultapp.com/premium';
    purchaseLink.target = '_blank';
    purchaseLink.className = 'purchase-link';
    purchaseLink.textContent = 'Purchase License';
    footer.appendChild(purchaseLink);

    this.activateBtn = document.createElement('button');
    this.activateBtn.className = 'activate-btn';
    this.activateBtn.textContent = 'Activate';
    this.activateBtn.addEventListener('click', () => this.activate());
    footer.appendChild(this.activateBtn);

    content.appendChild(footer);

    this.modal.appendChild(content);
    document.body.appendChild(this.modal);

    // Focus input
    setTimeout(() => {
      if (this.input) {
        this.input.focus();
      }
    }, 0);

    // Add Escape key listener
    this.escapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  /**
   * Close and remove the dialog
   */
  close() {
    if (!this.modal) {
      return;
    }

    // Remove from DOM
    if (this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }

    // Clean up
    this.modal = null;
    this.input = null;
    this.activateBtn = null;
    this.errorContainer = null;
    this.successContainer = null;

    // Remove Escape listener
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    // Callback
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * Activate license with entered key
   */
  async activate() {
    const key = this.input.value.trim();

    // Validate
    if (!key) {
      this.showError('Please enter a license key');
      return;
    }

    // Show loading state
    this.setLoading(true);

    try {
      // Call entitlement manager to activate
      const result = await this.entitlementManager.activateLicense(key);

      // Success
      this.setLoading(false);
      this.showSuccess('License activated successfully!');

      // Callback
      if (this.onSuccess) {
        this.onSuccess(result);
      }

      // Auto-close after 2 seconds
      setTimeout(() => this.close(), 2000);

    } catch (error) {
      // Failure
      this.setLoading(false);
      this.showError(error.message || 'Activation failed');
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message) {
    this.clearSuccess();
    this.errorContainer.innerHTML = '';

    const errorMsg = document.createElement('div');
    errorMsg.className = 'error-message';
    errorMsg.textContent = message;
    this.errorContainer.appendChild(errorMsg);
  }

  /**
   * Clear error message
   */
  clearError() {
    if (this.errorContainer) {
      this.errorContainer.innerHTML = '';
    }
  }

  /**
   * Show success message
   * @param {string} message - Success message
   */
  showSuccess(message) {
    this.clearError();
    this.successContainer.innerHTML = '';

    const successMsg = document.createElement('div');
    successMsg.className = 'success-message';
    successMsg.textContent = message;
    this.successContainer.appendChild(successMsg);
  }

  /**
   * Clear success message
   */
  clearSuccess() {
    if (this.successContainer) {
      this.successContainer.innerHTML = '';
    }
  }

  /**
   * Set loading state
   * @param {boolean} loading - Whether loading
   */
  setLoading(loading) {
    if (!this.input || !this.activateBtn) {
      return;
    }

    this.input.disabled = loading;
    this.activateBtn.disabled = loading;
    this.activateBtn.textContent = loading ? 'Activating...' : 'Activate';
  }
}
