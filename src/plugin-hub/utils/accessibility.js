/**
 * Accessibility Utilities
 * WCAG AA compliant helpers for keyboard navigation and screen readers
 */

/**
 * Manage focus trap within a container
 */
export class FocusTrap {
  constructor(container, options = {}) {
    this.container = container;
    this.onEscape = options.onEscape;
    this.returnFocus = options.returnFocus !== false;
    this.previousFocus = null;
    this.focusableElements = [];
    
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleFocusIn = this.handleFocusIn.bind(this);
  }
  
  /**
   * Activate the focus trap
   */
  activate() {
    // Store previous focus
    this.previousFocus = document.activeElement;
    
    // Get focusable elements
    this.updateFocusableElements();
    
    // Add event listeners
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('focusin', this.handleFocusIn);
    
    // Focus first element
    if (this.focusableElements.length > 0) {
      this.focusableElements[0].focus();
    }
  }
  
  /**
   * Deactivate the focus trap
   */
  deactivate() {
    // Remove event listeners
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('focusin', this.handleFocusIn);
    
    // Return focus
    if (this.returnFocus && this.previousFocus) {
      this.previousFocus.focus();
    }
  }
  
  /**
   * Update the list of focusable elements
   */
  updateFocusableElements() {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      'details',
      'summary'
    ].join(',');
    
    this.focusableElements = Array.from(
      this.container.querySelectorAll(selector)
    ).filter(el => {
      // Check if element is visible
      return el.offsetParent !== null;
    });
  }
  
  /**
   * Handle keyboard events
   */
  handleKeyDown(e) {
    if (e.key === 'Tab') {
      this.handleTab(e);
    } else if (e.key === 'Escape' && this.onEscape) {
      this.onEscape();
    }
  }
  
  /**
   * Handle tab navigation
   */
  handleTab(e) {
    if (this.focusableElements.length === 0) return;
    
    const currentIndex = this.focusableElements.indexOf(document.activeElement);
    
    if (e.shiftKey) {
      // Backwards
      if (currentIndex <= 0) {
        e.preventDefault();
        this.focusableElements[this.focusableElements.length - 1].focus();
      }
    } else {
      // Forwards
      if (currentIndex === this.focusableElements.length - 1) {
        e.preventDefault();
        this.focusableElements[0].focus();
      }
    }
  }
  
  /**
   * Handle focus events
   */
  handleFocusIn(e) {
    // If focus moves outside the container, bring it back
    if (!this.container.contains(e.target)) {
      e.preventDefault();
      this.updateFocusableElements();
      if (this.focusableElements.length > 0) {
        this.focusableElements[0].focus();
      }
    }
  }
}

/**
 * Announce messages to screen readers
 */
export class ScreenReaderAnnouncer {
  constructor() {
    this.announcer = null;
    this.init();
  }
  
  /**
   * Initialize the announcer element
   */
  init() {
    if (!this.announcer) {
      this.announcer = document.createElement('div');
      this.announcer.className = 'sr-announcer';
      this.announcer.setAttribute('role', 'status');
      this.announcer.setAttribute('aria-live', 'polite');
      this.announcer.setAttribute('aria-atomic', 'true');
      this.announcer.style.cssText = `
        position: absolute;
        left: -10000px;
        width: 1px;
        height: 1px;
        overflow: hidden;
      `;
      document.body.appendChild(this.announcer);
    }
  }
  
  /**
   * Announce a message
   */
  announce(message, priority = 'polite') {
    if (!this.announcer) {
      this.init();
    }
    
    // Set priority
    this.announcer.setAttribute('aria-live', priority);
    
    // Clear and set message
    this.announcer.textContent = '';
    setTimeout(() => {
      this.announcer.textContent = message;
    }, 100);
    
    // Clear after announcement
    setTimeout(() => {
      this.announcer.textContent = '';
    }, 1000);
  }
  
  /**
   * Destroy the announcer
   */
  destroy() {
    if (this.announcer && this.announcer.parentNode) {
      this.announcer.parentNode.removeChild(this.announcer);
      this.announcer = null;
    }
  }
}

/**
 * Keyboard navigation manager
 */
export class KeyboardNavigator {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.items = [];
    this.currentIndex = -1;
    
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }
  
  /**
   * Initialize navigation
   */
  init() {
    this.updateItems();
    this.container.addEventListener('keydown', this.handleKeyDown);
  }
  
  /**
   * Destroy navigation
   */
  destroy() {
    this.container.removeEventListener('keydown', this.handleKeyDown);
  }
  
  /**
   * Update navigable items
   */
  updateItems() {
    const selector = this.options.itemSelector || '[role="option"], [role="menuitem"], .plugin-card';
    this.items = Array.from(this.container.querySelectorAll(selector));
  }
  
  /**
   * Handle keyboard events
   */
  handleKeyDown(e) {
    switch(e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.navigate(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.navigate(-1);
        break;
      case 'Home':
        e.preventDefault();
        this.navigateToIndex(0);
        break;
      case 'End':
        e.preventDefault();
        this.navigateToIndex(this.items.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
          e.preventDefault();
          this.selectItem(this.items[this.currentIndex]);
        }
        break;
    }
  }
  
  /**
   * Navigate by offset
   */
  navigate(offset) {
    this.updateItems();
    
    if (this.items.length === 0) return;
    
    let newIndex = this.currentIndex + offset;
    
    // Wrap around
    if (newIndex < 0) {
      newIndex = this.items.length - 1;
    } else if (newIndex >= this.items.length) {
      newIndex = 0;
    }
    
    this.navigateToIndex(newIndex);
  }
  
  /**
   * Navigate to specific index
   */
  navigateToIndex(index) {
    if (index < 0 || index >= this.items.length) return;
    
    // Remove previous highlight
    if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
      this.items[this.currentIndex].classList.remove('keyboard-focused');
      this.items[this.currentIndex].setAttribute('aria-selected', 'false');
    }
    
    // Add new highlight
    this.currentIndex = index;
    this.items[index].classList.add('keyboard-focused');
    this.items[index].setAttribute('aria-selected', 'true');
    this.items[index].focus();
    
    // Scroll into view if needed
    this.items[index].scrollIntoView({
      block: 'nearest',
      behavior: 'smooth'
    });
  }
  
  /**
   * Select an item
   */
  selectItem(item) {
    if (this.options.onSelect) {
      this.options.onSelect(item);
    } else {
      // Default: click the item
      item.click();
    }
  }
}

/**
 * Check color contrast ratio
 */
export function checkContrast(color1, color2) {
  // Convert hex to RGB
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  
  // Calculate relative luminance
  const lum1 = getRelativeLuminance(rgb1);
  const lum2 = getRelativeLuminance(rgb2);
  
  // Calculate contrast ratio
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  
  return {
    ratio: ratio.toFixed(2),
    passes: {
      aa: ratio >= 4.5,       // WCAG AA for normal text
      aaLarge: ratio >= 3,    // WCAG AA for large text
      aaa: ratio >= 7,        // WCAG AAA for normal text
      aaaLarge: ratio >= 4.5  // WCAG AAA for large text
    }
  };
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Calculate relative luminance
 */
function getRelativeLuminance(rgb) {
  const sRGB = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const linear = sRGB.map(val => {
    if (val <= 0.03928) {
      return val / 12.92;
    }
    return Math.pow((val + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * Add ARIA labels to elements
 */
export function addAriaLabels(container) {
  // Add labels to buttons without text
  container.querySelectorAll('button').forEach(button => {
    if (!button.textContent.trim() && !button.getAttribute('aria-label')) {
      // Try to infer label from class or title
      const title = button.getAttribute('title');
      if (title) {
        button.setAttribute('aria-label', title);
      }
    }
  });
  
  // Add roles to interactive elements
  container.querySelectorAll('.plugin-card').forEach(card => {
    if (!card.getAttribute('role')) {
      card.setAttribute('role', 'article');
    }
  });
  
  // Add descriptions to complex controls
  container.querySelectorAll('.plugin-toggle input').forEach(toggle => {
    const card = toggle.closest('.plugin-card');
    if (card) {
      const pluginName = card.querySelector('h3')?.textContent;
      if (pluginName) {
        toggle.setAttribute('aria-label', `Enable/disable ${pluginName}`);
      }
    }
  });
}

// Export utilities
export default {
  FocusTrap,
  ScreenReaderAnnouncer,
  KeyboardNavigator,
  checkContrast,
  addAriaLabels
};