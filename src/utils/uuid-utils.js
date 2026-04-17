import { invoke } from '@tauri-apps/api/core'

/**
 * Add UUIDs to all files in the current vault that don't already have them
 * @param {Object} options - Configuration options
 * @param {boolean} options.skipExisting - Whether to skip files that already have UUIDs (default: true)
 * @param {Function} options.onProgress - Progress callback function
 * @returns {Promise<Object>} Results of the UUID addition process
 */
export async function addUUIDsToVault(options = {}) {
    const {
        skipExisting = true,
        onProgress = null
    } = options

    console.log('🔄 Starting UUID addition to vault...')
    
    if (onProgress) {
        onProgress({ stage: 'starting', message: 'Initializing UUID addition...' })
    }

    try {
        // Get the current window ID (assuming main window for now)
        const windowId = 'main' // This might need to be dynamic based on actual window management
        
        const result = await invoke('add_uuids_to_vault', {
            windowId,
            skipExisting
        })

        console.log('✅ UUID addition completed:', result)
        
        if (onProgress) {
            onProgress({
                stage: 'completed',
                message: `Completed! Added UUIDs to ${result.added_uuids} files.`,
                result
            })
        }

        return result
    } catch (error) {
        console.error('❌ Failed to add UUIDs to vault:', error)
        
        if (onProgress) {
            onProgress({
                stage: 'error',
                message: `Error: ${error}`,
                error
            })
        }

        throw error
    }
}

/**
 * Get UUID for a specific note by path
 * @param {string} path - Path to the note
 * @returns {Promise<string|null>} UUID of the note or null if not found
 */
export async function getNoteUUID(path) {
    try {
        return await invoke('get_note_uuid', { path })
    } catch (error) {
        console.error('Failed to get note UUID:', error)
        throw error
    }
}

/**
 * Ensure a note has a UUID (create one if missing)
 * @param {string} path - Path to the note
 * @returns {Promise<string>} UUID of the note
 */
export async function ensureNoteUUID(path) {
    try {
        return await invoke('ensure_note_uuid', { path })
    } catch (error) {
        console.error('Failed to ensure note UUID:', error)
        throw error
    }
}

/**
 * Add UUID to all files - Simple command for developer console
 * Usage: addUUIDs()
 */
window.addUUIDs = async function(skipExisting = true) {
    console.log('🚀 Adding UUIDs to all files in vault...')
    console.log('⏳ This may take a while for large vaults...')
    
    try {
        const result = await addUUIDsToVault({ 
            skipExisting,
            onProgress: (progress) => {
                console.log(`📊 ${progress.stage}: ${progress.message}`)
            }
        })
        
        console.log('🎉 Success! Results:')
        console.table([
            { Metric: 'Total Files', Count: result.total_files },
            { Metric: 'Already Had UUIDs', Count: result.already_had_uuids },
            { Metric: 'Added UUIDs', Count: result.added_uuids },
            { Metric: 'Errors', Count: result.errors }
        ])
        
        if (result.error_files.length > 0) {
            console.warn('⚠️  Files with errors:')
            result.error_files.forEach(file => console.warn(`  - ${file}`))
        }
        
        return result
    } catch (error) {
        console.error('💥 Failed:', error)
        throw error
    }
}

/**
 * Check if a string is a valid UUID
 * @param {string} id - ID to check
 * @returns {Promise<boolean>} True if ID is a UUID
 */
export async function isUUID(id) {
    try {
        return await invoke('is_uuid', { id })
    } catch (error) {
        console.error('Failed to check if ID is UUID:', error)
        throw error
    }
}

console.log('🆔 UUID utilities loaded! Use addUUIDs() to add UUIDs to all files in your vault.')