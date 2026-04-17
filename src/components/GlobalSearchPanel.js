/**
 * GlobalSearchPanel - Premium-gated global search interface
 * Provides semantic search across all vaults using PACASDB
 */
import PremiumGate from './PremiumGate.js';

export default class GlobalSearchPanel {
  constructor(entitlementManager, pacasdbClient = null) {
    this.entitlementManager = entitlementManager;
    this.pacasdbClient = pacasdbClient;
    this.element = null;
    this.searchInput = null;
    this.modeSelector = null;
    this.vaultFilter = null;
    this.resultsContainer = null;
    this.contextStatsElement = null;
    this.endSessionBtn = null;
    this.isLoading = false;
    this.debounceTimer = null;
    this.contextId = null;
    this.isCognitiveMode = false;
  }

  /**
   * Render the search panel
   * @returns {HTMLElement}
   */
  render() {
    if (this.element) {
      return this.element;
    }

    // Check premium access first
    const gate = PremiumGate.wrap(this.entitlementManager, 'Global Search');
    if (gate) {
      this.element = gate.render();
      return this.element;
    }

    // Premium enabled - show search interface
    const container = document.createElement('div');
    container.className = 'global-search-panel';

    // Search input
    const searchContainer = document.createElement('div');
    searchContainer.className = 'search-container';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Search across all vaults...';
    this.searchInput.className = 'search-input';
    this.searchInput.addEventListener('input', (e) => this.onSearchInput(e.target.value));
    searchContainer.appendChild(this.searchInput);

    // Controls row
    const controlsRow = document.createElement('div');
    controlsRow.className = 'search-controls';

    // Mode selector
    this.modeSelector = document.createElement('select');
    this.modeSelector.className = 'search-mode';

    const modes = [
      { value: 'hybrid', label: 'Hybrid Search' },
      { value: 'semantic', label: 'Semantic' },
      { value: 'keyword', label: 'Keyword' },
      { value: 'cognitive', label: 'Cognitive' }
    ];

    modes.forEach(mode => {
      const option = document.createElement('option');
      option.value = mode.value;
      option.textContent = mode.label;
      this.modeSelector.appendChild(option);
    });

    this.modeSelector.addEventListener('change', () => this.onModeChange());

    controlsRow.appendChild(this.modeSelector);

    // Vault filter
    this.vaultFilter = document.createElement('select');
    this.vaultFilter.className = 'vault-filter';

    const allVaultsOption = document.createElement('option');
    allVaultsOption.value = 'all';
    allVaultsOption.textContent = 'All Vaults';
    this.vaultFilter.appendChild(allVaultsOption);

    controlsRow.appendChild(this.vaultFilter);

    // Context stats (hidden by default, shown in cognitive mode)
    this.contextStatsElement = document.createElement('div');
    this.contextStatsElement.className = 'context-stats';
    this.contextStatsElement.style.display = 'none';
    controlsRow.appendChild(this.contextStatsElement);

    // End session button (hidden by default, shown in cognitive mode)
    this.endSessionBtn = document.createElement('button');
    this.endSessionBtn.className = 'end-session-btn';
    this.endSessionBtn.textContent = 'End Session';
    this.endSessionBtn.style.display = 'none';
    this.endSessionBtn.addEventListener('click', () => this.endCognitiveSession());
    controlsRow.appendChild(this.endSessionBtn);

    // Results container
    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'search-results';

    // Assemble panel
    container.appendChild(searchContainer);
    container.appendChild(controlsRow);
    container.appendChild(this.resultsContainer);

    this.element = container;
    return container;
  }

  /**
   * Handle search input with debouncing
   * @param {string} query - Search query
   */
  onSearchInput(query) {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Handle empty input
    if (query === '') {
      this.resultsContainer.innerHTML = '';
      return;
    }

    // Ignore queries less than 2 characters
    if (query.length < 2) {
      return;
    }

    // Debounce search execution (300ms)
    this.debounceTimer = setTimeout(() => {
      this.performSearch(query);
    }, 300);
  }

  /**
   * Handle mode selector change
   * Creates context when switching to cognitive, clears when leaving
   * @returns {Promise<void>}
   */
  async onModeChange() {
    const mode = this.modeSelector.value;

    if (mode === 'cognitive') {
      // Switching TO cognitive mode
      if (!this.isCognitiveMode && this.pacasdbClient) {
        try {
          const result = await this.pacasdbClient.createContext();
          this.contextId = result.context_id;
          this.isCognitiveMode = true;

          // Show cognitive UI elements
          if (this.contextStatsElement) {
            this.contextStatsElement.style.display = 'block';
          }
          if (this.endSessionBtn) {
            this.endSessionBtn.style.display = 'block';
          }
        } catch (error) {
          console.error('Failed to create cognitive context:', error);
        }
      }
    } else {
      // Switching FROM cognitive mode to other mode
      if (this.isCognitiveMode) {
        this.endCognitiveSession();
      }
    }
  }

  /**
   * Execute search query
   * @param {string} query - Search query
   * @returns {Promise<void>}
   */
  async performSearch(query) {
    if (!this.pacasdbClient) {
      return;
    }

    this.isLoading = true;

    try {
      const mode = this.modeSelector.value;
      let results;

      // Use cognitive think operation if in cognitive mode
      if (mode === 'cognitive' && this.contextId) {
        results = await this.pacasdbClient.think(this.contextId, query, 10);
      } else {
        // Regular search for other modes
        const searchParams = {
          mode: mode
        };

        // Different modes send different query types
        if (mode === 'keyword') {
          searchParams.keywords = query;
        } else {
          searchParams.text = query;
        }

        results = await this.pacasdbClient.search(searchParams);
      }

      this.isLoading = false;
      this.renderResults(results);

      // Update context stats if in cognitive mode
      if (mode === 'cognitive' && results.context_stats) {
        this.updateContextStats(results.context_stats);
      }

    } catch (error) {
      this.isLoading = false;
      console.error('Search error:', error);
    }
  }

  /**
   * Render search results
   * @param {Object} results - Search results from PACASDB
   */
  renderResults(results) {
    this.resultsContainer.innerHTML = '';

    if (!results.items || results.items.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = 'No results found';
      this.resultsContainer.appendChild(noResults);
      return;
    }

    results.items.forEach(item => {
      const resultCard = document.createElement('div');
      resultCard.className = 'search-result';

      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = item.title;
      resultCard.appendChild(title);

      const content = document.createElement('div');
      content.className = 'result-content';
      content.textContent = item.content;
      resultCard.appendChild(content);

      if (item.score !== undefined) {
        const score = document.createElement('div');
        score.className = 'result-score';
        score.textContent = `Score: ${item.score.toFixed(2)}`;
        resultCard.appendChild(score);
      }

      // Show activation score in cognitive mode
      if (this.isCognitiveMode && item.activation !== undefined) {
        const activation = document.createElement('div');
        activation.className = 'result-activation';
        activation.textContent = `Activation: ${item.activation.toFixed(2)}`;
        resultCard.appendChild(activation);
      }

      // Add Mark Useful button in cognitive mode
      if (this.isCognitiveMode && item.id) {
        const markUsefulBtn = document.createElement('button');
        markUsefulBtn.className = 'mark-useful-btn';
        markUsefulBtn.textContent = 'Mark Useful';
        markUsefulBtn.addEventListener('click', () => this.markItemUseful(item.id));
        resultCard.appendChild(markUsefulBtn);
      }

      this.resultsContainer.appendChild(resultCard);
    });
  }

  /**
   * Mark a result as useful in cognitive context
   * @param {string} docId - Document ID
   * @returns {Promise<void>}
   */
  async markItemUseful(docId) {
    if (!this.contextId || !this.pacasdbClient) {
      return;
    }

    try {
      await this.pacasdbClient.markUseful(this.contextId, docId);
      // Could add visual feedback here (e.g., show success message)
    } catch (error) {
      console.error('Failed to mark item useful:', error);
    }
  }

  /**
   * Update context stats display
   * @param {Object} stats - Context statistics
   */
  updateContextStats(stats) {
    if (!this.contextStatsElement) {
      return;
    }

    this.contextStatsElement.textContent = `Active: ${stats.active_items} | Activations: ${stats.total_activations} | Avg: ${stats.avg_activation.toFixed(2)}`;
  }

  /**
   * End cognitive session and clear context
   */
  endCognitiveSession() {
    if (this.pacasdbClient) {
      this.pacasdbClient.clearContext();
    }

    this.contextId = null;
    this.isCognitiveMode = false;

    // Hide cognitive UI elements
    if (this.contextStatsElement) {
      this.contextStatsElement.style.display = 'none';
      this.contextStatsElement.textContent = '';
    }
    if (this.endSessionBtn) {
      this.endSessionBtn.style.display = 'none';
    }
  }

  /**
   * Remove the panel from DOM
   */
  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Clean up cognitive session if active
    if (this.isCognitiveMode) {
      this.endCognitiveSession();
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.searchInput = null;
    this.modeSelector = null;
    this.vaultFilter = null;
    this.resultsContainer = null;
    this.contextStatsElement = null;
    this.endSessionBtn = null;
  }
}
