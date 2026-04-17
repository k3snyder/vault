/**
 * CsvEditor.js - CSV Editor Pro component
 *
 * Provides a tabular grid editor for CSV files with:
 * - Data loading from Rust backend
 * - Editable table display with headers and rows
 * - Cell selection and editing (CodeMirror integration)
 * - Dirty state tracking
 * - Premium schema support
 * - Drag-and-drop CSV import
 * - Export to JSON with schema (premium)
 * - Copy selection as markdown table
 */

import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { csvErrorHandler, CsvErrorType, getUserFriendlyMessage } from './CsvErrorHandler.js';
import EntitlementManager from '../services/entitlement-manager.js';

/**
 * CsvEditor class - Main CSV editing component
 *
 * Follows the same pattern as PDFTab for integration with TabManager.
 */
export class CsvEditor {
  /**
   * Create a CsvEditor instance
   * @param {string} filePath - Relative path to the CSV file within the vault
   * @param {Object} tabManager - Reference to TabManager for integration
   * @param {string} paneId - ID of the pane containing this editor
   */
  constructor(filePath, tabManager, paneId) {
    console.log(`Creating CSV editor for: ${filePath}`);

    // File and tab references
    this.filePath = filePath;
    this.tabManager = tabManager;
    this.paneId = paneId;

    // DOM elements
    this.container = null;
    this.toolbar = null;
    this.tableContainer = null;
    this.tableElement = null;

    // State
    this.state = {
      // Data from Rust backend
      data: null,           // CsvData { headers, rows, totalRows, truncated }
      schema: null,         // CsvSchema (premium only)

      // UI state
      selectedCell: null,   // { row: number, col: number }
      selectionStart: null, // { row: number, col: number } - anchor for multi-cell selection
      selectionEnd: null,   // { row: number, col: number } - end of multi-cell selection
      editingCell: null,    // { row: number, col: number }
      isDirty: false,
      isPremium: false,
      schemaUnsaved: false,      // True when schema is inferred but not yet saved to disk
      schemaSidebarOpen: false,  // Schema sidebar visibility

      // Working copy for edits
      workingRows: [],      // Copy of data.rows for editing
      savedRows: [],        // Snapshot for dirty comparison
      savedHeaders: [],     // Snapshot of headers for dirty comparison

      // Loading state
      isLoading: true,
      error: null
    };

    // Schema sidebar element reference
    this.schemaSidebar = null;

    // File info
    this.fileName = filePath ? filePath.split('/').pop() : 'Untitled.csv';

    // CodeMirror editor for cell editing (singleton pattern)
    this.cellEditor = null;

    // Original value before editing (for cancel operation)
    this.originalEditValue = null;

    // Bound event handlers for cleanup
    this.boundKeydownHandler = null;

    // Virtual scrolling configuration
    this.VIRTUAL_SCROLL_THRESHOLD = 1000;  // Enable virtual scroll for > 1000 rows
    this.ROW_HEIGHT = 32;                   // Fixed row height in pixels
    this.BUFFER_ROWS = 20;                  // Extra rows to render above/below viewport

    // Virtual scrolling state
    this.virtualScroll = {
      enabled: false,
      scrollTop: 0,
      containerHeight: 0,
      visibleStart: 0,
      visibleEnd: 0,
      totalHeight: 0,
      rafId: null
    };

    // Bound scroll handler for cleanup
    this.boundScrollHandler = null;

    // Entitlement manager for premium status checks
    this.entitlementManager = null;

    // Modal state flag to prevent cell editing while modal is open
    this.inputModalOpen = false;
  }

  /**
   * Mount the editor - load data and render
   * @returns {Promise<HTMLElement>} The container element
   */
  async mount() {
    console.log('Mounting CSV editor for:', this.filePath);

    // Create main container
    this.container = document.createElement('div');
    this.container.className = 'csv-editor-container';
    this.container.id = `csv-editor-${Date.now()}`;

    // Show loading state
    this.container.innerHTML = `
      <div class="csv-loading">
        <div class="csv-loading-spinner"></div>
        <p>Loading CSV file...</p>
      </div>
    `;

    try {
      // Load data from Rust backend
      await this.loadData();

      // Render the editor UI
      this.render();

      // Set up event handlers
      this.setupEventHandlers();

      console.log('CSV editor mounted successfully');
    } catch (error) {
      // Get user-friendly error info
      const errorInfo = csvErrorHandler.handleError(error, {
        operation: 'Load CSV file',
        showToast: false, // We'll show inline error instead
        context: { filePath: this.filePath }
      });

      this.state.error = errorInfo.message;
      this.state.errorInfo = errorInfo; // Store full error info for detailed view
      this.renderError();
    }

    return this.container;
  }

  /**
   * Load data from Rust backend with retry logic for transient errors
   */
  async loadData() {
    console.log('Loading CSV data from:', this.filePath);
    this.state.isLoading = true;
    this.state.error = null;

    try {
      // Load CSV data via Tauri command with retry for transient errors
      // Note: Tauri v2 auto-converts camelCase JS to snake_case Rust
      const data = await csvErrorHandler.withRetry(
        () => invoke('read_csv_data', {
          path: this.filePath,
          maxRows: null // Let backend determine limit based on premium status
        }),
        { operationName: 'Load CSV data', maxRetries: 2 }
      );

      console.log('CSV data loaded:', {
        headers: data.headers.length,
        rows: data.rows.length,
        totalRows: data.totalRows,
        truncated: data.truncated
      });

      this.state.data = data;
      this.state.workingRows = data.rows.map(row => [...row]); // Deep copy
      this.state.savedRows = data.rows.map(row => [...row]);   // Snapshot
      this.state.savedHeaders = [...data.headers];             // Snapshot of headers

      // Check premium status via EntitlementManager
      if (!this.entitlementManager) {
        this.entitlementManager = new EntitlementManager();
        await this.entitlementManager.initialize();
      }
      this.state.isPremium = this.entitlementManager.isPremiumEnabled();
      console.log('CSV Editor premium status:', this.state.isPremium);

      // Try to load schema (premium feature) - graceful degradation
      if (this.state.isPremium) {
        const schema = await csvErrorHandler.withGracefulDegradation(
          () => invoke('get_csv_schema', {
            path: this.filePath,
            createIfMissing: false
          }),
          null, // Fallback to null schema
          { operationName: 'Load CSV schema', logError: false }
        );

        if (schema) {
          this.state.schema = schema;
          console.log('CSV schema loaded');
        } else {
          console.log('No schema found for this file (can be created)');
          this.state.schema = null;
        }
      } else {
        // Free user - no schema access
        this.state.schema = null;
      }

      this.state.isLoading = false;
    } catch (error) {
      // Log the error with context
      csvErrorHandler.logError(error, {
        operation: 'loadData',
        filePath: this.filePath
      });
      this.state.isLoading = false;
      throw error;
    }
  }

  /**
   * Render the complete editor UI
   */
  render() {
    // Clear container
    this.container.innerHTML = '';

    // Create toolbar
    this.toolbar = this.renderToolbar();
    this.container.appendChild(this.toolbar);

    // Add premium banner if truncated
    if (this.state.data && this.state.data.truncated) {
      const banner = this.renderTruncationBanner();
      this.container.appendChild(banner);
    }

    // Create main content area with flex layout for sidebar
    const mainContent = document.createElement('div');
    mainContent.className = 'csv-main-content';

    // Create table container with scrolling
    this.tableContainer = document.createElement('div');
    this.tableContainer.className = 'csv-table-container';

    // Check if we should use virtual scrolling for large datasets
    if (this.shouldUseVirtualScroll()) {
      console.log(`Using virtual scrolling for ${this.state.workingRows.length} rows`);
      this.tableContainer.classList.add('csv-virtual-scroll-enabled');
      this.tableElement = this.renderVirtualTable();
    } else {
      // Standard table rendering for smaller datasets
      this.virtualScroll.enabled = false;
      this.tableElement = this.renderTable();
    }
    this.tableContainer.appendChild(this.tableElement);

    mainContent.appendChild(this.tableContainer);

    // Create schema sidebar (always rendered, visibility controlled by CSS)
    this.schemaSidebar = this.renderSchemaSidebar();
    mainContent.appendChild(this.schemaSidebar);

    this.container.appendChild(mainContent);
  }

  /**
   * Render the toolbar with controls
   * @returns {HTMLElement}
   */
  renderToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'csv-toolbar editor-header';

    const rowCount = this.state.data ? this.state.data.rows.length : 0;
    const totalRows = this.state.data ? this.state.data.totalRows : 0;
    const displayCount = rowCount === totalRows
      ? `${rowCount} rows`
      : `${rowCount} of ${totalRows} rows`;

    toolbar.innerHTML = `
      <div class="editor-header-left">
        <button class="editor-control-btn csv-undo-btn" title="Undo (Cmd+Z)" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"></path>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
          </svg>
          <span>Undo</span>
        </button>
        <button class="editor-control-btn csv-redo-btn" title="Redo (Cmd+Shift+Z)" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 7v6h-6"></path>
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path>
          </svg>
          <span>Redo</span>
        </button>
        <div class="csv-toolbar-divider"></div>
        <div class="csv-add-row-dropdown">
          <button class="editor-control-btn csv-add-row-btn" title="Row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Row</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="csv-dropdown-arrow">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="csv-add-row-menu">
            <button class="csv-add-row-menu-item" data-action="above" title="Insert row above selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
              Insert Above
            </button>
            <button class="csv-add-row-menu-item" data-action="below" title="Insert row below selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              Insert Below
            </button>
            <div class="csv-add-row-menu-divider"></div>
            <button class="csv-add-row-menu-item" data-action="top" title="Add row at top of sheet">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17 11 12 6 7 11"></polyline>
                <line x1="12" y1="6" x2="12" y2="18"></line>
              </svg>
              Add to Top
            </button>
            <button class="csv-add-row-menu-item" data-action="bottom" title="Add row at bottom of sheet">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="7 13 12 18 17 13"></polyline>
                <line x1="12" y1="18" x2="12" y2="6"></line>
              </svg>
              Add to Bottom
            </button>
          </div>
        </div>
        <div class="csv-add-col-dropdown">
          <button class="editor-control-btn csv-add-col-btn" title="Column">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Column</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="csv-dropdown-arrow">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="csv-add-col-menu">
            <button class="csv-add-col-menu-item" data-action="before" title="Insert column before selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              Insert Before
            </button>
            <button class="csv-add-col-menu-item" data-action="after" title="Insert column after selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              Insert After
            </button>
          </div>
        </div>
        <button class="editor-control-btn csv-delete-row-btn" title="Row" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Row</span>
        </button>
        <button class="editor-control-btn csv-delete-col-btn" title="Column" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Column</span>
        </button>
      </div>

      <div class="editor-header-center">
        <span class="csv-filename">${this.escapeHtml(this.fileName)}</span>
        <span class="csv-row-count">${displayCount}</span>
        ${this.state.isPremium ? '<span class="csv-premium-badge">Pro</span>' : ''}
      </div>

      <div class="editor-header-right">
        <button class="editor-control-btn csv-schema-btn${this.state.isPremium ? '' : ' locked'}" title="${this.state.isPremium ? 'Toggle Schema Sidebar' : 'Schema (Premium Feature)'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          <span>Schema</span>
        </button>
        <button class="editor-control-btn csv-ai-context-btn${this.state.isPremium ? '' : ' locked'}" title="${this.state.isPremium ? 'Get AI Context' : 'AI Context (Premium Feature)'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a2 2 0 0 1 0 4h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a2 2 0 0 1 0-4h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"></path>
            <circle cx="7.5" cy="14.5" r="1.5"></circle>
            <circle cx="16.5" cy="14.5" r="1.5"></circle>
          </svg>
          <span>AI Context</span>
        </button>
        <div class="csv-export-dropdown">
          <button class="editor-control-btn csv-export-btn" title="Export options">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Export</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="csv-dropdown-arrow">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="csv-export-menu">
            <button class="csv-export-menu-item csv-export-csv-btn" title="Export as CSV">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              Export as CSV
            </button>
            <button class="csv-export-menu-item csv-export-selection-btn" title="Export selected cells as CSV">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" opacity="0.3"></rect>
              </svg>
              Export Selection
            </button>
            <button class="csv-export-menu-item csv-export-json-btn${this.state.isPremium ? '' : ' locked'}" title="${this.state.isPremium ? 'Export as JSON with schema' : 'Export JSON (Premium)'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <path d="M8 13h2"></path>
                <path d="M8 17h2"></path>
                <path d="M14 13h2"></path>
                <path d="M14 17h2"></path>
              </svg>
              Export as JSON
              ${this.state.isPremium ? '' : '<span class="csv-premium-label">Pro</span>'}
            </button>
            <div class="csv-export-menu-divider"></div>
            <button class="csv-export-menu-item csv-copy-json-btn" title="Copy data as JSON to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy as JSON
            </button>
            <button class="csv-export-menu-item csv-copy-markdown-btn" title="Copy selection as markdown table">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy as Markdown
            </button>
          </div>
        </div>
        <button class="editor-control-btn csv-save-btn" title="Save (Cmd+S)" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>Save</span>
        </button>
      </div>
    `;

    return toolbar;
  }

  /**
   * Calculate optimal column widths based on content
   * @returns {number[]} Array of column widths in pixels
   */
  calculateColumnWidths() {
    const data = this.state.data;
    if (!data || data.headers.length === 0) return [];

    const MIN_WIDTH = 80;
    const MAX_WIDTH = 300;
    const CHAR_WIDTH = 8; // Approximate width per character
    const PADDING = 24;   // Cell padding (12px * 2)

    const widths = [];

    // Calculate width for each column based on header and data content
    for (let colIndex = 0; colIndex < data.headers.length; colIndex++) {
      // Start with header length
      let maxLength = data.headers[colIndex].length;

      // Check first 100 rows for content length (performance optimization)
      const rowsToCheck = Math.min(this.state.workingRows.length, 100);
      for (let rowIndex = 0; rowIndex < rowsToCheck; rowIndex++) {
        const cellValue = this.state.workingRows[rowIndex][colIndex] || '';
        maxLength = Math.max(maxLength, cellValue.toString().length);
      }

      // Calculate width with bounds
      const calculatedWidth = (maxLength * CHAR_WIDTH) + PADDING;
      widths.push(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, calculatedWidth)));
    }

    return widths;
  }

  /**
   * Render the data table
   * @returns {HTMLElement}
   */
  renderTable() {
    const table = document.createElement('table');
    table.className = 'csv-table';

    const data = this.state.data;

    if (!data || data.headers.length === 0) {
      // Empty state
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'csv-empty-state';
      emptyDiv.innerHTML = `
        <p>No data to display</p>
        <button class="csv-add-first-row-btn">Add first row</button>
      `;
      return emptyDiv;
    }

    // Calculate column widths
    const columnWidths = this.calculateColumnWidths();

    // Create colgroup for column widths
    const colgroup = document.createElement('colgroup');

    // Row number column
    const rowNumCol = document.createElement('col');
    rowNumCol.style.width = '50px';
    rowNumCol.style.minWidth = '50px';
    colgroup.appendChild(rowNumCol);

    // Data columns with calculated widths
    columnWidths.forEach(width => {
      const col = document.createElement('col');
      col.style.width = `${width}px`;
      col.style.minWidth = `${Math.min(width, 80)}px`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    // Create header row
    const thead = document.createElement('thead');
    thead.className = 'csv-thead-sticky';
    const headerRow = document.createElement('tr');
    headerRow.className = 'csv-header-row';

    // Add row number header
    const rowNumHeader = document.createElement('th');
    rowNumHeader.className = 'csv-row-number-header';
    rowNumHeader.textContent = '#';
    rowNumHeader.title = 'Row number';
    headerRow.appendChild(rowNumHeader);

    // Add column headers with tooltips
    data.headers.forEach((header, colIndex) => {
      const th = document.createElement('th');
      th.className = 'csv-header-cell';
      th.dataset.col = colIndex;

      // Create span for text content (allows for truncation)
      const textSpan = document.createElement('span');
      textSpan.className = 'csv-header-text';
      textSpan.textContent = header;
      th.appendChild(textSpan);

      // Full header value in tooltip
      th.title = header;
      th.setAttribute('aria-label', header);
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create data rows
    const tbody = document.createElement('tbody');

    this.state.workingRows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.className = 'csv-data-row';
      tr.dataset.row = rowIndex;

      // Row number cell
      const rowNumCell = document.createElement('td');
      rowNumCell.className = 'csv-row-number';
      rowNumCell.textContent = rowIndex + 1;
      rowNumCell.title = `Row ${rowIndex + 1}`;
      tr.appendChild(rowNumCell);

      // Data cells with proper truncation and tooltips
      row.forEach((cellValue, colIndex) => {
        const td = document.createElement('td');
        td.className = 'csv-cell';
        td.dataset.row = rowIndex;
        td.dataset.col = colIndex;

        // Create span for text content (allows for truncation styling)
        const textSpan = document.createElement('span');
        textSpan.className = 'csv-cell-text';
        textSpan.textContent = cellValue;
        td.appendChild(textSpan);

        // Full value in tooltip for truncated cells
        if (cellValue && cellValue.length > 0) {
          td.title = cellValue;
          td.setAttribute('aria-label', cellValue);
        }

        // Add selection classes if this is the selected cell
        if (this.state.selectedCell &&
            this.state.selectedCell.row === rowIndex &&
            this.state.selectedCell.col === colIndex) {
          td.classList.add('csv-cell-selected');
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    return table;
  }

  /**
   * Check if virtual scrolling should be enabled based on row count
   * @returns {boolean}
   */
  shouldUseVirtualScroll() {
    return this.state.workingRows.length > this.VIRTUAL_SCROLL_THRESHOLD;
  }

  /**
   * Calculate the visible row range based on scroll position
   * @param {number} scrollTop - Current scroll position
   * @param {number} containerHeight - Height of the visible container
   * @returns {Object} { start: number, end: number }
   */
  calculateVisibleRange(scrollTop, containerHeight) {
    const totalRows = this.state.workingRows.length;

    // Calculate which rows are visible
    const startRow = Math.floor(scrollTop / this.ROW_HEIGHT);
    const visibleCount = Math.ceil(containerHeight / this.ROW_HEIGHT);
    const endRow = startRow + visibleCount;

    // Add buffer rows above and below
    const start = Math.max(0, startRow - this.BUFFER_ROWS);
    const end = Math.min(totalRows, endRow + this.BUFFER_ROWS);

    return { start, end };
  }

  /**
   * Render the virtual scrolling table structure
   * Uses a SINGLE table with sticky thead for perfect column alignment
   * @returns {HTMLElement}
   */
  renderVirtualTable() {
    const data = this.state.data;
    const totalRows = this.state.workingRows.length;

    if (!data || data.headers.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'csv-empty-state';
      emptyDiv.innerHTML = `
        <p>No data to display</p>
        <button class="csv-add-first-row-btn">Add first row</button>
      `;
      return emptyDiv;
    }

    // Calculate total height for scroll
    this.virtualScroll.totalHeight = totalRows * this.ROW_HEIGHT;
    this.virtualScroll.enabled = true;

    // Calculate column widths
    const columnWidths = this.calculateColumnWidths();
    this.virtualColumnWidths = columnWidths;
    console.log('📊 Virtual table column widths:', columnWidths);
    console.log('📊 Headers:', data.headers);

    // Create scrollable container
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'csv-virtual-scroll-container';
    this.virtualScrollContainer = scrollContainer;

    // Create SINGLE table with sticky header
    const table = document.createElement('table');
    table.className = 'csv-table csv-unified-virtual-table';
    this.virtualBodyTable = table;

    // Colgroup for consistent column widths across header and body
    const colgroup = document.createElement('colgroup');
    const rowNumCol = document.createElement('col');
    rowNumCol.style.width = '50px';
    rowNumCol.style.minWidth = '50px';
    colgroup.appendChild(rowNumCol);
    columnWidths.forEach(width => {
      const col = document.createElement('col');
      col.style.width = `${width}px`;
      col.style.minWidth = `${Math.min(width, 80)}px`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    // Sticky header (same table, uses CSS sticky)
    const thead = document.createElement('thead');
    thead.className = 'csv-thead-sticky';
    const headerRow = document.createElement('tr');
    headerRow.className = 'csv-header-row';

    const rowNumHeader = document.createElement('th');
    rowNumHeader.className = 'csv-row-number-header';
    rowNumHeader.textContent = '#';
    rowNumHeader.title = 'Row number';
    headerRow.appendChild(rowNumHeader);

    data.headers.forEach((header, colIndex) => {
      const th = document.createElement('th');
      th.className = 'csv-header-cell';
      th.dataset.col = colIndex;
      const textSpan = document.createElement('span');
      textSpan.className = 'csv-header-text';
      textSpan.textContent = header;
      th.appendChild(textSpan);
      th.title = header;
      th.setAttribute('aria-label', header);
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Table body for data rows
    const tbody = document.createElement('tbody');
    tbody.className = 'csv-virtual-tbody';
    this.virtualTbody = tbody;
    table.appendChild(tbody);

    scrollContainer.appendChild(table);

    // Initial render of visible rows
    this.updateVisibleRows();

    return scrollContainer;
  }

  /**
   * Update the visible rows based on current scroll position
   * Called on scroll and initial render
   */
  updateVisibleRows() {
    if (!this.virtualScroll.enabled || !this.virtualTbody) return;

    // Skip entirely if currently editing - don't disrupt the editor
    if (this.state.editingCell && this.cellEditor) {
      return;
    }

    const scrollTop = this.virtualScrollContainer?.scrollTop || 0;
    const containerHeight = this.virtualScrollContainer?.clientHeight || 600;

    const { start, end } = this.calculateVisibleRange(scrollTop, containerHeight);

    // Skip if range hasn't changed
    if (start === this.virtualScroll.visibleStart && end === this.virtualScroll.visibleEnd) {
      return;
    }

    this.virtualScroll.visibleStart = start;
    this.virtualScroll.visibleEnd = end;
    this.virtualScroll.scrollTop = scrollTop;
    this.virtualScroll.containerHeight = containerHeight;

    // If currently editing, save the editor DOM to reattach later
    const editingCell = this.state.editingCell;
    let editorDom = null;
    if (editingCell && this.cellEditor) {
      editorDom = this.cellEditor.dom;
      // Remove from parent before clearing, to prevent destruction
      if (editorDom.parentNode) {
        editorDom.remove();
      }
    }

    // Clear existing rows
    this.virtualTbody.innerHTML = '';

    // Create document fragment for batch DOM update
    const fragment = document.createDocumentFragment();

    // Render only visible rows
    for (let rowIndex = start; rowIndex < end; rowIndex++) {
      const row = this.state.workingRows[rowIndex];
      if (!row) continue;

      const tr = document.createElement('tr');
      tr.className = 'csv-data-row csv-virtual-row';
      tr.dataset.row = rowIndex;

      // Row number cell (width controlled by colgroup)
      const rowNumCell = document.createElement('td');
      rowNumCell.className = 'csv-row-number';
      rowNumCell.textContent = rowIndex + 1;
      rowNumCell.title = `Row ${rowIndex + 1}`;
      tr.appendChild(rowNumCell);

      // Data cells (widths controlled by colgroup)
      row.forEach((cellValue, colIndex) => {
        const td = document.createElement('td');
        td.className = 'csv-cell';
        td.dataset.row = rowIndex;
        td.dataset.col = colIndex;

        const textSpan = document.createElement('span');
        textSpan.className = 'csv-cell-text';
        textSpan.textContent = cellValue;
        td.appendChild(textSpan);

        if (cellValue && cellValue.length > 0) {
          td.title = cellValue;
          td.setAttribute('aria-label', cellValue);
        }

        // Add selection class if selected
        if (this.state.selectedCell &&
            this.state.selectedCell.row === rowIndex &&
            this.state.selectedCell.col === colIndex) {
          td.classList.add('csv-cell-selected');
        }

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    }

    this.virtualTbody.appendChild(fragment);

    // Position the body table
    if (this.virtualBodyTable) {
      this.virtualBodyTable.style.transform = `translateY(0)`;
    }

    // Reattach editor if we were editing and the cell is still visible
    if (editingCell && editorDom) {
      const { row, col } = editingCell;
      if (row >= start && row < end) {
        const cellElement = this.virtualTbody.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
        if (cellElement) {
          // Hide the text span
          const textSpan = cellElement.querySelector('.csv-cell-text');
          if (textSpan) {
            textSpan.style.display = 'none';
          }
          // Reattach editor and restore focus
          cellElement.classList.add('csv-cell-editing');
          cellElement.appendChild(editorDom);
          this.cellEditor.focus();
        }
      }
    }
  }

  /**
   * Handle scroll events for virtual scrolling
   * Uses requestAnimationFrame for smooth 60fps updates
   * @param {Event} e - Scroll event
   */
  handleVirtualScroll(e) {
    // Cancel any pending animation frame
    if (this.virtualScroll.rafId) {
      cancelAnimationFrame(this.virtualScroll.rafId);
    }

    // Schedule update on next animation frame
    this.virtualScroll.rafId = requestAnimationFrame(() => {
      this.updateVisibleRows();
    });
  }

  /**
   * Setup virtual scroll event listeners
   */
  setupVirtualScrollHandlers() {
    if (!this.virtualScrollContainer) return;

    this.boundScrollHandler = (e) => this.handleVirtualScroll(e);
    this.virtualScrollContainer.addEventListener('scroll', this.boundScrollHandler, { passive: true });

    // Initial measurement after DOM is ready
    requestAnimationFrame(() => {
      this.updateVisibleRows();
    });
  }

  /**
   * Scroll to ensure a specific row is visible (for virtual scrolling)
   * @param {number} rowIndex - The row index to scroll to
   */
  scrollToRow(rowIndex) {
    if (!this.virtualScroll.enabled || !this.virtualScrollContainer) return;

    const rowTop = rowIndex * this.ROW_HEIGHT;
    const rowBottom = rowTop + this.ROW_HEIGHT;
    const scrollTop = this.virtualScrollContainer.scrollTop;
    const containerHeight = this.virtualScrollContainer.clientHeight;

    // Check if row is already fully visible
    if (rowTop >= scrollTop && rowBottom <= scrollTop + containerHeight) {
      return;
    }

    // Scroll to show the row (centered if possible)
    const targetScroll = Math.max(0, rowTop - (containerHeight / 2) + (this.ROW_HEIGHT / 2));
    this.virtualScrollContainer.scrollTop = targetScroll;
  }

  /**
   * Render truncation banner for free users
   * @returns {HTMLElement}
   */
  renderTruncationBanner() {
    const banner = document.createElement('div');
    banner.className = 'csv-truncation-banner';
    banner.innerHTML = `
      <span class="csv-truncation-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      </span>
      <span>Showing first ${this.state.data.rows.length.toLocaleString()} of ${this.state.data.totalRows.toLocaleString()} rows.</span>
      <button class="csv-upgrade-btn">Upgrade for unlimited</button>
    `;
    return banner;
  }

  /**
   * Render the schema sidebar
   * Shows column metadata, data types, semantic roles, and sample values
   * @returns {HTMLElement}
   */
  renderSchemaSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = `csv-schema-sidebar${this.state.schemaSidebarOpen ? ' open' : ''}`;

    // Sidebar header
    const header = document.createElement('div');
    header.className = 'csv-schema-sidebar-header';
    header.innerHTML = `
      <h3>Schema</h3>
      <button class="csv-schema-close-btn" title="Close sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    sidebar.appendChild(header);

    // Close button handler
    const closeBtn = header.querySelector('.csv-schema-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleSchemaSidebar());
    }

    // Sidebar content
    const content = document.createElement('div');
    content.className = 'csv-schema-sidebar-content';

    // Check if we have a schema or if user can create one
    if (!this.state.schema && !this.state.isPremium) {
      // Free user without schema - show upsell
      content.innerHTML = this.renderSchemaUpsell();
    } else if (!this.state.schema) {
      // Premium user without schema - show infer button
      content.innerHTML = this.renderNoSchemaState();
    } else {
      // Has schema - render column cards and relationships
      content.innerHTML = this.renderSchemaColumnCards() + this.renderRelationshipsSection();
    }

    sidebar.appendChild(content);

    return sidebar;
  }

  /**
   * Render upsell content for free users
   * @returns {string} HTML string
   */
  renderSchemaUpsell() {
    return `
      <div class="csv-schema-upsell">
        <div class="csv-schema-upsell-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h4>Schema is a Premium Feature</h4>
        <p>Unlock AI-powered schema inference to understand your data better:</p>
        <ul class="csv-schema-features">
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Automatic data type detection
          </li>
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Semantic role identification
          </li>
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            AI-optimized context for chat
          </li>
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Editable column descriptions
          </li>
        </ul>
        <button class="csv-upgrade-btn">Start Free Trial</button>
      </div>
    `;
  }

  /**
   * Render no schema state for premium users
   * @returns {string} HTML string
   */
  renderNoSchemaState() {
    return `
      <div class="csv-schema-empty">
        <div class="csv-schema-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
        </div>
        <h4>No Schema</h4>
        <p>Infer schema from your data to unlock AI-powered insights and better context for chat.</p>
        <button class="csv-infer-schema-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"></path>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
          </svg>
          Infer Schema
        </button>
      </div>
    `;
  }

  /**
   * Render column cards when schema is available
   * @returns {string} HTML string
   */
  renderSchemaColumnCards() {
    const schema = this.state.schema;
    const columns = schema.columns || [];
    const isReadOnly = schema.readOnly || false;

    if (columns.length === 0) {
      return `<p class="csv-schema-empty-text">No columns in schema</p>`;
    }

    let html = '';

    // Add action buttons at top if not read-only
    if (!isReadOnly) {
      const unsavedClass = this.state.schemaUnsaved ? ' has-unsaved' : '';
      html += `
        <div class="csv-schema-actions${unsavedClass}">
          ${this.state.schemaUnsaved ? `
            <button class="csv-save-schema-btn" title="Save schema to disk">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              Save Schema
            </button>
          ` : ''}
          <button class="csv-reinfer-schema-btn" title="Re-infer schema from current data">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2v6h-6"></path>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
              <path d="M3 22v-6h6"></path>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
            </svg>
            Re-infer
          </button>
        </div>
      `;
    }

    // Render each column card
    columns.forEach((col, index) => {
      const typeBadge = this.getDataTypeBadge(col.dataType);
      const roleBadge = this.getSemanticRoleBadge(col.semanticRole);
      const sampleValues = this.getSampleValues(index, 3);
      const userEditedClass = col.userEdited ? ' user-edited' : '';

      html += `
        <div class="csv-schema-column-card${userEditedClass}" data-column-index="${index}">
          <div class="csv-schema-column-header">
            <span class="csv-schema-column-name">${this.escapeHtml(col.name)}</span>
            ${col.userEdited ? '<span class="csv-schema-edited-badge">Edited</span>' : ''}
            <span class="csv-schema-type-badge ${typeBadge.className}">${typeBadge.label}</span>
          </div>

          <div class="csv-schema-column-role">
            <label>Role:</label>
            <select class="csv-schema-role-select" data-column-index="${index}" ${isReadOnly ? 'disabled' : ''}>
              <option value="unknown" ${roleBadge.value === 'unknown' ? 'selected' : ''}>Unknown</option>
              <option value="identifier" ${roleBadge.value === 'identifier' ? 'selected' : ''}>Identifier</option>
              <option value="dimension" ${roleBadge.value === 'dimension' ? 'selected' : ''}>Dimension</option>
              <option value="measure" ${roleBadge.value === 'measure' ? 'selected' : ''}>Measure</option>
              <option value="temporal" ${roleBadge.value === 'temporal' ? 'selected' : ''}>Temporal</option>
              <option value="descriptive" ${roleBadge.value === 'descriptive' ? 'selected' : ''}>Descriptive</option>
            </select>
          </div>

          <div class="csv-schema-column-description">
            <label>Description:</label>
            <textarea
              class="csv-schema-description-input"
              data-column-index="${index}"
              placeholder="Add a description for AI context..."
              ${isReadOnly ? 'disabled' : ''}
            >${this.escapeHtml(col.description || '')}</textarea>
          </div>

          <div class="csv-schema-column-samples">
            <label>Sample values:</label>
            <div class="csv-schema-sample-values">
              ${sampleValues.map(v => `<span class="csv-schema-sample-value">${this.escapeHtml(v)}</span>`).join('')}
            </div>
          </div>
        </div>
      `;
    });

    return html;
  }

  /**
   * Get data type badge info
   * @param {Object} dataType - The DataType object from schema
   * @returns {Object} { className, label }
   */
  getDataTypeBadge(dataType) {
    if (!dataType || !dataType.type) {
      return { className: 'type-unknown', label: 'Unknown' };
    }

    const typeMap = {
      text: { className: 'type-text', label: 'Text' },
      integer: { className: 'type-number', label: 'Integer' },
      decimal: { className: 'type-number', label: 'Decimal' },
      currency: { className: 'type-currency', label: 'Currency' },
      date: { className: 'type-date', label: 'Date' },
      dateTime: { className: 'type-date', label: 'DateTime' },
      boolean: { className: 'type-boolean', label: 'Boolean' },
      percentage: { className: 'type-number', label: 'Percentage' },
      enum: { className: 'type-enum', label: 'Enum' },
    };

    return typeMap[dataType.type] || { className: 'type-unknown', label: dataType.type };
  }

  /**
   * Get semantic role badge info
   * @param {Object} semanticRole - The SemanticRole object from schema
   * @returns {Object} { value, label }
   */
  getSemanticRoleBadge(semanticRole) {
    if (!semanticRole || !semanticRole.role) {
      return { value: 'unknown', label: 'Unknown' };
    }

    const roleMap = {
      identifier: { value: 'identifier', label: 'Identifier' },
      dimension: { value: 'dimension', label: 'Dimension' },
      measure: { value: 'measure', label: 'Measure' },
      temporal: { value: 'temporal', label: 'Temporal' },
      reference: { value: 'reference', label: 'Reference' },
      descriptive: { value: 'descriptive', label: 'Descriptive' },
      unknown: { value: 'unknown', label: 'Unknown' },
    };

    return roleMap[semanticRole.role] || { value: 'unknown', label: semanticRole.role };
  }

  /**
   * Get sample values for a column
   * @param {number} colIndex - Column index
   * @param {number} count - Number of samples to get
   * @returns {string[]} Array of sample values
   */
  getSampleValues(colIndex, count = 3) {
    const rows = this.state.workingRows || [];
    const samples = [];
    const seen = new Set();

    for (let i = 0; i < rows.length && samples.length < count; i++) {
      const value = rows[i][colIndex];
      if (value && value.trim() && !seen.has(value)) {
        seen.add(value);
        samples.push(value.length > 30 ? value.substring(0, 30) + '...' : value);
      }
    }

    if (samples.length === 0) {
      samples.push('(no data)');
    }

    return samples;
  }

  /**
   * Toggle the schema sidebar open/closed
   */
  toggleSchemaSidebar() {
    // For free users, show upgrade prompt instead of opening sidebar
    if (!this.state.isPremium && !this.state.schema) {
      // Still toggle to show the upsell content
    }

    this.state.schemaSidebarOpen = !this.state.schemaSidebarOpen;

    // Update sidebar class
    if (this.schemaSidebar) {
      if (this.state.schemaSidebarOpen) {
        this.schemaSidebar.classList.add('open');
      } else {
        this.schemaSidebar.classList.remove('open');
      }
    }

    // Update button active state
    const schemaBtn = this.toolbar?.querySelector('.csv-schema-btn');
    if (schemaBtn) {
      if (this.state.schemaSidebarOpen) {
        schemaBtn.classList.add('active');
      } else {
        schemaBtn.classList.remove('active');
      }
    }

    console.log('Schema sidebar toggled:', this.state.schemaSidebarOpen);
  }

  /**
   * Infer schema from current data
   * Called when user clicks "Infer Schema" button
   */
  async inferSchema() {
    console.log('Inferring schema for:', this.filePath);
    console.log('Frontend isPremium state:', this.state.isPremium);

    // Debug: Check entitlement status before calling backend
    if (this.entitlementManager) {
      const status = this.entitlementManager.getStatus();
      console.log('EntitlementManager status:', JSON.stringify(status));
    }

    try {
      // Call Tauri command to infer schema WITHOUT saving to disk
      const schema = await invoke('infer_csv_schema', {
        path: this.filePath
      });

      console.log('Schema inferred (not yet saved):', schema);

      this.state.schema = schema;
      this.state.isPremium = true;
      this.state.schemaUnsaved = true;  // Mark as needing explicit save

      // Re-render sidebar content (will show Save Schema button)
      this.refreshSchemaSidebar();

      // Update toolbar premium badge
      this.refreshToolbar();

    } catch (error) {
      console.error('Schema inference error:', error);
      console.log('Error code:', error.code);
      console.log('Error details:', error.details);

      // Check if it's a premium required error
      const isPremiumError = error.code === 'premiumRequired' ||
        (error.message && error.message.includes('Premium'));

      if (isPremiumError) {
        // Handle premium-gated feature gracefully
        csvErrorHandler.handleError(error, {
          operation: 'Infer schema',
          showToast: true,
          context: { filePath: this.filePath, isPremiumError: true }
        });
      } else {
        // Handle other errors
        csvErrorHandler.handleError(error, {
          operation: 'Infer schema',
          showToast: true,
          context: { filePath: this.filePath }
        });
      }
    }
  }

  /**
   * Refresh the schema sidebar content
   */
  refreshSchemaSidebar() {
    if (!this.schemaSidebar) return;

    const content = this.schemaSidebar.querySelector('.csv-schema-sidebar-content');
    if (!content) return;

    // Re-render content based on current state
    if (!this.state.schema && !this.state.isPremium) {
      content.innerHTML = this.renderSchemaUpsell();
    } else if (!this.state.schema) {
      content.innerHTML = this.renderNoSchemaState();
    } else {
      content.innerHTML = this.renderSchemaColumnCards();
    }

    // Re-attach event handlers for sidebar content
    this.setupSchemaSidebarHandlers();
  }

  /**
   * Refresh the toolbar (e.g., after premium status changes)
   */
  refreshToolbar() {
    if (!this.toolbar || !this.container) return;

    const newToolbar = this.renderToolbar();
    this.container.replaceChild(newToolbar, this.toolbar);
    this.toolbar = newToolbar;

    // Re-attach toolbar event handlers
    const undoBtn = this.toolbar.querySelector('.csv-undo-btn');
    const redoBtn = this.toolbar.querySelector('.csv-redo-btn');
    const addRowBtn = this.toolbar.querySelector('.csv-add-row-btn');
    const addColBtn = this.toolbar.querySelector('.csv-add-col-btn');
    const deleteRowBtn = this.toolbar.querySelector('.csv-delete-row-btn');
    const deleteColBtn = this.toolbar.querySelector('.csv-delete-col-btn');
    const saveBtn = this.toolbar.querySelector('.csv-save-btn');
    const schemaBtn = this.toolbar.querySelector('.csv-schema-btn');
    const aiContextBtn = this.toolbar.querySelector('.csv-ai-context-btn');

    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
    this.setupAddRowDropdown();
    this.setupAddColumnDropdown();
    if (deleteRowBtn) deleteRowBtn.addEventListener('click', () => this.deleteRow());
    if (deleteColBtn) deleteColBtn.addEventListener('click', () => this.deleteColumn());
    if (saveBtn) saveBtn.addEventListener('click', () => this.save());
    if (schemaBtn) schemaBtn.addEventListener('click', () => this.toggleSchemaSidebar());
    if (aiContextBtn) aiContextBtn.addEventListener('click', () => this.openAiContextModal());

    // Re-attach export dropdown handlers
    this.setupExportDropdown();

    // Update undo/redo button states
    this.updateUndoRedoButtons();
  }

  /**
   * Set up event handlers for schema sidebar interactive elements
   */
  setupSchemaSidebarHandlers() {
    if (!this.schemaSidebar) return;

    // Start Free Trial button (for non-premium users)
    const upgradeBtn = this.schemaSidebar.querySelector('.csv-upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => this.startFreeTrial());
    }

    // Infer schema button
    const inferBtn = this.schemaSidebar.querySelector('.csv-infer-schema-btn');
    if (inferBtn) {
      inferBtn.addEventListener('click', () => this.inferSchema());
    }

    // Re-infer schema button
    const reinferBtn = this.schemaSidebar.querySelector('.csv-reinfer-schema-btn');
    if (reinferBtn) {
      reinferBtn.addEventListener('click', () => this.inferSchema());
    }

    // Save schema button (shown when schema is unsaved)
    const saveSchemaBtn = this.schemaSidebar.querySelector('.csv-save-schema-btn');
    if (saveSchemaBtn) {
      saveSchemaBtn.addEventListener('click', () => this.saveSchemaToFile());
    }

    // Description textareas - auto-save on blur
    const descriptionInputs = this.schemaSidebar.querySelectorAll('.csv-schema-description-input');
    descriptionInputs.forEach(textarea => {
      textarea.addEventListener('blur', (e) => this.handleDescriptionChange(e));
    });

    // Role dropdowns
    const roleSelects = this.schemaSidebar.querySelectorAll('.csv-schema-role-select');
    roleSelects.forEach(select => {
      select.addEventListener('change', (e) => this.handleRoleChange(e));
    });

    // Relationship handlers
    this.setupRelationshipHandlers();
  }

  /**
   * Handle description change for a column
   * @param {Event} e - Blur event from textarea
   */
  handleDescriptionChange(e) {
    const textarea = e.target;
    const colIndex = parseInt(textarea.dataset.columnIndex, 10);
    const newDescription = textarea.value.trim();

    if (!this.state.schema || isNaN(colIndex)) return;
    if (this.state.schema.readOnly) return;

    const column = this.state.schema.columns[colIndex];
    if (!column) return;

    // Only update if changed
    if (column.description !== newDescription) {
      column.description = newDescription;

      // Mark as user-edited
      column.userEdited = true;

      // Add visual indicator to the card
      const card = textarea.closest('.csv-schema-column-card');
      if (card) {
        card.classList.add('user-edited');
      }

      this.state.isDirty = true;
      this.updateSaveButtonState();
      this.updateDirtyIndicator();
      console.log(`Updated description for column ${colIndex}:`, newDescription);

      // Auto-save schema after a short delay (debounced)
      this.debouncedSaveSchema();
    }
  }

  /**
   * Handle semantic role change for a column
   * @param {Event} e - Change event from select
   */
  handleRoleChange(e) {
    const select = e.target;
    const colIndex = parseInt(select.dataset.columnIndex, 10);
    const newRole = select.value;

    if (!this.state.schema || isNaN(colIndex)) return;
    if (this.state.schema.readOnly) return;

    const column = this.state.schema.columns[colIndex];
    if (!column) return;

    // Update the semantic role
    column.semanticRole = { role: newRole };

    // Mark as user-edited
    column.userEdited = true;

    // Add visual indicator to the card
    const card = select.closest('.csv-schema-column-card');
    if (card) {
      card.classList.add('user-edited');
    }

    this.state.isDirty = true;
    this.updateSaveButtonState();
    this.updateDirtyIndicator();
    console.log(`Updated role for column ${colIndex}:`, newRole);

    // Auto-save schema after a short delay (debounced)
    this.debouncedSaveSchema();
  }

  /**
   * Debounced save schema - waits 500ms after last edit before saving
   */
  debouncedSaveSchema() {
    // Don't auto-save if schema hasn't been explicitly saved yet
    // User must click "Save Schema" button first
    if (this.state.schemaUnsaved) {
      console.log('Schema not yet saved - skipping auto-save');
      return;
    }

    // Clear any pending save
    if (this.schemaSaveTimeout) {
      clearTimeout(this.schemaSaveTimeout);
    }

    // Schedule new save
    this.schemaSaveTimeout = setTimeout(() => {
      this.saveSchema();
    }, 500);
  }

  /**
   * Explicitly save schema to disk for the first time
   * Called when user clicks "Save Schema" button
   */
  async saveSchemaToFile() {
    if (!this.state.schema || this.state.schema.readOnly) {
      console.log('Cannot save schema: no schema or read-only');
      return;
    }

    console.log('Saving schema to file for:', this.filePath);

    try {
      await invoke('save_csv_schema', {
        path: this.filePath,
        schema: this.state.schema
      });

      console.log('Schema saved to file successfully');

      // Clear unsaved flag
      this.state.schemaUnsaved = false;

      // Refresh sidebar to remove Save Schema button
      this.refreshSchemaSidebar();

    } catch (error) {
      console.error('Error saving schema:', error);
      csvErrorHandler.handleError(error, {
        operation: 'Save schema',
        showToast: true,
        context: { filePath: this.filePath }
      });
    }
  }

  /**
   * Save schema to disk via Tauri command
   * Called automatically after schema edits (only if already saved once)
   */
  async saveSchema() {
    if (!this.state.schema || this.state.schema.readOnly) {
      console.log('Cannot save schema: no schema or read-only');
      return;
    }

    console.log('Saving schema for:', this.filePath);

    try {
      // Call Tauri command to save schema
      // Note: Tauri v2 auto-converts camelCase JS to snake_case Rust
      await invoke('save_csv_schema', {
        path: this.filePath,
        schema: this.state.schema
      });

      console.log('Schema saved successfully');

      // Clear unsaved flag if it was set
      if (this.state.schemaUnsaved) {
        this.state.schemaUnsaved = false;
        this.refreshSchemaSidebar();
      }

    } catch (error) {
      console.error('Error saving schema:', error);

      // Check if it's a premium required error
      if (error.code === 'premiumRequired' || (error.message && error.message.includes('Premium'))) {
        console.warn('Schema save requires premium license');
      } else {
        // Show error notification for other errors
        console.error(`Failed to save schema: ${error.message || error}`);
      }
    }
  }

  /**
   * Render error state with user-friendly message and suggestions
   */
  renderError() {
    const errorInfo = this.state.errorInfo || {
      message: this.state.error,
      suggestions: [],
      technicalDetails: null
    };

    // Build suggestions HTML
    let suggestionsHtml = '';
    if (errorInfo.suggestions && errorInfo.suggestions.length > 0) {
      suggestionsHtml = `
        <div class="csv-error-suggestions">
          <p class="csv-error-suggestions-title">Try the following:</p>
          <ul>
            ${errorInfo.suggestions.map(s => `<li>${this.escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // Build technical details HTML (collapsed by default)
    let technicalHtml = '';
    if (errorInfo.technicalDetails) {
      technicalHtml = `
        <details class="csv-error-technical">
          <summary>Technical details</summary>
          <pre>${this.escapeHtml(errorInfo.technicalDetails)}</pre>
        </details>
      `;
    }

    this.container.innerHTML = `
      <div class="csv-error-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h3>Unable to Load CSV File</h3>
        <p class="csv-error-message">${this.escapeHtml(errorInfo.message)}</p>
        ${suggestionsHtml}
        <div class="csv-error-actions">
          <button class="csv-retry-btn csv-btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2v6h-6"></path>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
              <path d="M3 22v-6h6"></path>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
            </svg>
            Try Again
          </button>
        </div>
        ${technicalHtml}
      </div>
    `;

    // Add retry handler
    const retryBtn = this.container.querySelector('.csv-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        // Show loading state on button
        retryBtn.disabled = true;
        retryBtn.innerHTML = `
          <svg class="csv-btn-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
          </svg>
          Retrying...
        `;
        await this.mount();
      });
    }
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // Determine which element to attach cell event handlers to
    // For virtual scrolling, use the virtual body table; otherwise use the table element
    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;

    // Table cell clicks for selection
    if (cellContainer && cellContainer.tagName === 'TABLE') {
      cellContainer.addEventListener('click', (e) => {
        // Ignore clicks inside CodeMirror editor
        if (e.target.closest('.cm-editor')) {
          return;
        }

        const cell = e.target.closest('.csv-cell');
        if (cell) {
          const row = parseInt(cell.dataset.row, 10);
          const col = parseInt(cell.dataset.col, 10);

          // Shift+click for multi-cell selection
          if (e.shiftKey && this.state.selectedCell) {
            this.extendSelection(row, col);
          } else {
            this.selectCell(row, col);
          }
        }
      });

      // Double-click for editing
      cellContainer.addEventListener('dblclick', (e) => {
        // Ignore double-clicks inside CodeMirror editor
        if (e.target.closest('.cm-editor')) {
          return;
        }

        const cell = e.target.closest('.csv-cell');
        if (cell) {
          const row = parseInt(cell.dataset.row, 10);
          const col = parseInt(cell.dataset.col, 10);
          this.startEditing(row, col);
        }
      });
    }

    // Set up virtual scroll handlers if enabled
    if (this.virtualScroll.enabled) {
      this.setupVirtualScrollHandlers();
    }

    // Toolbar button handlers
    if (this.toolbar) {
      const undoBtn = this.toolbar.querySelector('.csv-undo-btn');
      const redoBtn = this.toolbar.querySelector('.csv-redo-btn');
      const addRowBtn = this.toolbar.querySelector('.csv-add-row-btn');
      const addColBtn = this.toolbar.querySelector('.csv-add-col-btn');
      const deleteRowBtn = this.toolbar.querySelector('.csv-delete-row-btn');
      const deleteColBtn = this.toolbar.querySelector('.csv-delete-col-btn');
      const saveBtn = this.toolbar.querySelector('.csv-save-btn');
      const schemaBtn = this.toolbar.querySelector('.csv-schema-btn');
      const aiContextBtn = this.toolbar.querySelector('.csv-ai-context-btn');

      if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
      if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
      this.setupAddRowDropdown();
      this.setupAddColumnDropdown();
      if (deleteRowBtn) deleteRowBtn.addEventListener('click', () => this.deleteRow());
      if (deleteColBtn) deleteColBtn.addEventListener('click', () => this.deleteColumn());
      if (saveBtn) saveBtn.addEventListener('click', () => this.save());
      if (schemaBtn) schemaBtn.addEventListener('click', () => this.toggleSchemaSidebar());
      if (aiContextBtn) aiContextBtn.addEventListener('click', () => this.openAiContextModal());

      // Export dropdown handlers
      this.setupExportDropdown();
    }

    // Keyboard navigation
    this.boundKeydownHandler = (e) => this.handleKeydown(e);
    document.addEventListener('keydown', this.boundKeydownHandler);

    // Drag-and-drop handlers
    this.setupDragAndDrop();

    // Schema sidebar handlers
    this.setupSchemaSidebarHandlers();
  }

  /**
   * Select a cell
   * @param {number} row - Row index
   * @param {number} col - Column index
   */
  selectCell(row, col) {
    // If currently editing a different cell, finish editing first
    if (this.state.editingCell &&
        (this.state.editingCell.row !== row || this.state.editingCell.col !== col)) {
      this.finishEditing();
    }

    // Determine the container to search for cells
    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;

    // Clear previous selection (single and multi)
    this.clearSelectionHighlight();

    // Update state - single cell selection also sets as anchor for potential multi-select
    this.state.selectedCell = { row, col };
    this.state.selectionStart = { row, col };
    this.state.selectionEnd = null;

    // For virtual scrolling, ensure the row is visible
    if (this.virtualScroll.enabled) {
      this.scrollToRow(row);
      // After scrolling, the visible rows may have changed, so re-render
      this.updateVisibleRows();
    }

    // Add selection to new cell (unless it's being edited)
    if (!this.state.editingCell ||
        this.state.editingCell.row !== row ||
        this.state.editingCell.col !== col) {
      const newCell = cellContainer?.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
      if (newCell) {
        newCell.classList.add('csv-cell-selected');
      }
    }

    // Update delete button state
    this.updateDeleteButtonState();

    console.log('Cell selected:', { row, col });
  }

  /**
   * Extend selection from anchor cell to specified cell (for shift+click)
   * @param {number} row - End row index
   * @param {number} col - End column index
   */
  extendSelection(row, col) {
    if (!this.state.selectionStart) {
      // No anchor set, just do normal select
      this.selectCell(row, col);
      return;
    }

    // If editing, finish first
    if (this.state.editingCell) {
      this.finishEditing();
    }

    // Clear previous selection highlight
    this.clearSelectionHighlight();

    // Set the selection end
    this.state.selectionEnd = { row, col };
    this.state.selectedCell = { row, col };

    // Highlight all cells in selection range
    this.highlightSelectionRange();

    console.log('Selection extended:', {
      start: this.state.selectionStart,
      end: this.state.selectionEnd
    });
  }

  /**
   * Get the normalized selection range (start <= end)
   * @returns {Object|null} { startRow, startCol, endRow, endCol } or null if no selection
   */
  getSelectionRange() {
    if (!this.state.selectionStart) {
      return null;
    }

    const start = this.state.selectionStart;
    const end = this.state.selectionEnd || start;

    return {
      startRow: Math.min(start.row, end.row),
      startCol: Math.min(start.col, end.col),
      endRow: Math.max(start.row, end.row),
      endCol: Math.max(start.col, end.col)
    };
  }

  /**
   * Check if selection includes multiple cells
   * @returns {boolean}
   */
  hasMultiCellSelection() {
    if (!this.state.selectionStart || !this.state.selectionEnd) {
      return false;
    }
    return this.state.selectionStart.row !== this.state.selectionEnd.row ||
           this.state.selectionStart.col !== this.state.selectionEnd.col;
  }

  /**
   * Clear all selection highlights from cells
   */
  clearSelectionHighlight() {
    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;
    if (!cellContainer) return;

    const selectedCells = cellContainer.querySelectorAll('.csv-cell-selected, .csv-cell-in-selection');
    selectedCells.forEach(cell => {
      cell.classList.remove('csv-cell-selected', 'csv-cell-in-selection');
    });
  }

  /**
   * Highlight all cells within the current selection range
   */
  highlightSelectionRange() {
    const range = this.getSelectionRange();
    if (!range) return;

    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;
    if (!cellContainer) return;

    const { startRow, startCol, endRow, endCol } = range;

    // For virtual scrolling, we may not have all rows in DOM
    // Highlight what's visible
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const cell = cellContainer.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
        if (cell) {
          // Mark cells in selection
          if (r === this.state.selectedCell?.row && c === this.state.selectedCell?.col) {
            cell.classList.add('csv-cell-selected');
          } else {
            cell.classList.add('csv-cell-in-selection');
          }
        }
      }
    }
  }

  /**
   * Start editing a cell with CodeMirror
   * Uses singleton pattern - one CodeMirror instance repositioned for each cell edit
   * @param {number} row - Row index
   * @param {number} col - Column index
   */
  startEditing(row, col) {
    // Don't start editing if a modal is open
    if (this.inputModalOpen) {
      return;
    }

    console.log('Start editing cell:', { row, col });

    // If already editing this cell, do nothing
    if (this.state.editingCell &&
        this.state.editingCell.row === row &&
        this.state.editingCell.col === col) {
      return;
    }

    // If editing a different cell, finish it first
    if (this.state.editingCell) {
      this.finishEditing();
    }

    // Determine the container to search for cells
    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;

    // For virtual scrolling, ensure the row is visible before getting element
    if (this.virtualScroll.enabled) {
      this.scrollToRow(row);
      this.updateVisibleRows();
    }

    // Get the cell element
    const cellElement = cellContainer?.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
    if (!cellElement) {
      console.error('Cell element not found for editing:', { row, col });
      return;
    }

    // Get the current cell value
    const currentValue = this.state.workingRows[row]?.[col] ?? '';

    // Store original value for cancel operation
    this.originalEditValue = currentValue;

    // Update state
    this.state.editingCell = { row, col };
    this.state.selectedCell = { row, col };

    // Remove selection styling and add editing styling
    cellElement.classList.remove('csv-cell-selected');
    cellElement.classList.add('csv-cell-editing');

    // Clear cell content (the span with text)
    const textSpan = cellElement.querySelector('.csv-cell-text');
    if (textSpan) {
      textSpan.style.display = 'none';
    }

    // Create or reuse CodeMirror editor (singleton pattern)
    if (!this.cellEditor) {
      this.cellEditor = new EditorView({
        doc: currentValue,
        extensions: this.createCellEditorExtensions(),
        parent: cellElement
      });
    } else {
      // Reposition existing editor to this cell
      cellElement.appendChild(this.cellEditor.dom);

      // Reset content for this cell
      this.cellEditor.dispatch({
        changes: {
          from: 0,
          to: this.cellEditor.state.doc.length,
          insert: currentValue
        }
      });
    }

    // Focus the editor and select all text
    this.cellEditor.focus();
    this.cellEditor.dispatch({
      selection: { anchor: 0, head: this.cellEditor.state.doc.length }
    });

    console.log('Cell editing started:', { row, col, value: currentValue });
  }

  /**
   * Create CodeMirror extensions for cell editing
   * Minimal setup optimized for single-line CSV cell editing
   * @returns {Array} Array of CodeMirror extensions
   */
  createCellEditorExtensions() {
    return [
      // History for undo/redo
      history(),
      keymap.of(historyKeymap),

      // Default keymap for basic editing
      keymap.of(defaultKeymap),

      // Custom keymap for CSV cell editing
      keymap.of([
        {
          key: 'Enter',
          run: () => {
            this.finishEditing();
            return true;
          }
        },
        {
          key: 'Escape',
          run: () => {
            this.cancelEditing();
            return true;
          }
        },
        {
          key: 'Tab',
          run: () => {
            this.finishEditingAndMoveNext();
            return true;
          }
        },
        {
          key: 'Shift-Tab',
          run: () => {
            this.finishEditingAndMovePrev();
            return true;
          }
        }
      ]),

      // Minimal theme for cell editor
      EditorView.theme({
        '&': {
          backgroundColor: 'var(--background-primary, #1e1e1e)',
          color: 'var(--text-normal, #dcddde)',
          fontSize: '13px',
          fontFamily: 'inherit'
        },
        '.cm-content': {
          padding: '6px 12px',
          caretColor: 'var(--interactive-accent, #7c3aed)'
        },
        '&.cm-focused': {
          outline: 'none'
        },
        '.cm-line': {
          padding: '0'
        },
        '.cm-cursor': {
          borderLeftColor: 'var(--interactive-accent, #7c3aed)'
        },
        '.cm-selectionBackground': {
          backgroundColor: 'var(--interactive-accent-muted, rgba(124, 58, 237, 0.3))'
        },
        '&.cm-focused .cm-selectionBackground': {
          backgroundColor: 'var(--interactive-accent-muted, rgba(124, 58, 237, 0.3))'
        }
      }),

      // Listen for document changes to track dirty state
      EditorView.updateListener.of((update) => {
        if (update.docChanged && this.state.editingCell) {
          // Mark as potentially dirty (will be confirmed on finishEditing)
          console.log('Cell content changed');
        }
      })
    ];
  }

  /**
   * Finish editing and save the value
   */
  finishEditing() {
    if (!this.state.editingCell || !this.cellEditor) {
      return;
    }

    const { row, col } = this.state.editingCell;
    const newValue = this.cellEditor.state.doc.toString();
    const oldValue = this.originalEditValue;

    console.log('Finishing edit:', { row, col, oldValue, newValue });

    // Update the working data if value changed
    if (newValue !== oldValue) {
      // Save state for undo BEFORE making the change
      this.saveUndoState();

      if (this.state.workingRows[row]) {
        this.state.workingRows[row][col] = newValue;
      }
      // Check if dirty state changed
      this.checkDirty();
    }

    // Clean up the editing state
    this.cleanupEditing(row, col, newValue);
  }

  /**
   * Cancel editing and discard changes
   */
  cancelEditing() {
    if (!this.state.editingCell || !this.cellEditor) {
      return;
    }

    const { row, col } = this.state.editingCell;
    const originalValue = this.originalEditValue;

    console.log('Canceling edit:', { row, col, restoredValue: originalValue });

    // Clean up without updating the value (restore original)
    this.cleanupEditing(row, col, originalValue);
  }

  /**
   * Clean up after editing - restore cell display and state
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @param {string} displayValue - Value to display in the cell
   */
  cleanupEditing(row, col, displayValue) {
    // Get the cell element (check both virtual and regular table)
    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;
    const cellElement = cellContainer?.querySelector(`td[data-row="${row}"][data-col="${col}"]`);

    if (cellElement) {
      // Remove editing class (don't add selected - that's handled by selectCell)
      cellElement.classList.remove('csv-cell-editing');

      // Restore text span
      const textSpan = cellElement.querySelector('.csv-cell-text');
      if (textSpan) {
        textSpan.textContent = displayValue;
        textSpan.style.display = '';
      }

      // Update tooltip
      cellElement.title = displayValue || '';

      // Remove CodeMirror DOM from cell (but keep instance for reuse)
      if (this.cellEditor && this.cellEditor.dom.parentNode === cellElement) {
        this.cellEditor.dom.remove();
      }
    }

    // Clear editing state
    this.state.editingCell = null;
    this.originalEditValue = null;

    // Focus the table container for keyboard navigation
    if (this.tableContainer) {
      this.tableContainer.focus();
    }
  }

  /**
   * Finish editing and move to next cell (Tab)
   */
  finishEditingAndMoveNext() {
    if (!this.state.editingCell) return;

    const { row, col } = this.state.editingCell;
    this.finishEditing();

    // Calculate next cell position
    const headers = this.state.data?.headers || [];
    const rows = this.state.workingRows || [];

    let nextRow = row;
    let nextCol = col + 1;

    // Wrap to next row if at end of columns
    if (nextCol >= headers.length) {
      nextCol = 0;
      nextRow = row + 1;
    }

    // Check if within bounds
    if (nextRow < rows.length) {
      this.selectCell(nextRow, nextCol);
      this.startEditing(nextRow, nextCol);
    }
  }

  /**
   * Finish editing and move to previous cell (Shift+Tab)
   */
  finishEditingAndMovePrev() {
    if (!this.state.editingCell) return;

    const { row, col } = this.state.editingCell;
    this.finishEditing();

    // Calculate previous cell position
    const headers = this.state.data?.headers || [];

    let prevRow = row;
    let prevCol = col - 1;

    // Wrap to previous row if at start of columns
    if (prevCol < 0) {
      prevCol = headers.length - 1;
      prevRow = row - 1;
    }

    // Check if within bounds
    if (prevRow >= 0) {
      this.selectCell(prevRow, prevCol);
      this.startEditing(prevRow, prevCol);
    }
  }

  /**
   * Handle keyboard events for navigation and editing
   * @param {KeyboardEvent} e
   */
  handleKeydown(e) {
    // Don't handle keydown if a modal is open
    if (this.inputModalOpen) {
      return;
    }

    // Check if we're in the CSV editor context
    if (!this.container || !document.body.contains(this.container)) {
      return;
    }

    // Save shortcut: Cmd/Ctrl + S
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      if (this.state.isDirty) {
        e.preventDefault();
        this.save();
      }
      return;
    }

    // Undo: Cmd/Ctrl + Z (when not editing - CodeMirror handles its own undo)
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      if (!this.state.editingCell) {
        e.preventDefault();
        this.undo();
      }
      return;
    }

    // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      if (!this.state.editingCell) {
        e.preventDefault();
        this.redo();
      }
      return;
    }

    // Copy: Cmd/Ctrl + C (when not editing)
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      if (!this.state.editingCell && this.state.selectedCell) {
        e.preventDefault();
        this.copySelection();
      }
      return;
    }

    // Paste: Cmd/Ctrl + V (when not editing)
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      if (!this.state.editingCell && this.state.selectedCell) {
        e.preventDefault();
        this.pasteFromClipboard();
      }
      return;
    }

    // If currently editing, let CodeMirror handle all other keys
    // (CodeMirror already handles Enter, Escape, Tab, Shift+Tab via its keymap)
    if (this.state.editingCell) {
      return;
    }

    // Navigation and editing keys only apply when not editing
    const { selectedCell } = this.state;
    const headers = this.state.data?.headers || [];
    const rows = this.state.workingRows || [];
    const numCols = headers.length;
    const numRows = rows.length;

    // No data to navigate
    if (numCols === 0 || numRows === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (selectedCell && selectedCell.row > 0) {
          this.selectCell(selectedCell.row - 1, selectedCell.col);
        } else if (!selectedCell) {
          // Select first cell if nothing selected
          this.selectCell(0, 0);
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (selectedCell && selectedCell.row < numRows - 1) {
          this.selectCell(selectedCell.row + 1, selectedCell.col);
        } else if (!selectedCell) {
          this.selectCell(0, 0);
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (selectedCell && selectedCell.col > 0) {
          this.selectCell(selectedCell.row, selectedCell.col - 1);
        } else if (!selectedCell) {
          this.selectCell(0, 0);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (selectedCell && selectedCell.col < numCols - 1) {
          this.selectCell(selectedCell.row, selectedCell.col + 1);
        } else if (!selectedCell) {
          this.selectCell(0, 0);
        }
        break;

      case 'Tab':
        e.preventDefault();
        if (selectedCell) {
          if (e.shiftKey) {
            // Shift+Tab: Move to previous cell with row wrap
            this.moveToPreviousCell(selectedCell.row, selectedCell.col);
          } else {
            // Tab: Move to next cell with row wrap
            this.moveToNextCell(selectedCell.row, selectedCell.col);
          }
        } else {
          // Select first cell if nothing selected
          this.selectCell(0, 0);
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (selectedCell) {
          this.startEditing(selectedCell.row, selectedCell.col);
        } else {
          // Select and edit first cell
          this.selectCell(0, 0);
          this.startEditing(0, 0);
        }
        break;

      case 'Delete':
      case 'Backspace':
        // Clear cell content without entering edit mode
        if (selectedCell) {
          e.preventDefault();
          this.clearCell(selectedCell.row, selectedCell.col);
        }
        break;

      default:
        // For printable characters, start editing and insert the character
        if (selectedCell && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          this.startEditingWithInitialValue(selectedCell.row, selectedCell.col, e.key);
        }
        break;
    }
  }

  /**
   * Move selection to next cell with row wrap
   * @param {number} row - Current row
   * @param {number} col - Current column
   */
  moveToNextCell(row, col) {
    const headers = this.state.data?.headers || [];
    const rows = this.state.workingRows || [];
    const numCols = headers.length;
    const numRows = rows.length;

    let nextRow = row;
    let nextCol = col + 1;

    // Wrap to next row if at end of columns
    if (nextCol >= numCols) {
      nextCol = 0;
      nextRow = row + 1;
    }

    // Check if within bounds
    if (nextRow < numRows) {
      this.selectCell(nextRow, nextCol);
    }
    // If at last cell, stay there (don't wrap to beginning)
  }

  /**
   * Move selection to previous cell with row wrap
   * @param {number} row - Current row
   * @param {number} col - Current column
   */
  moveToPreviousCell(row, col) {
    const headers = this.state.data?.headers || [];
    const numCols = headers.length;

    let prevRow = row;
    let prevCol = col - 1;

    // Wrap to previous row if at start of columns
    if (prevCol < 0) {
      prevCol = numCols - 1;
      prevRow = row - 1;
    }

    // Check if within bounds
    if (prevRow >= 0) {
      this.selectCell(prevRow, prevCol);
    }
    // If at first cell, stay there (don't wrap to end)
  }

  /**
   * Clear cell content
   * @param {number} row - Row index
   * @param {number} col - Column index
   */
  clearCell(row, col) {
    const currentValue = this.state.workingRows[row]?.[col] ?? '';

    if (currentValue !== '') {
      // Save for undo
      this.saveUndoState();

      // Clear the cell
      if (this.state.workingRows[row]) {
        this.state.workingRows[row][col] = '';
      }

      // Update the display
      const cellElement = this.tableElement?.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
      if (cellElement) {
        const textSpan = cellElement.querySelector('.csv-cell-text');
        if (textSpan) {
          textSpan.textContent = '';
        }
        cellElement.title = '';
      }

      // Check dirty state
      this.checkDirty();

      console.log('Cell cleared:', { row, col });
    }
  }

  /**
   * Copy selected cells to clipboard
   * Uses tab-separated format for Excel compatibility
   */
  async copySelection() {
    const range = this.getSelectionRange();
    if (!range) {
      console.log('No selection to copy');
      return;
    }

    const { startRow, startCol, endRow, endCol } = range;
    const rows = this.state.workingRows;

    // Build tab-separated text for clipboard
    const lines = [];
    for (let r = startRow; r <= endRow; r++) {
      const rowCells = [];
      for (let c = startCol; c <= endCol; c++) {
        const value = rows[r]?.[c] ?? '';
        rowCells.push(value);
      }
      lines.push(rowCells.join('\t'));
    }

    const clipboardText = lines.join('\n');

    try {
      await navigator.clipboard.writeText(clipboardText);
      console.log('Copied to clipboard:', {
        rows: endRow - startRow + 1,
        cols: endCol - startCol + 1,
        text: clipboardText.substring(0, 100) + (clipboardText.length > 100 ? '...' : '')
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback: use execCommand (deprecated but wider support)
      try {
        const textarea = document.createElement('textarea');
        textarea.value = clipboardText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        console.log('Copied to clipboard (fallback)');
      } catch (fallbackError) {
        console.error('Fallback copy also failed:', fallbackError);
      }
    }
  }

  /**
   * Paste from clipboard into cells starting at current selection
   * Supports tab-separated format (Excel compatibility)
   */
  async pasteFromClipboard() {
    const { selectedCell } = this.state;
    if (!selectedCell) {
      console.log('No cell selected for paste');
      return;
    }

    let clipboardText;
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (error) {
      console.error('Failed to read clipboard:', error);
      return;
    }

    if (!clipboardText || clipboardText.length === 0) {
      console.log('Clipboard is empty');
      return;
    }

    // Parse clipboard text - handle both \n and \r\n line endings
    const lines = clipboardText.split(/\r?\n/);

    // Remove trailing empty line if present (common in copied data)
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lines.length === 0) {
      return;
    }

    // Parse each line into cells (tab-separated)
    const pasteData = lines.map(line => line.split('\t'));

    // Get dimensions
    const pasteRows = pasteData.length;
    const pasteCols = Math.max(...pasteData.map(row => row.length));

    const startRow = selectedCell.row;
    const startCol = selectedCell.col;
    const numRows = this.state.workingRows.length;
    const numCols = this.state.data?.headers?.length || 0;

    // Calculate end positions (clamp to grid bounds)
    const endRow = Math.min(startRow + pasteRows - 1, numRows - 1);
    const endCol = Math.min(startCol + pasteCols - 1, numCols - 1);

    // Save state for undo
    this.saveUndoState();

    // Determine container for cell updates
    const cellContainer = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;

    // Apply paste data
    for (let r = 0; r < pasteRows && startRow + r < numRows; r++) {
      for (let c = 0; c < (pasteData[r]?.length || 0) && startCol + c < numCols; c++) {
        const targetRow = startRow + r;
        const targetCol = startCol + c;
        const newValue = pasteData[r][c] ?? '';

        // Update data
        if (this.state.workingRows[targetRow]) {
          this.state.workingRows[targetRow][targetCol] = newValue;
        }

        // Update display
        const cellElement = cellContainer?.querySelector(`td[data-row="${targetRow}"][data-col="${targetCol}"]`);
        if (cellElement) {
          const textSpan = cellElement.querySelector('.csv-cell-text');
          if (textSpan) {
            textSpan.textContent = newValue;
          }
          cellElement.title = newValue;
        }
      }
    }

    // Set selection to cover pasted range
    this.clearSelectionHighlight();
    this.state.selectionStart = { row: startRow, col: startCol };
    this.state.selectionEnd = { row: endRow, col: endCol };
    this.state.selectedCell = { row: endRow, col: endCol };
    this.highlightSelectionRange();

    // Check dirty state
    this.checkDirty();

    console.log('Pasted from clipboard:', {
      startRow,
      startCol,
      pastedRows: Math.min(pasteRows, numRows - startRow),
      pastedCols: Math.min(pasteCols, numCols - startCol)
    });
  }

  /**
   * Start editing with an initial value (for typing to replace)
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @param {string} initialValue - Initial character to insert
   */
  startEditingWithInitialValue(row, col, initialValue) {
    // Start editing normally first
    this.startEditing(row, col);

    // Then replace content with the initial value
    if (this.cellEditor) {
      this.cellEditor.dispatch({
        changes: {
          from: 0,
          to: this.cellEditor.state.doc.length,
          insert: initialValue
        },
        selection: { anchor: initialValue.length }
      });
    }
  }

  /**
   * Save current state for undo
   * Uses JSON stringify/parse for efficient deep cloning of large datasets
   */
  saveUndoState() {
    // Initialize undo stack if needed
    if (!this.undoStack) {
      this.undoStack = [];
    }
    if (!this.redoStack) {
      this.redoStack = [];
    }

    // Deep copy current working rows
    // Use JSON parse/stringify for better performance on large datasets
    const currentState = JSON.parse(JSON.stringify(this.state.workingRows));
    this.undoStack.push(currentState);

    // Clear redo stack on new action
    this.redoStack = [];

    // Limit undo history to 50 states (reduce for large datasets)
    const maxUndo = this.state.workingRows.length > 1000 ? 20 : 50;
    if (this.undoStack.length > maxUndo) {
      this.undoStack.shift();
    }

    // Update toolbar button states
    this.updateUndoRedoButtons();
  }

  /**
   * Undo last change
   */
  undo() {
    if (!this.undoStack || this.undoStack.length === 0) {
      console.log('Nothing to undo');
      return;
    }

    // Save current state to redo stack
    if (!this.redoStack) {
      this.redoStack = [];
    }
    const currentState = this.state.workingRows.map(row => [...row]);
    this.redoStack.push(currentState);

    // Restore previous state
    const previousState = this.undoStack.pop();
    this.state.workingRows = previousState;

    // Re-render table
    this.refreshTable();

    // Check dirty state
    this.checkDirty();

    // Update toolbar button states
    this.updateUndoRedoButtons();

    console.log('Undo performed');
  }

  /**
   * Redo last undone change
   */
  redo() {
    if (!this.redoStack || this.redoStack.length === 0) {
      console.log('Nothing to redo');
      return;
    }

    // Save current state to undo stack
    if (!this.undoStack) {
      this.undoStack = [];
    }
    const currentState = this.state.workingRows.map(row => [...row]);
    this.undoStack.push(currentState);

    // Restore redo state
    const redoState = this.redoStack.pop();
    this.state.workingRows = redoState;

    // Re-render table
    this.refreshTable();

    // Check dirty state
    this.checkDirty();

    // Update toolbar button states
    this.updateUndoRedoButtons();

    console.log('Redo performed');
  }

  /**
   * Clear undo/redo history (called after save)
   */
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();
    console.log('Undo/redo history cleared');
  }

  /**
   * Refresh the table display after data changes
   */
  refreshTable() {
    if (!this.tableContainer) return;

    // Store current selection
    const { selectedCell } = this.state;

    // Re-render table
    if (this.tableElement) {
      this.tableElement.remove();
    }

    // Use the appropriate render method based on current scroll mode
    if (this.virtualScroll.enabled) {
      this.tableElement = this.renderVirtualTable();
    } else {
      this.tableElement = this.renderTable();
    }
    this.tableContainer.appendChild(this.tableElement);

    // Re-attach table event handlers
    // For virtual scroll, the actual table is virtualBodyTable inside the scroll container
    const targetTable = this.virtualScroll.enabled ? this.virtualBodyTable : this.tableElement;
    if (targetTable && targetTable.tagName === 'TABLE') {
      targetTable.addEventListener('click', (e) => {
        // Ignore clicks inside CodeMirror editor
        if (e.target.closest('.cm-editor')) {
          return;
        }

        const cell = e.target.closest('.csv-cell');
        if (cell) {
          const row = parseInt(cell.dataset.row, 10);
          const col = parseInt(cell.dataset.col, 10);
          this.selectCell(row, col);
        }
      });

      targetTable.addEventListener('dblclick', (e) => {
        // Ignore double-clicks inside CodeMirror editor
        if (e.target.closest('.cm-editor')) {
          return;
        }

        const cell = e.target.closest('.csv-cell');
        if (cell) {
          const row = parseInt(cell.dataset.row, 10);
          const col = parseInt(cell.dataset.col, 10);
          this.startEditing(row, col);
        }
      });
    }

    // Restore selection if still valid
    if (selectedCell) {
      const numRows = this.state.workingRows.length;
      const numCols = this.state.data?.headers?.length || 0;
      if (selectedCell.row < numRows && selectedCell.col < numCols) {
        this.selectCell(selectedCell.row, selectedCell.col);
      }
    }
  }

  /**
   * Add a new empty row at the specified position
   * @param {string} position - 'above', 'below', 'top', or 'bottom' (default: 'bottom')
   */
  addRow(position = 'bottom') {
    console.log('Add row triggered:', position);

    // Save state for undo
    this.saveUndoState();

    // Get the number of columns from headers
    const numCols = this.state.data?.headers?.length || 0;
    if (numCols === 0) {
      console.warn('Cannot add row: no headers defined');
      return;
    }

    // Create empty row with same number of columns
    const newRow = Array(numCols).fill('');

    // Determine insert index based on position
    let insertIndex;
    const selectedRow = this.state.selectedCell?.row ?? -1;

    switch (position) {
      case 'above':
        // Insert above selected row, or at top if no selection
        insertIndex = selectedRow >= 0 ? selectedRow : 0;
        break;
      case 'below':
        // Insert below selected row, or at bottom if no selection
        insertIndex = selectedRow >= 0 ? selectedRow + 1 : this.state.workingRows.length;
        break;
      case 'top':
        insertIndex = 0;
        break;
      case 'bottom':
      default:
        insertIndex = this.state.workingRows.length;
        break;
    }

    // Insert the new row at the calculated index
    this.state.workingRows.splice(insertIndex, 0, newRow);

    // Update total row count in data
    if (this.state.data) {
      this.state.data.totalRows = this.state.workingRows.length;
    }

    // Re-render table to show new row
    this.refreshTable();

    // Update toolbar row count display
    this.updateRowCountDisplay();

    // Mark as dirty
    this.checkDirty();

    // Select the first cell of the new row
    this.selectCell(insertIndex, 0);

    console.log('Row added at index:', insertIndex);
  }

  /**
   * Add a new column with a prompted name at the specified position
   * @param {string} position - 'before' or 'after' (default: 'after')
   */
  async addColumn(position = 'after') {
    console.log('Add column triggered:', position);

    // Show input modal for column name (native prompt() doesn't work in Tauri)
    const columnName = await this.showInputModal('Add Column', 'Enter column name');

    // User cancelled or empty name
    if (columnName === null) {
      console.log('Add column cancelled by user');
      return;
    }

    const trimmedName = columnName.trim();
    if (trimmedName === '') {
      console.warn('Column name cannot be empty');
      this.showToast('Column name cannot be empty');
      return;
    }

    // Check for duplicate column names
    if (this.state.data?.headers?.includes(trimmedName)) {
      console.warn('Column name already exists:', trimmedName);
      this.showToast('A column with this name already exists');
      return;
    }

    // Save state for undo
    this.saveUndoState();

    // Determine insertion index based on position and selected cell
    let insertIndex;
    const selectedCol = this.state.selectedCell?.col;
    const headersLength = this.state.data?.headers?.length || 0;

    if (selectedCol !== undefined && selectedCol !== null) {
      // Insert relative to selected column
      if (position === 'before') {
        insertIndex = selectedCol;
      } else {
        insertIndex = selectedCol + 1;
      }
    } else {
      // No selection, add at end
      insertIndex = headersLength;
    }

    // Add header at the specified position
    if (this.state.data) {
      this.state.data.headers.splice(insertIndex, 0, trimmedName);
    }

    // Add empty value to each row at the specified position
    this.state.workingRows.forEach(row => {
      row.splice(insertIndex, 0, '');
    });

    // Note: Do NOT update savedRows or savedHeaders - they should remain as the
    // original saved state so checkDirty() can detect the column was added

    // Re-render table to show new column
    this.refreshTable();

    // Mark as dirty (new column is a change)
    this.checkDirty();

    // Select the first data cell of the new column
    if (this.state.workingRows.length > 0) {
      this.selectCell(0, insertIndex);
    }

    console.log('Column added:', trimmedName, 'at index:', insertIndex);
  }

  /**
   * Delete the currently selected row
   */
  deleteRow() {
    console.log('Delete row triggered');

    // Check if a row is selected
    if (!this.state.selectedCell) {
      console.warn('Cannot delete row: no row selected');
      return;
    }

    const rowIndex = this.state.selectedCell.row;

    // Validate row index
    if (rowIndex < 0 || rowIndex >= this.state.workingRows.length) {
      console.warn('Invalid row index:', rowIndex);
      return;
    }

    // Save state for undo
    this.saveUndoState();

    // Remove the row
    this.state.workingRows.splice(rowIndex, 1);

    // Update total row count in data
    if (this.state.data) {
      this.state.data.totalRows = this.state.workingRows.length;
    }

    // Re-render table
    this.refreshTable();

    // Update toolbar row count display
    this.updateRowCountDisplay();

    // Mark as dirty
    this.checkDirty();

    // Update selection: select same row index if it exists, otherwise previous row
    if (this.state.workingRows.length > 0) {
      const newRowIndex = Math.min(rowIndex, this.state.workingRows.length - 1);
      this.selectCell(newRowIndex, this.state.selectedCell.col);
    } else {
      // No rows left, clear selection
      this.state.selectedCell = null;
      this.updateDeleteButtonState();
    }

    console.log('Row deleted at index:', rowIndex);
  }

  /**
   * Delete the currently selected column
   */
  deleteColumn() {
    console.log('Delete column triggered');

    // Check if a column is selected
    if (!this.state.selectedCell) {
      console.warn('Cannot delete column: no column selected');
      return;
    }

    const colIndex = this.state.selectedCell.col;

    // Validate column index
    const numCols = this.state.data?.headers?.length || 0;
    if (colIndex < 0 || colIndex >= numCols) {
      console.warn('Invalid column index:', colIndex);
      return;
    }

    // Prevent deleting the last column
    if (numCols <= 1) {
      this.showToast('Cannot delete the last column');
      return;
    }

    // Save state for undo
    this.saveUndoState();

    // Remove header at the column index
    const deletedHeader = this.state.data.headers.splice(colIndex, 1)[0];

    // Remove the value at colIndex from each row
    this.state.workingRows.forEach(row => {
      row.splice(colIndex, 1);
    });

    // Re-render table
    this.refreshTable();

    // Mark as dirty
    this.checkDirty();

    // Update selection: select same column index if it exists, otherwise previous column
    if (this.state.data.headers.length > 0) {
      const newColIndex = Math.min(colIndex, this.state.data.headers.length - 1);
      this.selectCell(this.state.selectedCell.row, newColIndex);
    } else {
      // No columns left, clear selection
      this.state.selectedCell = null;
      this.updateDeleteButtonState();
    }

    console.log('Column deleted:', deletedHeader, 'at index:', colIndex);
  }

  /**
   * Update the row count display in the toolbar
   */
  updateRowCountDisplay() {
    const rowCountEl = this.toolbar?.querySelector('.csv-row-count');
    if (rowCountEl) {
      const rowCount = this.state.workingRows.length;
      const totalRows = this.state.data?.totalRows || rowCount;
      const displayCount = rowCount === totalRows
        ? `${rowCount} rows`
        : `${rowCount} of ${totalRows} rows`;
      rowCountEl.textContent = displayCount;
    }
  }

  /**
   * Save changes to disk
   * Calls save_csv_data Tauri command with retry for transient errors
   */
  async save() {
    console.log('Save triggered');

    // Nothing to save if not dirty
    if (!this.state.isDirty) {
      console.log('No changes to save');
      return;
    }

    // If currently editing a cell, finish editing first
    if (this.state.editingCell) {
      this.finishEditing();
    }

    // Show saving status
    this.showSaveStatus('saving');

    try {
      // Call Tauri command to save CSV data with retry for transient errors
      // Note: Tauri v2 auto-converts camelCase JS to snake_case Rust
      await csvErrorHandler.withRetry(
        () => invoke('save_csv_data', {
          path: this.filePath,
          headers: this.state.data.headers,
          rows: this.state.workingRows
        }),
        { operationName: 'Save CSV', maxRetries: 2, baseDelay: 500 }
      );

      console.log('CSV data saved successfully');

      // Update saved state snapshots (deep copy)
      this.state.savedRows = this.state.workingRows.map(row => [...row]);
      this.state.savedHeaders = [...this.state.data.headers];

      // Clear dirty state
      this.state.isDirty = false;
      this.updateSaveButtonState();
      this.updateDirtyIndicator();

      // Clear undo/redo history on save
      this.clearHistory();

      // Show success feedback
      this.showSaveStatus('success');

      // Clear success message after delay
      setTimeout(() => {
        this.showSaveStatus('idle');
      }, 2000);

    } catch (error) {
      // Handle error with user-friendly message
      const errorInfo = csvErrorHandler.handleError(error, {
        operation: 'Save CSV file',
        showToast: true,
        context: { filePath: this.filePath }
      });

      // Show error feedback in toolbar
      this.showSaveStatus('error', errorInfo.message);
    }
  }

  /**
   * Show save status feedback in the toolbar
   * @param {'idle' | 'saving' | 'success' | 'error'} status - Current save status
   * @param {string} [errorMessage] - Error message if status is 'error'
   */
  showSaveStatus(status, errorMessage) {
    const saveBtn = this.toolbar?.querySelector('.csv-save-btn');
    if (!saveBtn) return;

    // Remove any existing status classes
    saveBtn.classList.remove('saving', 'save-success', 'save-error');

    // Get or create the button text span
    let textSpan = saveBtn.querySelector('span');

    switch (status) {
      case 'saving':
        saveBtn.classList.add('saving');
        saveBtn.disabled = true;
        if (textSpan) textSpan.textContent = 'Saving...';
        break;

      case 'success':
        saveBtn.classList.add('save-success');
        saveBtn.disabled = true;
        if (textSpan) textSpan.textContent = 'Saved';
        break;

      case 'error':
        saveBtn.classList.add('save-error');
        saveBtn.disabled = false;
        if (textSpan) textSpan.textContent = 'Save Failed';
        // Note: Toast notification is handled by the error handler
        // Reset button text after a moment
        setTimeout(() => {
          if (textSpan) textSpan.textContent = 'Save';
          saveBtn.classList.remove('save-error');
          this.updateSaveButtonState();
        }, 3000);
        break;

      case 'idle':
      default:
        if (textSpan) textSpan.textContent = 'Save';
        this.updateSaveButtonState();
        break;
    }
  }

  /**
   * Check if there are unsaved changes and prompt for confirmation
   * Used before closing the editor
   * @returns {Promise<boolean>} True if it's safe to close, false to cancel
   */
  async confirmClose() {
    if (!this.state.isDirty) {
      return true; // No unsaved changes, safe to close
    }

    // Show confirmation dialog
    const result = confirm(
      `"${this.fileName}" has unsaved changes.\n\nDo you want to discard your changes?`
    );

    return result; // true = discard and close, false = cancel close
  }

  /**
   * Update delete button enabled state
   */
  updateDeleteButtonState() {
    const deleteRowBtn = this.toolbar?.querySelector('.csv-delete-row-btn');
    const deleteColBtn = this.toolbar?.querySelector('.csv-delete-col-btn');
    const hasSelection = !!this.state.selectedCell;

    if (deleteRowBtn) {
      deleteRowBtn.disabled = !hasSelection;
    }
    if (deleteColBtn) {
      deleteColBtn.disabled = !hasSelection;
    }
  }

  /**
   * Update save button enabled state
   */
  updateSaveButtonState() {
    const saveBtn = this.toolbar?.querySelector('.csv-save-btn');
    if (saveBtn) {
      saveBtn.disabled = !this.state.isDirty;
    }
  }

  /**
   * Check if there are unsaved changes
   */
  checkDirty() {
    // Check header changes first
    const currentHeaders = this.state.data?.headers || [];
    const savedHeaders = this.state.savedHeaders || [];

    if (currentHeaders.length !== savedHeaders.length) {
      this.state.isDirty = true;
    } else if (currentHeaders.some((h, i) => h !== savedHeaders[i])) {
      this.state.isDirty = true;
    } else if (this.state.workingRows.length !== this.state.savedRows.length) {
      // Compare working rows to saved rows
      this.state.isDirty = true;
    } else {
      this.state.isDirty = this.state.workingRows.some((row, rowIndex) => {
        const savedRow = this.state.savedRows[rowIndex];
        if (!savedRow || row.length !== savedRow.length) return true;
        return row.some((cell, colIndex) => cell !== savedRow[colIndex]);
      });
    }

    this.updateSaveButtonState();
    this.updateDirtyIndicator();
    return this.state.isDirty;
  }

  /**
   * Update the dirty indicator on the filename
   */
  updateDirtyIndicator() {
    const filenameEl = this.toolbar?.querySelector('.csv-filename');
    if (filenameEl) {
      if (this.state.isDirty) {
        filenameEl.classList.add('dirty');
      } else {
        filenameEl.classList.remove('dirty');
      }
    }
  }

  /**
   * Update undo/redo button states based on stack availability
   */
  updateUndoRedoButtons() {
    const undoBtn = this.toolbar?.querySelector('.csv-undo-btn');
    const redoBtn = this.toolbar?.querySelector('.csv-redo-btn');

    if (undoBtn) {
      const canUndo = this.undoStack && this.undoStack.length > 0;
      undoBtn.disabled = !canUndo;
      undoBtn.title = canUndo
        ? `Undo (Cmd+Z) - ${this.undoStack.length} change${this.undoStack.length > 1 ? 's' : ''} available`
        : 'Undo (Cmd+Z) - No changes to undo';
    }

    if (redoBtn) {
      const canRedo = this.redoStack && this.redoStack.length > 0;
      redoBtn.disabled = !canRedo;
      redoBtn.title = canRedo
        ? `Redo (Cmd+Shift+Z) - ${this.redoStack.length} change${this.redoStack.length > 1 ? 's' : ''} available`
        : 'Redo (Cmd+Shift+Z) - No changes to redo';
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str
   * @returns {string}
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clean up when editor is closed
   */
  unmount() {
    console.log('Unmounting CSV editor');

    // Clear any pending schema save
    if (this.schemaSaveTimeout) {
      clearTimeout(this.schemaSaveTimeout);
      this.schemaSaveTimeout = null;
    }

    // Close relationship modal if open
    this.closeRelationshipEditor();

    // Close AI context modal if open
    this.closeAiContextModal();

    // Remove keyboard handler
    if (this.boundKeydownHandler) {
      document.removeEventListener('keydown', this.boundKeydownHandler);
      this.boundKeydownHandler = null;
    }

    // Destroy CodeMirror cell editor if exists
    if (this.cellEditor) {
      this.cellEditor.destroy();
      this.cellEditor = null;
    }

    // Clear DOM
    if (this.container) {
      this.container.remove();
      this.container = null;
    }

    // Clear references
    this.toolbar = null;
    this.tableContainer = null;
    this.tableElement = null;

    console.log('CSV editor unmounted');
  }

  /**
   * Focus the editor
   */
  focus() {
    if (this.tableContainer) {
      this.tableContainer.focus();
    }
  }

  /**
   * Check if editor has unsaved changes
   * @returns {boolean}
   */
  hasUnsavedChanges() {
    return this.state.isDirty;
  }

  // ===========================================================================
  // Relationship Editor
  // ===========================================================================

  /**
   * Render the relationships section in the sidebar
   * @returns {string} HTML string
   */
  renderRelationshipsSection() {
    const schema = this.state.schema;
    const relationships = schema?.relationships || [];
    const isReadOnly = schema?.readOnly || false;

    let html = `
      <div class="csv-schema-relationships-section">
        <div class="csv-schema-relationships-header">
          <h4>Relationships</h4>
          ${!isReadOnly ? `
            <button class="csv-add-relationship-btn" title="Add relationship">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          ` : ''}
        </div>
    `;

    if (relationships.length === 0) {
      html += `
        <div class="csv-schema-relationships-empty">
          <p>No relationships defined</p>
          ${!isReadOnly ? `
            <button class="csv-add-relationship-btn-empty">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add Relationship
            </button>
          ` : ''}
        </div>
      `;
    } else {
      html += `<div class="csv-schema-relationships-list">`;
      relationships.forEach((rel, index) => {
        const cardinalityLabel = this.getCardinalityLabel(rel.cardinality);
        html += `
          <div class="csv-schema-relationship-card" data-relationship-index="${index}">
            <div class="csv-relationship-header">
              <span class="csv-relationship-name">${this.escapeHtml(rel.name || 'Unnamed')}</span>
              ${!isReadOnly ? `
                <div class="csv-relationship-actions">
                  <button class="csv-edit-relationship-btn" data-index="${index}" title="Edit relationship">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button class="csv-delete-relationship-btn" data-index="${index}" title="Delete relationship">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              ` : ''}
            </div>
            <div class="csv-relationship-details">
              <div class="csv-relationship-mapping">
                <span class="csv-relationship-local">${this.escapeHtml(rel.localColumn)}</span>
                <span class="csv-relationship-arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </span>
                <span class="csv-relationship-foreign">${this.escapeHtml(rel.foreignFile)}.${this.escapeHtml(rel.foreignColumn)}</span>
              </div>
              <span class="csv-relationship-cardinality">${cardinalityLabel}</span>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Get human-readable label for cardinality
   * @param {string} cardinality - The cardinality value
   * @returns {string} Human-readable label
   */
  getCardinalityLabel(cardinality) {
    const labels = {
      oneToOne: 'One-to-One',
      oneToMany: 'One-to-Many',
      manyToOne: 'Many-to-One',
      manyToMany: 'Many-to-Many'
    };
    return labels[cardinality] || cardinality;
  }

  /**
   * Open the relationship editor modal
   * @param {number|null} editIndex - Index of relationship to edit, or null for new
   */
  async openRelationshipEditor(editIndex = null) {
    console.log('Opening relationship editor, editIndex:', editIndex);

    // Get existing relationship if editing
    const existingRelationship = editIndex !== null
      ? this.state.schema?.relationships?.[editIndex]
      : null;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'csv-relationship-modal-overlay';

    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'csv-relationship-modal';

    modal.innerHTML = `
      <div class="csv-relationship-modal-header">
        <h3>${editIndex !== null ? 'Edit Relationship' : 'Add Relationship'}</h3>
        <button class="csv-relationship-modal-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="csv-relationship-modal-body">
        <div class="csv-relationship-form-group">
          <label for="rel-name">Relationship Name</label>
          <input type="text" id="rel-name" class="csv-relationship-input"
                 placeholder="e.g., Customer Orders"
                 value="${existingRelationship?.name || ''}">
        </div>

        <div class="csv-relationship-form-group">
          <label for="rel-local-column">Local Column</label>
          <select id="rel-local-column" class="csv-relationship-select">
            <option value="">Select column...</option>
            ${(this.state.data?.headers || []).map(header =>
              `<option value="${this.escapeHtml(header)}"
                       ${existingRelationship?.localColumn === header ? 'selected' : ''}>
                 ${this.escapeHtml(header)}
               </option>`
            ).join('')}
          </select>
        </div>

        <div class="csv-relationship-form-group">
          <label for="rel-foreign-file">Foreign File</label>
          <select id="rel-foreign-file" class="csv-relationship-select">
            <option value="">Select CSV file...</option>
            <option value="" disabled>Loading files...</option>
          </select>
        </div>

        <div class="csv-relationship-form-group">
          <label for="rel-foreign-column">Foreign Column</label>
          <select id="rel-foreign-column" class="csv-relationship-select" disabled>
            <option value="">Select foreign file first...</option>
          </select>
        </div>

        <div class="csv-relationship-form-group">
          <label for="rel-cardinality">Cardinality</label>
          <select id="rel-cardinality" class="csv-relationship-select">
            <option value="oneToOne" ${existingRelationship?.cardinality === 'oneToOne' ? 'selected' : ''}>One-to-One</option>
            <option value="oneToMany" ${existingRelationship?.cardinality === 'oneToMany' ? 'selected' : ''}>One-to-Many</option>
            <option value="manyToOne" ${existingRelationship?.cardinality === 'manyToOne' ? 'selected' : ''}>Many-to-One</option>
            <option value="manyToMany" ${existingRelationship?.cardinality === 'manyToMany' ? 'selected' : ''}>Many-to-Many</option>
          </select>
        </div>
      </div>
      <div class="csv-relationship-modal-footer">
        <button class="csv-relationship-cancel-btn">Cancel</button>
        <button class="csv-relationship-save-btn">
          ${editIndex !== null ? 'Save Changes' : 'Add Relationship'}
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Store reference for cleanup
    this.relationshipModal = overlay;
    this.relationshipEditIndex = editIndex;

    // Set up event handlers
    const closeBtn = modal.querySelector('.csv-relationship-modal-close');
    const cancelBtn = modal.querySelector('.csv-relationship-cancel-btn');
    const saveBtn = modal.querySelector('.csv-relationship-save-btn');
    const foreignFileSelect = modal.querySelector('#rel-foreign-file');
    const foreignColumnSelect = modal.querySelector('#rel-foreign-column');

    closeBtn.addEventListener('click', () => this.closeRelationshipEditor());
    cancelBtn.addEventListener('click', () => this.closeRelationshipEditor());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeRelationshipEditor();
    });

    saveBtn.addEventListener('click', () => this.saveRelationship());

    foreignFileSelect.addEventListener('change', async (e) => {
      await this.loadForeignColumns(e.target.value, foreignColumnSelect);
    });

    // Load CSV files for the foreign file dropdown
    await this.loadCsvFiles(foreignFileSelect, existingRelationship?.foreignFile);

    // If editing and has foreign file, load its columns
    if (existingRelationship?.foreignFile) {
      await this.loadForeignColumns(existingRelationship.foreignFile, foreignColumnSelect, existingRelationship.foreignColumn);
    }

    // Focus the name input
    modal.querySelector('#rel-name').focus();
  }

  /**
   * Load CSV files for the foreign file dropdown
   * @param {HTMLSelectElement} selectElement - The select element to populate
   * @param {string|null} selectedValue - Value to pre-select
   */
  async loadCsvFiles(selectElement, selectedValue = null) {
    try {
      const csvFiles = await invoke('list_csv_files');

      // Filter out current file and build options
      const options = csvFiles
        .filter(file => file.path !== this.filePath)
        .map(file => {
          const selected = file.path === selectedValue ? 'selected' : '';
          const displayName = file.name || file.path.split('/').pop();
          return `<option value="${this.escapeHtml(file.path)}" ${selected}>${this.escapeHtml(displayName)}</option>`;
        });

      selectElement.innerHTML = `
        <option value="">Select CSV file...</option>
        ${options.join('')}
      `;

      if (options.length === 0) {
        selectElement.innerHTML = `
          <option value="">No other CSV files found</option>
        `;
      }
    } catch (error) {
      console.error('Error loading CSV files:', error);
      selectElement.innerHTML = `
        <option value="">Error loading files</option>
      `;
    }
  }

  /**
   * Load columns from a foreign CSV file
   * @param {string} filePath - Path to the foreign CSV file
   * @param {HTMLSelectElement} selectElement - The select element to populate
   * @param {string|null} selectedValue - Value to pre-select
   */
  async loadForeignColumns(filePath, selectElement, selectedValue = null) {
    if (!filePath) {
      selectElement.innerHTML = `<option value="">Select foreign file first...</option>`;
      selectElement.disabled = true;
      return;
    }

    selectElement.innerHTML = `<option value="">Loading columns...</option>`;
    selectElement.disabled = true;

    try {
      // Read the foreign CSV to get its headers
      const foreignData = await invoke('read_csv_data', {
        path: filePath,
        maxRows: 1 // We only need headers
      });

      const options = foreignData.headers.map(header => {
        const selected = header === selectedValue ? 'selected' : '';
        return `<option value="${this.escapeHtml(header)}" ${selected}>${this.escapeHtml(header)}</option>`;
      });

      selectElement.innerHTML = `
        <option value="">Select column...</option>
        ${options.join('')}
      `;
      selectElement.disabled = false;

    } catch (error) {
      console.error('Error loading foreign columns:', error);
      selectElement.innerHTML = `<option value="">Error loading columns</option>`;
      selectElement.disabled = true;
    }
  }

  /**
   * Save the relationship from the modal form
   */
  async saveRelationship() {
    const modal = this.relationshipModal?.querySelector('.csv-relationship-modal');
    if (!modal) return;

    // Get form values
    const name = modal.querySelector('#rel-name').value.trim();
    const localColumn = modal.querySelector('#rel-local-column').value;
    const foreignFile = modal.querySelector('#rel-foreign-file').value;
    const foreignColumn = modal.querySelector('#rel-foreign-column').value;
    const cardinality = modal.querySelector('#rel-cardinality').value;

    // Validate
    if (!name) {
      alert('Please enter a relationship name');
      return;
    }
    if (!localColumn) {
      alert('Please select a local column');
      return;
    }
    if (!foreignFile) {
      alert('Please select a foreign file');
      return;
    }
    if (!foreignColumn) {
      alert('Please select a foreign column');
      return;
    }

    // Create relationship object
    const relationship = {
      name,
      localColumn,
      foreignFile,
      foreignColumn,
      cardinality
    };

    console.log('Saving relationship:', relationship);

    // Update schema
    if (!this.state.schema) {
      console.error('No schema available');
      return;
    }

    // Initialize relationships array if needed
    if (!this.state.schema.relationships) {
      this.state.schema.relationships = [];
    }

    if (this.relationshipEditIndex !== null) {
      // Update existing relationship
      this.state.schema.relationships[this.relationshipEditIndex] = relationship;
    } else {
      // Add new relationship
      this.state.schema.relationships.push(relationship);
    }

    // Mark as dirty and save schema
    this.state.isDirty = true;
    this.updateSaveButtonState();
    this.updateDirtyIndicator();

    // Save schema to backend
    await this.saveSchema();

    // Close modal and refresh sidebar
    this.closeRelationshipEditor();
    this.refreshSchemaSidebar();
  }

  /**
   * Delete a relationship by index
   * @param {number} index - Index of the relationship to delete
   */
  async deleteRelationship(index) {
    if (!this.state.schema?.relationships) return;

    const relationship = this.state.schema.relationships[index];
    if (!relationship) return;

    // Confirm deletion
    const confirmed = confirm(`Delete relationship "${relationship.name || 'Unnamed'}"?`);
    if (!confirmed) return;

    console.log('Deleting relationship at index:', index);

    // Remove from array
    this.state.schema.relationships.splice(index, 1);

    // Mark as dirty and save
    this.state.isDirty = true;
    this.updateSaveButtonState();
    this.updateDirtyIndicator();

    // Save schema to backend
    await this.saveSchema();

    // Refresh sidebar
    this.refreshSchemaSidebar();
  }

  /**
   * Close the relationship editor modal
   */
  closeRelationshipEditor() {
    if (this.relationshipModal) {
      this.relationshipModal.remove();
      this.relationshipModal = null;
      this.relationshipEditIndex = null;
    }
  }

  /**
   * Set up event handlers for relationship buttons in sidebar
   * Called after sidebar content is refreshed
   */
  setupRelationshipHandlers() {
    if (!this.schemaSidebar) return;

    // Add relationship buttons
    const addBtns = this.schemaSidebar.querySelectorAll('.csv-add-relationship-btn, .csv-add-relationship-btn-empty');
    addBtns.forEach(btn => {
      btn.addEventListener('click', () => this.openRelationshipEditor());
    });

    // Edit relationship buttons
    const editBtns = this.schemaSidebar.querySelectorAll('.csv-edit-relationship-btn');
    editBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index, 10);
        this.openRelationshipEditor(index);
      });
    });

    // Delete relationship buttons
    const deleteBtns = this.schemaSidebar.querySelectorAll('.csv-delete-relationship-btn');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index, 10);
        this.deleteRelationship(index);
      });
    });
  }

  // ===========================================================================
  // AI Context Modal
  // ===========================================================================

  /**
   * Open the AI Context modal
   * Fetches AI-ready context from the backend and displays it with markdown preview
   */
  async openAiContextModal() {
    console.log('Opening AI context modal for:', this.filePath);

    // Check premium status
    if (!this.state.isPremium) {
      this.showPremiumRequiredAlert('AI Context');
      return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'csv-ai-context-modal-overlay';

    // Create modal content with loading state
    const modal = document.createElement('div');
    modal.className = 'csv-ai-context-modal';

    modal.innerHTML = `
      <div class="csv-ai-context-modal-header">
        <h3>AI Context</h3>
        <button class="csv-ai-context-modal-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="csv-ai-context-modal-body">
        <div class="csv-ai-context-loading">
          <div class="csv-loading-spinner"></div>
          <p>Generating AI context...</p>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Store reference for cleanup
    this.aiContextModal = overlay;

    // Set up close handlers
    const closeBtn = modal.querySelector('.csv-ai-context-modal-close');
    closeBtn.addEventListener('click', () => this.closeAiContextModal());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeAiContextModal();
    });

    // Escape key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        this.closeAiContextModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
    this.aiContextEscHandler = escHandler;

    // Fetch AI context from backend with retry for transient errors
    try {
      const aiContext = await csvErrorHandler.withRetry(
        () => invoke('get_csv_ai_context', {
          path: this.filePath,
          maxSampleRows: 10
        }),
        { operationName: 'Generate AI context', maxRetries: 2 }
      );

      console.log('AI context received:', aiContext);

      // Update modal with content
      this.renderAiContextContent(modal, aiContext);
    } catch (error) {
      // Log with context
      csvErrorHandler.logError(error, {
        operation: 'generateAiContext',
        filePath: this.filePath
      });
      this.renderAiContextError(modal, error);
    }
  }

  /**
   * Render the AI context content in the modal
   * @param {HTMLElement} modal - The modal element
   * @param {Object} aiContext - The AI context data from backend
   */
  renderAiContextContent(modal, aiContext) {
    const body = modal.querySelector('.csv-ai-context-modal-body');

    // Generate full markdown content
    const markdownContent = this.generateAiContextMarkdown(aiContext);

    // Generate JSON content from aiContext
    const jsonContent = this.generateAiContextJson(aiContext);

    body.innerHTML = `
      <div class="csv-ai-context-tabs">
        <button class="csv-ai-context-tab active" data-tab="preview">Preview</button>
        <button class="csv-ai-context-tab" data-tab="markdown">Markdown</button>
        <button class="csv-ai-context-tab" data-tab="json">JSON</button>
      </div>
      <div class="csv-ai-context-content">
        <div class="csv-ai-context-panel active" data-panel="preview">
          <div class="csv-ai-context-preview">
            ${this.renderMarkdownPreview(markdownContent)}
          </div>
        </div>
        <div class="csv-ai-context-panel" data-panel="markdown">
          <div class="csv-ai-context-markdown-container">
            <pre class="csv-ai-context-markdown">${this.escapeHtml(markdownContent)}</pre>
          </div>
        </div>
        <div class="csv-ai-context-panel" data-panel="json">
          <div class="csv-ai-context-markdown-container">
            <pre class="csv-ai-context-markdown csv-ai-context-json">${this.escapeHtml(jsonContent)}</pre>
          </div>
        </div>
      </div>
      <div class="csv-ai-context-modal-footer">
        <div class="csv-ai-context-copy-dropdown">
          <button class="csv-ai-context-copy-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy as Markdown
          </button>
          <button class="csv-ai-context-copy-dropdown-toggle" title="Copy format options">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="csv-ai-context-copy-menu">
            <button class="csv-ai-context-copy-option" data-format="markdown">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              Copy as Markdown
            </button>
            <button class="csv-ai-context-copy-option" data-format="json">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 18l6-6-6-6"></path>
                <path d="M8 6l-6 6 6 6"></path>
              </svg>
              Copy as JSON
            </button>
          </div>
        </div>
      </div>
    `;

    // Store content for copy operations
    this.aiContextMarkdown = markdownContent;
    this.aiContextJson = jsonContent;

    // Set up tab switching
    const tabs = body.querySelectorAll('.csv-ai-context-tab');
    const panels = body.querySelectorAll('.csv-ai-context-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        body.querySelector(`[data-panel="${targetTab}"]`).classList.add('active');
      });
    });

    // Set up copy dropdown
    const copyDropdown = body.querySelector('.csv-ai-context-copy-dropdown');
    const copyBtn = body.querySelector('.csv-ai-context-copy-btn');
    const dropdownToggle = body.querySelector('.csv-ai-context-copy-dropdown-toggle');
    const copyMenu = body.querySelector('.csv-ai-context-copy-menu');
    const copyOptions = body.querySelectorAll('.csv-ai-context-copy-option');

    // Track current copy format
    let currentFormat = 'markdown';

    // Toggle dropdown menu
    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      copyMenu.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!copyDropdown.contains(e.target)) {
        copyMenu.classList.remove('open');
      }
    });

    // Handle copy option selection
    copyOptions.forEach(option => {
      option.addEventListener('click', async () => {
        const format = option.dataset.format;
        currentFormat = format;
        copyMenu.classList.remove('open');

        // Update main button text
        copyBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy as ${format === 'markdown' ? 'Markdown' : 'JSON'}
        `;

        // Perform the copy
        await this.copyAiContext(format, copyBtn);
      });
    });

    // Main copy button click
    copyBtn.addEventListener('click', async () => {
      await this.copyAiContext(currentFormat, copyBtn);
    });
  }

  /**
   * Copy AI context content to clipboard
   * @param {string} format - 'markdown' or 'json'
   * @param {HTMLElement} copyBtn - The copy button element
   */
  async copyAiContext(format, copyBtn) {
    try {
      const content = format === 'markdown' ? this.aiContextMarkdown : this.aiContextJson;
      await navigator.clipboard.writeText(content);

      const formatLabel = format === 'markdown' ? 'Markdown' : 'JSON';
      copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Copied!
      `;
      copyBtn.classList.add('copied');

      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy as ${formatLabel}
        `;
        copyBtn.classList.remove('copied');
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('Failed to copy to clipboard');
    }
  }

  /**
   * Generate markdown content from AI context
   * @param {Object} aiContext - The AI context data
   * @returns {string} Formatted markdown string
   */
  generateAiContextMarkdown(aiContext) {
    let markdown = '';

    // File header
    markdown += `# CSV Context: ${aiContext.filePath}\n\n`;

    // Description
    if (aiContext.description) {
      markdown += `## Description\n\n${aiContext.description}\n\n`;
    }

    // Schema summary
    if (aiContext.schemaSummary) {
      markdown += `## Schema Summary\n\n${aiContext.schemaSummary}\n\n`;
    }

    // Columns
    if (aiContext.columns && aiContext.columns.length > 0) {
      markdown += `## Columns\n\n`;
      markdown += `| Column | Type | Role | Description |\n`;
      markdown += `|--------|------|------|-------------|\n`;

      for (const col of aiContext.columns) {
        const desc = col.description || '-';
        markdown += `| ${col.name} | ${col.dataType} | ${col.role} | ${desc} |\n`;
      }
      markdown += '\n';
    }

    // Sample data
    if (aiContext.sampleData) {
      markdown += `## Sample Data\n\n${aiContext.sampleData}\n\n`;
    }

    // Relationships
    if (aiContext.relationships && aiContext.relationships.length > 0) {
      markdown += `## Relationships\n\n`;
      for (const rel of aiContext.relationships) {
        markdown += `- **${rel.name}**: ${rel.description}\n`;
      }
      markdown += '\n';
    }

    return markdown;
  }

  /**
   * Generate JSON content from AI context
   * Creates a structured JSON object suitable for AI consumption
   * @param {Object} aiContext - The AI context data from backend
   * @returns {string} Pretty-printed JSON string
   */
  generateAiContextJson(aiContext) {
    // Build a clean JSON structure optimized for AI consumption
    const jsonObj = {
      file: aiContext.filePath,
      description: aiContext.description || null,
      schema: {
        summary: aiContext.schemaSummary || null,
        rowCount: aiContext.rowCount || null,
        columnCount: aiContext.columns?.length || 0
      },
      columns: (aiContext.columns || []).map(col => ({
        name: col.name,
        type: col.dataType,
        role: col.role,
        description: col.description || null
      })),
      sampleData: null,
      relationships: (aiContext.relationships || []).map(rel => ({
        name: rel.name,
        description: rel.description
      }))
    };

    // Parse sample data markdown table into JSON array if present
    if (aiContext.sampleData) {
      jsonObj.sampleData = this.parseSampleDataToJson(aiContext.sampleData, aiContext.columns);
    }

    return JSON.stringify(jsonObj, null, 2);
  }

  /**
   * Parse markdown table sample data into JSON array
   * @param {string} sampleData - Markdown table string
   * @param {Array} columns - Column definitions
   * @returns {Array} Array of row objects
   */
  parseSampleDataToJson(sampleData, columns) {
    try {
      const lines = sampleData.split('\n').filter(line => line.trim());
      if (lines.length < 2) return [];

      // Find header line (first line with |)
      const headerLine = lines.find(line => line.includes('|'));
      if (!headerLine) return [];

      const headers = headerLine.split('|')
        .map(h => h.trim())
        .filter(h => h && !h.match(/^[-:]+$/));

      // Find data rows (skip header and separator lines)
      const dataRows = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.startsWith('|') &&
               !trimmed.match(/^\|[-:\s|]+\|$/) &&
               line !== headerLine;
      });

      return dataRows.map(row => {
        const cells = row.split('|')
          .map(c => c.trim())
          .filter((c, i, arr) => i > 0 && i < arr.length - 1); // Remove empty first/last from split

        const obj = {};
        headers.forEach((header, idx) => {
          obj[header] = cells[idx] || '';
        });
        return obj;
      });
    } catch (e) {
      console.warn('Failed to parse sample data to JSON:', e);
      return [];
    }
  }

  /**
   * Render markdown as HTML preview
   * Simple markdown renderer for common elements
   * @param {string} markdown - The markdown content
   * @returns {string} HTML string
   */
  renderMarkdownPreview(markdown) {
    let html = this.escapeHtml(markdown);

    // Headers
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Code blocks (before inline code)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Tables
    html = this.renderMarkdownTables(html);

    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Paragraphs - wrap non-tagged content
    html = html.replace(/^([^<\n].+)$/gm, (match) => {
      // Don't wrap if it's already in a tag or is whitespace
      if (match.trim() === '' || match.startsWith('<')) return match;
      return `<p>${match}</p>`;
    });

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  /**
   * Render markdown tables to HTML
   * @param {string} html - HTML content with table markdown
   * @returns {string} HTML with rendered tables
   */
  renderMarkdownTables(html) {
    const lines = html.split('\n');
    const result = [];
    let inTable = false;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = line.startsWith('|') && line.endsWith('|');
      const isSeparator = /^\|[-:\s|]+\|$/.test(line);

      if (isTableRow && !isSeparator) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        tableRows.push(line);
      } else if (isSeparator && inTable) {
        // Skip separator line but stay in table
        continue;
      } else {
        if (inTable) {
          // End of table, render it
          result.push(this.renderMarkdownTable(tableRows));
          inTable = false;
          tableRows = [];
        }
        result.push(line);
      }
    }

    // Handle table at end of content
    if (inTable && tableRows.length > 0) {
      result.push(this.renderMarkdownTable(tableRows));
    }

    return result.join('\n');
  }

  /**
   * Render a markdown table to HTML
   * @param {string[]} rows - Array of table row strings
   * @returns {string} HTML table string
   */
  renderMarkdownTable(rows) {
    if (!rows || rows.length === 0) return '';

    let html = '<table class="csv-ai-context-table">\n';

    rows.forEach((row, index) => {
      const cells = row.split('|').filter(c => c.trim() !== '');
      const tag = index === 0 ? 'th' : 'td';
      const wrapper = index === 0 ? 'thead' : 'tbody';

      if (index === 0) html += '<thead>\n';
      if (index === 1) html += '<tbody>\n';

      html += '<tr>';
      cells.forEach(cell => {
        html += `<${tag}>${cell.trim()}</${tag}>`;
      });
      html += '</tr>\n';

      if (index === 0) html += '</thead>\n';
    });

    if (rows.length > 1) html += '</tbody>\n';
    html += '</table>';

    return html;
  }

  /**
   * Render an error message in the AI context modal with user-friendly details
   * @param {HTMLElement} modal - The modal element
   * @param {Error} error - The error that occurred
   */
  renderAiContextError(modal, error) {
    const body = modal.querySelector('.csv-ai-context-modal-body');

    // Get user-friendly error info
    const errorInfo = getUserFriendlyMessage(
      CsvErrorType.SCHEMA_ERROR,
      error
    );

    // Build suggestions HTML
    let suggestionsHtml = '';
    if (errorInfo.suggestions && errorInfo.suggestions.length > 0) {
      suggestionsHtml = `
        <ul class="csv-ai-context-error-suggestions">
          ${errorInfo.suggestions.map(s => `<li>${this.escapeHtml(s)}</li>`).join('')}
        </ul>
      `;
    }

    body.innerHTML = `
      <div class="csv-ai-context-error">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h4>Unable to Generate AI Context</h4>
        <p>${this.escapeHtml(errorInfo.message)}</p>
        ${suggestionsHtml}
        <button class="csv-ai-context-retry-btn csv-btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"></path>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
          </svg>
          Try Again
        </button>
        ${errorInfo.technicalDetails ? `
          <details class="csv-ai-context-error-details">
            <summary>Technical details</summary>
            <pre>${this.escapeHtml(errorInfo.technicalDetails)}</pre>
          </details>
        ` : ''}
      </div>
    `;

    // Set up retry button
    const retryBtn = body.querySelector('.csv-ai-context-retry-btn');
    retryBtn.addEventListener('click', () => {
      this.closeAiContextModal();
      this.openAiContextModal();
    });
  }

  /**
   * Close the AI context modal
   */
  closeAiContextModal() {
    if (this.aiContextModal) {
      this.aiContextModal.remove();
      this.aiContextModal = null;
    }
    if (this.aiContextEscHandler) {
      document.removeEventListener('keydown', this.aiContextEscHandler);
      this.aiContextEscHandler = null;
    }
  }

  /**
   * Show an input modal dialog (replaces native prompt() which doesn't work in Tauri)
   * @param {string} title - Modal title
   * @param {string} placeholder - Input placeholder text
   * @returns {Promise<string|null>} - Resolves with input value or null if cancelled
   */
  showInputModal(title, placeholder = '') {
    return new Promise((resolve) => {
      // Cancel any active cell editing first
      if (this.state.editingCell) {
        this.cancelEditing();
      }

      // Set flag to prevent cell editing while modal is open
      this.inputModalOpen = true;

      const overlay = document.createElement('div');
      overlay.className = 'csv-ai-context-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'csv-ai-context-modal csv-input-modal';

      modal.innerHTML = `
        <div class="csv-ai-context-modal-header">
          <h3>${title}</h3>
          <button class="csv-ai-context-modal-close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="csv-ai-context-modal-body">
          <input type="text" class="csv-input-modal-field" placeholder="${placeholder}" />
        </div>
        <div class="csv-ai-context-modal-footer">
          <button class="csv-input-modal-cancel">Cancel</button>
          <button class="csv-input-modal-submit">Add</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const input = modal.querySelector('.csv-input-modal-field');
      const closeBtn = modal.querySelector('.csv-ai-context-modal-close');
      const cancelBtn = modal.querySelector('.csv-input-modal-cancel');
      const submitBtn = modal.querySelector('.csv-input-modal-submit');

      const close = (value) => {
        this.inputModalOpen = false;
        overlay.remove();
        resolve(value);
      };

      closeBtn.addEventListener('click', () => close(null));
      cancelBtn.addEventListener('click', () => close(null));
      submitBtn.addEventListener('click', () => close(input.value));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });

      // Prevent clicks from propagating to the table
      modal.addEventListener('mousedown', (e) => e.stopPropagation());
      modal.addEventListener('click', (e) => e.stopPropagation());

      // Handle Enter key to submit
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // Prevent table keyboard handlers
        if (e.key === 'Enter') {
          e.preventDefault();
          close(input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        }
      });

      // Focus the input immediately
      input.focus();
    });
  }

  /**
   * Show a premium required alert for a feature
   * @param {string} featureName - Name of the premium feature
   */
  showPremiumRequiredAlert(featureName) {
    // Create a simple alert modal
    const overlay = document.createElement('div');
    overlay.className = 'csv-ai-context-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'csv-ai-context-modal csv-premium-alert';

    modal.innerHTML = `
      <div class="csv-ai-context-modal-header">
        <h3>Premium Feature</h3>
        <button class="csv-ai-context-modal-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="csv-ai-context-modal-body">
        <div class="csv-premium-alert-content">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
            <path d="M2 17l10 5 10-5"></path>
            <path d="M2 12l10 5 10-5"></path>
          </svg>
          <h4>${featureName}</h4>
          <p>${featureName} is a premium feature. Upgrade to CSV Editor Pro to unlock this and other advanced features.</p>
        </div>
      </div>
      <div class="csv-ai-context-modal-footer">
        <button class="csv-ai-context-close-btn">Close</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Set up close handlers
    const closeBtn = modal.querySelector('.csv-ai-context-modal-close');
    const footerCloseBtn = modal.querySelector('.csv-ai-context-close-btn');

    const close = () => overlay.remove();

    closeBtn.addEventListener('click', close);
    footerCloseBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /**
   * Start a free trial for premium features
   */
  async startFreeTrial() {
    try {
      if (!this.entitlementManager) {
        this.entitlementManager = new EntitlementManager();
        await this.entitlementManager.initialize();
      }

      await this.entitlementManager.startTrial();

      // Update premium status
      this.state.isPremium = this.entitlementManager.isPremiumEnabled();
      console.log('Trial started, premium status:', this.state.isPremium);

      // Re-render the editor to show premium features
      if (this.state.isPremium) {
        // Re-render toolbar to update button states (remove locked classes)
        const newToolbar = this.renderToolbar();
        this.toolbar.replaceWith(newToolbar);
        this.toolbar = newToolbar;

        // Re-attach toolbar event handlers
        const schemaBtn = this.toolbar.querySelector('.csv-schema-btn');
        const aiContextBtn = this.toolbar.querySelector('.csv-ai-context-btn');
        const saveBtn = this.toolbar.querySelector('.csv-save-btn');
        const undoBtn = this.toolbar.querySelector('.csv-undo-btn');
        const redoBtn = this.toolbar.querySelector('.csv-redo-btn');
        const addRowBtn = this.toolbar.querySelector('.csv-add-row-btn');
        const addColBtn = this.toolbar.querySelector('.csv-add-col-btn');
        const deleteRowBtn = this.toolbar.querySelector('.csv-delete-row-btn');
        const deleteColBtn = this.toolbar.querySelector('.csv-delete-col-btn');

        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
        this.setupAddRowDropdown();
        this.setupAddColumnDropdown();
        if (deleteRowBtn) deleteRowBtn.addEventListener('click', () => this.deleteRow());
        if (deleteColBtn) deleteColBtn.addEventListener('click', () => this.deleteColumn());
        if (saveBtn) saveBtn.addEventListener('click', () => this.save());
        if (schemaBtn) schemaBtn.addEventListener('click', () => this.toggleSchemaSidebar());
        if (aiContextBtn) aiContextBtn.addEventListener('click', () => this.openAiContextModal());
        this.setupExportDropdown();

        // Re-render schema sidebar
        if (this.state.schemaSidebarOpen) {
          this.refreshSchemaSidebar();
        }

        // Show success message
        this.showToast('Trial activated! You now have 30 days of premium access.');
      }
    } catch (error) {
      console.error('Failed to start trial:', error);
      this.showToast('Failed to start trial: ' + error.message);
    }
  }

  // ============================================================================
  // Export Functionality
  // ============================================================================

  /**
   * Set up the Add Row dropdown menu handlers
   */
  setupAddRowDropdown() {
    const dropdown = this.toolbar?.querySelector('.csv-add-row-dropdown');
    const addRowBtn = this.toolbar?.querySelector('.csv-add-row-btn');
    const menu = this.toolbar?.querySelector('.csv-add-row-menu');

    if (!dropdown || !addRowBtn || !menu) return;

    // Toggle dropdown on button click
    addRowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });

    // Handle menu item clicks
    const menuItems = menu.querySelectorAll('.csv-add-row-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        dropdown.classList.remove('open');
        this.addRow(action);
      });
    });
  }

  /**
   * Set up the Add Column dropdown menu handlers
   */
  setupAddColumnDropdown() {
    const dropdown = this.toolbar?.querySelector('.csv-add-col-dropdown');
    const addColBtn = this.toolbar?.querySelector('.csv-add-col-btn');
    const menu = this.toolbar?.querySelector('.csv-add-col-menu');

    if (!dropdown || !addColBtn || !menu) return;

    // Toggle dropdown on button click
    addColBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });

    // Handle menu item clicks
    const menuItems = menu.querySelectorAll('.csv-add-col-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        dropdown.classList.remove('open');
        this.addColumn(action);
      });
    });
  }

  /**
   * Set up the export dropdown menu handlers
   */
  setupExportDropdown() {
    const dropdown = this.toolbar.querySelector('.csv-export-dropdown');
    const exportBtn = this.toolbar.querySelector('.csv-export-btn');
    const menu = this.toolbar.querySelector('.csv-export-menu');

    if (!dropdown || !exportBtn || !menu) return;

    // Toggle dropdown on button click
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });

    // Export as CSV
    const exportCsvBtn = menu.querySelector('.csv-export-csv-btn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        this.exportAsCsv();
      });
    }

    // Export selection
    const exportSelectionBtn = menu.querySelector('.csv-export-selection-btn');
    if (exportSelectionBtn) {
      exportSelectionBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        this.exportSelection();
      });
    }

    // Export as JSON (premium)
    const exportJsonBtn = menu.querySelector('.csv-export-json-btn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        if (this.state.isPremium) {
          this.exportAsJson();
        } else {
          this.showPremiumRequiredAlert('Export as JSON');
        }
      });
    }

    // Copy as JSON
    const copyJsonBtn = menu.querySelector('.csv-copy-json-btn');
    if (copyJsonBtn) {
      copyJsonBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        this.copyAsJson();
      });
    }

    // Copy as markdown
    const copyMarkdownBtn = menu.querySelector('.csv-copy-markdown-btn');
    if (copyMarkdownBtn) {
      copyMarkdownBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        this.copyAsMarkdown();
      });
    }
  }

  /**
   * Export the entire CSV file
   */
  async exportAsCsv() {
    try {
      const headers = this.state.data?.headers || [];
      const rows = this.state.workingRows || [];

      if (headers.length === 0) {
        console.log('No data to export');
        return;
      }

      // Build CSV content
      const csvContent = this.buildCsvContent(headers, rows);

      // Get save path from user
      const defaultName = this.fileName.replace(/\.csv$/i, '') + '_export.csv';
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });

      if (savePath) {
        await invoke('export_to_file', { path: savePath, content: csvContent });
        console.log('CSV exported to:', savePath);
        this.showToast('Exported CSV file');
      }
    } catch (error) {
      console.error('Failed to export CSV:', error);
      csvErrorHandler.handleError(error, {
        operation: 'Export CSV',
        showToast: true
      });
    }
  }

  /**
   * Export only the selected cells/rows as CSV
   */
  async exportSelection() {
    try {
      const range = this.getSelectionRange();
      if (!range) {
        // No selection - export current row if cell is selected
        if (this.state.selectedCell) {
          const row = this.state.selectedCell.row;
          const headers = this.state.data?.headers || [];
          const rowData = [this.state.workingRows[row] || []];
          const csvContent = this.buildCsvContent(headers, rowData);

          const defaultName = this.fileName.replace(/\.csv$/i, '') + '_row.csv';
          const savePath = await save({
            defaultPath: defaultName,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
          });

          if (savePath) {
            await invoke('export_to_file', { path: savePath, content: csvContent });
            console.log('Selection exported to:', savePath);
            this.showToast('Exported selection');
          }
        } else {
          console.log('No selection to export');
        }
        return;
      }

      const { startRow, startCol, endRow, endCol } = range;
      const headers = this.state.data?.headers || [];
      const rows = this.state.workingRows || [];

      // Extract selected headers
      const selectedHeaders = headers.slice(startCol, endCol + 1);

      // Extract selected rows
      const selectedRows = [];
      for (let r = startRow; r <= endRow; r++) {
        const row = rows[r] || [];
        selectedRows.push(row.slice(startCol, endCol + 1));
      }

      const csvContent = this.buildCsvContent(selectedHeaders, selectedRows);

      const defaultName = this.fileName.replace(/\.csv$/i, '') + '_selection.csv';
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });

      if (savePath) {
        await invoke('export_to_file', { path: savePath, content: csvContent });
        console.log('Selection exported to:', savePath);
        this.showToast('Exported selection');
      }
    } catch (error) {
      console.error('Failed to export selection:', error);
      csvErrorHandler.handleError(error, {
        operation: 'Export Selection',
        showToast: true
      });
    }
  }

  /**
   * Export as JSON with schema (premium feature)
   */
  async exportAsJson() {
    try {
      const headers = this.state.data?.headers || [];
      const rows = this.state.workingRows || [];
      const schema = this.state.schema;

      if (headers.length === 0) {
        console.log('No data to export');
        return;
      }

      // Build JSON structure with schema
      const jsonExport = {
        metadata: {
          exportedAt: new Date().toISOString(),
          sourceFile: this.filePath,
          rowCount: rows.length,
          columnCount: headers.length
        },
        schema: schema ? {
          version: schema.version,
          columns: schema.columns.map(col => ({
            name: col.name,
            displayName: col.displayName,
            description: col.description,
            dataType: col.dataType,
            semanticRole: col.semanticRole
          })),
          relationships: schema.relationships || []
        } : null,
        columns: headers,
        data: rows.map(row => {
          const obj = {};
          headers.forEach((header, i) => {
            obj[header] = row[i] || '';
          });
          return obj;
        })
      };

      const jsonContent = JSON.stringify(jsonExport, null, 2);

      const defaultName = this.fileName.replace(/\.csv$/i, '') + '.json';
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (savePath) {
        await invoke('export_to_file', { path: savePath, content: jsonContent });
        console.log('JSON exported to:', savePath);
        this.showToast('Exported JSON file');
      }
    } catch (error) {
      console.error('Failed to export JSON:', error);
      csvErrorHandler.handleError(error, {
        operation: 'Export JSON',
        showToast: true
      });
    }
  }

  /**
   * Copy data as JSON to clipboard
   * Converts CSV data to array of objects with header keys
   */
  async copyAsJson() {
    try {
      const headers = this.state.data?.headers || [];
      const rows = this.state.workingRows || [];

      if (headers.length === 0) {
        console.log('No data to copy');
        return;
      }

      // Convert to array of objects
      const jsonData = rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] ?? '';
        });
        return obj;
      });

      // Format with 2-space indentation for readability
      const jsonString = JSON.stringify(jsonData, null, 2);

      await navigator.clipboard.writeText(jsonString);
      console.log('Copied JSON to clipboard');

      this.showToast(`Copied ${rows.length} rows as JSON`);
    } catch (error) {
      console.error('Failed to copy as JSON:', error);
      csvErrorHandler.handleError(error, {
        operation: 'Copy as JSON',
        showToast: true
      });
    }
  }

  /**
   * Copy selection as a markdown table
   */
  async copyAsMarkdown() {
    try {
      const range = this.getSelectionRange();
      const headers = this.state.data?.headers || [];
      const rows = this.state.workingRows || [];

      let selectedHeaders;
      let selectedRows;

      if (range) {
        const { startRow, startCol, endRow, endCol } = range;
        selectedHeaders = headers.slice(startCol, endCol + 1);
        selectedRows = [];
        for (let r = startRow; r <= endRow; r++) {
          const row = rows[r] || [];
          selectedRows.push(row.slice(startCol, endCol + 1));
        }
      } else if (this.state.selectedCell) {
        // Single cell selected - copy that row
        const row = this.state.selectedCell.row;
        selectedHeaders = headers;
        selectedRows = [rows[row] || []];
      } else {
        // No selection - copy all (up to first 100 rows for clipboard)
        selectedHeaders = headers;
        selectedRows = rows.slice(0, 100);
      }

      if (selectedHeaders.length === 0) {
        console.log('No data to copy');
        return;
      }

      // Build markdown table
      const markdown = this.buildMarkdownTable(selectedHeaders, selectedRows);

      await navigator.clipboard.writeText(markdown);
      console.log('Copied markdown table to clipboard');

      // Show brief feedback
      this.showToast('Copied as markdown table');
    } catch (error) {
      console.error('Failed to copy as markdown:', error);
    }
  }

  /**
   * Build CSV content from headers and rows
   * @param {string[]} headers - Column headers
   * @param {string[][]} rows - Data rows
   * @returns {string} CSV formatted string
   */
  buildCsvContent(headers, rows) {
    const escapeCsvField = (field) => {
      const str = String(field || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [];
    lines.push(headers.map(escapeCsvField).join(','));
    for (const row of rows) {
      lines.push(row.map(escapeCsvField).join(','));
    }
    return lines.join('\n');
  }

  /**
   * Build a markdown table from headers and rows
   * @param {string[]} headers - Column headers
   * @param {string[][]} rows - Data rows
   * @returns {string} Markdown table string
   */
  buildMarkdownTable(headers, rows) {
    // Escape pipe characters in cell content
    const escapeCell = (cell) => String(cell || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const lines = [];

    // Header row
    lines.push('| ' + headers.map(escapeCell).join(' | ') + ' |');

    // Separator row
    lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (const row of rows) {
      const cells = headers.map((_, i) => escapeCell(row[i]));
      lines.push('| ' + cells.join(' | ') + ' |');
    }

    return lines.join('\n');
  }

  /**
   * Show a brief toast notification
   * @param {string} message - Message to display
   */
  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'csv-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Remove after delay
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ============================================================================
  // Drag and Drop Import
  // ============================================================================

  /**
   * Set up drag and drop handlers for CSV import
   */
  setupDragAndDrop() {
    if (!this.container) return;

    // Create drop overlay (hidden by default)
    this.dropOverlay = document.createElement('div');
    this.dropOverlay.className = 'csv-drop-overlay';
    this.dropOverlay.innerHTML = `
      <div class="csv-drop-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <p>Drop CSV file to import</p>
      </div>
    `;
    this.container.appendChild(this.dropOverlay);

    // Drag enter - show overlay
    this.container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isDragDataCsv(e)) {
        this.dropOverlay.classList.add('active');
      }
    });

    // Drag over - allow drop
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isDragDataCsv(e)) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    // Drag leave - hide overlay
    this.container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only hide if leaving the container entirely
      if (!this.container.contains(e.relatedTarget)) {
        this.dropOverlay.classList.remove('active');
      }
    });

    // Drop - handle file
    this.container.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropOverlay.classList.remove('active');

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith('.csv')) {
          await this.importDroppedFile(file);
        }
      }
    });
  }

  /**
   * Check if drag data contains CSV files
   * @param {DragEvent} e - The drag event
   * @returns {boolean}
   */
  isDragDataCsv(e) {
    if (e.dataTransfer.types.includes('Files')) {
      // Check items if available
      if (e.dataTransfer.items) {
        for (const item of e.dataTransfer.items) {
          if (item.kind === 'file') {
            // Can't always check extension during drag, so accept all files
            return true;
          }
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Import a dropped CSV file
   * @param {File} file - The dropped file
   */
  async importDroppedFile(file) {
    try {
      console.log('Importing dropped file:', file.name);

      // Read file content
      const content = await file.text();

      // Detect delimiter
      const delimiter = this.detectDelimiter(content);
      console.log('Detected delimiter:', delimiter === '\t' ? 'TAB' : delimiter);

      // Parse CSV content
      const { headers, rows } = this.parseCsvContent(content, delimiter);

      if (headers.length === 0) {
        throw new Error('No data found in CSV file');
      }

      // Update state with imported data
      this.state.data = {
        headers,
        rows,
        totalRows: rows.length,
        truncated: false
      };
      this.state.workingRows = rows.map(row => [...row]);
      this.state.savedRows = rows.map(row => [...row]);
      this.state.savedHeaders = [...headers];
      this.state.isDirty = true; // Mark as dirty since this is new data

      // Clear any existing selection
      this.state.selectedCell = null;
      this.state.selectionStart = null;
      this.state.selectionEnd = null;
      this.state.editingCell = null;

      // Re-render the table
      this.render();
      this.setupEventHandlers();

      // Update tab name
      this.fileName = file.name;
      this.updateDirtyState();

      this.showToast(`Imported ${rows.length} rows from ${file.name}`);
    } catch (error) {
      console.error('Failed to import dropped file:', error);
      csvErrorHandler.handleError(error, {
        operation: 'Import CSV',
        showToast: true
      });
    }
  }

  /**
   * Detect the delimiter used in CSV content
   * Supports comma, tab, and semicolon
   * @param {string} content - CSV content
   * @returns {string} The detected delimiter
   */
  detectDelimiter(content) {
    // Take first few lines for analysis
    const lines = content.split('\n').slice(0, 10);
    if (lines.length === 0) return ',';

    const delimiters = [',', '\t', ';'];
    const counts = {};

    for (const delim of delimiters) {
      counts[delim] = 0;
      for (const line of lines) {
        // Count occurrences, accounting for quoted fields
        let count = 0;
        let inQuotes = false;
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === delim && !inQuotes) {
            count++;
          }
        }
        counts[delim] += count;
      }
    }

    // Find delimiter with most consistent count across lines
    let bestDelim = ',';
    let bestScore = 0;

    for (const delim of delimiters) {
      // Calculate consistency score (average count per line)
      const avgCount = counts[delim] / lines.length;
      if (avgCount > bestScore) {
        bestScore = avgCount;
        bestDelim = delim;
      }
    }

    return bestDelim;
  }

  /**
   * Parse CSV content into headers and rows
   * @param {string} content - CSV content
   * @param {string} delimiter - Field delimiter
   * @returns {{ headers: string[], rows: string[][] }}
   */
  parseCsvContent(content, delimiter = ',') {
    const lines = content.split(/\r?\n/);
    const rows = [];

    for (const line of lines) {
      if (line.trim() === '') continue;

      const row = [];
      let field = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (inQuotes) {
          if (char === '"' && nextChar === '"') {
            // Escaped quote
            field += '"';
            i++;
          } else if (char === '"') {
            // End of quoted field
            inQuotes = false;
          } else {
            field += char;
          }
        } else {
          if (char === '"') {
            // Start of quoted field
            inQuotes = true;
          } else if (char === delimiter) {
            // End of field
            row.push(field);
            field = '';
          } else {
            field += char;
          }
        }
      }
      // Don't forget the last field
      row.push(field);
      rows.push(row);
    }

    // First row is headers
    const headers = rows.length > 0 ? rows.shift() : [];

    return { headers, rows };
  }
}
