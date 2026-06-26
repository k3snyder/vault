import { TaskWidget } from '../widgets/TaskWidget.js';
import { SketchHub } from '../widgets/SketchHub.js';
import { findFolderPathByName } from '../utils/file-tree-state.js';

const TASKS_HUB_HTML = `
  <div class="tasks-hub-shell">
    <div class="tasks-hub-header">
      <h1>Tasks</h1>
      <p>Open work across your vault.</p>
    </div>
    <div class="tasks-hub-widget-host"></div>
  </div>
`;

const SKETCHES_HUB_HTML = `
  <div class="sketches-hub-shell">
    <div class="sketches-hub-header">
      <h1>Sketches</h1>
      <p>Whiteboards and diagrams across your vault.</p>
    </div>
    <div class="sketches-hub-widget-host"></div>
  </div>
`;

const runtime = {
  invoke: null,
  windowRef: null,
  documentRef: null,
  displayFileTree: () => {},
  promptForSketchName: async () => null,
  rebuildEditorHeader: () => {},
  showWelcomeScreen: () => {},
  clearEditorState: () => {},
  getStatusBarVisible: () => true,
};

let taskHubWidget = null;
let sketchHubWidget = null;

export function initSections({
  invoke,
  windowRef = window,
  documentRef = document,
  displayFileTree = () => {},
  promptForSketchName = async () => null,
  rebuildEditorHeader = () => {},
  showWelcomeScreen = () => {},
  clearEditorState = () => {},
  getStatusBarVisible = () => true,
} = {}) {
  Object.assign(runtime, {
    invoke,
    windowRef,
    documentRef,
    displayFileTree,
    promptForSketchName,
    rebuildEditorHeader,
    showWelcomeScreen,
    clearEditorState,
    getStatusBarVisible,
  });

  windowRef.openHomeSection = openHomeSection;
  windowRef.openTasksSection = openTasksSection;
  windowRef.openSketchesSection = openSketchesSection;

  return {
    updateSidebarAppNav,
    setSidebarAppSection,
    showEditorWorkspace,
    hideSectionHubs,
    openHomeSection,
    openTasksSection,
    openSketchesSection,
  };
}

export function updateSidebarAppNav() {
  const navElement = runtime.documentRef.getElementById('sidebar-app-nav');
  if (!navElement) {
    return;
  }

  const hasVault = Boolean(runtime.windowRef.currentVaultPath);
  const activeSection = getVisibleSection();
  navElement.querySelectorAll('.sidebar-nav-button').forEach((button) => {
    const section = button.dataset.section;
    const requiresVault = button.dataset.requiresVault === 'true';

    button.classList.toggle('active', section === activeSection);
    button.disabled = requiresVault && !hasVault;
  });
}

export function setSidebarAppSection(section) {
  runtime.windowRef.sidebarAppSection = section;
  updateSidebarAppNav();
}

export function showEditorWorkspace(fileName = null) {
  hideSectionHubs();

  const editorWrapper = runtime.documentRef.getElementById('editor-wrapper');
  if (editorWrapper) {
    editorWrapper.style.display = 'block';
  }

  const welcomeContainer = runtime.documentRef.querySelector('.welcome-container');
  if (welcomeContainer) {
    welcomeContainer.style.display = 'none';
  }

  const editorHeader = runtime.documentRef.getElementById('editor-header');
  if (editorHeader) {
    editorHeader.style.display = 'flex';
    if (fileName) {
      runtime.rebuildEditorHeader(fileName);
    }
  }

  const statusBar = runtime.documentRef.getElementById('editor-status-bar');
  if (statusBar) {
    statusBar.style.display = runtime.getStatusBarVisible() ? 'flex' : 'none';
  }

  updateSidebarAppNav();
}

export function hideSectionHubs() {
  hideTasksHub();
  hideSketchesHub();
}

export function openHomeSection() {
  runtime.showWelcomeScreen();
}

export function openTasksSection() {
  showTasksHub();
}

export async function openSketchesSection() {
  if (!runtime.windowRef.currentVaultPath) {
    return;
  }

  await showSketchesHub();
}

function getVisibleSection() {
  const welcomeContainer = runtime.documentRef.querySelector('.welcome-container');
  const tasksHubContainer = runtime.documentRef.querySelector('.tasks-hub-container');
  const sketchesHubContainer = runtime.documentRef.querySelector('.sketches-hub-container');

  if (isVisible(welcomeContainer)) {
    return 'home';
  }
  if (isVisible(tasksHubContainer)) {
    return 'tasks';
  }
  if (isVisible(sketchesHubContainer)) {
    return 'sketches';
  }
  return null;
}

function isVisible(element) {
  return element ? runtime.windowRef.getComputedStyle(element).display !== 'none' : false;
}

function hideTasksHub() {
  if (taskHubWidget) {
    taskHubWidget.unmount();
    taskHubWidget = null;
  }

  runtime.documentRef.querySelector('.tasks-hub-container')?.remove();
}

function hideSketchesHub() {
  if (sketchHubWidget) {
    sketchHubWidget.unmount();
    sketchHubWidget = null;
  }

  runtime.documentRef.querySelector('.sketches-hub-container')?.remove();
}

function showTasksHub() {
  if (!runtime.windowRef.currentVaultPath) {
    return;
  }

  setSidebarAppSection('tasks');
  hideSectionHubs();
  hideEditorChrome();

  const editorContainer = runtime.documentRef.querySelector('.editor-container');
  if (!editorContainer) {
    return;
  }

  const tasksHubContainer = runtime.documentRef.createElement('div');
  tasksHubContainer.className = 'tasks-hub-container';
  tasksHubContainer.innerHTML = TASKS_HUB_HTML;
  editorContainer.appendChild(tasksHubContainer);

  const host = tasksHubContainer.querySelector('.tasks-hub-widget-host');
  taskHubWidget = new TaskWidget({
    showDashboardButton: false,
    variant: 'hub',
    onTaskOpen: () => {
      hideSectionHubs();
      updateSidebarAppNav();
    },
  });
  taskHubWidget.mount(host);
  clearActiveEditor();
}

async function showSketchesHub() {
  setSidebarAppSection('sketches');
  hideSectionHubs();
  hideEditorChrome();
  await ensureSketchesFolderVisible();

  const editorContainer = runtime.documentRef.querySelector('.editor-container');
  if (!editorContainer) {
    return;
  }

  const sketchesHubContainer = runtime.documentRef.createElement('div');
  sketchesHubContainer.className = 'sketches-hub-container';
  sketchesHubContainer.innerHTML = SKETCHES_HUB_HTML;
  editorContainer.appendChild(sketchesHubContainer);

  const host = sketchesHubContainer.querySelector('.sketches-hub-widget-host');
  sketchHubWidget = new SketchHub({
    requestSketchName: runtime.promptForSketchName,
    onSketchOpen: () => {
      hideSketchesHub();
      updateSidebarAppNav();
    },
  });
  sketchHubWidget.mount(host);
  clearActiveEditor();
}

async function ensureSketchesFolderVisible() {
  let fileTree = runtime.windowRef.currentFileTree || (await runtime.invoke('get_file_tree'));

  if (findFolderPathByName(fileTree.files, 'Sketches')) {
    return fileTree;
  }

  await runtime.invoke('create_directory', {
    vaultPath: runtime.windowRef.currentVaultPath,
    dirPath: 'Sketches',
  });

  fileTree = await runtime.invoke('get_file_tree');
  runtime.displayFileTree(fileTree);
  return fileTree;
}

function hideEditorChrome() {
  ['editor-header', 'editor-status-bar', 'editor-wrapper'].forEach((id) => {
    const element = runtime.documentRef.getElementById(id);
    if (element) {
      element.style.display = 'none';
    }
  });

  const welcomeContainer = runtime.documentRef.querySelector('.welcome-container');
  if (welcomeContainer) {
    welcomeContainer.style.display = 'none';
  }
}

function clearActiveEditor() {
  runtime.clearEditorState();
  runtime.windowRef.widgetSidebar?.updateActiveEditor(null);
  updateSidebarAppNav();
}
