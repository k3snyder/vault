// ToolUseCard.js - Display tool use events in chat
import { icons } from '../icons/icon-utils.js';

export class ToolUseCard {
  constructor(options = {}) {
    this.id = options.id || `tool-${Date.now()}`;
    this.toolName = options.toolName || 'Unknown Tool';
    this.toolInput = options.toolInput || {};
    this.result = options.result || null;
    this.status = options.status || 'pending'; // pending, running, success, error
    this.expanded = false;
    this.element = null;

    this.createUI();
  }

  getToolIcon() {
    const toolIcons = {
      search_notes: 'search',
      get_note: 'fileText',
      get_current_note: 'file',
      list_tags: 'lightbulb',
      notes_by_tag: 'search',
      semantic_search: 'sparkles',
      write_note: 'filePlus',
      update_note: 'edit',
      append_to_note: 'filePlus',
      WebSearch: 'search',
      web_search: 'search',
      botcky_event: 'settings',
      approval_request: 'alertTriangle',
      approval_resolve: 'checkCircle',
      task_create: 'rocket',
      task_update: 'clipboardList',
      schedule_create: 'calendar',
    };

    const iconName = toolIcons[this.toolName] || 'settings';
    return this.renderIcon(iconName, { size: 14 });
  }

  getStatusIcon() {
    switch (this.status) {
      case 'running':
        return `<span class="tool-status-spinner"></span>`;
      case 'success':
        return this.renderIcon('checkCircle', { size: 14, class: 'status-success' });
      case 'error':
        return this.renderIcon('alertCircle', { size: 14, class: 'status-error' });
      default:
        return this.renderIcon('clock', { size: 14, class: 'status-pending' });
    }
  }

  renderIcon(iconName, options = {}) {
    const iconRenderer =
      typeof icons?.[iconName] === 'function'
        ? icons[iconName]
        : typeof icons?.settings === 'function'
          ? icons.settings
          : null;

    if (!iconRenderer) {
      return '';
    }

    try {
      return iconRenderer(options);
    } catch (error) {
      console.warn('[ToolUseCard] Failed to render icon:', iconName, error);
      if (iconRenderer !== icons.settings && typeof icons?.settings === 'function') {
        return icons.settings(options);
      }
      return '';
    }
  }

  formatToolName() {
    // Convert snake_case to Title Case
    return this.toolName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  formatInput() {
    if (!this.toolInput || Object.keys(this.toolInput).length === 0) {
      return '<span class="no-input">No parameters</span>';
    }

    return Object.entries(this.toolInput)
      .map(([key, value]) => {
        const displayValue = typeof value === 'string'
          ? (value.length > 100 ? value.substring(0, 100) + '...' : value)
          : JSON.stringify(value);
        return `<div class="tool-param">
          <span class="param-key">${key}:</span>
          <span class="param-value">${this.escapeHtml(displayValue)}</span>
        </div>`;
      })
      .join('');
  }

  formatResult() {
    if (!this.result) {
      return '<span class="no-result">Waiting for result...</span>';
    }

    try {
      // Try to parse if it's a JSON string
      let parsed = this.result;
      if (typeof this.result === 'string') {
        try {
          parsed = JSON.parse(this.result);
        } catch {
          // Not JSON, use as-is
        }
      }

      // Handle structured content arrays from tool responses
      if (parsed.content && Array.isArray(parsed.content)) {
        const textContent = parsed.content
          .filter(c => c.type === 'text')
          .map(c => {
            try {
              return JSON.parse(c.text);
            } catch {
              return c.text;
            }
          });
        parsed = textContent.length === 1 ? textContent[0] : textContent;
      }

      // Format based on result type
      if (parsed.error) {
        return `<span class="result-error">${this.escapeHtml(parsed.error)}</span>`;
      }

      if (parsed.results && Array.isArray(parsed.results)) {
        return `<span class="result-count">${parsed.results.length} results found</span>`;
      }

      if (parsed.success) {
        return `<span class="result-success">${this.escapeHtml(parsed.message || 'Success')}</span>`;
      }

      // Truncate long results
      const str = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
      const truncated = str.length > 200 ? str.substring(0, 200) + '...' : str;
      return `<pre class="result-json">${this.escapeHtml(truncated)}</pre>`;

    } catch (e) {
      return `<span class="result-raw">${this.escapeHtml(String(this.result).substring(0, 200))}</span>`;
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  createUI() {
    this.element = document.createElement('div');
    this.element.className = `tool-use-card status-${this.status}`;
    this.element.setAttribute('data-tool-id', this.id);

    this.render();
  }

  render() {
    this.element.innerHTML = `
      <div class="tool-card-header">
        <div class="tool-info">
          <span class="tool-icon">${this.getToolIcon()}</span>
          <span class="tool-name">${this.formatToolName()}</span>
        </div>
        <div class="tool-status">
          ${this.getStatusIcon()}
          <span class="expand-icon ${this.expanded ? 'expanded' : ''}">${this.renderIcon('chevronDown', { size: 12 })}</span>
        </div>
      </div>
      <div class="tool-card-body ${this.expanded ? 'expanded' : ''}">
        <div class="tool-section">
          <div class="section-label">Input</div>
          <div class="section-content">${this.formatInput()}</div>
        </div>
        ${this.result !== null ? `
          <div class="tool-section">
            <div class="section-label">Result</div>
            <div class="section-content">${this.formatResult()}</div>
          </div>
        ` : ''}
      </div>
    `;

    // Store reference for click handler
    this.element.toolCard = this;

    const header = this.element.querySelector('.tool-card-header');
    if (header) {
      header.addEventListener('click', () => this.toggleExpand());
    }
  }

  toggleExpand() {
    this.expanded = !this.expanded;
    this.render();
  }

  setStatus(status) {
    this.status = status;
    this.element.className = `tool-use-card status-${this.status}`;
    this.render();
  }

  setResult(result) {
    this.result = result;
    this.status = result?.error ? 'error' : 'success';
    this.element.className = `tool-use-card status-${this.status}`;
    this.render();
  }

  getElement() {
    return this.element;
  }
}
