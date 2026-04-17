import { describe, test, expect, beforeEach } from '@jest/globals';
import MCPServerRegistry from './MCPServerRegistry.js';

describe('MCPServerRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new MCPServerRegistry();
  });

  describe('Constructor', () => {
    test('initializes with bundled servers', () => {
      expect(registry.bundledServers).toBeDefined();
      expect(registry.bundledServers['vault-filesystem']).toBeDefined();
      expect(registry.bundledServers['vault-search']).toBeDefined();
    });

    test('initializes with empty user servers', () => {
      expect(registry.userServers).toBeInstanceOf(Map);
      expect(registry.userServers.size).toBe(0);
    });

    test('initializes with empty enabled servers', () => {
      expect(registry.enabledServers).toBeInstanceOf(Set);
      expect(registry.enabledServers.size).toBe(0);
    });
  });

  describe('addUserServer', () => {
    test('adds custom server to userServers Map', () => {
      const config = {
        type: 'stdio',
        displayName: 'Test Server',
        description: 'Test description',
        command: '/usr/local/bin/test-server',
        args: ['--port', '3000'],
        env: { API_KEY: 'test-key' }
      };

      registry.addUserServer('test-server', config);

      expect(registry.userServers.has('test-server')).toBe(true);
      const server = registry.userServers.get('test-server');
      expect(server.builtin).toBe(false);
      expect(server.displayName).toBe('Test Server');
    });

    test('rejects duplicate names', () => {
      const config = {
        type: 'stdio',
        command: '/bin/echo'
      };

      registry.addUserServer('test-server', config);

      expect(() => {
        registry.addUserServer('test-server', config);
      }).toThrow();
    });
  });

  describe('removeUserServer', () => {
    test('removes custom server from userServers', () => {
      const config = {
        type: 'stdio',
        command: '/bin/echo'
      };

      registry.addUserServer('test-server', config);
      registry.setServerEnabled('test-server', true);

      registry.removeUserServer('test-server');

      expect(registry.userServers.has('test-server')).toBe(false);
      expect(registry.enabledServers.has('test-server')).toBe(false);
    });

    test('does not remove bundled servers', () => {
      registry.removeUserServer('vault-filesystem');
      expect(registry.bundledServers['vault-filesystem']).toBeDefined();
    });
  });

  describe('setServerEnabled', () => {
    test('enables server', () => {
      registry.setServerEnabled('vault-filesystem', true);
      expect(registry.enabledServers.has('vault-filesystem')).toBe(true);
    });

    test('disables server', () => {
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-filesystem', false);
      expect(registry.enabledServers.has('vault-filesystem')).toBe(false);
    });
  });

  describe('getEnabledServers', () => {
    test('returns only enabled servers', () => {
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-search', true);

      const enabled = registry.getEnabledServers();

      expect(Object.keys(enabled)).toHaveLength(2);
      expect(enabled['vault-filesystem']).toBeDefined();
      expect(enabled['vault-search']).toBeDefined();
    });
  });

  describe('toJSON / fromJSON', () => {
    test('serializes registry state', () => {
      const config = {
        type: 'stdio',
        command: '/bin/echo'
      };

      registry.addUserServer('custom-server', config);
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('custom-server', true);

      const json = registry.toJSON();

      expect(json.userServers).toBeDefined();
      expect(json.enabledServers).toBeDefined();
      expect(json.enabledServers).toContain('vault-filesystem');
      expect(json.enabledServers).toContain('custom-server');
    });

    test('restores registry state from JSON', () => {
      const config = {
        type: 'stdio',
        command: '/bin/echo',
        displayName: 'Custom Server',
        builtin: false
      };

      registry.addUserServer('custom-server', config);
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('custom-server', true);

      const json = registry.toJSON();
      const restored = MCPServerRegistry.fromJSON(json);

      expect(restored.userServers.has('custom-server')).toBe(true);
      expect(restored.enabledServers.has('vault-filesystem')).toBe(true);
      expect(restored.enabledServers.has('custom-server')).toBe(true);
    });
  });

  describe('_expandConfig', () => {
    test('expands VAULT_PATH variable in args', () => {
      const server = {
        type: 'stdio',
        command: '/bin/echo',
        args: ['--path', '${VAULT_PATH}'],
        env: {}
      };

      const vars = {
        VAULT_PATH: '/test/vault',
        BUNDLE_PATH: '/app/resources'
      };

      const expanded = registry._expandConfig(server, vars);

      expect(expanded.args).toEqual(['--path', '/test/vault']);
    });

    test('expands BUNDLE_PATH variable in command', () => {
      const server = {
        type: 'stdio',
        command: '${BUNDLE_PATH}/server',
        args: [],
        env: {}
      };

      const vars = {
        VAULT_PATH: '/test/vault',
        BUNDLE_PATH: '/app/resources'
      };

      const expanded = registry._expandConfig(server, vars);

      expect(expanded.command).toBe('/app/resources/server');
    });

    test('expands variables in env values', () => {
      const server = {
        type: 'stdio',
        command: '/bin/echo',
        args: [],
        env: {
          VAULT_DIR: '${VAULT_PATH}',
          BUNDLE_DIR: '${BUNDLE_PATH}'
        }
      };

      const vars = {
        VAULT_PATH: '/test/vault',
        BUNDLE_PATH: '/app/resources'
      };

      const expanded = registry._expandConfig(server, vars);

      expect(expanded.env.VAULT_DIR).toBe('/test/vault');
      expect(expanded.env.BUNDLE_DIR).toBe('/app/resources');
    });

    test('does not mutate original config', () => {
      const server = {
        type: 'stdio',
        command: '${BUNDLE_PATH}/server',
        args: ['${VAULT_PATH}'],
        env: { DIR: '${VAULT_PATH}' }
      };

      const vars = {
        VAULT_PATH: '/test/vault',
        BUNDLE_PATH: '/app/resources'
      };

      registry._expandConfig(server, vars);

      // Original should be unchanged
      expect(server.command).toBe('${BUNDLE_PATH}/server');
      expect(server.args[0]).toBe('${VAULT_PATH}');
      expect(server.env.DIR).toBe('${VAULT_PATH}');
    });
  });
});
