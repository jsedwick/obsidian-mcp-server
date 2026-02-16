import { describe, it, expect } from 'vitest';
import { submitTopicReviews } from '../../../../src/tools/review/submitTopicReviews.js';
import type { TopicReviewAssessment } from '../../../../src/tools/review/submitTopicReviews.js';

function makeReview(overrides?: Partial<TopicReviewAssessment>): TopicReviewAssessment {
  return {
    topic_slug: 'test-topic',
    technical_accuracy: 'verified',
    completeness: 'adequate',
    organization: 'excellent',
    redundancy_check: 'no_duplicates',
    outcome: 'current',
    issues_found: [],
    updates_needed: [],
    ...overrides,
  };
}

describe('submitTopicReviews', () => {
  const context = { vaultPath: '/tmp/test-vault' };

  describe('rubber-stamp detection', () => {
    it('should reject when all topics marked current (>2 reviews)', () => {
      const reviews = [
        makeReview({ topic_slug: 'topic-1' }),
        makeReview({ topic_slug: 'topic-2' }),
        makeReview({ topic_slug: 'topic-3' }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('REJECTED');
      expect(result.content[0].text).toContain('rubber-stamping');
    });

    it('should reject when no issues found across all topics (>2 reviews)', () => {
      const reviews = [
        makeReview({
          topic_slug: 'topic-1',
          outcome: 'expand',
          updates_needed: ['add examples'],
          completeness: 'needs_expansion',
          completeness_notes: 'Missing examples',
        }),
        makeReview({
          topic_slug: 'topic-2',
          outcome: 'expand',
          updates_needed: ['add details'],
          completeness: 'needs_expansion',
          completeness_notes: 'Missing details',
        }),
        makeReview({ topic_slug: 'topic-3', outcome: 'current' }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('Zero issues found');
    });

    it('should warn when all assessments are identical (>2 reviews)', () => {
      const reviews = [
        makeReview({
          topic_slug: 'topic-1',
          outcome: 'expand',
          issues_found: ['stale'],
          updates_needed: ['fix'],
          completeness: 'needs_expansion',
          completeness_notes: 'needs work',
        }),
        makeReview({
          topic_slug: 'topic-2',
          outcome: 'expand',
          issues_found: ['stale'],
          updates_needed: ['fix'],
          completeness: 'needs_expansion',
          completeness_notes: 'needs work',
        }),
        makeReview({
          topic_slug: 'topic-3',
          outcome: 'expand',
          issues_found: ['stale'],
          updates_needed: ['fix'],
          completeness: 'needs_expansion',
          completeness_notes: 'needs work',
        }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('identical assessment');
    });
  });

  describe('missing required notes', () => {
    it('should error when technical_accuracy is outdated without notes', () => {
      const reviews = [
        makeReview({
          technical_accuracy: 'outdated',
          outcome: 'expand',
          issues_found: ['outdated info'],
          updates_needed: ['update'],
        }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('technical_accuracy');
      expect(result.content[0].text).toContain('no notes provided');
    });

    it('should error when completeness is needs_expansion without notes', () => {
      const reviews = [
        makeReview({
          completeness: 'needs_expansion',
          outcome: 'expand',
          issues_found: ['incomplete'],
          updates_needed: ['expand'],
        }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('completeness');
      expect(result.content[0].text).toContain('no notes provided');
    });

    it('should error when consolidate_with selected without target topic', () => {
      const reviews = [
        makeReview({
          redundancy_check: 'consolidate_with',
          outcome: 'consolidate',
          issues_found: ['duplicate'],
          updates_needed: ['merge'],
        }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('consolidate_with');
      expect(result.content[0].text).toContain('no topic specified');
    });

    it('should error when non-current outcome has no issues or updates', () => {
      const reviews = [makeReview({ outcome: 'archive' })];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain("outcome is 'archive'");
      expect(result.content[0].text).toContain('no issues_found or updates_needed');
    });
  });

  describe('valid submissions', () => {
    it('should accept well-formed mixed reviews', () => {
      const reviews = [
        makeReview({
          topic_slug: 'good-topic',
          outcome: 'current',
          issues_found: ['minor formatting'],
          updates_needed: [],
        }),
        makeReview({
          topic_slug: 'needs-work',
          outcome: 'expand',
          completeness: 'needs_expansion',
          completeness_notes: 'Missing API examples and error handling section',
          issues_found: ['no examples', 'missing error docs'],
          updates_needed: ['add API examples', 'add error handling section'],
        }),
        makeReview({
          topic_slug: 'old-topic',
          outcome: 'archive',
          technical_accuracy: 'outdated',
          technical_accuracy_notes: 'References deprecated API version 1.0',
          issues_found: ['deprecated API references'],
          updates_needed: ['archive and create new topic'],
        }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('accepted');
      expect(result.content[0].text).toContain('**Current & Comprehensive**: 1');
      expect(result.content[0].text).toContain('**Needs Expansion**: 1');
      expect(result.content[0].text).toContain('**Archive**: 1');
    });

    it('should accept 2 or fewer all-current reviews without rubber-stamp warning', () => {
      const reviews = [
        makeReview({ topic_slug: 'topic-1' }),
        makeReview({ topic_slug: 'topic-2' }),
      ];

      const result = submitTopicReviews({ reviews }, context);
      expect(result.content[0].text).toContain('accepted');
      expect(result.content[0].text).not.toContain('rubber-stamping');
    });
  });
});
