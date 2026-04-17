import { invoke } from '@tauri-apps/api/core';

/**
 * Add UUIDs to all tasks in the vault
 * @param {Object} options - Configuration options
 * @param {boolean} options.dryRun - Whether to run in dry-run mode (default: false)
 * @param {boolean} options.batchWrite - Whether to batch write operations (default: true)
 * @param {number} options.batchSize - Number of files to process in each batch (default: 10)
 * @returns {Promise<Object>} Migration report
 */
export async function addTaskUUIDs(options = {}) {
    const config = {
        dry_run: options.dryRun || false,
        batch_write: options.batchWrite !== false,
        batch_size: options.batchSize || 10,
        skip_existing: options.skipExisting !== false
    };
    
    try {
        console.log('[Task UUID] Starting task UUID migration...');
        const result = await invoke('add_task_uuids_to_vault', { config });
        
        console.log('[Task UUID] Migration complete:', {
            filesProcessed: result.files_processed,
            tasksProcessed: result.tasks_processed,
            tasksWithUUIDs: result.tasks_with_uuids,
            tasksUpdated: result.tasks_updated,
            errors: result.errors
        });
        
        return result;
    } catch (error) {
        console.error('[Task UUID] Failed to add task UUIDs:', error);
        throw error;
    }
}

/**
 * Add Task UUIDs - Simple command for developer console
 * Usage: addTaskUUIDs()
 */
window.addTaskUUIDs = async function(dryRun = false) {
    console.log('🚀 Adding UUIDs to all tasks in vault...');
    console.log(dryRun ? '🔍 Running in DRY RUN mode' : '✏️ Will modify files');
    
    try {
        const result = await addTaskUUIDs({ dryRun });
        
        console.log('✅ Task UUID Migration Complete!');
        console.table([
            { Metric: 'Files Processed', Count: result.files_processed },
            { Metric: 'Tasks Found', Count: result.tasks_processed },
            { Metric: 'Already Had UUIDs', Count: result.tasks_with_uuids },
            { Metric: 'Added UUIDs', Count: result.tasks_updated },
            { Metric: 'Errors', Count: result.errors.length }
        ]);
        
        if (result.errors.length > 0) {
            console.error('⚠️ Errors encountered:');
            result.errors.forEach(err => console.error(`  - ${err.file}: ${err.error}`));
        }
        
        if (result.files_modified && result.files_modified.length > 0) {
            console.log('📝 Modified files:', result.files_modified);
        }
        
        return result;
    } catch (error) {
        console.error('❌ Failed to add task UUIDs:', error);
        throw error;
    }
}

// Export for use in other modules
export default {
    addTaskUUIDs
};