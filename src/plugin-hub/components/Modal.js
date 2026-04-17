class Modal {
    constructor(options = {}) {
        this.options = {
            title: options.title || '',
            content: options.content || '',
            size: options.size || 'medium',
            closeOnEscape: options.closeOnEscape !== false,
            closeOnOverlay: options.closeOnOverlay !== false,
            showClose: options.showClose !== false,
            actions: options.actions || [],
            className: options.className || '',
            onClose: options.onClose || null,
            ...options
        };
        
        this.element = null;
        this.previousFocus = null;
        this.focusTrap = null;
    }

    open() {
        this.previousFocus = document.activeElement;
        this.element = this.createElement();
        document.body.appendChild(this.element);
        
        requestAnimationFrame(() => {
            this.element.classList.add('modal-show');
            this.setupFocusTrap();
            this.attachEventListeners();
            
            const firstFocusable = this.element.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
            if (firstFocusable) {
                firstFocusable.focus();
            }
        });
        
        return this;
    }

    createElement() {
        const modal = document.createElement('div');
        modal.className = `modal-overlay ${this.options.className}`;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        if (this.options.title) {
            modal.setAttribute('aria-labelledby', 'modal-title');
        }
        
        modal.innerHTML = `
            <div class="modal modal-${this.options.size}">
                ${this.options.showClose ? `
                    <button class="modal-close" aria-label="Close dialog">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                ` : ''}
                ${this.options.title ? `
                    <div class="modal-header">
                        <h2 id="modal-title" class="modal-title">${this.options.title}</h2>
                    </div>
                ` : ''}
                <div class="modal-content">
                    ${this.options.content}
                </div>
                ${this.options.actions.length > 0 ? `
                    <div class="modal-footer">
                        ${this.options.actions.map(action => `
                            <button class="modal-action ${action.className || ''}" 
                                    data-action="${action.id || ''}"
                                    ${action.disabled ? 'disabled' : ''}>
                                ${action.label}
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        return modal;
    }

    attachEventListeners() {
        if (this.options.closeOnOverlay) {
            this.element.addEventListener('click', (e) => {
                if (e.target === this.element) {
                    this.close();
                }
            });
        }
        
        if (this.options.closeOnEscape) {
            this.escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    this.close();
                }
            };
            document.addEventListener('keydown', this.escapeHandler);
        }
        
        const closeBtn = this.element.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
        
        this.options.actions.forEach(action => {
            const btn = this.element.querySelector(`[data-action="${action.id}"]`);
            if (btn && action.handler) {
                btn.addEventListener('click', () => {
                    const result = action.handler(this);
                    if (result !== false) {
                        this.close();
                    }
                });
            }
        });
    }

    setupFocusTrap() {
        const focusableElements = this.element.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        
        this.focusTrap = (e) => {
            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusable) {
                        e.preventDefault();
                        lastFocusable.focus();
                    }
                } else {
                    if (document.activeElement === lastFocusable) {
                        e.preventDefault();
                        firstFocusable.focus();
                    }
                }
            }
        };
        
        this.element.addEventListener('keydown', this.focusTrap);
    }

    close() {
        if (!this.element) return;
        
        this.element.classList.add('modal-hide');
        
        this.element.addEventListener('animationend', () => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            
            if (this.escapeHandler) {
                document.removeEventListener('keydown', this.escapeHandler);
            }
            
            if (this.previousFocus) {
                this.previousFocus.focus();
            }
            
            if (this.options.onClose) {
                this.options.onClose();
            }
            
            this.element = null;
        }, { once: true });
    }

    setContent(content) {
        const contentEl = this.element?.querySelector('.modal-content');
        if (contentEl) {
            contentEl.innerHTML = content;
        }
    }

    static confirm(title, message, options = {}) {
        return new Promise((resolve) => {
            const modal = new Modal({
                title,
                content: `<p>${message}</p>`,
                size: 'small',
                ...options,
                actions: [
                    {
                        id: 'cancel',
                        label: options.cancelLabel || 'Cancel',
                        className: 'modal-action-secondary',
                        handler: () => {
                            resolve(false);
                            return true;
                        }
                    },
                    {
                        id: 'confirm',
                        label: options.confirmLabel || 'Confirm',
                        className: 'modal-action-primary',
                        handler: () => {
                            resolve(true);
                            return true;
                        }
                    }
                ]
            });
            modal.open();
        });
    }

    static alert(title, message, options = {}) {
        return new Promise((resolve) => {
            const modal = new Modal({
                title,
                content: `<p>${message}</p>`,
                size: 'small',
                ...options,
                actions: [
                    {
                        id: 'ok',
                        label: options.okLabel || 'OK',
                        className: 'modal-action-primary',
                        handler: () => {
                            resolve();
                            return true;
                        }
                    }
                ]
            });
            modal.open();
        });
    }
}

class PermissionDialog extends Modal {
    constructor(plugin, permissions) {
        const content = PermissionDialog.createPermissionContent(permissions);
        
        super({
            title: `${plugin.name} Permissions`,
            content,
            size: 'medium',
            className: 'permission-dialog',
            actions: [
                {
                    id: 'deny',
                    label: 'Deny',
                    className: 'modal-action-secondary'
                },
                {
                    id: 'grant',
                    label: 'Grant Permissions',
                    className: 'modal-action-primary'
                }
            ]
        });
        
        this.plugin = plugin;
        this.permissions = permissions;
    }

    static createPermissionContent(permissions) {
        return `
            <div class="permission-dialog-content">
                <p class="permission-dialog-intro">
                    This plugin requests the following permissions:
                </p>
                <div class="permission-list">
                    ${permissions.map(perm => `
                        <div class="permission-item">
                            <div class="permission-item-header">
                                <span class="permission-icon">${this.getPermissionIcon(perm.type)}</span>
                                <span class="permission-name">${perm.name}</span>
                                <span class="permission-level ${perm.level}">${perm.level}</span>
                            </div>
                            <p class="permission-description">${perm.description}</p>
                        </div>
                    `).join('')}
                </div>
                <div class="permission-warning">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 5V9M8 11H8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M7.13 2.5C7.51 1.83 8.49 1.83 8.87 2.5L14.4 12C14.78 12.67 14.29 13.5 13.53 13.5H2.47C1.71 13.5 1.22 12.67 1.6 12L7.13 2.5Z" 
                              stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    </svg>
                    <span>Only grant permissions to plugins you trust</span>
                </div>
            </div>
        `;
    }

    static getPermissionIcon(type) {
        const icons = {
            filesystem: '📁',
            network: '🌐',
            vault: '🔒',
            system: '⚙️'
        };
        return icons[type] || '🔑';
    }
}

class PluginSettingsModal extends Modal {
    constructor(plugin) {
        const content = PluginSettingsModal.createSettingsContent(plugin);
        
        super({
            title: `${plugin.name} Settings`,
            content,
            size: 'large',
            className: 'plugin-settings-modal',
            actions: [
                {
                    id: 'cancel',
                    label: 'Cancel',
                    className: 'modal-action-secondary'
                },
                {
                    id: 'save',
                    label: 'Save Settings',
                    className: 'modal-action-primary'
                }
            ]
        });
        
        this.plugin = plugin;
    }

    static createSettingsContent(plugin) {
        console.log('Creating settings content for plugin:', plugin);
        console.log('Plugin settings:', plugin.settings);
        console.log('Plugin settings_schema:', plugin.settings_schema);
        
        if (!plugin.settings || !Array.isArray(plugin.settings) || plugin.settings.length === 0) {
            return '<p class="no-settings">This plugin has no configurable settings.</p>';
        }
        
        // Debug each setting field being created
        const fields = [];
        
        plugin.settings.forEach(setting => {
            console.log(`Creating field for setting:`, setting);
            const field = this.createSettingField(setting);
            console.log(`Generated HTML for ${setting.id}:`, field ? 'Field created' : 'EMPTY FIELD');
            fields.push(field);
            
            // Add Initial Sync button after API Token field for Readwise plugin
            if (plugin.id === 'readwise' && setting.id === 'apiToken') {
                fields.push(`
                    <div class="setting-field">
                        <button type="button" class="initial-sync-button modal-action modal-action-sync">
                            Initial Sync
                        </button>
                        <p class="setting-description">Click to perform an initial sync with your Readwise account</p>
                    </div>
                `);
            }
        });
        
        return `
            <div class="plugin-settings-content">
                <form class="plugin-settings-form">
                    ${fields.join('')}
                </form>
            </div>
        `;
    }

    static createSettingField(setting) {
        console.log(`createSettingField called for ${setting.id} with type: ${setting.type}`);
        
        switch (setting.type) {
            case 'text':
            case 'string':  // Handle both 'text' and 'string' types
                console.log(`  -> Rendering as TEXT field for ${setting.id}`);
                return `
                    <div class="setting-field">
                        <label for="${setting.id}">
                            ${setting.label}
                            ${setting.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <input type="text" 
                               id="${setting.id}" 
                               name="${setting.id}"
                               value="${setting.value || ''}"
                               placeholder="${setting.placeholder || ''}"
                               ${setting.required ? 'required' : ''}>
                        ${setting.description ? `<p class="setting-description">${setting.description}</p>` : ''}
                    </div>
                `;
                
            case 'password':
                return `
                    <div class="setting-field">
                        <label for="${setting.id}">
                            ${setting.label}
                            ${setting.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <input type="password" 
                               id="${setting.id}" 
                               name="${setting.id}"
                               value="${setting.value || ''}"
                               placeholder="${setting.placeholder || ''}"
                               ${setting.required ? 'required' : ''}>
                        ${setting.description ? `<p class="setting-description">${setting.description}</p>` : ''}
                    </div>
                `;
                
            case 'boolean':
            case 'toggle':
                console.log(`  -> Rendering as TOGGLE field for ${setting.id}`);
                return `
                    <div class="setting-field setting-toggle-field">
                        <label for="${setting.id}">
                            <span>${setting.label}</span>
                            <input type="checkbox" 
                                   id="${setting.id}" 
                                   name="${setting.id}"
                                   ${setting.value ? 'checked' : ''}>
                            <span class="setting-toggle-slider"></span>
                        </label>
                        ${setting.description ? `<p class="setting-description">${setting.description}</p>` : ''}
                    </div>
                `;
                
            case 'number':
                return `
                    <div class="setting-field">
                        <label for="${setting.id}">
                            ${setting.label}
                            ${setting.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <input type="number" 
                               id="${setting.id}" 
                               name="${setting.id}"
                               value="${setting.value || ''}"
                               ${setting.min !== undefined ? `min="${setting.min}"` : ''}
                               ${setting.max !== undefined ? `max="${setting.max}"` : ''}
                               placeholder="${setting.placeholder || ''}"
                               ${setting.required ? 'required' : ''}>
                        ${setting.description ? `<p class="setting-description">${setting.description}</p>` : ''}
                    </div>
                `;
                
            case 'textarea':
                return `
                    <div class="setting-field">
                        <label for="${setting.id}">
                            ${setting.label}
                            ${setting.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <textarea id="${setting.id}" 
                                  name="${setting.id}"
                                  rows="4"
                                  placeholder="${setting.placeholder || ''}"
                                  ${setting.required ? 'required' : ''}>${setting.value || ''}</textarea>
                        ${setting.description ? `<p class="setting-description">${setting.description}</p>` : ''}
                    </div>
                `;
                
            case 'select':
                return `
                    <div class="setting-field">
                        <label for="${setting.id}">${setting.label}</label>
                        <select id="${setting.id}" name="${setting.id}">
                            ${Array.isArray(setting.options) ? 
                                setting.options.map(opt => {
                                    const optValue = typeof opt === 'string' ? opt : opt.value;
                                    const optLabel = typeof opt === 'string' ? opt : opt.label;
                                    return `
                                        <option value="${optValue}" ${setting.value === optValue ? 'selected' : ''}>
                                            ${optLabel}
                                        </option>
                                    `;
                                }).join('') : ''}
                        </select>
                        ${setting.description ? `<p class="setting-description">${setting.description}</p>` : ''}
                    </div>
                `;
                
            default:
                console.warn(`Unknown setting type: ${setting.type} for field ${setting.id}`);
                return '';
        }
    }
}

export { Modal, PermissionDialog, PluginSettingsModal };