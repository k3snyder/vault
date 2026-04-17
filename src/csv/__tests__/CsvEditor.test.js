/**
 * CsvEditor.test.js - Unit tests for CsvEditor component
 *
 * Tests cover:
 * - Cell editing lifecycle
 * - Keyboard navigation
 * - Dirty state tracking
 * - Row/column operations
 * - Premium feature gating
 *
 * NOTE: Full mount tests are blocked by a method shadowing bug in CsvEditor.js
 * where renderTable(rows) at line 3877 shadows renderTable() at line 444.
 * Tests below use unit-style testing of individual methods where possible.
 *
 * @jest-environment jsdom
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock Toast before any imports that use it
jest.unstable_mockModule('../../plugin-hub/components/Toast.js', () => ({
  showToast: jest.fn(),
  ToastManager: {
    getInstance: jest.fn(() => ({
      show: jest.fn(),
      init: jest.fn()
    }))
  },
  default: {
    getInstance: jest.fn(() => ({
      show: jest.fn(),
      init: jest.fn()
    }))
  }
}));

// Mock Tauri API
jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: jest.fn()
}));

jest.unstable_mockModule('@tauri-apps/plugin-dialog', () => ({
  save: jest.fn()
}));

// Mock CodeMirror modules
const mockEditorView = jest.fn().mockImplementation(() => ({
  dom: document.createElement('div'),
  state: { doc: { toString: () => '', length: 0 } },
  dispatch: jest.fn(),
  focus: jest.fn(),
  destroy: jest.fn()
}));

jest.unstable_mockModule('@codemirror/view', () => ({
  EditorView: Object.assign(mockEditorView, {
    theme: jest.fn(() => []),
    updateListener: { of: jest.fn(() => []) }
  }),
  keymap: { of: jest.fn(() => []) }
}));

jest.unstable_mockModule('@codemirror/state', () => ({
  EditorState: { create: jest.fn() }
}));

jest.unstable_mockModule('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: jest.fn(() => []),
  historyKeymap: []
}));

// Import after mocks are set up
const { invoke } = await import('@tauri-apps/api/core');
const { CsvEditor } = await import('../CsvEditor.js');

// ============================================================================
// Test Fixtures
// ============================================================================

const mockCsvData = {
  headers: ['id', 'name', 'amount'],
  rows: [
    ['1', 'Alice', '100.00'],
    ['2', 'Bob', '250.50'],
    ['3', 'Charlie', '75.25']
  ],
  totalRows: 3,
  truncated: false
};

const mockCsvDataTruncated = {
  headers: ['id', 'name', 'amount'],
  rows: [
    ['1', 'Alice', '100.00'],
    ['2', 'Bob', '250.50']
  ],
  totalRows: 10000,
  truncated: true
};

const mockSchema = {
  version: 1,
  sourceFile: 'test.csv',
  contentHash: 'abc123',
  updatedAt: '2026-01-01T00:00:00Z',
  columns: [
    { name: 'id', dataType: { type: 'integer' }, semanticRole: { role: 'identifier' } },
    { name: 'name', dataType: { type: 'text' }, semanticRole: { role: 'dimension' } },
    { name: 'amount', dataType: { type: 'currency', code: 'USD' }, semanticRole: { role: 'measure' } }
  ],
  relationships: [],
  metadata: { rowCount: 3, tags: [] },
  readOnly: false
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Set up default invoke mock responses
 */
function setupInvokeMock(options = {}) {
  const {
    csvData = mockCsvData,
    schema = null,
    schemaError = null
  } = options;

  invoke.mockImplementation((command, args) => {
    switch (command) {
      case 'read_csv_data':
        return Promise.resolve(csvData);
      case 'get_csv_schema':
        if (schemaError) {
          return Promise.reject(schemaError);
        }
        return Promise.resolve(schema);
      case 'save_csv_data':
        return Promise.resolve();
      case 'save_csv_schema':
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`Unknown command: ${command}`));
    }
  });
}

/**
 * Create CsvEditor with initialized state (without full mount)
 * This bypasses the renderTable bug for unit testing
 */
function createEditorWithState(filePath = 'test.csv', options = {}) {
  const { csvData = mockCsvData, schema = null } = options;

  const editor = new CsvEditor(filePath, null, 'test-pane');

  // Manually set state as if loadData completed
  editor.state.data = csvData;
  editor.state.workingRows = csvData.rows.map(row => [...row]);
  editor.state.savedRows = csvData.rows.map(row => [...row]);
  editor.state.savedHeaders = [...csvData.headers];
  editor.state.isLoading = false;
  editor.state.schema = schema;
  editor.state.isPremium = schema ? !schema.readOnly : false;

  // Create minimal container for DOM tests
  editor.container = document.createElement('div');
  editor.container.className = 'csv-editor-container';
  document.body.appendChild(editor.container);

  return editor;
}

/**
 * Simulate a keydown event
 */
function keydown(key, options = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    ...options
  });
  document.dispatchEvent(event);
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CsvEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // --------------------------------------------------------------------------
  // Constructor Tests
  // --------------------------------------------------------------------------
  describe('Constructor', () => {
    test('should initialize with correct file path', () => {
      const editor = new CsvEditor('test/data.csv', null, 'pane-1');

      expect(editor.filePath).toBe('test/data.csv');
      expect(editor.paneId).toBe('pane-1');
      expect(editor.fileName).toBe('data.csv');
    });

    test('should initialize with default state', () => {
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      expect(editor.state.data).toBeNull();
      expect(editor.state.selectedCell).toBeNull();
      expect(editor.state.editingCell).toBeNull();
      expect(editor.state.isDirty).toBe(false);
      expect(editor.state.isPremium).toBe(false);
      expect(editor.state.isLoading).toBe(true);
    });

    test('should initialize virtual scroll config', () => {
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      expect(editor.VIRTUAL_SCROLL_THRESHOLD).toBe(1000);
      expect(editor.ROW_HEIGHT).toBe(32);
      expect(editor.BUFFER_ROWS).toBe(20);
    });
  });

  // --------------------------------------------------------------------------
  // Data Loading Tests
  // --------------------------------------------------------------------------
  describe('Data Loading', () => {
    test('should call invoke with correct parameters on loadData', async () => {
      setupInvokeMock();
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      await editor.loadData();

      expect(invoke).toHaveBeenCalledWith('read_csv_data', {
        path: 'test.csv',
        maxRows: null
      });
    });

    test('should populate state after loadData', async () => {
      setupInvokeMock();
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      await editor.loadData();

      expect(editor.state.data).toEqual(mockCsvData);
      expect(editor.state.workingRows.length).toBe(3);
      expect(editor.state.isLoading).toBe(false);
    });

    test('should attempt to load schema after data', async () => {
      setupInvokeMock({ schema: mockSchema });
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      await editor.loadData();

      expect(invoke).toHaveBeenCalledWith('get_csv_schema', {
        path: 'test.csv',
        createIfMissing: false
      });
      expect(editor.state.schema).toEqual(mockSchema);
      expect(editor.state.isPremium).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Cell Selection Tests (Unit)
  // --------------------------------------------------------------------------
  describe('Cell Selection', () => {
    test('should update selectedCell state on selectCell', () => {
      const editor = createEditorWithState();

      editor.selectCell(1, 2);

      expect(editor.state.selectedCell).toEqual({ row: 1, col: 2 });
    });

    test('should set selectionStart as anchor on selectCell', () => {
      const editor = createEditorWithState();

      editor.selectCell(1, 2);

      expect(editor.state.selectionStart).toEqual({ row: 1, col: 2 });
      expect(editor.state.selectionEnd).toBeNull();
    });

    test('should extend selection with extendSelection', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 0);

      editor.extendSelection(2, 2);

      expect(editor.state.selectionStart).toEqual({ row: 0, col: 0 });
      expect(editor.state.selectionEnd).toEqual({ row: 2, col: 2 });
    });

    test('should calculate correct selection range', () => {
      const editor = createEditorWithState();
      editor.state.selectionStart = { row: 2, col: 2 };
      editor.state.selectionEnd = { row: 0, col: 0 };

      const range = editor.getSelectionRange();

      // Range should be normalized (start < end)
      expect(range.startRow).toBe(0);
      expect(range.startCol).toBe(0);
      expect(range.endRow).toBe(2);
      expect(range.endCol).toBe(2);
    });

    test('should detect multi-cell selection', () => {
      const editor = createEditorWithState();
      editor.state.selectionStart = { row: 0, col: 0 };
      editor.state.selectionEnd = { row: 1, col: 1 };

      expect(editor.hasMultiCellSelection()).toBe(true);
    });

    test('should not detect multi-cell for single selection', () => {
      const editor = createEditorWithState();
      editor.state.selectionStart = { row: 0, col: 0 };
      editor.state.selectionEnd = null;

      expect(editor.hasMultiCellSelection()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Cell Editing Tests (Unit)
  // --------------------------------------------------------------------------
  describe('Cell Editing', () => {
    test('should track editing state on startEditing', () => {
      const editor = createEditorWithState();

      // Mock the cell element
      const cell = document.createElement('td');
      cell.dataset.row = '0';
      cell.dataset.col = '1';
      cell.innerHTML = '<span class="csv-cell-text">Alice</span>';
      editor.tableElement = document.createElement('table');
      editor.tableElement.appendChild(cell);
      editor.container.appendChild(editor.tableElement);

      editor.startEditing(0, 1);

      expect(editor.state.editingCell).toEqual({ row: 0, col: 1 });
      expect(editor.originalEditValue).toBe('Alice');
    });

    test('should restore original value on cancelEditing', () => {
      const editor = createEditorWithState();

      // Setup mock cell and editor
      const cell = document.createElement('td');
      cell.dataset.row = '0';
      cell.dataset.col = '1';
      cell.innerHTML = '<span class="csv-cell-text">Alice</span>';
      editor.tableElement = document.createElement('table');
      editor.tableElement.appendChild(cell);
      editor.container.appendChild(editor.tableElement);

      editor.startEditing(0, 1);

      // Simulate CodeMirror change
      editor.cellEditor = {
        state: { doc: { toString: () => 'Changed' } },
        dom: document.createElement('div')
      };

      editor.cancelEditing();

      expect(editor.state.editingCell).toBeNull();
      expect(editor.state.workingRows[0][1]).toBe('Alice');
    });

    test('should update cell value on finishEditing', () => {
      const editor = createEditorWithState();

      // Setup mock cell and editor
      const cell = document.createElement('td');
      cell.dataset.row = '0';
      cell.dataset.col = '1';
      cell.innerHTML = '<span class="csv-cell-text">Alice</span>';
      editor.tableElement = document.createElement('table');
      editor.tableElement.appendChild(cell);
      editor.container.appendChild(editor.tableElement);

      editor.startEditing(0, 1);
      editor.cellEditor = {
        state: { doc: { toString: () => 'Alice Updated' } },
        dom: document.createElement('div')
      };

      editor.finishEditing();

      expect(editor.state.workingRows[0][1]).toBe('Alice Updated');
    });
  });

  // --------------------------------------------------------------------------
  // Keyboard Navigation Tests
  // --------------------------------------------------------------------------
  describe('Keyboard Navigation', () => {
    test('should move up with ArrowUp', () => {
      const editor = createEditorWithState();
      editor.selectCell(1, 0);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(editor.state.selectedCell.row).toBe(0);
    });

    test('should move down with ArrowDown', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 0);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(editor.state.selectedCell.row).toBe(1);
    });

    test('should move left with ArrowLeft', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 1);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(editor.state.selectedCell.col).toBe(0);
    });

    test('should move right with ArrowRight', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 0);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(editor.state.selectedCell.col).toBe(1);
    });

    test('should not move above row 0', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 0);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(editor.state.selectedCell.row).toBe(0);
    });

    test('should not move below last row', () => {
      const editor = createEditorWithState();
      editor.selectCell(2, 0);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(editor.state.selectedCell.row).toBe(2);
    });

    test('should not move left of column 0', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 0);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(editor.state.selectedCell.col).toBe(0);
    });

    test('should not move right of last column', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 2);

      editor.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(editor.state.selectedCell.col).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Dirty State Tests
  // --------------------------------------------------------------------------
  describe('Dirty State', () => {
    test('should be clean initially', () => {
      const editor = createEditorWithState();

      expect(editor.state.isDirty).toBe(false);
    });

    test('should become dirty after addRow', () => {
      const editor = createEditorWithState();

      editor.addRow();

      expect(editor.state.isDirty).toBe(true);
    });

    test('should become dirty after deleteRow', () => {
      const editor = createEditorWithState();
      editor.selectCell(0, 0);

      editor.deleteRow();

      expect(editor.state.isDirty).toBe(true);
    });

    test('should detect changes with checkDirty', () => {
      const editor = createEditorWithState();
      editor.state.workingRows[0][0] = 'modified';

      editor.checkDirty();

      expect(editor.state.isDirty).toBe(true);
    });

    test('should not be dirty when rows match saved', () => {
      const editor = createEditorWithState();

      editor.checkDirty();

      expect(editor.state.isDirty).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Row/Column Operations Tests
  // --------------------------------------------------------------------------
  describe('Row/Column Operations', () => {
    test('should add row at the end', () => {
      const editor = createEditorWithState();
      const initialCount = editor.state.workingRows.length;

      editor.addRow();

      expect(editor.state.workingRows.length).toBe(initialCount + 1);
    });

    test('should add row with empty cells matching column count', () => {
      const editor = createEditorWithState();
      const colCount = editor.state.data.headers.length;

      editor.addRow();

      const newRow = editor.state.workingRows[editor.state.workingRows.length - 1];
      expect(newRow.length).toBe(colCount);
      expect(newRow.every(c => c === '')).toBe(true);
    });

    test('should delete selected row', () => {
      const editor = createEditorWithState();
      editor.selectCell(1, 0);
      const initialCount = editor.state.workingRows.length;

      editor.deleteRow();

      expect(editor.state.workingRows.length).toBe(initialCount - 1);
    });

    test('should not delete when no row selected', () => {
      const editor = createEditorWithState();
      editor.state.selectedCell = null;
      const initialCount = editor.state.workingRows.length;

      editor.deleteRow();

      expect(editor.state.workingRows.length).toBe(initialCount);
    });

    test('should check virtual scroll threshold', () => {
      const editor = createEditorWithState();

      expect(editor.shouldUseVirtualScroll()).toBe(false);

      // Add enough rows to exceed threshold
      editor.state.workingRows = new Array(1500).fill(['a', 'b', 'c']);
      expect(editor.shouldUseVirtualScroll()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Premium Feature Tests
  // --------------------------------------------------------------------------
  describe('Premium Features', () => {
    test('should set isPremium true when schema loaded', async () => {
      setupInvokeMock({ schema: mockSchema });
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      await editor.loadData();

      expect(editor.state.isPremium).toBe(true);
    });

    test('should set isPremium false when no schema', async () => {
      setupInvokeMock({ schema: null });
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      await editor.loadData();

      expect(editor.state.isPremium).toBe(false);
    });

    test('should set isPremium false when schema is readOnly', async () => {
      const readOnlySchema = { ...mockSchema, readOnly: true };
      setupInvokeMock({ schema: readOnlySchema });
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      await editor.loadData();

      expect(editor.state.isPremium).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Virtual Scroll Tests
  // --------------------------------------------------------------------------
  describe('Virtual Scrolling', () => {
    test('should calculate visible range correctly', () => {
      const editor = createEditorWithState();
      editor.state.workingRows = new Array(2000).fill(['a', 'b', 'c']);

      const range = editor.calculateVisibleRange(320, 600);

      // At scrollTop=320 with rowHeight=32: startRow=10
      // With containerHeight=600 and rowHeight=32: ~19 visible rows
      expect(range.start).toBeLessThanOrEqual(10);
      expect(range.end).toBeGreaterThan(10);
    });

    test('should add buffer rows to visible range', () => {
      const editor = createEditorWithState();
      editor.state.workingRows = new Array(2000).fill(['a', 'b', 'c']);

      const range = editor.calculateVisibleRange(640, 320);

      // With buffer of 20, start should be less than raw calculated start
      expect(range.start).toBeLessThanOrEqual(20 - editor.BUFFER_ROWS);
    });
  });

  // --------------------------------------------------------------------------
  // Helper Method Tests
  // --------------------------------------------------------------------------
  describe('Helper Methods', () => {
    test('should escape HTML correctly', () => {
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      const escaped = editor.escapeHtml('<script>alert("xss")</script>');

      // escapeHtml escapes < > but may not escape quotes
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&lt;/script&gt;');
    });

    test('should get sample values for column', () => {
      const editor = createEditorWithState();

      const samples = editor.getSampleValues(1, 3);

      expect(samples).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    test('should get data type badge', () => {
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      const badge = editor.getDataTypeBadge({ type: 'integer' });

      expect(badge.className).toBe('type-number');
      expect(badge.label).toBe('Integer');
    });

    test('should get semantic role badge', () => {
      const editor = new CsvEditor('test.csv', null, 'pane-1');

      const badge = editor.getSemanticRoleBadge({ role: 'identifier' });

      expect(badge.value).toBe('identifier');
      expect(badge.label).toBe('Identifier');
    });
  });
});

// ============================================================================
// Manual Testing Notes
// ============================================================================
/**
 * MANUAL TESTING CHECKLIST:
 *
 * Cell Selection:
 * - [ ] Click on a cell selects it with visual highlight
 * - [ ] Clicking another cell moves selection
 * - [ ] Shift+click creates multi-cell selection
 *
 * Cell Editing:
 * - [ ] Double-click opens CodeMirror editor
 * - [ ] Enter commits changes
 * - [ ] Escape cancels changes
 * - [ ] Tab commits and moves to next cell
 *
 * Keyboard Navigation:
 * - [ ] Arrow keys move selection
 * - [ ] Tab wraps to next row
 * - [ ] Shift+Tab wraps to previous row
 *
 * Row/Column Operations:
 * - [ ] Add Row button adds row at end
 * - [ ] Delete Row button removes selected row
 * - [ ] Add Column prompts for name
 *
 * Premium Features:
 * - [ ] Schema button shows lock icon for free users
 * - [ ] AI Context button shows lock icon for free users
 * - [ ] Premium users see Pro badge
 *
 * KNOWN ISSUES:
 * - renderTable method shadowing at line 3877 breaks mount() tests
 */
