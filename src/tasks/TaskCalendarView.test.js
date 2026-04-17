/**
 * Task Calendar View Component Tests
 * Comprehensive test suite for TaskCalendarView.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskCalendarView } from './TaskCalendarView.js';
import { invoke } from '@tauri-apps/api/core';
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
        isPast: vi.fn((date) => date < testToday)
    };
});

describe('TaskCalendarView', () => {
    let view;
    let container;
    
    const mockTasks = [
        {
            id: 'task-1',
            text: 'Today task high priority',
            status: 'todo',
            project: 'Frontend',
            priority: 'high',
            due_date: '2025-01-15',
            tags: ['urgent'],
            note_path: '/vault/tasks.md',
            line_number: 10
        },
        {
            id: 'task-2',
            text: 'Tomorrow task',
            status: 'todo',
            project: 'Backend',
            priority: 'medium',
            due_date: '2025-01-16',
            tags: ['api'],
            note_path: '/vault/tasks.md',
            line_number: 20
        },
        {
            id: 'task-3',
            text: 'Past task completed',
            status: 'done',
            project: 'Documentation',
            priority: 'low',
            due_date: '2025-01-10',
            tags: ['docs'],
            note_path: '/vault/docs.md',
            line_number: 5
        },
        {
            id: 'task-4',
            text: 'Future task',
            status: 'todo',
            project: 'Testing',
            priority: 'high',
            due_date: '2025-01-20',
            tags: ['test'],
            note_path: '/vault/tests.md',
            line_number: 15
        },
        {
            id: 'task-5',
            text: 'Another today task',
            status: 'todo',
            project: 'Frontend',
            priority: 'medium',
            due_date: '2025-01-15',
            tags: ['feature'],
            note_path: '/vault/features.md',
            line_number: 30
        }
    ];
    
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        
        view = new TaskCalendarView();
        vi.clearAllMocks();
        
        // Set consistent current date for tests
        view.currentDate = new Date('2025-01-15');
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
            const newView = new TaskCalendarView();
            expect(newView.tasks).toEqual([]);
            expect(newView.selectedDate).toBeNull();
            expect(newView.tasksByDate).toEqual({});
            expect(newView.currentDate).toBeInstanceOf(Date);
        });
        
        it('should mount to parent element', () => {
            view.mount(container);
            
            expect(container.querySelector('.task-calendar-view')).toBeTruthy();
            expect(container.querySelector('.task-calendar-header')).toBeTruthy();
            expect(container.querySelector('.calendar-grid-container')).toBeTruthy();
            expect(container.querySelector('#task-calendar-grid')).toBeTruthy();
            expect(container.querySelector('#calendar-task-panel')).toBeTruthy();
        });
        
        it('should create navigation controls', () => {
            view.mount(container);
            
            const navButtons = container.querySelectorAll('.calendar-nav-btn');
            expect(navButtons.length).toBe(3); // Previous, Today, Next
            
            const prevBtn = navButtons[0];
            const todayBtn = container.querySelector('.calendar-today-btn');
            const nextBtn = navButtons[2];
            
            expect(prevBtn.innerHTML).toBe('←');
            expect(todayBtn.textContent).toBe('Today');
            expect(nextBtn.innerHTML).toBe('→');
        });
        
        it('should display current month and year', () => {
            view.mount(container);
            
            const monthYear = document.getElementById('calendar-month-year');
            expect(monthYear.textContent).toBe('January 2025');
        });
    });
    
    describe('Task Organization', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should organize tasks by date', () => {
            view.updateTasks(mockTasks);
            
            expect(view.tasksByDate['2025-01-15']).toHaveLength(2);
            expect(view.tasksByDate['2025-01-16']).toHaveLength(1);
            expect(view.tasksByDate['2025-01-10']).toHaveLength(1);
            expect(view.tasksByDate['2025-01-20']).toHaveLength(1);
        });
        
        it('should sort tasks within dates by priority', () => {
            view.updateTasks(mockTasks);
            
            const todayTasks = view.tasksByDate['2025-01-15'];
            expect(todayTasks[0].priority).toBe('high');
            expect(todayTasks[1].priority).toBe('medium');
        });
        
        it('should ignore tasks without due dates', () => {
            const tasksWithNull = [
                ...mockTasks,
                { id: 'no-date', text: 'No date task', due_date: null }
            ];
            
            view.updateTasks(tasksWithNull);
            
            const totalTasksInCalendar = Object.values(view.tasksByDate)
                .reduce((sum, tasks) => sum + tasks.length, 0);
            
            expect(totalTasksInCalendar).toBe(5); // Only tasks with dates
        });
    });
    
    describe('Calendar Rendering', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should render weekday headers', () => {
            const weekdays = container.querySelectorAll('.calendar-weekday');
            expect(weekdays.length).toBe(7);
            
            const weekdayTexts = Array.from(weekdays).map(w => w.textContent);
            expect(weekdayTexts).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        });
        
        it('should render correct number of day cells', () => {
            view.renderCalendar();
            
            const dayCells = container.querySelectorAll('.calendar-day');
            // January 2025 starts on Wednesday and has 31 days
            // Calendar shows full weeks, so it includes some days from Dec and Feb
            expect(dayCells.length).toBeGreaterThanOrEqual(35); // At least 5 weeks
        });
        
        it('should mark today\'s date', () => {
            view.updateTasks(mockTasks);
            
            const todayCell = container.querySelector('.calendar-day-today');
            expect(todayCell).toBeTruthy();
            expect(todayCell.querySelector('.calendar-day-number').textContent).toBe('15');
        });
        
        it('should mark days from other months', () => {
            view.renderCalendar();
            
            const otherMonthCells = container.querySelectorAll('.calendar-day-other-month');
            expect(otherMonthCells.length).toBeGreaterThan(0);
        });
        
        it('should show task indicators on dates with tasks', () => {
            view.updateTasks(mockTasks);
            
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith15th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '15' && !cell.classList.contains('calendar-day-other-month');
            });
            
            expect(cellWith15th.querySelector('.calendar-task-indicators')).toBeTruthy();
            expect(cellWith15th.querySelector('.calendar-task-count').textContent).toBe('2');
        });
        
        it('should show task dots colored by priority', () => {
            view.updateTasks(mockTasks);
            
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith15th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '15' && !cell.classList.contains('calendar-day-other-month');
            });
            
            const dots = cellWith15th.querySelectorAll('.calendar-task-dot');
            expect(dots.length).toBe(2);
            
            expect(dots[0].classList.contains('priority-high')).toBeTruthy();
            expect(dots[1].classList.contains('priority-medium')).toBeTruthy();
        });
        
        it('should mark completed task dots', () => {
            view.updateTasks(mockTasks);
            
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith10th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '10' && !cell.classList.contains('calendar-day-other-month');
            });
            
            const dot = cellWith10th.querySelector('.calendar-task-dot');
            expect(dot.classList.contains('task-done')).toBeTruthy();
        });
        
        it('should show overflow indicator for more than 3 tasks', () => {
            const manyTasks = Array.from({ length: 5 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                due_date: '2025-01-15',
                priority: 'medium'
            }));
            
            view.updateTasks(manyTasks);
            
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith15th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '15' && !cell.classList.contains('calendar-day-other-month');
            });
            
            const moreIndicator = cellWith15th.querySelector('.calendar-task-more');
            expect(moreIndicator).toBeTruthy();
            expect(moreIndicator.textContent).toBe('+2');
        });
    });
    
    describe('Navigation', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should navigate to previous month', () => {
            const prevBtn = container.querySelector('.calendar-nav-btn');
            
            prevBtn.click();
            
            const monthYear = document.getElementById('calendar-month-year');
            expect(monthYear.textContent).toBe('December 2024');
            expect(format(view.currentDate, 'yyyy-MM')).toBe('2024-12');
        });
        
        it('should navigate to next month', () => {
            const nextBtn = container.querySelectorAll('.calendar-nav-btn')[2];
            
            nextBtn.click();
            
            const monthYear = document.getElementById('calendar-month-year');
            expect(monthYear.textContent).toBe('February 2025');
            expect(format(view.currentDate, 'yyyy-MM')).toBe('2025-02');
        });
        
        it('should navigate to today', () => {
            view.currentDate = new Date('2025-03-15');
            view.renderCalendar();
            
            const todayBtn = container.querySelector('.calendar-today-btn');
            todayBtn.click();
            
            const monthYear = document.getElementById('calendar-month-year');
            expect(monthYear.textContent).toBe('January 2025');
            expect(view.selectedDate).toBeTruthy();
            expect(format(view.selectedDate, 'yyyy-MM-dd')).toBe('2025-01-15');
        });
    });
    
    describe('Date Selection and Task Panel', () => {
        beforeEach(() => {
            view.mount(container);
            view.updateTasks(mockTasks);
        });
        
        it('should select date on click', () => {
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith15th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '15' && !cell.classList.contains('calendar-day-other-month');
            });
            
            cellWith15th.click();
            
            expect(view.selectedDate).toBeTruthy();
            expect(format(view.selectedDate, 'yyyy-MM-dd')).toBe('2025-01-15');
            expect(cellWith15th.classList.contains('calendar-day-selected')).toBeTruthy();
        });
        
        it('should show tasks in panel for selected date', () => {
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith15th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '15' && !cell.classList.contains('calendar-day-other-month');
            });
            
            cellWith15th.click();
            
            const panel = document.getElementById('calendar-task-panel');
            const dateTitle = panel.querySelector('.task-panel-header h3');
            expect(dateTitle.textContent).toBe('Wednesday, January 15, 2025');
            
            const count = panel.querySelector('.task-panel-count');
            expect(count.textContent).toBe('2 tasks');
            
            const taskItems = panel.querySelectorAll('.task-panel-item');
            expect(taskItems.length).toBe(2);
        });
        
        it('should show empty state for dates without tasks', () => {
            const dayCells = container.querySelectorAll('.calendar-day');
            const cellWith25th = Array.from(dayCells).find(cell => {
                const dayNum = cell.querySelector('.calendar-day-number').textContent;
                return dayNum === '25' && !cell.classList.contains('calendar-day-other-month');
            });
            
            cellWith25th.click();
            
            const panel = document.getElementById('calendar-task-panel');
            const empty = panel.querySelector('.task-panel-empty');
            expect(empty).toBeTruthy();
            expect(empty.textContent).toBe('No tasks scheduled for this date');
        });
        
        it('should render task panel items with metadata', () => {
            view.showTasksForDate(new Date('2025-01-15'));
            
            const panel = document.getElementById('calendar-task-panel');
            const firstTask = panel.querySelector('.task-panel-item');
            
            expect(firstTask.querySelector('.task-panel-text').textContent).toBe('Today task high priority');
            expect(firstTask.querySelector('.priority-high')).toBeTruthy();
            expect(firstTask.querySelector('.task-project').textContent).toBe('Frontend');
        });
    });
    
    describe('Task Interactions', () => {
        beforeEach(() => {
            view.mount(container);
            view.updateTasks(mockTasks);
        });
        
        it('should toggle task status in panel', async () => {
            view.showTasksForDate(new Date('2025-01-15'));
            
            const panel = document.getElementById('calendar-task-panel');
            const checkbox = panel.querySelector('.task-checkbox');
            
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
        
        it('should open file on task panel item click', async () => {
            view.showTasksForDate(new Date('2025-01-15'));
            
            const panel = document.getElementById('calendar-task-panel');
            const taskItem = panel.querySelector('.task-panel-item');
            
            invoke.mockResolvedValueOnce();
            const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
            
            taskItem.click();
            
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
        
        it('should update calendar dots after task toggle', async () => {
            view.showTasksForDate(new Date('2025-01-15'));
            
            const panel = document.getElementById('calendar-task-panel');
            const checkbox = panel.querySelector('.task-checkbox');
            
            invoke.mockResolvedValueOnce();
            
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            
            await vi.waitFor(() => {
                const dayCells = container.querySelectorAll('.calendar-day');
                const cellWith15th = Array.from(dayCells).find(cell => {
                    const dayNum = cell.querySelector('.calendar-day-number').textContent;
                    return dayNum === '15' && !cell.classList.contains('calendar-day-other-month');
                });
                
                const doneDot = cellWith15th.querySelector('.calendar-task-dot.task-done');
                expect(doneDot).toBeTruthy();
            });
        });
        
        it('should revert checkbox on toggle error', async () => {
            view.showTasksForDate(new Date('2025-01-15'));
            
            const panel = document.getElementById('calendar-task-panel');
            const checkbox = panel.querySelector('.task-checkbox');
            
            invoke.mockRejectedValueOnce(new Error('Toggle failed'));
            
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            
            await vi.waitFor(() => {
                expect(checkbox.checked).toBeFalsy();
            });
        });
    });
    
    describe('Update Flow', () => {
        beforeEach(() => {
            view.mount(container);
        });
        
        it('should update calendar when tasks change', () => {
            view.updateTasks(mockTasks);
            
            let taskCounts = container.querySelectorAll('.calendar-task-count');
            expect(taskCounts.length).toBeGreaterThan(0);
            
            // Update with different tasks
            view.updateTasks([mockTasks[0]]);
            
            taskCounts = container.querySelectorAll('.calendar-task-count');
            const visibleCounts = Array.from(taskCounts).filter(c => c.textContent === '1');
            expect(visibleCounts.length).toBe(1);
        });
        
        it('should update selected date panel when tasks change', () => {
            view.updateTasks(mockTasks);
            view.selectedDate = new Date('2025-01-15');
            view.showTasksForDate(view.selectedDate);
            
            let taskItems = document.querySelectorAll('.task-panel-item');
            expect(taskItems.length).toBe(2);
            
            // Update tasks
            view.updateTasks([mockTasks[0]]);
            
            taskItems = document.querySelectorAll('.task-panel-item');
            expect(taskItems.length).toBe(1);
        });
    });
    
    describe('Performance', () => {
        it('should render large task sets efficiently', () => {
            const largeTasks = Array.from({ length: 500 }, (_, i) => ({
                id: `task-${i}`,
                text: `Task ${i}`,
                status: i % 3 === 0 ? 'done' : 'todo',
                priority: ['high', 'medium', 'low'][i % 3],
                due_date: `2025-01-${(i % 28) + 1}`,
                project: `Project ${i % 10}`,
                note_path: `/vault/task-${i}.md`,
                line_number: i
            }));
            
            view.mount(container);
            
            const startTime = performance.now();
            view.updateTasks(largeTasks);
            const endTime = performance.now();
            
            expect(endTime - startTime).toBeLessThan(100);
            
            // Should organize tasks correctly
            const totalTasksOrganized = Object.values(view.tasksByDate)
                .reduce((sum, tasks) => sum + tasks.length, 0);
            expect(totalTasksOrganized).toBe(500);
        });
        
        it('should handle rapid navigation efficiently', () => {
            view.mount(container);
            view.updateTasks(mockTasks);
            
            const prevBtn = container.querySelector('.calendar-nav-btn');
            const nextBtn = container.querySelectorAll('.calendar-nav-btn')[2];
            
            // Rapid navigation
            for (let i = 0; i < 12; i++) {
                nextBtn.click();
            }
            for (let i = 0; i < 12; i++) {
                prevBtn.click();
            }
            
            // Should be back at January 2025
            const monthYear = document.getElementById('calendar-month-year');
            expect(monthYear.textContent).toBe('January 2025');
        });
        
        it('should handle rapid date selection', () => {
            view.mount(container);
            view.updateTasks(mockTasks);
            
            const dayCells = container.querySelectorAll('.calendar-day');
            
            // Click multiple dates rapidly
            dayCells.forEach((cell, index) => {
                if (index < 10) {
                    cell.click();
                }
            });
            
            // Should have a selected date
            expect(view.selectedDate).toBeTruthy();
            
            // Panel should be showing tasks for the last clicked date
            const panel = document.getElementById('calendar-task-panel');
            expect(panel.querySelector('.task-panel-header')).toBeTruthy();
        });
    });
    
    describe('Unmounting', () => {
        it('should clean up on unmount', () => {
            view.mount(container);
            
            expect(container.querySelector('.task-calendar-view')).toBeTruthy();
            
            view.unmount();
            
            expect(container.querySelector('.task-calendar-view')).toBeFalsy();
        });
        
        it('should handle unmount when not mounted', () => {
            expect(() => view.unmount()).not.toThrow();
        });
    });
});