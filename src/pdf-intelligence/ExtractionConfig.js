/**
 * ExtractionConfig - Simple confirmation dialog for PDF text extraction
 * Shows brief info and extract button (text-only mode, no configuration needed)
 */
export class ExtractionConfig {
  constructor(options) {
    this.onSubmit = options.onSubmit
    this.container = null
  }

  /**
   * Show the extraction dialog
   */
  show() {
    this.container = document.createElement('div')
    this.container.className = 'intelligence-config-overlay'
    this.container.innerHTML = `
      <div class="intelligence-config-dialog intelligence-config-dialog-simple">
        <div class="dialog-header">
          <h2>Extract PDF Intelligence</h2>
          <button class="dialog-close-btn">&times;</button>
        </div>

        <div class="dialog-body">
          <p class="extraction-info">
            Extract text content from all pages of this PDF document.
          </p>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary dialog-cancel-btn">Cancel</button>
          <button class="btn btn-primary dialog-submit-btn">Extract Text</button>
        </div>
      </div>
    `

    document.body.appendChild(this.container)

    // Add styles
    this.addStyles()

    // Event handlers
    this.container.querySelector('.dialog-close-btn').addEventListener('click', () => this.close())
    this.container.querySelector('.dialog-cancel-btn').addEventListener('click', () => this.close())
    this.container.querySelector('.dialog-submit-btn').addEventListener('click', () => this.submit())
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) this.close()
    })
  }

  /**
   * Close and remove the dialog
   */
  close() {
    if (this.container) {
      this.container.remove()
      this.container = null
    }
  }

  /**
   * Submit with text-only configuration
   */
  submit() {
    const config = {
      mode: 'textOnly',
      imageDpi: 72,
      visionMode: 'none',
      summarization: 'skip'
    }
    this.close()
    this.onSubmit(config)
  }

  /**
   * Add component styles
   */
  addStyles() {
    if (document.getElementById('intelligence-config-styles')) return

    const style = document.createElement('style')
    style.id = 'intelligence-config-styles'
    style.textContent = `
      .intelligence-config-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100001;
        animation: fadeIn 0.2s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .intelligence-config-dialog {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        width: 400px;
        max-width: 90vw;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        animation: slideIn 0.3s ease;
      }

      .intelligence-config-dialog-simple {
        width: 400px;
      }

      @keyframes slideIn {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .intelligence-config-dialog .dialog-header {
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .intelligence-config-dialog .dialog-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .intelligence-config-dialog .dialog-close-btn {
        background: none;
        border: none;
        font-size: 24px;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
      }

      .intelligence-config-dialog .dialog-close-btn:hover {
        background: var(--bg-secondary);
        color: var(--text-primary);
      }

      .intelligence-config-dialog .dialog-body {
        padding: 20px;
      }

      .intelligence-config-dialog .extraction-info {
        margin: 0;
        font-size: 14px;
        color: var(--text-primary);
      }

      .intelligence-config-dialog .dialog-footer {
        padding: 20px;
        border-top: 1px solid var(--border-color);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      .intelligence-config-dialog .btn {
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
        border: none;
      }

      .intelligence-config-dialog .btn-secondary {
        background: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }

      .intelligence-config-dialog .btn-secondary:hover {
        background: var(--bg-tertiary);
      }

      .intelligence-config-dialog .btn-primary {
        background: var(--accent-color);
        color: white;
      }

      .intelligence-config-dialog .btn-primary:hover {
        opacity: 0.9;
      }
    `

    document.head.appendChild(style)
  }
}
