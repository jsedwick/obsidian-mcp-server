import { describe, it, expect } from 'vitest';
import {
  validateAccess,
  resolvePath,
  DEFAULT_ACCESS_CONTROL_CONFIG,
} from '../../../src/security/access-control.js';
import { SecurityError } from '../../../src/utils/errors.js';
import type { SecurityContext, AccessControlConfig } from '../../../src/security/types.js';

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

describe('access-control', () => {
  describe('validateAccess', () => {
    it('passes for tools without path fields', () => {
      const ctx = makeCtx('search_vault', { query: 'test' });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).not.toThrow();
    });

    it('passes for vault paths in update_document', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/topics/test.md',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).not.toThrow();
    });

    it('blocks paths outside vault boundaries', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/etc/passwd',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).toThrow(SecurityError);
    });

    it('blocks paths matching deny patterns', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/.env',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).toThrow(SecurityError);
    });

    it('blocks .env.local via deny pattern', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/.env.local',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).toThrow(SecurityError);
    });

    it('allows code_file with paths in allowedPaths', () => {
      const config: AccessControlConfig = {
        ...DEFAULT_ACCESS_CONTROL_CONFIG,
        allowedPaths: ['/Users/test/projects'],
      };
      const ctx = makeCtx('code_file', {
        file_path: '/Users/test/projects/app/src/index.ts',
      });
      expect(() => validateAccess(ctx, config)).not.toThrow();
    });

    it('blocks code_file with paths outside all allowed roots', () => {
      const ctx = makeCtx('code_file', {
        file_path: '/tmp/random/file.ts',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).toThrow(SecurityError);
    });

    it('deny list takes precedence over allowed paths', () => {
      const config: AccessControlConfig = {
        ...DEFAULT_ACCESS_CONTROL_CONFIG,
        allowedPaths: ['/Users/test/projects'],
        deniedPaths: ['/Users/test/projects/secret'],
      };
      const ctx = makeCtx('code_file', {
        file_path: '/Users/test/projects/secret/keys.json',
      });
      expect(() => validateAccess(ctx, config)).toThrow(SecurityError);
    });

    it('handles multiple vault paths', () => {
      const ctx = makeCtx('update_document', { file_path: '/Users/test/vault2/topics/test.md' }, [
        '/Users/test/vault1',
        '/Users/test/vault2',
      ]);
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).not.toThrow();
    });

    it('skips non-string path fields', () => {
      const ctx = makeCtx('update_document', { file_path: 123 });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).not.toThrow();
    });

    it('validates array path fields (working_directories)', () => {
      const config: AccessControlConfig = {
        ...DEFAULT_ACCESS_CONTROL_CONFIG,
        allowedPaths: ['/Users/test/projects'],
      };
      const ctx = makeCtx('close_session', {
        working_directories: ['/Users/test/projects/app', '/Users/test/projects/lib'],
      });
      expect(() => validateAccess(ctx, config)).not.toThrow();
    });

    it('blocks any path in array that violates access rules', () => {
      const config: AccessControlConfig = {
        ...DEFAULT_ACCESS_CONTROL_CONFIG,
        allowedPaths: ['/Users/test/projects'],
      };
      const ctx = makeCtx('close_session', {
        working_directories: ['/Users/test/projects/app', '/etc/shadow'],
      });
      expect(() => validateAccess(ctx, config)).toThrow(SecurityError);
    });
  });

  describe('resolvePath', () => {
    it('returns resolved path when symlinks disabled', () => {
      const result = resolvePath('/some/../path/file.md', false);
      expect(result).toBe('/path/file.md');
    });

    it('resolves existing paths with symlinks enabled', () => {
      // Use a path we know exists
      const result = resolvePath('/tmp', true);
      // On macOS, /tmp is a symlink to /private/tmp
      expect(result).toMatch(/\/tmp$/);
    });

    it('falls back for non-existent paths', () => {
      const result = resolvePath('/nonexistent/path/to/file.md', true);
      expect(result).toBe('/nonexistent/path/to/file.md');
    });
  });

  describe('deny patterns', () => {
    it('blocks credentials files', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/credentials.json',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).toThrow(SecurityError);
    });

    it('blocks .git/config', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/.git/config',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).toThrow(SecurityError);
    });

    it('allows normal vault files', () => {
      const ctx = makeCtx('update_document', {
        file_path: '/Users/test/vault/topics/my-topic.md',
      });
      expect(() => validateAccess(ctx, DEFAULT_ACCESS_CONTROL_CONFIG)).not.toThrow();
    });
  });
});
