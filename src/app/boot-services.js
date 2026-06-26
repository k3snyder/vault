export async function initializePremiumFeatures(
  appContext,
  {
    EntitlementManager,
    PACASDBClient,
    GlobalSearchPanel,
    VaultSync,
    windowRef = window,
    log = console,
  } = {},
) {
  try {
    const entitlementManager = new EntitlementManager();
    appContext.services.entitlementManager = entitlementManager;
    await entitlementManager.initialize();
    log.debug('✅ EntitlementManager initialized');

    const pacasdbClient = new PACASDBClient(entitlementManager);
    appContext.services.pacasdbClient = pacasdbClient;
    log.debug('✅ PACASDBClient initialized');

    if (entitlementManager.isPremiumEnabled()) {
      const connected = await pacasdbClient.connect();
      log.debug(
        connected
          ? '✅ PACASDBClient connected to server'
          : '⚠️ PACASDBClient could not connect (server may not be running)',
      );
    }

    const globalSearchPanel = new GlobalSearchPanel(entitlementManager, pacasdbClient);
    const vaultSync = new VaultSync(pacasdbClient);
    appContext.services.vaultSync = vaultSync;
    vaultSync.start();
    log.debug('✅ GlobalSearchPanel initialized');
    log.debug('✅ VaultSync initialized and started');

    windowRef.entitlementManager = entitlementManager;
    windowRef.pacasdbClient = pacasdbClient;
    windowRef.vaultSync = vaultSync;

    return {
      entitlementManager,
      pacasdbClient,
      globalSearchPanel,
      vaultSync,
    };
  } catch (error) {
    console.error('❌ Failed to initialize premium features:', error);
    return {
      entitlementManager: null,
      pacasdbClient: null,
      globalSearchPanel: null,
      vaultSync: null,
    };
  }
}

export function setupGraphSyncListeners({ listen, invoke, log = console } = {}) {
  log.debug('🎯 Setting up graph sync event listeners...');
  listen('graph:sync:started', (event) => {
    log.debug('🔄 Graph sync started:', event.payload);
  });
  listen('graph:sync:completed', (event) => {
    log.debug('✅ Graph sync completed:', event.payload);
  });
  listen('graph:sync:error', (event) => {
    console.error('❌ Graph sync error:', event.payload);
  });
  setInterval(async () => {
    try {
      const status = await invoke('graph_sync_status');
      if (status.enabled && status.pendingUpdates > 0) {
        log.debug(`📊 Graph sync queue: ${status.pendingUpdates} pending updates`);
      }
    } catch {
      // Graph sync may be unavailable in non-premium or test contexts.
    }
  }, 5000);
}

export function initializeVaultPicker({
  documentRef = document,
  windowRef = window,
  VaultPicker,
  log = console,
}) {
  const vaultPickerContainer = documentRef.getElementById('vault-picker-container');
  if (!vaultPickerContainer) {
    return null;
  }

  log.debug('🗂️ Initializing VaultPicker...');
  const vaultPicker = new VaultPicker(vaultPickerContainer);
  return vaultPicker;
}

export function exposePerformanceDebug(
  appContext,
  { perfMonitor, perfTestSuite, log = console } = {},
) {
  appContext.debug.perf = {
    report: () => perfMonitor.generateReport(),
    export: () => perfMonitor.exportMetrics(),
    test: () => perfTestSuite.runAllTests(),
    toggle: (enabled) => perfMonitor.toggle(enabled),
  };

  log.debug('📊 Performance monitoring initialized');
  log.debug(
    '🧪 Available performance commands: window.vaultApp.debug.perf.{report,export,test,toggle}()',
  );
}

export async function initializeWindowComponents({
  windowContext,
  documentRef = document,
  invoke,
  refreshFileTree,
  getPaneManager,
  getActiveTabManager,
  globalSearch,
  resetPaneManager,
  initializeEditor,
  log = console,
} = {}) {
  log.debug('🔧 Initializing window-specific components...');
  if (!windowContext.hasVault) {
    return;
  }

  const vaultInfo = await windowContext.getVaultInfo();
  const vaultActions = documentRef.getElementById('vault-actions');
  if (vaultActions) {
    vaultActions.style.display = 'flex';
  }

  await refreshFileTree();
  try {
    log.debug('👁️ Starting file system watcher...');
    await invoke('start_file_watcher', { vaultPath: vaultInfo.path });
    log.debug('✅ File system watcher started');
  } catch (error) {
    console.error('❌ Failed to start file watcher:', error);
  }

  const editorWrapper = documentRef.getElementById('editor-wrapper');
  if (!editorWrapper) {
    return;
  }

  const paneManager = getPaneManager();
  log.debug('🔄 Checking editor state:', {
    paneManager: Boolean(paneManager),
    tabManager: Boolean(getActiveTabManager()),
    paneManagerContainer: paneManager?.container,
  });

  const needsInit =
    !paneManager ||
    !getActiveTabManager() ||
    !paneManager.container ||
    paneManager.panes.size === 0;
  if (needsInit) {
    log.debug('🔄 Re-initializing editor after vault switch...');
    globalSearch.cleanup();
    resetPaneManager();
    await initializeEditor();
  }
}
