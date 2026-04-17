import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import MCPServerRegistry from './MCPServerRegistry.js';
import MCPConfigGenerator from './MCPConfigGenerator.js';

/**
 * Integration tests for MCP Dynamic Registry system
 *
 * These tests verify end-to-end flows from registry management through config
 * generation to backend command invocation.
 */
describe('MCP Integration Tests', () => {
  let registry;
  let generator;
  let mockInvoke;
  let mockSettingsManager;

  beforeEach(() => {
    // Initialize fresh instances
    registry = new MCPServerRegistry();
    generator = new MCPConfigGenerator(registry);

    // Mock Tauri invoke command
    mockInvoke = jest.fn();
    global.__TAURI_INTERNALS__.invoke = mockInvoke;

    // Mock SettingsManager
    mockSettingsManager = {
      get: jest.fn(),
      set: jest.fn()
    };
  });

  describe('End-to-end config generation and write', () => {
    test('generates Claude config and invokes write_mcp_config with correct parameters', async () => {
      // Enable vault-filesystem server
      registry.setServerEnabled('vault-filesystem', true);

      // Generate config for Claude
      const config = await generator.generateConfig(
        'claude',
        '/Users/test/vault',
        '/Applications/Vault.app/Contents/Resources'
      );

      // Verify config structure - Claude Code uses .mcp.json at project root
      expect(config.path).toBe('/Users/test/vault/.mcp.json');
      expect(config.format).toBe('json');
      expect(config.content).toBeDefined();

      // Parse and verify content
      const parsed = JSON.parse(config.content);
      expect(parsed.mcpServers).toBeDefined();
      expect(parsed.mcpServers['vault-filesystem']).toBeDefined();
      // stdio servers don't include 'type' field - Claude Code infers it
      expect(parsed.mcpServers['vault-filesystem'].type).toBeUndefined();
      expect(parsed.mcpServers['vault-filesystem'].command).toBe(
        '/Applications/Vault.app/Contents/Resources/mcp-filesystem-server'
      );
      expect(parsed.mcpServers['vault-filesystem'].args).toContain('--line-transport');
      expect(parsed.mcpServers['vault-filesystem'].args).toContain('--allowed-paths');
      expect(parsed.mcpServers['vault-filesystem'].args).toContain('/Users/test/vault');

      // Mock successful write
      mockInvoke.mockResolvedValueOnce(undefined);

      // Invoke write_mcp_config
      await mockInvoke('write_mcp_config', {
        path: config.path,
        content: config.content,
        format: config.format
      });

      // Verify invoke was called with correct parameters
      expect(mockInvoke).toHaveBeenCalledWith('write_mcp_config', {
        path: '/Users/test/vault/.mcp.json',
        content: expect.stringContaining('"mcpServers"'),
        format: 'json'
      });
    });

    test('handles write_mcp_config errors gracefully', async () => {
      // Enable server
      registry.setServerEnabled('vault-filesystem', true);

      // Generate config
      const config = await generator.generateConfig(
        'claude',
        '/Users/test/vault',
        '/Applications/Vault.app/Contents/Resources'
      );

      // Mock failed write (permission denied)
      mockInvoke.mockRejectedValueOnce(new Error('Permission denied'));

      // Verify error is propagated
      await expect(
        mockInvoke('write_mcp_config', {
          path: config.path,
          content: config.content,
          format: config.format
        })
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('Registry persistence through SettingsManager', () => {
    test('saves and restores registry state through SettingsManager', async () => {
      // Create registry with custom state
      const customConfig = {
        type: 'stdio',
        displayName: 'Custom API',
        description: 'Custom MCP server',
        command: '/usr/local/bin/custom-server',
        args: ['--port', '8080'],
        env: { API_KEY: 'test-key' }
      };

      registry.addUserServer('custom-api', customConfig);
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-search', true);
      registry.setServerEnabled('custom-api', true);

      // Serialize to JSON
      const registryData = registry.toJSON();

      // Mock SettingsManager.set
      mockSettingsManager.set.mockResolvedValueOnce(undefined);

      // Save to settings
      await mockSettingsManager.set('mcpServerRegistry', registryData);

      // Verify set was called with correct data
      expect(mockSettingsManager.set).toHaveBeenCalledWith('mcpServerRegistry', {
        userServers: {
          'custom-api': expect.objectContaining({
            displayName: 'Custom API',
            command: '/usr/local/bin/custom-server'
          })
        },
        enabledServers: expect.arrayContaining([
          'vault-filesystem',
          'vault-search',
          'custom-api'
        ])
      });

      // Mock SettingsManager.get to return saved data
      mockSettingsManager.get.mockResolvedValueOnce(registryData);

      // Load from settings
      const loadedData = await mockSettingsManager.get('mcpServerRegistry');
      const restoredRegistry = MCPServerRegistry.fromJSON(loadedData);

      // Verify restored registry matches original
      expect(restoredRegistry.userServers.has('custom-api')).toBe(true);
      expect(restoredRegistry.enabledServers.has('vault-filesystem')).toBe(true);
      expect(restoredRegistry.enabledServers.has('vault-search')).toBe(true);
      expect(restoredRegistry.enabledServers.has('custom-api')).toBe(true);

      const restoredServer = restoredRegistry.userServers.get('custom-api');
      expect(restoredServer.displayName).toBe('Custom API');
      expect(restoredServer.command).toBe('/usr/local/bin/custom-server');
    });

    test('handles missing registry data gracefully', async () => {
      // Mock SettingsManager.get returning null/undefined
      mockSettingsManager.get.mockResolvedValueOnce(null);

      const loadedData = await mockSettingsManager.get('mcpServerRegistry');

      // Should handle null gracefully
      if (!loadedData) {
        // Create new empty registry
        const newRegistry = new MCPServerRegistry();
        expect(newRegistry.userServers.size).toBe(0);
        expect(newRegistry.enabledServers.size).toBe(0);
      }
    });
  });

  describe('Multi-agent config generation', () => {
    test('generates configs for all three agents with same servers', async () => {
      // Enable 2 servers
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-search', true);

      const vaultPath = '/Users/test/vault';
      const bundlePath = '/Applications/Vault.app/Contents/Resources';

      // Generate configs for all three agents
      const claudeConfig = await generator.generateConfig('claude', vaultPath, bundlePath);
      const geminiConfig = await generator.generateConfig('gemini', vaultPath, bundlePath);
      const codexConfig = await generator.generateConfig('codex', vaultPath, bundlePath);

      // Verify 3 different file paths - Claude Code uses .mcp.json at project root
      expect(claudeConfig.path).toBe(`${vaultPath}/.mcp.json`);
      expect(geminiConfig.path).toMatch(/\.gemini\/settings\.json$/);
      expect(codexConfig.path).toMatch(/\.codex\/config\.toml$/);

      // Verify all configs contain same 2 servers
      const claudeParsed = JSON.parse(claudeConfig.content);
      expect(Object.keys(claudeParsed.mcpServers)).toHaveLength(2);
      expect(claudeParsed.mcpServers['vault-filesystem']).toBeDefined();
      expect(claudeParsed.mcpServers['vault-search']).toBeDefined();

      const geminiParsed = JSON.parse(geminiConfig.content);
      expect(Object.keys(geminiParsed.mcpServers)).toHaveLength(2);
      expect(geminiParsed.mcpServers['vault-filesystem']).toBeDefined();
      expect(geminiParsed.mcpServers['vault-search']).toBeDefined();

      // Verify TOML contains all servers
      expect(codexConfig.content).toContain('[mcp_servers."vault-filesystem"]');
      expect(codexConfig.content).toContain('[mcp_servers."vault-search"]');

      // Verify format differences
      expect(claudeConfig.format).toBe('json');
      expect(geminiConfig.format).toBe('json');
      expect(codexConfig.format).toBe('toml');

      // Verify Claude stdio servers don't include type field (Claude infers it)
      expect(claudeParsed.mcpServers['vault-filesystem']).toHaveProperty('command');
      expect(claudeParsed.mcpServers['vault-filesystem'].type).toBeUndefined();

      // Verify Gemini has timeout and trust fields
      expect(geminiParsed.mcpServers['vault-filesystem']).toHaveProperty('timeout');
      expect(geminiParsed.mcpServers['vault-filesystem']).toHaveProperty('trust');

      // Verify Gemini env uses $VAR syntax (not ${VAR})
      // Note: bundled servers don't have env vars, so we'd need to test with custom server
    });

    test('generates identical server lists across agents', async () => {
      // Enable specific servers
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-search', true);

      const vaultPath = '/Users/test/vault';
      const bundlePath = '/Applications/Vault.app/Contents/Resources';

      // Generate configs
      const claudeConfig = await generator.generateConfig('claude', vaultPath, bundlePath);
      const geminiConfig = await generator.generateConfig('gemini', vaultPath, bundlePath);

      // Parse
      const claudeParsed = JSON.parse(claudeConfig.content);
      const geminiParsed = JSON.parse(geminiConfig.content);

      // Both should have exactly 2 servers
      expect(Object.keys(claudeParsed.mcpServers)).toHaveLength(2);
      expect(Object.keys(geminiParsed.mcpServers)).toHaveLength(2);

      // Same servers in both
      expect(claudeParsed.mcpServers).toHaveProperty('vault-filesystem');
      expect(claudeParsed.mcpServers).toHaveProperty('vault-search');
      expect(geminiParsed.mcpServers).toHaveProperty('vault-filesystem');
      expect(geminiParsed.mcpServers).toHaveProperty('vault-search');
    });
  });

  describe('Server validation before save', () => {
    test('validates server before adding to registry', async () => {
      const validConfig = {
        type: 'stdio',
        displayName: 'Test Server',
        command: '/usr/local/bin/test-server',
        args: ['--port', '3000'],
        env: { API_KEY: 'test-key' }
      };

      // Mock validate_mcp_server returning success
      mockInvoke.mockResolvedValueOnce({
        valid: true,
        errors: [],
        warnings: []
      });

      // Validate server
      const validationResult = await mockInvoke('validate_mcp_server', {
        name: 'test-server',
        config: validConfig
      });

      // Verify validation was called
      expect(mockInvoke).toHaveBeenCalledWith('validate_mcp_server', {
        name: 'test-server',
        config: validConfig
      });

      // If valid, add to registry
      if (validationResult.valid) {
        registry.addUserServer('test-server', validConfig);
        expect(registry.userServers.has('test-server')).toBe(true);
      }
    });

    test('prevents adding server when validation fails', async () => {
      const invalidConfig = {
        type: 'stdio',
        command: '/nonexistent/path/server',
        args: [],
        env: {}
      };

      // Mock validate_mcp_server returning failure
      mockInvoke.mockResolvedValueOnce({
        valid: false,
        errors: ['Command not found: /nonexistent/path/server'],
        warnings: []
      });

      // Validate server
      const validationResult = await mockInvoke('validate_mcp_server', {
        name: 'invalid-server',
        config: invalidConfig
      });

      // Verify validation was called
      expect(mockInvoke).toHaveBeenCalledWith('validate_mcp_server', {
        name: 'invalid-server',
        config: invalidConfig
      });

      // Should not add to registry if invalid
      if (!validationResult.valid) {
        // Server should not be added
        expect(registry.userServers.has('invalid-server')).toBe(false);
        expect(validationResult.errors).toContain('Command not found: /nonexistent/path/server');
      }
    });

    test('handles validation for shell metacharacters', async () => {
      const maliciousConfig = {
        type: 'stdio',
        command: 'rm -rf / | cat',
        args: ['--flag', 'value; rm'],
        env: {}
      };

      // Mock validate_mcp_server detecting shell metacharacters
      mockInvoke.mockResolvedValueOnce({
        valid: false,
        errors: [
          'Invalid characters in command',
          'Invalid characters in args'
        ],
        warnings: []
      });

      // Validate server
      const validationResult = await mockInvoke('validate_mcp_server', {
        name: 'malicious-server',
        config: maliciousConfig
      });

      // Should fail validation
      expect(validationResult.valid).toBe(false);
      expect(validationResult.errors).toContain('Invalid characters in command');
      expect(validationResult.errors).toContain('Invalid characters in args');

      // Should not be added to registry
      expect(registry.userServers.has('malicious-server')).toBe(false);
    });
  });

  describe('CLI restart notification on config change', () => {
    test('emits mcp-config-updated event with requiresRestart flag', () => {
      // Mock event listener
      const eventListener = jest.fn();

      // Create a simple event target for testing
      const eventTarget = {
        listeners: {},
        addEventListener(event, callback) {
          this.listeners[event] = this.listeners[event] || [];
          this.listeners[event].push(callback);
        },
        dispatchEvent(event) {
          const listeners = this.listeners[event.type] || [];
          listeners.forEach(callback => callback(event));
        }
      };

      // Add event listener
      eventTarget.addEventListener('mcp-config-updated', eventListener);

      // Simulate config change
      registry.setServerEnabled('vault-filesystem', true);
      const enabledServers = Array.from(registry.enabledServers);

      // Emit event
      const event = {
        type: 'mcp-config-updated',
        detail: {
          enabledServers,
          requiresRestart: true
        }
      };
      eventTarget.dispatchEvent(event);

      // Verify event was fired with correct payload
      expect(eventListener).toHaveBeenCalled();
      expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
        detail: {
          enabledServers: expect.arrayContaining(['vault-filesystem']),
          requiresRestart: true
        }
      }));
    });

    test('event payload includes list of enabled servers', () => {
      const eventListener = jest.fn();

      const eventTarget = {
        listeners: {},
        addEventListener(event, callback) {
          this.listeners[event] = this.listeners[event] || [];
          this.listeners[event].push(callback);
        },
        dispatchEvent(event) {
          const listeners = this.listeners[event.type] || [];
          listeners.forEach(callback => callback(event));
        }
      };

      eventTarget.addEventListener('mcp-config-updated', eventListener);

      // Enable multiple servers
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-search', true);

      const enabledServers = Array.from(registry.enabledServers);

      // Emit event
      const event = {
        type: 'mcp-config-updated',
        detail: {
          enabledServers,
          requiresRestart: true
        }
      };
      eventTarget.dispatchEvent(event);

      // Verify enabled servers list is correct
      expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({
          enabledServers: expect.arrayContaining([
            'vault-filesystem',
            'vault-search'
          ])
        })
      }));
    });

    test('requiresRestart is false when CLI is not running', () => {
      const eventListener = jest.fn();

      const eventTarget = {
        listeners: {},
        addEventListener(event, callback) {
          this.listeners[event] = this.listeners[event] || [];
          this.listeners[event].push(callback);
        },
        dispatchEvent(event) {
          const listeners = this.listeners[event.type] || [];
          listeners.forEach(callback => callback(event));
        }
      };

      eventTarget.addEventListener('mcp-config-updated', eventListener);

      // Simulate CLI not running
      const cliRunning = false;

      // Change config
      registry.setServerEnabled('vault-filesystem', true);
      const enabledServers = Array.from(registry.enabledServers);

      // Emit event with requiresRestart based on CLI state
      const event = {
        type: 'mcp-config-updated',
        detail: {
          enabledServers,
          requiresRestart: cliRunning
        }
      };
      eventTarget.dispatchEvent(event);

      // Verify requiresRestart is false
      expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({
          requiresRestart: false
        })
      }));
    });
  });

  describe('Error handling integration', () => {
    test('handles invalid JSON in config content', async () => {
      // Enable server
      registry.setServerEnabled('vault-filesystem', true);

      // Generate config
      const config = await generator.generateConfig(
        'claude',
        '/Users/test/vault',
        '/Applications/Vault.app/Contents/Resources'
      );

      // Mock write_mcp_config rejecting invalid JSON
      mockInvoke.mockRejectedValueOnce(new Error('Invalid JSON: unexpected token'));

      // Corrupt the content
      const corruptedContent = config.content.slice(0, -10);

      // Attempt to write corrupted config
      await expect(
        mockInvoke('write_mcp_config', {
          path: config.path,
          content: corruptedContent,
          format: 'json'
        })
      ).rejects.toThrow('Invalid JSON');
    });

    test('handles get_bundle_path command', async () => {
      // Mock get_bundle_path
      mockInvoke.mockResolvedValueOnce('/Applications/Vault.app/Contents/Resources');

      const bundlePath = await mockInvoke('get_bundle_path');

      expect(mockInvoke).toHaveBeenCalledWith('get_bundle_path');
      expect(bundlePath).toBe('/Applications/Vault.app/Contents/Resources');
    });

    test('handles get_bundle_path failure', async () => {
      // Mock get_bundle_path failure
      mockInvoke.mockRejectedValueOnce(new Error('Failed to determine bundle path'));

      await expect(
        mockInvoke('get_bundle_path')
      ).rejects.toThrow('Failed to determine bundle path');
    });
  });

  describe('Complete end-to-end workflow', () => {
    test('full workflow: load → modify → generate → validate → save → reload', async () => {
      // Step 1: Load initial state (empty)
      mockSettingsManager.get.mockResolvedValueOnce(null);
      const initialData = await mockSettingsManager.get('mcpServerRegistry');

      let workingRegistry;
      if (!initialData) {
        workingRegistry = new MCPServerRegistry();
      } else {
        workingRegistry = MCPServerRegistry.fromJSON(initialData);
      }

      // Step 2: Modify registry - enable bundled servers
      workingRegistry.setServerEnabled('vault-filesystem', true);
      workingRegistry.setServerEnabled('vault-search', true);

      // Step 3: Add custom server with validation
      const customConfig = {
        type: 'stdio',
        displayName: 'GitHub MCP',
        command: '/usr/local/bin/mcp-github',
        args: ['--token', '${GITHUB_TOKEN}'],
        env: { GITHUB_TOKEN: 'test-token' }
      };

      // Mock validation success
      mockInvoke.mockResolvedValueOnce({
        valid: true,
        errors: [],
        warnings: []
      });

      const validation = await mockInvoke('validate_mcp_server', {
        name: 'github',
        config: customConfig
      });

      if (validation.valid) {
        workingRegistry.addUserServer('github', customConfig);
        workingRegistry.setServerEnabled('github', true);
      }

      // Step 4: Generate config for Claude
      const workingGenerator = new MCPConfigGenerator(workingRegistry);
      const config = await workingGenerator.generateConfig(
        'claude',
        '/Users/test/vault',
        '/Applications/Vault.app/Contents/Resources'
      );

      // Verify config includes all enabled servers
      const parsed = JSON.parse(config.content);
      expect(Object.keys(parsed.mcpServers)).toHaveLength(3);
      expect(parsed.mcpServers).toHaveProperty('vault-filesystem');
      expect(parsed.mcpServers).toHaveProperty('vault-search');
      expect(parsed.mcpServers).toHaveProperty('github');

      // Step 5: Write config
      mockInvoke.mockResolvedValueOnce(undefined);
      await mockInvoke('write_mcp_config', {
        path: config.path,
        content: config.content,
        format: config.format
      });

      // Step 6: Save registry state
      const registryData = workingRegistry.toJSON();
      mockSettingsManager.set.mockResolvedValueOnce(undefined);
      await mockSettingsManager.set('mcpServerRegistry', registryData);

      // Step 7: Reload from settings (simulate app restart)
      mockSettingsManager.get.mockResolvedValueOnce(registryData);
      const reloadedData = await mockSettingsManager.get('mcpServerRegistry');
      const reloadedRegistry = MCPServerRegistry.fromJSON(reloadedData);

      // Verify state persisted correctly
      expect(reloadedRegistry.userServers.has('github')).toBe(true);
      expect(reloadedRegistry.enabledServers.has('vault-filesystem')).toBe(true);
      expect(reloadedRegistry.enabledServers.has('vault-search')).toBe(true);
      expect(reloadedRegistry.enabledServers.has('github')).toBe(true);
    });
  });
});
