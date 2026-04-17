import { describe, test, expect } from '@jest/globals';
import { bundledServers, getBundledServers, getBundledServerIds } from './bundledServers.js';

describe('bundledServers', () => {
  describe('bundledServers array', () => {
    test('contains all expected servers', () => {
      expect(bundledServers).toHaveLength(2);

      const serverIds = bundledServers.map(s => s.id);
      expect(serverIds).toContain('vault-filesystem');
      expect(serverIds).toContain('vault-search');
    });

    test('vault-filesystem has correct configuration', () => {
      const filesystem = bundledServers.find(s => s.id === 'vault-filesystem');

      expect(filesystem).toBeDefined();
      expect(filesystem.name).toBe('Filesystem Tools');
      expect(filesystem.enabled).toBe(false);
      expect(filesystem.transport.type).toBe('stdio');
      expect(filesystem.transport.command).toBe('${BUNDLE_PATH}/mcp-filesystem-server');
    });

    test('vault-search has correct configuration', () => {
      const search = bundledServers.find(s => s.id === 'vault-search');

      expect(search).toBeDefined();
      expect(search.name).toBe('Vault Search');
      expect(search.enabled).toBe(false);
      expect(search.transport.type).toBe('stdio');
      expect(search.transport.command).toBe('${BUNDLE_PATH}/mcp-search-server');
    });
  });

  describe('getBundledServerIds', () => {
    test('returns all server IDs', () => {
      const ids = getBundledServerIds();
      expect(ids).toEqual(['vault-filesystem', 'vault-search']);
    });
  });

  describe('getBundledServers', () => {
    const mockVaultPath = '/Users/test/vault';
    const mockBundlePath = '/Applications/Vault.app/Contents/MacOS';
    const mockResourcePath = '/Applications/Vault.app/Contents/Resources';

    test('substitutes VAULT_PATH variable', async () => {
      const servers = await getBundledServers(mockVaultPath, mockBundlePath);

      const filesystem = servers.find(s => s.id === 'vault-filesystem');
      expect(filesystem.transport.args).toContain(mockVaultPath);
    });

    test('substitutes BUNDLE_PATH variable', async () => {
      const servers = await getBundledServers(mockVaultPath, mockBundlePath);

      const filesystem = servers.find(s => s.id === 'vault-filesystem');
      expect(filesystem.transport.command).toBe(`${mockBundlePath}/mcp-filesystem-server`);
    });

    test('normalizes macOS Contents/Resources path to Contents/MacOS', async () => {
      const servers = await getBundledServers(mockVaultPath, mockResourcePath);

      const filesystem = servers.find(s => s.id === 'vault-filesystem');
      expect(filesystem.transport.command).toBe(`${mockBundlePath}/mcp-filesystem-server`);
    });

    test('sets working_dir to vault path for all servers', async () => {
      const servers = await getBundledServers(mockVaultPath, mockBundlePath);

      const filesystem = servers.find(s => s.id === 'vault-filesystem');
      expect(filesystem.transport.working_dir).toBe(mockVaultPath);

      const search = servers.find(s => s.id === 'vault-search');
      expect(search.transport.working_dir).toBe(mockVaultPath);
    });

    test('does not mutate original bundledServers array', async () => {
      const originalFilesystem = bundledServers.find(s => s.id === 'vault-filesystem');
      const originalCommand = originalFilesystem.transport.command;

      await getBundledServers(mockVaultPath, mockBundlePath);

      expect(originalFilesystem.transport.command).toBe(originalCommand);
    });
  });
});
