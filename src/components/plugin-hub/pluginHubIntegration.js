import React from 'react';
import ReactDOM from 'react-dom/client';
import { PluginHub } from './PluginHub';
import { PluginProvider } from './contexts/PluginContext';

/**
 * Plugin Hub integration module for command palette and keyboard shortcuts
 */
class PluginHubIntegration {
  constructor() {
    this.isOpen = false;
    this.root = null;
    this.container = null;
  }

  /**
   * Initialize the Plugin Hub integration
   * This should be called once when the app starts
   */
  init() {
    // Register global keyboard shortcut
    this.registerKeyboardShortcut();
    
    // Create container for Plugin Hub
    this.createContainer();
    
    console.log('Plugin Hub integration initialized');
  }

  /**
   * Register keyboard shortcut for opening Plugin Hub
   */
  registerKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      // Cmd+Shift+P (or Ctrl+Shift+P on Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      }
    });
  }

  /**
   * Create container element for Plugin Hub
   */
  createContainer() {
    // Check if container already exists
    if (document.getElementById('plugin-hub-root')) {
      this.container = document.getElementById('plugin-hub-root');
      return;
    }

    // Create new container
    this.container = document.createElement('div');
    this.container.id = 'plugin-hub-root';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10000;
      display: none;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
    `;
    document.body.appendChild(this.container);
  }

  /**
   * Open the Plugin Hub
   */
  open() {
    if (this.isOpen) return;

    this.isOpen = true;
    this.container.style.display = 'block';

    // Create React root if not exists
    if (!this.root) {
      this.root = ReactDOM.createRoot(this.container);
    }

    // Render Plugin Hub
    this.root.render(
      <PluginProvider>
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: '1200px',
          height: '80%',
          maxHeight: '800px',
          background: 'var(--background-primary, #1e1e1e)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
        }}>
          <PluginHub onClose={() => this.close()} />
        </div>
      </PluginProvider>
    );

    // Focus trap
    this.container.focus();
    
    console.log('Plugin Hub opened');
  }

  /**
   * Close the Plugin Hub
   */
  close() {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.container.style.display = 'none';

    // Unmount React component
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }

    console.log('Plugin Hub closed');
  }

  /**
   * Toggle Plugin Hub open/closed
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Register a command in the command palette
   * This is a placeholder for when a command palette system exists
   */
  registerCommand(command) {
    // This would integrate with a command palette system if one exists
    // For now, we just log it
    console.log('Registering command:', command);
    
    // Example command structure:
    // {
    //   id: 'plugin-hub.open',
    //   name: 'Open Plugin Hub',
    //   keybinding: 'cmd+shift+p',
    //   handler: () => this.open()
    // }
  }

  /**
   * Get available commands for the Plugin Hub
   */
  getCommands() {
    return [
      {
        id: 'plugin-hub.open',
        name: 'Plugin Hub: Open',
        description: 'Open the Plugin Hub to manage plugins',
        keybinding: 'cmd+shift+p',
        handler: () => this.open()
      },
      {
        id: 'plugin-hub.discover',
        name: 'Plugin Hub: Discover Plugins',
        description: 'Browse and install new plugins',
        handler: () => {
          this.open();
          // TODO: Switch to discover view
        }
      },
      {
        id: 'plugin-hub.installed',
        name: 'Plugin Hub: View Installed Plugins',
        description: 'Manage installed plugins',
        handler: () => {
          this.open();
          // TODO: Switch to installed view
        }
      },
      {
        id: 'plugin-hub.permissions',
        name: 'Plugin Hub: Manage Permissions',
        description: 'Review and manage plugin permissions',
        handler: () => {
          this.open();
          // TODO: Switch to permissions view
        }
      },
      {
        id: 'plugin-hub.resources',
        name: 'Plugin Hub: Monitor Resources',
        description: 'View plugin resource usage',
        handler: () => {
          this.open();
          // TODO: Switch to resources view
        }
      }
    ];
  }
}

// Create singleton instance
const pluginHubIntegration = new PluginHubIntegration();

// Export for use in main app
export default pluginHubIntegration;

// Also export for direct use
export { pluginHubIntegration };