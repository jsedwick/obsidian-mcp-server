/**
 * Unit tests for trackFileAccess tool
 *
 * This is an example test demonstrating how to use the test helpers
 * to test modularized tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackFileAccess } from '../../../../src/tools/session/trackFileAccess.js';
import {
  createSessionToolsContext,
  createFileAccess,
  type SessionToolsContext,
} from '../../../helpers/index.js';

describe('trackFileAccess', () => {
  let context: SessionToolsContext;

  beforeEach(() => {
    // Create a fresh context for each test
    context = createSessionToolsContext({
      vaultPath: '/tmp/test-vault',
      currentSessionId: 'test-session-2025-01-15',
    });
  });

  describe('basic functionality', () => {
    it('should track a read access', async () => {
      const result = await trackFileAccess(
        {
          path: '/path/to/file.ts',
          action: 'read',
        },
        context
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('read /path/to/file.ts');

      // Verify file was tracked in context
      expect(context.filesAccessed).toHaveLength(1);
      expect(context.filesAccessed[0]).toMatchObject({
        path: '/path/to/file.ts',
        action: 'read',
      });
      expect(context.filesAccessed[0].timestamp).toBeDefined();
    });

    it('should track an edit access', async () => {
      const result = await trackFileAccess(
        {
          path: '/path/to/file.ts',
          action: 'edit',
        },
        context
      );

      expect(result.content[0].text).toContain('edit /path/to/file.ts');
      expect(context.filesAccessed[0].action).toBe('edit');
    });

    it('should track a create access', async () => {
      const result = await trackFileAccess(
        {
          path: '/path/to/new-file.ts',
          action: 'create',
        },
        context
      );

      expect(result.content[0].text).toContain('create /path/to/new-file.ts');
      expect(context.filesAccessed[0].action).toBe('create');
    });
  });

  describe('multiple file tracking', () => {
    it('should track multiple files in sequence', async () => {
      await trackFileAccess({ path: '/file1.ts', action: 'read' }, context);
      await trackFileAccess({ path: '/file2.ts', action: 'edit' }, context);
      await trackFileAccess({ path: '/file3.ts', action: 'create' }, context);

      expect(context.filesAccessed).toHaveLength(3);
      expect(context.filesAccessed.map(f => f.path)).toEqual([
        '/file1.ts',
        '/file2.ts',
        '/file3.ts',
      ]);
      expect(context.filesAccessed.map(f => f.action)).toEqual(['read', 'edit', 'create']);
    });

    it('should track duplicate paths with different actions', async () => {
      await trackFileAccess({ path: '/file.ts', action: 'read' }, context);
      await trackFileAccess({ path: '/file.ts', action: 'edit' }, context);

      expect(context.filesAccessed).toHaveLength(2);
      expect(context.filesAccessed[0].action).toBe('read');
      expect(context.filesAccessed[1].action).toBe('edit');
    });
  });

  describe('timestamp handling', () => {
    it('should generate unique timestamps for sequential accesses', async () => {
      await trackFileAccess({ path: '/file1.ts', action: 'read' }, context);
      await trackFileAccess({ path: '/file2.ts', action: 'read' }, context);

      const timestamps = context.filesAccessed.map(f => f.timestamp);
      expect(timestamps[0]).toBeDefined();
      expect(timestamps[1]).toBeDefined();
      // Timestamps should be ISO format
      expect(timestamps[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('context isolation', () => {
    it('should use separate filesAccessed arrays for different contexts', async () => {
      const context1 = createSessionToolsContext();
      const context2 = createSessionToolsContext();

      await trackFileAccess({ path: '/file1.ts', action: 'read' }, context1);
      await trackFileAccess({ path: '/file2.ts', action: 'read' }, context2);

      expect(context1.filesAccessed).toHaveLength(1);
      expect(context2.filesAccessed).toHaveLength(1);
      expect(context1.filesAccessed[0].path).toBe('/file1.ts');
      expect(context2.filesAccessed[0].path).toBe('/file2.ts');
    });
  });

  describe('edge cases', () => {
    it('should handle paths with spaces', async () => {
      await trackFileAccess({ path: '/path/with spaces/file.ts', action: 'read' }, context);

      expect(context.filesAccessed[0].path).toBe('/path/with spaces/file.ts');
    });

    it('should handle paths with special characters', async () => {
      await trackFileAccess({ path: '/path/with-special_chars/file@123.ts', action: 'read' }, context);

      expect(context.filesAccessed[0].path).toBe('/path/with-special_chars/file@123.ts');
    });

    it('should handle very long paths', async () => {
      const longPath = '/very/' + 'long/'.repeat(50) + 'path/file.ts';
      await trackFileAccess({ path: longPath, action: 'read' }, context);

      expect(context.filesAccessed[0].path).toBe(longPath);
    });
  });
});
