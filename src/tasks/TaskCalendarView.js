import { invoke } from '@tauri-apps/api/core';
import toast from '../plugin-hub/components/Toast.js';
import { 
    format, 
    startOfMonth, 
    endOfMonth, 
    startOfWeek, 
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    isToday,
    addMonths,
    subMonths
} from 'date-fns';

export class TaskCalendarView {
    constructor() {
        console.log('[TaskCalendarView] Initializing calendar view');
        
        this.container = null;
        this.tasks = [];
        this.currentDate = new Date();
        this.selectedDate = null;
        this.tasksByDate = {};
        
        // Bind methods
        this.handleDateClick = this.handleDateClick.bind(this);
        this.handleTaskClick = this.handleTaskClick.bind(this);
        this.handlePrevMonth = this.handlePrevMonth.bind(this);
        this.handleNextMonth = this.handleNextMonth.bind(this);
        this.handleToday = this.handleToday.bind(this);
    }
    
    mount(parentElement) {
        console.log('[TaskCalendarView] Mounting to parent');
        
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'task-calendar-view';
        
        // Create calendar header
        const header = this.createHeader();
        
        // Create calendar grid container
        const gridContainer = document.createElement('div');
        gridContainer.className = 'calendar-grid-container';
        
        // Create calendar grid
        const grid = document.createElement('div');
        grid.className = 'task-calendar-grid';
        grid.id = 'task-calendar-grid';
        
        // Create task list panel
        const taskPanel = document.createElement('div');
        taskPanel.className = 'calendar-task-panel';
        taskPanel.id = 'calendar-task-panel';
        
        gridContainer.appendChild(grid);
        gridContainer.appendChild(taskPanel);
        
        // Assemble view
        this.container.appendChild(header);
        this.container.appendChild(gridContainer);
        
        parentElement.appendChild(this.container);
        
        // Render initial calendar
        this.renderCalendar();
    }
    
    createHeader() {
        const header = document.createElement('div');
        header.className = 'task-calendar-header';
        
        // Navigation controls
        const nav = document.createElement('div');
        nav.className = 'calendar-nav';
        
        const prevBtn = document.createElement('button');
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.innerHTML = '←';
        prevBtn.title = 'Previous month';
        prevBtn.addEventListener('click', this.handlePrevMonth);
        
        const nextBtn = document.createElement('button');
        nextBtn.className = 'calendar-nav-btn';
        nextBtn.innerHTML = '→';
        nextBtn.title = 'Next month';
        nextBtn.addEventListener('click', this.handleNextMonth);
        
        const todayBtn = document.createElement('button');
        todayBtn.className = 'calendar-nav-btn calendar-today-btn';
        todayBtn.textContent = 'Today';
        todayBtn.addEventListener('click', this.handleToday);
        
        nav.appendChild(prevBtn);
        nav.appendChild(todayBtn);
        nav.appendChild(nextBtn);
        
        // Month/Year display
        const monthYear = document.createElement('div');
        monthYear.className = 'calendar-month-year';
        monthYear.id = 'calendar-month-year';
        
        header.appendChild(nav);
        header.appendChild(monthYear);
        
        return header;
    }
    
    updateTasks(tasks) {
        console.log(`[TaskCalendarView] Updating with ${tasks.length} tasks`);
        this.tasks = tasks;
        this.organizeTasksByDate();
        this.renderCalendar();
        
        // If a date is selected, update the task panel
        if (this.selectedDate) {
            this.showTasksForDate(this.selectedDate);
        }
    }
    
    organizeTasksByDate() {
        this.tasksByDate = {};
        
        this.tasks.forEach(task => {
            if (task.due_date) {
                const dateKey = format(new Date(task.due_date), 'yyyy-MM-dd');
                
                if (!this.tasksByDate[dateKey]) {
                    this.tasksByDate[dateKey] = [];
                }
                
                this.tasksByDate[dateKey].push(task);
            }
        });
        
        // Sort tasks within each date by priority
        Object.keys(this.tasksByDate).forEach(dateKey => {
            this.tasksByDate[dateKey].sort((a, b) => {
                const priorityOrder = { high: 0, medium: 1, low: 2 };
                const aPriority = priorityOrder[a.priority] ?? 3;
                const bPriority = priorityOrder[b.priority] ?? 3;
                return aPriority - bPriority;
            });
        });
    }
    
    renderCalendar() {
        const grid = document.getElementById('task-calendar-grid');
        const monthYearElement = document.getElementById('calendar-month-year');
        
        if (!grid || !monthYearElement) return;
        
        // Update month/year display
        monthYearElement.textContent = format(this.currentDate, 'MMMM yyyy');
        
        // Clear grid
        grid.innerHTML = '';
        
        // Create weekday headers
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const weekdayRow = document.createElement('div');
        weekdayRow.className = 'calendar-weekdays';
        
        weekdays.forEach(day => {
            const weekday = document.createElement('div');
            weekday.className = 'calendar-weekday';
            weekday.textContent = day;
            weekdayRow.appendChild(weekday);
        });
        
        grid.appendChild(weekdayRow);
        
        // Get days to display
        const monthStart = startOfMonth(this.currentDate);
        const monthEnd = endOfMonth(this.currentDate);
        const calendarStart = startOfWeek(monthStart);
        const calendarEnd = endOfWeek(monthEnd);
        
        const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
        
        // Create day cells
        const daysGrid = document.createElement('div');
        daysGrid.className = 'calendar-days';
        
        days.forEach(day => {
            const dayCell = this.createDayCell(day, monthStart);
            daysGrid.appendChild(dayCell);
        });
        
        grid.appendChild(daysGrid);
    }
    
    createDayCell(day, currentMonth) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        
        const dateKey = format(day, 'yyyy-MM-dd');
        const dayTasks = this.tasksByDate[dateKey] || [];
        const isCurrentMonth = isSameMonth(day, currentMonth);
        const isSelectedDate = this.selectedDate && isSameDay(day, this.selectedDate);
        
        // Apply styling classes
        if (!isCurrentMonth) {
            cell.classList.add('calendar-day-other-month');
        }
        if (isToday(day)) {
            cell.classList.add('calendar-day-today');
        }
        if (isSelectedDate) {
            cell.classList.add('calendar-day-selected');
        }
        
        // Day number
        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = format(day, 'd');
        cell.appendChild(dayNumber);
        
        // Task indicators
        if (dayTasks.length > 0) {
            const indicators = document.createElement('div');
            indicators.className = 'calendar-task-indicators';
            
            // Show up to 3 task dots
            const tasksToShow = Math.min(dayTasks.length, 3);
            for (let i = 0; i < tasksToShow; i++) {
                const task = dayTasks[i];
                const dot = document.createElement('div');
                dot.className = 'calendar-task-dot';
                
                // Color based on priority
                if (task.priority === 'high') {
                    dot.classList.add('priority-high');
                } else if (task.priority === 'medium') {
                    dot.classList.add('priority-medium');
                } else {
                    dot.classList.add('priority-low');
                }
                
                // Mark completed tasks
                if (task.status === 'done') {
                    dot.classList.add('task-done');
                }
                
                indicators.appendChild(dot);
            }
            
            // Add count if more than 3
            if (dayTasks.length > 3) {
                const more = document.createElement('div');
                more.className = 'calendar-task-more';
                more.textContent = `+${dayTasks.length - 3}`;
                indicators.appendChild(more);
            }
            
            cell.appendChild(indicators);
            
            // Task count badge
            const badge = document.createElement('div');
            badge.className = 'calendar-task-count';
            badge.textContent = dayTasks.length;
            cell.appendChild(badge);
        }
        
        // Click handler
        cell.addEventListener('click', () => this.handleDateClick(day, dayTasks));
        
        return cell;
    }
    
    handleDateClick(date, tasks) {
        console.log('[TaskCalendarView] Date clicked:', format(date, 'yyyy-MM-dd'));
        
        // Update selected date
        this.selectedDate = date;
        
        // Re-render calendar to show selection
        this.renderCalendar();
        
        // Show tasks for this date
        this.showTasksForDate(date);
    }
    
    showTasksForDate(date) {
        const panel = document.getElementById('calendar-task-panel');
        if (!panel) return;
        
        const dateKey = format(date, 'yyyy-MM-dd');
        const tasks = this.tasksByDate[dateKey] || [];
        
        // Clear panel
        panel.innerHTML = '';
        
        // Panel header
        const header = document.createElement('div');
        header.className = 'task-panel-header';
        
        const dateTitle = document.createElement('h3');
        dateTitle.textContent = format(date, 'EEEE, MMMM d, yyyy');
        
        const count = document.createElement('span');
        count.className = 'task-panel-count';
        count.textContent = tasks.length === 0 ? 'No tasks' :
                           tasks.length === 1 ? '1 task' : `${tasks.length} tasks`;
        
        header.appendChild(dateTitle);
        header.appendChild(count);
        panel.appendChild(header);
        
        // Task list
        const list = document.createElement('div');
        list.className = 'task-panel-list';
        
        if (tasks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'task-panel-empty';
            empty.textContent = 'No tasks scheduled for this date';
            list.appendChild(empty);
        } else {
            tasks.forEach(task => {
                const item = this.createTaskPanelItem(task);
                list.appendChild(item);
            });
        }
        
        panel.appendChild(list);
    }
    
    createTaskPanelItem(task) {
        const item = document.createElement('div');
        item.className = 'task-panel-item';
        item.addEventListener('click', () => this.handleTaskClick(task));
        
        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.status === 'done';
        checkbox.addEventListener('change', async (e) => {
            e.stopPropagation();
            await this.handleTaskToggle(task.id, e.target.checked);
        });
        
        // Content
        const content = document.createElement('div');
        content.className = 'task-panel-content';
        
        // Task text
        const text = document.createElement('div');
        text.className = 'task-panel-text';
        text.textContent = task.text;
        if (task.status === 'done') {
            text.classList.add('task-done');
        }
        
        // Metadata
        const meta = document.createElement('div');
        meta.className = 'task-panel-meta';
        
        if (task.priority) {
            const priority = document.createElement('span');
            priority.className = `task-priority priority-${task.priority}`;
            priority.textContent = task.priority;
            meta.appendChild(priority);
        }
        
        if (task.project) {
            const project = document.createElement('span');
            project.className = 'task-project';
            project.textContent = task.project;
            meta.appendChild(project);
        }
        
        content.appendChild(text);
        if (meta.children.length > 0) {
            content.appendChild(meta);
        }
        
        item.appendChild(checkbox);
        item.appendChild(content);
        
        return item;
    }
    
    async handleTaskToggle(taskId, checked) {
        console.log(`[TaskCalendarView] Toggling task ${taskId} to ${checked}`);
        
        try {
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
                
                // Re-render the selected date's tasks
                if (this.selectedDate) {
                    this.showTasksForDate(this.selectedDate);
                }
                
                // Update calendar dots
                this.renderCalendar();
            }
            
        } catch (error) {
            console.error('[TaskCalendarView] Error toggling task:', error);
            try { toast.error('Failed to toggle task', 2000) } catch {}
            // Revert checkbox state
            const checkbox = this.container.querySelector(`[data-task-id="${taskId}"] .task-checkbox`);
            if (checkbox) {
                checkbox.checked = !checked;
            }
        }
    }
    
    async handleTaskClick(task) {
        console.log('[TaskCalendarView] Task clicked:', task);
        
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
            console.error('[TaskCalendarView] Error opening task file:', error);
        }
    }
    
    handlePrevMonth() {
        this.currentDate = subMonths(this.currentDate, 1);
        this.renderCalendar();
    }
    
    handleNextMonth() {
        this.currentDate = addMonths(this.currentDate, 1);
        this.renderCalendar();
    }
    
    handleToday() {
        this.currentDate = new Date();
        this.selectedDate = new Date();
        this.renderCalendar();
        this.showTasksForDate(this.selectedDate);
    }
    
    unmount() {
        console.log('[TaskCalendarView] Unmounting');
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }
}
