/**
 * Task Kanban View Component Tests
 * Comprehensive test suite for TaskKanbanView.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskKanbanView } from './TaskKanbanView.js';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}));

// Mock date-fns
vi.mock('date-fns', async () => {
    const actual = await vi.importActual('date-fns');
    const testToday = new Date('2025-01-15T12:00:00');
    
    return {
        ...actual,
        isToday: vi.fn((date) => actual.isSameDay(date, testToday)),
        isTomorrow: vi.fn((date) => actual.isSameDay(date, actual.addDays(testToday, 1))),
        isPast: vi.fn((date) => date < testToday),
        format: actual.format
    };
});

describe('TaskKanbanView', () => {
    let view;
    let container;
    
    const mockTasks = [
        {
            id: 'task-1',
            text: 'Todo task high priority',
            status: 'todo',
            project: 'Frontend',
            priority: 'high',
            due_date: '2025-01-15',
            tags: ['feature'],
            note_path: '/vault/tasks.md',
            line_number: 10
        },
        {
            id: 'task-2',
            text: 'In progress task',
            status: 'todo',
            project: 'Backend',
            priority: 'medium',
            due_date: '2025-01-16',
            tags: ['in-progress', 'api'],
            note_path: '/vault/tasks.md',
            line_number: 20
        },
        {
            id: 'task-3',
            text: 'Completed task',
            status: 'done',
            project: 'Documentation',
            priority: 'low',
            due_date: '2025-01-14',
            tags: ['docs'],
            note_path: '/vault/docs.md',
            line_number: 5
        },
        {
            id: 'task-4',
            text: 'Another todo task',
            status: 'todo',
            project: null,
            priority: null,
            due_date: null,
            tags: [],
            note_path: '/vault/notes.md',
            line_number: 100
        }
    ];
    
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        
        view = new TaskKanbanView();
        vi.clearAllMocks();
    });
    
    afterEach(() => {
        if (view) {
            view.unmount();
        }
        if (container.parentElement) {
            container.parentElement.removeChild(container);
        }
    });
    
    describe('Initialization and Mounting', () => {
        it('should initialize with default columns', () => {
            expect(view.columns).toHaveProperty('todo');
            expect(view.columns).toHaveProperty('inprogress');
            expect(view.columns).toHaveProperty('done');
            
            expect(view.columns.todo.title).toBe('To Do');
            expect(view.columns.inprogress.title).toBe('In Progress');
            expect(view.columns.done.title).toBe('Done');
        });
        
        it('should mount to parent element', () => {
            view.mount(container);
            
            expect(container.querySelector('.task-kanban-view')).toBeTruthy();
            expect(container.querySelector('.kanban-board')).toBeTruthy();
            expect(container.querySelectorAll('.kanban-column').length).toBe(3);
        });
        
        it('should create column headers and content areas', () => {
            view.mount(container);
            
            const columns = container.querySelectorAll('.kanban-column');
            
            columns.forEach((column, index) => {
                const header = column.querySelector('.kanban-column-header');
                const content = column.querySelector('.kanban-column-content');
                
                expect(header).toBeTruthy();
                expect(content).toBeTruthy();
                expect(header.querySelector('h3')).toBeTruthy();
                expect(header.querySelector('.kanban-column-count')).toBeTruthy();
            });
        });
    });
    
    describe('Task Organization', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should organize tasks by status', () => {
            view.updateTasks(mockTasks);
            
            expect(view.columns.todo.tasks.length).toBe(2);
            expect(view.columns.inprogress.tasks.length).toBe(1);
            expect(view.columns.done.tasks.length).toBe(1);
        });
        
        it('should identify in-progress tasks by tag', () => {
            view.updateTasks(mockTasks);
            
            const inProgressTask = view.columns.inprogress.tasks[0];
            expect(inProgressTask.id).toBe('task-2');
            expect(inProgressTask.tags).toContain('in-progress');
        });
        
        it('should sort tasks within columns by priority', () => {
            const tasks = [
                { ...mockTasks[3], priority: 'low' },
                { ...mockTasks[0], priority: 'high' },
                { id: 'task-5', priority: 'medium', status: 'todo' }
            ];
            
            view.updateTasks(tasks);
            
            const todoTasks = view.columns.todo.tasks;
            expect(todoTasks[0].priority).toBe('high');
            expect(todoTasks[1].priority).toBe('medium');
            expect(todoTasks[2].priority).toBe('low');
        });
        
        it('should sort by due date when priorities are equal', () => {
            const tasks = [
                { id: 't1', priority: 'high', due_date: '2025-01-20', status: 'todo' },
                { id: 't2', priority: 'high', due_date: '2025-01-18', status: 'todo' }
            ];
            
            view.updateTasks(tasks);
            
            const todoTasks = view.columns.todo.tasks;
            expect(todoTasks[0].due_date).toBe('2025-01-18');
            expect(todoTasks[1].due_date).toBe('2025-01-20');
        });
    });
    
    describe('Task Rendering', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should render task cards in correct columns', () => {
            view.updateTasks(mockTasks);
            
            const todoColumn = document.getElementById('kanban-column-todo');
            const inProgressColumn = document.getElementById('kanban-column-inprogress');
            const doneColumn = document.getElementById('kanban-column-done');
            
            expect(todoColumn.querySelectorAll('.kanban-card').length).toBe(2);
            expect(inProgressColumn.querySelectorAll('.kanban-card').length).toBe(1);
            expect(doneColumn.querySelectorAll('.kanban-card').length).toBe(1);
        });
        
        it('should display task counts in column headers', () => {
            view.updateTasks(mockTasks);
            
            const todoCount = document.getElementById('kanban-count-todo');
            const inProgressCount = document.getElementById('kanban-count-inprogress');
            const doneCount = document.getElementById('kanban-count-done');
            
            expect(todoCount.textContent).toBe('2');
            expect(inProgressCount.textContent).toBe('1');
            expect(doneCount.textContent).toBe('1');
        });
        
        it('should render card with correct metadata', () => {
            view.updateTasks([mockTasks[0]]);
            
            const card = container.querySelector('.kanban-card');
            
            expect(card.querySelector('.kanban-card-text').textContent).toBe('Todo task high priority');
            expect(card.querySelector('.priority-high')).toBeTruthy();
            expect(card.querySelector('.kanban-badge-project').textContent).toBe('Frontend');
            expect(card.querySelector('.kanban-badge-due').textContent).toBe('Today');
        });
        
        it('should show empty state for columns without tasks', () => {
            view.updateTasks([mockTasks[0]]); // Only todo task
            
            const inProgressColumn = document.getElementById('kanban-column-inprogress');
            const empty = inProgressColumn.querySelector('.kanban-empty');
            
            expect(empty).toBeTruthy();
            expect(empty.textContent).toBe('Drag tasks here');
        });
        
        it('should not show in-progress tag in card badges', () => {
            view.updateTasks([mockTasks[1]]);
            
            const card = container.querySelector('.kanban-card');
            const tags = card.querySelectorAll('.kanban-badge-tag');
            
            const tagTexts = Array.from(tags).map(t => t.textContent);
            expect(tagTexts).toContain('#api');
            expect(tagTexts).not.toContain('#in-progress');
        });
    });
    
    describe('Drag and Drop', () => {
        beforeEach(() => {
            view.mount(container);
            view.updateTasks(mockTasks);
        });
        
        it('should make cards draggable', () => {
            const cards = container.querySelectorAll('.kanban-card');
            
            cards.forEach(card => {
                expect(card.draggable).toBeTruthy();
            });
        });
        
        it('should handle drag start', () => {
            const card = container.querySelector('[data-task-id="task-1"]');
            const dragEvent = new DragEvent('dragstart', {
                dataTransfer: new DataTransfer()
            });
            
            card.dispatchEvent(dragEvent);
            
            expect(view.draggedTask).toBeTruthy();
            expect(view.draggedTask.id).toBe('task-1');
            expect(view.draggedElement).toBe(card);
            expect(card.classList.contains('dragging')).toBeTruthy();
        });
        
        it('should handle drag over', () => {
            const card = container.querySelector('[data-task-id="task-1"]');
            view.draggedTask = mockTasks[0];
            view.draggedElement = card;
            
            const column = document.getElementById('kanban-column-inprogress');
            const dragEvent = new DragEvent('dragover', {
                dataTransfer: new DataTransfer()
            });
            
            const preventDefaultSpy = vi.spyOn(dragEvent, 'preventDefault');
            
            column.dispatchEvent(dragEvent);
            
            expect(preventDefaultSpy).toHaveBeenCalled();
            expect(column.classList.contains('drag-over')).toBeTruthy();
        });
        
        it('should handle drop and update task status', async () => {
            view.draggedTask = mockTasks[0];
            
            const column = document.getElementById('kanban-column-done');
            const dropEvent = new DragEvent('drop', {
                dataTransfer: new DataTransfer()
            });
            
            invoke.mockResolvedValueOnce(); // Mock successful status update
            
            column.dispatchEvent(dropEvent);
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('toggle_task_status', {
                    taskId: 'task-1',
                    done: true
                });
            });
            
            expect(mockTasks[0].status).toBe('done');
        });
        
        it('should update tags when moving to in-progress', async () => {
            view.draggedTask = mockTasks[0];
            
            const column = document.getElementById('kanban-column-inprogress');
            const dropEvent = new DragEvent('drop', {
                dataTransfer: new DataTransfer()
            });
            
            invoke.mockResolvedValueOnce(); // Mock successful update
            
            column.dispatchEvent(dropEvent);
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('update_task_properties', {
                    taskId: 'task-1',
                    properties: { tags: ['feature', 'in-progress'] }
                });
            });
        });
        
        it('should handle drag end', () => {
            const card = container.querySelector('[data-task-id="task-1"]');
            card.classList.add('dragging');
            view.draggedTask = mockTasks[0];
            view.draggedElement = card;
            
            const columns = container.querySelectorAll('.kanban-column-content');
            columns.forEach(col => col.classList.add('drag-over'));
            
            const dragEndEvent = new DragEvent('dragend');
            card.dispatchEvent(dragEndEvent);
            
            expect(card.classList.contains('dragging')).toBeFalsy();
            expect(view.draggedTask).toBeNull();
            expect(view.draggedElement).toBeNull();
            
            columns.forEach(col => {
                expect(col.classList.contains('drag-over')).toBeFalsy();
            });
        });
    });
    
    describe('Task Interactions', () => {
        beforeEach(() => {
            view.mount(container);
            view.updateTasks(mockTasks);
        });
        
        it('should open file on card click', async () => {
            const card = container.querySelector('[data-task-id="task-1"]');
            
            invoke.mockResolvedValueOnce();
            const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
            
            card.click();
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('open_file_at_line', {
                    filePath: '/vault/tasks.md',
                    lineNumber: 10
                });
            });
            
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'close-task-dashboard' })
            );
        });
        
        it('should handle task update errors', async () => {
            view.draggedTask = mockTasks[0];
            
            const column = document.getElementById('kanban-column-done');
            const dropEvent = new DragEvent('drop', {
                dataTransfer: new DataTransfer()
            });
            
            invoke.mockRejectedValueOnce(new Error('Update failed'));
            
            const originalStatus = mockTasks[0].status;
            
            column.dispatchEvent(dropEvent);
            
            await vi.waitFor(() => {
                // Should re-render to revert visual change
                const todoColumn = document.getElementById('kanban-column-todo');
                const card = todoColumn.querySelector('[data-task-id="task-1"]');
                expect(card).toBeTruthy();
            });
        });
    });
    
    describe('Due Date Display', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should display "Today" for today\'s date', () => {
            view.updateTasks([mockTasks[0]]);
            
            const dueDate = container.querySelector('.kanban-badge-due');
            expect(dueDate.textContent).toBe('Today');
            expect(dueDate.classList.contains('due-today')).toBeTruthy();
        });
        
        it('should display "Tomorrow" for tomorrow\'s date', () => {
            view.updateTasks([mockTasks[1]]);
            
            const dueDate = container.querySelector('.kanban-badge-due');
            expect(dueDate.textContent).toBe('Tomorrow');
            expect(dueDate.classList.contains('due-tomorrow')).toBeTruthy();
        });
        
        it('should display "Overdue" for past dates', () => {
            view.updateTasks([mockTasks[2]]);
            
            const dueDate = container.querySelector('.kanban-badge-due');
            expect(dueDate.textContent).toBe('Overdue');
            expect(dueDate.classList.contains('due-overdue')).toBeTruthy();
        });
    });
    
    describe('Performance', () => {
        it('should render large task lists efficiently', () => {
            const largeTasks = Array.from({ length: 100 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                status: i % 3 === 0 ? 'done' : 'todo',
                priority: ['high', 'medium', 'low'][i % 3],
                due_date: `2025-01-${(i % 28) + 1}`,
                tags: i % 5 === 0 ? ['in-progress'] : [],
                project: `Project ${i % 10}`,
                note_path: `/vault/task-${i}.md`,
                line_number: i
            }));
            
            view.mount(container);
            
            const startTime = performance.now();
            view.updateTasks(largeTasks);
            const endTime = performance.now();
            
            expect(endTime - startTime).toBeLessThan(50);
            
            const cards = container.querySelectorAll('.kanban-card');
            expect(cards.length).toBe(100);
        });
        
        it('should handle rapid drag operations', () => {
            view.mount(container);
            view.updateTasks(mockTasks);
            
            const card = container.querySelector('[data-task-id="task-1"]');
            
            // Simulate rapid drag operations
            for (let i = 0; i < 10; i++) {
                const dragStart = new DragEvent('dragstart', {
                    dataTransfer: new DataTransfer()
                });
                card.dispatchEvent(dragStart);
                
                const dragEnd = new DragEvent('dragend');
                card.dispatchEvent(dragEnd);
            }
            
            expect(view.draggedTask).toBeNull();
            expect(view.draggedElement).toBeNull();
        });
    });
    
    describe('Unmounting', () => {
        it('should clean up on unmount', () => {
            view.mount(container);
            
            expect(container.querySelector('.task-kanban-view')).toBeTruthy();
            
            view.unmount();
            
            expect(container.querySelector('.task-kanban-view')).toBeFalsy();
        });
        
        it('should handle unmount when not mounted', () => {
            expect(() => view.unmount()).not.toThrow();
        });
    });
});