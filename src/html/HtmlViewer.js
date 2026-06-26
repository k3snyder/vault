import { invoke } from '@tauri-apps/api/core';
import {
  buildHtmlBaseHref,
  buildSandboxedHtmlDocument,
  extractHtmlPlainText,
} from './html-utils.js';
import './html-viewer.css';

export class HtmlViewer {
  constructor(filePath, tabManager, paneId) {
    this.filePath = filePath;
    this.currentFile = filePath;
    this.tabManager = tabManager;
    this.paneId = paneId;
    this.tabId = null;
    this.fileName = filePath ? filePath.split('/').pop() : 'Untitled.html';

    this.container = null;
    this.iframe = null;
    this.rawHtml = '';
    this.plainText = '';
  }

  async mount() {
    this.container = document.createElement('div');
    this.container.className = 'html-viewer-shell';
    this.container.innerHTML = `
      <div class="html-viewer-loading">
        <div class="html-viewer-loading-spinner"></div>
        <p>Loading HTML preview...</p>
      </div>
    `;

    try {
      this.rawHtml = await invoke('read_file_content', { filePath: this.filePath });
      this.plainText = extractHtmlPlainText(this.rawHtml);
      this.renderShell();
    } catch (error) {
      this.renderError(error);
    }

    return this.container;
  }

  renderShell() {
    if (!this.container) {
      return;
    }

    const baseHref = buildHtmlBaseHref(window.currentVaultPath || '', this.filePath);
    const sandboxedDocument = buildSandboxedHtmlDocument(this.rawHtml, { baseHref });
    const infoMessage = baseHref
      ? 'Readonly preview. Scripts are disabled.'
      : 'Readonly preview. Scripts are disabled, and relative assets may not resolve without an open vault path.';

    this.container.innerHTML = `
      <div class="html-viewer-toolbar">
        <div class="html-viewer-toolbar-left">
          <span class="html-viewer-filename"></span>
        </div>
        <div class="html-viewer-toolbar-right">
          <span class="html-viewer-mode-label">${infoMessage}</span>
        </div>
      </div>
      <div class="html-viewer-frame-wrap">
        <iframe class="html-viewer-frame" title="HTML preview" sandbox="allow-same-origin"></iframe>
      </div>
    `;

    const fileNameEl = this.container.querySelector('.html-viewer-filename');
    if (fileNameEl) {
      fileNameEl.textContent = this.fileName;
    }

    this.iframe = this.container.querySelector('.html-viewer-frame');
    if (this.iframe) {
      this.iframe.srcdoc = sandboxedDocument;
    }
  }

  renderError(error) {
    if (!this.container) {
      return;
    }

    const message = error?.message || String(error);
    this.container.innerHTML = `
      <div class="html-viewer-error-state">
        <h3>Unable to open HTML file</h3>
        <p>${message}</p>
      </div>
    `;
  }

  focus() {
    this.iframe?.focus();
  }

  getContent() {
    return this.plainText || '';
  }

  hasUnsavedChanges() {
    return false;
  }

  destroy() {
    this.iframe = null;
    this.container = null;
    this.rawHtml = '';
    this.plainText = '';
  }
}
