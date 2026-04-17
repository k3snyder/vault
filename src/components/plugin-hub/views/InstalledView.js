import React from 'react';
import { usePluginContext } from '../contexts/PluginContext';

export function InstalledView() {
  const { state, getFilteredPlugins } = usePluginContext();
  const filteredPlugins = getFilteredPlugins();

  if (state.loading) {
    return (
      <div data-testid="installed-view" className="plugin-view">
        <div data-testid="loading-indicator">Loading plugins...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div data-testid="installed-view" className="plugin-view">
        <div className="error-message">{state.error}</div>
      </div>
    );
  }

  if (filteredPlugins.length === 0 && state.searchQuery) {
    return (
      <div data-testid="installed-view" className="plugin-view">
        <h2>Installed Plugins</h2>
        <p>No plugins found</p>
      </div>
    );
  }

  return (
    <div data-testid="installed-view" className="plugin-view">
      <h2>Installed Plugins</h2>
      <div className="plugin-list">
        {filteredPlugins.map(plugin => (
          <div key={plugin.id} className="plugin-item">
            <h3>{plugin.name}</h3>
            <p>{plugin.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}