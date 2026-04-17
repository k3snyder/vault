/**
 * RelatedNotesSidebar - Premium-gated sidebar showing related documents
 * Displays documents grouped by relationship type (similar, referenced, temporal, co-accessed)
 */
import PremiumGate from './PremiumGate.js';

export default class RelatedNotesSidebar {
  constructor(entitlementManager, pacasdbClient = null) {
    this.entitlementManager = entitlementManager;
    this.pacasdbClient = pacasdbClient;
    this.element = null;
    this.contentContainer = null;
    this.currentDocId = null;
    this.isCollapsed = false;
    this.onNoteClick = null; // Callback for when user clicks related note

    // Restore collapsed state from localStorage
    const savedState = localStorage.getItem('relatedNotesSidebarCollapsed');
    if (savedState === 'true') {
      this.isCollapsed = true;
    }
  }

  /**
   * Render the sidebar
   * @returns {HTMLElement}
   */
  render() {
    if (this.element) {
      return this.element;
    }

    // Check premium access first
    const gate = PremiumGate.wrap(this.entitlementManager, 'Related Notes');
    if (gate) {
      this.element = gate.render();
      return this.element;
    }

    // Premium enabled - show sidebar
    const container = document.createElement('div');
    container.className = 'related-notes-sidebar';

    if (this.isCollapsed) {
      container.classList.add('collapsed');
    }

    // Header with toggle button
    const header = document.createElement('div');
    header.className = 'sidebar-header';

    const title = document.createElement('h3');
    title.textContent = 'Related Notes';
    header.appendChild(title);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-sidebar-btn';
    toggleBtn.textContent = this.isCollapsed ? '▶' : '◀';
    toggleBtn.addEventListener('click', () => this.toggleCollapse());
    header.appendChild(toggleBtn);

    container.appendChild(header);

    // Content container
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'sidebar-content';
    container.appendChild(this.contentContainer);

    this.element = container;
    return container;
  }

  /**
   * Handle note change - fetch and display related documents
   * @param {string} docId - Document ID
   * @returns {Promise<void>}
   */
  async onNoteChange(docId) {
    if (!this.pacasdbClient) {
      return;
    }

    this.currentDocId = docId;

    try {
      const results = await this.pacasdbClient.getRelatedDocuments(docId);
      this.renderRelatedNotes(results);
    } catch (error) {
      console.error('Failed to fetch related documents:', error);
    }
  }

  /**
   * Render related notes grouped by relationship type
   * @param {Object} results - Related documents results
   */
  renderRelatedNotes(results) {
    if (!this.contentContainer) {
      return;
    }

    this.contentContainer.innerHTML = '';

    if (!results.related || results.related.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No related notes found';
      this.contentContainer.appendChild(emptyState);
      return;
    }

    // Group by relationship type
    const groups = {
      similar: [],
      referenced: [],
      temporal: [],
      co_accessed: []
    };

    results.related.forEach(item => {
      const type = item.relationship_type;
      if (groups[type]) {
        groups[type].push(item);
      }
    });

    // Render each group
    Object.entries(groups).forEach(([type, items]) => {
      if (items.length > 0) {
        this.renderRelationshipGroup(type, items);
      }
    });
  }

  /**
   * Render a group of related notes by relationship type
   * @param {string} type - Relationship type
   * @param {Array} items - Related note items
   */
  renderRelationshipGroup(type, items) {
    const group = document.createElement('div');
    group.className = `relationship-group ${type}`;

    // Group header
    const header = document.createElement('div');
    header.className = 'group-header';
    header.textContent = this.formatRelationshipType(type);
    group.appendChild(header);

    // Group items
    items.forEach(item => {
      const noteItem = document.createElement('div');
      noteItem.className = 'related-note-item';
      noteItem.dataset.docId = item.id;

      const noteTitle = document.createElement('div');
      noteTitle.className = 'note-title';
      noteTitle.textContent = item.title;
      noteItem.appendChild(noteTitle);

      const strength = document.createElement('div');
      strength.className = 'relationship-strength';
      strength.textContent = item.strength.toFixed(2);
      noteItem.appendChild(strength);

      noteItem.addEventListener('click', () => {
        if (this.onNoteClick) {
          this.onNoteClick(item.id);
        }
      });

      group.appendChild(noteItem);
    });

    this.contentContainer.appendChild(group);
  }

  /**
   * Format relationship type for display
   * @param {string} type - Relationship type
   * @returns {string} Formatted label
   */
  formatRelationshipType(type) {
    const labels = {
      similar: 'Similar',
      referenced: 'Referenced',
      temporal: 'Temporal',
      co_accessed: 'Co-accessed'
    };

    return labels[type] || type;
  }

  /**
   * Toggle sidebar collapse state
   */
  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;

    if (this.element) {
      if (this.isCollapsed) {
        this.element.classList.add('collapsed');
      } else {
        this.element.classList.remove('collapsed');
      }

      // Update toggle button text
      const toggleBtn = this.element.querySelector('.toggle-sidebar-btn');
      if (toggleBtn) {
        toggleBtn.textContent = this.isCollapsed ? '▶' : '◀';
      }
    }

    // Persist state
    localStorage.setItem('relatedNotesSidebarCollapsed', this.isCollapsed.toString());
  }

  /**
   * Remove the sidebar from DOM
   */
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.contentContainer = null;
    this.currentDocId = null;
  }
}
