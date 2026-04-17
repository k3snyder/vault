import PacasDBSettings from './PacasDBSettings.js';
import CsvSupportSettings from './CsvSupportSettings.js';

class PluginCard {
    constructor(plugin, context, options = {}) {
        this.plugin = plugin;
        this.context = context;
        this.expanded = options.expanded || false;
        this.onToggleExpand = options.onToggleExpand || null;
        this.element = null;
        this.pacasDBSettings = null;
        this.csvSupportSettings = null;
    }

    render() {
        const card = document.createElement('div');
        card.className = 'plugin-card';
        card.dataset.pluginId = this.plugin.id;

        if (this.expanded) {
            card.classList.add('expanded');
        }

        // Build badges for bundled, premium, and freemium plugins
        const badges = this.renderBadges();

        card.innerHTML = `
            <div class="plugin-card-header">
                <div class="plugin-card-info">
                    <div class="plugin-card-title">
                        <h3>${this.plugin.name}</h3>
                        ${this.plugin.version ? `<span class="plugin-version">v${this.plugin.version}</span>` : ''}
                        ${badges}
                    </div>
                    <p class="plugin-card-description">${this.plugin.description || 'No description available'}</p>
                    <div class="plugin-card-meta">
                        ${this.plugin.author ? `<span class="plugin-author">by ${this.plugin.author}</span>` : ''}
                        ${this.plugin.downloads ? `<span class="plugin-downloads">${this.formatNumber(this.plugin.downloads)} downloads</span>` : ''}
                    </div>
                </div>
                <div class="plugin-card-actions">
                    ${this.renderActions()}
                </div>
                <button class="plugin-card-expand ${this.expanded ? 'rotated' : ''}" aria-label="Toggle details">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
            <div class="plugin-card-details" ${!this.expanded ? 'style="display: none;"' : ''}>
                ${this.renderDetails()}
            </div>
        `;

        this.attachEventListeners(card);
        this.element = card;
        return card;
    }

    renderActions() {
        const actions = [];

        if (this.plugin.installed) {
            const enableToggle = `
                <label class="plugin-toggle">
                    <input type="checkbox" ${this.plugin.enabled ? 'checked' : ''}
                           aria-label="${this.plugin.enabled ? 'Disable' : 'Enable'} ${this.plugin.name}">
                    <span class="plugin-toggle-slider"></span>
                </label>
            `;
            actions.push(enableToggle);

            actions.push(`
                <button class="plugin-action-button plugin-settings"
                        aria-label="Settings for ${this.plugin.name}"
                        title="Settings">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M6.5 2L6 3.5H3.5V5.5L2 6V10L3.5 10.5V12.5H6L6.5 14H9.5L10 12.5H12.5V10.5L14 10V6L12.5 5.5V3.5H10L9.5 2H6.5Z"
                              stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                        <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                </button>
            `);

            // Only show uninstall button for non-bundled plugins
            if (!this.plugin.isBundled) {
                actions.push(`
                    <button class="plugin-action-button plugin-uninstall"
                            aria-label="Uninstall ${this.plugin.name}"
                            title="Uninstall">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                `);
            }
        } else {
            actions.push(`
                <button class="plugin-action-button plugin-install primary"
                        aria-label="Install ${this.plugin.name}">
                    Install
                </button>
            `);
        }

        return actions.join('');
    }

    renderBadges() {
        const badges = [];

        // Built-in badge for bundled plugins and Readwise
        if (this.plugin.isBundled || this.plugin.id === 'readwise') {
            badges.push('<span class="bundled-badge">Built-in</span>');
        }

        // Coming soon badge
        if (this.plugin.comingSoon) {
            badges.push('<span class="coming-soon-badge">Coming soon</span>');
        }

        return badges.join('');
    }

    renderDetails() {
        const sections = [];
        
        if (this.plugin.permissions && this.plugin.permissions.length > 0) {
            sections.push(`
                <div class="plugin-detail-section">
                    <h4>Permissions</h4>
                    <div class="plugin-permissions">
                        ${this.plugin.permissions.map(perm => `
                            <span class="permission-badge ${this.getPermissionLevel(perm)}">
                                ${this.getPermissionIcon(perm)} ${perm}
                            </span>
                        `).join('')}
                    </div>
                </div>
            `);
        }
        
        if (this.plugin.resources) {
            sections.push(`
                <div class="plugin-detail-section">
                    <h4>Resource Usage</h4>
                    <div class="plugin-resources">
                        ${this.renderResourceBars()}
                    </div>
                </div>
            `);
        }
        
        if (this.plugin.readme) {
            sections.push(`
                <div class="plugin-detail-section">
                    <h4>About</h4>
                    <div class="plugin-readme">${this.plugin.readme}</div>
                </div>
            `);
        }
        
        return sections.join('');
    }

    renderResourceBars() {
        const resources = this.plugin.resources;
        const bars = [];
        
        if (resources.memory) {
            bars.push(this.createResourceBar('Memory', resources.memory.used, resources.memory.limit, 'MB'));
        }
        
        if (resources.cpu) {
            bars.push(this.createResourceBar('CPU', resources.cpu, 100, '%'));
        }
        
        if (resources.storage) {
            bars.push(this.createResourceBar('Storage', resources.storage.used, resources.storage.limit, 'MB'));
        }
        
        return bars.join('');
    }

    createResourceBar(label, used, limit, unit) {
        const percentage = (used / limit) * 100;
        const level = percentage > 80 ? 'high' : percentage > 50 ? 'medium' : 'low';
        
        return `
            <div class="resource-item">
                <div class="resource-label">
                    <span>${label}</span>
                    <span class="resource-value">${used}${unit} / ${limit}${unit}</span>
                </div>
                <div class="resource-bar">
                    <div class="resource-bar-fill ${level}" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
    }

    attachEventListeners(card) {
        const expandBtn = card.querySelector('.plugin-card-expand');
        if (expandBtn) {
            expandBtn.addEventListener('click', () => this.toggleExpand());
        }
        
        const enableToggle = card.querySelector('.plugin-toggle input');
        if (enableToggle) {
            enableToggle.addEventListener('change', (e) => this.handleToggle(e));
        }
        
        const settingsBtn = card.querySelector('.plugin-settings');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleSettings();
            });
        }
        
        const uninstallBtn = card.querySelector('.plugin-uninstall');
        if (uninstallBtn) {
            uninstallBtn.addEventListener('click', () => this.handleUninstall());
        }
        
        const installBtn = card.querySelector('.plugin-install');
        if (installBtn) {
            installBtn.addEventListener('click', () => this.handleInstall());
        }
    }

    toggleExpand() {
        this.expanded = !this.expanded;
        const details = this.element.querySelector('.plugin-card-details');
        const expandBtn = this.element.querySelector('.plugin-card-expand');

        if (this.expanded) {
            this.element.classList.add('expanded');
            details.style.display = 'block';
            expandBtn.classList.add('rotated');
        } else {
            this.element.classList.remove('expanded');
            details.style.display = 'none';
            expandBtn.classList.remove('rotated');
        }

        // Notify parent view of expanded state change
        if (this.onToggleExpand) {
            this.onToggleExpand(this.plugin.id, this.expanded);
        }
    }

    async handleToggle(event) {
        console.log('Toggle clicked for plugin:', this.plugin.id);
        const enabled = event.target.checked;
        console.log('Setting enabled to:', enabled);

        // Check if this plugin requires a license and user is trying to enable
        if (enabled && this.plugin.requiresLicense) {
            const isPremium = await this.context.isPremiumEnabled();
            if (!isPremium) {
                // Revert the toggle immediately
                event.target.checked = false;

                // Show the PACASDB settings modal which has license activation
                if (this.plugin.id === 'pacasdb') {
                    if (!this.pacasDBSettings) {
                        this.pacasDBSettings = new PacasDBSettings(this.context);
                    }
                    await this.pacasDBSettings.open();
                } else {
                    this.context.showToast('A license is required to enable this plugin. Please activate a license in settings.', 'warning');
                }
                return;
            }
        }

        try {
            if (enabled) {
                await this.context.enablePlugin(this.plugin.id);
            } else {
                await this.context.disablePlugin(this.plugin.id);
            }
            this.context.showToast(`Plugin ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            console.error('Toggle error:', error);
            event.target.checked = !enabled;
            this.context.showToast(`Failed to ${enabled ? 'enable' : 'disable'} plugin`, 'error');
        }
    }

    async handleSettings() {
        console.log('Settings clicked for plugin:', this.plugin.id);

        // Handle PACASDB specially with its own settings modal
        if (this.plugin.id === 'pacasdb') {
            if (!this.pacasDBSettings) {
                this.pacasDBSettings = new PacasDBSettings(this.context);
            }
            await this.pacasDBSettings.open();
            return;
        }

        // Handle CSV Support specially with its own settings modal
        if (this.plugin.id === 'csv-support') {
            if (!this.csvSupportSettings) {
                this.csvSupportSettings = new CsvSupportSettings(this.context);
            }
            await this.csvSupportSettings.open();
            return;
        }

        // Default handling for other plugins
        console.log('Plugin object being passed:', this.plugin);
        console.log('Plugin settings:', this.plugin.settings);
        console.log('Plugin settings_schema:', this.plugin.settings_schema);
        this.context.openPluginSettings(this.plugin);
    }

    async handleUninstall() {
        if (confirm(`Are you sure you want to uninstall ${this.plugin.name}?`)) {
            try {
                await this.context.uninstallPlugin(this.plugin.id);
            } catch (error) {
                this.context.showToast('Failed to uninstall plugin', 'error');
            }
        }
    }

    async handleInstall() {
        try {
            await this.context.installPlugin(this.plugin.id);
            this.plugin.installed = true;
            this.update();
        } catch (error) {
            this.context.showToast('Failed to install plugin', 'error');
        }
    }

    update() {
        const newElement = this.render();
        this.element.replaceWith(newElement);
        this.element = newElement;
    }

    getPermissionLevel(permission) {
        const highRisk = ['filesystem.write', 'network.all', 'system.execute'];
        const mediumRisk = ['filesystem.read', 'network.fetch', 'vault.write'];
        
        if (highRisk.includes(permission)) return 'high-risk';
        if (mediumRisk.includes(permission)) return 'medium-risk';
        return 'low-risk';
    }

    getPermissionIcon(permission) {
        const icons = {
            'filesystem.read': '📁',
            'filesystem.write': '✏️',
            'network.fetch': '🌐',
            'network.all': '🔌',
            'vault.read': '🔍',
            'vault.write': '📝',
            'system.execute': '⚡'
        };
        return icons[permission] || '🔒';
    }

    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
}

export default PluginCard;