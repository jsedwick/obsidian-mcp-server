/**
 * VaultManager unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VaultManager } from '../../../../src/services/vault/VaultManager.js';
import { VaultError } from '../../../../src/utils/errors.js';
import type { VaultConfig } from '../../../../src/models/Vault.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs module
vi.mock('fs/promises');

describe('VaultManager', () => {
  let vaultConfig: VaultConfig;
  let vaultManager: VaultManager;

  beforeEach(() => {
    vaultConfig = {
      path: '/test/vault',
      name: 'Test Vault',
    };
    vaultManager = new VaultManager(vaultConfig);

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPath', () => {
    it('should return vault path', () => {
      expect(vaultManager.getPath()).toBe('/test/vault');
    });
  });

  describe('getName', () => {
    it('should return vault name', () => {
      expect(vaultManager.getName()).toBe('Test Vault');
    });
  });

  describe('analyzeStructure', () => {
    it('should detect vault structure correctly', async () => {
      const mockEntries = [
        { name: 'sessions', isDirectory: () => true },
        { name: 'topics', isDirectory: () => true },
        { name: 'decisions', isDirectory: () => true },
        { name: 'projects', isDirectory: () => true },
        { name: 'index.md', isDirectory: () => false },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(mockEntries as any);

      const structure = await vaultManager.analyzeStructure();

      expect(structure).toEqual({
        hasSessionsDir: true,
        hasTopicsDir: true,
        hasDecisionsDir: true,
        hasProjectsDir: true,
        directories: ['sessions', 'topics', 'decisions', 'projects'],
      });
    });

    it('should handle missing directories', async () => {
      const mockEntries = [
        { name: 'topics', isDirectory: () => true },
        { name: 'index.md', isDirectory: () => false },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(mockEntries as any);

      const structure = await vaultManager.analyzeStructure();

      expect(structure).toEqual({
        hasSessionsDir: false,
        hasTopicsDir: true,
        hasDecisionsDir: false,
        hasProjectsDir: false,
        directories: ['topics'],
      });
    });

    it('should throw VaultError if readdir fails', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      await expect(vaultManager.analyzeStructure()).rejects.toThrow(VaultError);
      await expect(vaultManager.analyzeStructure()).rejects.toThrow(
        'Failed to analyze vault structure'
      );
    });
  });

  describe('ensureStructure', () => {
    it('should create missing directories', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await vaultManager.ensureStructure();

      expect(fs.mkdir).toHaveBeenCalledWith(path.join('/test/vault', 'sessions'), {
        recursive: true,
      });
      expect(fs.mkdir).toHaveBeenCalledWith(path.join('/test/vault', 'topics'), {
        recursive: true,
      });
      expect(fs.mkdir).toHaveBeenCalledWith(path.join('/test/vault', 'decisions'), {
        recursive: true,
      });
      expect(fs.mkdir).toHaveBeenCalledWith(path.join('/test/vault', 'projects'), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should not create index if it exists', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await vaultManager.ensureStructure();

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should throw VaultError if mkdir fails', async () => {
      vi.mocked(fs.mkdir).mockRejectedValue(new Error('Permission denied'));

      await expect(vaultManager.ensureStructure()).rejects.toThrow(VaultError);
    });
  });

  describe('getDirectoryPath', () => {
    it('should return correct directory path', () => {
      expect(vaultManager.getDirectoryPath('topics')).toBe('/test/vault/topics');
      expect(vaultManager.getDirectoryPath('sessions')).toBe('/test/vault/sessions');
    });
  });

  describe('containsFile', () => {
    it('should return true for files in vault', () => {
      expect(vaultManager.containsFile('/test/vault/topics/test.md')).toBe(true);
      expect(vaultManager.containsFile('/test/vault/sessions/2024-01/session.md')).toBe(true);
    });

    it('should return false for files outside vault', () => {
      expect(vaultManager.containsFile('/other/vault/test.md')).toBe(false);
      expect(vaultManager.containsFile('/test/vault2/test.md')).toBe(false);
    });
  });

  describe('getRelativePath', () => {
    it('should return relative path from vault root', () => {
      expect(vaultManager.getRelativePath('/test/vault/topics/test.md')).toBe('topics/test.md');
      expect(vaultManager.getRelativePath('/test/vault/sessions/2024-01/session.md')).toBe(
        'sessions/2024-01/session.md'
      );
    });

    it('should throw VaultError for files outside vault', () => {
      expect(() => vaultManager.getRelativePath('/other/vault/test.md')).toThrow(VaultError);
      expect(() => vaultManager.getRelativePath('/other/vault/test.md')).toThrow(
        'File is not in this vault'
      );
    });
  });

  describe('getAbsolutePath', () => {
    it('should return absolute path from relative path', () => {
      expect(vaultManager.getAbsolutePath('topics/test.md')).toBe('/test/vault/topics/test.md');
      expect(vaultManager.getAbsolutePath('sessions/2024-01/session.md')).toBe(
        '/test/vault/sessions/2024-01/session.md'
      );
    });
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      const mockEntries = [
        { name: 'file1.md', isDirectory: () => false, isFile: () => true },
        { name: 'file2.md', isDirectory: () => false, isFile: () => true },
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(mockEntries as any);

      const files = await vaultManager.listFiles('topics');

      expect(files).toEqual(['/test/vault/topics/file1.md', '/test/vault/topics/file2.md']);
    });

    it('should list files recursively', async () => {
      const mockTopEntries = [
        { name: 'file1.md', isDirectory: () => false, isFile: () => true },
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
      ];
      const mockSubEntries = [{ name: 'file2.md', isDirectory: () => false, isFile: () => true }];

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(mockTopEntries as any)
        .mockResolvedValueOnce(mockSubEntries as any);

      const files = await vaultManager.listFiles('topics', { recursive: true });

      expect(files).toEqual(['/test/vault/topics/file1.md', '/test/vault/topics/subdir/file2.md']);
    });

    it('should filter files by pattern', async () => {
      const mockEntries = [
        { name: 'file1.md', isDirectory: () => false, isFile: () => true },
        { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
        { name: 'file3.md', isDirectory: () => false, isFile: () => true },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(mockEntries as any);

      const files = await vaultManager.listFiles('topics', { pattern: /\.md$/ });

      expect(files).toEqual(['/test/vault/topics/file1.md', '/test/vault/topics/file3.md']);
    });

    it('should throw VaultError if readdir fails', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Not found'));

      await expect(vaultManager.listFiles('topics')).rejects.toThrow(VaultError);
    });
  });

  describe('exists', () => {
    it('should return true if vault exists', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);

      expect(await vaultManager.exists()).toBe(true);
    });

    it('should return false if vault does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      expect(await vaultManager.exists()).toBe(false);
    });
  });

  describe('validate', () => {
    it('should validate vault successfully', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as any);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      await expect(vaultManager.validate()).resolves.not.toThrow();
    });

    it('should throw VaultError if path is not a directory', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => false,
      } as any);

      await expect(vaultManager.validate()).rejects.toThrow(VaultError);
      await expect(vaultManager.validate()).rejects.toThrow('not a directory');
    });

    it('should throw VaultError if vault is not accessible', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as any);
      vi.mocked(fs.access).mockRejectedValue(new Error('Permission denied'));

      await expect(vaultManager.validate()).rejects.toThrow(VaultError);
    });
  });
});
