import { describe, it, expect } from 'vitest';
import { SecurityPipeline } from '../../../src/security/index.js';
import { SecurityError } from '../../../src/utils/errors.js';
import type { SecurityContext } from '../../../src/security/types.js';

function makeCtx(
  toolName: string,
  args: Record<string, unknown>,
  vaultPaths = ['/Users/test/vault']
): SecurityContext {
  return {
    toolName,
    args,
    vaultPaths,
    primaryVaultPath: vaultPaths[0],
    secondaryVaultPaths: vaultPaths.slice(1),
    timestamp: new Date(),
  };
}

describe('SecurityPipeline', () => {
  describe('preExecute', () => {
    it('returns sanitized args for clean input', () => {
      const pipeline = new SecurityPipeline();
      const ctx = makeCtx('search_vault', { query: 'hello world' });
      const result = pipeline.preExecute(ctx);
      expect(result).toEqual({ query: 'hello world' });
    });

    it('bypasses all checks when disabled', () => {
      const pipeline = new SecurityPipeline({ enabled: false });
      const ctx = makeCtx('update_document', {
        file_path: '/etc/passwd',
        content: 'hello\0world',
      });
      // Should pass through without sanitization or access control
      const result = pipeline.preExecute(ctx);
      expect(result).toEqual(ctx.args);
    });

    it('sanitizes then checks access (correct order)', () => {
      const pipeline = new SecurityPipeline();
      // This should fail at sanitization (null byte encoding), not access control
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/topics/%00test.md',
      });
      expect(() => pipeline.preExecute(ctx)).toThrow(SecurityError);
    });

    it('throws SecurityError for path outside vault', () => {
      const pipeline = new SecurityPipeline();
      const ctx = makeCtx('update_document', {
        file_path: '/etc/shadow',
      });
      expect(() => pipeline.preExecute(ctx)).toThrow(SecurityError);
    });

    it('strips null bytes from content', () => {
      const pipeline = new SecurityPipeline();
      const ctx = makeCtx('search_vault', { query: 'test\0query' });
      const result = pipeline.preExecute(ctx);
      expect(result.query).toBe('testquery');
    });
  });

  describe('postExecute', () => {
    it('passes through output unchanged (Phase 2 placeholder)', () => {
      const pipeline = new SecurityPipeline();
      const ctx = makeCtx('search_vault', { query: 'test' });
      const output = [{ type: 'text', text: 'result with email@example.com' }];
      const result = pipeline.postExecute(ctx, output);
      expect(result).toEqual(output);
    });
  });

  describe('isEnabled', () => {
    it('returns true by default', () => {
      const pipeline = new SecurityPipeline();
      expect(pipeline.isEnabled()).toBe(true);
    });

    it('returns false when disabled', () => {
      const pipeline = new SecurityPipeline({ enabled: false });
      expect(pipeline.isEnabled()).toBe(false);
    });
  });
});
