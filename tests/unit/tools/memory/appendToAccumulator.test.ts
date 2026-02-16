import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { appendToAccumulator } from '../../../../src/tools/memory/appendToAccumulator.js';
import type { AppendToAccumulatorContext } from '../../../../src/tools/memory/appendToAccumulator.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('appendToAccumulator', () => {
  let vaultPath: string;
  let context: AppendToAccumulatorContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('accumulator');
    context = {
      vaultPath,
      trackFileAccess: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('filename validation', () => {
    it('should reject filenames not starting with accumulator-', async () => {
      await expect(
        appendToAccumulator({ filename: 'notes.md', content: 'test' }, context)
      ).rejects.toThrow('Invalid accumulator filename');
    });

    it('should reject filenames not ending with .md', async () => {
      await expect(
        appendToAccumulator({ filename: 'accumulator-test.txt', content: 'test' }, context)
      ).rejects.toThrow('must end with .md');
    });
  });

  describe('creating new accumulators', () => {
    it('should create a new accumulator file with template', async () => {
      const result = await appendToAccumulator(
        { filename: 'accumulator-corrections.md', content: 'First entry content' },
        context
      );

      const filePath = path.join(vaultPath, 'accumulator-corrections.md');
      const written = await fs.readFile(filePath, 'utf-8');

      expect(written).toContain('# Accumulator: Corrections');
      expect(written).toContain('First entry content');
      expect(written).toContain('## Entries');
      expect(result.content[0].text).toContain('Created new accumulator');
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'create');
    });

    it('should add timestamp by default', async () => {
      await appendToAccumulator(
        { filename: 'accumulator-corrections.md', content: 'test' },
        context
      );

      const filePath = path.join(vaultPath, 'accumulator-corrections.md');
      const written = await fs.readFile(filePath, 'utf-8');
      // Should contain a bold date (timestamp pattern)
      expect(written).toMatch(/\*\*\d{4}-\d{2}-\d{2}\*\*/);
    });

    it('should skip timestamp when add_timestamp is false', async () => {
      await appendToAccumulator(
        { filename: 'accumulator-corrections.md', content: 'no timestamp', add_timestamp: false },
        context
      );

      const filePath = path.join(vaultPath, 'accumulator-corrections.md');
      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toContain('no timestamp');
      expect(written).not.toMatch(/\*\*\d{4}-\d{2}-\d{2}\*\*/);
    });
  });

  describe('appending to existing accumulators', () => {
    it('should append content to existing file', async () => {
      const filePath = path.join(vaultPath, 'accumulator-corrections.md');
      await fs.writeFile(filePath, '# Existing\n\nFirst entry\n');

      const result = await appendToAccumulator(
        { filename: 'accumulator-corrections.md', content: 'Second entry' },
        context
      );

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toContain('First entry');
      expect(written).toContain('Second entry');
      expect(result.content[0].text).toContain('Appended to accumulator');
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'edit');
    });
  });
});
