/**
 * AuthorityScorer unit tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AuthorityScorer,
  DEFAULT_AUTHORITY_CONFIG,
} from '../../../../../src/services/search/index/AuthorityScorer.js';
import type { RecencyScore } from '../../../../../src/services/search/index/RecencyScorer.js';
import type { DocumentMetadata } from '../../../../../src/models/IndexModels.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper: create a minimal RecencyScore */
function makeScore(docId: string, score: number): RecencyScore {
  return {
    docId,
    score,
    termScores: new Map(),
    fieldScores: new Map(),
    originalScore: score,
    boostMultiplier: 1,
  };
}

/** Helper: create minimal DocumentMetadata */
function makeMeta(id: string, vault: string, category: string): DocumentMetadata {
  return {
    id,
    path: `/vault/${category}/${id}.md`,
    category,
    vault,
    lastModified: Date.now(),
    contentLength: 100,
    hash: 'abc',
  };
}

describe('AuthorityScorer', () => {
  describe('curated vault boost', () => {
    it('should add curatedBoost (+5) to all documents in a curated vault', () => {
      const authorities = new Map([['curated-vault', 'curated' as const]]);
      const scorer = new AuthorityScorer(authorities);

      const scores = [makeScore('doc1', 10)];
      const metaMap = new Map([['doc1', makeMeta('doc1', 'curated-vault', 'topic')]]);

      const result = scorer.applyAuthorityBoosts(scores, metaMap);

      expect(result[0].score).toBe(10 + DEFAULT_AUTHORITY_CONFIG.curatedBoost);
      expect(result[0].authorityBoost).toBe(DEFAULT_AUTHORITY_CONFIG.curatedBoost);
      expect(result[0].authorityReason).toContain('curated vault');
    });
  });

  describe('directory boosts for default vault', () => {
    it('should boost topics +5, decisions +3, sessions +1', () => {
      const authorities = new Map([['default-vault', 'default' as const]]);
      const scorer = new AuthorityScorer(authorities);

      const scores = [
        makeScore('topic-doc', 10),
        makeScore('decision-doc', 10),
        makeScore('session-doc', 10),
      ];
      const metaMap = new Map([
        ['topic-doc', makeMeta('topic-doc', 'default-vault', 'topic')],
        ['decision-doc', makeMeta('decision-doc', 'default-vault', 'decision')],
        ['session-doc', makeMeta('session-doc', 'default-vault', 'session')],
      ]);

      const result = scorer.applyAuthorityBoosts(scores, metaMap);

      const topicResult = result.find(r => r.docId === 'topic-doc')!;
      const decisionResult = result.find(r => r.docId === 'decision-doc')!;
      const sessionResult = result.find(r => r.docId === 'session-doc')!;

      expect(topicResult.authorityBoost).toBe(DEFAULT_AUTHORITY_CONFIG.topicsBoost);
      expect(decisionResult.authorityBoost).toBe(DEFAULT_AUTHORITY_CONFIG.decisionsBoost);
      expect(sessionResult.authorityBoost).toBe(DEFAULT_AUTHORITY_CONFIG.sessionsBoost);
    });
  });

  describe('conversational vault boost', () => {
    it('should add conversationalBoost (+1) to documents in a conversational vault', () => {
      const authorities = new Map([['conv-vault', 'conversational' as const]]);
      const scorer = new AuthorityScorer(authorities);

      const scores = [makeScore('doc1', 10)];
      const metaMap = new Map([['doc1', makeMeta('doc1', 'conv-vault', 'topic')]]);

      const result = scorer.applyAuthorityBoosts(scores, metaMap);

      expect(result[0].authorityBoost).toBe(DEFAULT_AUTHORITY_CONFIG.conversationalBoost);
      expect(result[0].authorityReason).toContain('conversational vault');
    });
  });

  describe('disabled scorer', () => {
    it('should return 0 boost when authority scoring is disabled', () => {
      const authorities = new Map([['vault', 'curated' as const]]);
      const scorer = new AuthorityScorer(authorities);
      scorer.disable();

      const scores = [makeScore('doc1', 10)];
      const metaMap = new Map([['doc1', makeMeta('doc1', 'vault', 'topic')]]);

      const result = scorer.applyAuthorityBoosts(scores, metaMap);

      expect(result[0].authorityBoost).toBe(0);
      expect(result[0].score).toBe(10);
    });
  });

  describe('sorting', () => {
    it('should sort results by final score descending', () => {
      const authorities = new Map([['vault', 'default' as const]]);
      const scorer = new AuthorityScorer(authorities);

      const scores = [
        makeScore('session-doc', 20), // 20 + 1 = 21
        makeScore('topic-doc', 10), // 10 + 5 = 15
        makeScore('decision-doc', 25), // 25 + 3 = 28
      ];
      const metaMap = new Map([
        ['session-doc', makeMeta('session-doc', 'vault', 'session')],
        ['topic-doc', makeMeta('topic-doc', 'vault', 'topic')],
        ['decision-doc', makeMeta('decision-doc', 'vault', 'decision')],
      ]);

      const result = scorer.applyAuthorityBoosts(scores, metaMap);

      expect(result[0].docId).toBe('decision-doc');
      expect(result[1].docId).toBe('session-doc');
      expect(result[2].docId).toBe('topic-doc');
    });
  });
});
