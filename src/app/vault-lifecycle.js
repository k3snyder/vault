export async function closeTabsInAllPanes(paneManager, fallbackTabManager = null) {
  const panes = paneManager?.panes?.values ? [...paneManager.panes.values()] : [];

  if (panes.length > 0) {
    for (const pane of panes) {
      const paneTabManager = pane?.tabManager;
      if (!paneTabManager?.getTabs || !paneTabManager?.closeTab) {
        continue;
      }

      const tabs = [...paneTabManager.getTabs()];
      for (const tab of tabs) {
        await paneTabManager.closeTab(tab.id, true);
      }
    }
    return;
  }

  if (!fallbackTabManager?.getTabs || !fallbackTabManager?.closeTab) {
    return;
  }

  const tabs = [...fallbackTabManager.getTabs()];
  for (const tab of tabs) {
    await fallbackTabManager.closeTab(tab.id, true);
  }
}

const runtime = {
  appContext: null,
  invoke: null,
  openDialog: null,
  log: console,
  asCommandError: (error) => error,
  windowRef: null,
  documentRef: null,
  windowContext: null,
  VaultPicker: null,
  setSidebarAppSection: () => {},
  hideSectionHubs: () => {},
  updateSidebarAppNav: () => {},
  rebuildEditorHeader: () => {},
  updateNavigationButtons: () => {},
  displayFileTree: () => {},
  showFileTreeError: () => {},
  applySettingsToAllEditors: () => {},
  normalizeThemeOverrides: (value) => value,
  normalizeImageLocation: (value) => value,
  getPaneManager: () => null,
  getFallbackTabManager: () => null,
  getCurrentEditor: () => null,
  setCurrentEditorState: () => {},
  showError: () => {},
};

export function initVaultLifecycle(
  appContext,
  {
    invoke,
    openDialog,
    log = console,
    asCommandError = (error) => error,
    windowRef = window,
    documentRef = document,
    windowContext = null,
    VaultPicker = null,
    setSidebarAppSection = () => {},
    hideSectionHubs = () => {},
    updateSidebarAppNav = () => {},
    rebuildEditorHeader = () => {},
    updateNavigationButtons = () => {},
    displayFileTree = () => {},
    showFileTreeError = () => {},
    applySettingsToAllEditors = () => {},
    normalizeThemeOverrides = (value) => value,
    normalizeImageLocation = (value) => value,
    getPaneManager = () => null,
    getFallbackTabManager = () => null,
    getCurrentEditor = () => null,
    setCurrentEditorState = () => {},
    showError = () => {},
  } = {},
) {
  Object.assign(runtime, {
    appContext,
    invoke,
    openDialog,
    log,
    asCommandError,
    windowRef,
    documentRef,
    windowContext,
    VaultPicker,
    setSidebarAppSection,
    hideSectionHubs,
    updateSidebarAppNav,
    rebuildEditorHeader,
    updateNavigationButtons,
    displayFileTree,
    showFileTreeError,
    applySettingsToAllEditors,
    normalizeThemeOverrides,
    normalizeImageLocation,
    getPaneManager,
    getFallbackTabManager,
    getCurrentEditor,
    setCurrentEditorState,
    showError,
  });

  return {
    initTauri,
    openVault,
    createVault,
    closeCurrentVault,
    showWelcomeScreen,
    updateUIWithVault,
    syncVaultPickerInstances,
    ensureWelcomeVaultPicker,
  };
}

export async function initTauri() {
  runtime.log.debug?.('🚀 Tauri v2: Ready to use!');
  runtime.log.debug?.('✅ invoke function type:', typeof runtime.invoke);
  runtime.log.debug?.('✅ dialog open function type:', typeof runtime.openDialog);
}

export function syncVaultPickerInstances(vaultInfo) {
  ['vaultPicker', 'welcomeVaultPicker'].forEach((pickerKey) => {
    const picker = runtime.windowRef[pickerKey];
    if (!picker) {
      return;
    }

    picker.currentVault = vaultInfo;
    picker.render();
  });
}

export function ensureWelcomeVaultPicker() {
  const container = runtime.documentRef.getElementById('welcome-vault-picker-container');
  if (!container || !runtime.VaultPicker) {
    return;
  }

  if (runtime.windowRef.welcomeVaultPicker?.container === container) {
    syncVaultPickerInstances(runtime.windowRef.welcomeVaultPicker.currentVault);
    return;
  }

  if (runtime.windowRef.welcomeVaultPicker?.destroy) {
    runtime.windowRef.welcomeVaultPicker.destroy();
  }

  runtime.windowRef.welcomeVaultPicker = new runtime.VaultPicker(container, {
    variant: 'hero',
    emptyLabel: 'Select your vault',
    showIcon: false,
    enableKeyboardShortcut: false,
    actionLabels: {
      openFolder: 'Open Folder...',
      openNewWindow: 'Open Folder in New Window...',
      closeVault: 'Close Folder',
    },
  });
}

export async function closeCurrentVault() {
  runtime.log.debug?.('❌ Closing current vault...');

  try {
    await runtime.invoke('save_last_vault', { vaultPath: '' });
    runtime.log.debug?.('✅ Cleared last vault preference');
  } catch (error) {
    console.error('⚠️ Failed to clear last vault:', error);
  }

  const dropdown = runtime.documentRef.getElementById('vault-dropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
  }

  const vaultNameElement = runtime.documentRef.querySelector('.vault-name');
  if (vaultNameElement) {
    vaultNameElement.textContent = 'No Vault';
  }

  runtime.appContext.vault.path = null;
  runtime.appContext.vault.fileTree = null;
  runtime.appContext.vault.expandedFolders = new Set();
  if (runtime.windowContext) {
    runtime.windowContext.vaultPath = null;
    runtime.windowContext.vaultId = null;
    runtime.windowContext.vaultName = null;
  }
  runtime.documentRef.title = 'Vault';
  runtime.setSidebarAppSection('home');
  runtime.hideSectionHubs();
  syncVaultPickerInstances(null);

  const fileTreeHeader = runtime.documentRef.getElementById('file-tree-header');
  if (fileTreeHeader) {
    fileTreeHeader.style.display = 'none';
  }

  const fileTreeElement = runtime.documentRef.getElementById('file-tree');
  if (fileTreeElement) {
    fileTreeElement.innerHTML = '';
  }

  await closeTabsInAllPanes(runtime.getPaneManager(), runtime.getFallbackTabManager());
  runtime.setCurrentEditorState(null);

  if (runtime.windowRef.widgetSidebar) {
    runtime.windowRef.widgetSidebar.updateActiveEditor(null);
  }

  showWelcomeScreen();
}

export function showWelcomeScreen() {
  runtime.setSidebarAppSection('home');
  runtime.hideSectionHubs();

  const editorHeader = runtime.documentRef.getElementById('editor-header');
  if (editorHeader) {
    editorHeader.style.display = 'none';
  }

  const statusBar = runtime.documentRef.getElementById('editor-status-bar');
  if (statusBar) {
    statusBar.style.display = 'none';
  }

  const editorWrapper = runtime.documentRef.getElementById('editor-wrapper');
  if (editorWrapper) {
    editorWrapper.style.display = 'none';
  }

  const welcomeMarkup = `
      <div class="welcome-landing-page">
        <div class="welcome-center">
          <img src="/vault-logo-transparent.png" alt="Vault Logo" class="welcome-logo" />
          <div class="welcome-header">
            <h1>Welcome to Vault</h1>
            <p class="welcome-tagline">Open an existing folder or create new.</p>
          </div>
          <div id="welcome-vault-picker-container" class="welcome-vault-picker"></div>
        </div>
      </div>
    `;

  const existingWelcome = runtime.documentRef.querySelector('.welcome-container');
  if (existingWelcome) {
    existingWelcome.style.display = 'flex';
    if (!existingWelcome.querySelector('#welcome-vault-picker-container')) {
      existingWelcome.innerHTML = welcomeMarkup;
    }
  } else {
    const editorContainer = runtime.documentRef.querySelector('.editor-container');
    if (editorContainer) {
      const welcomeDiv = runtime.documentRef.createElement('div');
      welcomeDiv.className = 'welcome-container';
      welcomeDiv.innerHTML = welcomeMarkup;
      editorContainer.appendChild(welcomeDiv);
    }
  }

  ensureWelcomeVaultPicker();
  runtime.log.debug?.('✅ Welcome landing page displayed');
  runtime.setCurrentEditorState(null);
}

export async function openVault() {
  runtime.log.debug?.('🎯 Opening vault...');
  hideVaultDropdown();
  const button = runtime.documentRef.getElementById('open-vault');

  try {
    setButtonState(button, 'Selecting...', true);
    const folderPath = await runtime.openDialog({
      directory: true,
      multiple: false,
    });

    if (!folderPath) {
      runtime.log.debug?.('❌ No folder selected');
      return;
    }

    setButtonState(button, 'Opening...', true);
    await runtime.windowContext.openVault(folderPath);
    runtime.log.debug?.('✅ Vault opened via WindowContext');
  } catch (error) {
    console.error('❌ Error opening vault:', error);
    runtime.showError('Failed to open vault: ' + runtime.asCommandError(error).message);
  } finally {
    setButtonState(button, 'Open Vault', false);
  }
}

export async function createVault() {
  runtime.log.debug?.('🎯 Creating new vault...');
  hideVaultDropdown();
  const button = runtime.documentRef.getElementById('create-vault');

  try {
    setButtonState(button, 'Selecting...', true);
    const parentPath = await runtime.openDialog({
      directory: true,
      multiple: false,
      title: 'Select directory where vault will be created',
    });

    if (!parentPath) {
      runtime.log.debug?.('❌ No parent folder selected');
      return;
    }

    const vaultName = await promptForVaultName();
    if (!vaultName || vaultName.trim() === '') {
      runtime.log.debug?.('❌ No vault name provided');
      return;
    }

    setButtonState(button, 'Creating...', true);
    const vaultInfo = await runtime.invoke('create_new_vault', {
      parentPath,
      vaultName: vaultName.trim(),
    });

    await runtime.windowContext.openVault(vaultInfo.path);
  } catch (error) {
    console.error('❌ Error creating vault:', error);
    runtime.showError('Failed to create vault: ' + runtime.asCommandError(error).message);
  } finally {
    setButtonState(button, 'Create Vault', false);
  }
}

export async function updateUIWithVault(vaultInfo) {
  runtime.log.debug?.('🔄 Updating UI with vault:', vaultInfo);
  runtime.appContext.vault.path = vaultInfo.path;
  runtime.updateSidebarAppNav();

  // The welcome-screen vault picker is only needed before a vault is open.
  // Tear it down so it stops handling vault-opened events (otherwise both it
  // and the sidebar picker handle every open, and its listener lingers).
  if (runtime.windowRef.welcomeVaultPicker?.destroy) {
    runtime.windowRef.welcomeVaultPicker.destroy();
    runtime.windowRef.welcomeVaultPicker = null;
  }

  try {
    await runtime.invoke('save_last_vault', { vaultPath: vaultInfo.path });
    runtime.log.debug?.('✅ Saved last vault path');
  } catch (error) {
    console.error('⚠️ Failed to save last vault:', error);
  }

  await loadVaultSettings(vaultInfo);
  showVaultEditorChrome(vaultInfo);
  await loadVaultFileTree(vaultInfo);
  showVaultReadyMessage(vaultInfo);
}

export async function promptForVaultName() {
  return new Promise((resolve) => {
    const modalHTML = `
      <div id="vault-name-modal" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Create New Vault</h3>
          </div>
          <div class="modal-body">
            <p class="modal-description">A new folder will be created with this name:</p>
            <label for="vault-name-input">Vault Name:</label>
            <input type="text" id="vault-name-input" placeholder="My Vault" value="My Vault" autofocus spellcheck="false">
          </div>
          <div class="modal-footer">
            <button id="vault-cancel-btn" class="secondary-button">Cancel</button>
            <button id="vault-create-btn" class="primary-button">Create</button>
          </div>
        </div>
      </div>
    `;

    runtime.documentRef.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = runtime.documentRef.getElementById('vault-name-modal');
    const input = runtime.documentRef.getElementById('vault-name-input');
    const cancelButton = runtime.documentRef.getElementById('vault-cancel-btn');
    const createButton = runtime.documentRef.getElementById('vault-create-btn');

    runtime.windowRef.setTimeout(() => {
      input.focus();
      input.select();
    }, 100);

    createButton.onclick = () => {
      const name = input.value.trim();
      modal.remove();
      resolve(name);
    };

    cancelButton.onclick = () => {
      modal.remove();
      resolve(null);
    };

    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createButton.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelButton.click();
      }
    };

    modal.onclick = (event) => {
      if (event.target === modal) {
        cancelButton.click();
      }
    };
  });
}

async function loadVaultSettings(vaultInfo) {
  try {
    const vaultSettings = await runtime.invoke('get_vault_settings', { vaultPath: vaultInfo.path });
    runtime.log.debug?.('✅ Loaded vault settings:', vaultSettings);

    if (vaultSettings && vaultSettings.editor) {
      const themeOverrides = runtime.normalizeThemeOverrides(
        vaultSettings.editor.theme_overrides || vaultSettings.editor.themeOverrides,
      );
      runtime.windowRef.pendingEditorSettings = {
        fontSize: vaultSettings.editor.font_size,
        fontFamily: vaultSettings.editor.font_family,
        fontColor: vaultSettings.editor.font_color,
        theme: vaultSettings.editor.theme,
        themeOverrides,
        lineNumbers: vaultSettings.editor.line_numbers,
        lineWrapping: vaultSettings.editor.line_wrapping,
        showStatusBar: vaultSettings.editor.show_status_bar,
        wysiwygMode: vaultSettings.editor.wysiwyg_mode,
      };

      runtime.applySettingsToAllEditors({
        fontSize: vaultSettings.editor.font_size,
        fontFamily: vaultSettings.editor.font_family,
        fontColor: vaultSettings.editor.font_color,
        theme: vaultSettings.editor.theme,
        themeOverrides,
        lineNumbers: vaultSettings.editor.line_numbers,
        lineWrapping: vaultSettings.editor.line_wrapping,
        showStatusBar: vaultSettings.editor.show_status_bar,
        wysiwygMode: vaultSettings.editor.wysiwyg_mode,
      });

      if (vaultSettings.files && vaultSettings.files.image_location) {
        runtime.windowRef.imageSaveLocation = runtime.normalizeImageLocation(
          vaultSettings.files.image_location,
        );
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to load vault settings:', error);
  }
}

function showVaultEditorChrome(vaultInfo) {
  const editorHeader = runtime.documentRef.getElementById('editor-header');
  if (editorHeader) {
    editorHeader.style.display = 'flex';
    runtime.rebuildEditorHeader('Welcome to Vault');
  }

  runtime.updateNavigationButtons();

  const vaultNameElement = runtime.documentRef.querySelector('.vault-name');
  if (vaultNameElement) {
    vaultNameElement.textContent = vaultInfo.name;
  }

  const fileTreeHeader = runtime.documentRef.getElementById('file-tree-header');
  if (fileTreeHeader) {
    fileTreeHeader.style.display = 'flex';
  }
}

async function loadVaultFileTree(vaultInfo) {
  try {
    runtime.log.debug?.('📁 Loading file tree...');
    const fileTree = await runtime.invoke('get_file_tree');
    runtime.displayFileTree(fileTree);

    runtime.log.debug?.('👁️ Starting file system watcher...');
    await runtime.invoke('start_file_watcher', { vaultPath: vaultInfo.path });
    runtime.log.debug?.('✅ File system watcher started');
  } catch (error) {
    console.error('❌ Failed to load file tree:', error);
    runtime.showFileTreeError(error);
  }
}

function showVaultReadyMessage(vaultInfo) {
  const currentEditor = runtime.getCurrentEditor();
  if (!currentEditor) {
    return;
  }

  const successContent = `# 🎉 Vault Ready!

## ${vaultInfo.name}

Your vault is now open and ready to use.

**Location:** \`${vaultInfo.path}\`

*Click on any file in the sidebar to start editing!*

### Quick Tips

- Use **Ctrl/Cmd + S** to save files
- Create [[wiki links]] by typing \`[[Note Name]]\`
- Add #tags anywhere in your notes
- Use **Ctrl/Cmd + B** for bold, **Ctrl/Cmd + I** for italic
`;

  currentEditor.setContent(successContent, false, null, false);
  runtime.setCurrentEditorState(null);
}

function hideVaultDropdown() {
  const dropdown = runtime.documentRef.getElementById('vault-dropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
  }
}

function setButtonState(button, text, disabled) {
  if (!button) {
    return;
  }

  button.textContent = text;
  button.disabled = disabled;
}
