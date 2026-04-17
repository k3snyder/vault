import { invoke } from '@tauri-apps/api/core'

/**
 * IntelligencePanel - Widget sidebar panel displaying PDF intelligence results
 * Renders extracted content, topics, and summary notes with export functionality
 *
 * Supports both V1 (legacy) and V2 (summarizer-compatible) schemas:
 * - V2: result.document + result.pages[] (each page is an EnrichedChunk)
 * - V1: result.extraction + result.enrichments[]
 */
export class IntelligencePanel {
  constructor() {
    this.container = null
    this.tabBar = null
    this.contentArea = null
    this.activeTab = 'summary'
    this.result = null
    this.isV2 = false // Track schema version
  }

  /**
   * Mount panel to parent element
   * @param {HTMLElement} parentElement - Parent container element
   */
  mount(parentElement) {
    // Create main container
    this.container = document.createElement('div')
    this.container.className = 'intelligence-panel'

    // Create header
    const header = this.createHeader()

    // Create tab bar
    this.tabBar = this.createTabBar()

    // Create content area
    this.contentArea = document.createElement('div')
    this.contentArea.className = 'intelligence-content'

    // Assemble panel
    this.container.appendChild(header)
    this.container.appendChild(this.tabBar)
    this.container.appendChild(this.contentArea)

    // Mount to parent
    parentElement.appendChild(this.container)

    // Render initial empty state
    this.renderEmptyState()
  }

  /**
   * Create panel header with title and export button
   * @returns {HTMLElement} Header element
   */
  createHeader() {
    const header = document.createElement('div')
    header.className = 'intelligence-header'

    const title = document.createElement('h3')
    title.textContent = 'PDF Intelligence'

    const exportBtn = document.createElement('button')
    exportBtn.className = 'intelligence-export-btn'
    exportBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export
    `
    exportBtn.title = 'Export to Markdown'
    exportBtn.addEventListener('click', () => this.handleExport())

    const controls = document.createElement('div')
    controls.className = 'intelligence-header-controls'
    controls.appendChild(exportBtn)

    header.appendChild(title)
    header.appendChild(controls)

    return header
  }

  /**
   * Create tab bar with Summary and Pages tabs
   * @returns {HTMLElement} Tab bar element
   */
  createTabBar() {
    const tabBar = document.createElement('div')
    tabBar.className = 'intelligence-tabs'

    const summaryTab = this.createTab('summary', 'Summary')
    const pagesTab = this.createTab('pages', 'Pages')

    tabBar.appendChild(summaryTab)
    tabBar.appendChild(pagesTab)

    return tabBar
  }

  /**
   * Create individual tab element
   * @param {string} id - Tab identifier
   * @param {string} label - Tab label
   * @returns {HTMLElement} Tab element
   */
  createTab(id, label) {
    const tab = document.createElement('div')
    tab.className = `intelligence-tab ${id === this.activeTab ? 'active' : ''}`
    tab.dataset.tab = id
    tab.textContent = label

    tab.addEventListener('click', () => this.setActiveTab(id))

    return tab
  }

  /**
   * Set active tab and update content
   * @param {string} tabId - Tab identifier
   */
  setActiveTab(tabId) {
    this.activeTab = tabId

    // Update tab styling
    const tabs = this.tabBar.querySelectorAll('.intelligence-tab')
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabId)
    })

    // Re-render content
    if (this.result) {
      this.renderContent()
    }
  }

  /**
   * Update panel with intelligence result
   * @param {Object} result - Intelligence result data
   */
  setResult(result) {
    this.result = result
    // Detect schema version
    this.isV2 = !!(result.document && result.pages)
    this.renderContent()
  }

  /**
   * Check if result has any enrichments (summaries, topics, vision text)
   * Used to determine panel visibility - hide for text-only extraction
   * @returns {boolean} True if enrichments exist
   */
  hasEnrichments() {
    if (!this.result) return false

    if (this.isV2) {
      // V2: Check if any page has enrichment data
      return this.result.pages.some(p =>
        (p.summaryNotes && p.summaryNotes.length > 0) ||
        (p.summaryTopics && p.summaryTopics.length > 0) ||
        (p.imageText && p.imageText.length > 0)
      )
    }

    // V1: Check enrichments array
    if (!this.result.enrichments) return false
    return this.result.enrichments.some(e =>
      (e.summaryNotes && e.summaryNotes.length > 0) ||
      (e.summaryTopics && e.summaryTopics.length > 0) ||
      (e.imageText && e.imageText.length > 0)
    )
  }

  /**
   * Render content based on active tab
   */
  renderContent() {
    this.contentArea.innerHTML = ''

    if (!this.result) {
      this.renderEmptyState()
      return
    }

    if (this.activeTab === 'summary') {
      this.renderSummaryTab()
    } else {
      this.renderPagesTab()
    }
  }

  /**
   * Render summary tab with topics cloud and key points
   */
  renderSummaryTab() {
    const summaryContent = document.createElement('div')
    summaryContent.className = 'intelligence-summary'

    // Document info
    const docInfo = this.createDocumentInfo()
    summaryContent.appendChild(docInfo)

    // All topics from all pages
    const allTopics = this.collectAllTopics()
    if (allTopics.length > 0) {
      const topicsSection = this.createTopicsSection(allTopics)
      summaryContent.appendChild(topicsSection)
    }

    // All notes from all pages
    const allNotes = this.collectAllNotes()
    if (allNotes.length > 0) {
      const notesSection = this.createNotesSection(allNotes)
      summaryContent.appendChild(notesSection)
    }

    // Processing stats
    const stats = this.createStatsSection()
    summaryContent.appendChild(stats)

    this.contentArea.appendChild(summaryContent)
  }

  /**
   * Create document information section
   * @returns {HTMLElement} Document info element
   */
  createDocumentInfo() {
    const info = document.createElement('div')
    info.className = 'intelligence-doc-info'

    const title = document.createElement('div')
    title.className = 'intelligence-doc-title'

    if (this.isV2) {
      title.textContent = this.result.document.metadata.title || this.result.document.filename
    } else {
      title.textContent = this.result.extraction.metadata.title || this.result.extraction.filename
    }

    const meta = document.createElement('div')
    meta.className = 'intelligence-doc-meta'

    const pageCount = document.createElement('span')
    pageCount.className = 'intelligence-page-count'

    if (this.isV2) {
      pageCount.textContent = `${this.result.document.total_pages} pages`
    } else {
      pageCount.textContent = `${this.result.extraction.totalPages} pages`
    }

    const author = document.createElement('span')

    if (this.isV2) {
      author.textContent = this.result.document.metadata.author || 'Unknown author'
    } else {
      author.textContent = this.result.extraction.metadata.author || 'Unknown author'
    }

    meta.appendChild(pageCount)
    meta.appendChild(author)

    info.appendChild(title)
    info.appendChild(meta)

    return info
  }

  /**
   * Collect all unique topics from all enrichments
   * @returns {Array<string>} All unique topics
   */
  collectAllTopics() {
    const topicsSet = new Set()

    if (this.isV2) {
      this.result.pages.forEach(chunk => {
        if (chunk.summaryTopics) {
          chunk.summaryTopics.forEach(topic => topicsSet.add(topic))
        }
      })
    } else {
      this.result.enrichments.forEach(enrichment => {
        if (enrichment.summaryTopics) {
          enrichment.summaryTopics.forEach(topic => topicsSet.add(topic))
        }
      })
    }

    return Array.from(topicsSet)
  }

  /**
   * Collect all notes from all enrichments
   * @returns {Array<string>} All notes
   */
  collectAllNotes() {
    const notes = []

    if (this.isV2) {
      this.result.pages.forEach(chunk => {
        if (chunk.summaryNotes) {
          notes.push(...chunk.summaryNotes)
        }
      })
    } else {
      this.result.enrichments.forEach(enrichment => {
        if (enrichment.summaryNotes) {
          notes.push(...enrichment.summaryNotes)
        }
      })
    }

    return notes
  }

  /**
   * Create topics section with clickable tags
   * @param {Array<string>} topics - Topics to display
   * @returns {HTMLElement} Topics section element
   */
  createTopicsSection(topics) {
    const section = document.createElement('div')
    section.className = 'intelligence-section'

    const header = document.createElement('h4')
    header.textContent = 'Topics'

    const topicsCloud = document.createElement('div')
    topicsCloud.className = 'intelligence-topics'

    topics.forEach(topic => {
      const tag = document.createElement('button')
      tag.className = 'intelligence-topic'
      tag.textContent = topic
      tag.addEventListener('click', () => this.handleTopicClick(topic))
      topicsCloud.appendChild(tag)
    })

    section.appendChild(header)
    section.appendChild(topicsCloud)

    return section
  }

  /**
   * Create notes section with bullet list
   * @param {Array<string>} notes - Notes to display
   * @returns {HTMLElement} Notes section element
   */
  createNotesSection(notes) {
    const section = document.createElement('div')
    section.className = 'intelligence-section'

    const header = document.createElement('h4')
    header.textContent = 'Key Points'

    const notesList = document.createElement('ul')
    notesList.className = 'intelligence-notes'

    notes.forEach(note => {
      const li = document.createElement('li')
      li.className = 'intelligence-note'
      li.textContent = note
      notesList.appendChild(li)
    })

    section.appendChild(header)
    section.appendChild(notesList)

    return section
  }

  /**
   * Create processing statistics section
   * @returns {HTMLElement} Stats section element
   */
  createStatsSection() {
    const section = document.createElement('div')
    section.className = 'intelligence-stats'

    const stats = this.result.processingStats

    const statItems = [
      { label: 'Extraction', value: `${(stats.extractionTimeMs / 1000).toFixed(1)}s` },
      { label: 'Vision', value: stats.visionTimeMs ? `${(stats.visionTimeMs / 1000).toFixed(1)}s` : 'N/A' },
      { label: 'Summarization', value: stats.summarizationTimeMs ? `${(stats.summarizationTimeMs / 1000).toFixed(1)}s` : 'N/A' }
    ]

    statItems.forEach(({ label, value }) => {
      const item = document.createElement('div')
      item.className = 'intelligence-stat-item'
      item.innerHTML = `<span class="stat-label">${label}:</span> <span class="stat-value">${value}</span>`
      section.appendChild(item)
    })

    return section
  }

  /**
   * Render pages tab with per-page details
   */
  renderPagesTab() {
    const pagesContent = document.createElement('div')
    pagesContent.className = 'intelligence-pages'

    if (this.isV2) {
      this.result.pages.forEach(chunk => {
        const pageItem = this.createPageItemV2(chunk)
        pagesContent.appendChild(pageItem)
      })
    } else {
      this.result.extraction.pages.forEach(page => {
        const pageItem = this.createPageItem(page)
        pagesContent.appendChild(pageItem)
      })
    }

    this.contentArea.appendChild(pagesContent)
  }

  /**
   * Create page item element
   * @param {Object} page - Page data
   * @returns {HTMLElement} Page item element
   */
  createPageItem(page) {
    const item = document.createElement('div')
    item.className = 'intelligence-page-item'

    // Page header
    const header = document.createElement('div')
    header.className = 'intelligence-page-header'
    header.textContent = `Page ${page.pageNumber}`

    item.appendChild(header)

    // Find enrichment for this page
    const enrichment = this.result.enrichments.find(e => e.pageNumber === page.pageNumber)

    if (enrichment) {
      // Topics for this page
      if (enrichment.summaryTopics && enrichment.summaryTopics.length > 0) {
        const topics = document.createElement('div')
        topics.className = 'intelligence-page-topics'
        enrichment.summaryTopics.forEach(topic => {
          const tag = document.createElement('span')
          tag.className = 'intelligence-topic intelligence-topic-small'
          tag.textContent = topic
          topics.appendChild(tag)
        })
        item.appendChild(topics)
      }

      // Notes for this page
      if (enrichment.summaryNotes && enrichment.summaryNotes.length > 0) {
        const notes = document.createElement('ul')
        notes.className = 'intelligence-page-notes'
        enrichment.summaryNotes.forEach(note => {
          const li = document.createElement('li')
          li.textContent = note
          notes.appendChild(li)
        })
        item.appendChild(notes)
      }

      // Relevancy score
      if (enrichment.relevancyScore) {
        const score = document.createElement('div')
        score.className = 'intelligence-relevancy'
        score.textContent = `Relevancy: ${enrichment.relevancyScore.toFixed(1)}%`
        item.appendChild(score)
      }
    }

    // Text preview (first 150 chars)
    if (page.text) {
      const preview = document.createElement('div')
      preview.className = 'intelligence-text-preview'
      preview.textContent = page.text.substring(0, 150) + (page.text.length > 150 ? '...' : '')
      item.appendChild(preview)
    }

    return item
  }

  /**
   * Create page item element for V2 schema (EnrichedChunk)
   * @param {Object} chunk - EnrichedChunk data
   * @returns {HTMLElement} Page item element
   */
  createPageItemV2(chunk) {
    const item = document.createElement('div')
    item.className = 'intelligence-page-item'

    // Page header with chunk_id
    const header = document.createElement('div')
    header.className = 'intelligence-page-header'
    const pageNumber = chunk.chunkId.replace('chunk_', '')
    header.textContent = `Page ${pageNumber}`

    item.appendChild(header)

    // Topics for this chunk (inline in V2)
    if (chunk.summaryTopics && chunk.summaryTopics.length > 0) {
      const topics = document.createElement('div')
      topics.className = 'intelligence-page-topics'
      chunk.summaryTopics.forEach(topic => {
        const tag = document.createElement('span')
        tag.className = 'intelligence-topic intelligence-topic-small'
        tag.textContent = topic
        topics.appendChild(tag)
      })
      item.appendChild(topics)
    }

    // Notes for this chunk (inline in V2)
    if (chunk.summaryNotes && chunk.summaryNotes.length > 0) {
      const notes = document.createElement('ul')
      notes.className = 'intelligence-page-notes'
      chunk.summaryNotes.forEach(note => {
        const li = document.createElement('li')
        li.textContent = note
        notes.appendChild(li)
      })
      item.appendChild(notes)
    }

    // Relevancy score
    if (chunk.summaryRelevancy) {
      const score = document.createElement('div')
      score.className = 'intelligence-relevancy'
      score.textContent = `Relevancy: ${chunk.summaryRelevancy}%`
      item.appendChild(score)
    }

    // Text preview (first 150 chars)
    if (chunk.text) {
      const preview = document.createElement('div')
      preview.className = 'intelligence-text-preview'
      preview.textContent = chunk.text.substring(0, 150) + (chunk.text.length > 150 ? '...' : '')
      item.appendChild(preview)
    }

    return item
  }

  /**
   * Render empty state
   */
  renderEmptyState() {
    this.contentArea.innerHTML = ''

    const empty = document.createElement('div')
    empty.className = 'intelligence-empty'

    const icon = document.createElement('div')
    icon.className = 'intelligence-empty-icon'
    icon.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="11" x2="12" y2="17"/>
        <line x1="9" y1="14" x2="15" y2="14"/>
      </svg>
    `

    const message = document.createElement('div')
    message.className = 'intelligence-empty-message'
    message.textContent = 'No intelligence data available'

    const hint = document.createElement('div')
    hint.className = 'intelligence-empty-hint'
    hint.textContent = 'Extract intelligence from a PDF to see results here'

    empty.appendChild(icon)
    empty.appendChild(message)
    empty.appendChild(hint)

    this.contentArea.appendChild(empty)
  }

  /**
   * Handle topic click (placeholder for future functionality)
   * @param {string} topic - Clicked topic
   */
  handleTopicClick(topic) {
    console.log('[IntelligencePanel] Topic clicked:', topic)
    // Future: Could search vault for notes with this topic
  }

  /**
   * Handle export to Markdown
   */
  async handleExport() {
    if (!this.result) {
      console.warn('[IntelligencePanel] No result to export')
      return
    }

    try {
      const markdownPath = await invoke('export_intelligence_markdown', {
        pdfPath: this.result.sourcePdf,
        result: this.result
      })

      console.log('[IntelligencePanel] Exported to:', markdownPath)

      // Show success feedback (could use toast notification)
      const btn = this.container.querySelector('.intelligence-export-btn')
      const originalText = btn.innerHTML
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Exported
      `
      btn.disabled = true

      setTimeout(() => {
        btn.innerHTML = originalText
        btn.disabled = false
      }, 2000)

    } catch (error) {
      console.error('[IntelligencePanel] Export failed:', error)

      // Show error feedback
      const btn = this.container.querySelector('.intelligence-export-btn')
      const originalText = btn.innerHTML
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Failed
      `

      setTimeout(() => {
        btn.innerHTML = originalText
      }, 2000)
    }
  }
}
