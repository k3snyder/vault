import React, { useRef, useEffect, useState } from 'react';
import { usePluginContext } from './contexts/PluginContext';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { NavigationSidebar } from './components/NavigationSidebar';
import { SearchBar } from './components/SearchBar';
import { DiscoverView } from './views/DiscoverView';
import { InstalledView } from './views/InstalledView';
import { PermissionsView } from './views/PermissionsView';
import { ResourcesView } from './views/ResourcesView';
import './PluginHub.css';

/**
 * Main Plugin Hub container component
 * @param {Object} props
 * @param {Function} props.onClose - Callback when Plugin Hub should close
 */
export function PluginHub({ onClose }) {
  const { state, setCurrentView } = usePluginContext();
  const searchRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');

  // View components map
  const viewComponents = {
    discover: DiscoverView,
    installed: InstalledView,
    permissions: PermissionsView,
    resources: ResourcesView
  };

  // Get current view component
  const CurrentView = viewComponents[state.currentView] || InstalledView;

  // Announce view changes for screen readers
  const announceViewChange = (viewName) => {
    setAnnouncement(`Switched to ${viewName} view`);
    // Clear announcement after a short delay
    setTimeout(() => setAnnouncement(''), 1000);
  };

  // Keyboard navigation handlers
  const keyboardHandlers = {
    '1': () => {
      setCurrentView('discover');
      announceViewChange('Discover');
    },
    '2': () => {
      setCurrentView('installed');
      announceViewChange('Installed');
    },
    '3': () => {
      setCurrentView('permissions');
      announceViewChange('Permissions');
    },
    '4': () => {
      setCurrentView('resources');
      announceViewChange('Resources');
    },
    '/': (e) => {
      e.preventDefault(); // Prevent default search behavior
      const searchInput = document.querySelector('.search-input');
      if (searchInput) {
        searchInput.focus();
      }
    },
    'Escape': () => {
      // Check if search is focused and has content
      const searchInput = document.querySelector('.search-input');
      if (searchInput === document.activeElement && searchInput.value) {
        // Let SearchBar handle clearing
        return;
      }
      // Otherwise close Plugin Hub
      if (onClose) {
        onClose();
      }
    }
  };

  // Use keyboard navigation hook
  useKeyboardNav(keyboardHandlers, {
    enabled: true,
    ignoreInputs: true,
    preventDefault: false
  });

  // Focus search on mount if needed
  useEffect(() => {
    // Focus management can be added here if needed
  }, []);

  return (
    <div data-testid="plugin-hub-container" className="plugin-hub-container">
      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Header with search */}
      <header className="plugin-hub-header">
        <h1 className="plugin-hub-title">Plugin Hub</h1>
        <SearchBar ref={searchRef} />
      </header>

      {/* Main layout */}
      <div className="plugin-hub-layout">
        {/* Navigation sidebar */}
        <NavigationSidebar />

        {/* Main content area */}
        <main 
          className="plugin-hub-content"
          role="main"
          aria-label="Plugin content"
        >
          <CurrentView />
        </main>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="keyboard-shortcuts-hint">
        <span>Press <kbd>1-4</kbd> to switch views</span>
        <span><kbd>/</kbd> to search</span>
        <span><kbd>Esc</kbd> to close</span>
      </div>
    </div>
  );
}

// Export for testing
export default PluginHub;