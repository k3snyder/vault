// Readwise Plugin Entry Point
import VaultReadwisePlugin from './plugin';

// Export the plugin class for the Vault plugin runtime
export default VaultReadwisePlugin;

// Export types for external use
export type { ReadwiseSettings, ReadwiseHighlight, ReadwiseBook, SyncResult } from './types';