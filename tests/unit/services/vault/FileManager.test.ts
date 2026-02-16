/**
 * FileManager unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { FileManager } from '../../../../src/services/vault/FileManager.js';
import { VaultError } from '../../../../src/utils/errors.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('FileManager', () => {
  let fm: FileManager;
  let vaultPath: string;

  beforeEach(async () => {
    fm = new FileManager();
    vaultPath = await createTestVault('filemanager');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('read/write round-trip', () => {
    it('should write and then read the same content', async () => {
      const filePath = path.join(vaultPath, 'topics', 'test.md');
      const content = '# Hello\n\nWorld';

      await fm.writeFile(filePath, content);
      const read = await fm.readFile(filePath);

      expect(read).toBe(content);
    });
  });

  describe('auto-create directories on write', () => {
    it('should create intermediate directories when writing', async () => {
      const filePath = path.join(vaultPath, 'new', 'nested', 'dir', 'file.md');
      await fm.writeFile(filePath, 'content');

      const read = await fm.readFile(filePath);
      expect(read).toBe('content');
    });
  });

  describe('read nonexistent file', () => {
    it('should throw VaultError for a missing file', async () => {
      const filePath = path.join(vaultPath, 'nope.md');
      await expect(fm.readFile(filePath)).rejects.toThrow(VaultError);
    });
  });

  describe('parseFrontmatter', () => {
    it('should parse various frontmatter types', () => {
      const content = `---
title: Test Title
count: 42
rating: 3.14
enabled: true
disabled: false
empty: null
tags: ["a","b"]
---
Body content here`;

      const result = fm.parseFrontmatter(content);

      expect(result.frontmatter.title).toBe('Test Title');
      expect(result.frontmatter.count).toBe(42);
      expect(result.frontmatter.rating).toBe(3.14);
      expect(result.frontmatter.enabled).toBe(true);
      expect(result.frontmatter.disabled).toBe(false);
      expect(result.frontmatter.empty).toBeNull();
      expect(result.frontmatter.tags).toEqual(['a', 'b']);
      expect(result.body).toBe('Body content here');
    });

    it('should return empty frontmatter when no delimiters', () => {
      const content = 'Just body content without frontmatter';
      const result = fm.parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should handle quoted string values', () => {
      const content = `---
title: "Quoted: value"
---
body`;

      const result = fm.parseFrontmatter(content);
      expect(result.frontmatter.title).toBe('Quoted: value');
    });
  });

  describe('appendToFile', () => {
    it('should append content to an existing file', async () => {
      const filePath = path.join(vaultPath, 'topics', 'append.md');
      await fm.writeFile(filePath, 'Line 1');
      await fm.appendToFile(filePath, 'Line 2');

      const content = await fm.readFile(filePath);
      expect(content).toBe('Line 1\nLine 2');
    });
  });

  describe('updateFrontmatter', () => {
    it('should merge new fields into existing frontmatter', async () => {
      const filePath = path.join(vaultPath, 'topics', 'meta.md');
      await fm.writeFile(filePath, '---\ntitle: Original\ncount: 1\n---\nBody');

      await fm.updateFrontmatter(filePath, { count: 2, newField: 'added' });

      const content = await fm.readFile(filePath);
      const parsed = fm.parseFrontmatter(content);

      expect(parsed.frontmatter.title).toBe('Original');
      expect(parsed.frontmatter.count).toBe(2);
      expect(parsed.frontmatter.newField).toBe('added');
    });
  });
});
