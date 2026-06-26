export function renderAppShell({ appElement, icons, isChatVisible = false, isSplit = false } = {}) {
  if (!appElement) {
    return false;
  }

  // eslint-disable-next-line no-restricted-syntax -- controlled shell template with local icon renderers
  appElement.innerHTML = `
    <div class="app-container">
      <div class="sidebar">
        <div class="sidebar-ribbon" id="vault-actions" data-tauri-drag-region></div>
        <div class="sidebar-header">
          <div class="sidebar-app-nav" id="sidebar-app-nav">
            <button class="sidebar-nav-button active" data-action="open-home-section" data-section="home" title="Home">
              <span class="sidebar-nav-icon">${icons.house({ size: 16 })}</span>
              <span class="sidebar-nav-label">Home</span>
            </button>
            <button class="sidebar-nav-button" data-action="open-tasks-section" data-section="tasks" data-requires-vault="true" title="Tasks">
              <span class="sidebar-nav-icon">${icons.listTodo({ size: 16 })}</span>
              <span class="sidebar-nav-label">Tasks</span>
            </button>
            <button class="sidebar-nav-button" data-action="open-sketches-section" data-section="sketches" data-requires-vault="true" title="Sketches">
              <span class="sidebar-nav-icon">${icons.pencilLine({ size: 16 })}</span>
              <span class="sidebar-nav-label">Sketches</span>
            </button>
          </div>
          <div class="sidebar-vault-row">
            <div id="vault-picker-container"></div>
            <div class="header-actions"></div>
          </div>
        </div>
        <div class="file-tree-panel">
          <div class="file-tree-header" id="file-tree-header" style="display: none;">
            <span class="file-tree-title">File Tree</span>
            <div class="file-tree-controls">
              <button class="ribbon-button file-tree-action-button" data-action="show-create-file-modal" title="New File">
                ${icons.fileText()}
              </button>
              <button class="ribbon-button file-tree-action-button" data-action="show-create-folder-modal" title="New Folder">
                ${icons.folderOpen()}
              </button>
              <button class="ribbon-button file-tree-action-button" data-action="refresh-file-tree" title="Refresh files">
                ${icons.refresh()}
              </button>
              <div class="sort-menu-container">
                <button id="sort-menu" class="ribbon-button file-tree-sort-button" data-action="toggle-sort-menu" title="Sort files">
                  ${icons.arrowDown()}
                </button>
                <div id="sort-dropdown" class="sort-dropdown hidden">
                  <div class="dropdown-item" data-action="set-sort-option" data-sort-option="alphabetical">
                    <span class="dropdown-icon">${icons.aArrowDown({ size: 14 })}</span>
                    <span class="dropdown-label">Alphabetical</span>
                  </div>
                  <div class="dropdown-item" data-action="set-sort-option" data-sort-option="created">
                    <span class="dropdown-icon">${icons.calendar({ size: 14 })}</span>
                    <span class="dropdown-label">Date Created</span>
                  </div>
                  <div class="dropdown-item" data-action="set-sort-option" data-sort-option="modified">
                    <span class="dropdown-icon">${icons.clock({ size: 14 })}</span>
                    <span class="dropdown-label">Date Modified</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="file-tree" id="file-tree"></div>
        </div>
        <div class="sidebar-resize-handle" id="sidebar-resize-handle"></div>
      </div>

      <div class="editor-container">
        <div class="editor-header" id="editor-header" data-tauri-drag-region>
          <div class="editor-left-controls">
            <button id="sidebar-toggle" class="editor-control-btn" data-action="toggle-sidebar" title="Toggle Sidebar">
              ${icons.panelLeft()}
            </button>
            <button id="zen-mode-btn" class="editor-control-btn" data-action="toggle-zen-mode" title="Zen Mode (Cmd+Option+Z)">
              ${icons.yinYang()}
            </button>
          </div>
          <span class="file-name">Welcome to Gamplan</span>
          <div class="editor-controls">
            <button class="chat-toggle-btn editor-control-btn${isChatVisible ? ' active' : ''}" data-action="toggle-chat-panel" title="AI Chat (Cmd+Shift+C)">
              ${icons.messageSquare()}
            </button>
            <button id="split-view-btn" class="editor-control-btn${isSplit ? ' active' : ''}" data-action="toggle-split-view" title="Split View">
              ${icons.columns2()}
            </button>
            <div class="editor-menu-container">
              <button id="editor-menu-btn" class="editor-control-btn" data-action="toggle-editor-menu" title="Editor Menu">
                ${icons.menu()}
              </button>
              <div id="editor-dropdown" class="editor-dropdown hidden">
                <div class="editor-dropdown-item" data-action="toggle-zen-mode">
                  <span id="zen-mode-text">Enter zen mode</span>
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
        </div>
        <div id="editor-wrapper" class="editor-wrapper">
          <div id="editor-container" class="editor"></div>
        </div>
        <div class="editor-status-bar" id="editor-status-bar">
          <span id="word-count">0 words</span>
          <span id="char-count">0 characters</span>
        </div>
      </div>

      <div class="right-sidebar" id="right-sidebar">
        <div class="chat-resize-handle" id="chat-resize-handle"></div>
        <div id="chat-panel-container"></div>
      </div>

      <div id="file-context-menu" class="context-menu hidden">
        ${renderContextMenuItems('file')}
      </div>
      <div id="folder-context-menu" class="context-menu hidden">
        ${renderContextMenuItems('folder')}
      </div>
      <div id="rename-modal" class="modal hidden">
        <div class="modal-backdrop" data-action="close-rename-modal"></div>
        <div class="modal-content">
          <h3>Rename</h3>
          <input type="text" id="rename-input" class="modal-input" />
          <div class="modal-buttons">
            <button data-action="confirm-rename">Rename</button>
            <button data-action="close-rename-modal">Cancel</button>
          </div>
        </div>
      </div>
      <div id="move-modal" class="modal hidden">
        <div class="modal-backdrop" data-action="close-move-modal"></div>
        <div class="modal-content modal-move">
          <input type="text" id="move-filter" class="modal-input" placeholder="Type a folder" />
          <div id="move-folder-list" class="move-folder-list"></div>
          <div class="move-shortcuts">
            <span>↑↓ to navigate</span>
            <span>↵ to move</span>
            <span>shift ↵ to create</span>
            <span>esc to dismiss</span>
          </div>
        </div>
      </div>
    </div>
  `;
  return true;
}

export function setupDropdownDismissHandlers({ documentRef = document } = {}) {
  if (documentRef.__vaultDropdownDismissSetup) return;
  documentRef.__vaultDropdownDismissSetup = true;

  documentRef.addEventListener('click', (event) => {
    closeDropdownOutside(documentRef, event, 'vault-dropdown', '.vault-menu-container');
    closeDropdownOutside(documentRef, event, 'editor-dropdown', '.editor-menu-container');

    const sortDropdown = documentRef.getElementById('sort-dropdown');
    const sortMenu = documentRef.getElementById('sort-menu');
    const clickedSortMenu =
      sortMenu && (sortMenu.contains(event.target) || event.target === sortMenu);
    if (sortDropdown && !sortDropdown.contains(event.target) && !clickedSortMenu) {
      sortDropdown.classList.add('hidden');
    }
  });
}

function renderContextMenuItems() {
  return `
    <div class="context-menu-item" data-action="delete">Delete</div>
    <div class="context-menu-item" data-action="move">Move to...</div>
    <div class="context-menu-item" data-action="rename">Rename</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="copy-relative-path">Copy Relative Path</div>
    <div class="context-menu-item" data-action="copy-path">Copy Path</div>
    <div class="context-menu-item" data-action="reveal">View in Finder</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="inspect">Inspect</div>
  `;
}

function closeDropdownOutside(documentRef, event, dropdownId, containerSelector) {
  const dropdown = documentRef.getElementById(dropdownId);
  const container = documentRef.querySelector(containerSelector);
  if (dropdown && !dropdown.classList.contains('hidden') && !container?.contains(event.target)) {
    dropdown.classList.add('hidden');
  }
}
