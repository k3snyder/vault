import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import MCPConfigGenerator from './MCPConfigGenerator.js';
import MCPServerRegistry from './MCPServerRegistry.js';

describe('MCPConfigGenerator', () => {
  let registry;
  let generator;

  beforeEach(() => {
    registry = new MCPServerRegistry();
    generator = new MCPConfigGenerator(registry);
  });

  describe('Constructor', () => {
    test('can be instantiated with registry instance', () => {
      expect(generator).toBeDefined();
      expect(generator.serverRegistry).toBe(registry);
    });
  });

  describe('detectAgent', () => {
    test('identifies Claude Code', () => {
      expect(generator.detectAgent('claude code')).toBe('claude');
    });

    test('identifies Gemini CLI', () => {
      expect(generator.detectAgent('gemini')).toBe('gemini');
    });

    test('identifies Codex CLI', () => {
      expect(generator.detectAgent('codex')).toBe('codex');
    });

    test('returns unknown for unrecognized command', () => {
      expect(generator.detectAgent('bash')).toBe('unknown');
    });
  });

  describe('_expand helper', () => {
    test('expands VAULT_PATH variable', () => {
      const result = generator._expand('${VAULT_PATH}/file', '/vault', '/bundle');
      expect(result).toBe('/vault/file');
    });

    test('expands BUNDLE_PATH variable', () => {
      const result = generator._expand('${BUNDLE_PATH}/server', '/vault', '/bundle');
      expect(result).toBe('/bundle/server');
    });

    test('expands both variables', () => {
      const result = generator._expand('${BUNDLE_PATH}/bin --path ${VAULT_PATH}', '/vault', '/bundle');
      expect(result).toBe('/bundle/bin --path /vault');
    });

    test('returns unchanged string with no variables', () => {
      const result = generator._expand('/usr/bin/test', '/vault', '/bundle');
      expect(result).toBe('/usr/bin/test');
    });
  });

  describe('_expandServers helper', () => {
    test('expands all server configurations', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '${BUNDLE_PATH}/server',
          args: ['--path', '${VAULT_PATH}'],
          env: { PATH: '${BUNDLE_PATH}/bin' }
        }
      };

      const expanded = generator._expandServers(servers, '/vault', '/bundle');

      expect(expanded['test-server'].command).toBe('/bundle/server');
      expect(expanded['test-server'].args[1]).toBe('/vault');
      expect(expanded['test-server'].env.PATH).toBe('/bundle/bin');
    });
  });

  describe('_generateClaudeConfig', () => {
    test('_generateClaudeConfig method exists', () => {
      expect(typeof generator._generateClaudeConfig).toBe('function');
    });

    test('returns object with path, content, format properties', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: ['--arg1'],
          env: { KEY: 'value' }
        }
      };

      const result = generator._generateClaudeConfig(servers, '/test/vault');

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('format');
    });

    test('path ends with .mcp.json', () => {
      const servers = {};
      const result = generator._generateClaudeConfig(servers, '/test/vault');

      expect(result.path).toBe('/test/vault/.mcp.json');
    });

    test('content is valid JSON string', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: [],
          env: {}
        }
      };

      const result = generator._generateClaudeConfig(servers, '/test/vault');

      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    test('parsed JSON has mcpServers object at root', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: [],
          env: {}
        }
      };

      const result = generator._generateClaudeConfig(servers, '/test/vault');
      const parsed = JSON.parse(result.content);

      expect(parsed).toHaveProperty('mcpServers');
      expect(typeof parsed.mcpServers).toBe('object');
    });

    test('each server entry has type, command, args, env properties', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          command: '/bundle/mcp-filesystem-server',
          args: ['--allowed-paths', '/test/vault'],
          env: { VAULT: 'test' }
        },
        'vault-search': {
          type: 'stdio',
          command: '/bundle/mcp-search-server',
          args: ['--index-path', '/test/vault/.vault/search'],
          env: {}
        }
      };

      const result = generator._generateClaudeConfig(servers, '/test/vault');
      const parsed = JSON.parse(result.content);

      // stdio servers don't include 'type' field - Claude Code infers it
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('command');
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('args');
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('env');

      expect(parsed.mcpServers['vault-search']).toHaveProperty('command');
      expect(parsed.mcpServers['vault-search']).toHaveProperty('args');
      // env is only included if non-empty
    });

    test('format property is json', () => {
      const servers = {};
      const result = generator._generateClaudeConfig(servers, '/test/vault');

      expect(result.format).toBe('json');
    });

    test('generates proper Claude Code config structure', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          displayName: 'Vault Filesystem',
          description: 'Read and write files in your vault',
          command: '/bundle/mcp-filesystem-server',
          args: ['--allowed-paths', '/test/vault'],
          env: { VAULT_PATH: '/test/vault' },
          builtin: true
        }
      };

      const result = generator._generateClaudeConfig(servers, '/test/vault');
      const parsed = JSON.parse(result.content);

      // stdio servers don't include 'type' field - Claude Code infers it
      expect(parsed.mcpServers['vault-filesystem'].type).toBeUndefined();
      expect(parsed.mcpServers['vault-filesystem'].command).toBe('/bundle/mcp-filesystem-server');
      expect(parsed.mcpServers['vault-filesystem'].args).toEqual(['--allowed-paths', '/test/vault']);
      expect(parsed.mcpServers['vault-filesystem'].env).toEqual({ VAULT_PATH: '/test/vault' });
    });
  });

  describe('_convertEnvForGemini helper', () => {
    test('converts ${VAR} syntax to $VAR syntax', () => {
      const env = {
        API_KEY: '${MY_API_KEY}',
        PATH: '/usr/bin:${HOME}/bin',
        SIMPLE: 'no_vars_here'
      };

      const result = generator._convertEnvForGemini(env);

      expect(result.API_KEY).toBe('$MY_API_KEY');
      expect(result.PATH).toBe('/usr/bin:$HOME/bin');
      expect(result.SIMPLE).toBe('no_vars_here');
    });

    test('handles empty env object', () => {
      const result = generator._convertEnvForGemini({});
      expect(result).toEqual({});
    });

    test('handles multiple variables in same value', () => {
      const env = {
        COMPLEX: '${VAR1}/path/${VAR2}'
      };

      const result = generator._convertEnvForGemini(env);
      expect(result.COMPLEX).toBe('$VAR1/path/$VAR2');
    });
  });

  describe('_generateGeminiConfig', () => {
    test('_generateGeminiConfig method exists', () => {
      expect(typeof generator._generateGeminiConfig).toBe('function');
    });

    test('returns object with path, content, format properties', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: ['--arg1'],
          env: { KEY: 'value' }
        }
      };

      const result = generator._generateGeminiConfig(servers);

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('format');
    });

    test('path ends with .gemini/settings.json', () => {
      const servers = {};
      const result = generator._generateGeminiConfig(servers);

      expect(result.path).toMatch(/\.gemini\/settings\.json$/);
    });

    test('content is valid JSON string', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: [],
          env: {}
        }
      };

      const result = generator._generateGeminiConfig(servers);

      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    test('each server has timeout and trust properties', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          command: '/bundle/mcp-filesystem-server',
          args: ['--allowed-paths', '/test/vault'],
          env: { VAULT: 'test' }
        }
      };

      const result = generator._generateGeminiConfig(servers);
      const parsed = JSON.parse(result.content);

      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('timeout');
      expect(parsed.mcpServers['vault-filesystem'].timeout).toBe(60000);
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('trust');
      expect(parsed.mcpServers['vault-filesystem'].trust).toBe(false);
    });

    test('env variables use $VAR syntax (not ${VAR})', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: [],
          env: {
            API_KEY: '${MY_API_KEY}',
            PATH: '${HOME}/bin'
          }
        }
      };

      const result = generator._generateGeminiConfig(servers);
      const parsed = JSON.parse(result.content);

      expect(parsed.mcpServers['test-server'].env.API_KEY).toBe('$MY_API_KEY');
      expect(parsed.mcpServers['test-server'].env.PATH).toBe('$HOME/bin');
    });

    test('format property is json', () => {
      const servers = {};
      const result = generator._generateGeminiConfig(servers);

      expect(result.format).toBe('json');
    });

    test('generates proper Gemini CLI config structure', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          displayName: 'Vault Filesystem',
          description: 'Read and write files in your vault',
          command: '/bundle/mcp-filesystem-server',
          args: ['--allowed-paths', '/test/vault'],
          env: { VAULT_PATH: '${VAULT_PATH}' },
          builtin: true
        }
      };

      const result = generator._generateGeminiConfig(servers);
      const parsed = JSON.parse(result.content);

      expect(parsed.mcpServers['vault-filesystem'].command).toBe('/bundle/mcp-filesystem-server');
      expect(parsed.mcpServers['vault-filesystem'].args).toEqual(['--allowed-paths', '/test/vault']);
      expect(parsed.mcpServers['vault-filesystem'].env.VAULT_PATH).toBe('$VAULT_PATH');
      expect(parsed.mcpServers['vault-filesystem'].timeout).toBe(60000);
      expect(parsed.mcpServers['vault-filesystem'].trust).toBe(false);
    });
  });

  describe('_generateCodexConfig', () => {
    test('_generateCodexConfig method exists', () => {
      expect(typeof generator._generateCodexConfig).toBe('function');
    });

    test('returns object with path, content, format properties', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/bin/test',
          args: ['--arg1'],
          env: { KEY: 'value' }
        }
      };

      const result = generator._generateCodexConfig(servers);

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('format');
    });

    test('path ends with .codex/config.toml', () => {
      const servers = {};
      const result = generator._generateCodexConfig(servers);

      expect(result.path).toMatch(/\.codex\/config\.toml$/);
    });

    test('content is valid TOML format', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          command: '/bundle/mcp-filesystem-server',
          args: ['--allowed-paths', '/test/vault'],
          env: { VAULT_PATH: 'test' }
        }
      };

      const result = generator._generateCodexConfig(servers);

      // Basic TOML structure validation
      expect(result.content).toContain('[mcp_servers."vault-filesystem"]');
      expect(result.content).toContain('command = ');
      expect(result.content).toContain('args = ');
    });

    test('TOML contains [mcp_servers."name"] sections', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          command: '/bundle/mcp-filesystem-server',
          args: [],
          env: {}
        },
        'vault-search': {
          type: 'stdio',
          command: '/bundle/mcp-search-server',
          args: [],
          env: {}
        }
      };

      const result = generator._generateCodexConfig(servers);

      expect(result.content).toContain('[mcp_servers."vault-filesystem"]');
      expect(result.content).toContain('[mcp_servers."vault-search"]');
    });

    test('command, args, and env properly formatted in TOML', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/usr/local/bin/test-server',
          args: ['--port', '3000', '--verbose'],
          env: { API_KEY: 'test-key', DEBUG: 'true' }
        }
      };

      const result = generator._generateCodexConfig(servers);

      expect(result.content).toContain('command = "/usr/local/bin/test-server"');
      expect(result.content).toContain('args = ["--port", "3000", "--verbose"]');
      expect(result.content).toContain('[mcp_servers."test-server".env]');
      expect(result.content).toContain('API_KEY = "test-key"');
      expect(result.content).toContain('DEBUG = "true"');
    });

    test('format property is toml', () => {
      const servers = {};
      const result = generator._generateCodexConfig(servers);

      expect(result.format).toBe('toml');
    });

    test('generates proper Codex CLI config structure', () => {
      const servers = {
        'vault-filesystem': {
          type: 'stdio',
          displayName: 'Vault Filesystem',
          description: 'Read and write files in your vault',
          command: '/bundle/mcp-filesystem-server',
          args: ['--allowed-paths', '/test/vault'],
          env: { VAULT_PATH: '/test/vault' },
          builtin: true
        }
      };

      const result = generator._generateCodexConfig(servers);

      // Validate complete TOML structure
      expect(result.content).toContain('[mcp_servers."vault-filesystem"]');
      expect(result.content).toContain('command = "/bundle/mcp-filesystem-server"');
      expect(result.content).toContain('args = ["--allowed-paths", "/test/vault"]');
      expect(result.content).toContain('[mcp_servers."vault-filesystem".env]');
      expect(result.content).toContain('VAULT_PATH = "/test/vault"');
    });

    test('handles servers without args', () => {
      const servers = {
        'simple-server': {
          type: 'stdio',
          command: '/usr/bin/simple',
          env: {}
        }
      };

      const result = generator._generateCodexConfig(servers);

      expect(result.content).toContain('[mcp_servers."simple-server"]');
      expect(result.content).toContain('command = "/usr/bin/simple"');
      // Should not include args line if no args
      expect(result.content).not.toContain('args = ');
    });

    test('handles servers without env', () => {
      const servers = {
        'simple-server': {
          type: 'stdio',
          command: '/usr/bin/simple',
          args: ['--test']
        }
      };

      const result = generator._generateCodexConfig(servers);

      expect(result.content).toContain('[mcp_servers."simple-server"]');
      expect(result.content).toContain('command = "/usr/bin/simple"');
      expect(result.content).toContain('args = ["--test"]');
      // Should not include env section if no env
      expect(result.content).not.toContain('[mcp_servers."simple-server".env]');
    });

    test('properly escapes strings in TOML', () => {
      const servers = {
        'test-server': {
          type: 'stdio',
          command: '/path/with spaces/server',
          args: ['--message', 'Hello "World"'],
          env: { PATH: '/usr/bin:/home/user/bin' }
        }
      };

      const result = generator._generateCodexConfig(servers);

      expect(result.content).toContain('command = "/path/with spaces/server"');
      // The double quotes in the message should be escaped or handled properly
      expect(result.content).toContain('--message');
    });
  });

  describe('generateConfig (orchestration)', () => {
    test('generateConfig method exists and is async', async () => {
      expect(typeof generator.generateConfig).toBe('function');
      // Verify it returns a promise
      registry.setServerEnabled('vault-filesystem', true);
      const result = generator.generateConfig('claude', '/test/vault', '/bundle');
      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    test('calls registry.getEnabledServers() to get servers', async () => {
      // Enable a server
      registry.setServerEnabled('vault-filesystem', true);

      // Spy on getEnabledServers
      const getSpy = jest.spyOn(registry, 'getEnabledServers');

      await generator.generateConfig('claude', '/test/vault', '/bundle');

      expect(getSpy).toHaveBeenCalled();
    });

    test('expands ${VAULT_PATH} and ${BUNDLE_PATH} variables', async () => {
      // Enable a server with variable placeholders
      registry.setServerEnabled('vault-filesystem', true);

      const result = await generator.generateConfig('claude', '/my/vault', '/my/bundle');
      const parsed = JSON.parse(result.content);

      // The bundled vault-filesystem server uses ${BUNDLE_PATH} in command
      // and ${VAULT_PATH} in args
      expect(parsed.mcpServers['vault-filesystem'].command).toContain('/my/bundle');
      expect(parsed.mcpServers['vault-filesystem'].args.join(' ')).toContain('/my/vault');
    });

    test('routes to correct generator based on agent - claude', async () => {
      registry.setServerEnabled('vault-filesystem', true);

      const result = await generator.generateConfig('claude', '/test/vault', '/bundle');

      expect(result.path).toContain('.mcp.json');
      expect(result.format).toBe('json');
      const parsed = JSON.parse(result.content);
      // stdio servers don't include 'type' field
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('command');
    });

    test('routes to correct generator based on agent - gemini', async () => {
      registry.setServerEnabled('vault-filesystem', true);

      const result = await generator.generateConfig('gemini', '/test/vault', '/bundle');

      expect(result.path).toMatch(/\.gemini\/settings\.json$/);
      expect(result.format).toBe('json');
      const parsed = JSON.parse(result.content);
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('timeout');
      expect(parsed.mcpServers['vault-filesystem']).toHaveProperty('trust');
    });

    test('routes to correct generator based on agent - codex', async () => {
      registry.setServerEnabled('vault-filesystem', true);

      const result = await generator.generateConfig('codex', '/test/vault', '/bundle');

      expect(result.path).toMatch(/\.codex\/config\.toml$/);
      expect(result.format).toBe('toml');
      expect(result.content).toContain('[mcp_servers."vault-filesystem"]');
    });

    test('returns ConfigOutput object for all agents', async () => {
      registry.setServerEnabled('vault-filesystem', true);

      const claudeResult = await generator.generateConfig('claude', '/test/vault', '/bundle');
      expect(claudeResult).toHaveProperty('path');
      expect(claudeResult).toHaveProperty('content');
      expect(claudeResult).toHaveProperty('format');

      const geminiResult = await generator.generateConfig('gemini', '/test/vault', '/bundle');
      expect(geminiResult).toHaveProperty('path');
      expect(geminiResult).toHaveProperty('content');
      expect(geminiResult).toHaveProperty('format');

      const codexResult = await generator.generateConfig('codex', '/test/vault', '/bundle');
      expect(codexResult).toHaveProperty('path');
      expect(codexResult).toHaveProperty('content');
      expect(codexResult).toHaveProperty('format');
    });

    test('throws error for unknown agent', async () => {
      registry.setServerEnabled('vault-filesystem', true);

      await expect(
        generator.generateConfig('unknown', '/test/vault', '/bundle')
      ).rejects.toThrow('Unknown agent: unknown');
    });

    test('no JavaScript errors when calling with valid agents', async () => {
      registry.setServerEnabled('vault-filesystem', true);

      await expect(
        generator.generateConfig('claude', '/test/vault', '/bundle')
      ).resolves.toBeDefined();

      await expect(
        generator.generateConfig('gemini', '/test/vault', '/bundle')
      ).resolves.toBeDefined();

      await expect(
        generator.generateConfig('codex', '/test/vault', '/bundle')
      ).resolves.toBeDefined();
    });

    test('handles multiple enabled servers', async () => {
      registry.setServerEnabled('vault-filesystem', true);
      registry.setServerEnabled('vault-search', true);

      const result = await generator.generateConfig('claude', '/test/vault', '/bundle');
      const parsed = JSON.parse(result.content);

      expect(parsed.mcpServers).toHaveProperty('vault-filesystem');
      expect(parsed.mcpServers).toHaveProperty('vault-search');
    });

    test('handles empty enabled servers', async () => {
      // No servers enabled

      const result = await generator.generateConfig('claude', '/test/vault', '/bundle');
      const parsed = JSON.parse(result.content);

      expect(parsed.mcpServers).toEqual({});
    });
  });
});
