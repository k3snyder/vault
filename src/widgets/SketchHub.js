import { invoke } from '@tauri-apps/api/core';
import { formatDistanceToNow } from 'date-fns';
import toast from '../plugin-hub/components/Toast.js';
import { icons } from '../icons/icon-utils.js';
import { buildSketchHubItems, normalizeSketchFileName } from '../utils/sketch-hub-state.js';

function formatSketchModifiedTime(timestamp) {
  if (!timestamp) {
    return 'No recent update';
  }

  try {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  } catch {
    return 'No recent update';
  }
}

export class SketchHub {
  constructor(options = {}) {
    this.options = {
      onSketchOpen: null,
      requestSketchName: null,
      ...options
    };

    this.container = null;
    this.listElement = null;
    this.countElement = null;
    this.searchInput = null;
    this.searchTimeout = null;
    this.searchQuery = '';
    this.sketches = [];

    this.handleSearchInput = this.handleSearchInput.bind(this);
    this.handleCreateSketch = this.handleCreateSketch.bind(this);
    this.handleVaultFilesChanged = this.handleVaultFilesChanged.bind(this);
    this.handleFileSaved = this.handleFileSaved.bind(this);
  }

  mount(parentElement) {
    this.container = document.createElement('div');
    this.container.className = 'sketch-hub-panel';

    const toolbar = document.createElement('div');
    toolbar.className = 'sketch-hub-toolbar';

    this.countElement = document.createElement('span');
    this.countElement.className = 'sketch-hub-count';
    this.countElement.textContent = '0 sketches';

    const controls = document.createElement('div');
    controls.className = 'sketch-hub-controls';

    const createButton = document.createElement('button');
    createButton.className = 'sketch-hub-create-btn';
    createButton.type = 'button';
    createButton.title = 'Create sketch';
    createButton.innerHTML = icons.plus({ size: 18 });
    createButton.addEventListener('click', this.handleCreateSketch);

    const searchContainer = document.createElement('div');
    searchContainer.className = 'sketch-hub-search';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'sketch-hub-search-icon';
    searchIcon.innerHTML = icons.search({ size: 16 });

    this.searchInput = document.createElement('input');
    this.searchInput.className = 'sketch-hub-search-input';
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Search sketches';
    this.searchInput.addEventListener('input', this.handleSearchInput);

    searchContainer.appendChild(searchIcon);
    searchContainer.appendChild(this.searchInput);
    controls.appendChild(createButton);
    controls.appendChild(searchContainer);
    toolbar.appendChild(this.countElement);
    toolbar.appendChild(controls);

    this.listElement = document.createElement('div');
    this.listElement.className = 'sketch-hub-list';

    this.container.appendChild(toolbar);
    this.container.appendChild(this.listElement);
    parentElement.appendChild(this.container);

    window.addEventListener('vault-files-changed', this.handleVaultFilesChanged);
    window.addEventListener('file-saved', this.handleFileSaved);

    this.loadSketches();
  }

  async loadSketches() {
    try {
      const fileTree = await invoke('get_file_tree');
      this.sketches = buildSketchHubItems(fileTree.files, this.searchQuery);
      this.render();
    } catch (error) {
      console.error('[SketchHub] Failed to load sketches:', error);
      this.renderError(error);
    }
  }

  render() {
    if (!this.listElement || !this.countElement) {
      return;
    }

    this.countElement.textContent = this.sketches.length === 1
      ? '1 sketch'
      : `${this.sketches.length} sketches`;

    this.listElement.innerHTML = '';

    if (this.sketches.length === 0) {
      this.renderEmptyState();
      return;
    }

    this.sketches.forEach((sketch) => {
      this.listElement.appendChild(this.createSketchRow(sketch));
    });
  }

  createSketchRow(sketch) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sketch-hub-row';
    row.dataset.path = sketch.path;
    row.innerHTML = `
      <span class="sketch-hub-thumb">${icons.pencilLine({ size: 20 })}</span>
      <span class="sketch-hub-row-copy">
        <span class="sketch-hub-row-title">${sketch.displayName}</span>
        <span class="sketch-hub-row-meta">${formatSketchModifiedTime(sketch.modified)}</span>
      </span>
      <span class="sketch-hub-row-arrow">${icons.chevronRight({ size: 16 })}</span>
    `;

    row.addEventListener('click', async () => {
      try {
        if (typeof window.handleFileClick === 'function') {
          await window.handleFileClick(sketch.path, false);
        }

        if (typeof this.options.onSketchOpen === 'function') {
          this.options.onSketchOpen(sketch);
        }
      } catch (error) {
        console.error('[SketchHub] Failed to open sketch:', error);
        try { toast.error('Failed to open sketch', 2000); } catch {}
      }
    });

    return row;
  }

  renderEmptyState() {
    const emptyState = document.createElement('div');
    emptyState.className = 'sketch-hub-empty';
    emptyState.innerHTML = `
      <div class="sketch-hub-empty-icon">${icons.pencilLine({ size: 24 })}</div>
      <h3>${this.searchQuery ? 'No sketches match your search.' : 'No sketches yet.'}</h3>
      <p>${this.searchQuery ? 'Try a different search term.' : 'Create your first sketch to get started.'}</p>
    `;

    if (!this.searchQuery) {
      const createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.className = 'sketch-hub-empty-action';
      createButton.textContent = 'Create Sketch';
      createButton.addEventListener('click', this.handleCreateSketch);
      emptyState.appendChild(createButton);
    }

    this.listElement.appendChild(emptyState);
  }

  renderError(error) {
    if (!this.listElement) {
      return;
    }

    this.listElement.innerHTML = `
      <div class="sketch-hub-empty">
        <div class="sketch-hub-empty-icon">${icons.alertTriangle({ size: 24 })}</div>
        <h3>Failed to load sketches</h3>
        <p>${error?.message || error}</p>
      </div>
    `;
  }

  handleSearchInput(event) {
    this.searchQuery = event.target.value;

    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.loadSketches();
    }, 120);
  }

  async handleCreateSketch() {
    try {
      const rawName = typeof this.options.requestSketchName === 'function'
        ? await this.options.requestSketchName()
        : null;

      const fileName = normalizeSketchFileName(rawName);
      if (!fileName) {
        return;
      }

      const filePath = await invoke('create_new_sketch', { fileName });

      if (window.expandedFolders instanceof Set) {
        window.expandedFolders.add('Sketches');
      }

      if (typeof window.refreshFileTree === 'function') {
        await window.refreshFileTree();
      }

      await this.loadSketches();

      if (typeof window.handleFileClick === 'function') {
        await window.handleFileClick(filePath, false);
      }

      if (typeof this.options.onSketchOpen === 'function') {
        this.options.onSketchOpen({
          path: filePath,
          displayName: fileName.replace(/\.excalidraw$/i, '')
        });
      }
    } catch (error) {
      console.error('[SketchHub] Failed to create sketch:', error);
      try { toast.error('Failed to create sketch', 2000); } catch {}
    }
  }

  handleVaultFilesChanged() {
    this.loadSketches();
  }

  handleFileSaved() {
    this.loadSketches();
  }

  unmount() {
    clearTimeout(this.searchTimeout);
    window.removeEventListener('vault-files-changed', this.handleVaultFilesChanged);
    window.removeEventListener('file-saved', this.handleFileSaved);
  }
}
