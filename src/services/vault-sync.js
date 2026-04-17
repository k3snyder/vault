/**
 * VaultSync - Automatic vault indexing for PACASDB
 * Watches file system events and syncs markdown files to PACASDB
 */
import { invoke } from '@tauri-apps/api/core';

export default class VaultSync {
  constructor(pacasdbClient) {
    this.pacasdbClient = pacasdbClient;
    this.debounceTimers = new Map();
    this.docIdMap = new Map(); // file path -> doc_id mapping
    this.isRunning = false;
  }

  /**
   * Start the sync service
   */
  start() {
    this.isRunning = true;
    console.log('📡 VaultSync started');
  }

  /**
   * Stop the sync service
   */
  stop() {
    this.isRunning = false;
    // Clear all pending timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    console.log('🛑 VaultSync stopped');
  }

  /**
   * Sync all documents in the vault to PACASDB
   * @param {string} vaultPath - Path to vault directory
   * @returns {Promise<Object>} Summary with indexed/failed counts
   */
  async syncAllDocuments(vaultPath) {
    if (!this.pacasdbClient) {
      throw new Error('PACASDBClient not initialized');
    }

    console.log('🔄 Starting full vault sync...');
    const summary = {
      total: 0,
      indexed: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get all notes in vault using existing command
      const notes = await invoke('get_vault_notes');

      summary.total = notes.length;
      console.log(`📚 Found ${notes.length} markdown files`);

      // Process in batches of 50
      const batchSize = 50;
      for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        const documents = [];

        // Read and parse each file in batch
        for (const note of batch) {
          try {
            // Skip hidden files
            const pathParts = note.path.split('/');
            if (pathParts.some(part => part.startsWith('.'))) {
              continue;
            }

            // Build full path from vault path and relative note path
            const fullPath = `${vaultPath}/${note.path}`;
            const content = await invoke('read_file_content', { filePath: fullPath });
            const parsed = this.parseMarkdown(content);

            documents.push({
              content: {
                title: parsed.title || note.title,
                body: parsed.body
              },
              metadata: {
                file_path: note.path,
                ...parsed.frontmatter
              }
            });
          } catch (error) {
            console.error(`Failed to read ${note.path}:`, error);
            summary.failed++;
            summary.errors.push({ file: note.path, error: error.message });
          }
        }

        // Batch index documents
        if (documents.length > 0) {
          try {
            const result = await this.pacasdbClient.batchIndex(documents);
            summary.indexed += documents.length;

            // Store doc_id mappings
            if (result && result.doc_ids) {
              documents.forEach((doc, idx) => {
                if (result.doc_ids[idx]) {
                  this.docIdMap.set(doc.metadata.file_path, result.doc_ids[idx]);
                }
              });
            }

            console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}: ${documents.length} documents indexed`);
          } catch (error) {
            console.error('Batch indexing failed:', error);
            summary.failed += documents.length;
            summary.errors.push({ batch: i, error: error.message });
          }
        }

        // Emit progress event
        const progress = Math.floor(((i + batch.length) / notes.length) * 100);
        window.dispatchEvent(new CustomEvent('vault-sync-progress', {
          detail: { progress, indexed: summary.indexed, total: summary.total }
        }));
      }

      console.log(`✅ Full vault sync complete: ${summary.indexed}/${summary.total} indexed`);
    } catch (error) {
      console.error('Full vault sync failed:', error);
      summary.errors.push({ error: error.message });
    }

    return summary;
  }

  /**
   * Handle file system event with filtering and debouncing
   * @param {string} path - File path
   * @param {string} eventType - Event type (create, modify, remove)
   */
  handleFileEvent(path, eventType) {
    // Only process .md files
    if (!path.endsWith('.md')) {
      return;
    }

    // Ignore hidden files
    const pathParts = path.split('/');
    const hasHiddenPart = pathParts.some(part => part.startsWith('.'));
    if (hasHiddenPart) {
      return;
    }

    // Clear existing timer for this file
    if (this.debounceTimers.has(path)) {
      clearTimeout(this.debounceTimers.get(path));
    }

    // Set new debounced timer (1000ms)
    const timer = setTimeout(() => {
      this.processFileEvent(path, eventType);
      this.debounceTimers.delete(path);
    }, 1000);

    this.debounceTimers.set(path, timer);
  }

  /**
   * Process file event after debouncing
   * @param {string} path - File path
   * @param {string} eventType - Event type
   */
  async processFileEvent(path, eventType) {
    try {
      if (eventType === 'remove') {
        await this.handleDelete(path);
      } else {
        // create or modify
        await this.handleCreateOrUpdate(path);
      }
    } catch (error) {
      console.error(`Error processing file event for ${path}:`, error);
    }
  }

  /**
   * Handle file creation or update
   * @param {string} path - File path
   */
  async handleCreateOrUpdate(path) {
    if (!this.pacasdbClient) {
      return;
    }

    try {
      // Read file content
      const content = await invoke('read_file_content', { filePath: path });

      // Parse markdown
      const parsed = this.parseMarkdown(content);

      // Prepare document for indexing
      const doc = {
        content: {
          title: parsed.title,
          body: parsed.body
        },
        metadata: {
          file_path: path,
          ...parsed.frontmatter
        }
      };

      // Index document
      const result = await this.pacasdbClient.indexDocument(doc);

      // Store doc_id for future updates/deletes
      if (result && result.doc_id) {
        this.docIdMap.set(path, result.doc_id);
      }

      console.log(`✅ Indexed: ${path}`);
    } catch (error) {
      console.error(`Failed to index ${path}:`, error);
    }
  }

  /**
   * Handle file deletion
   * @param {string} path - File path
   */
  async handleDelete(path) {
    if (!this.pacasdbClient) {
      return;
    }

    try {
      const docId = this.docIdMap.get(path);
      if (docId) {
        await this.pacasdbClient.deleteDocument(docId);
        this.docIdMap.delete(path);
        console.log(`🗑️  Deleted: ${path}`);
      }
    } catch (error) {
      console.error(`Failed to delete ${path}:`, error);
    }
  }

  /**
   * Parse markdown content
   * @param {string} content - Raw markdown content
   * @returns {Object} Parsed content with frontmatter, title, and body
   */
  parseMarkdown(content) {
    let frontmatter = {};
    let body = content;
    let title = '';

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const frontmatterText = frontmatterMatch[1];
      body = frontmatterMatch[2];

      // Parse YAML-like frontmatter
      frontmatter = this.parseFrontmatter(frontmatterText);
    }

    // Extract title from first H1
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    } else {
      // Fall back to first line
      const firstLine = body.split('\n')[0];
      title = firstLine.trim();
    }

    return {
      frontmatter,
      title,
      body: body.trim()
    };
  }

  /**
   * Simple frontmatter parser
   * @param {string} text - Frontmatter text
   * @returns {Object} Parsed frontmatter object
   */
  parseFrontmatter(text) {
    const result = {};
    const lines = text.split('\n');
    let currentKey = null;
    let arrayMode = false;
    let arrayItems = [];

    for (const line of lines) {
      // Array item
      if (line.trim().startsWith('- ')) {
        if (arrayMode && currentKey) {
          arrayItems.push(line.trim().substring(2));
        }
        continue;
      }

      // Key: value
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        // Save previous array if exists
        if (arrayMode && currentKey && arrayItems.length > 0) {
          result[currentKey] = arrayItems;
          arrayItems = [];
          arrayMode = false;
        }

        const [, key, value] = match;
        currentKey = key;

        if (value === '') {
          // Empty value, next lines might be array
          arrayMode = true;
        } else if (value.startsWith('[') && value.endsWith(']')) {
          // Inline array [item1, item2]
          const items = value.slice(1, -1).split(',').map(s => s.trim());
          result[key] = items;
          currentKey = null;
          arrayMode = false;
        } else {
          // Regular value
          result[key] = value;
          currentKey = null;
          arrayMode = false;
        }
      }
    }

    // Save final array if exists
    if (arrayMode && currentKey && arrayItems.length > 0) {
      result[currentKey] = arrayItems;
    }

    return result;
  }
}
