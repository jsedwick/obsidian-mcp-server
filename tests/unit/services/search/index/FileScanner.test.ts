/**
 * Unit tests for FileScanner
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileScanner } from '../../../../../src/services/search/index/FileScanner.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FileScanner', () => {
  let scanner: FileScanner;
  let tempDir: string;

  beforeEach(async () => {
    scanner = new FileScanner();
    // Create temporary test directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-scanner-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create scanner with default options', () => {
      expect(scanner).toBeDefined();
    });

    it('should create scanner with custom options', () => {
      const customScanner = new FileScanner({
        extensions: ['.txt', '.md'],
        maxDepth: 3,
      });
      expect(customScanner).toBeDefined();
    });

    it('should accept custom ignored directories', () => {
      const customScanner = new FileScanner({
        ignoredDirs: new Set(['.git', 'custom-ignore']),
      });
      expect(customScanner).toBeDefined();
    });
  });

  describe('scanVault', () => {
    it('should find markdown files', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'test1.md'), 'Content 1');
      await fs.writeFile(path.join(tempDir, 'test2.md'), 'Content 2');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(2);
      expect(files.every(f => f.vault === 'test-vault')).toBe(true);
    });

    it('should ignore non-markdown files', async () => {
      await fs.writeFile(path.join(tempDir, 'test.md'), 'Markdown');
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'Text');
      await fs.writeFile(path.join(tempDir, 'test.js'), 'JavaScript');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('test.md');
    });

    it('should scan subdirectories recursively', async () => {
      const subdir = path.join(tempDir, 'subdir');
      await fs.mkdir(subdir);
      await fs.writeFile(path.join(tempDir, 'root.md'), 'Root');
      await fs.writeFile(path.join(subdir, 'nested.md'), 'Nested');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(2);
      expect(files.some(f => f.relativePath === 'root.md')).toBe(true);
      expect(files.some(f => f.relativePath === 'subdir/nested.md')).toBe(true);
    });

    it('should ignore .git directory', async () => {
      const gitDir = path.join(tempDir, '.git');
      await fs.mkdir(gitDir);
      await fs.writeFile(path.join(tempDir, 'visible.md'), 'Visible');
      await fs.writeFile(path.join(gitDir, 'hidden.md'), 'Hidden');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('visible.md');
    });

    it('should ignore node_modules directory', async () => {
      const nodeModules = path.join(tempDir, 'node_modules');
      await fs.mkdir(nodeModules);
      await fs.writeFile(path.join(tempDir, 'app.md'), 'App');
      await fs.writeFile(path.join(nodeModules, 'module.md'), 'Module');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('app.md');
    });

    it('should ignore .obsidian directory', async () => {
      const obsidianDir = path.join(tempDir, '.obsidian');
      await fs.mkdir(obsidianDir);
      await fs.writeFile(path.join(tempDir, 'note.md'), 'Note');
      await fs.writeFile(path.join(obsidianDir, 'config.md'), 'Config');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('note.md');
    });

    it('should compute file hashes', async () => {
      await fs.writeFile(path.join(tempDir, 'test.md'), 'Test content');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].hash).toBeDefined();
      expect(files[0].hash.length).toBe(64); // SHA-256 hex length
    });

    it('should detect different content with different hashes', async () => {
      await fs.writeFile(path.join(tempDir, 'file1.md'), 'Content A');
      await fs.writeFile(path.join(tempDir, 'file2.md'), 'Content B');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].hash).not.toBe(files[1].hash);
    });

    it('should include file metadata', async () => {
      const content = 'Test content';
      const filePath = path.join(tempDir, 'test.md');
      await fs.writeFile(filePath, content);

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].absolutePath).toBe(filePath);
      expect(files[0].relativePath).toBe('test.md');
      expect(files[0].size).toBe(content.length);
      expect(files[0].lastModified).toBeGreaterThan(0);
      expect(files[0].vault).toBe('test-vault');
    });

    it('should handle empty vault', async () => {
      const files = await scanner.scanVault(tempDir, 'empty-vault');
      expect(files).toEqual([]);
    });

    it('should handle non-existent vault gracefully', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      const files = await scanner.scanVault(nonExistent, 'test-vault');
      expect(files).toEqual([]);
    });
  });

  describe('scanVaults', () => {
    it('should scan multiple vaults', async () => {
      const vault1 = path.join(tempDir, 'vault1');
      const vault2 = path.join(tempDir, 'vault2');

      await fs.mkdir(vault1);
      await fs.mkdir(vault2);
      await fs.writeFile(path.join(vault1, 'note1.md'), 'Note 1');
      await fs.writeFile(path.join(vault2, 'note2.md'), 'Note 2');

      const files = await scanner.scanVaults([
        { path: vault1, name: 'vault-1' },
        { path: vault2, name: 'vault-2' },
      ]);

      expect(files.length).toBe(2);
      expect(files.some(f => f.vault === 'vault-1')).toBe(true);
      expect(files.some(f => f.vault === 'vault-2')).toBe(true);
    });

    it('should handle empty vault list', async () => {
      const files = await scanner.scanVaults([]);
      expect(files).toEqual([]);
    });
  });

  describe('determineCategory', () => {
    it('should categorize sessions directory', async () => {
      const sessionsDir = path.join(tempDir, 'sessions');
      await fs.mkdir(sessionsDir);
      await fs.writeFile(path.join(sessionsDir, 'session.md'), 'Session');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].category).toBe('session');
    });

    it('should categorize date-based sessions (YYYY-MM)', async () => {
      const dateDir = path.join(tempDir, '2025-11');
      await fs.mkdir(dateDir);
      await fs.writeFile(path.join(dateDir, 'note.md'), 'Note');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].category).toBe('session');
    });

    it('should categorize topics directory', async () => {
      const topicsDir = path.join(tempDir, 'topics');
      await fs.mkdir(topicsDir);
      await fs.writeFile(path.join(topicsDir, 'topic.md'), 'Topic');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].category).toBe('topic');
    });

    it('should categorize decisions directory', async () => {
      const decisionsDir = path.join(tempDir, 'decisions');
      await fs.mkdir(decisionsDir);
      await fs.writeFile(path.join(decisionsDir, 'decision.md'), 'Decision');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].category).toBe('decision');
    });

    it('should categorize projects directory', async () => {
      const projectsDir = path.join(tempDir, 'projects');
      await fs.mkdir(projectsDir);
      await fs.writeFile(path.join(projectsDir, 'project.md'), 'Project');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].category).toBe('project');
    });

    it('should default to document category', async () => {
      await fs.writeFile(path.join(tempDir, 'note.md'), 'Note');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files[0].category).toBe('document');
    });
  });

  describe('getFileStats', () => {
    it('should get stats for existing file', async () => {
      const filePath = path.join(tempDir, 'test.md');
      await fs.writeFile(filePath, 'Test content');

      const stats = await scanner.getFileStats(filePath);

      expect(stats).not.toBeNull();
      expect(stats?.size).toBeGreaterThan(0);
      expect(stats?.lastModified).toBeGreaterThan(0);
      expect(stats?.hash).toBeDefined();
    });

    it('should return null for non-existent file', async () => {
      const stats = await scanner.getFileStats(path.join(tempDir, 'does-not-exist.md'));
      expect(stats).toBeNull();
    });

    it('should skip hash computation when disabled', async () => {
      const scannerNoHash = new FileScanner({ computeHashes: false });
      const filePath = path.join(tempDir, 'test.md');
      await fs.writeFile(filePath, 'Test content');

      const stats = await scannerNoHash.getFileStats(filePath);

      expect(stats?.hash).toBe('');
    });
  });

  describe('shouldIgnore', () => {
    it('should return true for default ignored directories', () => {
      expect(scanner.shouldIgnore('.git')).toBe(true);
      expect(scanner.shouldIgnore('node_modules')).toBe(true);
      expect(scanner.shouldIgnore('.DS_Store')).toBe(true);
      expect(scanner.shouldIgnore('.obsidian')).toBe(true);
    });

    it('should return false for non-ignored directories', () => {
      expect(scanner.shouldIgnore('topics')).toBe(false);
      expect(scanner.shouldIgnore('sessions')).toBe(false);
    });

    it('should respect custom ignored directories', () => {
      const customScanner = new FileScanner({
        ignoredDirs: new Set(['custom-ignore']),
      });

      expect(customScanner.shouldIgnore('custom-ignore')).toBe(true);
      expect(customScanner.shouldIgnore('.git')).toBe(false); // Default replaced
    });
  });

  describe('maxDepth option', () => {
    it('should respect maxDepth limit', async () => {
      const scannerDepth1 = new FileScanner({ maxDepth: 1 });

      const level1 = path.join(tempDir, 'level1');
      const level2 = path.join(level1, 'level2');

      await fs.mkdir(level1);
      await fs.mkdir(level2, { recursive: true });
      await fs.writeFile(path.join(tempDir, 'root.md'), 'Root');
      await fs.writeFile(path.join(level1, 'l1.md'), 'Level 1');
      await fs.writeFile(path.join(level2, 'l2.md'), 'Level 2');

      const files = await scannerDepth1.scanVault(tempDir, 'test-vault');

      // Should find root and level1, but not level2
      expect(files.length).toBe(2);
      expect(files.some(f => f.relativePath === 'root.md')).toBe(true);
      expect(files.some(f => f.relativePath === 'level1/l1.md')).toBe(true);
      expect(files.some(f => f.relativePath.includes('level2'))).toBe(false);
    });

    it('should scan unlimited depth by default', async () => {
      const deep = path.join(tempDir, 'a', 'b', 'c', 'd', 'e');
      await fs.mkdir(deep, { recursive: true });
      await fs.writeFile(path.join(deep, 'deep.md'), 'Deep');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toContain('deep.md');
    });
  });

  describe('edge cases', () => {
    it('should handle files with special characters in name', async () => {
      await fs.writeFile(path.join(tempDir, 'file (with) [brackets].md'), 'Content');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
    });

    it('should handle very long file names', async () => {
      const longName = 'a'.repeat(200) + '.md';
      await fs.writeFile(path.join(tempDir, longName), 'Content');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
    });

    it('should handle empty files', async () => {
      await fs.writeFile(path.join(tempDir, 'empty.md'), '');

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].size).toBe(0);
    });

    it('should handle large files', async () => {
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      await fs.writeFile(path.join(tempDir, 'large.md'), largeContent);

      const files = await scanner.scanVault(tempDir, 'test-vault');

      expect(files.length).toBe(1);
      expect(files[0].size).toBe(largeContent.length);
    });

    it('should handle symlinks gracefully', async () => {
      await fs.writeFile(path.join(tempDir, 'real.md'), 'Real');

      try {
        await fs.symlink(path.join(tempDir, 'real.md'), path.join(tempDir, 'link.md'));
      } catch {
        // Skip test if symlinks not supported
        return;
      }

      const files = await scanner.scanVault(tempDir, 'test-vault');

      // Should handle symlinks (implementation dependent)
      expect(files.length).toBeGreaterThan(0);
    });
  });
});
