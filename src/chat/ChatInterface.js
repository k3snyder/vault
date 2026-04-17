// ChatInterface.js - Message display and input system
import { icons } from '../icons/icon-utils.js';
import { ToolUseCard } from '../components/ToolUseCard.js';

console.log('[ChatInterface] loading...');

export class ChatInterface {
  constructor() {
    console.log('[ChatInterface] Initializing');
    this.messages = [];
    this.container = null;
    this.messagesContainer = null;
    this.inputContainer = null;
    this.onSendMessage = null;
    this.isTyping = false;
    this.currentContext = [];
    this.contextDialogOverlay = null;
    this.activeToolCards = new Map(); // Track tool cards by ID

    // Load saved messages
    this.loadMessages();
  }

  normalizeTaskMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      return null;
    }

    const normalized = {};
    const name = this.normalizeMessageContent(meta.name || 'Task created').trim();
    normalized.name = name || 'Task created';

    if (typeof meta.gateway_task_id === 'string' && meta.gateway_task_id.trim()) {
      normalized.gateway_task_id = meta.gateway_task_id.trim();
    }

    if (typeof meta.group_id === 'string' && meta.group_id.trim()) {
      normalized.group_id = meta.group_id.trim();
    }

    if (Array.isArray(meta.child_task_ids)) {
      normalized.child_task_ids = meta.child_task_ids
        .filter(item => typeof item === 'string' && item.trim())
        .map(item => item.trim());
    }

    if (Array.isArray(meta.child_agent_types)) {
      normalized.child_agent_types = meta.child_agent_types
        .filter(item => typeof item === 'string' && item.trim())
        .map(item => item.trim());
    }

    if (typeof meta.group_status === 'string' && meta.group_status.trim()) {
      normalized.group_status = meta.group_status.trim();
    }

    if (Number.isFinite(Number(meta.expected_children))) {
      normalized.expected_children = Number(meta.expected_children);
    }

    if (Number.isFinite(Number(meta.completed_children))) {
      normalized.completed_children = Number(meta.completed_children);
    }

    if (Number.isFinite(Number(meta.failed_children))) {
      normalized.failed_children = Number(meta.failed_children);
    }

    return normalized;
  }

  getTaskMetaKey(meta) {
    if (!meta || typeof meta !== 'object') {
      return '';
    }

    if (typeof meta.gateway_task_id === 'string' && meta.gateway_task_id.trim()) {
      return `task:${meta.gateway_task_id.trim()}`;
    }

    if (typeof meta.group_id === 'string' && meta.group_id.trim()) {
      return `group:${meta.group_id.trim()}`;
    }

    return '';
  }
  
  mount(container) {
    console.log('[ChatInterface] Mounting');
    this.container = container;
    container.innerHTML = '';
    
    // Messages container
    this.messagesContainer = document.createElement('div');
    this.messagesContainer.className = 'chat-messages';
    
    // Show welcome message or render saved messages
    if (this.messages.length === 0) {
      this.showWelcomeMessage();
    } else {
      this.renderMessages();
    }
    
    // Input container
    this.inputContainer = document.createElement('div');
    this.inputContainer.className = 'chat-input-container';
    this.createInputUI();
    
    // Assemble - Input at top, messages below (Cursor style)
    container.appendChild(this.inputContainer);
    container.appendChild(this.messagesContainer);
    
    // Listen for tab changes to update context indicator
    setInterval(() => {
      this.updateContextIndicator();
    }, 1000);
  }
  
  showWelcomeMessage() {
    const welcome = document.createElement('div');
    welcome.className = 'chat-welcome';
    welcome.innerHTML = `
      <h3>Welcome to AI Chat!</h3>
      <p>I can help you understand and work with your notes.</p>
      <div class="chat-tips">
        <div class="chat-tip">
          <span class="tip-icon">${icons.fileText({ size: 16 })}</span>
          <span>Your current note is automatically included as context</span>
        </div>
        <div class="chat-tip">
          <span class="tip-icon">${icons.plus({ size: 16 })}</span>
          <span>Click "Add Context" to include more notes in the conversation</span>
        </div>
        <div class="chat-tip">
          <span class="tip-icon">${icons.download({ size: 16 })}</span>
          <span>Export chats to save them permanently in "Chat History" folder</span>
        </div>
        <div class="chat-tip">
          <span class="tip-icon">${icons.copy({ size: 16 })}</span>
          <span>Copy any AI response with the copy button</span>
        </div>
      </div>
    `;
    this.messagesContainer.appendChild(welcome);
  }
  
  createInputUI() {
    // Context indicator with Add Context button
    const contextIndicator = document.createElement('div');
    contextIndicator.className = 'chat-context-indicator';
    contextIndicator.id = 'chat-context-indicator';
    this.updateContextIndicator();
    
    // Input wrapper
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'chat-input-wrapper';
    
    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'chat-input';
    textarea.placeholder = 'Ask about your notes...';
    textarea.rows = 1;
    textarea.id = 'chat-input-field';
    
    // Auto-resize textarea
    textarea.addEventListener('input', (e) => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
    
    // Handle enter key
    textarea.addEventListener('keydown', (e) => {
      // Send message on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
      
      // Clear chat on Cmd/Ctrl+Shift+K
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        if (confirm('Clear chat history?')) {
          this.clearMessages();
        }
      }
      
      // Quick focus with / (when not typing)
      if (e.key === '/' && document.activeElement !== textarea) {
        e.preventDefault();
        textarea.focus();
      }
    });
    
    // Add textarea to wrapper
    inputWrapper.appendChild(textarea);
    
    // Create controls bar
    const controlsBar = document.createElement('div');
    controlsBar.className = 'chat-input-controls';
    
    // Left controls (placeholder for future features)
    const leftControls = document.createElement('div');
    leftControls.className = 'chat-input-left-controls';
    
    // Send button
    const sendBtn = document.createElement('button');
    sendBtn.className = 'chat-send-btn';
    sendBtn.title = 'Send message';
    sendBtn.innerHTML = icons.send({ size: 18 });
    sendBtn.onclick = () => this.sendMessage();
    
    // Assemble controls bar
    controlsBar.appendChild(leftControls);
    controlsBar.appendChild(sendBtn);
    inputWrapper.appendChild(controlsBar);
    
    // Add context indicator to the top of the input wrapper
    inputWrapper.insertBefore(contextIndicator, inputWrapper.firstChild);
    
    // Create a wrapper div for proper alignment
    const contentWrapper = document.createElement('div');
    contentWrapper.style.width = '100%';
    contentWrapper.appendChild(inputWrapper);
    
    // Assemble input container
    this.inputContainer.appendChild(contentWrapper);
  }
  
  updateContextIndicator() {
    const indicator = document.getElementById('chat-context-indicator');
    if (!indicator) return;
    
    // Get active note from pane manager
    let activeNote = null;
    if (window.paneManager) {
      const activeTab = window.paneManager.getActiveTabManager()?.getActiveTab();
      if (activeTab && activeTab.title) {
        activeNote = {
          title: activeTab.title,
          path: activeTab.filePath
        };
      }
    }
    
    // Combine active note with additional context
    const allContext = [];
    if (activeNote) {
      allContext.push(activeNote);
    }
    allContext.push(...this.currentContext);
    
    // Always show the indicator so Add Context button is visible
    indicator.style.display = 'flex';
    indicator.replaceChildren();
    
    // Add Context button
    const addContextBtn = document.createElement('button');
    addContextBtn.className = 'add-context-btn';
    addContextBtn.textContent = '+ Add Context';
    addContextBtn.onclick = () => this.showContextDialog();
    indicator.appendChild(addContextBtn);
    
    // Show context pills
    allContext.forEach((note, index) => {
      const pill = document.createElement('div');
      pill.className = 'context-pill';
      if (index === 0 && activeNote) {
        pill.classList.add('active-note');
      }
      
      const isActiveNote = index === 0 && activeNote;
      const displayName = note.title || note.name || 'Untitled';

      const label = document.createElement('span');
      label.textContent = displayName;
      pill.appendChild(label);

      if (!isActiveNote) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-context';
        removeBtn.type = 'button';
        removeBtn.dataset.path = note.path;
        removeBtn.textContent = '×';
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          this.removeFromContext(note.path);
        };
        pill.appendChild(removeBtn);
      }
      
      indicator.appendChild(pill);
    });
  }
  
  updateContext(context) {
    console.log('[ChatInterface] Updating context:', context);
    this.currentContext = context;
    this.updateContextIndicator();
  }
  
  removeFromContext(path) {
    console.log('[ChatInterface] Removing from context:', path);
    this.currentContext = this.currentContext.filter(note => note.path !== path);
    this.updateContextIndicator();
    
    // Also remove from context manager
    if (window.chatContextManager) {
      window.chatContextManager.removeNote(path);
    }
  }
  
  showContextDialog() {
    console.log('[ChatInterface] Showing context dialog');
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'context-dialog-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        this.closeContextDialog();
      }
    };
    
    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'context-dialog';
    
    // Dialog header
    const header = document.createElement('div');
    header.className = 'context-dialog-header';

    const title = document.createElement('h3');
    title.textContent = 'Add Context';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.className = 'context-dialog-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.onclick = () => this.closeContextDialog();
    header.appendChild(closeButton);
    
    // Search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'context-search-input';
    searchInput.placeholder = 'Type to search notes...';
    searchInput.autofocus = true;
    
    // Results container
    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'context-search-results';
    resultsContainer.id = 'context-search-results';
    
    // Set up search
    searchInput.addEventListener('input', async (e) => {
      const query = e.target.value.trim();
      await this.searchForContext(query, resultsContainer);
    });
    
    // Assemble dialog
    dialog.appendChild(header);
    dialog.appendChild(searchInput);
    dialog.appendChild(resultsContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Store reference for closing
    this.contextDialogOverlay = overlay;
    
    // Initial search with empty query to show recent files
    this.searchForContext('', resultsContainer);
  }
  
  closeContextDialog() {
    if (this.contextDialogOverlay) {
      this.contextDialogOverlay.remove();
      this.contextDialogOverlay = null;
    }
  }
  
  async searchForContext(query, resultsContainer) {
    try {
      const results = await window.chatContextManager.searchNotes(query);
      
      resultsContainer.replaceChildren();
      
      if (results.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'no-results';
        emptyState.textContent = 'No notes found';
        resultsContainer.appendChild(emptyState);
        return;
      }
      
      results.forEach(note => {
        const resultItem = document.createElement('div');
        resultItem.className = 'context-result-item';
        
        const displayName = note.name.replace('.md', '');
        const path = note.path.split('/').slice(0, -1).join('/') || 'root';

        const resultName = document.createElement('div');
        resultName.className = 'result-name';
        resultName.textContent = displayName;
        resultItem.appendChild(resultName);

        const resultPath = document.createElement('div');
        resultPath.className = 'result-path';
        resultPath.textContent = path;
        resultItem.appendChild(resultPath);
        
        resultItem.onclick = () => {
          this.addNoteToContext(note);
          this.closeContextDialog();
        };
        
        resultsContainer.appendChild(resultItem);
      });
    } catch (error) {
      console.error('Error searching notes:', error);
      resultsContainer.replaceChildren();
      const errorState = document.createElement('div');
      errorState.className = 'error';
      errorState.textContent = 'Error searching notes';
      resultsContainer.appendChild(errorState);
    }
  }
  
  addNoteToContext(note) {
    console.log('[ChatInterface] Adding note to context:', note);
    
    // Check if already in context
    const exists = this.currentContext.find(n => n.path === note.path);
    if (!exists) {
      this.currentContext.push({
        name: note.name,
        path: note.path,
        title: note.name.replace('.md', '')
      });
      this.updateContextIndicator();
      
      // Add to context manager
      if (window.chatContextManager) {
        window.chatContextManager.addNote(note.path, note.name);
      }
    }
  }
  
  
  sendMessage() {
    const textarea = document.getElementById('chat-input-field');
    const message = textarea.value.trim();
    
    if (!message) return;
    
    console.log('[ChatInterface] Sending message:', message);
    
    // Clear input
    textarea.value = '';
    textarea.style.height = 'auto';
    
    
    // Hide welcome message if present
    const welcome = this.messagesContainer.querySelector('.chat-welcome');
    if (welcome) {
      welcome.remove();
    }
    
    // Notify parent
    if (this.onSendMessage) {
      this.onSendMessage(message);
    }
  }
  
  addMessage(message) {
    console.log('[ChatInterface] Adding message:', message.type);
    
    // Hide typing indicator if this is an assistant message
    if (message.type === 'assistant') {
      this.hideTyping();
    }
    
    this.messages.push(message);
    
    // For newest-at-top display, we need to prepend the new message
    const messageEl = this.createMessageElement(message);
    this.messagesContainer.insertBefore(messageEl, this.messagesContainer.firstChild);
    
    this.scrollToTop();
    
    // Save messages after adding (skip typing indicators and context)
    if (message.type !== 'typing' && message.type !== 'context') {
      this.saveMessages();
    }
  }

  addTaskCreated(meta = {}) {
    const normalizedMeta = this.normalizeTaskMeta(meta);
    const taskKey = this.getTaskMetaKey(normalizedMeta);

    if (!normalizedMeta || !taskKey) {
      return null;
    }

    const existingIndex = this.messages.findIndex(message => {
      if (message.type !== 'task_created') {
        return false;
      }
      return this.getTaskMetaKey(message.meta) === taskKey;
    });

    if (existingIndex !== -1) {
      const existingMessage = this.messages[existingIndex];
      this.messages[existingIndex] = {
        ...existingMessage,
        content: normalizedMeta.name,
        meta: normalizedMeta,
      };
      this.saveMessages();
      return this.messages[existingIndex];
    }

    const messageId = `task-created-${taskKey.replace(/[^a-zA-Z0-9:_-]/g, '-')}`;
    const message = {
      id: messageId,
      type: 'task_created',
      content: normalizedMeta.name,
      timestamp: new Date(),
      meta: normalizedMeta,
    };

    this.addMessage(message);
    return message;
  }
  
  addElement(element) {
    console.log('[ChatInterface] Adding custom element to chat');

    // Insert the element at the top (newest first)
    this.messagesContainer.insertBefore(element, this.messagesContainer.firstChild);
    this.scrollToTop();
  }

  // Tool Use Card Management
  addToolUse(toolId, toolName, toolInput) {
    console.log('[ChatInterface] Adding tool use:', toolName);

    try {
      const card = new ToolUseCard({
        id: toolId,
        toolName: toolName,
        toolInput: toolInput,
        status: 'running'
      });

      this.activeToolCards.set(toolId, card);

      // Insert tool card at top (newest first)
      this.messagesContainer.insertBefore(card.getElement(), this.messagesContainer.firstChild);
      this.scrollToTop();

      return card;
    } catch (error) {
      console.error('[ChatInterface] Failed to render tool use card:', error);
      return null;
    }
  }

  updateToolResult(toolId, result) {
    console.log('[ChatInterface] Updating tool result:', toolId);

    const card = this.activeToolCards.get(toolId);
    if (card) {
      try {
        card.setResult(result);
      } catch (error) {
        console.error('[ChatInterface] Failed to update tool result card:', error);
      }
    }
  }

  setToolStatus(toolId, status) {
    const card = this.activeToolCards.get(toolId);
    if (card) {
      card.setStatus(status);
    }
  }

  clearToolCards() {
    this.activeToolCards.clear();
  }
  
  updateMessage(messageId, newContent) {
    // Find message in array
    const messageIndex = this.messages.findIndex(m => m.id === messageId);
    if (messageIndex !== -1) {
      this.messages[messageIndex].content = this.normalizeMessageContent(newContent);
      
      // Update DOM element
      const messageEl = document.querySelector(`${this.getMessageSelector(messageId)} .message-content`);
      if (messageEl) {
        // Re-render the markdown into DOM nodes to avoid HTML injection
        this.renderMarkdownContent(messageEl, newContent);
        
        // Add cursor for streaming effect
        if (!messageEl.querySelector('.streaming-cursor')) {
          const cursor = document.createElement('span');
          cursor.className = 'streaming-cursor';
          cursor.textContent = '▊';
          messageEl.appendChild(cursor);
        }
        
        // For newest-at-top, we don't need to scroll during updates
        // The user can naturally scroll down as they read
      }
    }
  }
  
  
  finalizeStreamingMessage(messageId) {
    // Remove streaming cursor
    const messageEl = document.querySelector(`${this.getMessageSelector(messageId)} .streaming-cursor`);
    if (messageEl) {
      messageEl.remove();
    }
    
    // Save after streaming completes
    this.saveMessages();
  }
  
  createMessageElement(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message chat-message-${message.type}`;
    if (message.id) {
      messageEl.setAttribute('data-message-id', message.id);
    }
    
    // Header with avatar and timestamp
    const header = document.createElement('div');
    header.className = 'message-header';
    
    // Avatar with timestamp
    const avatarText = message.type === 'user' ? 'You' : 
                      message.type === 'assistant' ? 'AI' : 
                      message.type === 'error' ? 'Error' : 
                      message.type === 'context' ? 'Context' :
                      message.type === 'task_created' ? 'Task' : '?';
    
    const timeString = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';

    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.textContent = avatarText;
    header.appendChild(avatar);

    if (timeString) {
      header.appendChild(document.createTextNode(' '));
      const timestamp = document.createElement('span');
      timestamp.className = 'message-timestamp';
      timestamp.textContent = timeString;
      header.appendChild(timestamp);
    }
    
    // Content
    const content = document.createElement('div');
    content.className = 'message-content';
    const normalizedContent = this.normalizeMessageContent(message.content);
    
    // Handle markdown formatting
    if (message.type === 'assistant') {
      this.renderMarkdownContent(content, normalizedContent);
    } else if (message.type === 'task_created') {
      content.classList.add('task-created-content');
      this.renderTaskCreatedContent(content, message.meta, normalizedContent);
    } else if (message.type === 'context') {
      // Style context messages differently
      const isMentioned = normalizedContent.includes('(mentioned)');
      const contextLabel = document.createElement('span');
      contextLabel.className = `context-label${isMentioned ? ' context-mentioned' : ''}`;
      contextLabel.textContent = normalizedContent;
      content.appendChild(contextLabel);
    } else {
      content.textContent = normalizedContent;
    }
    
    // Assemble
    messageEl.appendChild(header);
    messageEl.appendChild(content);
    
    // Add copy button for assistant messages
    if (message.type === 'assistant') {
      const actionsBar = document.createElement('div');
      actionsBar.className = 'message-actions-bar';
      
      const copyBtn = document.createElement('button');
      copyBtn.className = 'message-copy-btn';
      copyBtn.title = 'Copy response';
      copyBtn.innerHTML = `${icons.copy({ size: 14 })}<span>Copy</span>`;
      
      copyBtn.onclick = async () => {
        try {
          // Copy the raw markdown content
          await navigator.clipboard.writeText(message.content);
          
          // Visual feedback
          const originalHTML = copyBtn.innerHTML;
          copyBtn.innerHTML = `${icons.check({ size: 14 })}<span>Copied!</span>`;
          copyBtn.classList.add('copied');
          
          setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      };
      
      actionsBar.appendChild(copyBtn);
      messageEl.appendChild(actionsBar);
    }
    
    return messageEl;
  }

  renderTaskCreatedContent(container, meta = {}, fallbackText = '') {
    const doc = container.ownerDocument || document;
    const normalizedMeta = this.normalizeTaskMeta(meta) || {};
    const card = doc.createElement('div');
    card.className = 'task-created-card';

    const title = doc.createElement('div');
    title.className = 'task-created-title';
    title.textContent = normalizedMeta.name || fallbackText || 'Task created';
    card.appendChild(title);

    const primaryId = normalizedMeta.gateway_task_id || normalizedMeta.group_id || '';
    if (primaryId) {
      const idRow = doc.createElement('div');
      idRow.className = 'task-created-meta';
      const label = normalizedMeta.gateway_task_id ? 'Task ID' : 'Group ID';
      idRow.textContent = `${label}: ${primaryId}`;
      card.appendChild(idRow);
    }

    if (typeof normalizedMeta.group_status === 'string' && normalizedMeta.group_status) {
      const statusRow = doc.createElement('div');
      statusRow.className = 'task-created-meta';
      let statusText = `Status: ${normalizedMeta.group_status}`;
      if (
        typeof normalizedMeta.completed_children === 'number' &&
        typeof normalizedMeta.expected_children === 'number'
      ) {
        statusText += ` (${normalizedMeta.completed_children}/${normalizedMeta.expected_children} completed`;
        if (typeof normalizedMeta.failed_children === 'number') {
          statusText += `, ${normalizedMeta.failed_children} failed`;
        }
        statusText += ')';
      }
      statusRow.textContent = statusText;
      card.appendChild(statusRow);
    }

    container.replaceChildren(card);
  }
  
  renderMessage(message) {
    // Safety check - ensure container exists
    if (!this.messagesContainer) {
      console.warn('[ChatInterface] Messages container not ready, skipping render');
      return;
    }
    
    const messageEl = this.createMessageElement(message);
    this.messagesContainer.appendChild(messageEl);
  }
  
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  normalizeMessageContent(content) {
    if (content === null || content === undefined) {
      return '';
    }
    return typeof content === 'string' ? content : String(content);
  }

  getMessageSelector(messageId) {
    const safeId = this.normalizeMessageContent(messageId);
    const escapedId = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(safeId)
      : safeId.replace(/["\\]/g, '\\$&');

    return `[data-message-id="${escapedId}"]`;
  }

  isSafeLinkHref(href) {
    const value = this.normalizeMessageContent(href).trim();
    if (!value) {
      return false;
    }

    if (/^(https?:|mailto:|tel:)/i.test(value)) {
      return true;
    }

    return /^([/#]|\.{1,2}\/)/.test(value);
  }

  appendInlineMarkdown(parent, text) {
    const content = this.normalizeMessageContent(text);
    if (!content) {
      return;
    }

    const doc = parent.ownerDocument || document;
    const tokenPattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(content)) !== null) {
      if (match.index > lastIndex) {
        this.appendTextWithBreaks(parent, content.slice(lastIndex, match.index), doc);
      }

      if (match[1] !== undefined) {
        const code = doc.createElement('code');
        code.className = 'inline-code';
        code.textContent = match[1];
        parent.appendChild(code);
      } else if (match[2] !== undefined) {
        const label = match[2];
        const href = match[3];
        if (this.isSafeLinkHref(href)) {
          const link = doc.createElement('a');
          link.href = href.trim();
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = label;
          parent.appendChild(link);
        } else {
          parent.appendChild(doc.createTextNode(label));
        }
      } else if (match[4] !== undefined) {
        const strong = doc.createElement('strong');
        this.appendInlineMarkdown(strong, match[4]);
        parent.appendChild(strong);
      } else if (match[5] !== undefined) {
        const em = doc.createElement('em');
        this.appendInlineMarkdown(em, match[5]);
        parent.appendChild(em);
      }

      lastIndex = tokenPattern.lastIndex;
    }

    if (lastIndex < content.length) {
      this.appendTextWithBreaks(parent, content.slice(lastIndex), doc);
    }
  }

  appendTextWithBreaks(parent, text, doc = parent.ownerDocument || document) {
    const parts = this.normalizeMessageContent(text).split(/\r?\n/);
    parts.forEach((part, index) => {
      if (index > 0) {
        parent.appendChild(doc.createElement('br'));
      }
      if (part) {
        parent.appendChild(doc.createTextNode(part));
      }
    });
  }

  renderMarkdownContent(container, text) {
    const doc = container.ownerDocument || document;
    const fragment = doc.createDocumentFragment();
    const lines = this.normalizeMessageContent(text).split(/\r?\n/);

    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (line.startsWith('```')) {
        const fenceLine = line;
        const language = fenceLine.slice(3).trim().replace(/[^\w-]/g, '') || 'plaintext';
        index += 1;

        const codeLines = [];
        while (index < lines.length && !lines[index].startsWith('```')) {
          codeLines.push(lines[index]);
          index += 1;
        }

        if (index < lines.length && lines[index].startsWith('```')) {
          index += 1;
        }

        const pre = doc.createElement('pre');
        pre.className = 'code-block';
        const code = doc.createElement('code');
        code.className = `language-${language}`;
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        fragment.appendChild(pre);
        continue;
      }

      if (/^(\*|-)\s+/.test(line)) {
        const list = doc.createElement('ul');
        while (index < lines.length && /^(\*|-)\s+/.test(lines[index])) {
          const item = doc.createElement('li');
          this.appendInlineMarkdown(item, lines[index].replace(/^(\*|-)\s+/, ''));
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }

      if (line.trim() === '') {
        index += 1;
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        lines[index].trim() !== '' &&
        !lines[index].startsWith('```') &&
        !/^(\*|-)\s+/.test(lines[index])
      ) {
        paragraphLines.push(lines[index]);
        index += 1;
      }

      const paragraph = doc.createElement('p');
      paragraphLines.forEach((paragraphLine, lineIndex) => {
        if (lineIndex > 0) {
          paragraph.appendChild(doc.createElement('br'));
        }
        this.appendInlineMarkdown(paragraph, paragraphLine);
      });
      fragment.appendChild(paragraph);
    }

    container.replaceChildren(fragment);
  }

  renderMessages() {
    this.messagesContainer.innerHTML = '';
    // Render messages in reverse order so newest appear at top
    this.messages.slice().reverse().forEach(msg => this.renderMessage(msg));
    this.scrollToTop();
  }
  
  showTyping(isOllama = false) {
    if (this.isTyping) return;
    
    console.log('[ChatInterface] Showing typing indicator');
    this.isTyping = true;
    this.typingStartTime = Date.now();
    
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-message chat-message-assistant';
    typingEl.id = 'typing-indicator';
    
    // Header with avatar and timestamp
    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerHTML = '<span class="message-avatar">AI</span> <span class="message-timestamp">' + new Date().toLocaleTimeString() + '</span>';
    
    // Content
    const content = document.createElement('div');
    content.className = 'message-content thinking';
    content.textContent = 'Thinking...';
    
    // If Ollama, set up extended status updates
    if (isOllama) {
      this.typingInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.typingStartTime) / 1000);
        if (elapsed > 10 && elapsed <= 30) {
          content.textContent = 'Processing... This may take a moment with local models.';
        } else if (elapsed > 30 && elapsed <= 60) {
          content.textContent = 'Still processing... Large responses can take up to a minute.';
        } else if (elapsed > 60) {
          content.textContent = `Still processing... (${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed). Ollama may need more time for complex responses.`;
        }
      }, 5000); // Update every 5 seconds
    }
    
    // Assemble
    typingEl.appendChild(header);
    typingEl.appendChild(content);
    
    // Insert at the top for newest-first display
    this.messagesContainer.insertBefore(typingEl, this.messagesContainer.firstChild);
    this.scrollToTop();
  }
  
  hideTyping() {
    console.log('[ChatInterface] Hiding typing indicator');
    this.isTyping = false;
    
    // Clear the interval if it exists
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    
    const typingEl = document.getElementById('typing-indicator');
    if (typingEl) {
      typingEl.remove();
    }
  }
  
  clearMessages() {
    console.log('[ChatInterface] Clearing all messages');
    this.messages = [];
    this.renderMessages();
    this.showWelcomeMessage();
    
    // Clear from localStorage
    localStorage.removeItem('gaimplan-chat-messages');
  }
  
  getMessages() {
    return this.messages;
  }
  
  scrollToTop() {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = 0;
      }
    }, 10);
  }
  
  scrollToBottom() {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }
    }, 10);
  }
  
  // Persistence methods
  saveMessages() {
    try {
      const toSave = this.messages.map(msg => ({
        id: msg.id,
        type: msg.type,
        content: this.normalizeMessageContent(msg.content),
        timestamp: msg.timestamp,
        name: msg.name,
        path: msg.path,
        title: msg.title,
        meta: msg.meta && typeof msg.meta === 'object' ? msg.meta : undefined
      })).filter(msg => msg.type && msg.type !== 'typing' && msg.type !== 'context');
      
      localStorage.setItem('gaimplan-chat-messages', JSON.stringify(toSave));
      console.log('[ChatInterface] Saved', toSave.length, 'messages');
    } catch (error) {
      console.error('[ChatInterface] Failed to save messages:', error);
    }
  }
  
  loadMessages() {
    try {
      const saved = localStorage.getItem('gaimplan-chat-messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.messages = Array.isArray(parsed)
          ? parsed
              .map(msg => this.normalizeStoredMessage(msg))
              .filter(Boolean)
          : [];

        const sanitized = JSON.stringify(this.messages);
        if (sanitized !== saved) {
          localStorage.setItem('gaimplan-chat-messages', sanitized);
        }

        console.log('[ChatInterface] Loaded', this.messages.length, 'messages');
      }
    } catch (error) {
      console.error('[ChatInterface] Failed to load messages:', error);
      this.messages = [];
    }
  }

  normalizeStoredMessage(message) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    const type = typeof message.type === 'string' ? message.type : '';
    const allowedTypes = new Set(['user', 'assistant', 'error', 'context', 'task_created']);
    if (!allowedTypes.has(type)) {
      return null;
    }

    const normalized = {
      type,
      content: this.normalizeMessageContent(message.content)
    };

    if (message.id !== undefined && message.id !== null) {
      normalized.id = String(message.id);
    }

    if (message.timestamp !== undefined && message.timestamp !== null) {
      normalized.timestamp = message.timestamp;
    }

    if (typeof message.name === 'string') {
      normalized.name = message.name;
    }

    if (typeof message.path === 'string') {
      normalized.path = message.path;
    }

    if (typeof message.title === 'string') {
      normalized.title = message.title;
    }

    if (message.meta && typeof message.meta === 'object') {
      normalized.meta = this.normalizeTaskMeta(message.meta) || message.meta;
    }

    return normalized;
  }
  
  
}
