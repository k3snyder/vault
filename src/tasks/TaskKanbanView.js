import { invoke } from '@tauri-apps/api/core';
import toast from '../plugin-hub/components/Toast.js';
import { format, isToday, isTomorrow, isPast } from 'date-fns';

export class TaskKanbanView {
    constructor() {
        console.log('[TaskKanbanView] Initializing kanban view');
        
        this.container = null;
        this.tasks = [];
        this.columns = {
            todo: { title: 'To Do', tasks: [] },
            inprogress: { title: 'In Progress', tasks: [] },
            done: { title: 'Done', tasks: [] }
        };
        
        // Drag state
        this.draggedTask = null;
        this.draggedElement = null;
        
        // Bind methods
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        this.handleTaskClick = this.handleTaskClick.bind(this);
    }
    
    mount(parentElement) {
        console.log('[TaskKanbanView] Mounting to parent');
        
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'task-kanban-view';
        
        // Create kanban board
        const board = document.createElement('div');
        board.className = 'kanban-board';
        board.id = 'kanban-board';
        
        // Create columns
        Object.keys(this.columns).forEach(columnId => {
            const column = this.createColumn(columnId, this.columns[columnId]);
            board.appendChild(column);
        });
        
        this.container.appendChild(board);
        parentElement.appendChild(this.container);
    }
    
    createColumn(columnId, columnData) {
        const column = document.createElement('div');
        column.className = 'kanban-column';
        column.dataset.column = columnId;
        
        // Column header
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        
        const title = document.createElement('h3');
        title.textContent = columnData.title;
        
        const count = document.createElement('span');
        count.className = 'kanban-column-count';
        count.id = `kanban-count-${columnId}`;
        count.textContent = '0';
        
        header.appendChild(title);
        header.appendChild(count);
        
        // Column content
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.id = `kanban-column-${columnId}`;
        
        // Set up drag and drop
        content.addEventListener('dragover', this.handleDragOver);
        content.addEventListener('drop', this.handleDrop);
        
        column.appendChild(header);
        column.appendChild(content);
        
        return column;
    }
    
    updateTasks(tasks) {
        console.log(`[TaskKanbanView] Updating with ${tasks.length} tasks`);
        this.tasks = tasks;
        this.organizeTasks();
        this.renderTasks();
    }
    
    organizeTasks() {
        // Reset columns
        this.columns.todo.tasks = [];
        this.columns.inprogress.tasks = [];
        this.columns.done.tasks = [];
        
        // Organize tasks by status
        this.tasks.forEach(task => {
            if (task.status === 'done') {
                this.columns.done.tasks.push(task);
            } else if (task.tags && task.tags.includes('in-progress')) {
                this.columns.inprogress.tasks.push(task);
            } else {
                this.columns.todo.tasks.push(task);
            }
        });
        
        // Sort tasks within columns by priority and due date
        Object.values(this.columns).forEach(column => {
            column.tasks.sort((a, b) => {
                // Priority first
                const priorityOrder = { high: 0, medium: 1, low: 2 };
                const aPriority = priorityOrder[a.priority] ?? 3;
                const bPriority = priorityOrder[b.priority] ?? 3;
                
                if (aPriority !== bPriority) {
                    return aPriority - bPriority;
                }
                
                // Then due date
                if (a.due_date && b.due_date) {
                    return new Date(a.due_date) - new Date(b.due_date);
                }
                if (a.due_date) return -1;
                if (b.due_date) return 1;
                
                return 0;
            });
        });
    }
    
    renderTasks() {
        Object.keys(this.columns).forEach(columnId => {
            const columnElement = document.getElementById(`kanban-column-${columnId}`);
            const countElement = document.getElementById(`kanban-count-${columnId}`);
            
            if (!columnElement) return;
            
            // Clear column
            columnElement.innerHTML = '';
            
            // Update count
            if (countElement) {
                countElement.textContent = this.columns[columnId].tasks.length;
            }
            
            // Render tasks
            this.columns[columnId].tasks.forEach(task => {
                const card = this.createTaskCard(task, columnId);
                columnElement.appendChild(card);
            });
            
            // Add empty state if no tasks
            if (this.columns[columnId].tasks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'kanban-empty';
                empty.textContent = columnId === 'done' ? 
                    'No completed tasks' : 
                    'Drag tasks here';
                columnElement.appendChild(empty);
            }
        });
    }
    
    createTaskCard(task, columnId) {
        const card = document.createElement('div');
        card.className = 'kanban-card';
        card.dataset.taskId = task.id;
        card.dataset.column = columnId;
        card.draggable = true;
        
        // Set up drag events
        card.addEventListener('dragstart', this.handleDragStart);
        card.addEventListener('dragend', this.handleDragEnd);
        card.addEventListener('click', () => this.handleTaskClick(task));
        
        // Priority indicator
        if (task.priority) {
            const priority = document.createElement('div');
            priority.className = `kanban-card-priority priority-${task.priority}`;
            card.appendChild(priority);
        }
        
        // Task text
        const text = document.createElement('div');
        text.className = 'kanban-card-text';
        text.textContent = task.text;
        card.appendChild(text);
        
        // Metadata
        const metadata = document.createElement('div');
        metadata.className = 'kanban-card-metadata';
        
        // Project badge
        if (task.project) {
            const project = document.createElement('span');
            project.className = 'kanban-badge kanban-badge-project';
            project.textContent = task.project;
            metadata.appendChild(project);
        }
        
        // Due date
        if (task.due_date) {
            const dueDate = document.createElement('span');
            dueDate.className = 'kanban-badge kanban-badge-due';
            
            const date = new Date(task.due_date);
            if (isToday(date)) {
                dueDate.textContent = 'Today';
                dueDate.classList.add('due-today');
            } else if (isTomorrow(date)) {
                dueDate.textContent = 'Tomorrow';
                dueDate.classList.add('due-tomorrow');
            } else if (isPast(date)) {
                dueDate.textContent = 'Overdue';
                dueDate.classList.add('due-overdue');
            } else {
                dueDate.textContent = format(date, 'MMM d');
            }
            
            metadata.appendChild(dueDate);
        }
        
        // Tags
        if (task.tags && task.tags.length > 0) {
            task.tags.forEach(tag => {
                if (tag !== 'in-progress') { // Don't show in-progress tag
                    const tagBadge = document.createElement('span');
                    tagBadge.className = 'kanban-badge kanban-badge-tag';
                    tagBadge.textContent = `#${tag}`;
                    metadata.appendChild(tagBadge);
                }
            });
        }
        
        if (metadata.children.length > 0) {
            card.appendChild(metadata);
        }
        
        return card;
    }
    
    handleDragStart(event) {
        const card = event.target;
        const taskId = card.dataset.taskId;
        const task = this.tasks.find(t => t.id === taskId);
        
        if (!task) return;
        
        this.draggedTask = task;
        this.draggedElement = card;
        
        card.classList.add('dragging');
        
        // Store task data for drop
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', taskId);
    }
    
    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        
        const column = event.currentTarget;
        column.classList.add('drag-over');
        
        // Visual feedback for drop position
        const afterElement = this.getDragAfterElement(column, event.clientY);
        if (afterElement == null) {
            column.appendChild(this.draggedElement);
        } else {
            column.insertBefore(this.draggedElement, afterElement);
        }
    }
    
    handleDrop(event) {
        event.preventDefault();
        
        const column = event.currentTarget;
        column.classList.remove('drag-over');
        
        const columnId = column.id.replace('kanban-column-', '');
        
        if (!this.draggedTask) return;
        
        // Update task status based on column
        this.updateTaskStatus(this.draggedTask, columnId);
    }
    
    handleDragEnd(event) {
        const card = event.target;
        card.classList.remove('dragging');
        
        // Remove drag-over class from all columns
        document.querySelectorAll('.kanban-column-content').forEach(column => {
            column.classList.remove('drag-over');
        });
        
        this.draggedTask = null;
        this.draggedElement = null;
    }
    
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.kanban-card:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    async updateTaskStatus(task, columnId) {
        console.log(`[TaskKanbanView] Moving task ${task.id} to ${columnId}`);
        
        try {
            let newStatus = 'todo';
            let newTags = task.tags ? [...task.tags] : [];
            
            // Remove in-progress tag
            newTags = newTags.filter(tag => tag !== 'in-progress');
            
            switch (columnId) {
                case 'done':
                    newStatus = 'done';
                    break;
                case 'inprogress':
                    newStatus = 'todo';
                    newTags.push('in-progress');
                    break;
                case 'todo':
                    newStatus = 'todo';
                    break;
            }
            
            // Update task status via backend by resolving file path
            if (newStatus !== task.status) {
                const source = await invoke('get_task_source_by_id', { taskId: task.id });
                if (source && source.filePath) {
                    await invoke('toggle_task_by_id', {
                        filePath: source.filePath,
                        taskId: task.id
                    });
                    try { toast.success('Task updated', 1200) } catch {}
                    // Refresh active editor if it's the same file
                    try {
                        const activeEditor = window.paneManager?.getActiveTabManager()?.getActiveTab()?.editor;
                        if (activeEditor && activeEditor.currentFile === source.filePath) {
                            const updated = await invoke('read_file_content', { filePath: source.filePath });
                            activeEditor.setContent(updated, true, activeEditor.currentFile, true);
                            if (typeof activeEditor.save === 'function') { try { await activeEditor.save() } catch {} }
                        }
                    } catch {}
                }
            }
            
            // Update task tags if changed
            if (JSON.stringify(newTags.sort()) !== JSON.stringify((task.tags || []).sort())) {
                await invoke('update_task_properties', {
                    taskId: task.id,
                    properties: { tags: newTags }
                });
            }
            
            // Update local state
            task.status = newStatus;
            task.tags = newTags;
            
            // Re-organize and render
            this.organizeTasks();
            this.renderTasks();
            
        } catch (error) {
            console.error('[TaskKanbanView] Error updating task:', error);
            // Revert visual change
            this.renderTasks();
        }
    }
    
    async handleTaskClick(task) {
        console.log('[TaskKanbanView] Task clicked:', task);
        
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
            console.error('[TaskKanbanView] Error opening task file:', error);
        }
    }
    
    unmount() {
        console.log('[TaskKanbanView] Unmounting');
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }
}
