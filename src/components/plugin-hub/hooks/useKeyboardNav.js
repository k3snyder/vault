import { useEffect, useRef, useCallback } from 'react';

/**
 * @typedef {Object} KeyboardNavOptions
 * @property {boolean} [enabled=true] - Whether keyboard navigation is enabled
 * @property {boolean} [ignoreInputs=true] - Whether to ignore events when input elements are focused
 * @property {boolean} [preventDefault=false] - Whether to prevent default behavior
 * @property {boolean} [stopPropagation=false] - Whether to stop event propagation
 * @property {number} [priority=0] - Priority level for handler (higher = higher priority)
 */

// Global registry for keyboard handlers with priority
const handlerRegistry = new Map();

/**
 * Hook for keyboard navigation with priority-based handler system
 * @param {Object.<string, Function>} handlers - Map of key combinations to handler functions
 * @param {KeyboardNavOptions} options - Configuration options
 */
export function useKeyboardNav(handlers, options = {}) {
  const {
    enabled = true,
    ignoreInputs = true,
    preventDefault = false,
    stopPropagation = false,
    priority = 0
  } = options;

  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);

  // Update refs when they change
  useEffect(() => {
    handlersRef.current = handlers;
    optionsRef.current = options;
  }, [handlers, options]);

  // Create key string from event
  const getKeyString = useCallback((event) => {
    const parts = [];
    
    // Check for modifier keys
    if (event.metaKey || event.ctrlKey) parts.push('cmd');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    
    // Add the actual key
    const key = event.key.toLowerCase();
    
    // Normalize key names
    const normalizedKey = key === ' ' ? 'space' : key;
    parts.push(normalizedKey);
    
    return parts.join('+');
  }, []);

  // Check if we should ignore this event
  const shouldIgnoreEvent = useCallback((event) => {
    if (!ignoreInputs) return false;
    
    const target = event.target;
    const tagName = target.tagName?.toLowerCase();
    
    // Ignore if target is an input element
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return true;
    }
    
    // Ignore if target is contenteditable
    if (target.contentEditable === 'true') {
      return true;
    }
    
    // Ignore if target has role of textbox
    if (target.getAttribute('role') === 'textbox') {
      return true;
    }
    
    return false;
  }, [ignoreInputs]);

  // Main keyboard event handler
  const handleKeyDown = useCallback((event) => {
    if (!enabled) return;
    if (shouldIgnoreEvent(event)) return;
    
    // Check for exact key match first
    let handler = handlersRef.current[event.key];
    
    // If no exact match, check for key combination
    if (!handler) {
      const keyString = getKeyString(event);
      handler = handlersRef.current[keyString];
    }
    
    if (handler) {
      if (preventDefault) {
        event.preventDefault();
      }
      
      if (stopPropagation) {
        event.stopPropagation();
      }
      
      // Call handler and check if it wants to stop propagation
      const stopFurtherHandling = handler(event);
      
      if (stopFurtherHandling) {
        event.stopImmediatePropagation();
      }
    }
  }, [enabled, shouldIgnoreEvent, getKeyString, preventDefault, stopPropagation]);

  // Register/unregister handler with priority
  useEffect(() => {
    if (!enabled) return;
    
    // Create handler entry with priority
    const handlerEntry = {
      handler: handleKeyDown,
      priority
    };
    
    // Generate unique ID for this handler
    const handlerId = Symbol('keyboard-handler');
    
    // Add to registry
    handlerRegistry.set(handlerId, handlerEntry);
    
    // Sort handlers by priority and create composite handler
    const createCompositeHandler = () => {
      const sortedHandlers = Array.from(handlerRegistry.values())
        .sort((a, b) => b.priority - a.priority);
      
      return (event) => {
        for (const { handler } of sortedHandlers) {
          handler(event);
          
          // Check if event was stopped
          if (event.defaultPrevented || event.cancelBubble) {
            break;
          }
        }
      };
    };
    
    // Use composite handler
    const compositeHandler = createCompositeHandler();
    
    // Add event listener
    document.addEventListener('keydown', compositeHandler);
    
    // Cleanup
    return () => {
      handlerRegistry.delete(handlerId);
      document.removeEventListener('keydown', compositeHandler);
    };
  }, [enabled, handleKeyDown, priority]);
}

/**
 * Focus management utilities
 */
export const FocusUtils = {
  /**
   * Check if any input element is currently focused
   * @returns {boolean}
   */
  isInputFocused() {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    
    const tagName = activeElement.tagName?.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      activeElement.contentEditable === 'true' ||
      activeElement.getAttribute('role') === 'textbox'
    );
  },

  /**
   * Focus the first focusable element in a container
   * @param {HTMLElement} container
   */
  focusFirst(container) {
    if (!container) return;
    
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  },

  /**
   * Trap focus within a container (useful for modals)
   * @param {HTMLElement} container
   * @returns {Function} Cleanup function
   */
  trapFocus(container) {
    if (!container) return () => {};
    
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusable.length === 0) return () => {};
    
    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];
    
    const handleKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      
      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };
    
    container.addEventListener('keydown', handleKeyDown);
    
    // Focus first element
    firstElement.focus();
    
    // Return cleanup function
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  },

  /**
   * Restore focus to a previously focused element
   * @param {HTMLElement} element
   */
  restoreFocus(element) {
    if (element && typeof element.focus === 'function') {
      element.focus();
    }
  }
};

export default useKeyboardNav;