class ToastManager {
    constructor() {
        this.container = null;
        this.toasts = new Map();
        this.init();
    }

    init() {
        if (!document.getElementById('toast-container')) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            this.container.setAttribute('role', 'region');
            this.container.setAttribute('aria-label', 'Notifications');
            this.container.setAttribute('aria-live', 'polite');
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('toast-container');
        }
    }

    show(message, type = 'info', duration = 3000) {
        const id = Date.now().toString();
        const toast = this.createToast(id, message, type);
        
        this.toasts.set(id, toast);
        this.container.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });
        
        if (duration > 0) {
            setTimeout(() => {
                this.dismiss(id);
            }, duration);
        }
        
        return id;
    }

    createToast(id, message, type) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.id = `toast-${id}`;
        toast.setAttribute('role', 'alert');
        
        const icon = this.getIcon(type);
        
        toast.innerHTML = `
            <div class="toast-content">
                <span class="toast-icon">${icon}</span>
                <span class="toast-message">${message}</span>
            </div>
            <button class="toast-close" aria-label="Dismiss notification">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </button>
        `;
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => this.dismiss(id));
        
        return toast;
    }

    getIcon(type) {
        const icons = {
            success: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8L6 11L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`,
            error: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
                <path d="M8 5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="8" cy="11" r="0.5" fill="currentColor"/>
            </svg>`,
            warning: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7.13 2.5C7.51 1.83 8.49 1.83 8.87 2.5L14.4 12C14.78 12.67 14.29 13.5 13.53 13.5H2.47C1.71 13.5 1.22 12.67 1.6 12L7.13 2.5Z" 
                      stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M8 6V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="8" cy="11" r="0.5" fill="currentColor"/>
            </svg>`,
            info: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
                <path d="M8 7V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="8" cy="5" r="0.5" fill="currentColor"/>
            </svg>`
        };
        
        return icons[type] || icons.info;
    }

    dismiss(id) {
        const toast = this.toasts.get(id);
        if (!toast) return;
        
        toast.classList.add('toast-hide');
        
        toast.addEventListener('animationend', () => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            this.toasts.delete(id);
        }, { once: true });
    }

    dismissAll() {
        this.toasts.forEach((toast, id) => {
            this.dismiss(id);
        });
    }

    success(message, duration) {
        return this.show(message, 'success', duration);
    }

    error(message, duration) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration) {
        return this.show(message, 'info', duration);
    }
}

const toastManager = new ToastManager();

export default toastManager;