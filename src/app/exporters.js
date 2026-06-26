const runtime = {
  invoke: null,
  log: console,
  windowRef: null,
  navigatorRef: null,
  documentRef: null,
  showNotification: () => {},
  showSuccess: () => {},
  showCopyNotification: () => {},
  getActiveContentSource: () => null,
  getActiveMarkdownExportTarget: () => null,
  getExportDefaultDirectory: () => null,
  getPaneManager: () => null,
  getCurrentEditor: () => null,
};

export function initExporters({
  invoke,
  log = console,
  windowRef = window,
  navigatorRef = navigator,
  documentRef = document,
  showNotification = () => {},
  showSuccess = () => {},
  showCopyNotification = () => {},
  getActiveContentSource = () => null,
  getActiveMarkdownExportTarget = () => null,
  getExportDefaultDirectory = () => null,
  getPaneManager = () => null,
  getCurrentEditor = () => null,
} = {}) {
  Object.assign(runtime, {
    invoke,
    log,
    windowRef,
    navigatorRef,
    documentRef,
    showNotification,
    showSuccess,
    showCopyNotification,
    getActiveContentSource,
    getActiveMarkdownExportTarget,
    getExportDefaultDirectory,
    getPaneManager,
    getCurrentEditor,
  });

  windowRef.copyAllText = copyAllText;
  windowRef.exportToPDF = exportToPDF;
  windowRef.exportToHTML = exportToHTML;
  windowRef.syncVaultToGraph = syncVaultToGraph;
  windowRef.exportToWord = exportToWord;
  windowRef.generateHighlightsSummary = generateHighlightsSummary;

  return {
    copyAllText,
    exportToPDF,
    exportToHTML,
    syncVaultToGraph,
    exportToWord,
    generateHighlightsSummary,
  };
}

export function copyAllText() {
  const activeEditor = runtime.getActiveContentSource();
  if (!activeEditor) {
    runtime.log.debug?.('No editor available to copy from');
    return;
  }

  try {
    const allText = activeEditor.getContent();
    runtime.navigatorRef.clipboard
      .writeText(allText)
      .then(() => {
        runtime.showCopyNotification('Copy successful');
        const copyButton = runtime.documentRef.getElementById('copy-all-btn');
        if (copyButton) {
          copyButton.classList.add('active');
          runtime.windowRef.setTimeout(() => {
            copyButton.classList.remove('active');
          }, 200);
        }
      })
      .catch(() => {
        selectAllEditorText(activeEditor);
      });
  } catch (error) {
    console.error('Error copying text:', error);
  }
}

export async function exportToPDF() {
  await exportMarkdown({
    extension: 'pdf',
    command: 'export_to_pdf',
    successMessage: 'PDF exported successfully',
    errorPrefix: 'Failed to export PDF: ',
    options: {
      theme: 'light',
      include_styles: true,
      paper_size: 'A4',
    },
  });
}

export async function exportToHTML() {
  await exportMarkdown({
    extension: 'html',
    command: 'export_to_html',
    successMessage: 'HTML exported successfully',
    errorPrefix: 'Failed to export HTML: ',
    options: {
      theme: 'light',
      include_styles: true,
      paper_size: null,
    },
  });
}

export async function exportToWord() {
  await exportMarkdown({
    extension: 'doc',
    command: 'export_to_word',
    successMessage: 'Word document exported successfully',
    errorPrefix: 'Failed to export Word document: ',
    options: {
      theme: 'light',
      include_styles: true,
      paper_size: null,
    },
  });
}

export async function syncVaultToGraph() {
  hideEditorDropdown();
  runtime.showNotification('Starting vault sync to knowledge graph...', 'info');

  try {
    const result = await runtime.invoke('sync_vault_to_graph');
    runtime.showNotification(result || 'Graph sync completed successfully', 'success');
  } catch (error) {
    console.error('Graph sync failed:', error);
    runtime.showNotification(error.message || 'Graph sync failed', 'error');
  }
}

export function generateHighlightsSummary() {
  hideEditorDropdown();

  const paneManager = runtime.getPaneManager();
  const tabManager = paneManager?.getActiveTabManager?.();
  const activeTab = tabManager?.getActiveTab?.();
  if (activeTab?.type === 'pdf' && activeTab.pdfTab) {
    activeTab.pdfTab.extractHighlights();
    return;
  }

  const currentEditor = runtime.getCurrentEditor();
  if (!currentEditor) {
    runtime.showNotification('Please open a file before generating highlights', 'error');
    return;
  }

  if (!currentEditor.view) {
    runtime.showNotification('Editor not ready, please try again', 'error');
    return;
  }

  currentEditor.view.dispatch({ effects: [] });
  import('../editor/highlights-extension.js')
    .then((module) => {
      const result = module.summarizeHighlights(currentEditor.view);
      runtime.showNotification(result.message, result.success ? 'success' : 'info');
    })
    .catch((error) => {
      console.error('Failed to load highlights extension:', error);
      runtime.showNotification('Failed to generate highlights summary', 'error');
    });
}

async function exportMarkdown({ extension, command, successMessage, errorPrefix, options }) {
  hideEditorDropdown();

  const exportTarget = runtime.getActiveMarkdownExportTarget();
  if (!exportTarget) {
    runtime.showNotification('Please open a file before exporting', 'error');
    return;
  }

  const { editor, filePath } = exportTarget;
  try {
    if (!(await ensureEditorReady(editor))) {
      return;
    }

    const markdownContent = editor.getContent();
    const fileName = filePath.split('/').pop().replace('.md', '');
    const outputPath = await runtime.invoke('select_export_location', {
      fileName,
      extension,
      defaultDirectory: runtime.getExportDefaultDirectory(filePath),
    });

    if (!outputPath) {
      return;
    }

    await runtime.invoke(command, {
      markdownContent,
      outputPath,
      options,
    });

    runtime.showSuccess(successMessage);
  } catch (error) {
    console.error(errorPrefix, error);
    runtime.showNotification(errorPrefix + error, 'error');
  }
}

async function ensureEditorReady(editor) {
  if (editor.view?.state) {
    return true;
  }

  await new Promise((resolve) => runtime.windowRef.setTimeout(resolve, 500));
  if (editor.view?.state) {
    return true;
  }

  runtime.showNotification('Editor not ready yet, please try again', 'error');
  return false;
}

function selectAllEditorText(activeEditor) {
  if (typeof activeEditor.selectAll === 'function') {
    activeEditor.selectAll();
    return;
  }

  if (activeEditor.view?.state?.doc) {
    const view = activeEditor.view;
    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    view.focus();
  }
}

function hideEditorDropdown() {
  runtime.documentRef.getElementById('editor-dropdown')?.classList.add('hidden');
}
