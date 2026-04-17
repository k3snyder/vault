// VaultPicker.js - Vault selection dropdown component

import { invoke } from '@tauri-apps/api/core';
import windowContext from '../contexts/WindowContext.js';
import { icons } from '../icons/icon-utils.js';

export class VaultPicker {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            variant: 'default',
            emptyLabel: 'No Vault',
            showIcon: true,
            enableKeyboardShortcut: true,
            ...options
        };
        this.recentVaults = [];
        this.isOpen = false;
        this.currentVault = null;
        this.listenersAttached = false;

        this.handleVaultOpened = this.handleVaultOpened.bind(this);
        this.handleContainerClick = this.handleContainerClick.bind(this);
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
        this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
        
        this.init();
    }
    
    async init() {
        // Listen for vault changes
        windowContext.on('vault-opened', this.handleVaultOpened);
        
        // Load recent vaults
        await this.loadRecentVaults();
        
        // Get current vault info
        this.currentVault = await windowContext.getVaultInfo();
        
        // Initial render
        this.render();
        this.attachEventListeners();
    }

    handleVaultOpened(vault) {
        console.log('VaultPicker: Received vault-opened event', vault);
        this.currentVault = vault;
        this.render();
    }
    
    async loadRecentVaults() {
        try {
            this.recentVaults = await invoke('get_recent_vaults_basic') || [];
        } catch (error) {
            console.error('VaultPicker: Failed to load recent vaults', error);
            this.recentVaults = [];
        }
    }
    
    render() {
        const variantClass = this.options.variant === 'hero' ? ' vault-picker--hero' : '';
        const iconMarkup = this.options.showIcon ? `
                    <span class="vault-icon">
                        ${icons.lockKeyhole({ size: 16 })}
                    </span>
        ` : '';
        const vaultName = this.currentVault ? this.escapeHtml(this.currentVault.name) : this.escapeHtml(this.options.emptyLabel);

        this.container.innerHTML = `
            <div class="vault-picker${variantClass}">
                <button class="vault-picker-button" type="button" aria-expanded="${this.isOpen ? 'true' : 'false'}">
                    ${iconMarkup}
                    <span class="vault-name">
                        ${vaultName}
                    </span>
                    <span class="dropdown-arrow">▼</span>
                </button>
                <div class="vault-picker-menu ${this.isOpen ? 'open' : ''}">
                    ${this.renderMenu()}
                </div>
            </div>
        `;
    }
    
    renderMenu() {
        let menuHtml = '<div class="vault-picker-menu-inner">';
        
        // Recent vaults section - show only last 3
        if (this.recentVaults.length > 0) {
            menuHtml += '<div class="vault-picker-section">';
            menuHtml += '<div class="vault-picker-section-title">Recent Vaults</div>';
            
            // Limit to last 3 recent vaults
            const vaultsToShow = this.recentVaults.slice(0, 3);
            
            vaultsToShow.forEach(vault => {
                const isActive = this.currentVault?.path === vault.path;
                menuHtml += `
                    <div class="vault-picker-item ${isActive ? 'active' : ''}" 
                         data-action="open-vault" 
                         data-path="${this.escapeHtml(vault.path)}">
                        ${isActive ? `<span class="checkmark">${icons.check({ size: 14 })}</span>` : '<span class="spacer"></span>'}
                        <span class="vault-item-name">${this.escapeHtml(vault.name)}</span>
                        <span class="vault-item-path">${this.escapeHtml(this.shortenPath(vault.path))}</span>
                    </div>
                `;
            });
            
            menuHtml += '</div>';
        }
        
        // Actions section
        menuHtml += '<div class="vault-picker-section">';
        menuHtml += '<div class="vault-picker-divider"></div>';
        
        menuHtml += `
            <div class="vault-picker-item" data-action="open-folder">
                <span class="spacer"></span>
                <span class="vault-item-name">Open Vault...</span>
            </div>
            <div class="vault-picker-item" data-action="open-new-window">
                <span class="spacer"></span>
                <span class="vault-item-name">Open Vault in New Window...</span>
            </div>
            <div class="vault-picker-item" data-action="create-vault">
                <span class="spacer"></span>
                <span class="vault-item-name">Create New Vault</span>
            </div>
            <div class="vault-picker-item" data-action="close-vault">
                <span class="spacer"></span>
                <span class="vault-item-name">Close Vault</span>
            </div>
        `;
        
        
        menuHtml += '</div>';
        menuHtml += '</div>';
        
        return menuHtml;
    }
    
    attachEventListeners() {
        if (this.listenersAttached) {
            return;
        }

        this.container.addEventListener('click', this.handleContainerClick);
        document.addEventListener('click', this.handleDocumentClick);

        if (this.options.enableKeyboardShortcut) {
            document.addEventListener('keydown', this.handleDocumentKeydown);
        }

        this.listenersAttached = true;
    }

    async handleContainerClick(e) {
        const button = e.target.closest('.vault-picker-button');
        if (button && this.container.contains(button)) {
            e.stopPropagation();
            this.toggleMenu();
            return;
        }

        const item = e.target.closest('.vault-picker-item');
        if (!item || !this.container.contains(item)) {
            return;
        }

        e.stopPropagation();

        const action = item.dataset.action;
        const path = item.dataset.path;

        switch (action) {
            case 'open-vault':
                await this.openVault(path, false);
                break;
            case 'open-folder':
                await this.openVaultPicker(false);
                break;
            case 'open-new-window':
                await this.openVaultPicker(true);
                break;
            case 'create-vault':
                await this.createNewVault();
                break;
            case 'close-vault':
                await this.closeVault();
                break;
            case 'manage-vaults':
                await this.manageVaults();
                break;
        }

        this.closeMenu();
    }

    handleDocumentClick(e) {
        if (!this.container.contains(e.target)) {
            this.closeMenu();
        }
    }

    handleDocumentKeydown(e) {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'O') {
            e.preventDefault();
            this.openVaultPicker(true);
        }
    }

    getMenuElement() {
        return this.container.querySelector('.vault-picker-menu');
    }

    getButtonElement() {
        return this.container.querySelector('.vault-picker-button');
    }

    getRootElement() {
        return this.container.querySelector('.vault-picker');
    }

    syncOpenState() {
        const root = this.getRootElement();
        const button = this.getButtonElement();
        const menu = this.getMenuElement();

        if (root) {
            root.classList.toggle('is-open', this.isOpen);
        }

        if (button) {
            button.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
        }

        if (menu) {
            menu.classList.toggle('open', this.isOpen);
        }
    }
    
    toggleMenu() {
        this.isOpen = !this.isOpen;
        this.syncOpenState();
    }
    
    closeMenu() {
        this.isOpen = false;
        this.syncOpenState();
    }
    
    async openVault(path, inNewWindow) {
        try {
            if (inNewWindow) {
                await invoke('open_vault_in_new_window_basic', { vaultPath: path });
            } else {
                // Switch vault in current window
                await windowContext.switchVault(path);
            }
            
            // Reload recent vaults
            await this.loadRecentVaults();
        } catch (error) {
            console.error('VaultPicker: Failed to open vault', error);
            alert(`Failed to open vault: ${error.message || error}`);
        }
    }
    
    async openVaultPicker(inNewWindow) {
        try {
            // Use Tauri command instead of dialog plugin directly
            const selected = await invoke('select_folder_for_vault');
            
            if (selected) {
                await this.openVault(selected, inNewWindow);
            }
        } catch (error) {
            console.error('VaultPicker: Failed to open folder picker', error);
        }
    }
    
    async manageVaults() {
        try {
            await invoke('manage_vaults_basic');
        } catch (error) {
            console.error('VaultPicker: Failed to open vault manager', error);
        }
    }
    
    async createNewVault() {
        try {
            const selected = await invoke('select_folder_for_vault');
            
            if (selected) {
                // Initialize new vault structure
                await invoke('init_vault', { path: selected });
                // Open the newly created vault
                await this.openVault(selected, false);
            }
        } catch (error) {
            console.error('VaultPicker: Failed to create new vault', error);
            alert(`Failed to create vault: ${error.message || error}`);
        }
    }
    
    async closeVault() {
        try {
            // Use the existing closeCurrentVault function
            await window.closeCurrentVault();
            
            // Update UI to show no vault
            this.currentVault = null;
            this.render();
        } catch (error) {
            console.error('VaultPicker: Failed to close vault', error);
            alert(`Failed to close vault: ${error.message || error}`);
        }
    }
    
    // Helper methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    shortenPath(path) {
        const parts = path.split(/[/\\]/);
        if (parts.length > 3) {
            return `.../${parts.slice(-2).join('/')}`;
        }
        return path;
    }

    destroy() {
        if (this.listenersAttached) {
            this.container.removeEventListener('click', this.handleContainerClick);
            document.removeEventListener('click', this.handleDocumentClick);

            if (this.options.enableKeyboardShortcut) {
                document.removeEventListener('keydown', this.handleDocumentKeydown);
            }

            this.listenersAttached = false;
        }

        windowContext.off('vault-opened', this.handleVaultOpened);
    }
}

// Add styles
const style = document.createElement('style');
style.textContent = `
.vault-picker {
    position: relative;
    display: inline-block;
    z-index: 1;
}

.vault-picker-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    color: var(--text-normal);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
}

.vault-picker-button:hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
}

.vault-icon {
    display: flex;
    align-items: center;
    opacity: 0.8;
}

.vault-name {
    font-weight: 500;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.2s ease;
}

.dropdown-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    opacity: 0.6;
    margin-left: 4px;
    transition: transform 0.2s ease, color 0.2s ease, opacity 0.2s ease;
    transform-origin: center;
}

.vault-picker.is-open .dropdown-arrow,
.vault-picker-button[aria-expanded="true"] .dropdown-arrow {
    transform: rotate(180deg);
}

.vault-picker-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 280px;
    max-width: 400px;
    background: var(--background-primary);
    background-color: rgba(30, 30, 30, 0.98);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: all 0.2s;
    z-index: 2000;
}

.vault-picker-menu.open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}

.vault-picker-menu-inner {
    padding: 4px;
    background: rgba(30, 30, 30, 0.98);
    border-radius: 8px;
    text-align: left;
}

.vault-picker-section {
    margin: 4px 0;
}

.vault-picker-section-title {
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
}

.vault-picker-item {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
}

.vault-picker-item:hover {
    background: rgba(255, 255, 255, 0.08);
}

.vault-picker-item.active {
    background: rgba(255, 255, 255, 0.12);
}

.checkmark, .spacer {
    width: 20px;
    flex-shrink: 0;
    text-align: center;
    color: var(--text-accent);
}

.vault-item-name {
    flex: 1;
    font-size: 16px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vault-picker-item[data-action] .vault-item-name {
    flex: 0 1 auto;
}

.vault-item-path {
    margin-left: 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vault-picker-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
}
`;
document.head.appendChild(style);
