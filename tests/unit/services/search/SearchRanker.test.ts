/**
 * SearchRanker unit tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SearchRanker } from '../../../../src/services/search/SearchRanker.js';
import { ResponseDetail } from '../../../../src/models/Search.js';
import type { InternalSearchMatch } from '../../../../src/models/Search.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchRanker', () => {
  const ranker = new SearchRanker();

  describe('formatResults', () => {
    it('should return empty results message when no results', () => {
      const output = ranker.formatResults([], 0, ResponseDetail.SUMMARY, false, 'test query');
      expect(output).toContain('No results found');
      expect(output).toContain('test query');
    });

    it('should include expected output fields', () => {
      const results = [
        {
          file: 'topics/test.md',
          matches: ['matching line'],
          score: 10,
          date: '2025-01-15',
          vault: 'TestVault',
        },
      ];

      const output = ranker.formatResults(results, 1, ResponseDetail.SUMMARY, false, 'test');

      expect(output).toContain('test.md');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('TestVault');
      expect(output).toContain('matching line');
    });
  });

  describe('smartTruncate', () => {
    it('should return short text unchanged', () => {
      const text = 'Short text.';
      expect(ranker.smartTruncate(text, 200)).toBe(text);
    });

    it('should truncate at sentence boundary when possible', () => {
      // Build a string where a sentence ends in the last 20% of truncation zone
      const sentence1 = 'First sentence with some words. ';
      const sentence2 =
        'Second sentence that continues much further with additional words to make it long enough.';
      const text = sentence1 + sentence2;
      const maxLength = 50;

      const result = ranker.smartTruncate(text, maxLength);

      expect(result.length).toBeLessThanOrEqual(maxLength);
      expect(result).toContain('...');
    });

    it('should fall back to word boundary when no sentence end found', () => {
      const text = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
      const result = ranker.smartTruncate(text, 40);

      expect(result.length).toBeLessThanOrEqual(40);
      expect(result).toContain('...');
      // Should end with "..." appended to a complete word (no partial words before ellipsis)
      expect(result).toMatch(/\w\.\.\.$/);
    });
  });

  describe('deduplicateResults', () => {
    it('should keep first occurrence of duplicate file paths', () => {
      const results: InternalSearchMatch[] = [
        { file: 'topics/a.md', matches: ['first'], score: 10 },
        { file: 'topics/b.md', matches: ['unique'], score: 8 },
        { file: 'topics/a.md', matches: ['second'], score: 5 },
      ];

      const deduplicated = ranker.deduplicateResults(results);

      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].matches[0]).toBe('first');
      expect(deduplicated[1].file).toBe('topics/b.md');
    });
  });
});
