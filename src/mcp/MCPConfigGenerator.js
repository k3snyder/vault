import { getBundledServers } from './bundledServers.js';
import { homeDir } from '@tauri-apps/api/path';

/**
 * MCPConfigGenerator - Multi-agent MCP configuration generator
 *
 * This class detects CLI agent types from command strings and generates
 * agent-specific configuration files with proper environment variable expansion.
 */
export default class MCPConfigGenerator {
  /**
   * Initialize generator with server registry reference
   * @param {MCPServerRegistry} serverRegistry - Registry instance to generate configs from
   */
  constructor(serverRegistry) {
    /** @type {MCPServerRegistry} Registry containing server configurations */
    this.serverRegistry = serverRegistry;
  }

  /**
   * Detect CLI agent type from command string
   * @param {string} command - CLI command being executed
   * @returns {string} Agent identifier: 'claude', 'gemini', 'codex', or 'unknown'
   */
  detectAgent(command) {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('claude')) {
      return 'claude';
    }

    if (lowerCommand.includes('gemini')) {
      return 'gemini';
    }

    if (lowerCommand.includes('codex')) {
      return 'codex';
    }

    return 'unknown';
  }

  /**
   * Expand environment variables in a string
   * @private
   * @param {string} str - String to expand
   * @param {string} vaultPath - Absolute path to vault directory
   * @param {string} bundlePath - Absolute path to bundled resources
   * @returns {string} Expanded string
   */
  _expand(str, vaultPath, bundlePath) {
    let result = str;

    // Expand VAULT_PATH
    result = result.replace(/\$\{VAULT_PATH\}/g, vaultPath);

    // Expand BUNDLE_PATH
    result = result.replace(/\$\{BUNDLE_PATH\}/g, bundlePath);

    // Expand system environment variables
    result = result.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      // If it's not VAULT_PATH or BUNDLE_PATH, try to get from process.env
      return process.env[varName] || match;
    });

    return result;
  }

  /**
   * Expand environment variables in all server configurations
   * @private
   * @param {Object<string, ServerConfig>} servers - Server configurations to expand
   * @param {string} vaultPath - Absolute path to vault directory
   * @param {string} bundlePath - Absolute path to bundled resources
   * @returns {Object<string, ServerConfig>} Expanded server configurations
   */
  _expandServers(servers, vaultPath, bundlePath) {
    const expanded = {};

    for (const [name, config] of Object.entries(servers)) {
      // Deep clone the config
      const serverConfig = JSON.parse(JSON.stringify(config));

      // Expand command
      if (serverConfig.command) {
        serverConfig.command = this._expand(serverConfig.command, vaultPath, bundlePath);
      }

      // Expand args
      if (serverConfig.args && Array.isArray(serverConfig.args)) {
        serverConfig.args = serverConfig.args.map(arg =>
          this._expand(arg, vaultPath, bundlePath)
        );
      }

      // Expand env values
      if (serverConfig.env) {
        for (const key in serverConfig.env) {
          serverConfig.env[key] = this._expand(serverConfig.env[key], vaultPath, bundlePath);
        }
      }

      expanded[name] = serverConfig;
    }

    return expanded;
  }

  /**
   * Generate Claude Code configuration format
   *
   * Produces a .claude/settings.local.json config file compatible with Claude Code's
   * MCP server requirements. The config includes the mcpServers object at root level,
   * with each server entry containing type, command, args, and env properties.
   *
   * @private
   * @param {Object<string, ServerConfig>} servers - Server configurations to include
   * @param {string} vaultPath - Absolute path to vault directory
   * @returns {ConfigOutput} Configuration output with path, content, and format
   *
   * @example
   * const servers = {
   *   'vault-filesystem': {
   *     type: 'stdio',
   *     command: '/bundle/mcp-filesystem-server',
   *     args: ['--allowed-paths', '/vault'],
   *     env: {}
   *   }
   * };
   * const config = generator._generateClaudeConfig(servers, '/vault');
   * // Returns:
   * // {
   * //   path: '/vault/.claude/settings.local.json',
   * //   content: '{"mcpServers":{"vault-filesystem":{...}}}',
   * //   format: 'json'
   * // }
   */
  _generateClaudeConfig(servers, vaultPath) {
    // Build mcpServers object with only required fields for Claude Code
    const mcpServers = {};

    for (const [name, config] of Object.entries(servers)) {
      if (config.type === 'http') {
        // HTTP transport - use type and url fields
        mcpServers[name] = {
          type: 'http',
          url: config.url
        };
      } else {
        // stdio transport - use command, args, env (no 'type' field - Claude Code infers it)
        const serverConfig = {
          command: config.command,
          args: config.args || []
        };
        // Only add env if it has values
        if (config.env && Object.keys(config.env).length > 0) {
          serverConfig.env = config.env;
        }
        mcpServers[name] = serverConfig;
      }
    }

    // Create config object with mcpServers at root
    const configObject = {
      mcpServers
    };

    // Return config output - Claude Code expects .mcp.json at project root
    return {
      path: `${vaultPath}/.mcp.json`,
      content: JSON.stringify(configObject, null, 2),
      format: 'json'
    };
  }

  /**
   * Convert environment variable syntax for Gemini CLI
   *
   * Gemini CLI expects environment variables in $VAR format instead of ${VAR}.
   * This method converts all ${VAR} occurrences to $VAR format.
   *
   * @private
   * @param {Object<string, string>} env - Environment variables to convert
   * @returns {Object<string, string>} Converted environment variables
   *
   * @example
   * const env = { API_KEY: '${MY_API_KEY}', PATH: '/usr/bin:${HOME}/bin' };
   * const converted = generator._convertEnvForGemini(env);
   * // Returns: { API_KEY: '$MY_API_KEY', PATH: '/usr/bin:$HOME/bin' }
   */
  _convertEnvForGemini(env) {
    const converted = {};

    for (const [key, value] of Object.entries(env)) {
      // Convert ${VAR} to $VAR
      converted[key] = value.replace(/\$\{([^}]+)\}/g, '$$$1');
    }

    return converted;
  }

  /**
   * Generate Gemini CLI configuration format
   *
   * Produces a ~/.gemini/settings.json config file compatible with Gemini CLI's
   * MCP server requirements. The config includes the mcpServers object at root level,
   * with each server entry containing command, args, env (with $VAR syntax), timeout,
   * and trust properties. Gemini-specific fields:
   * - timeout: Connection timeout in milliseconds (default: 60000)
   * - trust: Whether to trust the server without prompting (default: false)
   * - includeTools/excludeTools: Optional arrays for tool filtering
   *
   * @private
   * @param {Object<string, ServerConfig>} servers - Server configurations to include
   * @returns {ConfigOutput} Configuration output with path, content, and format
   *
   * @example
   * const servers = {
   *   'vault-filesystem': {
   *     type: 'stdio',
   *     command: '/bundle/mcp-filesystem-server',
   *     args: ['--allowed-paths', '/vault'],
   *     env: { API_KEY: '${MY_KEY}' }
   *   }
   * };
   * const config = generator._generateGeminiConfig(servers, '/Users/john');
   * // Returns:
   * // {
   * //   path: '/Users/john/.gemini/settings.json',
   * //   content: '{"mcpServers":{"vault-filesystem":{...}}}',
   * //   format: 'json'
   * // }
   */
  _generateGeminiConfig(servers, homedir) {

    // Build mcpServers object with Gemini-specific fields
    const mcpServers = {};

    for (const [name, config] of Object.entries(servers)) {
      if (config.type === 'http') {
        // HTTP/SSE transport - use url
        mcpServers[name] = {
          url: config.url,
          timeout: 60000,
          trust: false
        };
      } else {
        // stdio transport - use command, args, env
        mcpServers[name] = {
          command: config.command,
          args: config.args || [],
          env: this._convertEnvForGemini(config.env || {}),
          timeout: 60000,
          trust: false
        };
      }
    }

    // Create config object with mcpServers at root
    const configObject = {
      mcpServers
    };

    // Return config output
    return {
      path: `${homedir}/.gemini/settings.json`,
      content: JSON.stringify(configObject, null, 2),
      format: 'json'
    };
  }

  /**
   * Generate agent-specific MCP configuration
   *
   * This is the main orchestration method that coordinates the entire config generation
   * process. It retrieves enabled servers from the registry, expands environment variables,
   * and routes to the appropriate agent-specific generator.
   *
   * @async
   * @param {string} agent - Agent identifier ('claude', 'gemini', or 'codex')
   * @param {string} vaultPath - Absolute path to vault directory
   * @param {string} bundlePath - Absolute path to bundled resources
   * @returns {Promise<ConfigOutput>} Configuration output with path, content, and format
   * @throws {Error} If agent is unknown
   *
   * @example
   * const config = await generator.generateConfig(
   *   'claude',
   *   '/Users/john/vault',
   *   '/Applications/Vault.app/Contents/Resources'
   * );
   * // Returns:
   * // {
   * //   path: '/Users/john/vault/.claude/settings.local.json',
   * //   content: '{"mcpServers":{...}}',
   * //   format: 'json'
   * // }
   */
  async generateConfig(agent, vaultPath, bundlePath) {
    // Get enabled user servers from registry
    const userServers = this.serverRegistry.getEnabledServers();

    // Expand variables in user server configurations
    const expandedUserServers = this._expandServers(userServers, vaultPath, bundlePath);

    // Get enabled bundled servers (already expanded by getBundledServers)
    const enabledServerIds = this.serverRegistry.enabledServers;
    const allBundledServers = await getBundledServers(vaultPath, bundlePath);

    // Convert bundled servers to the expected format and filter to enabled only
    const expandedBundledServers = {};
    for (const server of allBundledServers) {
      if (enabledServerIds.has(server.id)) {
        expandedBundledServers[server.id] = {
          type: server.transport?.type || 'stdio',
          command: server.transport?.command,
          args: server.transport?.args || [],
          env: server.transport?.env || {}
        };
      }
    }

    // Merge user servers and bundled servers (user servers override if same name)
    const allServers = { ...expandedBundledServers, ...expandedUserServers };

    console.log('[MCPConfigGenerator] Generating config for', agent);
    console.log('[MCPConfigGenerator] Enabled bundled servers:', Object.keys(expandedBundledServers));
    console.log('[MCPConfigGenerator] Enabled user servers:', Object.keys(expandedUserServers));

    // Get home directory from Tauri for agents that need it
    let homedir = null;
    if (agent === 'gemini' || agent === 'codex') {
      homedir = await homeDir();
      console.log('[MCPConfigGenerator] Using home directory:', homedir);
    }

    // Route to appropriate generator based on agent type
    switch (agent) {
      case 'claude':
        return this._generateClaudeConfig(allServers, vaultPath);

      case 'gemini':
        return this._generateGeminiConfig(allServers, homedir);

      case 'codex':
        return this._generateCodexConfig(allServers, homedir);

      default:
        throw new Error(`Unknown agent: ${agent}`);
    }
  }

  /**
   * Generate Codex CLI configuration format
   *
   * Produces a ~/.codex/config.toml config file compatible with Codex CLI's
   * MCP server requirements. The config uses TOML format with [mcp_servers."name"]
   * sections for each server. Each server entry contains command, args (array), and
   * env (nested table) properties.
   *
   * @private
   * @param {Object<string, ServerConfig>} servers - Server configurations to include
   * @returns {ConfigOutput} Configuration output with path, content, and format
   *
   * @example
   * const servers = {
   *   'vault-filesystem': {
   *     type: 'stdio',
   *     command: '/bundle/mcp-filesystem-server',
   *     args: ['--allowed-paths', '/vault'],
   *     env: { VAULT_PATH: '/vault' }
   *   }
   * };
   * const config = generator._generateCodexConfig(servers, '/Users/john');
   * // Returns:
   * // {
   * //   path: '/Users/john/.codex/config.toml',
   * //   content: '[mcp_servers."vault-filesystem"]\ncommand = "/bundle/mcp-filesystem-server"\n...',
   * //   format: 'toml'
   * // }
   */
  _generateCodexConfig(servers, homedir) {

    // Build TOML content
    let toml = '';

    for (const [name, config] of Object.entries(servers)) {
      // Add server section header
      toml += `[mcp_servers."${name}"]\n`;

      if (config.type === 'http') {
        // HTTP/SSE transport - use url
        toml += `url = "${config.url}"\n`;
      } else {
        // stdio transport - use command, args, env
        toml += `command = "${config.command}"\n`;

        // Add args if they exist
        if (config.args && config.args.length > 0) {
          // Format args array with proper spacing for TOML
          const argsFormatted = config.args.map(arg => `"${arg}"`).join(', ');
          toml += `args = [${argsFormatted}]\n`;
        }

        // Add env section if it exists
        if (config.env && Object.keys(config.env).length > 0) {
          toml += `\n[mcp_servers."${name}".env]\n`;
          for (const [key, value] of Object.entries(config.env)) {
            toml += `${key} = "${value}"\n`;
          }
        }
      }

      // Add blank line between servers
      toml += '\n';
    }

    // Return config output
    return {
      path: `${homedir}/.codex/config.toml`,
      content: toml,
      format: 'toml'
    };
  }
}

/**
 * @typedef {Object} ServerConfig
 * @property {'stdio'|'http'|'sse'} type - Server transport type
 * @property {string} [displayName] - Human-readable server name
 * @property {string} [description] - Server description
 * @property {string} command - Command to execute or URL
 * @property {string[]} [args] - Command arguments
 * @property {Object<string, string>} [env] - Environment variables
 * @property {boolean} [builtin] - Whether this is a bundled server
 */

/**
 * @typedef {Object} ConfigOutput
 * @property {string} path - Absolute path to config file
 * @property {string} content - File content (JSON or TOML)
 * @property {'json'|'toml'} format - Config format
 */
