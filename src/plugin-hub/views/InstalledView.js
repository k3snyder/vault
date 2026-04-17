import PluginCard from '../components/PluginCard.js';
import LoadingStates from '../components/LoadingStates.js';

class InstalledView {
    constructor(context) {
        this.context = context;
        this.element = null;
        this.pluginCards = new Map();
        this.sortOrder = 'name'; // name, status, recent
        this.filterStatus = 'all'; // all, enabled, disabled
        this.expandedPluginIds = new Set(); // Track which plugins are expanded
    }

    render() {
        const container = document.createElement('div');
        container.className = 'view-container installed-view';
        container.innerHTML = `
            <div class="view-header">
                <h2 class="view-title">Installed Plugins</h2>
                <div class="view-controls">
                    <div class="filter-group">
                        <label for="status-filter" class="sr-only">Filter by status</label>
                        <select id="status-filter" class="filter-select" aria-label="Filter plugins by status">
                            <option value="all">All Plugins</option>
                            <option value="enabled">Enabled Only</option>
                            <option value="disabled">Disabled Only</option>
                        </select>
                    </div>
                    <div class="sort-group">
                        <label for="sort-order" class="sr-only">Sort plugins</label>
                        <select id="sort-order" class="sort-select" aria-label="Sort plugins">
                            <option value="name">Name</option>
                            <option value="status">Status</option>
                            <option value="recent">Recently Updated</option>
                        </select>
                    </div>
                    <button class="refresh-button" aria-label="Refresh plugin list">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M14 8C14 11.3137 11.3137 14 8 14C5.5 14 3.5 12.5 2.5 10.5M2 8C2 4.68629 4.68629 2 8 2C10.5 2 12.5 3.5 13.5 5.5" 
                                  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            <path d="M13 2V5.5H9.5M6.5 10.5H3V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="view-stats">
                <div class="stat-item">
                    <span class="stat-value">${this.getTotalPlugins()}</span>
                    <span class="stat-label">Total</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${this.getEnabledCount()}</span>
                    <span class="stat-label">Enabled</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${this.getDisabledCount()}</span>
                    <span class="stat-label">Disabled</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${this.getUpdateCount()}</span>
                    <span class="stat-label">Updates</span>
                </div>
            </div>
            <div class="plugin-list" role="list" aria-label="Installed plugins">
                ${this.renderPluginList()}
            </div>
        `;

        this.attachEventListeners(container);
        this.attachPluginCards(container);
        this.element = container;
        return container;
    }

    renderPluginList() {
        const plugins = this.getFilteredAndSortedPlugins();
        
        if (this.context.state.loading) {
            return LoadingStates.createLoadingGrid(6).outerHTML;
        }
        
        if (this.context.state.error) {
            return LoadingStates.createErrorState(
                'Failed to load plugins',
                this.context.state.error,
                () => this.context.loadInstalledPlugins()
            ).outerHTML;
        }
        
        if (plugins.length === 0) {
            const message = this.filterStatus === 'all' 
                ? 'No plugins installed yet'
                : `No ${this.filterStatus} plugins`;
            
            return LoadingStates.createEmptyState(
                message,
                'Visit the Discover tab to find and install plugins',
                this.filterStatus !== 'all' ? {
                    label: 'Show All',
                    callback: () => {
                        this.filterStatus = 'all';
                        this.update();
                    }
                } : null
            ).outerHTML;
        }
        
        // Just return empty container - cards will be attached later
        return '<div class="plugin-list-inner"></div>';
    }

    attachPluginCards(container) {
        const pluginList = container.querySelector('.plugin-list');
        if (!pluginList) return;
        
        const plugins = this.getFilteredAndSortedPlugins();
        
        // Don't attach cards if there are no plugins or if loading/empty states are shown
        if (plugins.length === 0 || this.context.state.loading || this.context.state.error) return;
        
        // Find or create the list inner container
        let listInner = pluginList.querySelector('.plugin-list-inner');
        if (!listInner) {
            listInner = document.createElement('div');
            listInner.className = 'plugin-list-inner';
            pluginList.appendChild(listInner);
        }
        
        // Clear existing content
        listInner.innerHTML = '';
        this.pluginCards.clear();
        
        // Create and attach plugin cards
        plugins.forEach(plugin => {
            const listItem = document.createElement('div');
            listItem.setAttribute('role', 'listitem');

            const card = new PluginCard(plugin, this.context, {
                expanded: this.expandedPluginIds.has(plugin.id),
                onToggleExpand: (pluginId, expanded) => {
                    if (expanded) {
                        this.expandedPluginIds.add(pluginId);
                    } else {
                        this.expandedPluginIds.delete(pluginId);
                    }
                }
            });
            this.pluginCards.set(plugin.id, card);
            const cardElement = card.render();
            listItem.appendChild(cardElement);
            listInner.appendChild(listItem);
        });
    }

    getFilteredAndSortedPlugins() {
        let plugins = [...this.context.state.installedPlugins];
        
        // Apply search filter from context
        if (this.context.state.searchQuery) {
            const query = this.context.state.searchQuery.toLowerCase();
            plugins = plugins.filter(plugin => 
                plugin.name?.toLowerCase().includes(query) ||
                plugin.description?.toLowerCase().includes(query) ||
                plugin.author?.toLowerCase().includes(query)
            );
        }
        
        // Apply status filter
        if (this.filterStatus === 'enabled') {
            plugins = plugins.filter(p => p.enabled);
        } else if (this.filterStatus === 'disabled') {
            plugins = plugins.filter(p => !p.enabled);
        }
        
        // Apply sorting
        plugins.sort((a, b) => {
            switch (this.sortOrder) {
                case 'name':
                    return (a.name || '').localeCompare(b.name || '');
                case 'status':
                    if (a.enabled === b.enabled) {
                        return (a.name || '').localeCompare(b.name || '');
                    }
                    return a.enabled ? -1 : 1;
                case 'recent':
                    const dateA = new Date(a.updatedAt || a.installedAt || 0);
                    const dateB = new Date(b.updatedAt || b.installedAt || 0);
                    return dateB - dateA;
                default:
                    return 0;
            }
        });
        
        return plugins;
    }

    attachEventListeners(container) {
        const statusFilter = container.querySelector('#status-filter');
        statusFilter?.addEventListener('change', (e) => {
            this.filterStatus = e.target.value;
            this.update();
        });
        
        const sortOrder = container.querySelector('#sort-order');
        sortOrder?.addEventListener('change', (e) => {
            this.sortOrder = e.target.value;
            this.update();
        });
        
        const refreshButton = container.querySelector('.refresh-button');
        refreshButton?.addEventListener('click', async () => {
            refreshButton.classList.add('spinning');
            await this.context.loadInstalledPlugins();
            this.update();
            setTimeout(() => {
                refreshButton.classList.remove('spinning');
            }, 500);
        });
    }

    update() {
        const pluginList = this.element?.querySelector('.plugin-list');
        if (pluginList) {
            const plugins = this.getFilteredAndSortedPlugins();
            
            if (plugins.length === 0 || this.context.state.loading || this.context.state.error) {
                // Show empty/loading/error state
                pluginList.innerHTML = this.renderPluginList();
            } else {
                // Clear and re-attach cards
                pluginList.innerHTML = '';
                this.attachPluginCards(this.element);
            }
            
            // Update stats
            this.updateStats();
        }
    }

    updateStats() {
        const stats = this.element?.querySelector('.view-stats');
        if (stats) {
            stats.querySelector('.stat-item:nth-child(1) .stat-value').textContent = this.getTotalPlugins();
            stats.querySelector('.stat-item:nth-child(2) .stat-value').textContent = this.getEnabledCount();
            stats.querySelector('.stat-item:nth-child(3) .stat-value').textContent = this.getDisabledCount();
            stats.querySelector('.stat-item:nth-child(4) .stat-value').textContent = this.getUpdateCount();
        }
    }

    getTotalPlugins() {
        return this.context.state.installedPlugins.length;
    }

    getEnabledCount() {
        return this.context.state.installedPlugins.filter(p => p.enabled).length;
    }

    getDisabledCount() {
        return this.context.state.installedPlugins.filter(p => !p.enabled).length;
    }

    getUpdateCount() {
        return this.context.state.installedPlugins.filter(p => p.hasUpdate).length;
    }

    destroy() {
        this.pluginCards.clear();
        this.element = null;
    }
}

export default InstalledView;