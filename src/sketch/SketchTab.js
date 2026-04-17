import { invoke } from '@tauri-apps/api/core';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import './sketch-tab.css';

function normalizeSceneDataString(sceneData) {
  if (!sceneData || typeof sceneData !== 'string') {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(sceneData));
  } catch {
    return sceneData.trim();
  }
}

function normalizeScenePayload(sceneData) {
  if (!sceneData || typeof sceneData !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(sceneData);
  } catch {
    return '';
  }
}

// Helper to decode PNG bytes to RGBA pixel data for Tauri clipboard
async function pngToRgba(pngBytes) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([pngBytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(url);
      resolve({
        width: img.width,
        height: img.height,
        rgba: new Uint8Array(imageData.data)
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode PNG image'));
    };

    img.src = url;
  });
}

export class SketchTab {
  constructor(sketchPath, tabManager, paneId) {
    this.sketchPath = sketchPath;
    this.tabManager = tabManager;
    this.paneId = paneId;
    this.tabId = null;
    this.container = null;
    this.toolbar = null;
    this.iframe = null;
    this.fileName = sketchPath.split('/').pop();
    this.isDirty = false;
    this.isReady = false;
    this.pendingSceneData = null;
    this.messageHandler = null;
    this.keyboardHandler = null;
    this.themeObserver = null;
    this.pendingSaveResolve = null;
    this.lastSavedSceneData = '';
  }

  async createContent() {
    this.container = document.createElement('div');
    this.container.className = 'sketch-container';

    this.toolbar = this.createToolbar();
    this.container.appendChild(this.toolbar);

    const iframeContainer = document.createElement('div');
    iframeContainer.className = 'sketch-iframe-container';
    this.container.appendChild(iframeContainer);

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'sketch-iframe';
    this.iframe.src = '/excalidraw/index.html';
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframeContainer.appendChild(this.iframe);

    this.setupMessageHandler();
    this.setupKeyboardShortcuts();
    this.setupThemeObserver();

    try {
      const content = await invoke('read_file_content', { filePath: this.sketchPath });
      if (content?.trim()) {
        this.pendingSceneData = content;
        this.lastSavedSceneData = normalizeSceneDataString(content);
      }
    } catch (e) {
      console.log('New sketch, starting empty');
    }

    return this.container;
  }

  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-header sketch-toolbar';
    toolbar.innerHTML = `
      <div class="editor-header-left">
        <span class="sketch-filename">${this.fileName}</span>
        <span class="sketch-dirty-indicator" style="display: none;">*</span>
      </div>
      <div class="editor-header-center">
        <button class="editor-control-btn sketch-export-png-btn" title="Export as PNG">Export</button>
        <button class="editor-control-btn sketch-copy-btn" title="Copy to Clipboard">Copy</button>
        <button class="editor-control-btn sketch-save-btn" title="Save (Cmd+S)">Save</button>
      </div>
      <div class="editor-header-right"></div>
    `;

    toolbar.querySelector('.sketch-export-png-btn').addEventListener('click', () => this.exportPNG());
    toolbar.querySelector('.sketch-copy-btn').addEventListener('click', () => this.copyToClipboard());
    toolbar.querySelector('.sketch-save-btn').addEventListener('click', () => this.save());

    return toolbar;
  }

  setupMessageHandler() {
    this.messageHandler = (event) => {
      if (event.source !== this.iframe?.contentWindow) return;
      const { type } = event.data;

      switch (type) {
        case 'ready':
          console.log('[SketchTab] Excalidraw iframe ready');
          this.isReady = true;
          if (this.pendingSceneData) {
            console.log('[SketchTab] Loading pending scene data');
            this.callBridge('loadScene', this.pendingSceneData);
            this.pendingSceneData = null;
          }
          this.syncTheme();
          break;
        case 'change':
          if (normalizeScenePayload(event.data.data) === this.lastSavedSceneData) {
            this.setDirty(false);
          } else {
            this.setDirty(true);
          }
          break;
        case 'sceneData':
          if (this.pendingSaveResolve) {
            this.pendingSaveResolve(event.data.data);
            this.pendingSaveResolve = null;
          }
          break;
        case 'exportComplete':
          this.handleExportComplete(event.data);
          break;
        case 'clipboardData':
          this.handleClipboardData(event.data);
          break;
        case 'error':
          console.error('Excalidraw error:', event.data.message);
          break;
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  setupThemeObserver() {
    this.themeObserver = new MutationObserver(() => this.syncTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  callBridge(method, ...args) {
    this.iframe?.contentWindow?.postMessage({ type: 'bridgeCall', method, args }, '*');
  }

  syncTheme() {
    const isDark = document.documentElement.classList.contains('dark') ||
                   window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.callBridge('setTheme', isDark ? 'dark' : 'light');
  }

  setDirty(dirty) {
    this.isDirty = dirty;
    const indicator = this.toolbar?.querySelector('.sketch-dirty-indicator');
    if (indicator) {
      indicator.style.display = dirty ? 'inline' : 'none';
    }

    if (this.tabId && this.tabManager.tabs.has(this.tabId)) {
      const tab = this.tabManager.tabs.get(this.tabId);
      tab.isDirty = dirty;
      this.tabManager.emit('tab-changed', { tabId: this.tabId, tab });
    }
  }

  async save() {
    console.log('[SketchTab] save() called, isReady:', this.isReady);
    if (!this.isReady) {
      console.log('[SketchTab] Not ready, skipping save');
      return;
    }

    try {
      console.log('[SketchTab] Requesting scene data from iframe...');
      const sceneData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingSaveResolve = null;
          reject(new Error('Timeout waiting for scene data'));
        }, 2000);

        this.pendingSaveResolve = (data) => {
          clearTimeout(timeout);
          resolve(data);
        };
        this.callBridge('getSceneData');
      });

      if (!sceneData) {
        console.log('[SketchTab] No scene data received');
        return;
      }

      console.log('[SketchTab] Got scene data, length:', sceneData.length);
      console.log('[SketchTab] Writing to:', this.sketchPath);
      await invoke('write_file_content', { filePath: this.sketchPath, content: sceneData });
      console.log('[SketchTab] Save successful');
      this.lastSavedSceneData = normalizeSceneDataString(sceneData);
      this.setDirty(false);
    } catch (e) {
      console.error('[SketchTab] Save failed:', e);
    }
  }

  exportPNG() {
    this.callBridge('exportToPNG');
  }

  copyToClipboard() {
    this.callBridge('copyToClipboard');
  }

  async handleClipboardData(data) {
    if (!data.success) {
      console.error('[SketchTab] Failed to get clipboard data:', data.error);
      if (window.showNotification) {
        window.showNotification('Failed to copy: ' + data.error, 'error');
      }
      return;
    }

    try {
      // Convert base64 to Uint8Array
      const byteCharacters = atob(data.data);
      const pngBytes = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        pngBytes[i] = byteCharacters.charCodeAt(i);
      }

      // Decode PNG to RGBA pixel data
      console.log('[SketchTab] Decoding PNG to RGBA...');
      const imageData = await pngToRgba(pngBytes);
      console.log('[SketchTab] Image decoded:', imageData.width, 'x', imageData.height);

      // Write to clipboard using Tauri plugin with Image object format
      await writeImage(imageData);

      console.log('[SketchTab] Image copied to clipboard');
      if (window.showNotification) {
        window.showNotification('Copied to clipboard', 'success');
      }
    } catch (e) {
      console.error('[SketchTab] Clipboard write failed:', e, 'message:', e?.message);
      if (window.showNotification) {
        window.showNotification('Failed to copy: ' + (e?.message || String(e)), 'error');
      }
    }
  }

  async handleExportComplete(data) {
    if (!data.success) {
      console.error('Export failed:', data.error);
      return;
    }

    const ext = data.format;
    const defaultName = this.fileName.replace('.excalidraw', `.${ext}`);

    const filePath = await invoke('select_export_location', {
      fileName: defaultName.replace(/\.[^.]+$/, ''),
      extension: ext,
      defaultDirectory: null
    });

    if (filePath) {
      await invoke('write_binary_file', { path: filePath, data: data.data });
    }
  }

  setupKeyboardShortcuts() {
    this.keyboardHandler = (e) => {
      // Check if this sketch tab is visible (container is in DOM and not hidden)
      if (!this.container || !document.body.contains(this.container)) return;
      const computedDisplay = window.getComputedStyle(this.container.parentElement).display;
      if (computedDisplay === 'none') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        console.log('[SketchTab] Cmd+S detected, calling save()');
        e.preventDefault();
        this.save();
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);
  }

  focus() {
    this.iframe?.focus();
  }

  hasUnsavedChanges() {
    return this.isDirty;
  }

  destroy() {
    if (this.messageHandler) window.removeEventListener('message', this.messageHandler);
    if (this.keyboardHandler) document.removeEventListener('keydown', this.keyboardHandler);
    this.themeObserver?.disconnect();
    this.container?.remove();
  }
}
