import { invoke } from '@tauri-apps/api/core';
import {
  deriveBoxNoteTitle,
  extractBoxNotePlainText,
  parseBoxNoteFileContent,
  renderBoxNoteToHtml,
} from './boxnote-adapter.js';
import { openBoxNoteOnBox, isLikelyBoxDrivePath } from './boxnote-box-url.js';
import { convertBoxNoteFile } from './boxnote-to-markdown.js';
import './boxnote.css';

function unsupportedSummary(parsed) {
  const parts = [];

  if (parsed.unsupportedNodes.length > 0) {
    parts.push(`nodes: ${parsed.unsupportedNodes.join(', ')}`);
  }

  if (parsed.unsupportedMarks.length > 0) {
    parts.push(`marks: ${parsed.unsupportedMarks.join(', ')}`);
  }

  return parts.join('; ');
}

export class BoxNoteViewer {
  constructor(filePath, tabManager, paneId) {
    this.filePath = filePath;
    this.currentFile = filePath;
    this.tabManager = tabManager;
    this.paneId = paneId;
    this.tabId = null;
    this.fileName = filePath ? filePath.split('/').pop() : 'Untitled.boxnote';

    this.container = null;
    this.toolbar = null;
    this.contentEl = null;
    this.noteTitleEl = null;
    this.noteBodyEl = null;
    this.warningBanner = null;
    this.convertButton = null;
    this.openOnBoxButton = null;

    this.boxNote = null;
    this.doc = null;
    this.plainText = '';
  }

  async mount() {
    this.container = document.createElement('div');
    this.container.className = 'boxnote-viewer-shell';
    this.container.innerHTML = `
      <div class="boxnote-loading">
        <div class="boxnote-loading-spinner"></div>
        <p>Loading Box Note...</p>
      </div>
    `;

    try {
      const rawContent = await invoke('read_file_content', { filePath: this.filePath });
      this.renderShell();
      this.loadRawContent(rawContent);
    } catch (error) {
      this.renderError(error);
    }

    return this.container;
  }

  renderShell() {
    if (!this.container) {
      return;
    }

    const openOnBoxDisabled = isLikelyBoxDrivePath() ? '' : ' disabled';

    this.container.innerHTML = `
      <div class="boxnote-toolbar">
        <div class="boxnote-toolbar-left">
          <span class="boxnote-filename"></span>
        </div>
        <div class="boxnote-toolbar-right">
          <button class="editor-control-btn boxnote-convert-btn" title="Convert this Box Note to Markdown">Convert to Markdown</button>
          <button class="editor-control-btn boxnote-open-box-btn" title="Open this note on Box.com"${openOnBoxDisabled}>Open on Box.com</button>
        </div>
      </div>
      <div class="boxnote-warning-banner hidden"></div>
      <div class="boxnote-content" tabindex="0" aria-label="Box Note content">
        <article class="boxnote-note-surface">
          <header class="boxnote-note-header">
            <h1 class="boxnote-note-title"></h1>
          </header>
          <div class="boxnote-note-body"></div>
        </article>
      </div>
    `;

    this.toolbar = this.container.querySelector('.boxnote-toolbar');
    this.warningBanner = this.container.querySelector('.boxnote-warning-banner');
    this.contentEl = this.container.querySelector('.boxnote-content');
    this.noteTitleEl = this.container.querySelector('.boxnote-note-title');
    this.noteBodyEl = this.container.querySelector('.boxnote-note-body');
    this.convertButton = this.container.querySelector('.boxnote-convert-btn');
    this.openOnBoxButton = this.container.querySelector('.boxnote-open-box-btn');
    const fileNameEl = this.container.querySelector('.boxnote-filename');
    if (fileNameEl) {
      fileNameEl.textContent = this.fileName;
    }

    this.convertButton?.addEventListener('click', () => this.convertToMarkdown());
    this.openOnBoxButton?.addEventListener('click', () => this.openOnBox());
  }

  loadRawContent(rawContent) {
    const parsed = parseBoxNoteFileContent(rawContent);

    this.boxNote = parsed.boxNote;
    this.doc = parsed.doc;
    this.fileName = this.filePath ? this.filePath.split('/').pop() : 'Untitled.boxnote';
    this.plainText = extractBoxNotePlainText(parsed.doc);
    const noteTitle = deriveBoxNoteTitle(this.filePath);

    if (this.noteTitleEl) {
      this.noteTitleEl.textContent = noteTitle;
    }

    if (this.noteBodyEl) {
      this.noteBodyEl.innerHTML = renderBoxNoteToHtml(parsed.doc);
    }

    if (this.warningBanner) {
      if (parsed.hasUnsupportedContent) {
        this.warningBanner.textContent = `Some content may be simplified in Vault (${unsupportedSummary(parsed)}).`;
        this.warningBanner.classList.remove('hidden');
      } else {
        this.warningBanner.textContent = '';
        this.warningBanner.classList.add('hidden');
      }
    }
  }

  async convertToMarkdown() {
    if (!this.convertButton) {
      return;
    }

    try {
      this.convertButton.disabled = true;
      this.convertButton.textContent = 'Converting...';
      await convertBoxNoteFile(this.filePath);
    } catch (error) {
      console.error('Failed to convert Box Note to Markdown:', error);
      window.showNotification?.(error?.message || 'Failed to convert Box Note to Markdown.', 'error');
    } finally {
      if (this.convertButton) {
        this.convertButton.disabled = false;
        this.convertButton.textContent = 'Convert to Markdown';
      }
    }
  }

  async openOnBox() {
    if (!this.openOnBoxButton || this.openOnBoxButton.disabled) {
      return;
    }

    try {
      this.openOnBoxButton.disabled = true;
      this.openOnBoxButton.textContent = 'Opening...';
      await openBoxNoteOnBox(this.filePath);
    } catch (error) {
      console.error('Failed to open Box Note on Box.com:', error);
      window.showNotification?.(error?.message || 'Failed to open this note on Box.com.', 'error');
    } finally {
      if (this.openOnBoxButton) {
        this.openOnBoxButton.disabled = !isLikelyBoxDrivePath();
        this.openOnBoxButton.textContent = 'Open on Box.com';
      }
    }
  }

  renderError(error) {
    if (!this.container) {
      return;
    }

    const message = error?.message || String(error);
    this.container.innerHTML = `
      <div class="boxnote-error-state">
        <h3>Unable to open Box Note</h3>
        <p>${message}</p>
      </div>
    `;
  }

  focus() {
    this.contentEl?.focus();
  }

  getContent() {
    return this.plainText || deriveBoxNoteTitle(this.filePath);
  }

  hasUnsavedChanges() {
    return false;
  }

  destroy() {
    this.container = null;
    this.toolbar = null;
    this.contentEl = null;
    this.noteTitleEl = null;
    this.noteBodyEl = null;
    this.warningBanner = null;
    this.convertButton = null;
    this.openOnBoxButton = null;
    this.boxNote = null;
    this.doc = null;
    this.plainText = '';
  }
}
