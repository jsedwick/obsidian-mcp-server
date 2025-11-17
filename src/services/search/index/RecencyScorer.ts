/**
 * RecencyScorer - Apply time-based score boosts
 *
 * Responsibilities:
 * - Boost scores for recently modified files
 * - Boost scores for recently reviewed topics
 * - Preserve existing recency behavior from linear search
 * - Support configurable time windows
 *
 * Default Behavior (matching existing implementation):
 * - Files modified within 7 days: +2 points
 * - Topics reviewed within 30 days: +1 point
 */

import type { BoostedScore } from './FieldBooster.js';
import type { DocumentMetadata, IndexField } from '../../../models/IndexModels.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('RecencyScorer');

/**
 * Recency scoring configuration
 */
export interface RecencyConfig {
  /** Enable modification time scoring */
  enableModificationBoost: boolean;

  /** Enable review time scoring */
  enableReviewBoost: boolean;

  /** Modification time window (ms) for boost */
  modificationWindow: number;

  /** Modification boost amount */
  modificationBoost: number;

  /** Review time window (ms) for boost */
  reviewWindow: number;

  /** Review boost amount */
  reviewBoost: number;
}

/**
 * Score with recency information
 */
export interface RecencyScore {
  /** Document ID */
  docId: string;

  /** Final score with recency */
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

  /** Recency boost applied */
  recencyBoost: number;

  /** Days since last modification */
  daysSinceModified?: number;

  /** Days since last review */
  daysSinceReviewed?: number;

  /** Reason for recency boost */
  recencyReason?: string;
}

/**
 * Default recency configuration (matches existing search behavior)
 */
export const DEFAULT_RECENCY_CONFIG: RecencyConfig = {
  enableModificationBoost: true,
  enableReviewBoost: true,
  modificationWindow: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  modificationBoost: 2,
  reviewWindow: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  reviewBoost: 1,
};

/**
 * Recency scorer for time-based relevance boosts
 */
export class RecencyScorer {
  private config: RecencyConfig;

  /**
   * Create a new recency scorer
   *
   * @param config - Recency scoring configuration
   */
  constructor(config: RecencyConfig = DEFAULT_RECENCY_CONFIG) {
    this.config = config;
    logger.debug('RecencyScorer initialized', { config });
  }

  /**
   * Apply recency boosts to document scores
   *
   * @param scores - Boosted scores from field boosting
   * @param metadataMap - Map of docId → document metadata
   * @returns Scores with recency boosts applied
   */
  applyRecencyBoosts(
    scores: BoostedScore[],
    metadataMap: Map<string, DocumentMetadata>
  ): RecencyScore[] {
    logger.debug('Applying recency boosts', { documentCount: scores.length });

    const recencyScores: RecencyScore[] = scores.map(score => {
      const metadata = metadataMap.get(score.docId);
      return this.applyRecencyBoost(score, metadata);
    });

    // Re-sort by final score
    recencyScores.sort((a, b) => b.score - a.score);

    logger.debug('Recency boosting complete', {
      documentCount: recencyScores.length,
      topScore: recencyScores[0]?.score || 0,
    });

    return recencyScores;
  }

  /**
   * Apply recency boost to a single document
   *
   * @param score - Boosted score
   * @param metadata - Document metadata
   * @returns Score with recency boost
   */
  private applyRecencyBoost(
    score: BoostedScore,
    metadata?: DocumentMetadata
  ): RecencyScore {
    if (!metadata) {
      return {
        ...score,
        recencyBoost: 0,
      };
    }

    let recencyBoost = 0;
    const reasons: string[] = [];
    const now = Date.now();

    // Calculate days since modification
    const daysSinceModified = (now - metadata.lastModified) / (24 * 60 * 60 * 1000);

    // Check modification recency
    if (
      this.config.enableModificationBoost &&
      now - metadata.lastModified < this.config.modificationWindow
    ) {
      recencyBoost += this.config.modificationBoost;
      reasons.push(`Modified ${Math.floor(daysSinceModified)} days ago`);
    }

    // Calculate days since review (if available)
    let daysSinceReviewed: number | undefined;
    if (metadata.frontmatter?.last_reviewed) {
      const lastReviewed = new Date(metadata.frontmatter.last_reviewed).getTime();
      if (!isNaN(lastReviewed)) {
        daysSinceReviewed = (now - lastReviewed) / (24 * 60 * 60 * 1000);

        // Check review recency
        if (
          this.config.enableReviewBoost &&
          now - lastReviewed < this.config.reviewWindow
        ) {
          recencyBoost += this.config.reviewBoost;
          reasons.push(`Reviewed ${Math.floor(daysSinceReviewed)} days ago`);
        }
      }
    }

    return {
      ...score,
      score: score.score + recencyBoost,
      recencyBoost,
      daysSinceModified,
      daysSinceReviewed,
      recencyReason: reasons.length > 0 ? reasons.join(', ') : undefined,
    };
  }

  /**
   * Calculate recency score for a document without applying it
   *
   * Useful for debugging or displaying recency information
   *
   * @param metadata - Document metadata
   * @returns Recency boost value
   */
  calculateRecencyBoost(metadata: DocumentMetadata): number {
    let boost = 0;
    const now = Date.now();

    if (
      this.config.enableModificationBoost &&
      now - metadata.lastModified < this.config.modificationWindow
    ) {
      boost += this.config.modificationBoost;
    }

    if (metadata.frontmatter?.last_reviewed) {
      const lastReviewed = new Date(metadata.frontmatter.last_reviewed).getTime();
      if (
        !isNaN(lastReviewed) &&
        this.config.enableReviewBoost &&
        now - lastReviewed < this.config.reviewWindow
      ) {
        boost += this.config.reviewBoost;
      }
    }

    return boost;
  }

  /**
   * Update recency configuration
   *
   * @param config - New configuration (partial update)
   */
  setConfig(config: Partial<RecencyConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
    logger.debug('Recency config updated', { config: this.config });
  }

  /**
   * Get current recency configuration
   *
   * @returns Current configuration
   */
  getConfig(): RecencyConfig {
    return { ...this.config };
  }

  /**
   * Disable all recency scoring
   */
  disable(): void {
    this.config.enableModificationBoost = false;
    this.config.enableReviewBoost = false;
    logger.debug('Recency scoring disabled');
  }

  /**
   * Enable all recency scoring
   */
  enable(): void {
    this.config.enableModificationBoost = true;
    this.config.enableReviewBoost = true;
    logger.debug('Recency scoring enabled');
  }

  /**
   * Check if a document would receive a recency boost
   *
   * @param metadata - Document metadata
   * @returns True if document would be boosted
   */
  wouldBoost(metadata: DocumentMetadata): boolean {
    return this.calculateRecencyBoost(metadata) > 0;
  }

  /**
   * Get documents that would receive recency boosts
   *
   * @param metadataList - Array of document metadata
   * @returns Array of metadata for documents that would be boosted
   */
  getRecentDocuments(metadataList: DocumentMetadata[]): DocumentMetadata[] {
    return metadataList.filter(metadata => this.wouldBoost(metadata));
  }

  /**
   * Generate human-readable explanation of recency scoring
   *
   * @param score - Recency score
   * @returns Formatted explanation
   */
  explainRecency(score: RecencyScore): string {
    const lines: string[] = [];

    lines.push(`Document: ${score.docId}`);
    lines.push(`Score before recency: ${(score.score - score.recencyBoost).toFixed(4)}`);
    lines.push(`Recency boost: +${score.recencyBoost.toFixed(4)}`);
    lines.push(`Final score: ${score.score.toFixed(4)}`);

    if (score.daysSinceModified !== undefined) {
      lines.push(`\nDays since modified: ${score.daysSinceModified.toFixed(1)}`);
    }

    if (score.daysSinceReviewed !== undefined) {
      lines.push(`Days since reviewed: ${score.daysSinceReviewed.toFixed(1)}`);
    }

    if (score.recencyReason) {
      lines.push(`\nReason: ${score.recencyReason}`);
    }

    return lines.join('\n');
  }

  /**
   * Get statistics on recency boosts applied
   *
   * @param scores - Array of recency scores
   * @returns Statistics object
   */
  getStatistics(scores: RecencyScore[]): {
    totalDocuments: number;
    boostedDocuments: number;
    averageBoost: number;
    maxBoost: number;
    modificationBoosts: number;
    reviewBoosts: number;
  } {
    const boostedDocs = scores.filter(s => s.recencyBoost > 0);
    const totalBoost = boostedDocs.reduce((sum, s) => sum + s.recencyBoost, 0);
    const maxBoost = Math.max(0, ...boostedDocs.map(s => s.recencyBoost));

    const modificationBoosts = scores.filter(
      s => s.recencyReason?.includes('Modified')
    ).length;
    const reviewBoosts = scores.filter(s => s.recencyReason?.includes('Reviewed')).length;

    return {
      totalDocuments: scores.length,
      boostedDocuments: boostedDocs.length,
      averageBoost: boostedDocs.length > 0 ? totalBoost / boostedDocs.length : 0,
      maxBoost,
      modificationBoosts,
      reviewBoosts,
    };
  }
}
