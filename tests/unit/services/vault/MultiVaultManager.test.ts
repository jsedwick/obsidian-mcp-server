/**
 * MultiVaultManager unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MultiVaultManager } from '../../../../src/services/vault/MultiVaultManager.js';
import type { VaultConfig } from '../../../../src/models/Vault.js';
import * as fs from 'fs/promises';

// Mock fs module (same pattern as VaultManager.test.ts)
vi.mock('fs/promises');

describe('MultiVaultManager', () => {
  let primaryConfig: VaultConfig;
  let secondaryConfig: VaultConfig;
  let manager: MultiVaultManager;

  beforeEach(() => {
    primaryConfig = { path: '/primary/vault', name: 'Primary' };
    secondaryConfig = { path: '/secondary/vault', name: 'Secondary' };
    manager = new MultiVaultManager(primaryConfig, [secondaryConfig]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('primary and secondary accessible', () => {
    it('should expose both primary and secondary vaults', () => {
      expect(manager.getPrimaryVault().getName()).toBe('Primary');
      expect(manager.getSecondaryVaults()).toHaveLength(1);
      expect(manager.getSecondaryVaults()[0].getName()).toBe('Secondary');
      expect(manager.getAllVaults()).toHaveLength(2);
    });
  });

  describe('getVaultForFile', () => {
    it('should route file to the correct vault', () => {
      const vault = manager.getVaultForFile('/primary/vault/topics/test.md');
      expect(vault).not.toBeNull();
      expect(vault!.getName()).toBe('Primary');

      const vault2 = manager.getVaultForFile('/secondary/vault/topics/test.md');
      expect(vault2).not.toBeNull();
      expect(vault2!.getName()).toBe('Secondary');
    });

    it('should return null for unknown paths', () => {
      const vault = manager.getVaultForFile('/other/vault/test.md');
      expect(vault).toBeNull();
    });
  });

  describe('ensureAllStructures', () => {
    it('should call ensureStructure on all vaults', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      await manager.ensureAllStructures();

      // mkdir should have been called for both vaults' directories
      expect(fs.mkdir).toHaveBeenCalled();
    });
  });

  describe('getCacheDirectory', () => {
    it('should return .embedding-cache path for a vault', () => {
      const cacheDir = manager.getCacheDirectory('/some/vault');
      expect(cacheDir).toBe('/some/vault/.embedding-cache');
    });

    it('should accept a VaultManager instance', () => {
      const cacheDir = manager.getCacheDirectory(manager.getPrimaryVault());
      expect(cacheDir).toBe('/primary/vault/.embedding-cache');
    });
  });

  describe('listFilesAcrossVaults', () => {
    it('should return files grouped by vault name', async () => {
      const primaryEntries = [{ name: 'a.md', isDirectory: () => false, isFile: () => true }];
      const secondaryEntries = [{ name: 'b.md', isDirectory: () => false, isFile: () => true }];

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(primaryEntries as any)
        .mockResolvedValueOnce(secondaryEntries as any);

      const result = await manager.listFilesAcrossVaults('topics');

      expect(result.get('Primary')).toEqual(['/primary/vault/topics/a.md']);
      expect(result.get('Secondary')).toEqual(['/secondary/vault/topics/b.md']);
    });
  });
});
