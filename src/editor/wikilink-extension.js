import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, ViewPlugin, EditorView, WidgetType } from '@codemirror/view'
import { wikiLinkCache } from './wikilink-cache.js'

// WikiLink pattern: [[Page Name]] - but NOT ![[...]] (which are images)
// Use negative lookbehind to prevent matching image syntax (![[...]]) and triple brackets
const wikiLinkPattern = /(?<!\[)(?<!!)\[\[([^\]]+)\]\](?!\])/g

// Utility function to extract WikiLinks from text
export function extractWikiLinks(text) {
  const links = []
  let match
  const pattern = new RegExp(wikiLinkPattern.source, 'g')
  
  while ((match = pattern.exec(text)) !== null) {
    links.push({
      text: match[1],
      start: match.index,
      end: match.index + match[0].length,
      fullMatch: match[0]
    })
  }
  
  return links
}

// Utility function to normalize WikiLink names for resolution
export function normalizeWikiLinkName(name) {
  return name.trim()
    .replace(/\s+/g, ' ') // Normalize multiple spaces
    .toLowerCase() // Case insensitive matching
}

// Cache for async note existence checks to avoid repeated API calls
const noteExistenceCache = new Map();
const WIKI_LINK_CONTEXT_MENU_ID = 'wikilink-context-menu'
let activeWikiLinkContext = null

// Make it globally accessible for cleanup
window.noteExistenceCache = noteExistenceCache;

// Check if a note exists using the caching system
async function checkNoteExists(noteName) {
  try {
    const result = await wikiLinkCache.checkNoteExists(noteName);
    return result.exists;
  } catch (error) {
    console.error('Error checking note existence:', error);
    return false;
  }
}

// Create decoration for WikiLink with async existence checking
class InlineWikiLinkWidget extends WidgetType {
  constructor({ label, noteName, cssClass, exists, cacheKey, from, to }) {
    super()
    this.label = label
    this.noteName = noteName
    this.cssClass = cssClass
    this.exists = exists
    this.cacheKey = cacheKey
    this.from = from
    this.to = to
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = this.cssClass
    span.textContent = this.label
    span.setAttribute('data-wikilink', this.noteName)
    span.setAttribute('data-exists', this.exists.toString())
    span.setAttribute('data-cache-key', this.cacheKey)
    span.setAttribute('data-wikilink-from', this.from.toString())
    span.setAttribute('data-wikilink-to', this.to.toString())
    span.title = this.exists 
      ? `Navigate to "${this.noteName}"\nClick to open` 
      : this.cssClass === 'cm-wikilink-checking'
        ? `Checking "${this.noteName}"...`
        : `"${this.noteName}" doesn't exist\nClick to create`
    return span
  }

  eq(other) {
    return other.label === this.label &&
           other.noteName === this.noteName &&
           other.cssClass === this.cssClass &&
           other.exists === this.exists
  }
}

function computeDisplayLabelFromNoteName(noteName) {
  // Handle pipe syntax [[link|display]]. For TID links, show "TID:display".
  const pipeIndex = noteName.indexOf('|')
  if (pipeIndex !== -1) {
    const left = noteName.slice(0, pipeIndex).trim()
    const right = noteName.slice(pipeIndex + 1).trim()
    if (/^tid\s*:/i.test(left)) {
      return `TID:${right}`
    }
    return right
  }
  return noteName
}

function getWikiLinkDecorationInfo(match, view, pos) {
  const noteName = match[1]
  // Base name used for resolution/existence checks (left side of pipe)
  const baseName = noteName.split('|', 2)[0].trim()
  
  // Check if we have cached existence info
  let exists = false;
  let cssClass = 'cm-wikilink-checking'; // Default state while checking
  
  const cacheKey = wikiLinkCache.normalizeWikiLinkName(baseName);
  
  // Try to get cached result synchronously
  const cachedEntry = noteExistenceCache.get(cacheKey);
  if (cachedEntry && (Date.now() - cachedEntry.timestamp) < 30000) { // 30 second cache
    exists = cachedEntry.exists;
    cssClass = exists ? 'cm-wikilink-exists' : 'cm-wikilink-missing';
  } else {
    // Asynchronously check and update decoration
    checkNoteExistsAsync(baseName, view);
    
    // Use the cached value if available, otherwise assume missing
    if (cachedEntry) {
      exists = cachedEntry.exists;
      cssClass = exists ? 'cm-wikilink-exists' : 'cm-wikilink-missing';
    } else {
      cssClass = 'cm-wikilink-checking'; // Unknown until async resolution completes
    }
  }
  
  // Determine whether this is a TID link (left side starts with TID:)
  const isTid = /^tid\s*:/i.test(baseName)

  // Determine whether the cursor is within this match range (edit mode)
  const cursor = view.state.selection.main.head
  const from = pos
  const to = pos + match[0].length
  const isActive = cursor >= from && cursor <= to

  return {
    noteName,
    baseName,
    label: computeDisplayLabelFromNoteName(noteName),
    cssClass: isTid ? `${cssClass} cm-tid-link` : cssClass,
    exists,
    cacheKey,
    from,
    to,
    isActive
  }
}

function hideWikiLinkContextMenu() {
  const menu = document.getElementById(WIKI_LINK_CONTEXT_MENU_ID)
  if (menu) {
    menu.classList.add('hidden')
  }
  activeWikiLinkContext = null
}

function ensureWikiLinkContextMenu() {
  let menu = document.getElementById(WIKI_LINK_CONTEXT_MENU_ID)
  if (menu) {
    return menu
  }

  menu = document.createElement('div')
  menu.id = WIKI_LINK_CONTEXT_MENU_ID
  menu.className = 'context-menu hidden'
  menu.innerHTML = `
    <div class="context-menu-item" data-action="open-current">Open in current tab</div>
    <div class="context-menu-item" data-action="open-new-tab">Open in new tab</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="edit-link">Edit link</div>
    <div class="context-menu-item" data-action="copy-link-text">Copy link text</div>
  `

  const stopProp = (event) => event.stopPropagation()
  menu.addEventListener('mousedown', stopProp)
  menu.addEventListener('mouseup', stopProp)
  menu.addEventListener('click', stopProp)

  menu.addEventListener('click', async (event) => {
    const menuItem = event.target.closest('.context-menu-item')
    if (!menuItem || menuItem.classList.contains('is-disabled') || !activeWikiLinkContext) {
      return
    }

    const { action } = menuItem.dataset
    const context = activeWikiLinkContext

    try {
      switch (action) {
        case 'open-current':
          await context.instance.handleWikiLinkClick(context.noteName, context.exists)
          break
        case 'open-new-tab':
          await context.instance.handleWikiLinkClick(context.noteName, context.exists, {
            openInNewTab: true
          })
          break
        case 'edit-link':
          context.instance.editWikiLink(context)
          break
        case 'copy-link-text':
          await navigator.clipboard.writeText(context.noteName)
          break
      }
    } catch (error) {
      console.error('Error handling WikiLink context menu action:', error)
      context.instance.showErrorMessage(`Failed to handle link action: ${error.message}`)
    } finally {
      hideWikiLinkContextMenu()
    }
  })

  document.body.appendChild(menu)
  return menu
}

function showWikiLinkContextMenu(event, context) {
  const menu = ensureWikiLinkContextMenu()
  activeWikiLinkContext = context

  const openCurrentItem = menu.querySelector('[data-action="open-current"]')
  const openNewTabItem = menu.querySelector('[data-action="open-new-tab"]')

  if (openCurrentItem) {
    openCurrentItem.textContent = context.exists ? 'Open in current tab' : 'Create note'
  }

  if (openNewTabItem) {
    openNewTabItem.classList.toggle('is-disabled', !context.exists)
  }

  menu.style.left = `${event.clientX}px`
  menu.style.top = `${event.clientY}px`
  menu.classList.remove('hidden')

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect()
    const clampedLeft = Math.min(event.clientX, window.innerWidth - rect.width - 8)
    const clampedTop = Math.min(event.clientY, window.innerHeight - rect.height - 8)
    menu.style.left = `${Math.max(8, clampedLeft)}px`
    menu.style.top = `${Math.max(8, clampedTop)}px`
  })

  requestAnimationFrame(() => {
    const hideOnMouseDown = (mouseEvent) => {
      if (!menu.contains(mouseEvent.target)) {
        hideWikiLinkContextMenu()
        document.removeEventListener('mousedown', hideOnMouseDown, true)
      }
    }

    document.addEventListener('mousedown', hideOnMouseDown, true)
  })
}

// Async function to check note existence and update view
async function checkNoteExistsAsync(noteName, view) {
  try {
    const result = await wikiLinkCache.checkNoteExists(noteName);
    const cacheKey = wikiLinkCache.normalizeWikiLinkName(noteName);
    
    // Update local cache
    noteExistenceCache.set(cacheKey, {
      exists: result.exists,
      path: result.path,
      timestamp: Date.now()
    });
    
    // Trigger view update to refresh decorations
    // We'll use a small delay to batch updates
    setTimeout(() => {
      if (view && !view.isDestroyed) {
        view.dispatch({
          effects: [], // Empty transaction to trigger decoration update
        });
      }
    }, 10);
    
  } catch (error) {
    console.error('Error in async note existence check:', error);
  }
}

function createWikiLinkMark(info) {
  return Decoration.mark({
    class: info.cssClass,
    attributes: {
      'data-wikilink': info.baseName,
      'data-exists': info.exists.toString(),
      'data-cache-key': info.cacheKey,
      'data-wikilink-from': info.from.toString(),
      'data-wikilink-to': info.to.toString(),
      title: info.exists
        ? `Navigate to "${info.baseName}"\nClick to open`
        : info.cssClass.includes('cm-wikilink-checking')
          ? `Checking "${info.baseName}"...`
          : `"${info.baseName}" doesn't exist\nClick to create`
    }
  })
}

function createWikiLinkWidget(info) {
  return Decoration.replace({
    widget: new InlineWikiLinkWidget({
      label: info.label,
      noteName: info.baseName,
      cssClass: info.cssClass,
      exists: info.exists,
      cacheKey: info.cacheKey,
      from: info.from,
      to: info.to
    })
  })
}

function addWikiLinkDecoration(builders, match, view, pos) {
  console.log('Creating decoration for WikiLink:', match[0])

  const info = getWikiLinkDecorationInfo(match, view, pos)
  const contentFrom = info.from + 2
  const contentTo = info.to - 2
  const openingMarker = Decoration.replace({})
  const closingMarker = Decoration.replace({})

  builders.decorations.add(info.from, contentFrom, openingMarker)
  builders.atomicDecorations.add(info.from, contentFrom, openingMarker)

  const shouldRenderDisplayLabel = !info.isActive && info.label !== info.noteName
  builders.decorations.add(
    contentFrom,
    contentTo,
    shouldRenderDisplayLabel ? createWikiLinkWidget(info) : createWikiLinkMark(info)
  )

  builders.decorations.add(contentTo, info.to, closingMarker)
  builders.atomicDecorations.add(contentTo, info.to, closingMarker)
}

function createWikiLinkDecorationSets(view) {
  const builders = {
    decorations: new RangeSetBuilder(),
    atomicDecorations: new RangeSetBuilder()
  }

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      const regexp = new RegExp(wikiLinkPattern.source, 'g')
      let match

      while ((match = regexp.exec(line.text)) !== null) {
        addWikiLinkDecoration(builders, match, view, line.from + match.index)
      }

      pos = line.to + 1
    }
  }

  return {
    decorations: builders.decorations.finish(),
    atomicDecorations: builders.atomicDecorations.finish()
  }
}

// WikiLink ViewPlugin
export const wikiLinkPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view
      const sets = createWikiLinkDecorationSets(view)
      this.decorations = sets.decorations
      this.atomicDecorations = sets.atomicDecorations
      this.setupClickHandler(view)
    }

    update(update) {
      const shouldFullyRefresh =
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.length > 0

      if (shouldFullyRefresh) {
        const sets = createWikiLinkDecorationSets(update.view)
        this.decorations = sets.decorations
        this.atomicDecorations = sets.atomicDecorations
      }

      // Re-setup click handlers only when document changes
      if (update.docChanged) {
        setTimeout(() => this.setupClickHandler(update.view), 50)
      }
    }
    
    setupClickHandler(view) {
      // Remove existing handler to avoid duplicates
      if (this.clickHandler) {
        view.dom.removeEventListener('mousedown', this.clickHandler, true)
      }
      if (this.contextMenuHandler) {
        view.dom.removeEventListener('contextmenu', this.contextMenuHandler, true)
      }
      
      // Add mousedown handler for WikiLink clicks
      this.clickHandler = (e) => {
        // Handle left click (button 0)
        if (e.button === 0) {
          const wikiLinkElements = view.dom.querySelectorAll('.cm-wikilink-exists, .cm-wikilink-missing, .cm-wikilink-checking')
          
          for (const linkEl of wikiLinkElements) {
            if (linkEl.contains(e.target) || linkEl === e.target) {
              const noteName = linkEl.getAttribute('data-wikilink')
              const exists = linkEl.getAttribute('data-exists') === 'true'
              
              console.log('WikiLink clicked:', noteName, 'exists:', exists)
              
              if (noteName) {
                e.preventDefault()
                e.stopPropagation()
                
                // Small delay to ensure event doesn't interfere with editor
                setTimeout(() => {
                  this.handleWikiLinkClick(noteName, exists)
                }, 10)
                
                return false
              }
            }
          }
        }
      }
      
      view.dom.addEventListener('mousedown', this.clickHandler, true)

      this.contextMenuHandler = (e) => {
        const wikiLinkElements = view.dom.querySelectorAll('.cm-wikilink-exists, .cm-wikilink-missing, .cm-wikilink-checking')

        for (const linkEl of wikiLinkElements) {
          if (linkEl.contains(e.target) || linkEl === e.target) {
            const noteName = linkEl.getAttribute('data-wikilink')
            const exists = linkEl.getAttribute('data-exists') === 'true'
            const from = Number.parseInt(linkEl.getAttribute('data-wikilink-from') || '', 10)
            const to = Number.parseInt(linkEl.getAttribute('data-wikilink-to') || '', 10)

            if (!noteName || !Number.isInteger(from) || !Number.isInteger(to)) {
              return
            }

            e.preventDefault()
            e.stopPropagation()
            showWikiLinkContextMenu(e, {
              instance: this,
              view,
              noteName,
              exists,
              from,
              to
            })
            return false
          }
        }
      }

      view.dom.addEventListener('contextmenu', this.contextMenuHandler, true)
    }
    
    async handleWikiLinkClick(noteName, exists, options = {}) {
      try {
        // TID links navigate to the source note where the task resides
        const isTid = /^tid\s*:/i.test(noteName)
        if (isTid) {
          const uuid = noteName.split(':', 2)[1].trim()
          if (!uuid) {
            throw new Error('Missing task ID in TID link')
          }
          const { invoke } = await import('@tauri-apps/api/core')
          try {
            const source = await invoke('get_task_source_by_id', { taskId: uuid })
            if (source && source.filePath) {
              console.log(`Opening task source note for ${uuid}: ${source.filePath} (line ${source.lineNumber})`)
              await this.openExistingNote(source.filePath, `TID:${uuid}`, options)
              // Optionally, emit event to jump to line if frontend listens
              try { await invoke('open_file_at_line', { filePath: source.filePath, lineNumber: source.lineNumber }) } catch {}
              return
            }
          } catch (err) {
            console.warn('Failed to resolve TID to source note, falling back:', err)
          }
          // Fall through to normal WikiLink handling if resolution failed
        }

        // Normal WikiLink: resolve by note title via cache
        const result = await wikiLinkCache.checkNoteExists(noteName)
        if (result.exists && result.path) {
          console.log(`Opening existing note: ${noteName} at path: ${result.path}`)
          await this.openExistingNote(result.path, noteName, options)
        } else {
          console.log(`Note "${noteName}" doesn't exist - showing creation dialog`)
          await this.handleNoteCreation(noteName, options)
        }
      } catch (error) {
        console.error('Error handling WikiLink click:', error);
        // Show user-friendly error message
        this.showErrorMessage(`Failed to navigate to "${noteName}": ${error.message}`);
      }
    }
    
    async openExistingNote(filePath, noteName, options = {}) {
      try {
        if (options.openInNewTab && typeof window.openFileInNewTab === 'function') {
          console.log(`📂 Opening in new tab via openFileInNewTab: ${filePath}`)
          await window.openFileInNewTab(filePath)
          return
        }

        if (typeof window.handleFileClick === 'function') {
          console.log(`📂 Navigating via handleFileClick: ${filePath}`)
          await window.handleFileClick(filePath, false)
          return
        }

        // Get TabManager from global window or windowContext
        const tabManager = window.tabManager || window.windowContext?.getComponent('tabManager');
        
        if (!tabManager) {
          throw new Error('TabManager not available');
        }
        
        console.log(`📂 Opening existing note: ${filePath}`);
        
        // Check if tab already exists for this file
        const existingTab = tabManager.findTabByPath(filePath);
        
        if (existingTab) {
          // Tab already exists, just activate it
          console.log(`🔍 Found existing tab for ${filePath}, activating`);
          tabManager.activateTab(existingTab.id);
        } else {
          // Load file content and create new tab
          console.log(`📖 Loading content for ${filePath}`);
          const { invoke } = await import('@tauri-apps/api/core');
          const content = await invoke('read_file_content', { filePath: filePath });
          
          // Create and activate new tab
          console.log(`📝 Creating new tab for ${filePath}`);
          const tabId = await tabManager.openFile(filePath, content);
          console.log(`✅ Successfully opened ${noteName} in tab ${tabId}`);
        }
      } catch (error) {
        console.error('Error opening existing note:', error);
        throw error;
      }
    }
    
    async handleNoteCreation(noteName, options = {}) {
      try {
        // Show confirmation dialog
        const shouldCreate = await this.showNoteCreationDialog(noteName);
        
        if (!shouldCreate) {
          console.log(`User cancelled creation of note: ${noteName}`);
          return;
        }
        
        console.log(`🆕 Creating new note: ${noteName}`);
        
        // Create the note using Tauri command
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('create_note_from_wikilink', { noteName: noteName });
        
        // Open the newly created note
        await this.openExistingNote(result.path, noteName, options);
        
        console.log(`✅ Successfully created and opened ${noteName}`);
        
        // Invalidate cache to update WikiLink styling
        wikiLinkCache.invalidateAll();
        
        // Also invalidate autocompletion cache
        import('./wikilink-autocompletion.js').then(module => {
          module.invalidateNotesCache();
        }).catch(console.error);
        
      } catch (error) {
        console.error('Error creating note:', error);
        throw error;
      }
    }

    editWikiLink(context) {
      if (!context?.view || !Number.isInteger(context.from) || !Number.isInteger(context.to)) {
        return
      }

      const selectionStart = Math.min(context.to, context.from + 2)
      const selectionEnd = Math.max(selectionStart, context.to - 2)

      context.view.focus()
      context.view.dispatch({
        selection: {
          anchor: selectionStart,
          head: selectionEnd
        },
        scrollIntoView: true
      })
    }
    
    async showNoteCreationDialog(noteName) {
      return new Promise((resolve) => {
        // Create modern confirmation dialog
        const dialog = document.createElement('div');
        dialog.className = 'wikilink-creation-dialog-overlay';
        dialog.innerHTML = `
          <div class="wikilink-creation-dialog">
            <div class="dialog-header">
              <h3>Create New Note</h3>
            </div>
            <div class="dialog-content">
              <p>The note "<strong>${this.escapeHtml(noteName)}</strong>" doesn't exist yet.</p>
              <p>Would you like to create it?</p>
            </div>
            <div class="dialog-actions">
              <button class="dialog-cancel-btn" type="button">Cancel</button>
              <button class="dialog-create-btn" type="button">Create Note</button>
            </div>
          </div>
        `;
        
        // Add styles for the dialog
        if (!document.querySelector('#wikilink-dialog-styles')) {
          const styles = document.createElement('style');
          styles.id = 'wikilink-dialog-styles';
          styles.textContent = `
            .wikilink-creation-dialog-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.5);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 10000;
              backdrop-filter: blur(2px);
            }
            
            .wikilink-creation-dialog {
              background: var(--background-color, #ffffff);
              border: 1px solid var(--border-color, #e0e0e0);
              border-radius: 8px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
              width: 400px;
              max-width: 90vw;
              color: var(--text-color, #333333);
            }
            
            .dialog-header {
              padding: 20px 24px 16px;
              border-bottom: 1px solid var(--border-color, #e0e0e0);
            }
            
            .dialog-header h3 {
              margin: 0;
              font-size: 18px;
              font-weight: 600;
              color: var(--text-color, #333333);
            }
            
            .dialog-content {
              padding: 20px 24px;
            }
            
            .dialog-content p {
              margin: 0 0 12px 0;
              line-height: 1.5;
            }
            
            .dialog-content p:last-child {
              margin-bottom: 0;
            }
            
            .dialog-actions {
              padding: 16px 24px 20px;
              display: flex;
              gap: 12px;
              justify-content: flex-end;
            }
            
            .dialog-cancel-btn, .dialog-create-btn {
              padding: 8px 16px;
              border-radius: 6px;
              border: 1px solid;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
              transition: all 0.2s;
            }
            
            .dialog-cancel-btn {
              background: transparent;
              border-color: var(--border-color, #d0d0d0);
              color: var(--text-color, #666666);
            }
            
            .dialog-cancel-btn:hover {
              background: var(--hover-color, #f5f5f5);
            }
            
            .dialog-create-btn {
              background: var(--primary-color, #2e6da4);
              border-color: var(--primary-color, #2e6da4);
              color: white;
            }
            
            .dialog-create-btn:hover {
              background: var(--primary-hover-color, #1a4d7a);
              border-color: var(--primary-hover-color, #1a4d7a);
            }
          `;
          document.head.appendChild(styles);
        }
        
        // Event handlers
        const handleCancel = () => {
          document.body.removeChild(dialog);
          resolve(false);
        };
        
        const handleCreate = () => {
          document.body.removeChild(dialog);
          resolve(true);
        };
        
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            handleCancel();
          } else if (e.key === 'Enter') {
            handleCreate();
          }
        };
        
        // Attach event listeners
        dialog.querySelector('.dialog-cancel-btn').addEventListener('click', handleCancel);
        dialog.querySelector('.dialog-create-btn').addEventListener('click', handleCreate);
        dialog.addEventListener('keydown', handleKeyDown);
        
        // Close on overlay click
        dialog.addEventListener('click', (e) => {
          if (e.target === dialog) {
            handleCancel();
          }
        });
        
        // Show dialog
        document.body.appendChild(dialog);
        
        // Focus the create button
        setTimeout(() => {
          dialog.querySelector('.dialog-create-btn').focus();
        }, 100);
      });
    }
    
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    showErrorMessage(message) {
      // Create a simple error toast
      const toast = document.createElement('div');
      toast.className = 'wikilink-error-toast';
      toast.textContent = message;
      
      // Add toast styles if not already present
      if (!document.querySelector('#wikilink-toast-styles')) {
        const styles = document.createElement('style');
        styles.id = 'wikilink-toast-styles';
        styles.textContent = `
          .wikilink-error-toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dc3545;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            z-index: 10001;
            max-width: 400px;
            font-size: 14px;
            animation: slideInRight 0.3s ease-out;
          }
          
          @keyframes slideInRight {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `;
        document.head.appendChild(styles);
      }
      
      document.body.appendChild(toast);
      
      // Remove toast after 5 seconds
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 5000);
    }
    
    destroy() {
      if (this.clickHandler && this.view) {
        this.view.dom.removeEventListener('mousedown', this.clickHandler, true)
      }
      if (this.contextMenuHandler && this.view) {
        this.view.dom.removeEventListener('contextmenu', this.contextMenuHandler, true)
      }
    }
  },
  {
    decorations: v => v.decorations,

    provide: plugin => EditorView.atomicRanges.of(view => {
      const p = view.plugin(plugin)
      return p ? p.atomicDecorations : Decoration.none
    })
  }
)

// Styles for WikiLinks
export const wikiLinkStyles = EditorView.theme({
  '.cm-wikilink-exists': {
    color: '#2e6da4',
    textDecoration: 'none',
    cursor: 'pointer',
    borderBottom: '1px solid #2e6da4',
    transition: 'all 0.2s',
    position: 'relative',
    zIndex: 1,
    backgroundColor: 'rgba(46, 109, 164, 0.1)',
    borderRadius: '2px',
    padding: '1px 2px'
  },
  
  '.cm-wikilink-exists:hover': {
    color: '#1a4d7a',
    borderBottomColor: '#1a4d7a',
    backgroundColor: 'rgba(46, 109, 164, 0.2)'
  },
  
  '.cm-wikilink-missing': {
    color: '#dc3545',
    textDecoration: 'none',
    cursor: 'pointer',
    borderBottom: '1px dashed #dc3545',
    transition: 'all 0.2s',
    position: 'relative',
    zIndex: 1,
    backgroundColor: 'rgba(220, 53, 69, 0.1)',
    borderRadius: '2px',
    padding: '1px 2px'
  },
  
  '.cm-wikilink-missing:hover': {
    color: '#a02834',
    borderBottomColor: '#a02834',
    backgroundColor: 'rgba(220, 53, 69, 0.2)'
  },
  
  '.cm-wikilink-checking': {
    color: '#6c757d',
    textDecoration: 'none',
    cursor: 'pointer',
    borderBottom: '1px dotted #6c757d',
    transition: 'all 0.2s',
    position: 'relative',
    zIndex: 1,
    backgroundColor: 'rgba(108, 117, 125, 0.1)',
    borderRadius: '2px',
    padding: '1px 2px',
    opacity: 0.8
  },
  
  '.cm-wikilink-checking:hover': {
    color: '#495057',
    borderBottomColor: '#495057',
    backgroundColor: 'rgba(108, 117, 125, 0.2)',
    opacity: 1
  },

  // TID link variants (light blue theme), regardless of existence state
  '.cm-wikilink-exists.cm-tid-link': {
    color: '#3aa8f7',
    borderBottomColor: '#3aa8f7',
    backgroundColor: 'rgba(58, 168, 247, 0.12)'
  },
  '.cm-wikilink-exists.cm-tid-link:hover': {
    color: '#1f8ee6',
    borderBottomColor: '#1f8ee6',
    backgroundColor: 'rgba(58, 168, 247, 0.2)'
  },
  '.cm-wikilink-missing.cm-tid-link': {
    color: '#3aa8f7',
    borderBottomColor: '#3aa8f7',
    backgroundColor: 'rgba(58, 168, 247, 0.12)'
  },
  '.cm-wikilink-missing.cm-tid-link:hover': {
    color: '#1f8ee6',
    borderBottomColor: '#1f8ee6',
    backgroundColor: 'rgba(58, 168, 247, 0.2)'
  },
  '.cm-wikilink-checking.cm-tid-link': {
    color: '#3aa8f7',
    borderBottomColor: '#3aa8f7',
    backgroundColor: 'rgba(58, 168, 247, 0.08)',
    opacity: 1
  },
  '.cm-wikilink-checking.cm-tid-link:hover': {
    color: '#1f8ee6',
    borderBottomColor: '#1f8ee6',
    backgroundColor: 'rgba(58, 168, 247, 0.16)'
  }
})
