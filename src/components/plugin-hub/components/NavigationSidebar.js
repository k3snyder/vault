import React from 'react';
import { usePluginContext } from '../contexts/PluginContext';

const views = [
  { id: 'discover', label: 'Discover', icon: '🔍', hotkey: '1' },
  { id: 'installed', label: 'Installed', icon: '📦', hotkey: '2' }
];

export function NavigationSidebar() {
  const { state, setCurrentView } = usePluginContext();

  const handleViewClick = (viewId) => {
    setCurrentView(viewId);
  };

  return (
    <nav 
      data-testid="navigation-sidebar"
      className="navigation-sidebar"
      role="navigation"
      aria-label="Plugin views"
    >
      <div className="nav-items">
        {views.map(view => (
          <button
            key={view.id}
            className={`nav-item ${state.currentView === view.id ? 'active' : ''}`}
            onClick={() => handleViewClick(view.id)}
            aria-current={state.currentView === view.id ? 'page' : undefined}
            title={`${view.label} (${view.hotkey})`}
          >
            <span className="nav-icon">{view.icon}</span>
            <span className="nav-label">{view.label}</span>
            <span className="nav-hotkey">{view.hotkey}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}