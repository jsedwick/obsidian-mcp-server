/**
 * EmbeddingCache unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EmbeddingCache } from '../../../../src/services/embeddings/EmbeddingCache.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('EmbeddingCache', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('embedding-cache');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('cache hit', () => {
    it('should return cached embedding when file has not changed', () => {
      const cache = new EmbeddingCache(true);
      const filePath = '/vault/topics/test.md';
      const embedding = [0.1, 0.2, 0.3];
      const mtime = new Date('2025-01-01T00:00:00Z');
      const fileStats = { mtime };

      cache.set(filePath, embedding, fileStats);

      // Same mtime => cache hit
      const result = cache.get(filePath, fileStats);
      expect(result).toEqual(embedding);
    });
  });

  describe('cache miss', () => {
    it('should return null for uncached file', () => {
      const cache = new EmbeddingCache(true);
      const result = cache.get('/vault/topics/unknown.md', { mtime: new Date() });
      expect(result).toBeNull();
    });
  });

  describe('mtime invalidation', () => {
    it('should return null when file has been modified after caching', () => {
      const cache = new EmbeddingCache(true);
      const filePath = '/vault/topics/test.md';
      const embedding = [0.1, 0.2, 0.3];
      const oldMtime = new Date('2025-01-01T00:00:00Z');
      const newMtime = new Date('2025-06-01T00:00:00Z');

      cache.set(filePath, embedding, { mtime: oldMtime });

      // Newer mtime => stale
      const result = cache.get(filePath, { mtime: newMtime });
      expect(result).toBeNull();
    });
  });

  describe('save/load round-trip', () => {
    it('should persist to disk and reload correctly', async () => {
      const cacheDir = path.join(vaultPath, '.embedding-cache');
      const cacheDirs = new Map([[vaultPath, cacheDir]]);

      const cache = new EmbeddingCache(true, cacheDirs);
      const filePath = path.join(vaultPath, 'topics', 'test.md');
      const embedding = [0.5, 0.6, 0.7];
      const mtime = new Date('2025-01-15T00:00:00Z');

      cache.set(filePath, embedding, { mtime }, vaultPath);

      // Save
      await cache.save(fp => {
        if (fp.startsWith(vaultPath)) return { path: vaultPath, name: 'test' };
        return null;
      });

      // Create a new cache and load
      const cache2 = new EmbeddingCache(true, cacheDirs);
      await cache2.load();

      const result = cache2.get(filePath, { mtime });
      expect(result).toEqual(embedding);
    });
  });

  describe('per-vault isolation', () => {
    it('should maintain separate caches for different vaults', async () => {
      const vault2Path = await createTestVault('embedding-cache-2');
      try {
        const cacheDir1 = path.join(vaultPath, '.embedding-cache');
        const cacheDir2 = path.join(vault2Path, '.embedding-cache');
        const cacheDirs = new Map([
          [vaultPath, cacheDir1],
          [vault2Path, cacheDir2],
        ]);

        const cache = new EmbeddingCache(true, cacheDirs);
        const mtime = new Date('2025-01-15T00:00:00Z');

        const file1 = path.join(vaultPath, 'topics', 'a.md');
        const file2 = path.join(vault2Path, 'topics', 'b.md');

        cache.set(file1, [1, 2, 3], { mtime }, vaultPath);
        cache.set(file2, [4, 5, 6], { mtime }, vault2Path);

        // Save
        await cache.save(fp => {
          if (fp.startsWith(vaultPath)) return { path: vaultPath, name: 'vault1' };
          if (fp.startsWith(vault2Path)) return { path: vault2Path, name: 'vault2' };
          return null;
        });

        // Verify each vault's cache file has only its own entries
        const cache1Data = JSON.parse(
          await fs.readFile(path.join(cacheDir1, 'embeddings.json'), 'utf-8')
        );
        const cache2Data = JSON.parse(
          await fs.readFile(path.join(cacheDir2, 'embeddings.json'), 'utf-8')
        );

        expect(cache1Data).toHaveLength(1);
        expect(cache2Data).toHaveLength(1);
        expect(cache1Data[0].embedding).toEqual([1, 2, 3]);
        expect(cache2Data[0].embedding).toEqual([4, 5, 6]);
      } finally {
        await cleanupTestVault(vault2Path);
      }
    });
  });

  describe('disabled cache', () => {
    it('should return null for all operations when disabled', () => {
      const cache = new EmbeddingCache(false);
      const mtime = new Date();

      cache.set('/vault/test.md', [1, 2, 3], { mtime });
      const result = cache.get('/vault/test.md', { mtime });

      expect(result).toBeNull();
      expect(cache.getStats().size).toBe(0);
    });
  });
});
