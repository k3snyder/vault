import { invoke } from '@tauri-apps/api/core'

/**
 * IntelligenceService - PDF text extraction service
 * Coordinates Rust PDF text extraction. Advanced features (vision, summarization)
 * are handled by MCP servers externally.
 *
 * V2 Schema (summarizer-compatible):
 * - Each page is an EnrichedChunk with chunk_id, text
 * - Empty enrichment fields ready for MCP server to fill
 */
export class IntelligenceService {
  constructor(pdfPath) {
    this.pdfPath = pdfPath
    this.result = null
    this.listeners = new Set()
  }

  /**
   * Open configuration dialog
   * @returns {Promise<void>}
   */
  async openConfigDialog() {
    const { ExtractionConfig } = await import('./ExtractionConfig.js')
    const dialog = new ExtractionConfig({
      onSubmit: (config) => this.runExtraction(config)
    })
    dialog.show()
  }

  /**
   * Run PDF text extraction with V2 schema
   * Extracts text only; enrichment fields are empty (for MCP to fill later)
   *
   * @param {Object} config - Extraction configuration (mode fields ignored)
   * @returns {Promise<Object>} Intelligence result in V2 format
   */
  async runExtraction(config) {
    const startTime = Date.now()
    this.emit('status', { phase: 'extraction', progress: 0 })

    try {
      // Extract text from PDF (V2 schema with empty enrichment fields)
      const result = await invoke('extract_pdf_intelligence_v2', {
        pdfPath: this.pdfPath,
        config
      })

      const extractionTime = Date.now() - startTime
      this.emit('status', { phase: 'extraction', progress: 100 })
      console.log(`Text extraction completed: ${result.pages.length} pages in ${extractionTime}ms`)

      // Store result
      this.result = result

      // Save to .vault.json
      try {
        await invoke('save_intelligence_result_v2', {
          pdfPath: this.pdfPath,
          result: this.result
        })
        console.log('Intelligence result saved to .vault.json')
      } catch (saveError) {
        console.error('Failed to save intelligence result:', saveError)
      }

      this.emit('complete', this.result)
      return this.result

    } catch (error) {
      console.error('Text extraction failed:', error)
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Emit event to all listeners
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emit(event, data) {
    this.listeners.forEach(l => l(event, data))
  }

  /**
   * Register status change listener
   * @param {Function} listener - Listener function
   * @returns {Function} Unsubscribe function
   */
  onStatusChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
