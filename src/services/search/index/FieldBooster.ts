/**
 * FieldBooster - Apply field-level score multipliers
 *
 * Responsibilities:
 * - Boost scores based on which field contains the match
 * - Title matches are more important than content matches
 * - Tag matches are more important than regular content
 * - Support custom field boost configurations
 * - Integrate with BM25 scoring
 *
 * Default Boosts:
 * - Title: 2.0x (highest priority)
 * - Tags: 1.5x
 * - Frontmatter: 1.2x
 * - Content: 1.0x (baseline)
 */

import type { IndexField, FieldBoosts } from '../../../models/IndexModels.js';
import { DEFAULT_FIELD_BOOSTS } from '../../../models/IndexModels.js';
import type { DocumentScore } from './BM25Scorer.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('FieldBooster');

/**
 * Boosted document score with field information
 */
export interface BoostedScore {
  /** Document ID */
  docId: string;

  /** Boosted score */
  score: number;

  /** Score breakdown by term */
  termScores: Map<string, number>;

  /** Score breakdown by field */
  fieldScores: Map<IndexField, number>;

  /** Original score before boosting */
  originalScore: number;

  /** Boost multiplier applied */
  boostMultiplier: number;

  /** Field that provided the highest boost */
  primaryField?: IndexField;
}

/**
 * Field booster for score amplification
 */
export class FieldBooster {
  private boosts: FieldBoosts;

  /**
   * Create a new field booster
   *
   * @param boosts - Field boost multipliers (defaults to DEFAULT_FIELD_BOOSTS)
   */
  constructor(boosts: FieldBoosts = DEFAULT_FIELD_BOOSTS) {
    this.boosts = boosts;
    logger.debug('FieldBooster initialized', { boosts });
  }

  /**
   * Apply field boosts to document scores
   *
   * @param scores - Original document scores
   * @returns Boosted scores sorted by final score
   */
  boostScores(scores: DocumentScore[]): BoostedScore[] {
    logger.debug('Applying field boosts', { documentCount: scores.length });

    const boostedScores: BoostedScore[] = scores.map(score => this.boostScore(score));

    // Re-sort by boosted score
    boostedScores.sort((a, b) => b.score - a.score);

    logger.debug('Field boosting complete', {
      documentCount: boostedScores.length,
      topScore: boostedScores[0]?.score || 0,
    });

    return boostedScores;
  }

  /**
   * Apply field boost to a single document score
   *
   * @param score - Original document score
   * @returns Boosted score
   */
  private boostScore(score: DocumentScore): BoostedScore {
    const originalScore = score.score;
    let boostedScore = 0;
    let maxBoost = 1.0;
    let primaryField: IndexField | undefined;

    // Calculate weighted score based on field contributions
    for (const [field, fieldScore] of score.fieldScores.entries()) {
      const boost = this.getBoost(field);
      const boostedFieldScore = fieldScore * boost;
      boostedScore += boostedFieldScore;

      // Track the field with the highest boost that contributed
      if (fieldScore > 0 && boost > maxBoost) {
        maxBoost = boost;
        primaryField = field;
      }
    }

    // If no field scores, use original score
    if (score.fieldScores.size === 0) {
      boostedScore = originalScore;
    }

    return {
      ...score,
      score: boostedScore,
      originalScore,
      boostMultiplier: boostedScore / (originalScore || 1),
      primaryField,
    };
  }

  /**
   * Calculate effective boost for a specific field pattern
   *
   * Given how a term is distributed across fields, calculate the effective boost
   *
   * @param fieldScores - Map of field → score contribution
   * @returns Effective boost multiplier
   */
  calculateEffectiveBoost(fieldScores: Map<IndexField, number>): number {
    let totalOriginal = 0;
    let totalBoosted = 0;

    for (const [field, score] of fieldScores.entries()) {
      const boost = this.getBoost(field);
      totalOriginal += score;
      totalBoosted += score * boost;
    }

    return totalOriginal > 0 ? totalBoosted / totalOriginal : 1.0;
  }

  /**
   * Get boost multiplier for a specific field
   *
   * @param field - The field to get boost for
   * @returns Boost multiplier
   */
  getBoost(field: IndexField): number {
    return this.boosts[field] || 1.0;
  }

  /**
   * Update field boosts
   *
   * @param boosts - New boost configuration (partial update)
   */
  setBoosts(boosts: Partial<FieldBoosts>): void {
    this.boosts = {
      ...this.boosts,
      ...boosts,
    };
    logger.debug('Field boosts updated', { boosts: this.boosts });
  }

  /**
   * Get current field boost configuration
   *
   * @returns Current boosts
   */
  getBoosts(): FieldBoosts {
    return { ...this.boosts };
  }

  /**
   * Reset boosts to defaults
   */
  resetToDefaults(): void {
    this.boosts = { ...DEFAULT_FIELD_BOOSTS };
    logger.debug('Field boosts reset to defaults');
  }

  /**
   * Compare field importance
   *
   * @param field1 - First field
   * @param field2 - Second field
   * @returns Positive if field1 > field2, negative if field1 < field2, 0 if equal
   */
  compareFields(field1: IndexField, field2: IndexField): number {
    const boost1 = this.getBoost(field1);
    const boost2 = this.getBoost(field2);
    return boost1 - boost2;
  }

  /**
   * Get fields sorted by importance (highest boost first)
   *
   * @returns Array of fields sorted by boost value descending
   */
  getFieldsByImportance(): IndexField[] {
    return Object.entries(this.boosts)
      .sort(([, boostA], [, boostB]) => boostB - boostA)
      .map(([field]) => field as IndexField);
  }

  /**
   * Calculate score distribution across fields
   *
   * @param score - Document score with field breakdown
   * @returns Map of field → percentage contribution to total score
   */
  getScoreDistribution(score: BoostedScore): Map<IndexField, number> {
    const distribution = new Map<IndexField, number>();
    const totalScore = score.score;

    if (totalScore === 0) return distribution;

    for (const [field, fieldScore] of score.fieldScores.entries()) {
      const boost = this.getBoost(field);
      const boostedFieldScore = fieldScore * boost;
      const percentage = (boostedFieldScore / totalScore) * 100;
      distribution.set(field, percentage);
    }

    return distribution;
  }

  /**
   * Generate human-readable explanation of field boosting
   *
   * @param score - Boosted score
   * @returns Formatted explanation
   */
  explainBoost(score: BoostedScore): string {
    const lines: string[] = [];

    lines.push(`Document: ${score.docId}`);
    lines.push(`Original Score: ${score.originalScore.toFixed(4)}`);
    lines.push(`Boosted Score: ${score.score.toFixed(4)}`);
    lines.push(`Boost Multiplier: ${score.boostMultiplier.toFixed(2)}x`);

    if (score.primaryField) {
      lines.push(`Primary Field: ${score.primaryField} (${this.getBoost(score.primaryField)}x)`);
    }

    lines.push('\nField Breakdown:');
    for (const [field, fieldScore] of score.fieldScores.entries()) {
      const boost = this.getBoost(field);
      const boostedFieldScore = fieldScore * boost;
      lines.push(
        `  ${field}: ${fieldScore.toFixed(4)} × ${boost.toFixed(2)} = ${boostedFieldScore.toFixed(4)}`
      );
    }

    return lines.join('\n');
  }
}
