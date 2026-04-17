import PluginCard from '../components/PluginCard.js';
import LoadingStates from '../components/LoadingStates.js';

class DiscoverView {
    constructor(context) {
        this.context = context;
        this.element = null;
        this.selectedCategory = 'all';
        this.sortBy = 'popular'; // popular, recent, name, downloads
        this.pluginCards = new Map();
        this.expandedPluginIds = new Set(); // Track which plugins are expanded

        // Categories will be populated from actual plugins
        this.categories = [
            { id: 'all', name: 'All Categories', count: 0 }
        ];
    }

    render() {
        const container = document.createElement('div');
        container.className = 'view-container discover-view';
        container.innerHTML = `
            <div class="view-header">
                <h2 class="view-title">Discover Plugins</h2>
                <div class="view-controls">
                    <div class="sort-group">
                        <label for="discover-sort" class="sr-only">Sort plugins</label>
                        <select id="discover-sort" class="sort-select" aria-label="Sort plugins">
                            <option value="popular">Most Popular</option>
                            <option value="recent">Recently Added</option>
                            <option value="downloads">Most Downloads</option>
                            <option value="name">Alphabetical</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div class="discover-content">
                <aside class="category-sidebar" role="navigation" aria-label="Plugin categories">
                    <h3 class="sidebar-title">Categories</h3>
                    <ul class="category-list" role="list">
                        ${this.renderCategories()}
                    </ul>
                </aside>
                
                <main class="discover-main">
                    <div class="featured-section">
                        <h3 class="section-title">Featured Plugins</h3>
                        <div class="featured-carousel">
                            ${this.renderFeaturedPlugins()}
                        </div>
                    </div>
                    
                    <div class="browse-section">
                        <div class="section-header">
                            <h3 class="section-title">
                                ${this.selectedCategory === 'all' ? 'All Plugins' : this.getCategoryName(this.selectedCategory)}
                            </h3>
                            <span class="plugin-count">${this.getPluginCount()} plugins</span>
                        </div>
                        <div class="plugin-grid" role="list" aria-label="Available plugins">
                            ${this.renderPluginGrid()}
                        </div>
                    </div>
                </main>
            </div>
        `;

        this.attachEventListeners(container);
        this.element = container;
        
        // After setting the HTML, properly attach plugin cards
        this.attachPluginCards(container);
        
        return container;
    }

    renderCategories() {
        return this.categories.map(category => `
            <li role="listitem">
                <button class="category-item ${this.selectedCategory === category.id ? 'active' : ''}"
                        data-category="${category.id}"
                        aria-current="${this.selectedCategory === category.id ? 'true' : 'false'}">
                    <span class="category-name">${category.name}</span>
                    <span class="category-count">${category.count}</span>
                </button>
            </li>
        `).join('');
    }

    renderFeaturedPlugins() {
        // Get installed plugins and show them as featured for now
        const installedPlugins = this.context.state.installedPlugins || [];
        const featuredPlugins = installedPlugins.slice(0, 2).map(plugin => ({
            ...plugin,
            featured: true,
            downloads: plugin.downloads || 0,
            rating: plugin.rating || 0
        }));
        
        if (featuredPlugins.length === 0) {
            return '<div class="featured-empty">No plugins installed yet</div>';
        }

        return featuredPlugins.map(plugin => `
            <div class="featured-card">
                <div class="featured-banner">
                    ${plugin.banner ? 
                        `<img src="${plugin.banner}" alt="${plugin.name} banner">` :
                        `<div class="featured-placeholder"></div>`
                    }
                </div>
                <div class="featured-info">
                    <h4 class="featured-title">${plugin.name}</h4>
                    <p class="featured-description">${plugin.description}</p>
                    <div class="featured-meta">
                        <span class="featured-author">by ${plugin.author}</span>
                        <span class="featured-stats">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M6 1L7.5 4L11 4.5L8.5 7L9 10.5L6 9L3 10.5L3.5 7L1 4.5L4.5 4L6 1Z" 
                                      fill="currentColor" opacity="0.5"/>
                            </svg>
                            ${plugin.rating}
                        </span>
                        <span class="featured-downloads">${this.formatDownloads(plugin.downloads)} installs</span>
                    </div>
                    <button class="featured-install-btn">Install</button>
                </div>
            </div>
        `).join('');
    }

    renderPluginGrid() {
        const plugins = this.getFilteredPlugins();
        
        if (this.context.state.loading && this.context.state.availablePlugins.length === 0) {
            return LoadingStates.createLoadingGrid(9).outerHTML;
        }
        
        if (plugins.length === 0) {
            return LoadingStates.createEmptyState(
                'No plugins found',
                this.selectedCategory !== 'all' 
                    ? `No plugins in the ${this.getCategoryName(this.selectedCategory)} category yet`
                    : 'Try adjusting your search criteria',
                this.selectedCategory !== 'all' ? {
                    label: 'Browse All',
                    callback: () => {
                        this.selectedCategory = 'all';
                        this.update();
                    }
                } : null
            ).outerHTML;
        }
        
        // Just return empty container - cards will be attached by attachPluginCards()
        return '<div class="plugin-grid-inner"></div>';
    }

    getFilteredPlugins() {
        // Use installed plugins from context
        let plugins = this.context.state.installedPlugins || [];
        
        // Filter by category
        if (this.selectedCategory !== 'all') {
            plugins = plugins.filter(p => p.category === this.selectedCategory);
        }
        
        // Filter by search
        if (this.context.state.searchQuery) {
            const query = this.context.state.searchQuery.toLowerCase();
            plugins = plugins.filter(plugin => 
                plugin.name?.toLowerCase().includes(query) ||
                plugin.description?.toLowerCase().includes(query) ||
                plugin.author?.toLowerCase().includes(query)
            );
        }
        
        // Sort
        plugins.sort((a, b) => {
            switch (this.sortBy) {
                case 'popular':
                    return (b.downloads || 0) - (a.downloads || 0);
                case 'recent':
                    return (b.createdAt || 0) - (a.createdAt || 0);
                case 'downloads':
                    return (b.downloads || 0) - (a.downloads || 0);
                case 'name':
                    return (a.name || '').localeCompare(b.name || '');
                default:
                    return 0;
            }
        });
        
        return plugins;
    }

    attachPluginCards(container) {
        const pluginGrid = container.querySelector('.plugin-grid');
        if (!pluginGrid) return;
        
        const plugins = this.getFilteredPlugins();
        
        // Don't attach cards if there are no plugins or if loading/empty states are shown
        if (plugins.length === 0) return;
        
        // Find or create the grid inner container
        let gridInner = pluginGrid.querySelector('.plugin-grid-inner');
        if (!gridInner) {
            gridInner = document.createElement('div');
            gridInner.className = 'plugin-grid-inner';
            pluginGrid.appendChild(gridInner);
        }
        
        // Clear existing content
        gridInner.innerHTML = '';
        this.pluginCards.clear();
        
        // Create and attach plugin cards
        plugins.forEach(plugin => {
            const gridItem = document.createElement('div');
            gridItem.className = 'grid-item';
            gridItem.setAttribute('role', 'listitem');

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
            gridItem.appendChild(cardElement);
            gridInner.appendChild(gridItem);
        });
    }
    
    attachEventListeners(container) {
        // Category selection
        const categoryButtons = container.querySelectorAll('.category-item');
        categoryButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedCategory = btn.dataset.category;
                this.update();
            });
        });
        
        // Sort selection
        const sortSelect = container.querySelector('#discover-sort');
        sortSelect?.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.update();
        });
        
        // Featured plugin install buttons
        const featuredInstallBtns = container.querySelectorAll('.featured-install-btn');
        featuredInstallBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                // TODO: Implement featured plugin installation
                this.context.showToast('Installing featured plugin...', 'info');
            });
        });
    }

    update() {
        // Update category active state
        const categoryButtons = this.element?.querySelectorAll('.category-item');
        categoryButtons?.forEach(btn => {
            const isActive = btn.dataset.category === this.selectedCategory;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
        
        // Update section title
        const sectionTitle = this.element?.querySelector('.browse-section .section-title');
        if (sectionTitle) {
            sectionTitle.textContent = this.selectedCategory === 'all' 
                ? 'All Plugins' 
                : this.getCategoryName(this.selectedCategory);
        }
        
        // Update plugin count
        const pluginCount = this.element?.querySelector('.plugin-count');
        if (pluginCount) {
            pluginCount.textContent = `${this.getPluginCount()} plugins`;
        }
        
        // Re-render plugin grid
        const pluginGrid = this.element?.querySelector('.plugin-grid');
        if (pluginGrid) {
            const plugins = this.getFilteredPlugins();
            
            if (plugins.length === 0) {
                // Show empty state
                pluginGrid.innerHTML = this.renderPluginGrid();
            } else {
                // Clear and re-attach cards
                pluginGrid.innerHTML = '';
                this.attachPluginCards(this.element);
            }
        }
    }

    getCategoryName(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        return category ? category.name : 'Unknown Category';
    }

    getPluginCount() {
        return this.getFilteredPlugins().length;
    }

    formatDownloads(count) {
        if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
        return count.toString();
    }

    destroy() {
        this.pluginCards.clear();
        this.element = null;
    }
}

export default DiscoverView;