/**
 * New Tab Screen component
 */
import { showCreateFileModal as showCreateFileModalDefault } from './app/file-modals.js';
import { getActiveTabManager } from './app/workspace.js';

export class NewTabScreen {
  constructor(container) {
    this.container = container;
    this.render();
  }

  render() {
    this.container.innerHTML = `
            <div class="new-tab-screen">
                <div class="new-tab-content">
                    <h2>No file is open</h2>
                    
                    <div class="new-tab-actions">
                        <button class="new-tab-action" data-action="create-new-note">
                            Create new note
                            <span class="new-tab-shortcut">⌘ N</span>
                        </button>
                        
                        <button class="new-tab-action secondary" data-action="close-current-tab">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;
  }
}

export async function createNewNote({ showCreateFileModal = showCreateFileModalDefault } = {}) {
  if (!showCreateFileModal) {
    return false;
  }

  await showCreateFileModal('');
  return true;
}

export async function closeCurrentTab({ tabManager = getActiveTabManager() } = {}) {
  if (!tabManager) {
    return false;
  }

  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    await tabManager.closeTab(activeTab.id);
    return true;
  }

  return false;
}
