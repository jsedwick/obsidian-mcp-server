/**
 * IndexedSearch - Inverted index-based search
 *
 * Responsibilities:
 * - Query inverted index for matching documents
 * - Apply BM25 scoring for relevance ranking
 * - Apply field boosting (title, tags, headers)
 * - Apply recency scoring
 * - Return results compatible with linear search
 *
 * This service provides an alternative to KeywordSearch that uses
 * pre-built indexes for faster queries on large vaults.
 */

import * as fs from 'fs/promises';
import { createLogger } from '../../utils/logger.js';
import type { InternalSearchMatch, DateRange } from '../../models/Search.js';
import { IndexBuilder } from './index/IndexBuilder.js';
import type { InvertedIndex } from './index/InvertedIndex.js';
import type { DocumentStore } from './index/DocumentStore.js';
import { BM25Scorer } from './index/BM25Scorer.js';
import { FieldBooster } from './index/FieldBooster.js';
import { RecencyScorer } from './index/RecencyScorer.js';
import { IndexPersistence } from './index/IndexPersistence.js';
import type { DocumentMetadata } from '../../models/IndexModels.js';
import type { DocumentScore } from './index/BM25Scorer.js';

const logger = createLogger('IndexedSearch');

/**
 * Options for indexed search
 */
export interface IndexedSearchOptions {
  /** Query string */
  query: string;

  /** Query terms (pre-tokenized) */
  queryTerms: string[];

  /** Maximum results to return */
  maxResults: number;

  /** Optional date range filter */
  dateRange?: DateRange;

  /** Directories to filter (sessions, topics, decisions) */
  directories?: string[];
}

/**
 * Service for index-based search
 */
export class IndexedSearch {
  private indexBuilder: IndexBuilder;
  private indexPersistence: IndexPersistence;
  private bm25Scorer: BM25Scorer;
  private fieldBooster: FieldBooster;
  private recencyScorer: RecencyScorer;

  // In-memory cache of loaded index
  private cachedIndex: InvertedIndex | null = null;
  private cachedStore: DocumentStore | null = null;
  private cacheTimestamp: number = 0;

  constructor(indexBuilder: IndexBuilder, cacheDir: string) {
    this.indexBuilder = indexBuilder;
    this.indexPersistence = new IndexPersistence(cacheDir);
    this.bm25Scorer = new BM25Scorer();
    this.fieldBooster = new FieldBooster();
    this.recencyScorer = new RecencyScorer();
    logger.info('IndexedSearch initialized', { cacheDir });
  }

  /**
   * Search using inverted index
   *
   * @param options - Search options
   * @returns Array of search matches
   */
  async search(options: IndexedSearchOptions): Promise<InternalSearchMatch[]> {
    logger.info('Starting indexed search', {
      query: options.query,
      maxResults: options.maxResults,
    });

    // Get current index from builder
    const stats = await this.indexBuilder.getIndexStats();
    if (!stats) {
      logger.warn('No index available, returning empty results');
      return [];
    }

    // Load index components (this should be cached/reused in real implementation)
    const { invertedIndex, documentStore } = await this.loadIndex();

    if (!invertedIndex || !documentStore) {
      logger.error('Failed to load index components');
      return [];
    }

    // Tokenize query
    const queryTerms = options.queryTerms.map(term => term.toLowerCase());

    logger.debug('Query tokenized', {
      queryTerms,
      termCount: queryTerms.length,
    });

    // Query index for matching documents
    const termPostings = new Map();
    for (const term of queryTerms) {
      const postings = invertedIndex.getPostings(term);
      if (postings.length > 0) {
        termPostings.set(term, postings);
      }
    }

    if (termPostings.size === 0) {
      logger.info('No matching documents found');
      return [];
    }

    logger.debug('Term postings retrieved', {
      termsWithPostings: termPostings.size,
      totalTerms: queryTerms.length,
    });

    // Calculate BM25 scores
    const documentFrequency = new Map<string, number>();
    for (const [term, postings] of termPostings.entries()) {
      const uniqueDocs = new Set(postings.map((p: any) => p.docId));
      documentFrequency.set(term, uniqueDocs.size);
    }

    const indexStats = {
      totalDocuments: documentStore.getTotalDocuments(),
      averageDocumentLength: documentStore.getAverageDocumentLength(),
      totalTerms: termPostings.size,
      documentFrequency,
    };

    const documentScores = this.bm25Scorer.scoreDocuments(
      queryTerms,
      termPostings,
      indexStats
    );

    logger.debug('BM25 scoring complete', {
      documentsScored: documentScores.length,
    });

    // Apply exact phrase matching bonus (matching KeywordSearch behavior)
    const phraseAdjustedScores = await this.applyPhraseMatchBonus(
      documentScores,
      options.query,
      documentStore
    );

    logger.debug('Phrase matching complete', {
      documentsWithBonus: phraseAdjustedScores.filter(s => {
        const originalScore = documentScores.find(d => d.docId === s.docId);
        return s.score > (originalScore?.score ?? 0);
      }).length,
    });

    // Apply field boosting
    const boostedScores = this.fieldBooster.boostScores(phraseAdjustedScores);

    logger.debug('Field boosting complete', {
      topScore: boostedScores[0]?.score || 0,
    });

    // Get metadata for recency scoring
    const metadataMap = new Map<string, DocumentMetadata>();
    for (const score of boostedScores) {
      const metadata = documentStore.get(score.docId);
      if (metadata) {
        metadataMap.set(score.docId, metadata);
      }
    }

    // Apply recency scoring
    const finalScores = this.recencyScorer.applyRecencyBoosts(
      boostedScores.slice(0, 100), // Only apply to top 100 for performance
      metadataMap
    );

    logger.debug('Recency scoring complete', {
      topScore: finalScores[0]?.score || 0,
    });

    // Filter by directories if specified
    let filteredScores = finalScores;
    if (options.directories && options.directories.length > 0) {
      filteredScores = finalScores.filter(score => {
        const metadata = metadataMap.get(score.docId);
        if (!metadata) return false;

        // Check if file path contains any of the specified directories
        return options.directories!.some(dir =>
          metadata.path.includes(`/${dir}/`)
        );
      });

      logger.debug('Directory filtering applied', {
        before: finalScores.length,
        after: filteredScores.length,
        directories: options.directories,
      });
    }

    // Filter by date range if specified
    if (options.dateRange) {
      filteredScores = filteredScores.filter(score => {
        const metadata = metadataMap.get(score.docId);
        if (!metadata || !metadata.frontmatter?.created) return true;

        const fileDate = metadata.frontmatter.created;
        if (options.dateRange!.start && fileDate < options.dateRange!.start) {
          return false;
        }
        if (options.dateRange!.end && fileDate > options.dateRange!.end) {
          return false;
        }
        return true;
      });

      logger.debug('Date range filtering applied', {
        resultsAfterFilter: filteredScores.length,
      });
    }

    // Convert to InternalSearchMatch format
    const results: InternalSearchMatch[] = [];
    const limit = Math.min(options.maxResults, filteredScores.length);

    for (let i = 0; i < limit; i++) {
      const score = filteredScores[i];
      const metadata = metadataMap.get(score.docId);
      if (!metadata) continue;

      // Extract matching lines (snippets) from metadata
      // In production, we'd fetch full content only when needed
      const matchingLines: string[] = [];

      results.push({
        file: metadata.path,
        matches: matchingLines,
        date: metadata.frontmatter?.created,
        score: score.score,
        content: '', // Content would be loaded separately if needed
        fileStats: {
          size: 0, // Size would come from file stats
          mtime: new Date(metadata.lastModified),
        },
      });
    }

    logger.info('Indexed search complete', {
      query: options.query,
      resultsReturned: results.length,
      documentsScored: documentScores.length,
    });

    return results;
  }

  /**
   * Load index components from disk with in-memory caching
   *
   * The index is cached in memory and reused for subsequent queries.
   * This dramatically improves performance by avoiding disk I/O.
   */
  private async loadIndex(): Promise<{
    invertedIndex: InvertedIndex | null;
    documentStore: DocumentStore | null;
  }> {
    try {
      // Check if we have a cached version
      if (this.cachedIndex && this.cachedStore) {
        logger.debug('Using cached index', {
          totalTerms: this.cachedIndex.getTermCount(),
          totalDocuments: this.cachedStore.getTotalDocuments(),
        });
        return {
          invertedIndex: this.cachedIndex,
          documentStore: this.cachedStore,
        };
      }

      // Load index from disk using IndexPersistence
      logger.debug('Loading index from disk');

      const { index, store, metadata } = await this.indexPersistence.load();

      if (!index || !store) {
        logger.warn('Index not found, needs to be built first');
        return { invertedIndex: null, documentStore: null };
      }

      // Cache the loaded index
      this.cachedIndex = index;
      this.cachedStore = store;
      this.cacheTimestamp = new Date(metadata.lastBuilt).getTime();

      logger.debug('Index loaded and cached', {
        totalTerms: index.getTermCount(),
        totalDocuments: store.getTotalDocuments(),
        timestamp: this.cacheTimestamp,
      });

      return {
        invertedIndex: index,
        documentStore: store,
      };
    } catch (error) {
      logger.error('Error loading index', error as Error);
      return { invertedIndex: null, documentStore: null };
    }
  }

  /**
   * Clear the in-memory cache
   * Useful when index is rebuilt externally
   */
  clearCache(): void {
    this.cachedIndex = null;
    this.cachedStore = null;
    this.cacheTimestamp = 0;
    logger.debug('Index cache cleared');
  }

  /**
   * Get current index statistics
   */
  async getIndexStats() {
    return this.indexBuilder.getIndexStats();
  }

  /**
   * Check if index exists and is valid
   */
  async isIndexAvailable(): Promise<boolean> {
    const errors = await this.indexBuilder.validateIndex();
    return errors.length === 0;
  }

  /**
   * Apply exact phrase matching bonus
   *
   * If the full query appears as an exact phrase in the document,
   * add a +15 bonus to match KeywordSearch behavior.
   *
   * This is critical for ranking documents where the query terms
   * appear together (e.g., "search optimization" as a phrase vs
   * documents that just contain "search" and "optimization" separately).
   */
  private async applyPhraseMatchBonus(
    scores: DocumentScore[],
    query: string,
    documentStore: DocumentStore
  ): Promise<DocumentScore[]> {
    // Skip if single term query (no phrase to match)
    if (query.split(/\s+/).length < 2) {
      return scores;
    }

    const queryLower = query.toLowerCase();
    const phraseBonus = 15; // Match KeywordSearch bonus

    // Only check top 50 for performance (to avoid reading all files)
    const maxToCheck = Math.min(50, scores.length);

    for (let i = 0; i < maxToCheck; i++) {
      const score = scores[i];
      const metadata = documentStore.get(score.docId);
      if (!metadata) continue;

      try {
        // Read file content (use docId which is the absolute path)
        const content = await fs.readFile(score.docId, 'utf-8');
        const contentLower = content.toLowerCase();

        // Check for exact phrase match
        if (contentLower.includes(queryLower)) {
          score.score += phraseBonus;
          logger.debug('Exact phrase match bonus applied', {
            docId: score.docId,
            query,
            bonus: phraseBonus,
          });
        }
      } catch (error) {
        // Ignore file read errors (file might have been deleted)
        continue;
      }
    }

    // Re-sort after applying bonuses
    return scores.sort((a, b) => b.score - a.score);
  }
}
