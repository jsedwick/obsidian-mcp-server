/**
 * KeywordSearch unit tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { KeywordSearch } from '../../../../src/services/search/KeywordSearch.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KeywordSearch', () => {
  const ks = new KeywordSearch();
  const defaultStats = { mtime: new Date() };

  describe('exact phrase bonus', () => {
    it('should award +15 for an exact multi-word phrase match', () => {
      const content = '---\ntitle: Test\n---\nThe quick brown fox jumps over the lazy dog';
      const result = ks.scoreSearchResult(
        'topics',
        'test.md',
        'test.md',
        content,
        defaultStats,
        'brown fox',
        ['brown', 'fox'],
        undefined,
        undefined,
        false
      );

      expect(result).not.toBeNull();
      // Exact phrase contributes +15 on top of per-term scores
      expect(result!.score).toBeGreaterThanOrEqual(15);
    });
  });

  describe('header match bonus', () => {
    it('should award +10 for a term found in a heading', () => {
      const content = '---\ntitle: Doc\n---\n# Important Heading\n\nBody text here';
      const result = ks.scoreSearchResult(
        'topics',
        'doc.md',
        'doc.md',
        content,
        defaultStats,
        'important',
        ['important'],
        undefined,
        undefined,
        false
      );

      expect(result).not.toBeNull();
      // Header bonus is +10 per term in a heading
      expect(result!.score).toBeGreaterThanOrEqual(10);
    });
  });

  describe('tag match bonus', () => {
    it('should award +7 for a term found in frontmatter tags', () => {
      const content = '---\ntitle: Doc\ntags: ["testing", "search"]\n---\nBody content';
      const result = ks.scoreSearchResult(
        'topics',
        'doc.md',
        'doc.md',
        content,
        defaultStats,
        'testing',
        ['testing'],
        undefined,
        undefined,
        false
      );

      expect(result).not.toBeNull();
      // Tag bonus is +7
      expect(result!.score).toBeGreaterThanOrEqual(7);
    });
  });

  describe('logarithmic frequency', () => {
    it('should score higher for more occurrences but with diminishing returns', () => {
      const fewOccurrences = '---\ntitle: A\n---\napple is good';
      const manyOccurrences = '---\ntitle: B\n---\napple apple apple apple apple apple apple apple';

      const resultFew = ks.scoreSearchResult(
        'topics',
        'few.md',
        'few.md',
        fewOccurrences,
        defaultStats,
        'apple',
        ['apple'],
        undefined,
        undefined,
        false
      );
      const resultMany = ks.scoreSearchResult(
        'topics',
        'many.md',
        'many.md',
        manyOccurrences,
        defaultStats,
        'apple',
        ['apple'],
        undefined,
        undefined,
        false
      );

      expect(resultFew).not.toBeNull();
      expect(resultMany).not.toBeNull();
      expect(resultMany!.score).toBeGreaterThan(resultFew!.score);
      // Logarithmic: 8x occurrences should NOT give 8x score
      expect(resultMany!.score).toBeLessThan(resultFew!.score * 8);
    });
  });

  describe('archive exclusion', () => {
    it('should return null for archived files when includeArchived is false', () => {
      const content = '---\ntitle: Old\n---\narchived content with keyword';
      const result = ks.scoreSearchResult(
        'topics',
        'test.md',
        'test.md',
        content,
        defaultStats,
        'keyword',
        ['keyword'],
        undefined,
        '/vault/topics/archive/test.md',
        false
      );

      expect(result).toBeNull();
    });
  });

  describe('date range filtering', () => {
    it('should return null when file date is outside range', () => {
      const content = '---\ncreated: 2024-06-15\n---\nContent with keyword';
      const result = ks.scoreSearchResult(
        'topics',
        'old.md',
        'old.md',
        content,
        defaultStats,
        'keyword',
        ['keyword'],
        { start: '2025-01-01', end: '2025-12-31' },
        undefined,
        false
      );

      expect(result).toBeNull();
    });
  });
});
