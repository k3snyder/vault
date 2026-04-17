// ModeToggle.js - Toggle between Chat and CLI modes
import { icons } from '../icons/icon-utils.js';

export class ModeToggle {
  constructor(options = {}) {
    this.currentMode = options.initialMode || 'chat';
    this.onToggle = options.onToggle || (() => {});
    this.disabled = false;
    this.element = null;
    this.button = null;
    this.keydownHandler = null; // Store reference for cleanup

    this.createUI();
    this.setupKeyboardShortcuts();
  }
  
  createUI() {
    // Create container
    this.element = document.createElement('div');
    this.element.className = 'mode-toggle-container';
    
    // Create toggle button
    this.button = document.createElement('button');
    this.button.className = 'mode-toggle-button';
    this.button.setAttribute('role', 'switch');
    this.button.setAttribute('aria-checked', this.currentMode === 'cli');
    this.button.setAttribute('aria-label', `Switch to ${this.currentMode === 'chat' ? 'CLI' : 'Chat'} mode`);
    this.button.title = `${this.currentMode === 'chat' ? 'CLI' : 'Chat'} Mode (${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+\`)`;
    
    this.updateButtonContent();
    
    // Add click handler
    this.button.addEventListener('click', () => {
      if (!this.disabled) {
        this.toggle();
      }
    });
    
    this.element.appendChild(this.button);
  }
  
  updateButtonContent() {
    const isCliMode = this.currentMode === 'cli';
    
    this.button.innerHTML = `
      ${icons.messageSquare({ class: `mode-icon mode-icon-chat ${!isCliMode ? 'active' : ''}` })}
      <div class="mode-toggle-track">
        <div class="mode-toggle-thumb ${isCliMode ? 'cli-mode' : ''}"></div>
      </div>
      ${icons.terminal({ class: `mode-icon mode-icon-cli ${isCliMode ? 'active' : ''}` })}
    `;
    
    this.button.classList.toggle('cli-mode', isCliMode);
  }
  
  setupKeyboardShortcuts() {
    // Store handler reference for cleanup
    this.keydownHandler = (e) => {
      // Cmd/Ctrl + ` to toggle mode
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        if (!this.disabled) {
          this.toggle();
        }
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  removeKeyboardShortcuts() {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
  
  toggle() {
    this.currentMode = this.currentMode === 'chat' ? 'cli' : 'chat';
    this.updateButtonContent();
    this.button.setAttribute('aria-checked', this.currentMode === 'cli');
    this.button.setAttribute('aria-label', `Switch to ${this.currentMode === 'chat' ? 'CLI' : 'Chat'} mode`);
    this.button.title = `${this.currentMode === 'chat' ? 'CLI' : 'Chat'} Mode (${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+\`)`;
    
    // Emit toggle event
    this.onToggle(this.currentMode);
    
    // Log for debugging
    console.log(`🔄 Mode toggled to: ${this.currentMode}`);
  }
  
  setMode(mode) {
    if (mode !== 'chat' && mode !== 'cli') {
      console.error('Invalid mode:', mode);
      return;
    }
    
    if (this.currentMode !== mode) {
      this.currentMode = mode;
      this.updateButtonContent();
      this.button.setAttribute('aria-checked', this.currentMode === 'cli');
      this.button.setAttribute('aria-label', `Switch to ${this.currentMode === 'chat' ? 'CLI' : 'Chat'} mode`);
    }
  }
  
  setDisabled(disabled) {
    this.disabled = disabled;
    this.button.disabled = disabled;
    this.button.classList.toggle('disabled', disabled);
  }
  
  mount(container) {
    container.appendChild(this.element);
  }
  
  unmount() {
    this.removeKeyboardShortcuts();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }

  destroy() {
    this.unmount();
    this.element = null;
    this.button = null;
  }
}