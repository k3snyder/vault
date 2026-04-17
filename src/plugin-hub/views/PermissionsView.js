import LoadingStates from '../components/LoadingStates.js';

class PermissionsView {
    constructor(context) {
        this.context = context;
        this.element = null;
        this.selectedPlugin = null;
        
        // Permission categories and their descriptions
        this.permissionCategories = {
            filesystem: {
                name: 'File System',
                icon: '📁',
                permissions: [
                    { id: 'filesystem.read', name: 'Read Files', risk: 'medium', description: 'Read files from your vault' },
                    { id: 'filesystem.write', name: 'Write Files', risk: 'high', description: 'Create and modify files in your vault' },
                    { id: 'filesystem.delete', name: 'Delete Files', risk: 'high', description: 'Delete files from your vault' }
                ]
            },
            network: {
                name: 'Network',
                icon: '🌐',
                permissions: [
                    { id: 'network.fetch', name: 'Fetch Data', risk: 'medium', description: 'Make HTTP requests to external services' },
                    { id: 'network.websocket', name: 'WebSocket', risk: 'medium', description: 'Establish WebSocket connections' },
                    { id: 'network.all', name: 'Full Network', risk: 'high', description: 'Unrestricted network access' }
                ]
            },
            vault: {
                name: 'Vault',
                icon: '🔒',
                permissions: [
                    { id: 'vault.read', name: 'Read Notes', risk: 'low', description: 'Read note content and metadata' },
                    { id: 'vault.write', name: 'Write Notes', risk: 'medium', description: 'Create and edit notes' },
                    { id: 'vault.settings', name: 'Vault Settings', risk: 'high', description: 'Modify vault configuration' }
                ]
            },
            system: {
                name: 'System',
                icon: '⚙️',
                permissions: [
                    { id: 'system.clipboard', name: 'Clipboard', risk: 'low', description: 'Read and write clipboard content' },
                    { id: 'system.notifications', name: 'Notifications', risk: 'low', description: 'Show system notifications' },
                    { id: 'system.execute', name: 'Execute Commands', risk: 'high', description: 'Run system commands' }
                ]
            }
        };
    }

    render() {
        const container = document.createElement('div');
        container.className = 'view-container permissions-view';
        container.innerHTML = `
            <div class="view-header">
                <h2 class="view-title">Plugin Permissions</h2>
                <div class="view-controls">
                    <button class="audit-button" aria-label="Run permission audit">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 2V8L11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                        Audit All
                    </button>
                </div>
            </div>
            
            <div class="permissions-content">
                <aside class="plugin-selector" role="navigation" aria-label="Select plugin">
                    <h3 class="selector-title">Installed Plugins</h3>
                    <div class="plugin-selector-list" role="list">
                        ${this.renderPluginList()}
                    </div>
                </aside>
                
                <main class="permissions-main">
                    ${this.selectedPlugin ? this.renderPermissionMatrix() : this.renderOverview()}
                </main>
            </div>
        `;

        this.attachEventListeners(container);
        this.element = container;
        return container;
    }

    renderPluginList() {
        const plugins = this.context.state.installedPlugins;
        
        if (plugins.length === 0) {
            return '<div class="no-plugins-message">No plugins installed</div>';
        }
        
        return plugins.map(plugin => {
            const permissions = this.context.state.permissions[plugin.id] || [];
            const hasHighRisk = permissions.some(p => this.isHighRisk(p));
            
            return `
                <button class="plugin-selector-item ${this.selectedPlugin?.id === plugin.id ? 'active' : ''}"
                        data-plugin-id="${plugin.id}"
                        role="listitem"
                        aria-current="${this.selectedPlugin?.id === plugin.id ? 'true' : 'false'}">
                    <span class="plugin-selector-name">${plugin.name}</span>
                    <span class="plugin-selector-badges">
                        ${permissions.length > 0 ? `
                            <span class="permission-count ${hasHighRisk ? 'high-risk' : ''}">${permissions.length}</span>
                        ` : ''}
                        ${plugin.enabled ? 
                            '<span class="status-badge enabled">Active</span>' : 
                            '<span class="status-badge disabled">Inactive</span>'
                        }
                    </span>
                </button>
            `;
        }).join('');
    }

    renderOverview() {
        const allPermissions = this.getAllPermissionsMatrix();
        
        return `
            <div class="permissions-overview">
                <h3 class="overview-title">Permissions Overview</h3>
                <p class="overview-description">
                    Monitor and manage permissions across all your installed plugins. 
                    Select a plugin to view and modify its specific permissions.
                </p>
                
                <div class="permission-stats">
                    <div class="stat-card">
                        <div class="stat-icon high-risk">⚠️</div>
                        <div class="stat-info">
                            <div class="stat-value">${allPermissions.highRisk}</div>
                            <div class="stat-label">High Risk</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon medium-risk">⚡</div>
                        <div class="stat-info">
                            <div class="stat-value">${allPermissions.mediumRisk}</div>
                            <div class="stat-label">Medium Risk</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon low-risk">✓</div>
                        <div class="stat-info">
                            <div class="stat-value">${allPermissions.lowRisk}</div>
                            <div class="stat-label">Low Risk</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon total">🔐</div>
                        <div class="stat-info">
                            <div class="stat-value">${allPermissions.total}</div>
                            <div class="stat-label">Total Permissions</div>
                        </div>
                    </div>
                </div>
                
                <div class="permission-summary">
                    <h4>Most Requested Permissions</h4>
                    <div class="summary-list">
                        ${this.renderPermissionSummary()}
                    </div>
                </div>
            </div>
        `;
    }

    renderPermissionMatrix() {
        const plugin = this.selectedPlugin;
        const grantedPermissions = this.context.state.permissions[plugin.id] || [];
        
        return `
            <div class="permission-matrix">
                <div class="matrix-header">
                    <h3 class="matrix-title">${plugin.name} Permissions</h3>
                    <div class="matrix-actions">
                        <button class="revoke-all-button" ${grantedPermissions.length === 0 ? 'disabled' : ''}>
                            Revoke All
                        </button>
                    </div>
                </div>
                
                <div class="permission-categories">
                    ${Object.entries(this.permissionCategories).map(([categoryId, category]) => `
                        <div class="permission-category">
                            <div class="category-header">
                                <span class="category-icon">${category.icon}</span>
                                <h4 class="category-title">${category.name}</h4>
                            </div>
                            <div class="permission-list">
                                ${category.permissions.map(permission => {
                                    const isGranted = grantedPermissions.includes(permission.id);
                                    return `
                                        <div class="permission-row ${isGranted ? 'granted' : ''}">
                                            <div class="permission-info">
                                                <div class="permission-name">
                                                    ${permission.name}
                                                    <span class="risk-badge ${permission.risk}-risk">${permission.risk}</span>
                                                </div>
                                                <div class="permission-description">${permission.description}</div>
                                            </div>
                                            <div class="permission-control">
                                                <label class="permission-toggle">
                                                    <input type="checkbox" 
                                                           data-permission="${permission.id}"
                                                           ${isGranted ? 'checked' : ''}
                                                           aria-label="${isGranted ? 'Revoke' : 'Grant'} ${permission.name} permission">
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="permission-footer">
                    <p class="permission-warning">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 5V9M8 11H8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M7.13 2.5C7.51 1.83 8.49 1.83 8.87 2.5L14.4 12C14.78 12.67 14.29 13.5 13.53 13.5H2.47C1.71 13.5 1.22 12.67 1.6 12L7.13 2.5Z" 
                                  stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                        </svg>
                        Changes to permissions take effect immediately and may affect plugin functionality
                    </p>
                </div>
            </div>
        `;
    }

    renderPermissionSummary() {
        const permissionCounts = {};
        
        // Count permissions across all plugins
        Object.values(this.context.state.permissions).forEach(permissions => {
            permissions.forEach(permId => {
                permissionCounts[permId] = (permissionCounts[permId] || 0) + 1;
            });
        });
        
        // Sort by count and take top 5
        const topPermissions = Object.entries(permissionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        if (topPermissions.length === 0) {
            return '<div class="no-permissions">No permissions granted yet</div>';
        }
        
        return topPermissions.map(([permId, count]) => {
            const permission = this.findPermission(permId);
            if (!permission) return '';
            
            return `
                <div class="summary-item">
                    <span class="summary-permission">${permission.name}</span>
                    <span class="summary-count">${count} plugin${count !== 1 ? 's' : ''}</span>
                </div>
            `;
        }).join('');
    }

    attachEventListeners(container) {
        // Plugin selector
        const pluginButtons = container.querySelectorAll('.plugin-selector-item');
        pluginButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const pluginId = btn.dataset.pluginId;
                this.selectedPlugin = this.context.state.installedPlugins.find(p => p.id === pluginId);
                this.update();
            });
        });
        
        // Permission toggles
        const permissionToggles = container.querySelectorAll('.permission-toggle input');
        permissionToggles.forEach(toggle => {
            toggle.addEventListener('change', async (e) => {
                const permission = e.target.dataset.permission;
                const isGranted = e.target.checked;
                
                try {
                    if (isGranted) {
                        await this.context.grantPermission(this.selectedPlugin.id, permission);
                        this.context.showToast(`Permission "${permission}" granted`, 'success');
                    } else {
                        await this.context.revokePermission(this.selectedPlugin.id, permission);
                        this.context.showToast(`Permission "${permission}" revoked`, 'warning');
                    }
                } catch (error) {
                    e.target.checked = !isGranted;
                    this.context.showToast('Failed to update permission', 'error');
                }
            });
        });
        
        // Revoke all button
        const revokeAllBtn = container.querySelector('.revoke-all-button');
        revokeAllBtn?.addEventListener('click', async () => {
            const confirmed = await this.context.confirm(
                'Revoke All Permissions',
                `Are you sure you want to revoke all permissions for ${this.selectedPlugin.name}? This may break the plugin's functionality.`,
                { confirmLabel: 'Revoke All', cancelLabel: 'Cancel' }
            );
            
            if (confirmed) {
                const permissions = this.context.state.permissions[this.selectedPlugin.id] || [];
                for (const permission of permissions) {
                    await this.context.revokePermission(this.selectedPlugin.id, permission);
                }
                this.context.showToast('All permissions revoked', 'warning');
                this.update();
            }
        });
        
        // Audit button
        const auditBtn = container.querySelector('.audit-button');
        auditBtn?.addEventListener('click', () => {
            this.runPermissionAudit();
        });
    }

    runPermissionAudit() {
        this.context.showToast('Running permission audit...', 'info');
        
        // Simulate audit process
        setTimeout(() => {
            const issues = this.findPermissionIssues();
            if (issues.length > 0) {
                this.context.alert(
                    'Permission Audit Results',
                    `Found ${issues.length} potential issue${issues.length !== 1 ? 's' : ''}:\n\n${issues.join('\n')}`
                );
            } else {
                this.context.showToast('No permission issues found', 'success');
            }
        }, 1000);
    }

    findPermissionIssues() {
        const issues = [];
        
        this.context.state.installedPlugins.forEach(plugin => {
            const permissions = this.context.state.permissions[plugin.id] || [];
            
            // Check for high-risk permissions on disabled plugins
            if (!plugin.enabled && permissions.some(p => this.isHighRisk(p))) {
                issues.push(`${plugin.name} is disabled but still has high-risk permissions`);
            }
            
            // Check for excessive permissions
            if (permissions.length > 10) {
                issues.push(`${plugin.name} has an unusually high number of permissions (${permissions.length})`);
            }
        });
        
        return issues;
    }

    findPermission(permissionId) {
        for (const category of Object.values(this.permissionCategories)) {
            const permission = category.permissions.find(p => p.id === permissionId);
            if (permission) return permission;
        }
        return null;
    }

    isHighRisk(permissionId) {
        const permission = this.findPermission(permissionId);
        return permission?.risk === 'high';
    }

    getAllPermissionsMatrix() {
        let total = 0, highRisk = 0, mediumRisk = 0, lowRisk = 0;
        
        Object.values(this.context.state.permissions).forEach(permissions => {
            permissions.forEach(permId => {
                const permission = this.findPermission(permId);
                if (permission) {
                    total++;
                    switch (permission.risk) {
                        case 'high': highRisk++; break;
                        case 'medium': mediumRisk++; break;
                        case 'low': lowRisk++; break;
                    }
                }
            });
        });
        
        return { total, highRisk, mediumRisk, lowRisk };
    }

    update() {
        const newElement = this.render();
        this.element.replaceWith(newElement);
        this.element = newElement;
    }

    destroy() {
        this.element = null;
    }
}

export default PermissionsView;