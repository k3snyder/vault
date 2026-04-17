/**
 * Bundled MCP servers that come pre-configured with Vault
 *
 * All servers are Rust binaries located in ${BUNDLE_PATH}
 * They use working_dir for vault path (Rust servers read CWD)
 */
export const bundledServers = [
  {
    id: 'vault-filesystem',
    name: 'Filesystem Tools',
    description: 'File operations within your vault - list, read, write, search files',
    enabled: false,
    transport: {
      type: 'stdio',
      command: '${BUNDLE_PATH}/mcp-filesystem-server',
      args: ['--line-transport', '--allowed-paths', '${VAULT_PATH}'],
      env: {},
      working_dir: null // Will be set to vault path at runtime
    },
    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
      sampling: false
    },
    permissions: {
      read: true,
      write: true,
      delete: true,
      external_access: false
    }
  },
  {
    id: 'vault-search',
    name: 'Vault Search',
    description: 'Full-text search using Tantivy - high-performance Rust implementation',
    enabled: false,
    transport: {
      type: 'stdio',
      command: '${BUNDLE_PATH}/mcp-search-server',
      args: ['--line-transport', '--index-path', '${VAULT_PATH}/.vault/search'],
      env: {},
      working_dir: null // Will be set to vault path at runtime
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      sampling: false
    },
    permissions: {
      read: true,
      write: true,
      delete: false,
      external_access: false
    }
  }
];

/**
 * Normalize macOS bundle path for sidecar binaries.
 * In packaged apps, Tauri resourceDir is Contents/Resources but externalBin sidecars
 * are emitted to Contents/MacOS.
 * @param {string} bundlePath
 * @returns {string}
 */
function normalizeBundlePath(bundlePath) {
  if (typeof bundlePath !== 'string') {
    return bundlePath;
  }

  if (bundlePath.includes('/Contents/Resources')) {
    return bundlePath.replace('/Contents/Resources', '/Contents/MacOS');
  }

  return bundlePath;
}

/**
 * Get bundled servers with variables substituted
 * @param {string} vaultPath - Path to the vault
 * @param {string} bundlePath - Path to the app bundle resources (optional, fetched from Tauri)
 */
export async function getBundledServers(vaultPath, bundlePath = null) {
  // Get bundle path from Tauri if not provided
  if (!bundlePath) {
    try {
      const { resourceDir } = await import('@tauri-apps/api/path');
      const resDir = await resourceDir();

      // On macOS production, externalBin sidecars are in Contents/MacOS/
      // but resourceDir() returns Contents/Resources/
      if (resDir.includes('/Contents/Resources')) {
        bundlePath = normalizeBundlePath(resDir);
        console.log('[bundledServers] Production macOS detected, using MacOS directory for sidecars');
      } else {
        bundlePath = resDir;
      }
    } catch (e) {
      console.warn('Could not get bundle path from Tauri:', e);
      // Fallback for development - binaries are in src-tauri/target/debug
      bundlePath = './src-tauri/target/debug';
    }
  }

  // Normalize explicitly provided bundle paths too (e.g., from get_bundle_path command)
  bundlePath = normalizeBundlePath(bundlePath);

  console.log(`[bundledServers] Using bundlePath: ${bundlePath}, vaultPath: ${vaultPath}`);

  return bundledServers.map(server => {
    // Deep clone the server config
    const config = JSON.parse(JSON.stringify(server));

    // Replace ${BUNDLE_PATH} and ${VAULT_PATH} in command
    if (config.transport.command) {
      config.transport.command = config.transport.command
        .replace(/\$\{BUNDLE_PATH\}/g, bundlePath)
        .replace(/\$\{VAULT_PATH\}/g, vaultPath);
    }

    // Replace variables in args
    if (config.transport.args) {
      config.transport.args = config.transport.args.map(arg =>
        arg
          .replace(/\$\{BUNDLE_PATH\}/g, bundlePath)
          .replace(/\$\{VAULT_PATH\}/g, vaultPath)
      );
    }

    // Set working_dir to vault path for all Rust servers
    config.transport.working_dir = vaultPath;

    return config;
  });
}

/**
 * Get bundled server IDs
 */
export function getBundledServerIds() {
  return bundledServers.map(s => s.id);
}
