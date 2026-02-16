import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { codeFile } from '../../../../src/tools/code/codeFile.js';
import type { CodeFileContext } from '../../../../src/tools/code/codeFile.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('codeFile', () => {
  let vaultPath: string;
  let context: CodeFileContext;
  let tempDir: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('code-file');
    tempDir = path.join(vaultPath, '..', 'code-project');
    await fs.mkdir(tempDir, { recursive: true });
    context = {
      vaultPath,
      secondaryVaults: [{ path: path.join(vaultPath, '..', 'secondary-vault'), name: 'Secondary' }],
      trackFileAccess: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('vault path rejection', () => {
    it('should reject files in primary vault', async () => {
      const filePath = path.join(vaultPath, 'topics', 'test.md');
      await expect(
        codeFile({ file_path: filePath, operation: 'write', content: 'test' }, context)
      ).rejects.toThrow('Use update_document for vault files');
    });

    it('should reject files in secondary vault', async () => {
      const secondaryPath = path.join(vaultPath, '..', 'secondary-vault', 'file.md');
      await expect(
        codeFile({ file_path: secondaryPath, operation: 'write', content: 'test' }, context)
      ).rejects.toThrow('Use update_document for vault files');
    });
  });

  describe('write operation', () => {
    it('should create a new file', async () => {
      const filePath = path.join(tempDir, 'new-file.ts');
      const result = await codeFile(
        { file_path: filePath, operation: 'write', content: 'const x = 1;' },
        context
      );

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('const x = 1;');
      expect(result.content[0].text).toContain('created');
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'create');
    });

    it('should overwrite an existing file', async () => {
      const filePath = path.join(tempDir, 'existing.ts');
      await fs.writeFile(filePath, 'old content');

      const result = await codeFile(
        { file_path: filePath, operation: 'write', content: 'new content' },
        context
      );

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('new content');
      expect(result.content[0].text).toContain('edited');
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'edit');
    });

    it('should create parent directories if needed', async () => {
      const filePath = path.join(tempDir, 'deep', 'nested', 'dir', 'file.ts');
      await codeFile({ file_path: filePath, operation: 'write', content: 'nested' }, context);

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('nested');
    });
  });

  describe('edit operation', () => {
    it('should replace first occurrence of old_string', async () => {
      const filePath = path.join(tempDir, 'edit-me.ts');
      await fs.writeFile(filePath, 'const foo = 1;\nconst foo = 2;');

      const result = await codeFile(
        {
          file_path: filePath,
          operation: 'edit',
          content: 'const bar = 1;',
          old_string: 'const foo = 1;',
        },
        context
      );

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('const bar = 1;\nconst foo = 2;');
      expect(result.content[0].text).toContain('edited');
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'edit');
    });

    it('should error when file does not exist', async () => {
      const filePath = path.join(tempDir, 'nonexistent.ts');
      await expect(
        codeFile(
          { file_path: filePath, operation: 'edit', content: 'new', old_string: 'old' },
          context
        )
      ).rejects.toThrow('Cannot edit non-existent file');
    });

    it('should error when old_string is missing', async () => {
      const filePath = path.join(tempDir, 'file.ts');
      await fs.writeFile(filePath, 'content');
      await expect(
        codeFile({ file_path: filePath, operation: 'edit', content: 'new' }, context)
      ).rejects.toThrow('edit operation requires old_string parameter');
    });

    it('should error when old_string is not found', async () => {
      const filePath = path.join(tempDir, 'file.ts');
      await fs.writeFile(filePath, 'actual content');
      await expect(
        codeFile(
          { file_path: filePath, operation: 'edit', content: 'new', old_string: 'not here' },
          context
        )
      ).rejects.toThrow('old_string not found in file');
    });
  });
});
