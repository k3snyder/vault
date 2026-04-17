import { addUUIDsToVault } from '../utils/uuid-utils.js'

/**
 * UUID Manager Component - Provides UI for managing UUIDs in the vault
 */
export class UUIDManager {
    constructor() {
        this.isRunning = false
        this.container = null
    }

    /**
     * Create the UUID manager UI
     * @returns {HTMLElement} The UUID manager container
     */
    createUI() {
        if (this.container) {
            return this.container
        }

        this.container = document.createElement('div')
        this.container.className = 'uuid-manager'
        this.container.innerHTML = `
            <div class="uuid-manager-section">
                <h3>🆔 UUID Management</h3>
                <p>Add unique identifiers to all files in your vault for better linking and organization.</p>
                
                <div class="uuid-actions">
                    <button id="addUUIDs" class="uuid-button primary">
                        <span class="button-icon">🔄</span>
                        Add UUIDs to All Files
                    </button>
                    
                    <button id="addUUIDsForce" class="uuid-button secondary">
                        <span class="button-icon">🔥</span>
                        Force Add (Override Existing)
                    </button>
                </div>
                
                <div id="uuidProgress" class="uuid-progress hidden">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                    <div class="progress-text">Initializing...</div>
                </div>
                
                <div id="uuidResults" class="uuid-results hidden">
                    <h4>Results</h4>
                    <div class="results-grid"></div>
                </div>
            </div>
        `

        // Add styles
        this.addStyles()
        
        // Add event listeners
        this.setupEventListeners()

        return this.container
    }

    addStyles() {
        if (document.getElementById('uuid-manager-styles')) return

        const styles = document.createElement('style')
        styles.id = 'uuid-manager-styles'
        styles.textContent = `
            .uuid-manager {
                padding: 20px;
                max-width: 600px;
            }
            
            .uuid-manager-section {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 20px;
                border: 1px solid #e1e4e8;
            }
            
            .uuid-manager h3 {
                margin: 0 0 10px 0;
                color: #24292e;
                font-size: 18px;
                font-weight: 600;
            }
            
            .uuid-manager p {
                margin: 0 0 20px 0;
                color: #586069;
                line-height: 1.5;
            }
            
            .uuid-actions {
                display: flex;
                gap: 12px;
                margin-bottom: 20px;
                flex-wrap: wrap;
            }
            
            .uuid-button {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 16px;
                border-radius: 6px;
                border: 1px solid transparent;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                text-decoration: none;
            }
            
            .uuid-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            
            .uuid-button.primary {
                background: #2ea043;
                color: white;
                border-color: #2ea043;
            }
            
            .uuid-button.primary:hover:not(:disabled) {
                background: #2c974b;
                border-color: #2c974b;
            }
            
            .uuid-button.secondary {
                background: #ffd33d;
                color: #24292e;
                border-color: #ffd33d;
            }
            
            .uuid-button.secondary:hover:not(:disabled) {
                background: #ffcd1c;
                border-color: #ffcd1c;
            }
            
            .uuid-progress {
                margin: 20px 0;
            }
            
            .uuid-progress.hidden {
                display: none;
            }
            
            .progress-bar {
                width: 100%;
                height: 8px;
                background: #e1e4e8;
                border-radius: 4px;
                overflow: hidden;
                margin-bottom: 8px;
            }
            
            .progress-fill {
                height: 100%;
                background: #2ea043;
                width: 0%;
                transition: width 0.3s ease;
            }
            
            .progress-text {
                font-size: 14px;
                color: #586069;
            }
            
            .uuid-results {
                margin-top: 20px;
                padding: 16px;
                background: white;
                border-radius: 6px;
                border: 1px solid #e1e4e8;
            }
            
            .uuid-results.hidden {
                display: none;
            }
            
            .uuid-results h4 {
                margin: 0 0 12px 0;
                color: #24292e;
                font-size: 16px;
            }
            
            .results-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }
            
            .result-item {
                display: flex;
                justify-content: space-between;
                padding: 8px 12px;
                background: #f6f8fa;
                border-radius: 4px;
                font-size: 14px;
            }
            
            .result-label {
                color: #586069;
                font-weight: 500;
            }
            
            .result-value {
                color: #24292e;
                font-weight: 600;
            }
        `
        document.head.appendChild(styles)
    }

    setupEventListeners() {
        const addButton = this.container.querySelector('#addUUIDs')
        const forceButton = this.container.querySelector('#addUUIDsForce')

        addButton.addEventListener('click', () => this.runUUIDAddition(true))
        forceButton.addEventListener('click', () => this.runUUIDAddition(false))
    }

    async runUUIDAddition(skipExisting = true) {
        if (this.isRunning) return

        this.isRunning = true
        this.showProgress()
        this.hideResults()
        this.disableButtons()

        try {
            const result = await addUUIDsToVault({
                skipExisting,
                onProgress: (progress) => {
                    this.updateProgress(progress)
                }
            })

            this.showResults(result)
        } catch (error) {
            this.showError(error)
        } finally {
            this.isRunning = false
            this.hideProgress()
            this.enableButtons()
        }
    }

    showProgress() {
        const progressEl = this.container.querySelector('#uuidProgress')
        progressEl.classList.remove('hidden')
    }

    hideProgress() {
        const progressEl = this.container.querySelector('#uuidProgress')
        progressEl.classList.add('hidden')
    }

    updateProgress(progress) {
        const textEl = this.container.querySelector('.progress-text')
        textEl.textContent = progress.message

        // Simple progress indication (since we don't have detailed progress from backend)
        const fillEl = this.container.querySelector('.progress-fill')
        if (progress.stage === 'starting') {
            fillEl.style.width = '10%'
        } else if (progress.stage === 'completed') {
            fillEl.style.width = '100%'
        }
    }

    showResults(result) {
        const resultsEl = this.container.querySelector('#uuidResults')
        const gridEl = this.container.querySelector('.results-grid')
        
        gridEl.innerHTML = `
            <div class="result-item">
                <span class="result-label">Total Files</span>
                <span class="result-value">${result.total_files}</span>
            </div>
            <div class="result-item">
                <span class="result-label">Already Had UUIDs</span>
                <span class="result-value">${result.already_had_uuids}</span>
            </div>
            <div class="result-item">
                <span class="result-label">Added UUIDs</span>
                <span class="result-value">${result.added_uuids}</span>
            </div>
            <div class="result-item">
                <span class="result-label">Errors</span>
                <span class="result-value">${result.errors}</span>
            </div>
        `
        
        resultsEl.classList.remove('hidden')
    }

    showError(error) {
        const resultsEl = this.container.querySelector('#uuidResults')
        const gridEl = this.container.querySelector('.results-grid')
        
        gridEl.innerHTML = `
            <div class="result-item" style="grid-column: 1 / -1; background: #ffeef0;">
                <span class="result-label" style="color: #d1242f;">Error</span>
                <span class="result-value" style="color: #d1242f;">${error}</span>
            </div>
        `
        
        resultsEl.classList.remove('hidden')
    }

    disableButtons() {
        this.container.querySelectorAll('.uuid-button').forEach(btn => {
            btn.disabled = true
        })
    }

    enableButtons() {
        this.container.querySelectorAll('.uuid-button').forEach(btn => {
            btn.disabled = false
        })
    }

    hideResults() {
        const resultsEl = this.container.querySelector('#uuidResults')
        resultsEl.classList.add('hidden')
    }
}

// Make it available globally for easy access
window.UUIDManager = UUIDManager