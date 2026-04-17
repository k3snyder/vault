/**
 * MCPServerRegistry - Registry for tracking enabled servers and user-defined servers
 *
 * NOTE: Bundled server configurations are now managed ONLY by bundledServers.js
 * This registry only tracks:
 * - Which servers are enabled (enabledServers Set)
 * - User-defined custom servers (userServers Map)
 */
export default class MCPServerRegistry {
  /**
   * Initialize registry
   */
  constructor() {
    /** @type {Object<string, ServerConfig>} DEPRECATED - bundled servers now come from bundledServers.js */
    this.bundledServers = {};

    /** @type {Map<string, ServerConfig>} User-defined custom servers */
    this.userServers = new Map();

    /** @type {Set<string>} Names of enabled servers */
    this.enabledServers = new Set();
  }

  /**
   * Add a custom user-defined server to the registry
   * @param {string} name - Unique identifier for the server
   * @param {ServerConfig} config - Server configuration object
   * @throws {Error} If name already exists
   */
  addUserServer(name, config) {
    // Check for duplicate names in user servers
    if (this.userServers.has(name)) {
      throw new Error(`Server name already exists: ${name}`);
    }

    // Clone config and ensure builtin is false
    const serverConfig = {
      ...config,
      builtin: false
    };

    this.userServers.set(name, serverConfig);
  }

  /**
   * Remove a user-defined server from the registry
   * @param {string} name - Server identifier to remove
   */
  removeUserServer(name) {
    // Only remove if it's a user server (not bundled)
    if (this.userServers.has(name)) {
      this.userServers.delete(name);
      // Also remove from enabled servers if it was enabled
      this.enabledServers.delete(name);
    }
  }

  /**
   * Enable or disable a server in the registry
   * @param {string} name - Server identifier
   * @param {boolean} enabled - Enable (true) or disable (false)
   */
  setServerEnabled(name, enabled) {
    if (enabled) {
      this.enabledServers.add(name);
    } else {
      this.enabledServers.delete(name);
    }
  }

  /**
   * Get all enabled servers with their configurations
   * NOTE: Only returns user-defined servers. Bundled servers come from bundledServers.js
   * @returns {Object<string, ServerConfig>} Object mapping server names to configs
   */
  getEnabledServers() {
    const enabled = {};

    // Only add enabled user servers (bundled servers come from bundledServers.js)
    for (const [name, config] of this.userServers.entries()) {
      if (this.enabledServers.has(name)) {
        enabled[name] = config;
      }
    }

    return enabled;
  }

  /**
   * Expand configuration variables
   * @private
   * @param {ServerConfig} server - Server configuration
   * @param {Object} vars - Variables to expand (VAULT_PATH, BUNDLE_PATH)
   * @returns {ServerConfig} Expanded configuration
   */
  _expandConfig(server, vars) {
    const expanded = JSON.parse(JSON.stringify(server));

    // Expand command
    if (expanded.command) {
      expanded.command = this._expandString(expanded.command, vars);
    }

    // Expand args
    if (expanded.args && Array.isArray(expanded.args)) {
      expanded.args = expanded.args.map(arg => this._expandString(arg, vars));
    }

    // Expand env values
    if (expanded.env) {
      for (const key in expanded.env) {
        expanded.env[key] = this._expandString(expanded.env[key], vars);
      }
    }

    return expanded;
  }

  /**
   * Expand variables in a string
   * @private
   * @param {string} str - String to expand
   * @param {Object} vars - Variables to expand
   * @returns {string} Expanded string
   */
  _expandString(str, vars) {
    let result = str;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Serialize registry state to JSON for persistence
   * @returns {Object} Serialized registry state
   */
  toJSON() {
    return {
      userServers: Object.fromEntries(this.userServers),
      enabledServers: Array.from(this.enabledServers)
    };
  }

  /**
   * Restore registry from JSON data
   * @param {Object} data - Serialized registry state
   * @returns {MCPServerRegistry} Restored registry instance
   */
  static fromJSON(data) {
    const registry = new MCPServerRegistry();

    // Restore user servers
    if (data.userServers) {
      for (const [name, config] of Object.entries(data.userServers)) {
        registry.userServers.set(name, config);
      }
    }

    // Restore enabled servers
    if (data.enabledServers && Array.isArray(data.enabledServers)) {
      registry.enabledServers = new Set(data.enabledServers);
    }

    return registry;
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
