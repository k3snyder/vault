/**
 * Client-side caching system for WikiLink note existence checks
 * Implements TTL-based caching with file watcher integration
 */

import { invoke } from '@tauri-apps/api/core';

// Cache configuration
const CACHE_TTL_MS = 30000; // 30 seconds TTL
const CACHE_UPDATE_DEBOUNCE_MS = 250; // Debounce cache updates during rapid operations

/**
 * Cache entry structure
 */
class CacheEntry {
    constructor(exists, path = null) {
        this.exists = exists;
        this.path = path;
        this.timestamp = Date.now();
    }

    /**
     * Check if this cache entry is still valid
     */
    isValid() {
        return (Date.now() - this.timestamp) < CACHE_TTL_MS;
    }
}

/**
 * WikiLink Note Cache Manager
 * Manages cached note existence checks with TTL and file watcher integration
 */
export class WikiLinkCache {
    constructor() {
        this.cache = new Map(); // Map<string, CacheEntry>
        this.vaultNotes = []; // Cache of all vault notes
        this.vaultNotesTimestamp = 0;
        this.debounceTimers = new Map(); // Map<string, timeoutId>
        
        // Setup file watcher integration
        this.setupFileWatcher();
    }

    /**
     * Get all notes in the current vault (cached)
     */
    async getVaultNotes() {
        const now = Date.now();
        
        // Return cached notes if still valid
        if (this.vaultNotes.length > 0 && (now - this.vaultNotesTimestamp) < CACHE_TTL_MS) {
            return this.vaultNotes;
        }

        try {
            const notes = await invoke('get_vault_notes');
            this.vaultNotes = notes;
            this.vaultNotesTimestamp = now;
            
            // Update individual cache entries for these notes
            this.updateCacheFromVaultNotes(notes);
            
            return notes;
        } catch (error) {
            console.error('Failed to get vault notes:', error);
            return this.vaultNotes; // Return stale data if available
        }
    }

    /**
     * Check if a WikiLink note exists (with caching)
     */
    async checkNoteExists(linkName) {
        if (!linkName || linkName.trim() === '') {
            return { exists: false, path: null };
        }

        const normalizedName = this.normalizeWikiLinkName(linkName);
        
        // Check cache first
        const cached = this.cache.get(normalizedName);
        if (cached && cached.isValid()) {
            return { exists: cached.exists, path: cached.path };
        }

        // Cache miss or expired - resolve using Tauri command
        try {
            const resolution = await invoke('resolve_wikilink', { linkName: linkName });
            
            // Update cache
            this.cache.set(normalizedName, new CacheEntry(resolution.exists, resolution.path));
            
            return { exists: resolution.exists, path: resolution.path };
        } catch (error) {
            console.error('Failed to resolve WikiLink:', error);
            
            // Return cached data if available, even if expired
            if (cached) {
                return { exists: cached.exists, path: cached.path };
            }
            
            return { exists: false, path: null };
        }
    }

    /**
     * Batch check multiple WikiLink notes (optimized for auto-completion)
     */
    async batchCheckNotes(linkNames) {
        const results = new Map();
        const uncachedNames = [];

        // Check cache for each name
        for (const linkName of linkNames) {
            if (!linkName || linkName.trim() === '') {
                results.set(linkName, { exists: false, path: null });
                continue;
            }

            const normalizedName = this.normalizeWikiLinkName(linkName);
            const cached = this.cache.get(normalizedName);
            
            if (cached && cached.isValid()) {
                results.set(linkName, { exists: cached.exists, path: cached.path });
            } else {
                uncachedNames.push(linkName);
            }
        }

        // Resolve uncached names
        if (uncachedNames.length > 0) {
            try {
                // Get all vault notes and match against them
                const vaultNotes = await this.getVaultNotes();
                
                for (const linkName of uncachedNames) {
                    const normalizedLinkName = this.normalizeWikiLinkName(linkName);
                    const matchingNote = vaultNotes.find(note => 
                        this.normalizeWikiLinkName(note.name) === normalizedLinkName
                    );
                    
                    const exists = !!matchingNote;
                    const path = matchingNote ? matchingNote.path : null;
                    
                    // Update cache
                    this.cache.set(normalizedLinkName, new CacheEntry(exists, path));
                    results.set(linkName, { exists, path });
                }
            } catch (error) {
                console.error('Failed to batch resolve WikiLinks:', error);
                
                // Set uncached names as non-existent
                for (const linkName of uncachedNames) {
                    results.set(linkName, { exists: false, path: null });
                }
            }
        }

        return results;
    }

    /**
     * Invalidate cache for a specific note name
     */
    invalidateNote(noteName) {
        const normalizedName = this.normalizeWikiLinkName(noteName);
        this.cache.delete(normalizedName);
    }

    /**
     * Invalidate entire cache (useful when vault changes significantly)
     */
    invalidateAll() {
        this.cache.clear();
        this.vaultNotes = [];
        this.vaultNotesTimestamp = 0;
    }

    /**
     * Debounced cache invalidation (prevents excessive updates during rapid file operations)
     */
    debounceInvalidation(noteName, delayMs = CACHE_UPDATE_DEBOUNCE_MS) {
        const normalizedName = this.normalizeWikiLinkName(noteName);
        
        // Clear existing timer if any
        if (this.debounceTimers.has(normalizedName)) {
            clearTimeout(this.debounceTimers.get(normalizedName));
        }

        // Set new timer
        const timerId = setTimeout(() => {
            this.invalidateNote(noteName);
            this.debounceTimers.delete(normalizedName);
        }, delayMs);

        this.debounceTimers.set(normalizedName, timerId);
    }

    /**
     * Update cache entries based on vault notes list
     */
    updateCacheFromVaultNotes(vaultNotes) {
        // Create a set of normalized names that exist
        const existingNames = new Set(
            vaultNotes.map(note => this.normalizeWikiLinkName(note.name))
        );

        // Update cache for all existing notes
        for (const note of vaultNotes) {
            const normalizedName = this.normalizeWikiLinkName(note.name);
            this.cache.set(normalizedName, new CacheEntry(true, note.path));
        }

        // Mark cached entries as non-existent if they're not in the vault notes
        for (const [normalizedName, cacheEntry] of this.cache.entries()) {
            if (cacheEntry.exists && !existingNames.has(normalizedName)) {
                this.cache.set(normalizedName, new CacheEntry(false, null));
            }
        }
    }

    /**
     * Setup file watcher integration for cache invalidation
     */    
    setupFileWatcher() {
        // Listen for file system events
        if (window.__TAURI_INTERNALS__) {
            // Listen for file creation/deletion events
            document.addEventListener('file-created', (event) => {
                const filePath = event.detail.path;
                if (this.isMarkdownFile(filePath)) {
                    const noteName = this.extractNoteNameFromPath(filePath);
                    this.debounceInvalidation(noteName);
                    // Also invalidate vault notes cache
                    this.vaultNotesTimestamp = 0;
                }
            });

            document.addEventListener('file-deleted', (event) => {
                const filePath = event.detail.path;
                if (this.isMarkdownFile(filePath)) {
                    const noteName = this.extractNoteNameFromPath(filePath);
                    this.debounceInvalidation(noteName);
                    // Also invalidate vault notes cache
                    this.vaultNotesTimestamp = 0;
                }
            });

            document.addEventListener('file-renamed', (event) => {
                const { oldPath, newPath } = event.detail;
                if (this.isMarkdownFile(oldPath) || this.isMarkdownFile(newPath)) {
                    if (this.isMarkdownFile(oldPath)) {
                        const oldNoteName = this.extractNoteNameFromPath(oldPath);
                        this.debounceInvalidation(oldNoteName);
                    }
                    if (this.isMarkdownFile(newPath)) {
                        const newNoteName = this.extractNoteNameFromPath(newPath);
                        this.debounceInvalidation(newNoteName);
                    }
                    // Also invalidate vault notes cache
                    this.vaultNotesTimestamp = 0;
                }
            });
        }
    }

    /**
     * Normalize WikiLink name for consistent cache keys
     */
    normalizeWikiLinkName(name) {
        return name.trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    /**
     * Check if a file path represents a markdown file
     */
    isMarkdownFile(filePath) {
        return filePath && filePath.toLowerCase().endsWith('.md');
    }

    /**
     * Extract note name from file path
     */
    extractNoteNameFromPath(filePath) {
        const pathParts = filePath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        return fileName.replace(/\.md$/i, '');
    }

    /**
     * Get cache statistics (useful for debugging)
     */
    getCacheStats() {
        const validEntries = Array.from(this.cache.values()).filter(entry => entry.isValid());
        const expiredEntries = this.cache.size - validEntries.length;
        
        return {
            totalEntries: this.cache.size,
            validEntries: validEntries.length,
            expiredEntries: expiredEntries,
            vaultNotesCached: this.vaultNotes.length,
            vaultNotesAge: Date.now() - this.vaultNotesTimestamp
        };
    }

    /**
     * Cleanup expired cache entries (call periodically)
     */
    cleanup() {
        let cleaned = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (!entry.isValid()) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        return cleaned;
    }
}

// Create singleton instance
export const wikiLinkCache = new WikiLinkCache();

// Setup periodic cleanup
setInterval(() => {
    wikiLinkCache.cleanup();
}, CACHE_TTL_MS); // Cleanup expired entries every TTL period