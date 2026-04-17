import { invoke } from '@tauri-apps/api/core';
import toast from '../plugin-hub/components/Toast.js';
import { formatDistanceToNow, format, isToday, isTomorrow, isPast, isWithinInterval, addDays } from 'date-fns';
import { createTaskCard } from './TaskCard.js';
import { icons } from '../icons/icon-utils.js';

export class TaskWidget {
    constructor(options = {}) {
        console.log('[TaskWidget] Initializing task widget');
        
        this.options = {
            showDashboardButton: true,
            variant: 'widget',
            onTaskOpen: null,
            ...options
        };
        this.container = null;
        this.tasks = [];
        this.groupedTasks = {};
        this.selectedFilter = 'all';
        this.searchQuery = '';
        this.updateInterval = null;
        this.fileSavedTimeout = null;
        
        // Bind methods
        this.handleTaskClick = this.handleTaskClick.bind(this);
        this.handleTaskToggle = this.handleTaskToggle.bind(this);
        this.handleFilterChange = this.handleFilterChange.bind(this);
        this.handleSearchInput = this.handleSearchInput.bind(this);
        this.openDashboard = this.openDashboard.bind(this);
        this.handleTasksUpdated = this.handleTasksUpdated.bind(this);
        this.handleFileSaved = this.handleFileSaved.bind(this);
    }
    
    mount(parentElement) {
        console.log('[TaskWidget] Mounting to parent element');
        
        // Create container
        this.container = document.createElement('div');
        this.container.className = this.options.variant === 'hub'
            ? 'task-widget task-widget-hub'
            : 'task-widget';
        
        // Create header with controls
        const header = this.createHeader();
        
        // Create search bar
        const searchBar = this.createSearchBar();
        
        // Create filter tabs
        const filterTabs = this.createFilterTabs();
        
        // Create task list container
        const taskList = document.createElement('div');
        taskList.className = 'task-list';
        taskList.id = 'task-list';
        
        // Assemble widget
        this.container.appendChild(header);
        this.container.appendChild(searchBar);
        this.container.appendChild(filterTabs);
        this.container.appendChild(taskList);
        
        // Add to parent
        parentElement.appendChild(this.container);
        
        // Load initial tasks
        this.loadTasks();
        
        // Set up auto-refresh
        this.startAutoRefresh();
        
        // Listen for task updates
        window.addEventListener('tasks-updated', this.handleTasksUpdated);
        
        // Listen for file saves to refresh tasks
        window.addEventListener('file-saved', this.handleFileSaved);
    }
    
    createHeader() {
        const header = document.createElement('div');
        header.className = 'task-header';
        
        const title = document.createElement('h3');
        title.textContent = 'Tasks';
        
        const controls = document.createElement('div');
        controls.className = 'task-header-controls';
        
        // Task count
        const count = document.createElement('span');
        count.className = 'task-count';
        count.id = 'task-count';
        count.textContent = '0 tasks';
        
        controls.appendChild(count);

        if (this.options.showDashboardButton) {
            const dashboardBtn = document.createElement('button');
            dashboardBtn.className = 'task-dashboard-btn';
            dashboardBtn.innerHTML = icons.layoutGrid({ size: 14 });
            dashboardBtn.title = 'Open Task Dashboard';
            dashboardBtn.addEventListener('click', this.openDashboard);
            controls.appendChild(dashboardBtn);
        }
        
        header.appendChild(title);
        header.appendChild(controls);
        
        return header;
    }
    
    createSearchBar() {
        const searchContainer = document.createElement('div');
        searchContainer.className = 'task-search-container';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'task-search-input';
        searchInput.placeholder = 'Search tasks...';
        searchInput.addEventListener('input', this.handleSearchInput);
        
        const searchIcon = document.createElement('span');
        searchIcon.className = 'task-search-icon';
        searchIcon.innerHTML = icons.search({ size: 14 });
        
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        
        return searchContainer;
    }
    
    createFilterTabs() {
        const tabContainer = document.createElement('div');
        tabContainer.className = 'task-filter-tabs';
        
        const filters = [
            { id: 'all', label: 'All', icon: icons.clipboardList({ size: 14 }) },
            { id: 'today', label: 'Today', icon: icons.calendar({ size: 14 }) },
            { id: 'overdue', label: 'Overdue', icon: icons.alertTriangle({ size: 14 }) },
            { id: 'upcoming', label: 'Upcoming', icon: icons.calendarDays({ size: 14 }) },
            { id: 'no-date', label: 'No Date', icon: icons.helpCircle({ size: 14 }) }
        ];

        filters.forEach(filter => {
            const tab = document.createElement('button');
            tab.className = 'task-filter-tab';
            tab.dataset.filter = filter.id;
            tab.innerHTML = `<span class="filter-icon">${filter.icon}</span> ${filter.label}`;
            
            if (filter.id === this.selectedFilter) {
                tab.classList.add('active');
            }
            
            tab.addEventListener('click', () => this.handleFilterChange(filter.id));
            tabContainer.appendChild(tab);
        });
        
        return tabContainer;
    }
    
    async loadTasks() {
        console.log('[TaskWidget] Loading tasks...');
        
        try {
            // Load tasks based on selected filter
            let tasks = [];
            
            switch (this.selectedFilter) {
                case 'today':
                    tasks = await invoke('query_tasks_today');
                    break;
                case 'overdue':
                    tasks = await invoke('query_tasks_overdue');
                    break;
                case 'upcoming':
                    // Get tasks for next 7 days
                    const today = new Date();
                    const nextWeek = addDays(today, 7);
                    // Tauri v2: pass camelCase from JS; Rust handler uses snake_case
                    tasks = await invoke('query_tasks_by_date_range', {
                        startDate: format(today, 'yyyy-MM-dd'),
                        endDate: format(nextWeek, 'yyyy-MM-dd')
                    });
                    break;
                case 'no-date':
                    // Query tasks without due dates
                    const allTasks = await invoke('query_tasks', {
                        query: { 
                            status: 'todo',
                            has_due_date: false 
                        }
                    });
                    tasks = allTasks;
                    break;
                default:
                    // Get all open tasks
                    tasks = await invoke('query_tasks_by_status', { status: 'todo' });
            }
            
            // Apply search filter if needed
            if (this.searchQuery) {
                tasks = this.filterBySearch(tasks, this.searchQuery);
            }
            
            this.tasks = tasks;
            this.groupTasksByProject();
            this.renderTasks();
            
            // Update count
            this.updateTaskCount();
            
        } catch (error) {
            console.error('[TaskWidget] Error loading tasks:', error);
            this.renderError(error);
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
    
    groupTasksByProject() {
        this.groupedTasks = {};
        
        this.tasks.forEach(task => {
            const project = task.project || 'No Project';
            if (!this.groupedTasks[project]) {
                this.groupedTasks[project] = [];
            }
            this.groupedTasks[project].push(task);
        });
        
        // Sort tasks within each group by priority and due date
        Object.keys(this.groupedTasks).forEach(project => {
            this.groupedTasks[project].sort((a, b) => {
                // Sort by priority first
                const priorityOrder = { high: 0, medium: 1, low: 2, null: 3 };
                const priorityDiff = (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
                if (priorityDiff !== 0) return priorityDiff;
                
                // Then by due date
                if (a.dueDate && b.dueDate) {
                    return new Date(a.dueDate) - new Date(b.dueDate);
                }
                if (a.dueDate) return -1;
                if (b.dueDate) return 1;
                
                // Finally by text
                return a.text.localeCompare(b.text);
            });
        });
    }
    
    renderTasks() {
        const taskList = document.getElementById('task-list');
        if (!taskList) return;
        
        taskList.innerHTML = '';
        
        if (this.tasks.length === 0) {
            this.renderEmptyState(taskList);
            return;
        }
        
        // Render tasks by project group
        Object.keys(this.groupedTasks).sort().forEach(project => {
            const projectGroup = this.createProjectGroup(project, this.groupedTasks[project]);
            taskList.appendChild(projectGroup);
        });
    }
    
    createProjectGroup(projectName, tasks) {
        const group = document.createElement('div');
        group.className = 'task-project-group';
        
        // Project header
        const header = document.createElement('div');
        header.className = 'task-project-header';
        
        const title = document.createElement('h4');
        title.textContent = projectName;
        
        const count = document.createElement('span');
        count.className = 'task-project-count';
        count.textContent = `${tasks.length}`;
        
        header.appendChild(title);
        header.appendChild(count);
        group.appendChild(header);
        
        // Task items
        const taskContainer = document.createElement('div');
        taskContainer.className = 'task-items';
        
        tasks.forEach(task => {
            const taskItem = this.createTaskItem(task);
            taskContainer.appendChild(taskItem);
        });
        
        group.appendChild(taskContainer);
        
        return group;
    }
    
    createTaskItem(task) {
        // Delegate to TaskCard factory for consistent rendering and behavior
        return createTaskCard(task, {
            onToggle: (t, checked) => this.handleTaskToggle(t, checked),
            onOpen: (t) => this.handleTaskClick(t),
        });
    }
    
    renderEmptyState(container) {
        const empty = document.createElement('div');
        empty.className = 'task-empty-state';
        
        const icon = document.createElement('div');
        icon.className = 'task-empty-icon';
        icon.innerHTML = icons.check({ size: 24 });
        
        const message = document.createElement('div');
        message.className = 'task-empty-message';
        
        switch (this.selectedFilter) {
            case 'today':
                message.textContent = 'No tasks due today';
                break;
            case 'overdue':
                message.textContent = 'No overdue tasks';
                break;
            case 'upcoming':
                message.textContent = 'No upcoming tasks';
                break;
            case 'no-date':
                message.textContent = 'No tasks without dates';
                break;
            default:
                message.textContent = 'No tasks found';
        }
        
        empty.appendChild(icon);
        empty.appendChild(message);
        container.appendChild(empty);
    }
    
    renderError(error) {
        const taskList = document.getElementById('task-list');
        if (!taskList) return;
        
        taskList.innerHTML = '';
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'task-error';
        errorDiv.innerHTML = `
            <div class="task-error-icon">${icons.alertTriangle({ size: 24 })}</div>
            <div class="task-error-message">Error loading tasks</div>
            <div class="task-error-detail">${error.message || error}</div>
            <button class="task-retry-btn">Retry</button>
        `;
        
        const retryBtn = errorDiv.querySelector('.task-retry-btn');
        retryBtn.addEventListener('click', () => this.loadTasks());
        
        taskList.appendChild(errorDiv);
    }
    
    updateTaskCount() {
        const countElement = document.getElementById('task-count');
        if (!countElement) return;
        
        const count = this.tasks.length;
        countElement.textContent = count === 1 ? '1 task' : `${count} tasks`;
    }
    
    async handleTaskToggle(task, checked) {
        console.log(`[TaskWidget] Toggling task ${task.id} to ${checked}`);
        console.log('[TaskWidget] Task object:', task); // Debug: log the full task object
        
        let toggled = false;
        try {
            await invoke('toggle_task_by_id', {
                filePath: task.filePath,
                taskId: task.id
            });
            toggled = true;
        } catch (error) {
            console.error('[TaskWidget] Error toggling by ID, attempting fallback:', error);
            try {
                console.log('[TaskWidget] Trying fallback with line number');
                await invoke('toggle_task_status', {
                    filePath: task.filePath,
                    lineNumber: task.lineNumber
                });
                toggled = true;
            } catch (fallbackError) {
                console.error('[TaskWidget] Fallback also failed:', fallbackError);
                try { toast.error('Failed to toggle task', 2000) } catch {}
                // Revert checkbox state on error
                const checkbox = this.container.querySelector(`[data-task-id="${task.id}"] .task-checkbox`);
                if (checkbox) {
                    checkbox.checked = !checked;
                }
                return;
            }
        }
        
        if (toggled) {
            try { toast.success('Task updated', 1200) } catch {}
            await this.loadTasks();
            try {
                await this.refreshEditorIfOpen(task.filePath);
            } catch (refreshError) {
                console.error('[TaskWidget] Editor refresh failed after toggle:', refreshError);
            }
        }
    }
    
    async refreshEditorIfOpen(filePath) {
        // Check if this file is currently open in the active tab's editor
        const activeEditor = window.paneManager?.getActiveTabManager?.()?.getActiveTab?.()?.editor;
        if (activeEditor && activeEditor.currentFile === filePath) {
            console.log('[TaskWidget] Refreshing editor for file:', filePath);
            
            // Read the updated content from the file
            try {
                // Use the standard content reader to avoid stale overwrites
                const content = await invoke('read_file_content', { filePath: filePath });
                
                // Update the editor content while preserving scroll position
                activeEditor.setContent(content, true, filePath, true);
            } catch (error) {
                console.error('[TaskWidget] Failed to refresh editor:', error);
            }
        }
    }
    
    async handleTaskClick(task) {
        console.log('[TaskWidget] Task clicked:', task);
        
        try {
            // Open the file containing the task  
            if (task.filePath && task.lineNumber) {
                await invoke('open_file_at_line', {
                    filePath: task.filePath,
                    lineNumber: task.lineNumber
                });
                if (typeof this.options.onTaskOpen === 'function') {
                    this.options.onTaskOpen(task);
                }
            }
        } catch (error) {
            console.error('[TaskWidget] Error opening task file:', error);
        }
    }
    
    handleFilterChange(filterId) {
        console.log(`[TaskWidget] Filter changed to: ${filterId}`);
        
        // Update active tab
        const tabs = this.container.querySelectorAll('.task-filter-tab');
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.filter === filterId);
        });
        
        this.selectedFilter = filterId;
        this.loadTasks();
    }
    
    handleSearchInput(event) {
        this.searchQuery = event.target.value;
        
        // Debounce search
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.loadTasks();
        }, 300);
    }
    
    openDashboard() {
        console.log('[TaskWidget] Opening task dashboard');
        
        // Dispatch event to open dashboard
        window.dispatchEvent(new CustomEvent('open-task-dashboard'));
    }

    handleTasksUpdated() {
        console.log('[TaskWidget] Tasks updated event received, reloading...');
        this.loadTasks();
    }

    handleFileSaved(event) {
        console.log('[TaskWidget] File saved event received:', event.detail);
        clearTimeout(this.fileSavedTimeout);
        this.fileSavedTimeout = setTimeout(() => this.loadTasks(), 500);
    }
    
    startAutoRefresh() {
        // Refresh tasks every 30 seconds
        this.updateInterval = setInterval(() => {
            this.loadTasks();
        }, 30000);
    }
    
    stopAutoRefresh() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    unmount() {
        console.log('[TaskWidget] Unmounting');
        this.stopAutoRefresh();
        clearTimeout(this.fileSavedTimeout);
        window.removeEventListener('tasks-updated', this.handleTasksUpdated);
        window.removeEventListener('file-saved', this.handleFileSaved);
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }
    
    // Settings management
    getSettings() {
        return {
            selectedFilter: this.selectedFilter,
            searchQuery: this.searchQuery
        };
    }
    
    setSettings(settings) {
        if (settings) {
            if (settings.selectedFilter) {
                this.selectedFilter = settings.selectedFilter;
            }
            if (settings.searchQuery !== undefined) {
                this.searchQuery = settings.searchQuery;
            }
        }
    }
}
