import { invoke } from '@tauri-apps/api/core'

/**
 * Adds UUIDs to all Readwise imported files after sync
 * This should be called automatically after Readwise sync completes
 */
export async function addUUIDsToReadwiseFiles() {
    console.log('[Readwise UUID Fix] Starting UUID addition for Readwise files...')
    
    try {
        // Call the Tauri command to add UUIDs to all vault files
        // This will process all markdown files including Readwise imports
        const result = await invoke('add_uuids_to_vault', {
            windowId: 'main',
            skipExisting: true
        })
        
        console.log('[Readwise UUID Fix] Completed:', {
            total: result.total_files,
            added: result.added_uuids,
            alreadyHad: result.already_had_uuids,
            errors: result.errors
        })
        
        if (result.error_files && result.error_files.length > 0) {
            console.warn('[Readwise UUID Fix] Files with errors:', result.error_files)
        }
        
        return result
    } catch (error) {
        console.error('[Readwise UUID Fix] Failed:', error)
        throw error
    }
}

// Auto-run this function when Readwise sync completes
export function setupReadwiseUUIDFix() {
    // Listen for Readwise sync completion
    window.addEventListener('readwise-sync-complete', async (event) => {
        console.log('[Readwise UUID Fix] Detected Readwise sync completion')
        
        // Wait a moment for files to be written
        setTimeout(async () => {
            try {
                await addUUIDsToReadwiseFiles()
            } catch (error) {
                console.error('[Readwise UUID Fix] Auto-fix failed:', error)
            }
        }, 2000)
    })
    
    console.log('[Readwise UUID Fix] Listener set up for Readwise sync events')
}

// Initialize on load
setupReadwiseUUIDFix()

// Also export for manual use
window.fixReadwiseUUIDs = addUUIDsToReadwiseFiles