/**
 * Task Widget Component Tests
 * Comprehensive test suite for TaskWidget.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskWidget } from './TaskWidget.js';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}));

// Mock date-fns for consistent date testing
vi.mock('date-fns', async () => {
    const actual = await vi.importActual('date-fns');
    return {
        ...actual,
        isToday: vi.fn((date) => {
            const testToday = new Date('2025-01-15');
            return actual.isSameDay(date, testToday);
        }),
        isTomorrow: vi.fn((date) => {
            const testTomorrow = new Date('2025-01-16');
            return actual.isSameDay(date, testTomorrow);
        }),
        isPast: vi.fn((date) => {
            const testToday = new Date('2025-01-15');
            return date < testToday;
        })
    };
});

describe('TaskWidget', () => {
    let widget;
    let container;
    
    const mockTasks = [
        {
            id: 'task-1',
            text: 'Write unit tests',
            status: 'todo',
            project: 'Development',
            priority: 'high',
            due_date: '2025-01-15',
            tags: ['testing', 'urgent'],
            note_path: '/vault/dev.md',
            line_number: 10
        },
        {
            id: 'task-2',
            text: 'Review pull request',
            status: 'todo',
            project: 'Development',
            priority: 'medium',
            due_date: '2025-01-16',
            tags: ['review'],
            note_path: '/vault/tasks.md',
            line_number: 25
        },
        {
            id: 'task-3',
            text: 'Update documentation',
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
            text: 'Fix bug in login',
            status: 'todo',
            project: null,
            priority: null,
            due_date: null,
            tags: [],
            note_path: '/vault/bugs.md',
            line_number: 42
        }
    ];
    
    beforeEach(() => {
        // Create container for widget
        container = document.createElement('div');
        document.body.appendChild(container);
        
        // Create widget instance
        widget = new TaskWidget();
        
        // Reset all mocks
        vi.clearAllMocks();
    });
    
    afterEach(() => {
        // Cleanup
        if (widget) {
            widget.unmount();
        }
        if (container.parentElement) {
            container.parentElement.removeChild(container);
        }
    });
    
    describe('Initialization and Mounting', () => {
        it('should initialize with default values', () => {
            expect(widget.selectedFilter).toBe('all');
            expect(widget.searchQuery).toBe('');
            expect(widget.tasks).toEqual([]);
            expect(widget.groupedTasks).toEqual({});
        });
        
        it('should mount to parent element', () => {
            widget.mount(container);
            
            expect(container.querySelector('.task-widget')).toBeTruthy();
            expect(container.querySelector('.task-header')).toBeTruthy();
            expect(container.querySelector('.task-search-container')).toBeTruthy();
            expect(container.querySelector('.task-filter-tabs')).toBeTruthy();
            expect(container.querySelector('#task-list')).toBeTruthy();
        });
        
        it('should create all filter tabs', () => {
            widget.mount(container);
            
            const tabs = container.querySelectorAll('.task-filter-tab');
            expect(tabs.length).toBe(5);
            
            const tabTexts = Array.from(tabs).map(tab => tab.textContent);
            expect(tabTexts).toContain('📋 All');
            expect(tabTexts).toContain('📅 Today');
            expect(tabTexts).toContain('⚠️ Overdue');
            expect(tabTexts).toContain('📆 Upcoming');
            expect(tabTexts).toContain('❓ No Date');
        });
        
        it('should load tasks on mount', async () => {
            invoke.mockResolvedValueOnce(mockTasks.filter(t => t.status === 'todo'));
            
            widget.mount(container);
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('query_tasks_by_status', { status: 'todo' });
            });
        });
    });
    
    describe('Task Loading and Filtering', () => {
        beforeEach(() => {
            widget.mount(container);
        });
        
        it('should load all tasks when filter is "all"', async () => {
            const todoTasks = mockTasks.filter(t => t.status === 'todo');
            invoke.mockResolvedValueOnce(todoTasks);
            
            await widget.loadTasks();
            
            expect(invoke).toHaveBeenCalledWith('query_tasks_by_status', { status: 'todo' });
            expect(widget.tasks).toEqual(todoTasks);
        });
        
        it('should load today tasks when filter is "today"', async () => {
            const todayTasks = [mockTasks[0]];
            invoke.mockResolvedValueOnce(todayTasks);
            
            widget.selectedFilter = 'today';
            await widget.loadTasks();
            
            expect(invoke).toHaveBeenCalledWith('query_tasks_today');
            expect(widget.tasks).toEqual(todayTasks);
        });
        
        it('should load overdue tasks when filter is "overdue"', async () => {
            const overdueTasks = [mockTasks[2]];
            invoke.mockResolvedValueOnce(overdueTasks);
            
            widget.selectedFilter = 'overdue';
            await widget.loadTasks();
            
            expect(invoke).toHaveBeenCalledWith('query_tasks_overdue');
            expect(widget.tasks).toEqual(overdueTasks);
        });
        
        it('should apply search filter to loaded tasks', async () => {
            invoke.mockResolvedValueOnce(mockTasks);
            
            widget.searchQuery = 'documentation';
            await widget.loadTasks();
            
            expect(widget.tasks.length).toBe(1);
            expect(widget.tasks[0].text).toContain('documentation');
        });
        
        it('should handle load errors gracefully', async () => {
            invoke.mockRejectedValueOnce(new Error('Failed to load tasks'));
            
            await widget.loadTasks();
            
            const errorDiv = container.querySelector('.task-error');
            expect(errorDiv).toBeTruthy();
            expect(errorDiv.textContent).toContain('Error loading tasks');
        });
    });
    
    describe('Task Grouping and Rendering', () => {
        beforeEach(() => {
            widget.mount(container);
        });
        
        it('should group tasks by project', () => {
            widget.tasks = mockTasks;
            widget.groupTasksByProject();
            
            expect(Object.keys(widget.groupedTasks)).toContain('Development');
            expect(Object.keys(widget.groupedTasks)).toContain('Documentation');
            expect(Object.keys(widget.groupedTasks)).toContain('No Project');
            
            expect(widget.groupedTasks['Development'].length).toBe(2);
            expect(widget.groupedTasks['Documentation'].length).toBe(1);
            expect(widget.groupedTasks['No Project'].length).toBe(1);
        });
        
        it('should sort tasks within groups by priority', () => {
            widget.tasks = mockTasks;
            widget.groupTasksByProject();
            
            const devTasks = widget.groupedTasks['Development'];
            expect(devTasks[0].priority).toBe('high');
            expect(devTasks[1].priority).toBe('medium');
        });
        
        it('should render task items with correct metadata', () => {
            widget.tasks = [mockTasks[0]];
            widget.groupTasksByProject();
            widget.renderTasks();
            
            const taskItem = container.querySelector('.task-item');
            expect(taskItem).toBeTruthy();
            
            expect(taskItem.querySelector('.task-text').textContent).toBe('Write unit tests');
            expect(taskItem.querySelector('.task-priority-high')).toBeTruthy();
            expect(taskItem.querySelector('.task-due-date').textContent).toBe('Today');
            expect(taskItem.querySelector('.task-tag').textContent).toBe('#testing');
        });
        
        it('should render empty state when no tasks', () => {
            widget.tasks = [];
            widget.renderTasks();
            
            const emptyState = container.querySelector('.task-empty-state');
            expect(emptyState).toBeTruthy();
            expect(emptyState.textContent).toContain('No tasks found');
        });
    });
    
    describe('User Interactions', () => {
        beforeEach(() => {
            widget.mount(container);
            invoke.mockResolvedValue(mockTasks);
        });
        
        it('should toggle task status on checkbox change', async () => {
            widget.tasks = [mockTasks[0]];
            widget.groupTasksByProject();
            widget.renderTasks();
            
            const checkbox = container.querySelector('.task-checkbox');
            invoke.mockResolvedValueOnce(); // Mock successful toggle
            invoke.mockResolvedValueOnce([]); // Mock reload
            
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('toggle_task_status', {
                    taskId: 'task-1',
                    done: true
                });
            });
        });
        
        it('should open file on task click', async () => {
            widget.tasks = [mockTasks[0]];
            widget.groupTasksByProject();
            widget.renderTasks();
            
            const taskContent = container.querySelector('.task-content');
            invoke.mockResolvedValueOnce();
            
            taskContent.click();
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('open_file_at_line', {
                    filePath: '/vault/dev.md',
                    lineNumber: 10
                });
            });
        });
        
        it('should change filter on tab click', async () => {
            const tabs = container.querySelectorAll('.task-filter-tab');
            const todayTab = Array.from(tabs).find(tab => tab.dataset.filter === 'today');
            
            invoke.mockResolvedValueOnce([mockTasks[0]]);
            
            todayTab.click();
            
            expect(widget.selectedFilter).toBe('today');
            expect(todayTab.classList.contains('active')).toBeTruthy();
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('query_tasks_today');
            });
        });
        
        it('should debounce search input', async () => {
            const searchInput = container.querySelector('.task-search-input');
            
            searchInput.value = 'test';
            searchInput.dispatchEvent(new Event('input'));
            
            expect(widget.searchQuery).toBe('test');
            
            // Should not call immediately
            expect(invoke).not.toHaveBeenCalled();
            
            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 350));
            
            expect(invoke).toHaveBeenCalled();
        });
        
        it('should open dashboard on button click', () => {
            const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
            const dashboardBtn = container.querySelector('.task-dashboard-btn');
            
            dashboardBtn.click();
            
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'open-task-dashboard' })
            );
        });
    });
    
    describe('Auto-refresh', () => {
        it('should start auto-refresh on mount', () => {
            vi.useFakeTimers();
            
            widget.mount(container);
            
            expect(widget.updateInterval).toBeTruthy();
            
            vi.advanceTimersByTime(30000);
            expect(invoke).toHaveBeenCalledTimes(2); // Initial load + refresh
            
            vi.useRealTimers();
        });
        
        it('should stop auto-refresh on unmount', () => {
            vi.useFakeTimers();
            
            widget.mount(container);
            const intervalId = widget.updateInterval;
            
            widget.unmount();
            
            expect(widget.updateInterval).toBeNull();
            
            vi.advanceTimersByTime(30000);
            // Should not call again after unmount
            expect(invoke).toHaveBeenCalledTimes(1); // Only initial load
            
            vi.useRealTimers();
        });
    });
    
    describe('Settings Management', () => {
        it('should get current settings', () => {
            widget.selectedFilter = 'today';
            widget.searchQuery = 'test';
            
            const settings = widget.getSettings();
            
            expect(settings).toEqual({
                selectedFilter: 'today',
                searchQuery: 'test'
            });
        });
        
        it('should apply settings', () => {
            widget.setSettings({
                selectedFilter: 'overdue',
                searchQuery: 'bug'
            });
            
            expect(widget.selectedFilter).toBe('overdue');
            expect(widget.searchQuery).toBe('bug');
        });
        
        it('should handle partial settings', () => {
            widget.selectedFilter = 'all';
            widget.searchQuery = '';
            
            widget.setSettings({
                selectedFilter: 'today'
            });
            
            expect(widget.selectedFilter).toBe('today');
            expect(widget.searchQuery).toBe('');
        });
    });
    
    describe('Performance', () => {
        it('should render large task lists efficiently', () => {
            const largeTasks = Array.from({ length: 100 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                status: 'todo',
                project: `Project ${i % 10}`,
                priority: ['high', 'medium', 'low'][i % 3],
                due_date: null,
                tags: [],
                note_path: `/vault/task-${i}.md`,
                line_number: i
            }));
            
            widget.mount(container);
            
            const startTime = performance.now();
            widget.tasks = largeTasks;
            widget.groupTasksByProject();
            widget.renderTasks();
            const endTime = performance.now();
            
            expect(endTime - startTime).toBeLessThan(50); // Should render in under 50ms
            
            const taskItems = container.querySelectorAll('.task-item');
            expect(taskItems.length).toBe(100);
        });
        
        it('should handle rapid filter changes efficiently', async () => {
            widget.mount(container);
            
            const filters = ['all', 'today', 'overdue', 'upcoming', 'no-date'];
            
            for (const filter of filters) {
                widget.selectedFilter = filter;
                await widget.loadTasks();
            }
            
            // Should have called invoke once per filter
            expect(invoke).toHaveBeenCalledTimes(filters.length);
        });
    });
});