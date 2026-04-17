import { invoke } from '@tauri-apps/api/core';
import toast from '../plugin-hub/components/Toast.js';
import { format, isToday, isTomorrow, isPast, formatDistanceToNow } from 'date-fns';

export class TaskListView {
    constructor() {
        console.log('[TaskListView] Initializing list view');
        
        this.container = null;
        this.tasks = [];
        this.sortBy = 'priority'; // priority, due_date, project, text
        this.sortOrder = 'asc'; // asc, desc
        this.groupBy = 'project'; // project, priority, status, none
        
        // Bind methods
        this.handleTaskClick = this.handleTaskClick.bind(this);
        this.handleTaskToggle = this.handleTaskToggle.bind(this);
        this.handleSort = this.handleSort.bind(this);
        this.handleGroupBy = this.handleGroupBy.bind(this);
    }
    
    mount(parentElement) {
        console.log('[TaskListView] Mounting to parent');
        
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'task-list-view';
        
        // Create controls
        const controls = this.createControls();
        
        // Create list container
        const listContainer = document.createElement('div');
        listContainer.className = 'task-list-container';
        listContainer.id = 'task-list-container';
        
        // Assemble view
        this.container.appendChild(controls);
        this.container.appendChild(listContainer);
        
        parentElement.appendChild(this.container);
    }
    
    createControls() {
        const controls = document.createElement('div');
        controls.className = 'task-list-controls';
        
        // Sort controls
        const sortGroup = document.createElement('div');
        sortGroup.className = 'control-group';
        
        const sortLabel = document.createElement('label');
        sortLabel.textContent = 'Sort by:';
        
        const sortSelect = document.createElement('select');
        sortSelect.className = 'task-sort-select';
        sortSelect.addEventListener('change', this.handleSort);
        
        const sortOptions = [
            { value: 'priority', label: 'Priority' },
            { value: 'due_date', label: 'Due Date' },
            { value: 'project', label: 'Project' },
            { value: 'text', label: 'Name' },
            { value: 'created_at', label: 'Created' }
        ];
        
        sortOptions.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            if (option.value === this.sortBy) {
                opt.selected = true;
            }
            sortSelect.appendChild(opt);
        });
        
        // Sort order toggle
        const orderBtn = document.createElement('button');
        orderBtn.className = 'sort-order-btn';
        orderBtn.innerHTML = this.sortOrder === 'asc' ? '↑' : '↓';
        orderBtn.title = 'Toggle sort order';
        orderBtn.addEventListener('click', () => {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
            orderBtn.innerHTML = this.sortOrder === 'asc' ? '↑' : '↓';
            this.renderTasks();
        });
        
        sortGroup.appendChild(sortLabel);
        sortGroup.appendChild(sortSelect);
        sortGroup.appendChild(orderBtn);
        
        // Group controls
        const groupGroup = document.createElement('div');
        groupGroup.className = 'control-group';
        
        const groupLabel = document.createElement('label');
        groupLabel.textContent = 'Group by:';
        
        const groupSelect = document.createElement('select');
        groupSelect.className = 'task-group-select';
        groupSelect.addEventListener('change', this.handleGroupBy);
        
        const groupOptions = [
            { value: 'none', label: 'None' },
            { value: 'project', label: 'Project' },
            { value: 'priority', label: 'Priority' },
            { value: 'status', label: 'Status' },
            { value: 'due_date', label: 'Due Date' }
        ];
        
        groupOptions.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            if (option.value === this.groupBy) {
                opt.selected = true;
            }
            groupSelect.appendChild(opt);
        });
        
        groupGroup.appendChild(groupLabel);
        groupGroup.appendChild(groupSelect);
        
        controls.appendChild(sortGroup);
        controls.appendChild(groupGroup);
        
        return controls;
    }
    
    updateTasks(tasks) {
        console.log(`[TaskListView] Updating with ${tasks.length} tasks`);
        this.tasks = tasks;
        this.renderTasks();
    }
    
    renderTasks() {
        const container = document.getElementById('task-list-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.tasks.length === 0) {
            this.renderEmptyState(container);
            return;
        }
        
        // Sort tasks
        const sortedTasks = this.sortTasks([...this.tasks]);
        
        // Group tasks if needed
        if (this.groupBy === 'none') {
            const list = this.createTaskList(sortedTasks);
            container.appendChild(list);
        } else {
            const groups = this.groupTasks(sortedTasks);
            this.renderGroups(container, groups);
        }
    }
    
    sortTasks(tasks) {
        return tasks.sort((a, b) => {
            let comparison = 0;
            
            switch (this.sortBy) {
                case 'priority':
                    const priorityOrder = { high: 0, medium: 1, low: 2 };
                    const aPriority = priorityOrder[a.priority] ?? 3;
                    const bPriority = priorityOrder[b.priority] ?? 3;
                    comparison = aPriority - bPriority;
                    break;
                    
                case 'due_date':
                    if (a.due_date && b.due_date) {
                        comparison = new Date(a.due_date) - new Date(b.due_date);
                    } else if (a.due_date) {
                        comparison = -1;
                    } else if (b.due_date) {
                        comparison = 1;
                    }
                    break;
                    
                case 'project':
                    comparison = (a.project || '').localeCompare(b.project || '');
                    break;
                    
                case 'text':
                    comparison = a.text.localeCompare(b.text);
                    break;
                    
                case 'created_at':
                    comparison = new Date(a.created_at) - new Date(b.created_at);
                    break;
            }
            
            return this.sortOrder === 'asc' ? comparison : -comparison;
        });
    }
    
    groupTasks(tasks) {
        const groups = {};
        
        tasks.forEach(task => {
            let groupKey;
            
            switch (this.groupBy) {
                case 'project':
                    groupKey = task.project || 'No Project';
                    break;
                    
                case 'priority':
                    groupKey = task.priority ? 
                        task.priority.charAt(0).toUpperCase() + task.priority.slice(1) + ' Priority' : 
                        'No Priority';
                    break;
                    
                case 'status':
                    groupKey = task.status === 'done' ? 'Completed' : 'Open';
                    break;
                    
                case 'due_date':
                    if (!task.due_date) {
                        groupKey = 'No Due Date';
                    } else {
                        const date = new Date(task.due_date);
                        if (isToday(date)) {
                            groupKey = 'Today';
                        } else if (isTomorrow(date)) {
                            groupKey = 'Tomorrow';
                        } else if (isPast(date)) {
                            groupKey = 'Overdue';
                        } else {
                            groupKey = format(date, 'MMMM yyyy');
                        }
                    }
                    break;
            }
            
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(task);
        });
        
        return groups;
    }
    
    renderGroups(container, groups) {
        // Sort group keys
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            // Special sorting for certain group types
            if (this.groupBy === 'priority') {
                const order = ['High Priority', 'Medium Priority', 'Low Priority', 'No Priority'];
                return order.indexOf(a) - order.indexOf(b);
            }
            if (this.groupBy === 'due_date') {
                const order = ['Overdue', 'Today', 'Tomorrow'];
                const aIndex = order.indexOf(a);
                const bIndex = order.indexOf(b);
                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                }
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;
            }
            return a.localeCompare(b);
        });
        
        sortedKeys.forEach(groupKey => {
            const group = document.createElement('div');
            group.className = 'task-group';
            
            // Group header
            const header = document.createElement('div');
            header.className = 'task-group-header';
            
            const title = document.createElement('h3');
            title.textContent = groupKey;
            
            const count = document.createElement('span');
            count.className = 'task-group-count';
            count.textContent = `${groups[groupKey].length} tasks`;
            
            header.appendChild(title);
            header.appendChild(count);
            
            // Task list
            const list = this.createTaskList(groups[groupKey]);
            
            group.appendChild(header);
            group.appendChild(list);
            container.appendChild(group);
        });
    }
    
    createTaskList(tasks) {
        const list = document.createElement('div');
        list.className = 'task-list';
        
        tasks.forEach(task => {
            const item = this.createTaskItem(task);
            list.appendChild(item);
        });
        
        return list;
    }
    
    createTaskItem(task) {
        const item = document.createElement('div');
        item.className = 'task-list-item';
        item.dataset.taskId = task.id;
        
        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.status === 'done';
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            this.handleTaskToggle(task.id, e.target.checked);
        });
        
        // Main content
        const content = document.createElement('div');
        content.className = 'task-list-content';
        content.addEventListener('click', () => this.handleTaskClick(task));
        
        // Task text
        const textDiv = document.createElement('div');
        textDiv.className = 'task-list-text';
        textDiv.textContent = task.text;
        if (task.status === 'done') {
            textDiv.classList.add('task-done');
        }
        
        // Metadata row
        const metadata = document.createElement('div');
        metadata.className = 'task-list-metadata';
        
        // Project
        if (task.project) {
            const project = document.createElement('span');
            project.className = 'task-meta-project';
            project.textContent = task.project;
            metadata.appendChild(project);
        }
        
        // Priority
        if (task.priority) {
            const priority = document.createElement('span');
            priority.className = `task-meta-priority priority-${task.priority}`;
            priority.textContent = task.priority;
            metadata.appendChild(priority);
        }
        
        // Due date
        if (task.due_date) {
            const dueDate = document.createElement('span');
            dueDate.className = 'task-meta-due';
            
            const date = new Date(task.due_date);
            if (isToday(date)) {
                dueDate.textContent = 'Today';
                dueDate.classList.add('due-today');
            } else if (isTomorrow(date)) {
                dueDate.textContent = 'Tomorrow';
                dueDate.classList.add('due-tomorrow');
            } else if (isPast(date)) {
                dueDate.textContent = formatDistanceToNow(date, { addSuffix: true });
                dueDate.classList.add('due-overdue');
            } else {
                dueDate.textContent = format(date, 'MMM d, yyyy');
            }
            
            metadata.appendChild(dueDate);
        }
        
        // Tags
        if (task.tags && task.tags.length > 0) {
            const tags = document.createElement('div');
            tags.className = 'task-meta-tags';
            
            task.tags.forEach(tag => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'task-tag';
                tagSpan.textContent = `#${tag}`;
                tags.appendChild(tagSpan);
            });
            
            metadata.appendChild(tags);
        }
        
        // File info
        const fileInfo = document.createElement('span');
        fileInfo.className = 'task-meta-file';
        fileInfo.textContent = task.note_path ? 
            task.note_path.split('/').pop().replace('.md', '') : 
            'Unknown file';
        metadata.appendChild(fileInfo);
        
        content.appendChild(textDiv);
        if (metadata.children.length > 0) {
            content.appendChild(metadata);
        }
        
        item.appendChild(checkbox);
        item.appendChild(content);
        
        return item;
    }
    
    renderEmptyState(container) {
        const empty = document.createElement('div');
        empty.className = 'task-empty-state';
        empty.innerHTML = `
            <div class="empty-icon">📋</div>
            <div class="empty-message">No tasks found</div>
            <div class="empty-hint">Try adjusting your filters or search query</div>
        `;
        container.appendChild(empty);
    }
    
    async handleTaskToggle(taskId, checked) {
        console.log(`[TaskListView] Toggling task ${taskId} to ${checked}`);
        
        try {
            // Resolve task source to get file path and line
            const source = await invoke('get_task_source_by_id', { taskId });
            if (source && source.filePath) {
                await invoke('toggle_task_by_id', {
                    filePath: source.filePath,
                    taskId
                });
                // If the toggled file is open, refresh editor content
                try {
                    const activeEditor = window.paneManager?.getActiveTabManager()?.getActiveTab()?.editor;
                    if (activeEditor && activeEditor.currentFile === source.filePath) {
                        const updated = await invoke('read_file_content', { filePath: source.filePath });
                        activeEditor.setContent(updated, true, activeEditor.currentFile, true);
                        if (typeof activeEditor.save === 'function') { try { await activeEditor.save() } catch {} }
                    }
                } catch {}
                try { toast.success('Task updated', 1200) } catch {}
            }
            
            // Update local task state
            const task = this.tasks.find(t => t.id === taskId);
            if (task) {
                task.status = checked ? 'done' : 'todo';
                this.renderTasks();
            }
            
        } catch (error) {
            console.error('[TaskListView] Error toggling task:', error);
            try { toast.error('Failed to toggle task', 2000) } catch {}
            // Revert checkbox state
            const checkbox = this.container.querySelector(`[data-task-id="${taskId}"] .task-checkbox`);
            if (checkbox) {
                checkbox.checked = !checked;
            }
        }
    }
    
    async handleTaskClick(task) {
        console.log('[TaskListView] Task clicked:', task);
        
        try {
            // Open the file containing the task
            if (task.note_path && task.line_number) {
                await invoke('open_file_at_line', {
                    filePath: task.note_path,
                    lineNumber: task.line_number
                });
                
                // Close dashboard
                window.dispatchEvent(new CustomEvent('close-task-dashboard'));
            }
        } catch (error) {
            console.error('[TaskListView] Error opening task file:', error);
        }
    }
    
    handleSort(event) {
        this.sortBy = event.target.value;
        this.renderTasks();
    }
    
    handleGroupBy(event) {
        this.groupBy = event.target.value;
        this.renderTasks();
    }
    
    unmount() {
        console.log('[TaskListView] Unmounting');
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }
}
