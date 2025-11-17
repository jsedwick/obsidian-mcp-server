/**
 * Unit tests for FieldBooster
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FieldBooster } from '../../../../../src/services/search/index/FieldBooster.js';
import { IndexField, DEFAULT_FIELD_BOOSTS } from '../../../../../src/models/IndexModels.js';
import type { DocumentScore } from '../../../../../src/services/search/index/BM25Scorer.js';

describe('FieldBooster', () => {
  let booster: FieldBooster;

  beforeEach(() => {
    booster = new FieldBooster();
  });

  const createScore = (
    docId: string,
    score: number,
    fieldScores: Array<[IndexField, number]> = []
  ): DocumentScore => ({
    docId,
    score,
    termScores: new Map(),
    fieldScores: new Map(fieldScores),
  });

  describe('constructor', () => {
    it('should create booster with default boosts', () => {
      expect(booster).toBeDefined();
      expect(booster.getBoosts()).toEqual(DEFAULT_FIELD_BOOSTS);
    });

    it('should create booster with custom boosts', () => {
      const customBoosts = {
        [IndexField.TITLE]: 3.0,
        [IndexField.CONTENT]: 1.0,
        [IndexField.TAGS]: 2.0,
        [IndexField.FRONTMATTER]: 1.5,
      };

      const customBooster = new FieldBooster(customBoosts);
      expect(customBooster.getBoosts()).toEqual(customBoosts);
    });
  });

  describe('boostScores', () => {
    it('should boost scores based on field contributions', () => {
      const scores = [
        createScore('doc1', 10, [
          [IndexField.TITLE, 5],
          [IndexField.CONTENT, 5],
        ]),
      ];

      const boosted = booster.boostScores(scores);

      expect(boosted).toHaveLength(1);
      expect(boosted[0].score).toBeGreaterThan(10); // Title boost (2.0x) increases score
    });

    it('should preserve original score', () => {
      const scores = [createScore('doc1', 10, [[IndexField.CONTENT, 10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].originalScore).toBe(10);
    });

    it('should calculate boost multiplier', () => {
      const scores = [
        createScore('doc1', 10, [
          [IndexField.TITLE, 10], // 2.0x boost
        ]),
      ];

      const boosted = booster.boostScores(scores);

      expect(boosted[0].boostMultiplier).toBeCloseTo(2.0, 1);
    });

    it('should identify primary field', () => {
      const scores = [
        createScore('doc1', 10, [
          [IndexField.TITLE, 8],
          [IndexField.CONTENT, 2],
        ]),
      ];

      const boosted = booster.boostScores(scores);

      expect(boosted[0].primaryField).toBe(IndexField.TITLE);
    });

    it('should handle multiple documents', () => {
      const scores = [
        createScore('doc1', 10, [[IndexField.TITLE, 10]]),
        createScore('doc2', 10, [[IndexField.CONTENT, 10]]),
      ];

      const boosted = booster.boostScores(scores);

      expect(boosted).toHaveLength(2);
      expect(boosted[0].docId).toBe('doc1'); // Title boost should make it score higher
    });

    it('should re-sort by boosted score', () => {
      const scores = [
        createScore('doc1', 20, [[IndexField.CONTENT, 20]]),
        createScore('doc2', 10, [[IndexField.TITLE, 10]]),
      ];

      const boosted = booster.boostScores(scores);

      // doc2 with title boost (10 * 2.0 = 20) should equal doc1
      expect(boosted[0].score).toBeGreaterThanOrEqual(boosted[1].score);
    });

    it('should handle empty field scores', () => {
      const scores = [createScore('doc1', 10, [])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBe(10); // Original score preserved
    });
  });

  describe('field boost values', () => {
    it('should apply correct boost for title field', () => {
      const scores = [createScore('doc1', 10, [[IndexField.TITLE, 10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeCloseTo(20, 1); // 10 * 2.0
    });

    it('should apply correct boost for tags field', () => {
      const scores = [createScore('doc1', 10, [[IndexField.TAGS, 10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeCloseTo(15, 1); // 10 * 1.5
    });

    it('should apply correct boost for frontmatter field', () => {
      const scores = [createScore('doc1', 10, [[IndexField.FRONTMATTER, 10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeCloseTo(12, 1); // 10 * 1.2
    });

    it('should apply correct boost for content field', () => {
      const scores = [createScore('doc1', 10, [[IndexField.CONTENT, 10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeCloseTo(10, 1); // 10 * 1.0
    });
  });

  describe('calculateEffectiveBoost', () => {
    it('should calculate effective boost for single field', () => {
      const fieldScores = new Map([[IndexField.TITLE, 10]]);
      const effectiveBoost = booster.calculateEffectiveBoost(fieldScores);

      expect(effectiveBoost).toBeCloseTo(2.0, 2);
    });

    it('should calculate weighted average for multiple fields', () => {
      const fieldScores = new Map([
        [IndexField.TITLE, 5], // 2.0x
        [IndexField.CONTENT, 5], // 1.0x
      ]);

      const effectiveBoost = booster.calculateEffectiveBoost(fieldScores);

      expect(effectiveBoost).toBeCloseTo(1.5, 2); // Average of 2.0 and 1.0
    });

    it('should weight by field score contribution', () => {
      const fieldScores = new Map([
        [IndexField.TITLE, 9], // 2.0x, 90% of score
        [IndexField.CONTENT, 1], // 1.0x, 10% of score
      ]);

      const effectiveBoost = booster.calculateEffectiveBoost(fieldScores);

      expect(effectiveBoost).toBeGreaterThan(1.8); // Heavily weighted toward title
    });

    it('should handle empty field scores', () => {
      const effectiveBoost = booster.calculateEffectiveBoost(new Map());
      expect(effectiveBoost).toBe(1.0);
    });
  });

  describe('getBoost', () => {
    it('should return boost for each field', () => {
      expect(booster.getBoost(IndexField.TITLE)).toBe(2.0);
      expect(booster.getBoost(IndexField.TAGS)).toBe(1.5);
      expect(booster.getBoost(IndexField.FRONTMATTER)).toBe(1.2);
      expect(booster.getBoost(IndexField.CONTENT)).toBe(1.0);
    });
  });

  describe('setBoosts', () => {
    it('should update all boosts', () => {
      const newBoosts = {
        [IndexField.TITLE]: 3.0,
        [IndexField.CONTENT]: 1.5,
        [IndexField.TAGS]: 2.5,
        [IndexField.FRONTMATTER]: 2.0,
      };

      booster.setBoosts(newBoosts);
      expect(booster.getBoosts()).toEqual(newBoosts);
    });

    it('should allow partial updates', () => {
      booster.setBoosts({ [IndexField.TITLE]: 3.0 });

      expect(booster.getBoost(IndexField.TITLE)).toBe(3.0);
      expect(booster.getBoost(IndexField.CONTENT)).toBe(DEFAULT_FIELD_BOOSTS[IndexField.CONTENT]);
    });

    it('should affect subsequent scoring', () => {
      const scores = [createScore('doc1', 10, [[IndexField.TITLE, 10]])];
      const boosted1 = booster.boostScores(scores);

      booster.setBoosts({ [IndexField.TITLE]: 4.0 });
      const boosted2 = booster.boostScores(scores);

      expect(boosted2[0].score).toBeGreaterThan(boosted1[0].score);
    });
  });

  describe('resetToDefaults', () => {
    it('should reset to default boosts', () => {
      booster.setBoosts({ [IndexField.TITLE]: 5.0 });
      booster.resetToDefaults();

      expect(booster.getBoosts()).toEqual(DEFAULT_FIELD_BOOSTS);
    });
  });

  describe('compareFields', () => {
    it('should compare field importance', () => {
      expect(booster.compareFields(IndexField.TITLE, IndexField.CONTENT)).toBeGreaterThan(0);
      expect(booster.compareFields(IndexField.CONTENT, IndexField.TITLE)).toBeLessThan(0);
      expect(booster.compareFields(IndexField.CONTENT, IndexField.CONTENT)).toBe(0);
    });
  });

  describe('getFieldsByImportance', () => {
    it('should return fields sorted by boost value', () => {
      const fields = booster.getFieldsByImportance();

      expect(fields[0]).toBe(IndexField.TITLE); // Highest boost
      expect(fields[fields.length - 1]).toBe(IndexField.CONTENT); // Lowest boost
    });

    it('should reflect custom boosts', () => {
      booster.setBoosts({ [IndexField.CONTENT]: 5.0 });
      const fields = booster.getFieldsByImportance();

      expect(fields[0]).toBe(IndexField.CONTENT);
    });
  });

  describe('getScoreDistribution', () => {
    it('should calculate percentage contribution by field', () => {
      const score = createScore('doc1', 30, [
        [IndexField.TITLE, 10], // 10 * 2.0 = 20 (66.7%)
        [IndexField.CONTENT, 10], // 10 * 1.0 = 10 (33.3%)
      ]);

      const boosted = booster.boostScores([score])[0];
      const distribution = booster.getScoreDistribution(boosted);

      expect(distribution.get(IndexField.TITLE)).toBeCloseTo(66.7, 0);
      expect(distribution.get(IndexField.CONTENT)).toBeCloseTo(33.3, 0);
    });

    it('should handle zero total score', () => {
      const score = createScore('doc1', 0, []);
      const boosted = booster.boostScores([score])[0];
      const distribution = booster.getScoreDistribution(boosted);

      expect(distribution.size).toBe(0);
    });
  });

  describe('explainBoost', () => {
    it('should generate readable explanation', () => {
      const score = createScore('doc1', 10, [
        [IndexField.TITLE, 5],
        [IndexField.CONTENT, 5],
      ]);

      const boosted = booster.boostScores([score])[0];
      const explanation = booster.explainBoost(boosted);

      expect(explanation).toContain('doc1');
      expect(explanation).toContain('Original Score:');
      expect(explanation).toContain('Boosted Score:');
      expect(explanation).toContain('Boost Multiplier:');
    });

    it('should include primary field', () => {
      const score = createScore('doc1', 10, [[IndexField.TITLE, 10]]);
      const boosted = booster.boostScores([score])[0];
      const explanation = booster.explainBoost(boosted);

      expect(explanation).toContain('Primary Field:');
      expect(explanation).toContain('title');
    });

    it('should include field breakdown', () => {
      const score = createScore('doc1', 10, [
        [IndexField.TITLE, 5],
        [IndexField.TAGS, 5],
      ]);

      const boosted = booster.boostScores([score])[0];
      const explanation = booster.explainBoost(boosted);

      expect(explanation).toContain('Field Breakdown:');
      expect(explanation).toContain('title:');
      expect(explanation).toContain('tags:');
    });
  });

  describe('edge cases', () => {
    it('should handle very large boost multipliers', () => {
      booster.setBoosts({ [IndexField.TITLE]: 100.0 });
      const scores = [createScore('doc1', 1, [[IndexField.TITLE, 1]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeCloseTo(100, 1);
    });

    it('should handle very small boosts', () => {
      booster.setBoosts({ [IndexField.CONTENT]: 0.1 });
      const scores = [createScore('doc1', 10, [[IndexField.CONTENT, 10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeCloseTo(1, 1); // 10 * 0.1 = 1
    });

    it('should handle negative field scores', () => {
      const scores = [createScore('doc1', -10, [[IndexField.CONTENT, -10]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeLessThanOrEqual(0);
    });

    it('should handle very small scores', () => {
      const scores = [createScore('doc1', 0.0001, [[IndexField.TITLE, 0.0001]])];
      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeGreaterThan(0);
    });

    it('should handle mixed positive and negative field contributions', () => {
      const scores = [
        createScore('doc1', 0, [
          [IndexField.TITLE, 10],
          [IndexField.CONTENT, -10],
        ]),
      ];

      const boosted = booster.boostScores(scores);

      expect(boosted[0].score).toBeGreaterThan(0); // Title boost should dominate
    });
  });
});
