/**
 * Unit tests for InvertedIndex
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InvertedIndex } from '../../../../../src/services/search/index/InvertedIndex.js';
import { IndexField } from '../../../../../src/models/IndexModels.js';
import type { DocumentPosting } from '../../../../../src/models/IndexModels.js';

describe('InvertedIndex', () => {
  let index: InvertedIndex;

  beforeEach(() => {
    index = new InvertedIndex();
  });

  const createPosting = (docId: string, frequency = 1): DocumentPosting => ({
    docId,
    termFrequency: frequency,
    positions: Array.from({ length: frequency }, (_, i) => i),
    fieldScores: [{
      field: IndexField.CONTENT,
      frequency,
      boost: 1.0,
    }],
  });

  describe('constructor', () => {
    it('should create an empty index', () => {
      expect(index.getTermCount()).toBe(0);
      expect(index.getAllTerms()).toEqual([]);
    });
  });

  describe('addTerm', () => {
    it('should add a new term', () => {
      index.addTerm('hello', createPosting('doc1'));

      expect(index.getTermCount()).toBe(1);
      expect(index.hasTerm('hello')).toBe(true);
    });

    it('should handle empty term gracefully', () => {
      index.addTerm('', createPosting('doc1'));

      expect(index.getTermCount()).toBe(0);
    });

    it('should add posting to existing term', () => {
      index.addTerm('world', createPosting('doc1'));
      index.addTerm('world', createPosting('doc2'));

      const postings = index.getPostings('world');
      expect(postings).toHaveLength(2);
      expect(postings.map(p => p.docId)).toEqual(['doc1', 'doc2']);
    });

    it('should update posting if document already exists', () => {
      index.addTerm('test', createPosting('doc1', 1));
      index.addTerm('test', createPosting('doc1', 3));

      const postings = index.getPostings('test');
      expect(postings).toHaveLength(1);
      // Term frequencies are added together (1 + 3 = 4)
      expect(postings[0].termFrequency).toBe(4);
    });

    it('should handle multiple different terms', () => {
      index.addTerm('apple', createPosting('doc1'));
      index.addTerm('banana', createPosting('doc2'));
      index.addTerm('cherry', createPosting('doc3'));

      expect(index.getTermCount()).toBe(3);
      expect(index.hasTerm('apple')).toBe(true);
      expect(index.hasTerm('banana')).toBe(true);
      expect(index.hasTerm('cherry')).toBe(true);
    });
  });

  describe('getPostings', () => {
    beforeEach(() => {
      index.addTerm('search', createPosting('doc1'));
      index.addTerm('search', createPosting('doc2'));
    });

    it('should return all postings for a term', () => {
      const postings = index.getPostings('search');

      expect(postings).toHaveLength(2);
      expect(postings[0].docId).toBe('doc1');
      expect(postings[1].docId).toBe('doc2');
    });

    it('should return empty array for non-existent term', () => {
      expect(index.getPostings('missing')).toEqual([]);
    });

    it('should handle empty string', () => {
      expect(index.getPostings('')).toEqual([]);
    });
  });

  describe('removeTerm', () => {
    beforeEach(() => {
      index.addTerm('remove', createPosting('doc1'));
      index.addTerm('remove', createPosting('doc2'));
      index.addTerm('remove', createPosting('doc3'));
    });

    it('should remove a posting for a document', () => {
      const removed = index.removeTerm('remove', 'doc2');

      expect(removed).toBe(true);

      const postings = index.getPostings('remove');
      expect(postings).toHaveLength(2);
      expect(postings.map(p => p.docId)).toEqual(['doc1', 'doc3']);
    });

    it('should return false if term does not exist', () => {
      const removed = index.removeTerm('missing', 'doc1');
      expect(removed).toBe(false);
    });

    it('should return false if document not in term', () => {
      const removed = index.removeTerm('remove', 'doc999');
      expect(removed).toBe(false);
    });

    it('should clean up term when no postings remain', () => {
      index.removeTerm('remove', 'doc1');
      index.removeTerm('remove', 'doc2');
      index.removeTerm('remove', 'doc3');

      expect(index.hasTerm('remove')).toBe(false);
      expect(index.getTermCount()).toBe(0);
    });

    it('should clean up trie nodes with no children', () => {
      index.addTerm('cat', createPosting('doc1'));
      index.addTerm('car', createPosting('doc1'));

      // Remove 'cat', should clean up 't' node but keep 'c', 'a', 'r'
      index.removeTerm('cat', 'doc1');

      expect(index.hasTerm('cat')).toBe(false);
      expect(index.hasTerm('car')).toBe(true);
    });
  });

  describe('removeDocument', () => {
    beforeEach(() => {
      index.addTerm('alpha', createPosting('doc1'));
      index.addTerm('beta', createPosting('doc1'));
      index.addTerm('gamma', createPosting('doc1'));
      index.addTerm('alpha', createPosting('doc2'));
    });

    it('should remove all terms for a document', () => {
      const removedCount = index.removeDocument('doc1');

      expect(removedCount).toBe(3);
      expect(index.getPostings('alpha')).toHaveLength(1);
      expect(index.getPostings('alpha')[0].docId).toBe('doc2');
      expect(index.hasTerm('beta')).toBe(false);
      expect(index.hasTerm('gamma')).toBe(false);
    });

    it('should return 0 if document has no terms', () => {
      const removedCount = index.removeDocument('doc999');
      expect(removedCount).toBe(0);
    });
  });

  describe('getTermsWithPrefix', () => {
    beforeEach(() => {
      index.addTerm('cat', createPosting('doc1'));
      index.addTerm('car', createPosting('doc2'));
      index.addTerm('card', createPosting('doc3'));
      index.addTerm('dog', createPosting('doc4'));
    });

    it('should return all terms with prefix', () => {
      const terms = index.getTermsWithPrefix('ca');

      expect(terms).toHaveLength(3);
      expect(terms.sort()).toEqual(['car', 'card', 'cat']);
    });

    it('should return empty array for non-matching prefix', () => {
      const terms = index.getTermsWithPrefix('xyz');
      expect(terms).toEqual([]);
    });

    it('should return empty array for empty prefix', () => {
      const terms = index.getTermsWithPrefix('');
      expect(terms).toEqual([]);
    });

    it('should handle exact match', () => {
      const terms = index.getTermsWithPrefix('dog');
      expect(terms).toEqual(['dog']);
    });
  });

  describe('hasTerm', () => {
    beforeEach(() => {
      index.addTerm('exists', createPosting('doc1'));
    });

    it('should return true for existing term', () => {
      expect(index.hasTerm('exists')).toBe(true);
    });

    it('should return false for non-existent term', () => {
      expect(index.hasTerm('missing')).toBe(false);
    });
  });

  describe('getTermCount', () => {
    it('should return 0 for empty index', () => {
      expect(index.getTermCount()).toBe(0);
    });

    it('should return correct count', () => {
      index.addTerm('one', createPosting('doc1'));
      index.addTerm('two', createPosting('doc2'));
      index.addTerm('three', createPosting('doc3'));

      expect(index.getTermCount()).toBe(3);
    });

    it('should not double-count terms with multiple postings', () => {
      index.addTerm('shared', createPosting('doc1'));
      index.addTerm('shared', createPosting('doc2'));
      index.addTerm('shared', createPosting('doc3'));

      expect(index.getTermCount()).toBe(1);
    });
  });

  describe('getAllTerms', () => {
    beforeEach(() => {
      index.addTerm('alpha', createPosting('doc1'));
      index.addTerm('beta', createPosting('doc2'));
      index.addTerm('alpha', createPosting('doc3'));
    });

    it('should return all terms and postings', () => {
      const terms = index.getAllTerms();

      expect(terms).toHaveLength(2);

      const alpha = terms.find(([term]) => term === 'alpha');
      expect(alpha).toBeDefined();
      expect(alpha![1]).toHaveLength(2);

      const beta = terms.find(([term]) => term === 'beta');
      expect(beta).toBeDefined();
      expect(beta![1]).toHaveLength(1);
    });
  });

  describe('getDocumentFrequency', () => {
    beforeEach(() => {
      index.addTerm('common', createPosting('doc1'));
      index.addTerm('common', createPosting('doc2'));
      index.addTerm('common', createPosting('doc3'));
      index.addTerm('rare', createPosting('doc1'));
    });

    it('should return correct document frequency', () => {
      expect(index.getDocumentFrequency('common')).toBe(3);
      expect(index.getDocumentFrequency('rare')).toBe(1);
    });

    it('should return 0 for non-existent term', () => {
      expect(index.getDocumentFrequency('missing')).toBe(0);
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      index.addTerm('term1', createPosting('doc1'));
      index.addTerm('term2', createPosting('doc2'));
    });

    it('should clear all terms', () => {
      index.clear();

      expect(index.getTermCount()).toBe(0);
      expect(index.getAllTerms()).toEqual([]);
      expect(index.hasTerm('term1')).toBe(false);
    });
  });

  describe('toJSON and fromJSON', () => {
    beforeEach(() => {
      index.addTerm('serialize', createPosting('doc1', 2));
      index.addTerm('serialize', createPosting('doc2', 1));
      index.addTerm('test', createPosting('doc1', 3));
    });

    it('should serialize index to JSON', () => {
      const json = index.toJSON();

      expect(json).toHaveProperty('root');
      expect(json).toHaveProperty('termCount');
      expect(json.termCount).toBe(2);
    });

    it('should deserialize index from JSON', () => {
      const json = index.toJSON();
      const restored = InvertedIndex.fromJSON(json);

      expect(restored.getTermCount()).toBe(2);
      expect(restored.hasTerm('serialize')).toBe(true);
      expect(restored.hasTerm('test')).toBe(true);

      const postings = restored.getPostings('serialize');
      expect(postings).toHaveLength(2);
      expect(postings.map(p => p.docId).sort()).toEqual(['doc1', 'doc2']);
    });

    it('should preserve posting details', () => {
      const json = index.toJSON();
      const restored = InvertedIndex.fromJSON(json);

      const postings = restored.getPostings('test');
      expect(postings).toHaveLength(1);
      expect(postings[0].docId).toBe('doc1');
      expect(postings[0].termFrequency).toBe(3);
      expect(postings[0].positions).toEqual([0, 1, 2]);
    });
  });

  describe('getMemoryUsage', () => {
    it('should return positive memory estimate', () => {
      const memory = index.getMemoryUsage();
      expect(memory).toBeGreaterThan(0);
    });

    it('should increase with more terms', () => {
      const baseMemory = index.getMemoryUsage();

      for (let i = 0; i < 100; i++) {
        index.addTerm(`term${i}`, createPosting('doc1'));
      }

      const newMemory = index.getMemoryUsage();
      expect(newMemory).toBeGreaterThan(baseMemory);
    });
  });

  describe('getStatistics', () => {
    beforeEach(() => {
      index.addTerm('term1', createPosting('doc1'));
      index.addTerm('term1', createPosting('doc2'));
      index.addTerm('term2', createPosting('doc1'));
    });

    it('should return accurate statistics', () => {
      const stats = index.getStatistics();

      expect(stats.termCount).toBe(2);
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.avgPostingsPerTerm).toBe(1.5); // 3 total postings / 2 terms
    });

    it('should handle empty index', () => {
      const emptyIndex = new InvertedIndex();
      const stats = emptyIndex.getStatistics();

      expect(stats.termCount).toBe(0);
      expect(stats.avgPostingsPerTerm).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle single character terms', () => {
      index.addTerm('a', createPosting('doc1'));
      expect(index.hasTerm('a')).toBe(true);
    });

    it('should handle long terms', () => {
      const longTerm = 'a'.repeat(1000);
      index.addTerm(longTerm, createPosting('doc1'));
      expect(index.hasTerm(longTerm)).toBe(true);
    });

    it('should handle many documents for single term', () => {
      for (let i = 0; i < 1000; i++) {
        index.addTerm('popular', createPosting(`doc${i}`));
      }

      expect(index.getDocumentFrequency('popular')).toBe(1000);
    });

    it('should handle case-sensitive terms', () => {
      index.addTerm('Test', createPosting('doc1'));
      index.addTerm('test', createPosting('doc2'));

      // Terms are different (case-sensitive)
      expect(index.getTermCount()).toBe(2);
      expect(index.getPostings('Test')).toHaveLength(1);
      expect(index.getPostings('test')).toHaveLength(1);
    });
  });
});
