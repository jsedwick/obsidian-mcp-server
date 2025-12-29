/**
 * AuthorityScorer - Apply vault and directory authority boosts
 *
 * Responsibilities:
 * - Boost scores based on vault authority level (curated/default/conversational)
 * - Boost scores based on directory type (topics/decisions/sessions)
 * - Combine vault and directory signals for content prioritization
 *
 * Scoring Strategy:
 * - Curated vaults: All content gets +5 (same as topics)
 * - Default vaults: Directory-based ranking (topics +5, decisions +3, sessions +1)
 * - Conversational vaults: All content gets +1 (same as sessions)
 */

import type { RecencyScore } from './RecencyScorer.js';
import type { DocumentMetadata } from '../../../models/IndexModels.js';
import type { VaultAuthority } from '../../../models/Vault.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('AuthorityScorer');

/**
 * Authority scoring configuration
 */
export interface AuthorityConfig {
  /** Enable vault authority scoring */
  enableVaultAuthority: boolean;

  /** Enable directory-based scoring */
  enableDirectoryScoring: boolean;

  /** Boost for curated vault content */
  curatedBoost: number;

  /** Boost for topics directory */
  topicsBoost: number;

  /** Boost for decisions directory */
  decisionsBoost: number;

  /** Boost for sessions directory */
  sessionsBoost: number;

  /** Boost for conversational vault content */
  conversationalBoost: number;
}

/**
 * Score with authority information
 */
export interface AuthorityScore extends RecencyScore {
  /** Authority boost applied */
  authorityBoost: number;

  /** Reason for authority boost */
  authorityReason?: string;

  /** Vault authority level */
  vaultAuthority?: VaultAuthority;

  /** Document category */
  category?: string;
}

/**
 * Default authority configuration
 */
export const DEFAULT_AUTHORITY_CONFIG: AuthorityConfig = {
  enableVaultAuthority: true,
  enableDirectoryScoring: true,
  curatedBoost: 5, // Same as topics
  topicsBoost: 5,
  decisionsBoost: 3,
  sessionsBoost: 1,
  conversationalBoost: 1, // Same as sessions
};

/**
 * Authority scorer for vault and directory-based relevance boosts
 */
export class AuthorityScorer {
  private config: AuthorityConfig;
  private vaultAuthorities: Map<string, VaultAuthority>;

  /**
   * Create authority scorer
   *
   * @param vaultAuthorities - Map of vault name to authority level
   * @param config - Authority configuration (optional)
   */
  constructor(
    vaultAuthorities: Map<string, VaultAuthority> = new Map(),
    config: Partial<AuthorityConfig> = {}
  ) {
    this.vaultAuthorities = vaultAuthorities;
    this.config = { ...DEFAULT_AUTHORITY_CONFIG, ...config };

    logger.debug('AuthorityScorer initialized', {
      vaultCount: vaultAuthorities.size,
      vaults: Array.from(vaultAuthorities.entries()),
    });
  }

  /**
   * Apply authority boosts to document scores
   *
   * @param scores - Scores from recency scoring
   * @param metadataMap - Document metadata map
   * @returns Scores with authority boosts applied
   */
  applyAuthorityBoosts(
    scores: RecencyScore[],
    metadataMap: Map<string, DocumentMetadata>
  ): AuthorityScore[] {
    logger.debug('Applying authority boosts', { documentCount: scores.length });

    const boostedScores = scores.map(score => {
      const metadata = metadataMap.get(score.docId);
      return metadata ? this.applyAuthorityBoost(score, metadata) : this.toAuthorityScore(score);
    });

    // Sort by final score (descending)
    boostedScores.sort((a, b) => b.score - a.score);

    logger.debug('Authority boosting complete', {
      topScore: boostedScores[0]?.score || 0,
      boostedDocuments: boostedScores.filter(s => s.authorityBoost > 0).length,
    });

    return boostedScores;
  }

  /**
   * Apply authority boost to a single document
   *
   * @param score - Recency score
   * @param metadata - Document metadata
   * @returns Score with authority boost
   */
  private applyAuthorityBoost(score: RecencyScore, metadata: DocumentMetadata): AuthorityScore {
    // Start with no boost
    if (!metadata) {
      return this.toAuthorityScore(score);
    }

    let authorityBoost = 0;
    let authorityReason: string | undefined;
    const vaultAuthority = this.vaultAuthorities.get(metadata.vault) || 'default';

    // Apply vault-level authority boost
    if (this.config.enableVaultAuthority) {
      if (vaultAuthority === 'curated') {
        // Curated vaults: All content is authoritative
        authorityBoost += this.config.curatedBoost;
        authorityReason = `curated vault (${metadata.vault})`;
      } else if (vaultAuthority === 'conversational') {
        // Conversational vaults: All content is lower priority
        authorityBoost += this.config.conversationalBoost;
        authorityReason = `conversational vault (${metadata.vault})`;
      } else if (vaultAuthority === 'default' && this.config.enableDirectoryScoring) {
        // Default vaults: Use directory-based scoring
        const directoryBoost = this.getDirectoryBoost(metadata.category);
        authorityBoost += directoryBoost;
        if (directoryBoost > 0) {
          authorityReason = `${metadata.category} in ${metadata.vault}`;
        }
      }
    }

    return {
      ...score,
      score: score.score + authorityBoost,
      authorityBoost,
      authorityReason,
      vaultAuthority,
      category: metadata.category,
    };
  }

  /**
   * Get directory-based boost amount
   *
   * @param category - Document category (singular form matching frontmatter)
   * @returns Boost amount
   */
  private getDirectoryBoost(category: string): number {
    if (category === 'topic') {
      return this.config.topicsBoost;
    } else if (category === 'decision') {
      return this.config.decisionsBoost;
    } else if (category === 'session') {
      return this.config.sessionsBoost;
    }
    return 0; // Unknown categories get no boost
  }

  /**
   * Convert RecencyScore to AuthorityScore (no boost)
   *
   * @param score - Recency score
   * @returns Authority score with zero boost
   */
  private toAuthorityScore(score: RecencyScore): AuthorityScore {
    return {
      ...score,
      authorityBoost: 0,
    };
  }

  /**
   * Update vault authority for a specific vault
   *
   * @param vaultName - Vault name
   * @param authority - Authority level
   */
  setVaultAuthority(vaultName: string, authority: VaultAuthority): void {
    this.vaultAuthorities.set(vaultName, authority);
    logger.debug('Vault authority updated', { vaultName, authority });
  }

  /**
   * Get vault authority level
   *
   * @param vaultName - Vault name
   * @returns Authority level (defaults to 'default')
   */
  getVaultAuthority(vaultName: string): VaultAuthority {
    return this.vaultAuthorities.get(vaultName) || 'default';
  }

  /**
   * Disable all authority scoring
   */
  disable(): void {
    this.config.enableVaultAuthority = false;
    this.config.enableDirectoryScoring = false;
    logger.info('Authority scoring disabled');
  }

  /**
   * Enable all authority scoring
   */
  enable(): void {
    this.config.enableVaultAuthority = true;
    this.config.enableDirectoryScoring = true;
    logger.info('Authority scoring enabled');
  }

  /**
   * Check if a document would receive an authority boost
   *
   * @param metadata - Document metadata
   * @returns True if document would be boosted
   */
  wouldBoost(metadata: DocumentMetadata): boolean {
    const vaultAuthority = this.vaultAuthorities.get(metadata.vault) || 'default';

    if (!this.config.enableVaultAuthority) {
      return false;
    }

    if (vaultAuthority === 'curated' || vaultAuthority === 'conversational') {
      return true;
    }

    if (vaultAuthority === 'default' && this.config.enableDirectoryScoring) {
      return this.getDirectoryBoost(metadata.category) > 0;
    }

    return false;
  }

  /**
   * Get documents that would receive authority boosts
   *
   * @param metadataList - Array of document metadata
   * @returns Array of metadata for documents that would be boosted
   */
  getBoostableDocuments(metadataList: DocumentMetadata[]): DocumentMetadata[] {
    return metadataList.filter(metadata => this.wouldBoost(metadata));
  }

  /**
   * Get debug information for a score
   *
   * @param score - Authority score
   * @returns Debug string
   */
  getDebugInfo(score: AuthorityScore): string {
    const lines: string[] = [];

    lines.push(`Document: ${score.docId}`);
    lines.push(`Final score: ${score.score.toFixed(4)}`);
    lines.push(`Score before authority: ${(score.score - score.authorityBoost).toFixed(4)}`);
    lines.push(`Authority boost: +${score.authorityBoost.toFixed(4)}`);

    if (score.authorityReason) {
      lines.push(`Authority reason: ${score.authorityReason}`);
    }
    if (score.vaultAuthority) {
      lines.push(`Vault authority: ${score.vaultAuthority}`);
    }
    if (score.category) {
      lines.push(`Category: ${score.category}`);
    }

    return lines.join('\n');
  }
}
