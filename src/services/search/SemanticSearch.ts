/**
 * SemanticSearch - Embedding-based semantic search
 *
 * Responsible for:
 * - Query embedding generation
 * - Document embedding retrieval/generation
 * - Semantic similarity computation
 * - Re-ranking of keyword results using semantic scores
 */

import { createLogger } from '../../utils/logger.js';
import { EmbeddingService } from '../embeddings/EmbeddingService.js';
import { EmbeddingCache } from '../embeddings/EmbeddingCache.js';
import type { InternalSearchMatch } from '../../models/Search.js';

const logger = createLogger('SemanticSearch');

/**
 * Service for semantic (embedding-based) search
 */
export class SemanticSearch {
  private embeddingService: EmbeddingService;
  private embeddingCache: EmbeddingCache;

  constructor(embeddingService: EmbeddingService, embeddingCache: EmbeddingCache) {
    this.embeddingService = embeddingService;
    this.embeddingCache = embeddingCache;
    logger.info('SemanticSearch initialized');
  }

  /**
   * Generate query embedding
   *
   * @param query - Search query string
   * @returns Query embedding vector or null if failed
   */
  async generateQueryEmbedding(query: string): Promise<number[] | null> {
    if (!this.embeddingCache.isEnabled()) {
      logger.debug('Embeddings disabled, skipping query embedding');
      return null;
    }

    try {
      logger.debug('Generating query embedding', { query });
      const embedding = await this.embeddingService.generateEmbedding(query);
      logger.debug('Query embedding generated successfully', {
        query,
        dimension: embedding.length,
      });
      return embedding;
    } catch (error) {
      logger.error(
        'Failed to generate query embedding, falling back to keyword search',
        error as Error,
        {
          query,
        }
      );
      return null;
    }
  }

  /**
   * Get or create embedding for a document
   *
   * @param filePath - Absolute file path
   * @param content - File content
   * @param fileStats - File statistics
   * @param vaultPath - Vault path for caching
   * @returns Document embedding vector
   */
  async getOrCreateDocumentEmbedding(
    filePath: string,
    content: string,
    fileStats: any,
    vaultPath?: string
  ): Promise<number[]> {
    // Try to get from cache
    const cached = this.embeddingCache.get(filePath, fileStats);
    if (cached) {
      logger.debug('Using cached embedding', { filePath });
      return cached;
    }

    // Generate new embedding
    logger.debug('Generating new embedding for document', { filePath });
    const embedding = await this.embeddingService.generateEmbedding(content);

    // Cache it
    this.embeddingCache.set(filePath, embedding, fileStats, vaultPath);

    logger.debug('Document embedding generated and cached', {
      filePath,
      dimension: embedding.length,
    });

    return embedding;
  }

  /**
   * Re-rank search results using semantic similarity
   *
   * @param queryEmbedding - Query embedding vector
   * @param results - Keyword search results
   * @param maxResults - Maximum number of results to return
   * @param keywordCandidatesLimit - Number of top keyword results to re-rank
   * @returns Re-ranked results
   */
  async reRankResults(
    queryEmbedding: number[],
    results: InternalSearchMatch[],
    maxResults: number,
    keywordCandidatesLimit: number = 100
  ): Promise<InternalSearchMatch[]> {
    if (!this.embeddingCache.isEnabled() || results.length === 0) {
      logger.debug('Skipping semantic re-ranking', {
        enabled: this.embeddingCache.isEnabled(),
        resultsCount: results.length,
      });
      return results;
    }

    logger.info('Re-ranking results using semantic similarity', {
      totalResults: results.length,
      candidatesLimit: keywordCandidatesLimit,
    });

    // Sort by keyword score and take top N candidates for re-ranking
    const sortedResults = [...results].sort((a, b) => b.score - a.score);
    const candidates = sortedResults.slice(0, keywordCandidatesLimit);

    logger.debug('Selected candidates for re-ranking', {
      candidatesCount: candidates.length,
    });

    // Compute semantic similarity for each candidate
    let successCount = 0;
    let failureCount = 0;

    for (const result of candidates) {
      if (result.content && result.fileStats) {
        try {
          const docEmbedding = await this.getOrCreateDocumentEmbedding(
            result.file,
            result.content,
            result.fileStats,
            result.vault
          );

          const semanticScore = this.embeddingService.cosineSimilarity(
            queryEmbedding,
            docEmbedding
          );

          result.semanticScore = semanticScore;
          result.score = semanticScore; // Use semantic score as final ranking score

          successCount++;

          logger.debug('Semantic score computed', {
            file: result.file,
            semanticScore,
          });
        } catch (error) {
          logger.error(`Failed to compute semantic score for ${result.file}`, error as Error);
          failureCount++;
          // Keep keyword score if semantic scoring fails
        }
      }

      // Clean up temporary fields
      delete result.content;
      delete result.fileStats;
    }

    logger.info('Semantic re-ranking complete', {
      successCount,
      failureCount,
      totalCandidates: candidates.length,
    });

    // Re-sort by semantic score and take top results
    const reRanked = candidates.sort((a, b) => b.score - a.score).slice(0, maxResults);

    return reRanked;
  }

  /**
   * Get the embedding service
   */
  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  /**
   * Get the embedding cache
   */
  getEmbeddingCache(): EmbeddingCache {
    return this.embeddingCache;
  }
}
