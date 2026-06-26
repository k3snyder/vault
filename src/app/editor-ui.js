const runtime = {
  documentRef: null,
  icons: null,
  escapeHtml: (value) => String(value),
  getPaneManager: () => null,
  getChatPanel: () => null,
  getWidgetSidebar: () => null,
  getCurrentEditor: () => null,
};

export function initEditorUi({
  documentRef = document,
  icons,
  escapeHtml = (value) => String(value),
  getPaneManager = () => null,
  getChatPanel = () => null,
  getWidgetSidebar = () => null,
  getCurrentEditor = () => null,
} = {}) {
  Object.assign(runtime, {
    documentRef,
    icons,
    escapeHtml,
    getPaneManager,
    getChatPanel,
    getWidgetSidebar,
    getCurrentEditor,
  });

  return {
    updateEditorHeader,
    rebuildEditorHeader,
    showError,
  };
}

export function updateEditorHeader(fileName = 'Welcome to Vault') {
  const fileNameElement = runtime.documentRef.querySelector('.file-name');
  if (fileNameElement) {
    fileNameElement.textContent = fileName;
  }
}

export function rebuildEditorHeader(fileName = 'Welcome to Vault') {
  const { documentRef, icons, escapeHtml } = runtime;
  const editorHeader = documentRef.getElementById('editor-header');
  if (!editorHeader) {
    return;
  }

  editorHeader.setAttribute('data-tauri-drag-region', '');
  // eslint-disable-next-line no-restricted-syntax -- controlled header template with escaped file name
  editorHeader.innerHTML = `
    <div class="editor-left-controls">
      <button id="sidebar-toggle" class="editor-control-btn" data-action="toggle-sidebar" title="Toggle Sidebar">
        ${icons.panelLeft()}
      </button>
      <button id="split-view-btn" class="editor-control-btn${runtime.getPaneManager()?.isSplit ? ' active' : ''}" data-action="toggle-split-view" title="Split View (Cmd+\\)">
        ${icons.columns2()}
      </button>
      <button id="zen-mode-btn" class="editor-control-btn" data-action="toggle-zen-mode" title="Zen Mode (Cmd+Option+Z)">
        ${icons.yinYang()}
      </button>
      <button id="nav-back-btn" class="editor-control-btn" data-action="navigate-back" title="Go back (Cmd+[)" disabled>
        ${icons.chevronLeft()}
      </button>
      <button id="nav-forward-btn" class="editor-control-btn" data-action="navigate-forward" title="Go forward (Cmd+])" disabled>
        ${icons.chevronRight()}
      </button>
    </div>
    <span class="file-name">${escapeHtml(fileName)}</span>
    <div class="editor-controls">
      <button class="widget-toggle-btn editor-control-btn${runtime.getWidgetSidebar()?.visible ? ' active' : ''}" data-action="toggle-widget-sidebar" title="Toggle Widgets">
        ${icons.layoutGrid()}
      </button>
      <button class="chat-toggle-btn editor-control-btn${runtime.getChatPanel()?.isVisible ? ' active' : ''}" data-action="toggle-chat-panel" title="AI Chat (Cmd+Shift+C)">
        ${icons.messageSquare()}
      </button>
      <div class="editor-menu-container">
        <button id="editor-menu-btn" class="editor-control-btn" data-action="toggle-editor-menu" title="Editor Menu">
          ${icons.menu()}
        </button>
        <div id="editor-dropdown" class="editor-dropdown hidden">
          <div class="editor-dropdown-item" data-action="show-editor-settings">
            <span>Editor Settings</span>
          </div>
          <div class="editor-dropdown-divider"></div>
          <div class="editor-dropdown-item" data-action="generate-highlights-summary">
            <span>Generate Highlights Summary</span>
          </div>
          <div class="editor-dropdown-divider"></div>
          <div class="editor-dropdown-item" data-action="export-pdf">
            <span>Export as PDF</span>
          </div>
          <div class="editor-dropdown-item" data-action="export-html">
            <span>Export as HTML</span>
          </div>
          <div class="editor-dropdown-item" data-action="export-word">
            <span>Export as Word (.doc)</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function showError(message) {
  console.error('🚨 Showing error:', message);
  const currentEditor = runtime.getCurrentEditor();
  if (!currentEditor) {
    return;
  }

  currentEditor.setContent(
    `# ❌ Error\n\n${message}\n\n*Please check the console for more details.*`,
    false,
    null,
    false,
  );
}
