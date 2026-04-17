/**
 * Task Dashboard Component Tests
 * Comprehensive test suite for TaskDashboard.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskDashboard, openTaskDashboard } from './TaskDashboard.js';
import { TaskListView } from './TaskListView.js';
import { TaskKanbanView } from './TaskKanbanView.js';
import { TaskCalendarView } from './TaskCalendarView.js';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}));

// Mock view components
vi.mock('./TaskListView.js', () => ({
    TaskListView: vi.fn().mockImplementation(() => ({
        mount: vi.fn(),
        updateTasks: vi.fn(),
        unmount: vi.fn()
    }))
}));

vi.mock('./TaskKanbanView.js', () => ({
    TaskKanbanView: vi.fn().mockImplementation(() => ({
        mount: vi.fn(),
        updateTasks: vi.fn(),
        unmount: vi.fn()
    }))
}));

vi.mock('./TaskCalendarView.js', () => ({
    TaskCalendarView: vi.fn().mockImplementation(() => ({
        mount: vi.fn(),
        updateTasks: vi.fn(),
        unmount: vi.fn()
    }))
}));

describe('TaskDashboard', () => {
    let dashboard;
    
    const mockTasks = [
        {
            id: 'task-1',
            text: 'Complete feature implementation',
            status: 'todo',
            project: 'Frontend',
            priority: 'high',
            due_date: '2025-01-20',
            tags: ['feature', 'urgent']
        },
        {
            id: 'task-2',
            text: 'Write documentation',
            status: 'todo',
            project: 'Documentation',
            priority: 'medium',
            due_date: '2025-01-22',
            tags: ['docs']
        },
        {
            id: 'task-3',
            text: 'Fix critical bug',
            status: 'done',
            project: 'Backend',
            priority: 'high',
            due_date: '2025-01-15',
            tags: ['bug', 'critical']
        },
        {
            id: 'task-4',
            text: 'Code review',
            status: 'todo',
            project: 'Frontend',
            priority: 'low',
            due_date: '2025-01-18',
            tags: ['review']
        }
    ];
    
    beforeEach(() => {
        dashboard = new TaskDashboard();
        vi.clearAllMocks();
    });
    
    afterEach(() => {
        // Clean up modal if exists
        if (dashboard && dashboard.modal) {
            dashboard.close();
        }
        
        // Clean up any remaining DOM elements
        document.body.innerHTML = '';
    });
    
    describe('Initialization', () => {
        it('should initialize with default values', () => {
            expect(dashboard.currentView).toBe('list');
            expect(dashboard.currentProject).toBeNull();
            expect(dashboard.searchQuery).toBe('');
            expect(dashboard.tasks).toEqual([]);
            expect(dashboard.projects).toEqual([]);
        });
        
        it('should have empty view instances initially', () => {
            expect(dashboard.views.list).toBeNull();
            expect(dashboard.views.kanban).toBeNull();
            expect(dashboard.views.calendar).toBeNull();
        });
    });
    
    describe('Modal Creation and Management', () => {
        it('should create modal on open', async () => {
            invoke.mockResolvedValueOnce(mockTasks); // For loadProjects
            invoke.mockResolvedValueOnce(mockTasks); // For loadTasks
            
            await dashboard.open();
            
            expect(document.querySelector('.task-dashboard-modal')).toBeTruthy();
            expect(document.querySelector('.task-dashboard-content')).toBeTruthy();
            expect(document.querySelector('.task-dashboard-header')).toBeTruthy();
            expect(document.querySelector('.task-dashboard-toolbar')).toBeTruthy();
            expect(document.querySelector('#task-dashboard-view')).toBeTruthy();
        });
        
        it('should add visible class after animation frame', async () => {
            invoke.mockResolvedValue(mockTasks);
            
            await dashboard.open();
            
            // Wait for animation frame
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            expect(dashboard.modal.classList.contains('visible')).toBeTruthy();
        });
        
        it('should close modal on close button click', async () => {
            invoke.mockResolvedValue(mockTasks);
            
            await dashboard.open();
            
            const closeBtn = document.querySelector('.task-dashboard-close');
            closeBtn.click();
            
            expect(dashboard.modal.classList.contains('visible')).toBeFalsy();
            
            // Wait for removal animation
            await new Promise(resolve => setTimeout(resolve, 350));
            
            expect(document.querySelector('.task-dashboard-modal')).toBeFalsy();
        });
        
        it('should close modal on Escape key', async () => {
            invoke.mockResolvedValue(mockTasks);
            
            await dashboard.open();
            
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(escapeEvent);
            
            expect(dashboard.modal.classList.contains('visible')).toBeFalsy();
        });
    });
    
    describe('View Management', () => {
        beforeEach(async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
        });
        
        it('should create list view by default', () => {
            expect(TaskListView).toHaveBeenCalled();
            expect(dashboard.views.list).toBeTruthy();
            expect(dashboard.views.list.mount).toHaveBeenCalled();
        });
        
        it('should switch to kanban view', () => {
            dashboard.handleViewChange('kanban');
            
            expect(dashboard.currentView).toBe('kanban');
            expect(TaskKanbanView).toHaveBeenCalled();
            expect(dashboard.views.kanban).toBeTruthy();
            expect(dashboard.views.kanban.mount).toHaveBeenCalled();
        });
        
        it('should switch to calendar view', () => {
            dashboard.handleViewChange('calendar');
            
            expect(dashboard.currentView).toBe('calendar');
            expect(TaskCalendarView).toHaveBeenCalled();
            expect(dashboard.views.calendar).toBeTruthy();
            expect(dashboard.views.calendar.mount).toHaveBeenCalled();
        });
        
        it('should update active button on view change', () => {
            const kanbanBtn = document.querySelector('[data-view="kanban"]');
            
            dashboard.handleViewChange('kanban');
            
            expect(kanbanBtn.classList.contains('active')).toBeTruthy();
            
            const listBtn = document.querySelector('[data-view="list"]');
            expect(listBtn.classList.contains('active')).toBeFalsy();
        });
        
        it('should reuse existing view instances', () => {
            dashboard.handleViewChange('kanban');
            const firstInstance = dashboard.views.kanban;
            
            dashboard.handleViewChange('list');
            dashboard.handleViewChange('kanban');
            
            expect(dashboard.views.kanban).toBe(firstInstance);
            expect(TaskKanbanView).toHaveBeenCalledTimes(1);
        });
    });
    
    describe('Task Loading and Filtering', () => {
        beforeEach(async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
        });
        
        it('should load all tasks initially', async () => {
            expect(invoke).toHaveBeenCalledWith('query_tasks', { query: {} });
            expect(dashboard.tasks).toEqual(mockTasks);
        });
        
        it('should extract and sort unique projects', async () => {
            expect(dashboard.projects).toEqual(['Backend', 'Documentation', 'Frontend']);
            
            const projectSelect = document.getElementById('project-filter');
            const options = Array.from(projectSelect.options).map(opt => opt.value);
            
            expect(options).toContain('');
            expect(options).toContain('Frontend');
            expect(options).toContain('Documentation');
            expect(options).toContain('Backend');
        });
        
        it('should filter tasks by project', async () => {
            const projectSelect = document.getElementById('project-filter');
            
            invoke.mockResolvedValueOnce(mockTasks.filter(t => t.project === 'Frontend'));
            
            projectSelect.value = 'Frontend';
            projectSelect.dispatchEvent(new Event('change'));
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('query_tasks', { 
                    query: { project: 'Frontend' } 
                });
            });
            
            expect(dashboard.currentProject).toBe('Frontend');
        });
        
        it('should apply search filter', async () => {
            const searchInput = document.querySelector('.task-search');
            
            dashboard.tasks = mockTasks;
            searchInput.value = 'documentation';
            searchInput.dispatchEvent(new Event('input'));
            
            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 350));
            
            expect(dashboard.searchQuery).toBe('documentation');
            expect(dashboard.tasks.length).toBe(1);
            expect(dashboard.tasks[0].text).toContain('documentation');
        });
        
        it('should combine project and search filters', async () => {
            dashboard.currentProject = 'Frontend';
            dashboard.searchQuery = 'feature';
            
            invoke.mockResolvedValueOnce(mockTasks.filter(t => t.project === 'Frontend'));
            
            await dashboard.loadTasks();
            
            expect(dashboard.tasks.length).toBe(1);
            expect(dashboard.tasks[0].text).toContain('feature');
        });
    });
    
    describe('Statistics Display', () => {
        beforeEach(async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
        });
        
        it('should display correct task statistics', () => {
            dashboard.tasks = mockTasks;
            dashboard.updateStats();
            
            const stats = document.getElementById('task-stats');
            
            expect(stats.textContent).toContain('4'); // Total
            expect(stats.textContent).toContain('1'); // Done
            expect(stats.textContent).toContain('3'); // Open
        });
        
        it('should show overdue count when applicable', () => {
            const overdueTasks = [
                ...mockTasks,
                {
                    id: 'task-5',
                    text: 'Overdue task',
                    status: 'todo',
                    due_date: '2025-01-10'
                }
            ];
            
            dashboard.tasks = overdueTasks;
            dashboard.updateStats();
            
            const overdueElement = document.querySelector('.stat-overdue');
            expect(overdueElement).toBeTruthy();
            expect(overdueElement.textContent).toContain('1');
        });
        
        it('should not show overdue count when none', () => {
            dashboard.tasks = mockTasks.filter(t => t.due_date > '2025-01-15');
            dashboard.updateStats();
            
            const overdueElement = document.querySelector('.stat-overdue');
            expect(overdueElement).toBeFalsy();
        });
    });
    
    describe('Keyboard Shortcuts', () => {
        beforeEach(async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
        });
        
        it('should focus search on Cmd+F', () => {
            const searchInput = document.querySelector('.task-search');
            const focusSpy = vi.spyOn(searchInput, 'focus');
            
            const event = new KeyboardEvent('keydown', { 
                key: 'f', 
                metaKey: true 
            });
            document.dispatchEvent(event);
            
            expect(focusSpy).toHaveBeenCalled();
        });
        
        it('should focus search on Ctrl+F', () => {
            const searchInput = document.querySelector('.task-search');
            const focusSpy = vi.spyOn(searchInput, 'focus');
            
            const event = new KeyboardEvent('keydown', { 
                key: 'f', 
                ctrlKey: true 
            });
            document.dispatchEvent(event);
            
            expect(focusSpy).toHaveBeenCalled();
        });
        
        it('should prevent default on Cmd+F', () => {
            const event = new KeyboardEvent('keydown', { 
                key: 'f', 
                metaKey: true 
            });
            const preventSpy = vi.spyOn(event, 'preventDefault');
            
            document.dispatchEvent(event);
            
            expect(preventSpy).toHaveBeenCalled();
        });
    });
    
    describe('Refresh Functionality', () => {
        beforeEach(async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
        });
        
        it('should refresh tasks on refresh button click', async () => {
            const refreshBtn = document.querySelector('.task-action-btn');
            
            invoke.mockResolvedValueOnce(mockTasks);
            
            refreshBtn.click();
            
            await vi.waitFor(() => {
                // Should be called once for initial load, once for refresh
                expect(invoke).toHaveBeenCalledWith('query_tasks', { query: {} });
            });
        });
        
        it('should maintain filters on refresh', async () => {
            dashboard.currentProject = 'Frontend';
            dashboard.searchQuery = 'test';
            
            const refreshBtn = document.querySelector('.task-action-btn');
            
            invoke.mockResolvedValueOnce(mockTasks);
            
            refreshBtn.click();
            
            await vi.waitFor(() => {
                expect(invoke).toHaveBeenCalledWith('query_tasks', { 
                    query: { project: 'Frontend' } 
                });
            });
            
            expect(dashboard.searchQuery).toBe('test');
        });
    });
    
    describe('View Cleanup', () => {
        it('should unmount all views on close', async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
            
            // Create all views
            dashboard.handleViewChange('kanban');
            dashboard.handleViewChange('calendar');
            dashboard.handleViewChange('list');
            
            dashboard.close();
            
            expect(dashboard.views.list.unmount).toHaveBeenCalled();
            expect(dashboard.views.kanban.unmount).toHaveBeenCalled();
            expect(dashboard.views.calendar.unmount).toHaveBeenCalled();
            
            expect(dashboard.views).toEqual({});
        });
        
        it('should remove event listeners on close', async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
            
            const removeEventSpy = vi.spyOn(document, 'removeEventListener');
            
            dashboard.close();
            
            expect(removeEventSpy).toHaveBeenCalledWith('keydown', dashboard.handleKeyPress);
        });
    });
    
    describe('Global Dashboard Function', () => {
        it('should open dashboard via global function', async () => {
            invoke.mockResolvedValue(mockTasks);
            
            await openTaskDashboard();
            
            expect(document.querySelector('.task-dashboard-modal')).toBeTruthy();
        });
        
        it('should reuse existing dashboard instance', async () => {
            invoke.mockResolvedValue(mockTasks);
            
            await openTaskDashboard();
            const firstModal = document.querySelector('.task-dashboard-modal');
            
            // Close and reopen
            const closeBtn = document.querySelector('.task-dashboard-close');
            closeBtn.click();
            
            await new Promise(resolve => setTimeout(resolve, 350));
            
            await openTaskDashboard();
            const secondModal = document.querySelector('.task-dashboard-modal');
            
            // Should be a new modal but same dashboard instance
            expect(secondModal).toBeTruthy();
        });
        
        it('should respond to open-task-dashboard event', async () => {
            invoke.mockResolvedValue(mockTasks);
            
            window.dispatchEvent(new CustomEvent('open-task-dashboard'));
            
            await vi.waitFor(() => {
                expect(document.querySelector('.task-dashboard-modal')).toBeTruthy();
            });
        });
    });
    
    describe('Performance', () => {
        it('should handle large task lists efficiently', async () => {
            const largeTasks = Array.from({ length: 500 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                status: i % 3 === 0 ? 'done' : 'todo',
                project: `Project ${i % 20}`,
                priority: ['high', 'medium', 'low'][i % 3],
                due_date: `2025-01-${(i % 28) + 1}`,
                tags: [`tag-${i % 10}`]
            }));
            
            invoke.mockResolvedValue(largeTasks);
            
            const startTime = performance.now();
            await dashboard.open();
            const endTime = performance.now();
            
            expect(endTime - startTime).toBeLessThan(100); // Should open in under 100ms
            
            expect(dashboard.tasks.length).toBe(500);
            expect(dashboard.projects.length).toBe(20);
        });
        
        it('should debounce search efficiently', async () => {
            invoke.mockResolvedValue(mockTasks);
            await dashboard.open();
            
            const searchInput = document.querySelector('.task-search');
            
            // Rapid typing simulation
            for (let i = 0; i < 10; i++) {
                searchInput.value = 'test' + i;
                searchInput.dispatchEvent(new Event('input'));
            }
            
            // Should only call loadTasks once after debounce
            await new Promise(resolve => setTimeout(resolve, 350));
            
            // Count calls to loadTasks (through invoke)
            const loadTasksCalls = invoke.mock.calls.filter(
                call => call[0] === 'query_tasks'
            ).length;
            
            // Should be 2: initial load + 1 after debounce
            expect(loadTasksCalls).toBeLessThanOrEqual(3);
        });
    });
});