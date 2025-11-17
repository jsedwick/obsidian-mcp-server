/**
 * Unit tests for Tokenizer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Tokenizer } from '../../../../../src/services/search/index/Tokenizer.js';
import { IndexField } from '../../../../../src/models/IndexModels.js';
import type { Term } from '../../../../../src/models/IndexModels.js';

describe('Tokenizer', () => {
  let tokenizer: Tokenizer;

  beforeEach(() => {
    tokenizer = new Tokenizer();
  });

  describe('constructor', () => {
    it('should create tokenizer with default options', () => {
      expect(tokenizer).toBeDefined();
    });

    it('should create tokenizer with custom options', () => {
      const customTokenizer = new Tokenizer({
        minTermLength: 2,
        removeStopWords: true,
      });
      expect(customTokenizer).toBeDefined();
    });
  });

  describe('tokenize', () => {
    it('should tokenize simple text', () => {
      const tokens = tokenizer.tokenize('hello world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should lowercase all tokens', () => {
      const tokens = tokenizer.tokenize('Hello WORLD');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should handle empty string', () => {
      const tokens = tokenizer.tokenize('');
      expect(tokens).toEqual([]);
    });

    it('should split on spaces', () => {
      const tokens = tokenizer.tokenize('one two three');
      expect(tokens).toEqual(['one', 'two', 'three']);
    });

    it('should split on hyphens', () => {
      const tokens = tokenizer.tokenize('hello-world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should split on underscores', () => {
      const tokens = tokenizer.tokenize('hello_world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should split on punctuation', () => {
      const tokens = tokenizer.tokenize('hello, world! how are you?');
      expect(tokens).toEqual(['hello', 'world', 'how', 'are', 'you']);
    });

    it('should filter by minimum term length', () => {
      const tokens = tokenizer.tokenize('a ab abc abcd');
      // Default minTermLength is 3
      expect(tokens).toEqual(['abc', 'abcd']);
    });

    it('should handle multiple spaces', () => {
      const tokens = tokenizer.tokenize('hello    world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should handle tabs and newlines', () => {
      const tokens = tokenizer.tokenize('hello\tworld\ntest');
      expect(tokens).toEqual(['hello', 'world', 'test']);
    });

    it('should remove stop words when enabled', () => {
      const tokenizerWithStopWords = new Tokenizer({
        removeStopWords: true,
        stopWords: new Set(['the', 'and', 'or']),
      });
      const tokens = tokenizerWithStopWords.tokenize('the quick and the dead');
      expect(tokens).toEqual(['quick', 'dead']);
    });

    it('should keep stop words when disabled', () => {
      const tokens = tokenizer.tokenize('the quick and the dead');
      expect(tokens).toEqual(['the', 'quick', 'and', 'the', 'dead']);
    });
  });

  describe('tokenizeDocument', () => {
    it('should tokenize document with frontmatter', () => {
      const content = `---
title: Test Document
tags: [tag1, tag2]
---

This is the content.`;

      const terms = tokenizer.tokenizeDocument(content);

      // Should have terms from title, tags, and content
      expect(terms.length).toBeGreaterThan(0);

      // Check field types
      const titleTerms = terms.filter(t => t.field === IndexField.TITLE);
      const tagTerms = terms.filter(t => t.field === IndexField.TAGS);
      const contentTerms = terms.filter(t => t.field === IndexField.CONTENT);

      expect(titleTerms.length).toBeGreaterThan(0);
      expect(tagTerms.length).toBeGreaterThan(0);
      expect(contentTerms.length).toBeGreaterThan(0);
    });

    it('should tokenize document without frontmatter', () => {
      const content = 'Simple document without frontmatter.';
      const terms = tokenizer.tokenizeDocument(content);

      // Should only have content terms
      const contentTerms = terms.filter(t => t.field === IndexField.CONTENT);
      expect(contentTerms.length).toBe(terms.length);
    });

    it('should extract title from frontmatter', () => {
      const content = `---
title: My Great Title
---
Content here.`;

      const terms = tokenizer.tokenizeDocument(content);
      const titleTerms = terms.filter(t => t.field === IndexField.TITLE);

      expect(titleTerms.some(t => t.text === 'great')).toBe(true);
      expect(titleTerms.some(t => t.text === 'title')).toBe(true);
    });

    it('should extract title from filename if no frontmatter title', () => {
      const content = 'Just content';
      const terms = tokenizer.tokenizeDocument(content, {
        path: 'my-awesome-file.md',
      });

      const titleTerms = terms.filter(t => t.field === IndexField.TITLE);
      expect(titleTerms.some(t => t.text === 'awesome')).toBe(true);
      expect(titleTerms.some(t => t.text === 'file')).toBe(true);
    });

    it('should extract tags from frontmatter array', () => {
      const content = `---
tags: [javascript, typescript, programming]
---
Content`;

      const terms = tokenizer.tokenizeDocument(content);
      const tagTerms = terms.filter(t => t.field === IndexField.TAGS);

      expect(tagTerms.some(t => t.text === 'javascript')).toBe(true);
      expect(tagTerms.some(t => t.text === 'typescript')).toBe(true);
      expect(tagTerms.some(t => t.text === 'programming')).toBe(true);
    });

    it('should handle comma-separated tags', () => {
      const content = `---
tags: javascript, typescript, programming
---
Content`;

      const terms = tokenizer.tokenizeDocument(content);
      const tagTerms = terms.filter(t => t.field === IndexField.TAGS);

      expect(tagTerms.some(t => t.text === 'javascript')).toBe(true);
    });

    it('should track term positions', () => {
      const content = 'first second third fourth';
      const terms = tokenizer.tokenizeDocument(content);

      const contentTerms = terms.filter(t => t.field === IndexField.CONTENT);
      expect(contentTerms[0].position).toBe(0);
      expect(contentTerms[1].position).toBe(1);
      expect(contentTerms[2].position).toBe(2);
      expect(contentTerms[3].position).toBe(3);
    });

    it('should extract frontmatter fields', () => {
      const content = `---
title: Test
author: John Doe
category: Testing
---
Content`;

      const terms = tokenizer.tokenizeDocument(content);
      const frontmatterTerms = terms.filter(t => t.field === IndexField.FRONTMATTER);

      // Should have author and category (title excluded as it's indexed separately)
      expect(frontmatterTerms.some(t => t.text === 'john')).toBe(true);
      expect(frontmatterTerms.some(t => t.text === 'doe')).toBe(true);
      expect(frontmatterTerms.some(t => t.text === 'testing')).toBe(true);
    });

    it('should exclude review metadata from frontmatter indexing', () => {
      const content = `---
title: Test
created: 2025-01-01
last_reviewed: 2025-01-15
review_count: 5
author: Jane
---
Content`;

      const terms = tokenizer.tokenizeDocument(content);
      const frontmatterTerms = terms.filter(t => t.field === IndexField.FRONTMATTER);

      // Should have author but not review metadata
      expect(frontmatterTerms.some(t => t.text === 'jane')).toBe(true);
      expect(frontmatterTerms.some(t => t.text === 'created')).toBe(false);
      expect(frontmatterTerms.some(t => t.text === 'reviewed')).toBe(false);
    });

    it('should handle documents with only frontmatter', () => {
      const content = `---
title: Only Frontmatter
tags: [test]
---`;

      const terms = tokenizer.tokenizeDocument(content);
      expect(terms.length).toBeGreaterThan(0);
    });

    it('should handle malformed frontmatter gracefully', () => {
      const content = `---
title: Test
broken yaml: [unclosed
---
Content`;

      const terms = tokenizer.tokenizeDocument(content);
      // Should still extract content
      const contentTerms = terms.filter(t => t.field === IndexField.CONTENT);
      expect(contentTerms.some(t => t.text === 'content')).toBe(true);
    });
  });

  describe('getUniqueTerms', () => {
    it('should return unique term texts', () => {
      const terms: Term[] = [
        { text: 'hello', position: 0, field: IndexField.CONTENT },
        { text: 'world', position: 1, field: IndexField.CONTENT },
        { text: 'hello', position: 2, field: IndexField.CONTENT },
      ];

      const unique = tokenizer.getUniqueTerms(terms);
      expect(unique).toEqual(['hello', 'world']);
    });

    it('should handle empty array', () => {
      const unique = tokenizer.getUniqueTerms([]);
      expect(unique).toEqual([]);
    });
  });

  describe('groupByField', () => {
    it('should group terms by field', () => {
      const terms: Term[] = [
        { text: 'hello', position: 0, field: IndexField.TITLE },
        { text: 'world', position: 1, field: IndexField.CONTENT },
        { text: 'test', position: 2, field: IndexField.TITLE },
      ];

      const grouped = tokenizer.groupByField(terms);

      expect(grouped.get(IndexField.TITLE)?.length).toBe(2);
      expect(grouped.get(IndexField.CONTENT)?.length).toBe(1);
    });

    it('should handle empty array', () => {
      const grouped = tokenizer.groupByField([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe('getTermFrequencies', () => {
    it('should count term frequencies', () => {
      const terms: Term[] = [
        { text: 'hello', position: 0, field: IndexField.CONTENT },
        { text: 'world', position: 1, field: IndexField.CONTENT },
        { text: 'hello', position: 2, field: IndexField.CONTENT },
        { text: 'hello', position: 3, field: IndexField.CONTENT },
      ];

      const frequencies = tokenizer.getTermFrequencies(terms);

      expect(frequencies.get('hello')).toBe(3);
      expect(frequencies.get('world')).toBe(1);
    });

    it('should handle empty array', () => {
      const frequencies = tokenizer.getTermFrequencies([]);
      expect(frequencies.size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very long terms', () => {
      const longTerm = 'a'.repeat(1000);
      const tokens = tokenizer.tokenize(longTerm);
      expect(tokens).toEqual([longTerm]);
    });

    it('should handle special characters', () => {
      const tokens = tokenizer.tokenize('hello@world.com test#tag');
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should handle unicode characters', () => {
      const tokens = tokenizer.tokenize('café résumé naïve');
      expect(tokens).toContain('café');
      expect(tokens).toContain('résumé');
      expect(tokens).toContain('naïve');
    });

    it('should handle numbers', () => {
      const tokens = tokenizer.tokenize('test123 456test test-789');
      expect(tokens.some(t => t.includes('123'))).toBe(true);
      expect(tokens.some(t => t.includes('456'))).toBe(true);
    });

    it('should handle empty frontmatter', () => {
      const content = `---
---
Content here`;

      const terms = tokenizer.tokenizeDocument(content);
      const contentTerms = terms.filter(t => t.field === IndexField.CONTENT);
      expect(contentTerms.some(t => t.text === 'content')).toBe(true);
    });

    it('should handle frontmatter without closing delimiter', () => {
      const content = `---
title: Test
Content without closing`;

      const terms = tokenizer.tokenizeDocument(content);
      // Should treat entire content as content (no frontmatter)
      expect(terms.some(t => t.text === 'content')).toBe(true);
    });
  });
});
