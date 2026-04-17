import { renderHook } from '@testing-library/react';
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useKeyboardNav } from './useKeyboardNav';

describe('useKeyboardNav Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Registration and Cleanup', () => {
    test('should register keyboard handlers on mount', () => {
      const handlers = {
        '1': jest.fn(),
        '2': jest.fn()
      };
      
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      
      renderHook(() => useKeyboardNav(handlers));
      
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    test('should cleanup keyboard handlers on unmount', () => {
      const handlers = {
        '1': jest.fn()
      };
      
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
      
      const { unmount } = renderHook(() => useKeyboardNav(handlers));
      
      unmount();
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  describe('Handler Execution', () => {
    test('should execute handler for matching key', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      const handlers = {
        '1': handler1,
        '2': handler2
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).not.toHaveBeenCalled();
    });

    test('should handle modifier keys', () => {
      const handler = jest.fn();
      
      const handlers = {
        'cmd+shift+p': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        metaKey: true,
        shiftKey: true
      });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalledWith(event);
    });

    test('should handle ctrl key as cmd on Windows/Linux', () => {
      const handler = jest.fn();
      
      const handlers = {
        'cmd+p': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true
      });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalledWith(event);
    });

    test('should ignore events when input is focused by default', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      // Create and focus an input element
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      expect(handler).not.toHaveBeenCalled();
      
      // Cleanup
      document.body.removeChild(input);
    });

    test('should ignore events when textarea is focused', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      expect(handler).not.toHaveBeenCalled();
      
      // Cleanup
      document.body.removeChild(textarea);
    });

    test('should ignore events when contenteditable is focused', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);
      div.focus();
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      expect(handler).not.toHaveBeenCalled();
      
      // Cleanup
      document.body.removeChild(div);
    });
  });

  describe('Options', () => {
    test('should respect enabled option', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      const { rerender } = renderHook(
        ({ enabled }) => useKeyboardNav(handlers, { enabled }),
        { initialProps: { enabled: false } }
      );
      
      // Handler should not be called when disabled
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      expect(handler).not.toHaveBeenCalled();
      
      // Enable and try again
      rerender({ enabled: true });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalled();
    });

    test('should respect ignoreInputs option', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      renderHook(() => useKeyboardNav(handlers, { ignoreInputs: false }));
      
      // Create and focus an input element
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      // Should be called even when input is focused
      expect(handler).toHaveBeenCalled();
      
      // Cleanup
      document.body.removeChild(input);
    });

    test('should respect preventDefault option', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      renderHook(() => useKeyboardNav(handlers, { preventDefault: true }));
      
      const event = new KeyboardEvent('keydown', { key: '1', cancelable: true });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
      
      document.dispatchEvent(event);
      
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    test('should respect stopPropagation option', () => {
      const handler = jest.fn();
      
      const handlers = {
        '1': handler
      };
      
      renderHook(() => useKeyboardNav(handlers, { stopPropagation: true }));
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      const stopPropagationSpy = jest.spyOn(event, 'stopPropagation');
      
      document.dispatchEvent(event);
      
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Priority System', () => {
    test('should handle priority levels', () => {
      const highPriorityHandler = jest.fn(() => true); // Returns true to stop propagation
      const lowPriorityHandler = jest.fn();
      
      // High priority hook
      renderHook(() => useKeyboardNav(
        { '1': highPriorityHandler },
        { priority: 10 }
      ));
      
      // Low priority hook
      renderHook(() => useKeyboardNav(
        { '1': lowPriorityHandler },
        { priority: 1 }
      ));
      
      const event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      
      expect(highPriorityHandler).toHaveBeenCalled();
      expect(lowPriorityHandler).not.toHaveBeenCalled();
    });
  });

  describe('Special Keys', () => {
    test('should handle Escape key', () => {
      const handler = jest.fn();
      
      const handlers = {
        'Escape': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalled();
    });

    test('should handle Enter key', () => {
      const handler = jest.fn();
      
      const handlers = {
        'Enter': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalled();
    });

    test('should handle Tab key', () => {
      const handler = jest.fn();
      
      const handlers = {
        'Tab': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalled();
    });

    test('should handle arrow keys', () => {
      const handlers = {
        'ArrowUp': jest.fn(),
        'ArrowDown': jest.fn(),
        'ArrowLeft': jest.fn(),
        'ArrowRight': jest.fn()
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      Object.keys(handlers).forEach(key => {
        const event = new KeyboardEvent('keydown', { key });
        document.dispatchEvent(event);
        expect(handlers[key]).toHaveBeenCalled();
      });
    });

    test('should handle slash key for search', () => {
      const handler = jest.fn();
      
      const handlers = {
        '/': handler
      };
      
      renderHook(() => useKeyboardNav(handlers));
      
      const event = new KeyboardEvent('keydown', { key: '/' });
      document.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Handler Updates', () => {
    test('should update handlers when dependencies change', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      const { rerender } = renderHook(
        ({ handlers }) => useKeyboardNav(handlers),
        { initialProps: { handlers: { '1': handler1 } } }
      );
      
      // Test initial handler
      let event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      expect(handler1).toHaveBeenCalled();
      
      // Update handlers
      rerender({ handlers: { '2': handler2 } });
      
      // Test new handler
      event = new KeyboardEvent('keydown', { key: '2' });
      document.dispatchEvent(event);
      expect(handler2).toHaveBeenCalled();
      
      // Old handler should not work
      handler1.mockClear();
      event = new KeyboardEvent('keydown', { key: '1' });
      document.dispatchEvent(event);
      expect(handler1).not.toHaveBeenCalled();
    });
  });
});