import { invoke } from '@tauri-apps/api/core';
import { TaskListView } from './TaskListView.js';
import { TaskKanbanView } from './TaskKanbanView.js';
import { TaskCalendarView } from './TaskCalendarView.js';

export class TaskDashboard {
    constructor() {
        console.log('[TaskDashboard] Initializing task dashboard');
        
        this.modal = null;
        this.currentView = 'list'; // list, kanban, calendar
        this.currentProject = null;
        this.searchQuery = '';
        this.tasks = [];
        this.projects = [];
        
        // View instances
        this.views = {
            list: null,
            kanban: null,
            calendar: null
        };
        
        // Bind methods
        this.close = this.close.bind(this);
        this.handleViewChange = this.handleViewChange.bind(this);
        this.handleProjectChange = this.handleProjectChange.bind(this);
        this.handleSearch = this.handleSearch.bind(this);
        this.handleKeyPress = this.handleKeyPress.bind(this);
    }
    
    async open() {
        console.log('[TaskDashboard] Opening dashboard');
        
        // Create modal overlay
        this.createModal();
        
        // Load initial data
        await this.loadProjects();
        await this.loadTasks();
        
        // Show initial view
        this.showView(this.currentView);
        
        // Add keyboard listener
        document.addEventListener('keydown', this.handleKeyPress);
    }
    
    createModal() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.className = 'task-dashboard-modal';
        
        // Create modal content
        const content = document.createElement('div');
        content.className = 'task-dashboard-content';
        
        // Create header
        const header = this.createHeader();
        
        // Create toolbar
        const toolbar = this.createToolbar();
        
        // Create view container
        const viewContainer = document.createElement('div');
        viewContainer.className = 'task-dashboard-view';
        viewContainer.id = 'task-dashboard-view';
        
        // Assemble modal
        content.appendChild(header);
        content.appendChild(toolbar);
        content.appendChild(viewContainer);
        
        this.modal.appendChild(content);
        
        // Add to body
        document.body.appendChild(this.modal);
        
        // Animate in
        requestAnimationFrame(() => {
            this.modal.classList.add('visible');
        });
    }
    
    createHeader() {
        const header = document.createElement('div');
        header.className = 'task-dashboard-header';
        
        // Title
        const title = document.createElement('h2');
        title.textContent = 'Task Dashboard';
        
        // Stats
        const stats = document.createElement('div');
        stats.className = 'task-dashboard-stats';
        stats.id = 'task-stats';
        
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'task-dashboard-close';
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Close (Esc)';
        closeBtn.addEventListener('click', this.close);
        
        header.appendChild(title);
        header.appendChild(stats);
        header.appendChild(closeBtn);
        
        return header;
    }
    
    createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'task-dashboard-toolbar';
        
        // View switcher
        const viewSwitcher = document.createElement('div');
        viewSwitcher.className = 'task-view-switcher';
        
        const views = [
            { id: 'list', label: 'List', icon: '☰' },
            { id: 'kanban', label: 'Kanban', icon: '⊞' },
            { id: 'calendar', label: 'Calendar', icon: '📅' }
        ];
        
        views.forEach(view => {
            const btn = document.createElement('button');
            btn.className = 'task-view-btn';
            btn.dataset.view = view.id;
            btn.innerHTML = `${view.icon} ${view.label}`;
            btn.title = `${view.label} View`;
            
            if (view.id === this.currentView) {
                btn.classList.add('active');
            }
            
            btn.addEventListener('click', () => this.handleViewChange(view.id));
            viewSwitcher.appendChild(btn);
        });
        
        // Filters
        const filters = document.createElement('div');
        filters.className = 'task-dashboard-filters';
        
        // Project filter
        const projectSelect = document.createElement('select');
        projectSelect.className = 'task-project-filter';
        projectSelect.id = 'project-filter';
        projectSelect.addEventListener('change', this.handleProjectChange);
        
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'All Projects';
        projectSelect.appendChild(allOption);
        
        filters.appendChild(projectSelect);
        
        // Search bar
        const searchContainer = document.createElement('div');
        searchContainer.className = 'task-dashboard-search';
        
        const searchIcon = document.createElement('span');
        searchIcon.className = 'search-icon';
        searchIcon.innerHTML = '🔍';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'task-search';
        searchInput.placeholder = 'Search tasks...';
        searchInput.value = this.searchQuery;
        searchInput.addEventListener('input', this.handleSearch);
        
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        
        filters.appendChild(searchContainer);
        
        // Actions
        const actions = document.createElement('div');
        actions.className = 'task-dashboard-actions';
        
        // Refresh button
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'task-action-btn';
        refreshBtn.innerHTML = '🔄';
        refreshBtn.title = 'Refresh';
        refreshBtn.addEventListener('click', () => this.loadTasks());
        
        actions.appendChild(refreshBtn);
        
        toolbar.appendChild(viewSwitcher);
        toolbar.appendChild(filters);
        toolbar.appendChild(actions);
        
        return toolbar;
    }
    
    async loadProjects() {
        try {
            // Get all tasks to extract unique projects
            const allTasks = await invoke('query_tasks', { query: {} });
            const projectSet = new Set();
            
            allTasks.forEach(task => {
                if (task.project) {
                    projectSet.add(task.project);
                }
            });
            
            this.projects = Array.from(projectSet).sort();
            
            // Update project filter
            const projectSelect = document.getElementById('project-filter');
            if (projectSelect) {
                // Clear existing options except "All Projects"
                while (projectSelect.options.length > 1) {
                    projectSelect.remove(1);
                }
                
                // Add project options
                this.projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project;
                    option.textContent = project;
                    projectSelect.appendChild(option);
                });
            }
            
        } catch (error) {
            console.error('[TaskDashboard] Error loading projects:', error);
        }
    }
    
    async loadTasks() {
        console.log('[TaskDashboard] Loading tasks...');
        
        try {
            // Build query based on filters
            const query = {};
            
            if (this.currentProject) {
                query.project = this.currentProject;
            }
            
            // Get tasks
            this.tasks = await invoke('query_tasks', { query });
            
            // Apply search filter
            if (this.searchQuery) {
                this.tasks = this.filterBySearch(this.tasks, this.searchQuery);
            }
            
            // Update stats
            this.updateStats();
            
            // Update current view
            if (this.views[this.currentView]) {
                this.views[this.currentView].updateTasks(this.tasks);
            }
            
        } catch (error) {
            console.error('[TaskDashboard] Error loading tasks:', error);
        }
    }
    
    filterBySearch(tasks, query) {
        const lowerQuery = query.toLowerCase();
        return tasks.filter(task => {
            const searchableText = [
                task.text,
                task.project || '',
                ...(task.tags || [])
            ].join(' ').toLowerCase();
            
            return searchableText.includes(lowerQuery);
        });
    }
    
    updateStats() {
        const statsElement = document.getElementById('task-stats');
        if (!statsElement) return;
        
        const total = this.tasks.length;
        const done = this.tasks.filter(t => t.status === 'done').length;
        const overdue = this.tasks.filter(t => {
            if (!t.due_date || t.status === 'done') return false;
            return new Date(t.due_date) < new Date();
        }).length;
        
        statsElement.innerHTML = `
            <span class="stat-item">
                <span class="stat-value">${total}</span>
                <span class="stat-label">Total</span>
            </span>
            <span class="stat-item">
                <span class="stat-value">${done}</span>
                <span class="stat-label">Done</span>
            </span>
            <span class="stat-item">
                <span class="stat-value">${total - done}</span>
                <span class="stat-label">Open</span>
            </span>
            ${overdue > 0 ? `
                <span class="stat-item stat-overdue">
                    <span class="stat-value">${overdue}</span>
                    <span class="stat-label">Overdue</span>
                </span>
            ` : ''}
        `;
    }
    
    showView(viewType) {
        console.log(`[TaskDashboard] Showing ${viewType} view`);
        
        const viewContainer = document.getElementById('task-dashboard-view');
        if (!viewContainer) return;
        
        // Clear current view
        viewContainer.innerHTML = '';
        
        // Create or get view instance
        if (!this.views[viewType]) {
            switch (viewType) {
                case 'list':
                    this.views[viewType] = new TaskListView();
                    break;
                case 'kanban':
                    this.views[viewType] = new TaskKanbanView();
                    break;
                case 'calendar':
                    this.views[viewType] = new TaskCalendarView();
                    break;
            }
        }
        
        // Mount view
        if (this.views[viewType]) {
            this.views[viewType].mount(viewContainer);
            this.views[viewType].updateTasks(this.tasks);
        }
    }
    
    handleViewChange(viewType) {
        console.log(`[TaskDashboard] View changed to: ${viewType}`);
        
        // Update active button
        const buttons = this.modal.querySelectorAll('.task-view-btn');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewType);
        });
        
        this.currentView = viewType;
        this.showView(viewType);
    }
    
    handleProjectChange(event) {
        this.currentProject = event.target.value || null;
        this.loadTasks();
    }
    
    handleSearch(event) {
        this.searchQuery = event.target.value;
        
        // Debounce search
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.loadTasks();
        }, 300);
    }
    
    handleKeyPress(event) {
        // Close on Escape
        if (event.key === 'Escape') {
            this.close();
        }
        
        // Focus search on Cmd/Ctrl+F
        if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
            event.preventDefault();
            const searchInput = this.modal.querySelector('.task-search');
            if (searchInput) {
                searchInput.focus();
            }
        }
    }
    
    close() {
        console.log('[TaskDashboard] Closing dashboard');
        
        // Remove keyboard listener
        document.removeEventListener('keydown', this.handleKeyPress);
        
        // Animate out
        if (this.modal) {
            this.modal.classList.remove('visible');
            
            // Remove after animation
            setTimeout(() => {
                if (this.modal && this.modal.parentElement) {
                    this.modal.parentElement.removeChild(this.modal);
                }
                this.modal = null;
            }, 300);
        }
        
        // Clean up views
        Object.values(this.views).forEach(view => {
            if (view && view.unmount) {
                view.unmount();
            }
        });
        this.views = {};
    }
}

// Global instance
let taskDashboard = null;

// Export function to open dashboard
export function openTaskDashboard() {
    if (!taskDashboard) {
        taskDashboard = new TaskDashboard();
    }
    taskDashboard.open();
}

// Listen for open event
window.addEventListener('open-task-dashboard', () => {
    openTaskDashboard();
});