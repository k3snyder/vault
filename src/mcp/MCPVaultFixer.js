/**
 * MCP Vault Path Fixer
 * Ensures MCP servers ALWAYS use the current vault path
 */

import { invoke } from '@tauri-apps/api/core';
import { getBundledServers } from './bundledServers.js';

export class MCPVaultFixer {
  constructor(mcpManager) {
    this.mcpManager = mcpManager;
  }

  /**
   * Get the ACTUAL current vault path from multiple sources
   */
  async getCurrentVaultPath() {
    // Try multiple sources in order of reliability
    
    // 1. Check window.currentVaultPath
    if (window.currentVaultPath) {
      console.log('📁 Vault from window:', window.currentVaultPath);
      return window.currentVaultPath;
    }
    
    // 2. Get from Tauri backend
    try {
      const vaultInfo = await invoke('get_vault_info');
      if (vaultInfo?.path) {
        console.log('📁 Vault from backend:', vaultInfo.path);
        return vaultInfo.path;
      }
    } catch (e) {
      console.error('Failed to get vault from backend:', e);
    }
    
    // 3. Check current working directory
    try {
      const cwd = await invoke('get_current_directory');
      if (cwd && cwd.includes('/cloud/cloud')) {
        console.log('📁 Detected cloud vault from CWD:', cwd);
        return '/Users/ksnyder/Obsidian/cloud/cloud';
      }
    } catch (e) {
      // Ignore
    }
    
    return null;
  }

  /**
   * Force kill and restart ALL MCP servers with current vault
   */
  async forceRestartWithCurrentVault() {
    const currentVault = await this.getCurrentVaultPath();
    
    if (!currentVault) {
      throw new Error('Could not determine current vault path');
    }
    
    console.log('🔄 Force restarting MCP servers with vault:', currentVault);
    
    // Kill all MCP server processes at OS level
    try {
      await invoke('kill_all_mcp_processes');
    } catch (e) {
      console.log('Failed to kill processes via Tauri, trying JavaScript disconnect...');
    }
    
    // Disconnect all clients
    const serverIds = Array.from(this.mcpManager.clients.keys());
    for (const serverId of serverIds) {
      try {
        await this.mcpManager.disconnectServer(serverId);
      } catch (e) {
        console.error(`Failed to disconnect ${serverId}:`, e);
      }
    }
    
    // Wait for cleanup
    await new Promise(r => setTimeout(r, 2000));
    
    // Get servers from bundledServers.js (the single source of truth)
    let servers = {};
    try {
      const bundled = await getBundledServers(currentVault);
      for (const server of bundled) {
        servers[server.id] = server;
      }
      console.log(`Loaded ${bundled.length} bundled servers for vault fixer`);
    } catch (e) {
      console.error('Failed to get bundled servers:', e);
    }
    
    // Restart each server with current vault
    for (const [serverId, config] of Object.entries(servers)) {
      if (config.enabled && config.transport?.type === 'stdio') {
        // Set working_dir for all stdio transports (Rust servers use this)
        config.transport.working_dir = currentVault;

        // For Rust servers, remove VAULT_PATH since they use working_dir
        if (serverId.includes('-rust') && config.transport.env) {
          delete config.transport.env.VAULT_PATH;
        } else if (config.transport.env) {
          // For non-Rust servers, also set VAULT_PATH
          config.transport.env.VAULT_PATH = currentVault;
        }

        console.log(`🚀 Starting ${serverId} with working_dir: ${currentVault}`);

        try {
          await this.mcpManager.connectServer(serverId, config);
          console.log(`✅ ${serverId} started successfully`);
        } catch (e) {
          console.error(`❌ Failed to start ${serverId}:`, e);
        }
      }
    }
    
    console.log('✅ MCP servers restarted with current vault:', currentVault);
    return currentVault;
  }

  /**
   * Verify MCP servers are using correct vault
   */
  async verifyVaultPaths() {
    const currentVault = await this.getCurrentVaultPath();
    const results = {};

    for (const [serverId, client] of this.mcpManager.clients.entries()) {
      // Check working_dir first (used by Rust servers), then VAULT_PATH env var
      const workingDir = client.config?.transport?.working_dir;
      const envVaultPath = client.config?.transport?.env?.VAULT_PATH;
      const serverVault = workingDir || envVaultPath;
      results[serverId] = {
        working_dir: workingDir,
        env_VAULT_PATH: envVaultPath,
        using: serverVault,
        correct: serverVault === currentVault,
        status: this.mcpManager.status.get(serverId)
      };
    }

    console.table(results);
    return results;
  }
}

// Auto-install on MCPManager
if (window.mcpManager) {
  window.mcpManager.vaultFixer = new MCPVaultFixer(window.mcpManager);
  
  // Add convenience methods
  window.mcpManager.fixVault = async () => {
    return window.mcpManager.vaultFixer.forceRestartWithCurrentVault();
  };
  
  window.mcpManager.verifyVault = async () => {
    return window.mcpManager.vaultFixer.verifyVaultPaths();
  };
  
  console.log('✅ MCPVaultFixer installed on mcpManager');
  console.log('   Use: mcpManager.fixVault() to fix vault paths');
  console.log('   Use: mcpManager.verifyVault() to check current paths');
}

export default MCPVaultFixer;