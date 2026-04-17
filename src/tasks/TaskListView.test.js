/**
 * Task List View Component Tests
 * Comprehensive test suite for TaskListView.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskListView } from './TaskListView.js';
import { invoke } from '@tauri-apps/api/core';
import { isToday, isTomorrow, isPast, format, formatDistanceToNow } from 'date-fns';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}));

// Mock date-fns for consistent date testing
vi.mock('date-fns', async () => {
    const actual = await vi.importActual('date-fns');
    const testToday = new Date('2025-01-15T12:00:00');
    
    return {
        ...actual,
        isToday: vi.fn((date) => actual.isSameDay(date, testToday)),
        isTomorrow: vi.fn((date) => actual.isSameDay(date, actual.addDays(testToday, 1))),
        isPast: vi.fn((date) => date < testToday),
        format: actual.format,
        formatDistanceToNow: vi.fn((date) => actual.formatDistance(date, testToday, { addSuffix: true }))
    };
});

describe('TaskListView', () => {
    let view;
    let container;
    
    const mockTasks = [
        {
            id: 'task-1',
            text: 'High priority task',
            status: 'todo',
            project: 'Project A',
            priority: 'high',
            due_date: '2025-01-15',
            tags: ['urgent', 'feature'],
            note_path: '/vault/tasks.md',
            line_number: 10,
            created_at: '2025-01-10T10:00:00'
        },
        {
            id: 'task-2',
            text: 'Medium priority task',
            status: 'todo',
            project: 'Project A',
            priority: 'medium',
            due_date: '2025-01-16',
            tags: ['review'],
            note_path: '/vault/tasks.md',
            line_number: 20,
            created_at: '2025-01-11T10:00:00'
        },
        {
            id: 'task-3',
            text: 'Low priority task',
            status: 'done',
            project: 'Project B',
            priority: 'low',
            due_date: '2025-01-14',
            tags: ['docs'],
            note_path: '/vault/docs.md',
            line_number: 5,
            created_at: '2025-01-09T10:00:00'
        },
        {
            id: 'task-4',
            text: 'No metadata task',
            status: 'todo',
            project: null,
            priority: null,
            due_date: null,
            tags: [],
            note_path: '/vault/notes.md',
            line_number: 100,
            created_at: '2025-01-12T10:00:00'
        }
    ];
    
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        
        view = new TaskListView();
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
        it('should initialize with default values', () => {
            expect(view.tasks).toEqual([]);
            expect(view.sortBy).toBe('priority');
            expect(view.sortOrder).toBe('asc');
            expect(view.groupBy).toBe('project');
        });
        
        it('should mount to parent element', () => {
            view.mount(container);
            
            expect(container.querySelector('.task-list-view')).toBeTruthy();
            expect(container.querySelector('.task-list-controls')).toBeTruthy();
            expect(container.querySelector('#task-list-container')).toBeTruthy();
        });
        
        it('should create sort controls', () => {
            view.mount(container);
            
            const sortSelect = container.querySelector('.task-sort-select');
            expect(sortSelect).toBeTruthy();
            
            const options = Array.from(sortSelect.options).map(opt => opt.value);
            expect(options).toContain('priority');
            expect(options).toContain('due_date');
            expect(options).toContain('project');
            expect(options).toContain('text');
            expect(options).toContain('created_at');
        });
        
        it('should create group controls', () => {
            view.mount(container);
            
            const groupSelect = container.querySelector('.task-group-select');
            expect(groupSelect).toBeTruthy();
            
            const options = Array.from(groupSelect.options).map(opt => opt.value);
            expect(options).toContain('none');
            expect(options).toContain('project');
            expect(options).toContain('priority');
            expect(options).toContain('status');
            expect(options).toContain('due_date');
        });
    });
    
    describe('Task Sorting', () => {
        beforeEach(() => {
            view.mount(container);
            view.tasks = [...mockTasks];
        });
        
        it('should sort by priority', () => {
            view.sortBy = 'priority';
            const sorted = view.sortTasks([...mockTasks]);
            
            expect(sorted[0].priority).toBe('high');
            expect(sorted[1].priority).toBe('medium');
            expect(sorted[2].priority).toBe('low');
            expect(sorted[3].priority).toBeNull();
        });
        
        it('should sort by due date', () => {
            view.sortBy = 'due_date';
            const sorted = view.sortTasks([...mockTasks]);
            
            expect(sorted[0].due_date).toBe('2025-01-14');
            expect(sorted[1].due_date).toBe('2025-01-15');
            expect(sorted[2].due_date).toBe('2025-01-16');
            expect(sorted[3].due_date).toBeNull();
        });
        
        it('should sort by project name', () => {
            view.sortBy = 'project';
            const sorted = view.sortTasks([...mockTasks]);
            
            expect(sorted[0].project).toBeNull();
            expect(sorted[1].project).toBe('Project A');
            expect(sorted[2].project).toBe('Project A');
            expect(sorted[3].project).toBe('Project B');
        });
        
        it('should sort by task text', () => {
            view.sortBy = 'text';
            const sorted = view.sortTasks([...mockTasks]);
            
            expect(sorted[0].text).toContain('High priority');
            expect(sorted[1].text).toContain('Low priority');
            expect(sorted[2].text).toContain('Medium priority');
            expect(sorted[3].text).toContain('No metadata');
        });
        
        it('should sort by created date', () => {
            view.sortBy = 'created_at';
            const sorted = view.sortTasks([...mockTasks]);
            
            expect(sorted[0].id).toBe('task-3'); // Oldest
            expect(sorted[3].id).toBe('task-4'); // Newest
        });
        
        it('should reverse sort when order is desc', () => {
            view.sortBy = 'priority';
            view.sortOrder = 'desc';
            const sorted = view.sortTasks([...mockTasks]);
            
            expect(sorted[0].priority).toBeNull();
            expect(sorted[1].priority).toBe('low');
            expect(sorted[2].priority).toBe('medium');
            expect(sorted[3].priority).toBe('high');
        });
    });
    
    describe('Task Grouping', () => {
        beforeEach(() => {
            view.mount(container);
            view.tasks = [...mockTasks];
        });
        
        it('should group by project', () => {
            view.groupBy = 'project';
            const groups = view.groupTasks(mockTasks);
            
            expect(Object.keys(groups)).toContain('Project A');
            expect(Object.keys(groups)).toContain('Project B');
            expect(Object.keys(groups)).toContain('No Project');
            
            expect(groups['Project A'].length).toBe(2);
            expect(groups['Project B'].length).toBe(1);
            expect(groups['No Project'].length).toBe(1);
        });
        
        it('should group by priority', () => {
            view.groupBy = 'priority';
            const groups = view.groupTasks(mockTasks);
            
            expect(Object.keys(groups)).toContain('High Priority');
            expect(Object.keys(groups)).toContain('Medium Priority');
            expect(Object.keys(groups)).toContain('Low Priority');
            expect(Object.keys(groups)).toContain('No Priority');
        });
        
        it('should group by status', () => {
            view.groupBy = 'status';
            const groups = view.groupTasks(mockTasks);
            
            expect(Object.keys(groups)).toContain('Open');
            expect(Object.keys(groups)).toContain('Completed');
            
            expect(groups['Open'].length).toBe(3);
            expect(groups['Completed'].length).toBe(1);
        });
        
        it('should group by due date', () => {
            view.groupBy = 'due_date';
            const groups = view.groupTasks(mockTasks);
            
            expect(Object.keys(groups)).toContain('Today');
            expect(Object.keys(groups)).toContain('Tomorrow');
            expect(Object.keys(groups)).toContain('Overdue');
            expect(Object.keys(groups)).toContain('No Due Date');
        });
    });
    
    describe('Task Rendering', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should render empty state when no tasks', () => {
            view.updateTasks([]);
            
            const emptyState = container.querySelector('.task-empty-state');
            expect(emptyState).toBeTruthy();
            expect(emptyState.textContent).toContain('No tasks found');
        });
        
        it('should render task items', () => {
            view.groupBy = 'none';
            view.updateTasks(mockTasks);
            
            const taskItems = container.querySelectorAll('.task-list-item');
            expect(taskItems.length).toBe(4);
        });
        
        it('should render task metadata correctly', () => {
            view.groupBy = 'none';
            view.updateTasks([mockTasks[0]]);
            
            const taskItem = container.querySelector('.task-list-item');
            
            expect(taskItem.querySelector('.task-list-text').textContent).toBe('High priority task');
            expect(taskItem.querySelector('.task-meta-project').textContent).toBe('Project A');
            expect(taskItem.querySelector('.priority-high').textContent).toBe('high');
            expect(taskItem.querySelector('.task-meta-due').textContent).toBe('Today');
            expect(taskItem.querySelector('.task-tag').textContent).toBe('#urgent');
        });
        
        it('should mark completed tasks', () => {
            view.groupBy = 'none';
            view.updateTasks([mockTasks[2]]);
            
            const taskItem = container.querySelector('.task-list-item');
            const checkbox = taskItem.querySelector('.task-checkbox');
            const text = taskItem.querySelector('.task-list-text');
            
            expect(checkbox.checked).toBeTruthy();
            expect(text.classList.contains('task-done')).toBeTruthy();
        });
        
        it('should render task groups with headers', () => {
            view.groupBy = 'project';
            view.updateTasks(mockTasks);
            
            const groups = container.querySelectorAll('.task-group');
            expect(groups.length).toBe(3);
            
            const headers = container.querySelectorAll('.task-group-header h3');
            const headerTexts = Array.from(headers).map(h => h.textContent);
            
            expect(headerTexts).toContain('Project A');
            expect(headerTexts).toContain('Project B');
            expect(headerTexts).toContain('No Project');
        });
        
        it('should display task count in group headers', () => {
            view.groupBy = 'project';
            view.updateTasks(mockTasks);
            
            const projectAGroup = Array.from(container.querySelectorAll('.task-group'))
                .find(g => g.querySelector('h3').textContent === 'Project A');
            
            const count = projectAGroup.querySelector('.task-group-count');
            expect(count.textContent).toBe('2 tasks');
        });
    });
    
    describe('User Interactions', () => {
        beforeEach(() => {
            view.mount(container);
            view.updateTasks(mockTasks);
        });
        
        it('should toggle task status on checkbox change', async () => {
            const checkbox = container.querySelector('.task-checkbox');
            
            invoke.mockResolvedValueOnce();
            
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('toggle_task_status', {
                    taskId: 'task-1',
                    done: true
                });
            });
            
            expect(view.tasks[0].status).toBe('done');
        });
        
        it('should revert checkbox on toggle error', async () => {
            const checkbox = container.querySelector('.task-checkbox');
            
            invoke.mockRejectedValueOnce(new Error('Toggle failed'));
            
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            
            await vi.waitFor(() => {
                expect(checkbox.checked).toBeFalsy();
            });
        });
        
        it('should open file on task click', async () => {
            const taskContent = container.querySelector('.task-list-content');
            
            invoke.mockResolvedValueOnce();
            const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
            
            taskContent.click();
            
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
        
        it('should change sort on select change', () => {
            const sortSelect = container.querySelector('.task-sort-select');
            
            sortSelect.value = 'due_date';
            sortSelect.dispatchEvent(new Event('change'));
            
            expect(view.sortBy).toBe('due_date');
        });
        
        it('should toggle sort order on button click', () => {
            const orderBtn = container.querySelector('.sort-order-btn');
            
            expect(orderBtn.innerHTML).toBe('↑');
            
            orderBtn.click();
            
            expect(view.sortOrder).toBe('desc');
            expect(orderBtn.innerHTML).toBe('↓');
            
            orderBtn.click();
            
            expect(view.sortOrder).toBe('asc');
            expect(orderBtn.innerHTML).toBe('↑');
        });
        
        it('should change grouping on select change', () => {
            const groupSelect = container.querySelector('.task-group-select');
            
            groupSelect.value = 'priority';
            groupSelect.dispatchEvent(new Event('change'));
            
            expect(view.groupBy).toBe('priority');
            
            const groups = container.querySelectorAll('.task-group');
            expect(groups.length).toBeGreaterThan(0);
        });
    });
    
    describe('Date Display', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should display "Today" for today\'s date', () => {
            view.groupBy = 'none';
            view.updateTasks([mockTasks[0]]);
            
            const dueDate = container.querySelector('.task-meta-due');
            expect(dueDate.textContent).toBe('Today');
            expect(dueDate.classList.contains('due-today')).toBeTruthy();
        });
        
        it('should display "Tomorrow" for tomorrow\'s date', () => {
            view.groupBy = 'none';
            view.updateTasks([mockTasks[1]]);
            
            const dueDate = container.querySelector('.task-meta-due');
            expect(dueDate.textContent).toBe('Tomorrow');
            expect(dueDate.classList.contains('due-tomorrow')).toBeTruthy();
        });
        
        it('should display relative time for overdue tasks', () => {
            view.groupBy = 'none';
            view.updateTasks([mockTasks[2]]);
            
            const dueDate = container.querySelector('.task-meta-due');
            expect(dueDate.classList.contains('due-overdue')).toBeTruthy();
        });
        
        it('should not display due date when null', () => {
            view.groupBy = 'none';
            view.updateTasks([mockTasks[3]]);
            
            const dueDate = container.querySelector('.task-meta-due');
            expect(dueDate).toBeFalsy();
        });
    });
    
    describe('Group Sorting', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should sort priority groups correctly', () => {
            view.groupBy = 'priority';
            view.updateTasks(mockTasks);
            
            const headers = Array.from(container.querySelectorAll('.task-group-header h3'))
                .map(h => h.textContent);
            
            const priorityIndex = {
                'High Priority': headers.indexOf('High Priority'),
                'Medium Priority': headers.indexOf('Medium Priority'),
                'Low Priority': headers.indexOf('Low Priority'),
                'No Priority': headers.indexOf('No Priority')
            };
            
            expect(priorityIndex['High Priority']).toBeLessThan(priorityIndex['Medium Priority']);
            expect(priorityIndex['Medium Priority']).toBeLessThan(priorityIndex['Low Priority']);
            expect(priorityIndex['Low Priority']).toBeLessThan(priorityIndex['No Priority']);
        });
        
        it('should sort due date groups correctly', () => {
            view.groupBy = 'due_date';
            view.updateTasks(mockTasks);
            
            const headers = Array.from(container.querySelectorAll('.task-group-header h3'))
                .map(h => h.textContent);
            
            // Overdue should come before Today, Today before Tomorrow
            const overdueIndex = headers.indexOf('Overdue');
            const todayIndex = headers.indexOf('Today');
            const tomorrowIndex = headers.indexOf('Tomorrow');
            
            if (overdueIndex !== -1 && todayIndex !== -1) {
                expect(overdueIndex).toBeLessThan(todayIndex);
            }
            if (todayIndex !== -1 && tomorrowIndex !== -1) {
                expect(todayIndex).toBeLessThan(tomorrowIndex);
            }
        });
    });
    
    describe('Performance', () => {
        it('should render large task lists efficiently', () => {
            const largeTasks = Array.from({ length: 200 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                status: i % 3 === 0 ? 'done' : 'todo',
                project: `Project ${i % 10}`,
                priority: ['high', 'medium', 'low'][i % 3],
                due_date: `2025-01-${(i % 28) + 1}`,
                tags: [`tag-${i % 5}`],
                note_path: `/vault/task-${i}.md`,
                line_number: i,
                created_at: `2025-01-${(i % 28) + 1}T10:00:00`
            }));
            
            view.mount(container);
            
            const startTime = performance.now();
            view.updateTasks(largeTasks);
            const endTime = performance.now();
            
            expect(endTime - startTime).toBeLessThan(50);
            
            const taskItems = container.querySelectorAll('.task-list-item');
            expect(taskItems.length).toBe(200);
        });
        
        it('should sort large lists efficiently', () => {
            const largeTasks = Array.from({ length: 500 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                priority: ['high', 'medium', 'low', null][i % 4],
                due_date: `2025-01-${(i % 28) + 1}`,
                created_at: `2025-01-${(i % 28) + 1}T10:00:00`
            }));
            
            const startTime = performance.now();
            view.sortTasks(largeTasks);
            const endTime = performance.now();
            
            expect(endTime - startTime).toBeLessThan(10);
        });
    });
    
    describe('Unmounting', () => {
        it('should clean up on unmount', () => {
            view.mount(container);
            
            expect(container.querySelector('.task-list-view')).toBeTruthy();
            
            view.unmount();
            
            expect(container.querySelector('.task-list-view')).toBeFalsy();
        });
        
        it('should handle unmount when not mounted', () => {
            expect(() => view.unmount()).not.toThrow();
        });
    });
});