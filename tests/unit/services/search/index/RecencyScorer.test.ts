/**
 * Unit tests for RecencyScorer
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RecencyScorer,
  DEFAULT_RECENCY_CONFIG,
  type RecencyConfig,
} from '../../../../../src/services/search/index/RecencyScorer.js';
import { IndexField } from '../../../../../src/models/IndexModels.js';
import type { BoostedScore } from '../../../../../src/services/search/index/FieldBooster.js';
import type { DocumentMetadata } from '../../../../../src/models/IndexModels.js';

describe('RecencyScorer', () => {
  let scorer: RecencyScorer;

  beforeEach(() => {
    scorer = new RecencyScorer();
    // Mock Date.now() to a fixed timestamp for consistent testing
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  const createBoostedScore = (
    docId: string,
    score: number,
    fieldScores: Array<[IndexField, number]> = []
  ): BoostedScore => ({
    docId,
    score,
    termScores: new Map(),
    fieldScores: new Map(fieldScores),
    originalScore: score,
    boostMultiplier: 1.0,
  });

  const createMetadata = (
    lastModified: number,
    lastReviewed?: string
  ): DocumentMetadata => ({
    filePath: '/test/doc.md',
    title: 'Test Doc',
    size: 1000,
    created: Date.now() - 365 * 24 * 60 * 60 * 1000,
    lastModified,
    frontmatter: lastReviewed ? { last_reviewed: lastReviewed } : {},
  });

  describe('constructor', () => {
    it('should create scorer with default config', () => {
      expect(scorer).toBeDefined();
      expect(scorer.getConfig()).toEqual(DEFAULT_RECENCY_CONFIG);
    });

    it('should create scorer with custom config', () => {
      const customConfig: RecencyConfig = {
        enableModificationBoost: false,
        enableReviewBoost: true,
        modificationWindow: 14 * 24 * 60 * 60 * 1000,
        modificationBoost: 5,
        reviewWindow: 60 * 24 * 60 * 60 * 1000,
        reviewBoost: 3,
      };

      const customScorer = new RecencyScorer(customConfig);
      expect(customScorer.getConfig()).toEqual(customConfig);
    });
  });

  describe('applyRecencyBoosts', () => {
    it('should boost recently modified documents', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map([['doc1', createMetadata(recentTime)]]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted[0].score).toBe(12); // 10 + 2 (modification boost)
      expect(boosted[0].recencyBoost).toBe(2);
      expect(boosted[0].daysSinceModified).toBeCloseTo(3, 1);
    });

    it('should boost recently reviewed topics', () => {
      const recentReview = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map([
        ['doc1', createMetadata(Date.now() - 100 * 24 * 60 * 60 * 1000, recentReview)],
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted[0].score).toBe(11); // 10 + 1 (review boost)
      expect(boosted[0].recencyBoost).toBe(1);
      expect(boosted[0].daysSinceReviewed).toBeCloseTo(15, 1);
    });

    it('should apply both modification and review boosts', () => {
      const recentTime = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const recentReview = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map([['doc1', createMetadata(recentTime, recentReview)]]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted[0].score).toBe(13); // 10 + 2 (mod) + 1 (review)
      expect(boosted[0].recencyBoost).toBe(3);
      expect(boosted[0].recencyReason).toContain('Modified 2 days ago');
      expect(boosted[0].recencyReason).toContain('Reviewed 10 days ago');
    });

    it('should not boost old documents', () => {
      const oldTime = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map([['doc1', createMetadata(oldTime)]]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted[0].score).toBe(10); // No boost
      expect(boosted[0].recencyBoost).toBe(0);
    });

    it('should handle missing metadata gracefully', () => {
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map();

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted[0].score).toBe(10);
      expect(boosted[0].recencyBoost).toBe(0);
    });

    it('should re-sort by final score', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const oldTime = Date.now() - 365 * 24 * 60 * 60 * 1000;

      const scores = [
        createBoostedScore('doc1', 10), // Old, will stay at 10
        createBoostedScore('doc2', 8), // Recent, will become 10 (8+2)
      ];

      const metadataMap = new Map([
        ['doc1', createMetadata(oldTime)],
        ['doc2', createMetadata(recentTime)],
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted[0].docId).toBe('doc1'); // Tied at 10, but doc1 was originally higher
      expect(boosted[1].docId).toBe('doc2');
    });

    it('should handle multiple documents', () => {
      const scores = [
        createBoostedScore('doc1', 10),
        createBoostedScore('doc2', 15),
        createBoostedScore('doc3', 5),
      ];

      const metadataMap = new Map([
        ['doc1', createMetadata(Date.now() - 3 * 24 * 60 * 60 * 1000)],
        ['doc2', createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000)],
        ['doc3', createMetadata(Date.now() - 1 * 24 * 60 * 60 * 1000)],
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);

      expect(boosted).toHaveLength(3);
      expect(boosted[0].docId).toBe('doc2'); // 15 (no boost)
      expect(boosted[1].docId).toBe('doc1'); // 12 (10 + 2)
      expect(boosted[2].docId).toBe('doc3'); // 7 (5 + 2)
    });
  });

  describe('calculateRecencyBoost', () => {
    it('should calculate modification boost', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(recentTime);

      const boost = scorer.calculateRecencyBoost(metadata);

      expect(boost).toBe(2);
    });

    it('should calculate review boost', () => {
      const recentReview = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const metadata = createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000, recentReview);

      const boost = scorer.calculateRecencyBoost(metadata);

      expect(boost).toBe(1);
    });

    it('should calculate combined boost', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const recentReview = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const metadata = createMetadata(recentTime, recentReview);

      const boost = scorer.calculateRecencyBoost(metadata);

      expect(boost).toBe(3); // 2 + 1
    });

    it('should return 0 for old documents', () => {
      const oldTime = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(oldTime);

      const boost = scorer.calculateRecencyBoost(metadata);

      expect(boost).toBe(0);
    });

    it('should handle invalid review date', () => {
      const metadata = createMetadata(Date.now(), 'invalid-date');

      const boost = scorer.calculateRecencyBoost(metadata);

      expect(boost).toBe(2); // Only modification boost
    });
  });

  describe('configuration', () => {
    it('should allow updating config', () => {
      const newConfig: Partial<RecencyConfig> = {
        modificationBoost: 5,
        reviewBoost: 3,
      };

      scorer.setConfig(newConfig);

      expect(scorer.getConfig().modificationBoost).toBe(5);
      expect(scorer.getConfig().reviewBoost).toBe(3);
      expect(scorer.getConfig().enableModificationBoost).toBe(
        DEFAULT_RECENCY_CONFIG.enableModificationBoost
      );
    });

    it('should affect boost calculation after config update', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(recentTime);

      const boost1 = scorer.calculateRecencyBoost(metadata);

      scorer.setConfig({ modificationBoost: 10 });
      const boost2 = scorer.calculateRecencyBoost(metadata);

      expect(boost2).toBeGreaterThan(boost1);
      expect(boost2).toBe(10);
    });

    it('should disable all boosts', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(recentTime);

      scorer.disable();

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(0);
    });

    it('should enable all boosts', () => {
      scorer.disable();
      scorer.enable();

      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(recentTime);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBeGreaterThan(0);
    });

    it('should allow disabling modification boost only', () => {
      scorer.setConfig({ enableModificationBoost: false });

      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const recentReview = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const metadata = createMetadata(recentTime, recentReview);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(1); // Only review boost
    });

    it('should allow disabling review boost only', () => {
      scorer.setConfig({ enableReviewBoost: false });

      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const recentReview = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const metadata = createMetadata(recentTime, recentReview);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(2); // Only modification boost
    });
  });

  describe('wouldBoost', () => {
    it('should return true for recent documents', () => {
      const recentTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(recentTime);

      expect(scorer.wouldBoost(metadata)).toBe(true);
    });

    it('should return false for old documents', () => {
      const oldTime = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const metadata = createMetadata(oldTime);

      expect(scorer.wouldBoost(metadata)).toBe(false);
    });

    it('should return true for recently reviewed', () => {
      const recentReview = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const metadata = createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000, recentReview);

      expect(scorer.wouldBoost(metadata)).toBe(true);
    });
  });

  describe('getRecentDocuments', () => {
    it('should filter recent documents', () => {
      const metadataList = [
        createMetadata(Date.now() - 3 * 24 * 60 * 60 * 1000), // Recent
        createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000), // Old
        createMetadata(Date.now() - 1 * 24 * 60 * 60 * 1000), // Recent
      ];

      const recent = scorer.getRecentDocuments(metadataList);

      expect(recent).toHaveLength(2);
    });

    it('should return empty for all old documents', () => {
      const metadataList = [
        createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000),
        createMetadata(Date.now() - 400 * 24 * 60 * 60 * 1000),
      ];

      const recent = scorer.getRecentDocuments(metadataList);

      expect(recent).toHaveLength(0);
    });
  });

  describe('explainRecency', () => {
    it('should generate readable explanation', () => {
      const scores = [createBoostedScore('doc1', 13)];
      const metadataMap = new Map([
        [
          'doc1',
          createMetadata(
            Date.now() - 2 * 24 * 60 * 60 * 1000,
            new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
          ),
        ],
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap)[0];
      const explanation = scorer.explainRecency(boosted);

      expect(explanation).toContain('doc1');
      expect(explanation).toContain('Score before recency:');
      expect(explanation).toContain('Recency boost:');
      expect(explanation).toContain('Final score:');
      expect(explanation).toContain('Days since modified:');
      expect(explanation).toContain('Days since reviewed:');
      expect(explanation).toContain('Reason:');
    });

    it('should handle no recency boost', () => {
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map([
        ['doc1', createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000)],
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap)[0];
      const explanation = scorer.explainRecency(boosted);

      expect(explanation).toContain('Recency boost: +0.0000');
    });
  });

  describe('getStatistics', () => {
    it('should calculate statistics on recency boosts', () => {
      const scores = [
        createBoostedScore('doc1', 12),
        createBoostedScore('doc2', 10),
        createBoostedScore('doc3', 13),
      ];

      const metadataMap = new Map([
        ['doc1', createMetadata(Date.now() - 2 * 24 * 60 * 60 * 1000)], // +2
        ['doc2', createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000)], // +0
        [
          'doc3',
          createMetadata(
            Date.now() - 3 * 24 * 60 * 60 * 1000,
            new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
          ),
        ], // +3
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);
      const stats = scorer.getStatistics(boosted);

      expect(stats.totalDocuments).toBe(3);
      expect(stats.boostedDocuments).toBe(2); // doc1 and doc3
      expect(stats.averageBoost).toBeCloseTo(2.5, 1); // (2 + 3) / 2
      expect(stats.maxBoost).toBe(3);
      expect(stats.modificationBoosts).toBe(2); // doc1 and doc3
      expect(stats.reviewBoosts).toBe(1); // doc3 only
    });

    it('should handle no boosts', () => {
      const scores = [createBoostedScore('doc1', 10)];
      const metadataMap = new Map([
        ['doc1', createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000)],
      ]);

      const boosted = scorer.applyRecencyBoosts(scores, metadataMap);
      const stats = scorer.getStatistics(boosted);

      expect(stats.boostedDocuments).toBe(0);
      expect(stats.averageBoost).toBe(0);
      expect(stats.maxBoost).toBe(0);
    });
  });

  describe('time window boundaries', () => {
    it('should boost just inside 7 day window', () => {
      const justInside = Date.now() - 7 * 24 * 60 * 60 * 1000 + 1000; // 7 days - 1 second
      const metadata = createMetadata(justInside);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(2);
    });

    it('should not boost just outside 7 day window', () => {
      const justOutside = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000; // 7 days + 1 second
      const metadata = createMetadata(justOutside);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(0);
    });

    it('should boost review just inside 30 day window', () => {
      const justInside = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 1000).toISOString();
      const metadata = createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000, justInside);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(1);
    });

    it('should not boost review just outside 30 day window', () => {
      const justOutside = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000).toISOString();
      const metadata = createMetadata(Date.now() - 365 * 24 * 60 * 60 * 1000, justOutside);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very recent documents (now)', () => {
      const metadata = createMetadata(Date.now());

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(2);
    });

    it('should handle future timestamps gracefully', () => {
      const futureTime = Date.now() + 24 * 60 * 60 * 1000;
      const metadata = createMetadata(futureTime);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(2); // Should still boost
    });

    it('should handle very old documents', () => {
      const veryOld = Date.now() - 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
      const metadata = createMetadata(veryOld);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(0);
    });

    it('should handle zero timestamp', () => {
      const metadata = createMetadata(0);

      const boost = scorer.calculateRecencyBoost(metadata);
      expect(boost).toBe(0);
    });

    it('should handle custom time windows', () => {
      scorer.setConfig({
        modificationWindow: 1 * 24 * 60 * 60 * 1000, // 1 day
        reviewWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const fiveDaysAgoReview = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      const metadata = createMetadata(twoDaysAgo, fiveDaysAgoReview);
      const boost = scorer.calculateRecencyBoost(metadata);

      expect(boost).toBe(1); // Only review boost applies with custom windows
    });
  });
});
