/**
 * protectedFiles utility unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  isProtectedFile,
  getProtectionReason,
  validateFileOperation,
  PROTECTED_FILE_PATTERNS,
} from '../../../src/utils/protectedFiles.js';

describe('protectedFiles', () => {
  describe('PROTECTED_FILE_PATTERNS', () => {
    it('should include user-reference.md as exact string', () => {
      expect(PROTECTED_FILE_PATTERNS).toContain('user-reference.md');
    });

    it('should include accumulator regex pattern', () => {
      const hasAccumulatorPattern = PROTECTED_FILE_PATTERNS.some(
        p => p instanceof RegExp && p.source === '^accumulator-.+\\.md$'
      );
      expect(hasAccumulatorPattern).toBe(true);
    });
  });

  describe('isProtectedFile', () => {
    it('should detect user-reference.md as protected (exact match)', () => {
      expect(isProtectedFile('/vault/user-reference.md')).toBe(true);
    });

    it('should detect user-reference.md regardless of path', () => {
      expect(isProtectedFile('/any/path/to/user-reference.md')).toBe(true);
      expect(isProtectedFile('user-reference.md')).toBe(true);
    });

    it('should detect accumulator files as protected (regex match)', () => {
      expect(isProtectedFile('/vault/accumulator-corrections.md')).toBe(true);
      expect(isProtectedFile('/vault/accumulator-tasks.md')).toBe(true);
      expect(isProtectedFile('/vault/accumulator-anything.md')).toBe(true);
    });

    it('should not detect normal files as protected', () => {
      expect(isProtectedFile('/vault/topics/my-topic.md')).toBe(false);
      expect(isProtectedFile('/vault/sessions/session.md')).toBe(false);
      expect(isProtectedFile('/vault/decisions/001-decision.md')).toBe(false);
    });

    it('should not match partial accumulator filenames', () => {
      expect(isProtectedFile('/vault/accumulator-.md')).toBe(false);
    });

    it('should not match files with accumulator in directory path only', () => {
      expect(isProtectedFile('/vault/accumulator-dir/normal-file.md')).toBe(false);
    });
  });

  describe('getProtectionReason', () => {
    it('should return reason for user-reference.md', () => {
      const reason = getProtectionReason('/vault/user-reference.md');
      expect(reason).not.toBeNull();
      expect(reason).toContain('user-reference.md');
      expect(reason).toContain('update_user_reference');
    });

    it('should return reason for accumulator files', () => {
      const reason = getProtectionReason('/vault/accumulator-corrections.md');
      expect(reason).not.toBeNull();
      expect(reason).toContain('accumulator-corrections.md');
      expect(reason).toContain('append_to_accumulator');
    });

    it('should return null for non-protected files', () => {
      expect(getProtectionReason('/vault/topics/my-topic.md')).toBeNull();
      expect(getProtectionReason('/vault/normal-file.md')).toBeNull();
    });
  });

  describe('validateFileOperation', () => {
    it('should not throw for non-protected files', () => {
      expect(() => validateFileOperation('/vault/topics/my-topic.md', 'write')).not.toThrow();
      expect(() => validateFileOperation('/vault/normal.md', 'delete')).not.toThrow();
    });

    it('should throw for protected files', () => {
      expect(() => validateFileOperation('/vault/user-reference.md', 'write')).toThrow(
        /Protected File/
      );
    });

    it('should include operation in error message', () => {
      expect(() => validateFileOperation('/vault/user-reference.md', 'overwrite')).toThrow(
        /overwrite/
      );
    });

    it('should include filename in error message', () => {
      expect(() => validateFileOperation('/vault/accumulator-corrections.md', 'write')).toThrow(
        /accumulator-corrections.md/
      );
    });

    it('should include protection reason in error message', () => {
      expect(() => validateFileOperation('/vault/user-reference.md', 'write')).toThrow(
        /update_user_reference/
      );
    });
  });
});
