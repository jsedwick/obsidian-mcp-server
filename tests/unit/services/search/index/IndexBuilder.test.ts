/**
 * Unit tests for IndexBuilder
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IndexBuilder,
  BuildMode,
} from '../../../../../src/services/search/index/IndexBuilder.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('IndexBuilder', () => {
  let builder: IndexBuilder;
  let tempDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    // Create temporary directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'index-builder-test-'));
    cacheDir = path.join(tempDir, 'cache');
    await fs.mkdir(cacheDir);

    builder = new IndexBuilder(cacheDir);
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const createTestVault = async (vaultPath: string, files: Record<string, string>) => {
    await fs.mkdir(vaultPath, { recursive: true });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(vaultPath, filePath);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content);
    }
  };

  describe('constructor', () => {
    it('should create builder with cache directory', () => {
      expect(builder).toBeDefined();
    });
  });

  describe('build - full mode', () => {
    it('should build index from scratch', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'First document content',
        'file2.md': 'Second document content',
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe(BuildMode.FULL);
      expect(result.filesProcessed).toBe(2);
      expect(result.filesAdded).toBe(2);
      expect(result.totalDocuments).toBe(2);
    });

    it('should index files in subdirectories', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'root.md': 'Root file',
        'subdir/nested.md': 'Nested file',
        'subdir/deep/deeper.md': 'Deep file',
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(3);
    });

    it('should handle empty vault', async () => {
      const vaultPath = path.join(tempDir, 'empty-vault');
      await fs.mkdir(vaultPath);

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'empty-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(0);
      expect(result.totalDocuments).toBe(0);
    });

    it('should build index for multiple vaults', async () => {
      const vault1 = path.join(tempDir, 'vault1');
      const vault2 = path.join(tempDir, 'vault2');

      await createTestVault(vault1, {
        'file1.md': 'Vault 1 content',
      });

      await createTestVault(vault2, {
        'file2.md': 'Vault 2 content',
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [
          { path: vault1, name: 'vault-1' },
          { path: vault2, name: 'vault-2' },
        ],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(2);
    });

    it('should persist index to disk', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Test content',
      });

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      // Check that cache files exist
      const indexFile = path.join(cacheDir, 'inverted-index.jsonl');
      const storeFile = path.join(cacheDir, 'document-store.jsonl');
      const metadataFile = path.join(cacheDir, 'index-metadata.json');

      const [indexExists, storeExists, metaExists] = await Promise.all([
        fs.access(indexFile).then(() => true).catch(() => false),
        fs.access(storeFile).then(() => true).catch(() => false),
        fs.access(metadataFile).then(() => true).catch(() => false),
      ]);

      expect(indexExists).toBe(true);
      expect(storeExists).toBe(true);
      expect(metaExists).toBe(true);
    });

    it('should track build duration', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Content',
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.duration).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThan(result.startTime);
    });

    it('should call progress callback', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      const files: Record<string, string> = {};

      // Create 150 files to trigger progress callback
      for (let i = 0; i < 150; i++) {
        files[`file${i}.md`] = `Content ${i}`;
      }

      await createTestVault(vaultPath, files);

      const progressCalls: Array<{ current: number; total: number; status: string }> = [];
      const onProgress = (current: number, total: number, status: string) => {
        progressCalls.push({ current, total, status });
      };

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
        onProgress,
      });

      // Should have progress callbacks at 100-file intervals
      expect(progressCalls.length).toBeGreaterThan(0);
    });
  });

  describe('build - incremental mode', () => {
    it('should update only changed files', async () => {
      const vaultPath = path.join(tempDir, 'vault1');

      // Initial build
      await createTestVault(vaultPath, {
        'file1.md': 'Original content',
        'file2.md': 'Unchanged content',
      });

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      // Wait a bit to ensure mtime changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Modify one file and add a new one
      await fs.writeFile(path.join(vaultPath, 'file1.md'), 'Modified content');
      await fs.writeFile(path.join(vaultPath, 'file3.md'), 'New content');

      // Incremental build
      const result = await builder.build({
        mode: BuildMode.INCREMENTAL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe(BuildMode.INCREMENTAL);
      expect(result.filesModified).toBeGreaterThan(0);
      expect(result.filesAdded).toBeGreaterThan(0);
      expect(result.totalDocuments).toBe(3);
    });

    it('should remove deleted files from index', async () => {
      const vaultPath = path.join(tempDir, 'vault1');

      // Initial build with 3 files
      await createTestVault(vaultPath, {
        'file1.md': 'Content 1',
        'file2.md': 'Content 2',
        'file3.md': 'Content 3',
      });

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      // Delete one file
      await fs.unlink(path.join(vaultPath, 'file2.md'));

      // Incremental build
      const result = await builder.build({
        mode: BuildMode.INCREMENTAL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesDeleted).toBe(1);
      expect(result.totalDocuments).toBe(2);
    });

    it('should handle no changes', async () => {
      const vaultPath = path.join(tempDir, 'vault1');

      await createTestVault(vaultPath, {
        'file1.md': 'Content',
      });

      // Initial build
      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      // Incremental build with no changes
      const result = await builder.build({
        mode: BuildMode.INCREMENTAL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(result.filesDeleted).toBe(0);
    });
  });

  describe('build - auto mode', () => {
    it('should choose FULL mode for first build', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Content',
      });

      const result = await builder.build({
        mode: BuildMode.AUTO,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe(BuildMode.FULL);
    });

    it('should choose INCREMENTAL mode for small changes', async () => {
      const vaultPath = path.join(tempDir, 'vault1');

      // Create many files
      const files: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        files[`file${i}.md`] = `Content ${i}`;
      }

      await createTestVault(vaultPath, files);

      // Initial build
      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      // Wait for mtime changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Change only 5% of files
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(vaultPath, `file${i}.md`), `Modified ${i}`);
      }

      // Auto build should choose incremental
      const result = await builder.build({
        mode: BuildMode.AUTO,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe(BuildMode.INCREMENTAL);
    });

    it('should choose FULL mode for large changes', async () => {
      const vaultPath = path.join(tempDir, 'vault1');

      // Create files
      const files: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        files[`file${i}.md`] = `Content ${i}`;
      }

      await createTestVault(vaultPath, files);

      // Initial build
      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      // Wait for mtime changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Change 50% of files (above 30% threshold)
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(vaultPath, `file${i}.md`), `Modified ${i}`);
      }

      // Auto build should choose full
      const result = await builder.build({
        mode: BuildMode.AUTO,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
        incrementalThreshold: 0.3,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe(BuildMode.FULL);
    });
  });

  describe('validateIndex', () => {
    it('should validate existing index', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Content',
      });

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      const issues = await builder.validateIndex();

      expect(issues).toEqual([]);
    });

    it('should return error for missing index', async () => {
      const emptyBuilder = new IndexBuilder(path.join(tempDir, 'nonexistent'));
      const issues = await emptyBuilder.validateIndex();

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain('Failed to load');
    });
  });

  describe('deleteIndex', () => {
    it('should delete existing index', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Content',
      });

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      await builder.deleteIndex();

      const indexFile = path.join(cacheDir, 'inverted-index.jsonl');
      const exists = await fs.access(indexFile).then(() => true).catch(() => false);

      expect(exists).toBe(false);
    });

    it('should handle deleting non-existent index', async () => {
      const emptyBuilder = new IndexBuilder(path.join(tempDir, 'nonexistent'));

      // Should not throw
      await expect(emptyBuilder.deleteIndex()).resolves.not.toThrow();
    });
  });

  describe('getIndexStats', () => {
    it('should return stats for existing index', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Test content with multiple words',
        'file2.md': 'Another document',
      });

      await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      const stats = await builder.getIndexStats();

      expect(stats).not.toBeNull();
      expect(stats?.documents).toBe(2);
      expect(stats?.terms).toBeGreaterThan(0);
      expect(stats?.fileSizes.invertedIndex).toBeGreaterThan(0);
      expect(stats?.fileSizes.documentStore).toBeGreaterThan(0);
      expect(stats?.fileSizes.metadata).toBeGreaterThan(0);
    });

    it('should return null for non-existent index', async () => {
      const emptyBuilder = new IndexBuilder(path.join(tempDir, 'nonexistent'));
      const stats = await emptyBuilder.getIndexStats();

      expect(stats).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle file read errors gracefully', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': 'Good content',
        'file2.md': 'More good content',
      });

      // Simulate permission error by removing read permission
      const file2Path = path.join(vaultPath, 'file2.md');

      try {
        await fs.chmod(file2Path, 0o000);

        const result = await builder.build({
          mode: BuildMode.FULL,
          vaults: [{ path: vaultPath, name: 'test-vault' }],
          config: { cacheDir },
        });

        // Should still succeed for readable files
        expect(result.success).toBe(true);
      } finally {
        // Restore permissions for cleanup
        try {
          await fs.chmod(file2Path, 0o644);
        } catch {
          // Ignore
        }
      }
    });

    it('should handle non-existent vault', async () => {
      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: '/nonexistent/vault', name: 'fake-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(0);
    });

    it('should return error result on build failure', async () => {
      // Force error by using invalid cache directory
      const badBuilder = new IndexBuilder('/invalid/permission/denied/cache');

      const result = await badBuilder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: tempDir, name: 'test-vault' }],
        config: { cacheDir: '/invalid/permission/denied/cache' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle files with frontmatter', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file1.md': `---
title: Test Document
tags: [test, example]
---

Content here`,
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.totalDocuments).toBe(1);
    });

    it('should handle empty files', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'empty.md': '',
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.totalDocuments).toBe(1);
    });

    it('should handle very long content', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      const longContent = 'word '.repeat(10000); // 10k words

      await createTestVault(vaultPath, {
        'long.md': longContent,
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.totalTerms).toBeGreaterThan(0);
    });

    it('should handle special characters in filenames', async () => {
      const vaultPath = path.join(tempDir, 'vault1');
      await createTestVault(vaultPath, {
        'file (with) [special] chars.md': 'Content',
      });

      const result = await builder.build({
        mode: BuildMode.FULL,
        vaults: [{ path: vaultPath, name: 'test-vault' }],
        config: { cacheDir },
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(1);
    });
  });
});
