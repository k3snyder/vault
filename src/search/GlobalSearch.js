import { invoke } from '@tauri-apps/api/core';
import { icons } from '../icons/icon-utils.js';

export class GlobalSearch {
  constructor() {
    this.container = null;
    this.isVisible = false;
    this.searchMode = 'hybrid'; // Default to hybrid (PACASDB semantic + keyword)
    this.currentQuery = '';
    this.searchResults = [];
    this.selectedIndex = -1;

    // Bind methods
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.toggle = this.toggle.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleSearch = this.handleSearch.bind(this);
  }

  /**
   * Check if PACASDB search is available (premium enabled + connected)
   */
  isPacasdbAvailable() {
    const client = window.pacasdbClient;
    const entitlementManager = window.entitlementManager;

    if (!client || !entitlementManager) {
      return false;
    }

    return entitlementManager.isPremiumEnabled() && client.isConnected();
  }

  mount() {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'global-search-overlay';
    // Don't set display: none here - let show() control visibility
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      backdrop-filter: blur(4px);
      pointer-events: auto;
      visibility: hidden;
      opacity: 0;
    `;

    // Create search panel
    const panel = document.createElement('div');
    panel.className = 'global-search-panel';
    panel.style.cssText = `
      position: absolute;
      top: 20%;
      left: 50%;
      transform: translateX(-50%);
      width: 600px;
      max-width: 90vw;
      background: var(--bg-primary, #1e1e1e);
      border: 1px solid var(--border-color, #333);
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      z-index: 2147483647;
      pointer-events: auto;
    `;

    panel.innerHTML = `
      <div class="search-header" style="
        padding: 16px;
        border-bottom: 1px solid var(--border-color);
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <input type="text" 
            class="search-input" 
            placeholder="Search notes..."
            style="
              flex: 1;
              padding: 8px 12px;
              background: var(--bg-secondary);
              border: 1px solid var(--border-color);
              border-radius: 6px;
              color: var(--text-primary);
              font-size: 14px;
              outline: none;
            ">
          <div class="search-mode-toggle" style="
            display: flex;
            background: var(--bg-secondary);
            border-radius: 6px;
            padding: 2px;
          ">
            <button class="mode-btn keyword-mode" data-mode="keyword" style="
              padding: 6px 12px;
              background: transparent;
              border: none;
              color: var(--text-secondary);
              font-size: 12px;
              cursor: pointer;
              border-radius: 4px;
              transition: all 0.2s;
            ">Keyword</button>
            <button class="mode-btn semantic-mode" data-mode="semantic" style="
              padding: 6px 12px;
              background: transparent;
              border: none;
              color: var(--text-secondary);
              font-size: 12px;
              cursor: pointer;
              border-radius: 4px;
              transition: all 0.2s;
            ">Semantic</button>
            <button class="mode-btn hybrid-mode active" data-mode="hybrid" style="
              padding: 6px 12px;
              background: var(--accent-color);
              border: none;
              color: white;
              font-size: 12px;
              cursor: pointer;
              border-radius: 4px;
              transition: all 0.2s;
            ">Hybrid</button>
          </div>
          <button class="sync-btn" title="Sync vault to Qdrant" style="
            padding: 6px 12px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            color: var(--text-primary);
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
          ">
            ${icons.eye({ size: 14 })}
            Sync
          </button>
        </div>
        <div class="search-hint" style="
          margin-top: 8px;
          font-size: 11px;
          color: var(--text-secondary);
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span class="mode-description">Finding conceptually similar notes using AI embeddings</span>
          <span class="sync-status" style="display: none;"></span>
        </div>
      </div>
      <div class="search-results" style="
        max-height: 400px;
        overflow-y: auto;
      ">
        <div class="search-placeholder" style="
          padding: 40px;
          text-align: center;
          color: var(--text-secondary);
        ">
          Start typing to search your notes
        </div>
      </div>
    `;

    this.container.appendChild(panel);
    document.body.appendChild(this.container);

    // Set up event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Click outside to close
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.hide();
      }
    });

    // Search input
    const input = this.container.querySelector('.search-input');
    let searchTimeout;
    input.addEventListener('input', (e) => {
      this.currentQuery = e.target.value;
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.handleSearch();
      }, 300); // Debounce
    });

    // Mode toggle
    const modeBtns = this.container.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.searchMode = btn.dataset.mode;
        this.updateModeUI();
        if (this.currentQuery) {
          this.handleSearch();
        }
      });
    });

    // Keyboard navigation
    input.addEventListener('keydown', this.handleKeyDown);

    // Sync button
    const syncBtn = this.container.querySelector('.sync-btn');
    syncBtn.addEventListener('click', () => this.handleSync());
  }

  updateModeUI() {
    const modeBtns = this.container.querySelectorAll('.mode-btn');
    const modeDesc = this.container.querySelector('.mode-description');
    
    modeBtns.forEach(btn => {
      if (btn.dataset.mode === this.searchMode) {
        btn.classList.add('active');
        btn.style.background = 'var(--accent-color)';
        btn.style.color = 'white';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
      }
    });

    const descriptions = {
      'keyword': 'Searching for exact keyword matches',
      'semantic': 'Finding conceptually similar notes using AI embeddings',
      'hybrid': 'Combining graph relationships and semantic similarity for comprehensive results'
    };
    modeDesc.textContent = descriptions[this.searchMode] || descriptions.hybrid;
  }

  async handleSearch() {
    if (!this.currentQuery.trim()) {
      this.displayPlaceholder();
      return;
    }

    try {
      const resultsContainer = this.container.querySelector('.search-results');
      resultsContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
          Searching...
        </div>
      `;

      let results = [];

      // Semantic and Hybrid modes require PACASDB Premium
      console.log('🔍 handleSearch - mode:', this.searchMode);
      console.log('🔍 handleSearch - isPacasdbAvailable:', this.isPacasdbAvailable());

      if (this.searchMode === 'semantic' || this.searchMode === 'hybrid') {
        if (!this.isPacasdbAvailable()) {
          console.log('🔍 PACASDB not available, showing premium required');
          this.displayPremiumRequired();
          return;
        }
        results = await this.performPacasdbSearch(this.currentQuery);
        this.searchResults = results;
        this.displayResults(results);
        return;
      }

      // Keyword mode - use simple file search
      if (this.searchMode === 'keyword') {
        results = await this.performKeywordSearch(this.currentQuery);
        this.searchResults = results;
        this.displayResults(results);
        return;
      }

      // Legacy fallback (should not reach here)
      if (this.searchMode === 'hybrid' || this.searchMode === 'semantic') {
        try {
          const mode = this.searchMode === 'semantic' ? 'semantic' : 'hybrid';
          const searchResults = await invoke('search_with_mode', {
            query: this.currentQuery,
            mode,
            maxResults: 20
          });

          results = searchResults.map(r => ({
            note: {
              path: r.file_path,
              title: r.title || r.file_path.split('/').pop(),
              content: r.preview || ''
            },
            score: r.rrf_score || r.relevance_score,
            matchType: r.match_type,
            relationshipPath: r.relationship_path,
            graphRank: r.graph_rank,
            semanticRank: r.semantic_rank
          }));
        } catch (error) {
          console.error('Search failed:', error);
          results = await this.performKeywordSearch(this.currentQuery);
        }
      } else {
        results = await this.performKeywordSearch(this.currentQuery);
      }

      this.searchResults = results;
      this.displayResults(results);
    } catch (error) {
      console.error('Search failed:', error);
      this.displayError(error.message || 'Search failed');
    }
  }

  displayResults(results) {
    const resultsContainer = this.container.querySelector('.search-results');
    
    if (!results || results.length === 0) {
      resultsContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
          No results found for "${this.currentQuery}"
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = results.map((result, index) => `
      <div class="search-result-item" data-index="${index}" style="
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-color);
        cursor: pointer;
        transition: background 0.2s;
      ">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div class="result-title" style="
              font-weight: 500;
              color: var(--text-primary);
              margin-bottom: 4px;
            ">${this.escapeHtml(result.note.title)}</div>
            <div class="result-path" style="
              font-size: 11px;
              color: var(--text-secondary);
              margin-bottom: 4px;
            ">${this.escapeHtml(result.note.path)}</div>
            <div class="result-preview" style="
              font-size: 12px;
              color: var(--text-secondary);
              overflow: hidden;
              text-overflow: ellipsis;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
            ">${this.escapeHtml(this.getPreview(result.note.content))}</div>
          </div>
          ${this.searchMode === 'semantic' ? `
            <div class="result-score" style="
              font-size: 11px;
              color: var(--accent-color);
              margin-left: 12px;
              white-space: nowrap;
            ">${Math.round(result.score * 100)}%</div>
          ` : ''}
          ${this.searchMode === 'hybrid' && result.matchType ? `
            <div style="
              display: flex;
              flex-direction: column;
              align-items: flex-end;
              gap: 4px;
              margin-left: 12px;
            ">
              <div class="match-type" style="
                font-size: 10px;
                padding: 2px 6px;
                background: ${this.getMatchTypeColor(result.matchType)};
                color: white;
                border-radius: 3px;
                text-transform: capitalize;
              ">${result.matchType}</div>
              ${result.graphRank && result.semanticRank ? `
                <div style="
                  font-size: 10px;
                  color: var(--text-secondary);
                ">G:${result.graphRank} S:${result.semanticRank}</div>
              ` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');

    // Add hover and click handlers
    const items = resultsContainer.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });
      
      item.addEventListener('click', () => {
        this.openResult(index);
      });
    });
  }

  displayPlaceholder() {
    const resultsContainer = this.container.querySelector('.search-results');
    resultsContainer.innerHTML = `
      <div class="search-placeholder" style="
        padding: 40px;
        text-align: center;
        color: var(--text-secondary);
      ">
        Start typing to search your notes
      </div>
    `;
  }

  displayPremiumRequired() {
    const resultsContainer = this.container.querySelector('.search-results');
    const entitlementManager = window.entitlementManager;
    const pacasdbClient = window.pacasdbClient;

    // Determine the specific issue
    let message = '';
    let actionText = '';

    if (!entitlementManager || !entitlementManager.isPremiumEnabled()) {
      message = 'Semantic and Hybrid search require PACASDB Premium.';
      actionText = 'Go to Settings → PACASDB Premium to activate your license.';
    } else if (!pacasdbClient || !pacasdbClient.isConnected()) {
      message = 'PACASDB server is not connected.';
      actionText = 'Go to Settings → PACASDB Premium to connect to your PACASDB server.';
    }

    resultsContainer.innerHTML = `
      <div style="
        padding: 40px;
        text-align: center;
      ">
        <div style="
          margin-bottom: 16px;
          display: flex;
          justify-content: center;
        ">${icons.lock({ size: 32 })}</div>
        <div style="
          color: var(--text-primary);
          font-weight: 500;
          margin-bottom: 8px;
        ">${message}</div>
        <div style="
          color: var(--text-secondary);
          font-size: 13px;
          margin-bottom: 16px;
        ">${actionText}</div>
        <div style="
          color: var(--text-secondary);
          font-size: 12px;
        ">Use <strong>Keyword</strong> mode for basic file name search.</div>
      </div>
    `;
  }

  displayError(error) {
    const resultsContainer = this.container.querySelector('.search-results');
    resultsContainer.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--error-color);">
        Error: ${this.escapeHtml(error)}
      </div>
    `;
  }

  getPreview(content, maxLength = 150) {
    // Remove markdown formatting for preview
    const plainText = content
      .replace(/^#+\s+/gm, '') // Headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
      .replace(/\*([^*]+)\*/g, '$1') // Italic
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/`([^`]+)`/g, '$1') // Inline code
      .replace(/\n+/g, ' ') // Newlines
      .trim();
    
    return plainText.length > maxLength 
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  }

  handleKeyDown(e) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.searchResults.length - 1);
        this.updateSelection();
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
        this.updateSelection();
        break;
      
      case 'Enter':
        e.preventDefault();
        if (this.selectedIndex >= 0) {
          this.openResult(this.selectedIndex);
        }
        break;
    }
  }

  updateSelection() {
    const items = this.container.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.style.background = 'var(--bg-hover)';
      } else {
        item.style.background = 'transparent';
      }
    });

    // Scroll selected item into view
    if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
      items[this.selectedIndex].scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }

  async openResult(index) {
    const result = this.searchResults[index];
    if (!result) return;

    try {
      let filePath = result.note.path;
      
      // Check if this is a neo4j node ID that needs resolution
      if (result.needs_resolution && filePath && !filePath.includes('/') && !filePath.includes('.')) {
        // This looks like a node ID, resolve it
        const resolvedPath = await invoke('resolve_node_id_to_path', { nodeId: filePath });
        if (resolvedPath) {
          filePath = resolvedPath;
        } else {
          console.error('Could not resolve node ID to path:', filePath);
          alert(`Could not find file for node ID: ${filePath}`);
          return;
        }
      }
      
      // Open the note in the editor
      await window.openFile(filePath);
      this.hide();
    } catch (error) {
      console.error('Failed to open file:', error);
      alert(`Failed to open file: ${error.message || error}`);
    }
  }

  show() {
    console.log('GlobalSearch.show() called, container exists:', !!this.container);
    if (!this.container) {
      this.mount();
    }
    
    // Force visibility with important styles to ensure it works after vault switches
    this.container.style.setProperty('display', 'block', 'important');
    this.container.style.setProperty('visibility', 'visible', 'important');
    this.container.style.setProperty('opacity', '1', 'important');
    this.container.style.setProperty('position', 'fixed', 'important');
    this.container.style.setProperty('top', '0', 'important');
    this.container.style.setProperty('left', '0', 'important');
    this.container.style.setProperty('right', '0', 'important');
    this.container.style.setProperty('bottom', '0', 'important');
    this.container.style.setProperty('background', 'rgba(0, 0, 0, 0.5)', 'important');
    this.container.style.setProperty('z-index', '2147483647', 'important');
    this.container.style.setProperty('backdrop-filter', 'blur(4px)', 'important');
    this.container.style.setProperty('pointer-events', 'auto', 'important');
    
    this.isVisible = true;
    this.selectedIndex = -1;
    
    // Focus search input
    const input = this.container.querySelector('.search-input');
    if (input) {
      input.focus();
      input.select();
    }
  }

  hide() {
    if (this.container) {
      // First blur any focused element in the search panel to prevent focus issues
      const activeElement = this.container.querySelector(':focus');
      if (activeElement) {
        activeElement.blur();
      }
      
      this.container.style.setProperty('display', 'none', 'important');
      this.container.style.setProperty('visibility', 'hidden', 'important');
      this.container.style.setProperty('opacity', '0', 'important');
    }
    this.isVisible = false;
    
    // Return focus to the editor to prevent any lingering focus issues
    // Use a small delay to ensure the hide transition completes first
    setTimeout(() => {
      const activeTab = window.tabManager?.getActiveTab();
      if (activeTab?.editor) {
        activeTab.editor.focus();
      }
    }, 10);
  }
  
  cleanup() {
    console.log('GlobalSearch.cleanup() called');
    // First hide if visible
    if (this.isVisible) {
      this.hide();
    }
    // Then remove from DOM
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.isVisible = false;
  }

  toggle() {
    console.log('GlobalSearch.toggle() called, isVisible:', this.isVisible, 'container:', !!this.container);
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  getMatchTypeColor(matchType) {
    const colors = {
      'direct': '#4CAF50',      // Green for direct matches
      'tagged': '#2196F3',      // Blue for tag matches
      'linked': '#FF9800',      // Orange for linked notes
      'related': '#9C27B0',     // Purple for related notes
      'semantic': '#00BCD4',    // Cyan for semantic matches
      'hybrid': '#F44336'       // Red for hybrid matches
    };
    return colors[matchType.toLowerCase()] || '#757575';
  }
  
  parseQdrantResults(responseText) {
    const patterns = [];
    
    const lines = responseText.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Look for similarity scores
      if (line.includes('Similarity:')) {
        const scoreMatch = line.match(/Similarity:\s*([\d.]+)/);
        if (scoreMatch) {
          const score = parseFloat(scoreMatch[1]);
          let name = '';
          let neo4j_node_id = null;
          let file_path = null;
          
          // Look for pattern details in the following lines
          for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
            const detailLine = lines[j];
            
            // Extract pattern name
            const patternMatch = detailLine.match(/•\s*Pattern:\s*(.+)/);
            if (patternMatch) {
              name = patternMatch[1].trim();
            }
            
            // Extract Neo4j ID
            const idMatch = detailLine.match(/•\s*Neo4j ID:\s*(\S+)/);
            if (idMatch && idMatch[1] !== 'none') {
              neo4j_node_id = idMatch[1].trim();
            }
            
            // Extract file path
            const pathMatch = detailLine.match(/•\s*File Path:\s*(.+)/);
            if (pathMatch && pathMatch[1] !== 'none') {
              file_path = pathMatch[1].trim();
            }
          }
          
          if (name || neo4j_node_id || file_path) {
            patterns.push({ name, score, neo4j_node_id, file_path });
          }
        }
      }
    }
    
    return patterns;
  }
  
  async loadNotesFromPatterns(patterns) {
    const results = [];
    
    // Get the file tree to find notes by name
    try {
      const fileTree = await invoke('get_file_tree');
      const files = this.flattenFileTree(fileTree);
      
      for (const pattern of patterns) {
        // If we have a file_path from Qdrant, use it directly
        if (pattern.file_path) {
          // Don't try to read content here - just pass the file path
          results.push({
            note: {
              title: pattern.name || pattern.file_path.split('/').pop().replace(/\.md$/, ''),
              path: pattern.file_path,
              content: '' // Content will be loaded when file is opened
            },
            score: pattern.score,
            neo4j_node_id: pattern.neo4j_node_id,
            needs_resolution: false // We have the file path, no resolution needed
          });
        } else if (pattern.neo4j_node_id) {
          // If we only have neo4j_node_id, mark for resolution
          results.push({
            note: {
              title: pattern.name || 'Untitled',
              path: pattern.neo4j_node_id, // This will be resolved later
              content: `Pattern: ${pattern.name || 'Unknown'}`
            },
            score: pattern.score,
            neo4j_node_id: pattern.neo4j_node_id,
            needs_resolution: true
          });
        } else {
          // Fall back to finding by name
          const file = files.find(f => {
            const fileName = f.name.replace(/\.md$/, '');
            return fileName === pattern.name || 
                   fileName.toLowerCase() === pattern.name.toLowerCase();
          });
          
          if (file) {
            try {
              const content = await invoke('read_file_content', { 
                filePath: file.path 
              });
              
              results.push({
                note: {
                  title: pattern.name,
                  path: file.path,
                  content: content
                },
                score: pattern.score
              });
            } catch (error) {
              console.error(`Failed to read file ${file.path}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load notes:', error);
    }
    
    return results;
  }
  
  flattenFileTree(fileTree) {
    const files = [];
    
    if (fileTree && fileTree.files) {
      for (const file of fileTree.files) {
        if (!file.is_dir && file.name.endsWith('.md')) {
          files.push(file);
        }
      }
    }
    
    return files;
  }
  
  /**
   * Perform search using PACASDB (premium feature)
   */
  async performPacasdbSearch(query) {
    const client = window.pacasdbClient;
    console.log('🔍 performPacasdbSearch called with:', query);
    console.log('🔍 client:', client);
    console.log('🔍 client.isConnected():', client?.isConnected());

    if (!client) {
      throw new Error('PACASDB client not available');
    }

    try {
      const searchParams = {
        k: 20,
        currentVaultOnly: true
      };

      // Set search type based on mode
      if (this.searchMode === 'hybrid') {
        searchParams.text = query;
        searchParams.keywords = query.split(/\s+/);
      } else if (this.searchMode === 'semantic') {
        searchParams.text = query;
      }

      console.log('🔍 searchParams:', searchParams);
      const response = await client.search(searchParams, window.currentVaultId);
      console.log('🔍 PACASDB response:', response);

      // Transform PACASDB results to match display format
      // Response structure: { items: [{ doc_id, rank, score, document: { content: {title, body}, metadata: {file_path} } }] }
      const results = [];
      if (response && response.items) {
        for (const item of response.items) {
          const doc = item.document || {};
          const content = doc.content || {};
          const metadata = doc.metadata || {};

          results.push({
            note: {
              title: content.title || metadata.file_path?.split('/').pop()?.replace('.md', '') || 'Untitled',
              path: metadata.file_path || '',
              content: content.body || ''
            },
            score: item.score || 0,
            matchType: this.searchMode === 'hybrid' ? 'hybrid' : 'semantic'
          });
        }
      }

      return results;
    } catch (error) {
      console.error('PACASDB search failed:', error);
      // Fall back to keyword search
      return this.performKeywordSearch(query);
    }
  }

  async performKeywordSearch(query) {
    // Simple keyword search in file names and content
    const results = [];
    const queryLower = query.toLowerCase();
    
    try {
      const fileTree = await invoke('get_file_tree');
      const files = this.flattenFileTree(fileTree);
      
      for (const file of files) {
        const fileName = file.name.toLowerCase();
        
        // Check if query matches file name
        if (fileName.includes(queryLower)) {
          try {
            const content = await invoke('read_file_content', { 
              filePath: file.path 
            });
            
            results.push({
              note: {
                title: file.name.replace(/\.md$/, ''),
                path: file.path,
                content: content
              },
              score: 1.0 // File name match gets high score
            });
          } catch (error) {
            console.error(`Failed to read file ${file.path}:`, error);
          }
        }
      }
      
      // Sort by score
      results.sort((a, b) => b.score - a.score);
    } catch (error) {
      console.error('Keyword search failed:', error);
    }
    
    return results.slice(0, 20); // Limit to 20 results
  }

  /**
   * Handle sync to PACASDB (premium feature)
   */
  async handlePacasdbSync(syncStatus, syncBtn, style) {
    const vaultSync = window.vaultSync;
    if (!vaultSync) {
      throw new Error('VaultSync not available');
    }

    syncStatus.textContent = 'Syncing to PACASDB...';

    // Listen for progress events
    const progressHandler = (event) => {
      const { progress, indexed, total } = event.detail;
      syncStatus.textContent = `Syncing to PACASDB: ${indexed}/${total} (${progress}%)`;
    };
    window.addEventListener('vault-sync-progress', progressHandler);

    try {
      const vaultPath = window.currentVaultPath || '';
      const result = await vaultSync.syncAllDocuments(vaultPath);

      syncStatus.textContent = `Sync complete: ${result.indexed}/${result.total} indexed`;
      syncStatus.style.color = result.failed > 0 ? 'var(--warning-color)' : 'var(--success-color)';

      // Reset button after delay
      setTimeout(() => {
        syncStatus.style.display = 'none';
        syncStatus.style.color = '';
      }, 5000);

    } finally {
      window.removeEventListener('vault-sync-progress', progressHandler);

      // Re-enable button
      syncBtn.disabled = false;
      syncBtn.style.opacity = '1';
      syncBtn.innerHTML = `
        ${icons.eye({ size: 14 })}
        Sync
      `;

      // Clean up style
      style.remove();
    }
  }

  async handleSync() {
    const syncBtn = this.container.querySelector('.sync-btn');
    const syncStatus = this.container.querySelector('.sync-status');

    // Disable button during sync
    syncBtn.disabled = true;
    syncBtn.style.opacity = '0.5';
    syncBtn.innerHTML = `
      ${icons.loader({ size: 14 })}
      Syncing...
    `;

    // Add spinning animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .spin {
        animation: spin 1s linear infinite;
      }
    `;
    document.head.appendChild(style);

    syncStatus.style.display = 'block';
    syncStatus.textContent = 'Preparing sync...';

    try {
      // Check if PACASDB is available
      if (!this.isPacasdbAvailable()) {
        // Show premium required message
        const entitlementManager = window.entitlementManager;
        if (!entitlementManager || !entitlementManager.isPremiumEnabled()) {
          syncStatus.textContent = 'Sync requires PACASDB Premium license';
        } else {
          syncStatus.textContent = 'Connect to PACASDB server first';
        }
        syncStatus.style.color = 'var(--warning-color)';

        setTimeout(() => {
          syncStatus.style.display = 'none';
          syncStatus.style.color = '';
        }, 3000);

        // Re-enable button
        syncBtn.disabled = false;
        syncBtn.style.opacity = '1';
        syncBtn.innerHTML = `
          ${icons.eye({ size: 14 })}
          Sync
        `;
        style.remove();
        return;
      }

      // Use PACASDB sync
      await this.handlePacasdbSync(syncStatus, syncBtn, style);
      return;

    } finally {
      // Re-enable button
      syncBtn.disabled = false;
      syncBtn.style.opacity = '1';
      syncBtn.innerHTML = `
        ${icons.eye({ size: 14 })}
        Sync
      `;

      // Clean up style
      style.remove();
    }
  }
  
  async resolveNodeIds(results) {
    // Collect all node IDs that need resolution
    const nodeIdsToResolve = [];
    results.forEach(result => {
      if (result.needs_resolution && result.note.path && 
          !result.note.path.includes('/') && !result.note.path.includes('.')) {
        nodeIdsToResolve.push(result.note.path);
      }
    });
    
    if (nodeIdsToResolve.length === 0) {
      return;
    }
    
    try {
      // Batch resolve all node IDs
      const idToPathMap = await invoke('batch_resolve_node_ids', { nodeIds: nodeIdsToResolve });
      
      // Update results with resolved paths
      results.forEach(result => {
        if (result.needs_resolution && idToPathMap[result.note.path]) {
          result.note.path = idToPathMap[result.note.path];
          result.needs_resolution = false;
        }
      });
    } catch (error) {
      console.error('Failed to batch resolve node IDs:', error);
      // Continue with unresolved IDs - they'll be resolved individually on click
    }
  }
  
  fuseSearchResults(graphResults, semanticResults) {
    // Implement Reciprocal Rank Fusion (RRF) with k=60
    const k = 60;
    const fusedScores = new Map();
    const resultMap = new Map();
    
    // Process graph results
    graphResults.forEach((result, idx) => {
      const key = result.file_path;
      const rrfScore = 1.0 / (k + idx + 1);
      fusedScores.set(key, (fusedScores.get(key) || 0) + rrfScore);
      
      // Store result with graph rank
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          ...result,
          graph_rank: idx + 1,
          semantic_rank: null
        });
      }
    });
    
    // Process semantic results
    semanticResults.forEach((result, idx) => {
      const key = result.file_path;
      const rrfScore = 1.0 / (k + idx + 1);
      fusedScores.set(key, (fusedScores.get(key) || 0) + rrfScore);
      
      // Store or update result with semantic rank
      if (resultMap.has(key)) {
        resultMap.get(key).semantic_rank = idx + 1;
        resultMap.get(key).semantic_score = result.semantic_score;
        // Preserve needs_resolution flag if it exists
        if (result.needs_resolution) {
          resultMap.get(key).needs_resolution = true;
        }
      } else {
        resultMap.set(key, {
          ...result,
          graph_rank: null,
          semantic_rank: idx + 1
        });
      }
    });
    
    // Convert to array and sort by RRF score
    const fusedResults = Array.from(resultMap.entries())
      .map(([key, result]) => ({
        note: {
          path: result.file_path,
          title: result.title || result.file_path.split('/').pop(),
          content: result.preview || ''
        },
        score: fusedScores.get(key),
        matchType: result.match_type || 'Hybrid',
        relationshipPath: result.relationship_path,
        graphRank: result.graph_rank,
        semanticRank: result.semantic_rank,
        rrf_score: fusedScores.get(key),
        needs_resolution: result.needs_resolution || false
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Limit to top 20 results
    
    return fusedResults;
  }
}

// Create singleton instance
export const globalSearch = new GlobalSearch();