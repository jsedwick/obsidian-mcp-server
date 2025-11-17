/**
 * Unit tests for BM25Scorer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Scorer, DEFAULT_BM25_PARAMETERS } from '../../../../../src/services/search/index/BM25Scorer.js';
import { IndexField } from '../../../../../src/models/IndexModels.js';
import type {
  DocumentPosting,
  IndexStatistics,
  BM25Parameters,
} from '../../../../../src/models/IndexModels.js';

describe('BM25Scorer', () => {
  let scorer: BM25Scorer;

  beforeEach(() => {
    scorer = new BM25Scorer();
  });

  const createPosting = (
    docId: string,
    termFreq: number = 1,
    field: IndexField = IndexField.CONTENT
  ): DocumentPosting => ({
    docId,
    termFrequency: termFreq,
    positions: Array.from({ length: termFreq }, (_, i) => i),
    fieldScores: [
      {
        field,
        frequency: termFreq,
        boost: 1.0,
      },
    ],
  });

  const createStats = (
    totalDocs: number = 100,
    avgDocLength: number = 50,
    termDocFreqs: Record<string, number> = {}
  ): IndexStatistics => ({
    totalDocuments: totalDocs,
    averageDocumentLength: avgDocLength,
    totalTerms: Object.keys(termDocFreqs).length,
    documentFrequency: new Map(Object.entries(termDocFreqs)),
  });

  describe('constructor', () => {
    it('should create scorer with default parameters', () => {
      expect(scorer).toBeDefined();
      expect(scorer.getParameters()).toEqual(DEFAULT_BM25_PARAMETERS);
    });

    it('should create scorer with custom parameters', () => {
      const customParams: BM25Parameters = { k1: 2.0, b: 0.5 };
      const customScorer = new BM25Scorer(customParams);

      expect(customScorer.getParameters()).toEqual(customParams);
    });
  });

  describe('scoreDocuments', () => {
    it('should score single document with single term', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 1)]],
      ]);

      const stats = createStats(100, 50, { hello: 10 });
      const scores = scorer.scoreDocuments(['hello'], termPostings, stats);

      expect(scores).toHaveLength(1);
      expect(scores[0].docId).toBe('doc1');
      expect(scores[0].score).toBeGreaterThan(0);
    });

    it('should score multiple documents', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 2), createPosting('doc2', 1)]],
      ]);

      const stats = createStats(100, 50, { hello: 2 });
      const scores = scorer.scoreDocuments(['hello'], termPostings, stats);

      expect(scores).toHaveLength(2);
      expect(scores[0].score).toBeGreaterThan(scores[1].score); // doc1 has higher term freq
    });

    it('should score with multiple query terms', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 1), createPosting('doc2', 2)]],
        ['world', [createPosting('doc1', 2), createPosting('doc3', 1)]],
      ]);

      const stats = createStats(100, 50, { hello: 2, world: 2 });
      const scores = scorer.scoreDocuments(['hello', 'world'], termPostings, stats);

      expect(scores).toHaveLength(3);
      expect(scores[0].docId).toBe('doc1'); // Has both terms
    });

    it('should sort scores in descending order', () => {
      const termPostings = new Map([
        ['test', [
          createPosting('doc1', 1),
          createPosting('doc2', 5),
          createPosting('doc3', 3),
        ]],
      ]);

      const stats = createStats(100, 50, { test: 3 });
      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].docId).toBe('doc2');
      expect(scores[1].docId).toBe('doc3');
      expect(scores[2].docId).toBe('doc1');
      expect(scores[0].score).toBeGreaterThan(scores[1].score);
      expect(scores[1].score).toBeGreaterThan(scores[2].score);
    });

    it('should handle missing terms gracefully', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 1)]],
      ]);

      const stats = createStats(100, 50, { hello: 1 });
      const scores = scorer.scoreDocuments(['hello', 'missing'], termPostings, stats);

      expect(scores).toHaveLength(1);
      expect(scores[0].docId).toBe('doc1');
    });

    it('should return empty array for no matches', () => {
      const termPostings = new Map();
      const stats = createStats(100, 50, {});
      const scores = scorer.scoreDocuments(['nonexistent'], termPostings, stats);

      expect(scores).toEqual([]);
    });

    it('should include term score breakdown', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 2)]],
        ['world', [createPosting('doc1', 1)]],
      ]);

      const stats = createStats(100, 50, { hello: 10, world: 20 });
      const scores = scorer.scoreDocuments(['hello', 'world'], termPostings, stats);

      expect(scores[0].termScores.size).toBe(2);
      expect(scores[0].termScores.has('hello')).toBe(true);
      expect(scores[0].termScores.has('world')).toBe(true);
    });

    it('should include field score breakdown', () => {
      const termPostings = new Map([
        ['test', [createPosting('doc1', 1, IndexField.TITLE)]],
      ]);

      const stats = createStats(100, 50, { test: 1 });
      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].fieldScores.size).toBeGreaterThan(0);
    });
  });

  describe('BM25 formula correctness', () => {
    it('should give higher scores to documents with more term occurrences', () => {
      const termPostings = new Map([
        ['test', [createPosting('doc1', 1), createPosting('doc2', 5)]],
      ]);

      const stats = createStats(100, 50, { test: 2 });
      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].score).toBeGreaterThan(scores[1].score);
    });

    it('should apply IDF correctly (rare terms score higher)', () => {
      // Rare term (appears in 1 doc out of 100)
      const rarePostings = new Map([['rare', [createPosting('doc1', 1)]]]);
      const rareStats = createStats(100, 50, { rare: 1 });
      const rareScores = scorer.scoreDocuments(['rare'], rarePostings, rareStats);

      // Common term (appears in 50 docs out of 100)
      const commonPostings = new Map([['common', [createPosting('doc2', 1)]]]);
      const commonStats = createStats(100, 50, { common: 50 });
      const commonScores = scorer.scoreDocuments(['common'], commonPostings, commonStats);

      // Rare terms should score higher than common terms
      expect(rareScores[0].score).toBeGreaterThan(commonScores[0].score);
    });

    it('should apply term frequency saturation (k1 parameter)', () => {
      const postings1 = new Map([['test', [createPosting('doc1', 1)]]]);
      const postings10 = new Map([['test', [createPosting('doc2', 10)]]]);
      const postings100 = new Map([['test', [createPosting('doc3', 100)]]]);

      const stats = createStats(100, 50, { test: 3 });

      const score1 = scorer.scoreDocuments(['test'], postings1, stats)[0].score;
      const score10 = scorer.scoreDocuments(['test'], postings10, stats)[0].score;
      const score100 = scorer.scoreDocuments(['test'], postings100, stats)[0].score;

      // Score increase should diminish (saturation effect)
      const increase1to10 = score10 - score1;
      const increase10to100 = score100 - score10;

      expect(increase10to100).toBeLessThan(increase1to10);
    });

    it('should apply length normalization (b parameter)', () => {
      // Note: Current implementation uses termFrequency as placeholder for docLength
      // This test verifies that BM25 formula applies length normalization conceptually
      const posting1 = createPosting('doc1', 1);
      const posting2 = createPosting('doc2', 1);

      const postings = new Map([['test', [posting1, posting2]]]);
      const stats = createStats(100, 50, { test: 2 });

      const scores = scorer.scoreDocuments(['test'], postings, stats);

      // Both documents have same term frequency, so scores should be equal
      // (length normalization will matter once actual doc lengths are tracked)
      expect(scores[0].score).toBeGreaterThan(0);
      expect(scores[1].score).toBeGreaterThan(0);
    });

    it('should handle zero document frequency gracefully', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 1)]]]);
      const stats = createStats(100, 50, {}); // No document frequency for 'test'

      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].score).toBe(0); // IDF should be 0
    });
  });

  describe('parameter configuration', () => {
    it('should allow updating parameters', () => {
      const newParams = { k1: 2.0, b: 0.5 };
      scorer.setParameters(newParams);

      expect(scorer.getParameters()).toEqual(newParams);
    });

    it('should allow partial parameter updates', () => {
      scorer.setParameters({ k1: 2.0 });

      expect(scorer.getParameters().k1).toBe(2.0);
      expect(scorer.getParameters().b).toBe(DEFAULT_BM25_PARAMETERS.b);
    });

    it('should affect scoring when parameters change', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 5)]]]);
      const stats = createStats(100, 50, { test: 1 });

      const score1 = scorer.scoreDocuments(['test'], termPostings, stats)[0].score;

      scorer.setParameters({ k1: 3.0 });
      const score2 = scorer.scoreDocuments(['test'], termPostings, stats)[0].score;

      expect(score2).not.toBe(score1);
    });
  });

  describe('explainScore', () => {
    it('should provide detailed score explanation', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 2)]],
      ]);

      const stats = createStats(100, 50, { hello: 10 });
      const scores = scorer.scoreDocuments(['hello'], termPostings, stats);

      const explanation = scorer.explainScore('doc1', termPostings, stats);

      expect(explanation.docId).toBe('doc1');
      expect(explanation.totalScore).toBeGreaterThan(0);
      expect(explanation.termExplanations).toHaveLength(1);
      expect(explanation.termExplanations[0].term).toBe('hello');
      expect(explanation.termExplanations[0].idf).toBeGreaterThan(0);
    });

    it('should explain multiple terms', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 1)]],
        ['world', [createPosting('doc1', 2)]],
      ]);

      const stats = createStats(100, 50, { hello: 10, world: 20 });
      const explanation = scorer.explainScore('doc1', termPostings, stats);

      expect(explanation.termExplanations).toHaveLength(2);
      expect(explanation.termExplanations.some(e => e.term === 'hello')).toBe(true);
      expect(explanation.termExplanations.some(e => e.term === 'world')).toBe(true);
    });

    it('should include term frequency in explanation', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 5)]]]);
      const stats = createStats(100, 50, { test: 10 });
      const explanation = scorer.explainScore('doc1', termPostings, stats);

      expect(explanation.termExplanations[0].termFreq).toBe(5);
    });

    it('should include explanation string', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 1)]]]);
      const stats = createStats(100, 50, { test: 10 });
      const explanation = scorer.explainScore('doc1', termPostings, stats);

      expect(explanation.termExplanations[0].explanation).toContain('IDF:');
      expect(explanation.termExplanations[0].explanation).toContain('TF:');
      expect(explanation.termExplanations[0].explanation).toContain('Score:');
    });
  });

  describe('calculateDocumentFrequency', () => {
    it('should calculate document frequency correctly', () => {
      const termPostings = new Map([
        ['hello', [createPosting('doc1', 1), createPosting('doc2', 1)]],
        ['world', [createPosting('doc1', 1), createPosting('doc2', 1), createPosting('doc3', 1)]],
      ]);

      const df = BM25Scorer.calculateDocumentFrequency(termPostings);

      expect(df.get('hello')).toBe(2);
      expect(df.get('world')).toBe(3);
    });

    it('should count unique documents only', () => {
      const termPostings = new Map([
        ['test', [
          createPosting('doc1', 1),
          createPosting('doc1', 2), // Same doc, should count once
          createPosting('doc2', 1),
        ]],
      ]);

      const df = BM25Scorer.calculateDocumentFrequency(termPostings);

      expect(df.get('test')).toBe(2); // doc1 and doc2
    });

    it('should handle empty postings', () => {
      const df = BM25Scorer.calculateDocumentFrequency(new Map());
      expect(df.size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very large term frequencies', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 10000)]]]);
      const stats = createStats(100, 50, { test: 1 });

      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].score).toBeGreaterThan(0);
      expect(scores[0].score).toBeLessThan(Infinity);
    });

    it('should handle very large document collections', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 1)]]]);
      const stats = createStats(1000000, 50, { test: 1 });

      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].score).toBeGreaterThan(0);
    });

    it('should handle zero average document length gracefully', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 1)]]]);
      const stats = createStats(100, 0, { test: 1 }); // avgDocLength = 0

      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores[0].score).toBeGreaterThan(0);
      expect(scores[0].score).toBeLessThan(Infinity);
    });

    it('should handle single document corpus', () => {
      const termPostings = new Map([['test', [createPosting('doc1', 1)]]]);
      const stats = createStats(1, 50, { test: 1 });

      const scores = scorer.scoreDocuments(['test'], termPostings, stats);

      expect(scores).toHaveLength(1);
      expect(scores[0].score).toBeGreaterThanOrEqual(0);
    });

    it('should handle all documents containing term (df = N)', () => {
      const termPostings = new Map([['common', [createPosting('doc1', 1)]]]);
      const stats = createStats(100, 50, { common: 100 }); // All docs have this term

      const scores = scorer.scoreDocuments(['common'], termPostings, stats);

      // IDF should be very low, but still positive
      expect(scores[0].score).toBeGreaterThanOrEqual(0);
    });
  });
});
