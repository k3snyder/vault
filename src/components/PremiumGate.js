/**
 * PremiumGate - Component that gates premium features
 * Shows upgrade prompt when user doesn't have premium access
 */
export default class PremiumGate {
  constructor(entitlementManager, featureName = 'Premium Feature') {
    this.entitlementManager = entitlementManager;
    this.featureName = featureName;
    this.element = null;
  }

  /**
   * Static wrap function - returns null if premium enabled, gate instance otherwise
   * @param {EntitlementManager} manager
   * @param {string} featureName
   * @returns {PremiumGate|null}
   */
  static wrap(manager, featureName) {
    if (manager.isPremiumEnabled()) {
      return null;
    }
    return new PremiumGate(manager, featureName);
  }

  /**
   * Create and return the gate element
   * @returns {HTMLElement}
   */
  render() {
    if (this.element) {
      return this.element;
    }

    const status = this.entitlementManager.getStatus();
    const container = document.createElement('div');
    container.className = 'premium-gate';

    const content = document.createElement('div');
    content.className = 'gate-content';

    const title = document.createElement('h3');
    title.textContent = `${this.featureName} requires premium`;
    content.appendChild(title);

    const description = document.createElement('p');
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';

    // Backend returns lowercase 'status' field
    if (status.status === 'unlicensed') {
      description.textContent = 'Unlock semantic search and cognitive memory features with a free 30-day trial.';

      const trialButton = this.createButton('Start Free Trial', 'primary', () => this.handleStartTrial());
      const purchaseButton = this.createButton('Purchase License', 'secondary', () => this.handlePurchase());

      buttonContainer.appendChild(trialButton);
      buttonContainer.appendChild(purchaseButton);

    } else if (status.status === 'expired') {
      description.textContent = 'Your trial has expired. Purchase a license to continue using premium features.';

      const purchaseButton = this.createButton('Purchase License', 'primary', () => this.handlePurchase());
      buttonContainer.appendChild(purchaseButton);

    } else if (status.status === 'invalid') {
      description.textContent = 'Your license is invalid. Please purchase a valid license.';

      const purchaseButton = this.createButton('Purchase License', 'primary', () => this.handlePurchase());
      buttonContainer.appendChild(purchaseButton);

    } else {
      description.textContent = 'Premium access required.';

      const purchaseButton = this.createButton('Purchase License', 'primary', () => this.handlePurchase());
      buttonContainer.appendChild(purchaseButton);
    }

    content.appendChild(description);
    content.appendChild(buttonContainer);
    container.appendChild(content);

    this.element = container;
    return container;
  }

  /**
   * Create a button element
   * @param {string} text - Button text
   * @param {string} type - Button type ('primary' or 'secondary')
   * @param {Function} onClick - Click handler
   * @returns {HTMLElement}
   */
  createButton(text, type, onClick) {
    const button = document.createElement('button');
    button.textContent = text;
    button.className = `${type}-button`;
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * Handle start trial action
   */
  handleStartTrial() {
    // Will be implemented when settings integration is ready
    console.log('Start trial clicked');
  }

  /**
   * Handle purchase action
   */
  handlePurchase() {
    // Will be implemented when payment integration is ready
    console.log('Purchase clicked');
  }

  /**
   * Remove the gate element from DOM
   */
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
