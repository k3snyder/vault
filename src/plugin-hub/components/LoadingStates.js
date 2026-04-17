class LoadingStates {
    static createSpinner(size = 'medium') {
        const sizeMap = {
            small: 16,
            medium: 24,
            large: 32
        };
        
        const spinnerSize = sizeMap[size] || 24;
        
        const spinner = document.createElement('div');
        spinner.className = `loading-spinner loading-spinner-${size}`;
        spinner.innerHTML = `
            <svg width="${spinnerSize}" height="${spinnerSize}" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.25"/>
                <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        `;
        return spinner;
    }

    static createLoadingCard() {
        const card = document.createElement('div');
        card.className = 'loading-card';
        card.innerHTML = `
            <div class="loading-card-header">
                <div class="loading-skeleton loading-skeleton-icon"></div>
                <div class="loading-card-info">
                    <div class="loading-skeleton loading-skeleton-title"></div>
                    <div class="loading-skeleton loading-skeleton-description"></div>
                    <div class="loading-skeleton loading-skeleton-meta"></div>
                </div>
            </div>
        `;
        return card;
    }

    static createLoadingGrid(count = 6) {
        const grid = document.createElement('div');
        grid.className = 'loading-grid';
        
        for (let i = 0; i < count; i++) {
            grid.appendChild(this.createLoadingCard());
        }
        
        return grid;
    }

    static createLoadingOverlay(message = 'Loading...') {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-overlay-content">
                ${this.createSpinner('large').outerHTML}
                <p class="loading-message">${message}</p>
            </div>
        `;
        return overlay;
    }

    static createErrorState(title = 'Something went wrong', message = '', retry = null) {
        const error = document.createElement('div');
        error.className = 'error-state';
        error.innerHTML = `
            <div class="error-state-content">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" class="error-icon">
                    <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2" opacity="0.25"/>
                    <path d="M24 16V26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="24" cy="32" r="1" fill="currentColor"/>
                </svg>
                <h3 class="error-title">${title}</h3>
                ${message ? `<p class="error-message">${message}</p>` : ''}
                ${retry ? '<button class="error-retry-button">Try Again</button>' : ''}
            </div>
        `;
        
        if (retry) {
            const retryBtn = error.querySelector('.error-retry-button');
            retryBtn.addEventListener('click', retry);
        }
        
        return error;
    }

    static createEmptyState(title = 'No results found', message = '', action = null) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `
            <div class="empty-state-content">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" class="empty-icon">
                    <rect x="8" y="12" width="32" height="24" rx="2" stroke="currentColor" stroke-width="2" opacity="0.25"/>
                    <path d="M20 22H28M20 26H28" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
                </svg>
                <h3 class="empty-title">${title}</h3>
                ${message ? `<p class="empty-message">${message}</p>` : ''}
                ${action ? `<button class="empty-action-button">${action.label}</button>` : ''}
            </div>
        `;
        
        if (action) {
            const actionBtn = empty.querySelector('.empty-action-button');
            actionBtn.addEventListener('click', action.callback);
        }
        
        return empty;
    }

    static showInContainer(container, state) {
        container.innerHTML = '';
        container.appendChild(state);
    }

    static addLoadingToButton(button, loading = true) {
        if (loading) {
            button.disabled = true;
            button.classList.add('loading');
            const originalContent = button.innerHTML;
            button.dataset.originalContent = originalContent;
            button.innerHTML = `
                ${this.createSpinner('small').outerHTML}
                <span>Loading...</span>
            `;
        } else {
            button.disabled = false;
            button.classList.remove('loading');
            if (button.dataset.originalContent) {
                button.innerHTML = button.dataset.originalContent;
                delete button.dataset.originalContent;
            }
        }
    }
}

export default LoadingStates;