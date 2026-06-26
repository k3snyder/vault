export function createAppContext({ windowContext = null } = {}) {
  const appContext = {
    vault: {
      path: null,
      fileTree: null,
      expandedFolders: new Set(),
    },
    workspace: {
      paneManager: null,
      currentFile: null,
      currentEditor: null,
      getActiveTabManager() {
        return this.paneManager?.getActiveTabManager?.() || null;
      },
      getActiveTab() {
        return this.getActiveTabManager()?.getActiveTab?.() || null;
      },
      getActiveTextEditor() {
        const activeTab = this.getActiveTab();
        if (activeTab?.editor && activeTab.type === 'markdown') {
          return activeTab.editor;
        }
        return this.currentEditor || null;
      },
    },
    chat: {
      panel: null,
    },
    services: {
      entitlementManager: null,
      pacasdbClient: null,
      vaultSync: null,
      windowContext,
    },
    debug: {},
  };

  return appContext;
}

export function exposeAppContext(appContext, targetWindow = window) {
  targetWindow.vaultApp = appContext;
  return appContext;
}

export function bindWindowVaultState(appContext, targetWindow = window) {
  bindWindowProperty(targetWindow, 'currentVaultPath', {
    get: () => appContext.vault.path,
    set: (value) => {
      appContext.vault.path = value || null;
    },
  });

  bindWindowProperty(targetWindow, 'currentFileTree', {
    get: () => appContext.vault.fileTree,
    set: (value) => {
      appContext.vault.fileTree = value || null;
    },
  });

  bindWindowProperty(targetWindow, 'expandedFolders', {
    get: () => appContext.vault.expandedFolders,
    set: (value) => {
      appContext.vault.expandedFolders = value instanceof Set ? value : new Set();
    },
  });

  return appContext;
}

function bindWindowProperty(targetWindow, propertyName, descriptor) {
  const currentDescriptor = Object.getOwnPropertyDescriptor(targetWindow, propertyName);
  if (currentDescriptor && !currentDescriptor.configurable) {
    return;
  }

  Object.defineProperty(targetWindow, propertyName, {
    configurable: true,
    enumerable: true,
    get: descriptor.get,
    set: descriptor.set,
  });
}
