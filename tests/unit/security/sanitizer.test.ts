import { describe, it, expect } from 'vitest';
import { sanitizeArgs, DEFAULT_SANITIZATION_CONFIG } from '../../../src/security/sanitizer.js';
import { SecurityError } from '../../../src/utils/errors.js';
import type { SecurityContext, SanitizationConfig } from '../../../src/security/types.js';

function makeCtx(args: Record<string, unknown>, toolName = 'test_tool'): SecurityContext {
  return {
    toolName,
    args,
    vaultPaths: ['/vault'],
    primaryVaultPath: '/vault',
    secondaryVaultPaths: [],
    timestamp: new Date(),
  };
}

describe('sanitizer', () => {
  describe('passthrough', () => {
    it('passes clean string args through unchanged', () => {
      const args = { query: 'hello world', limit: 10 };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      expect(result).toEqual(args);
    });

    it('preserves non-string values', () => {
      const args = { count: 42, enabled: true, items: [1, 2, 3] };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      expect(result).toEqual(args);
    });
  });

  describe('null byte stripping', () => {
    it('strips null bytes from strings', () => {
      const args = { query: 'hello\0world' };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      expect(result.query).toBe('helloworld');
    });

    it('skips null byte stripping when disabled', () => {
      const config: SanitizationConfig = { ...DEFAULT_SANITIZATION_CONFIG, stripNullBytes: false };
      const args = { query: 'hello\0world' };
      // Null bytes in the string won't be stripped, but won't match dangerous patterns either
      // (dangerous patterns check for %00, not literal null)
      const result = sanitizeArgs(makeCtx(args), config);
      expect(result.query).toBe('hello\0world');
    });
  });

  describe('unicode normalization', () => {
    it('normalizes Unicode to NFC', () => {
      // é as two code points (e + combining accent) vs single code point
      const decomposed = 'e\u0301'; // NFD
      const composed = '\u00e9'; // NFC
      const args = { text: decomposed };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      expect(result.text).toBe(composed);
    });
  });

  describe('length enforcement', () => {
    it('truncates strings exceeding maxStringLength', () => {
      const config: SanitizationConfig = { ...DEFAULT_SANITIZATION_CONFIG, maxStringLength: 10 };
      const args = { query: 'a'.repeat(20) };
      const result = sanitizeArgs(makeCtx(args), config);
      expect(result.query).toBe('a'.repeat(10));
    });

    it('uses maxContentLength for content fields', () => {
      const config: SanitizationConfig = {
        ...DEFAULT_SANITIZATION_CONFIG,
        maxStringLength: 5,
        maxContentLength: 20,
      };
      const args = { content: 'a'.repeat(15), query: 'a'.repeat(15) };
      const result = sanitizeArgs(makeCtx(args), config);
      expect((result.content as string).length).toBe(15); // Under maxContentLength
      expect((result.query as string).length).toBe(5); // Truncated to maxStringLength
    });
  });

  describe('dangerous pattern detection', () => {
    it('blocks URL-encoded path traversal', () => {
      const args = { path: '/vault/%2e%2e%2fetc/passwd' };
      expect(() => sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG)).toThrow(SecurityError);
    });

    it('blocks URL-encoded null bytes', () => {
      const args = { path: '/vault/file%00.md' };
      expect(() => sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG)).toThrow(SecurityError);
    });

    it('blocks Unicode bidirectional overrides', () => {
      const args = { text: 'normal\u202Etext' };
      expect(() => sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG)).toThrow(SecurityError);
    });

    it('blocks zero-width characters', () => {
      const args = { text: 'hello\u200Bworld' };
      expect(() => sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG)).toThrow(SecurityError);
    });
  });

  describe('custom block patterns', () => {
    it('blocks user-configured patterns', () => {
      const config: SanitizationConfig = {
        ...DEFAULT_SANITIZATION_CONFIG,
        blockPatterns: ['FORBIDDEN_WORD'],
      };
      const args = { text: 'contains FORBIDDEN_WORD here' };
      expect(() => sanitizeArgs(makeCtx(args), config)).toThrow(SecurityError);
    });

    it('ignores invalid regex patterns gracefully', () => {
      const config: SanitizationConfig = {
        ...DEFAULT_SANITIZATION_CONFIG,
        blockPatterns: ['[invalid regex'],
      };
      const args = { text: 'normal text' };
      // Should not throw — invalid pattern is skipped
      const result = sanitizeArgs(makeCtx(args), config);
      expect(result.text).toBe('normal text');
    });
  });

  describe('deep object traversal', () => {
    it('sanitizes nested objects', () => {
      const args = {
        outer: {
          inner: 'hello\0world',
        },
      };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      expect((result.outer as Record<string, unknown>).inner).toBe('helloworld');
    });

    it('sanitizes strings inside arrays', () => {
      const args = {
        items: ['hello\0', 'world\0'],
      };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      expect(result.items).toEqual(['hello', 'world']);
    });

    it('handles objects inside arrays', () => {
      const args = {
        reviews: [{ topic: 'test\0topic', score: 5 }],
      };
      const result = sanitizeArgs(makeCtx(args), DEFAULT_SANITIZATION_CONFIG);
      const reviews = result.reviews as Array<Record<string, unknown>>;
      expect(reviews[0].topic).toBe('testtopic');
      expect(reviews[0].score).toBe(5);
    });
  });

  describe('immutability', () => {
    it('does not mutate the original args', () => {
      const original = { query: 'hello\0world' };
      sanitizeArgs(makeCtx(original), DEFAULT_SANITIZATION_CONFIG);
      expect(original.query).toBe('hello\0world');
    });
  });
});
