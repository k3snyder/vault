// Main exports for Plugin Hub
export { PluginHub } from './PluginHub';
export { PluginProvider, usePluginContext } from './contexts/PluginContext';
export { useKeyboardNav, FocusUtils } from './hooks/useKeyboardNav';
export { default as pluginHubIntegration } from './pluginHubIntegration';

// View exports
export { DiscoverView } from './views/DiscoverView';
export { InstalledView } from './views/InstalledView';
export { PermissionsView } from './views/PermissionsView';
export { ResourcesView } from './views/ResourcesView';

// Component exports
export { NavigationSidebar } from './components/NavigationSidebar';
export { SearchBar } from './components/SearchBar';