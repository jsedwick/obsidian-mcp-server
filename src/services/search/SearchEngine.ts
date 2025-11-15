/**
 * SearchEngine - Core search orchestration
 *
 * Responsible for:
 * - Coordinating keyword and semantic search
 * - Multi-vault search orchestration
 * - Directory traversal and file discovery
 * - Search pipeline management
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { KeywordSearch } from './KeywordSearch.js';
import { SemanticSearch } from './SemanticSearch.js';
import { SearchRanker } from './SearchRanker.js';
import type {
  SearchOptions,
  SearchResults,
  InternalSearchMatch,
  ResponseDetail,
} from '../../models/Search.js';

const logger = createLogger('SearchEngine');

/**
 * Vault information for search
 */
export interface VaultInfo {
  path: string;
  name: string;
}

/**
 * Main search engine coordinating all search operations
 */
export class SearchEngine {
  private keywordSearch: KeywordSearch;
  private semanticSearch: SemanticSearch;
  private searchRanker: SearchRanker;

  constructor(
    keywordSearch: KeywordSearch,
    semanticSearch: SemanticSearch,
    searchRanker: SearchRanker
  ) {
    this.keywordSearch = keywordSearch;
    this.semanticSearch = semanticSearch;
    this.searchRanker = searchRanker;
    logger.info('SearchEngine initialized');
  }

  /**
   * Perform search across all vaults
   *
   * @param options - Search options
   * @param vaults - List of vaults to search
   * @param primaryVaultPath - Path to primary vault
   * @returns Search results
   */
  async search(
    options: SearchOptions,
    vaults: VaultInfo[],
    primaryVaultPath: string
  ): Promise<SearchResults> {
    logger.info('Starting search', {
      query: options.query,
      directories: options.directories,
      maxResults: options.maxResults,
      vaultCount: vaults.length,
    });

    const searchDirs = options.directories || ['sessions', 'topics', 'decisions'];
    const maxResults = options.maxResults || 10;

    const queryLower = options.query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    logger.debug('Query parsed', {
      queryLower,
      terms: queryTerms,
      termCount: queryTerms.length,
    });

    // Phase 1: Generate query embedding if enabled
    const queryEmbedding = await this.semanticSearch.generateQueryEmbedding(options.query);

    const usedSemanticSearch = queryEmbedding !== null;

    // Phase 2: Keyword search across all vaults
    const results: InternalSearchMatch[] = [];

    for (const vault of vaults) {
      const isPrimaryVault = vault.path === primaryVaultPath;

      logger.debug('Searching vault', {
        vault: vault.name,
        isPrimary: isPrimaryVault,
      });

      if (isPrimaryVault) {
        // For primary vault, search only in standard directories
        for (const dir of searchDirs) {
          const dirPath = path.join(vault.path, dir);
          const dirResults = await this.searchDirectory(
            dirPath,
            dir,
            vault.name,
            queryLower,
            queryTerms,
            options.dateRange
          );
          results.push(...dirResults);
        }
      } else {
        // For secondary vaults, search everything recursively
        const secondaryResults = await this.searchDirectory(
          vault.path,
          '',
          vault.name,
          queryLower,
          queryTerms,
          options.dateRange
        );
        results.push(...secondaryResults);
      }
    }

    logger.info('Keyword search complete', {
      totalResults: results.length,
      vaultsSearched: vaults.length,
    });

    // Phase 3: Semantic re-ranking (if embeddings enabled and we have results)
    let finalResults: InternalSearchMatch[];

    if (queryEmbedding && results.length > 0) {
      logger.info('Starting semantic re-ranking');

      const keywordCandidatesLimit = 100; // TODO: Make this configurable

      finalResults = await this.semanticSearch.reRankResults(
        queryEmbedding,
        results,
        maxResults,
        keywordCandidatesLimit
      );
    } else {
      // No semantic re-ranking: just use keyword scores
      logger.debug('Skipping semantic re-ranking', {
        hasQueryEmbedding: !!queryEmbedding,
        resultsCount: results.length,
      });

      results.sort((a, b) => b.score - a.score);
      finalResults = results.slice(0, maxResults);

      // Clean up temporary fields
      for (const result of finalResults) {
        delete result.content;
        delete result.fileStats;
      }
    }

    // Phase 4: Deduplication and cleanup
    const deduplicated = this.searchRanker.deduplicateResults(finalResults);
    const cleaned = this.searchRanker.cleanupResults(deduplicated);

    logger.info('Search complete', {
      query: options.query,
      totalMatches: results.length,
      returnedResults: cleaned.length,
      usedSemanticSearch,
    });

    return {
      results: cleaned,
      totalMatches: results.length,
      usedSemanticSearch,
      query: options.query,
      vaultsSearched: vaults.length,
    };
  }

  /**
   * Search a directory recursively
   */
  private async searchDirectory(
    dirPath: string,
    relativePath: string,
    vaultName: string,
    queryLower: string,
    queryTerms: string[],
    dateRange?: { start?: string; end?: string }
  ): Promise<InternalSearchMatch[]> {
    const results: InternalSearchMatch[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          // Skip common ignored directories
          if (['.git', 'node_modules', '.DS_Store', '.obsidian'].includes(entry.name)) {
            continue;
          }

          // Handle month subdirectories for sessions (YYYY-MM format)
          if (/^\d{4}-\d{2}$/.test(entry.name)) {
            const monthFiles = await fs.readdir(fullPath);
            for (const file of monthFiles) {
              if (!file.endsWith('.md')) continue;

              const filePath = path.join(fullPath, file);
              const fileStats = await fs.stat(filePath);
              const content = await fs.readFile(filePath, 'utf-8');

              const searchResult = await this.keywordSearch.scoreSearchResult(
                'sessions',
                path.join(relativeFilePath, file),
                file,
                content,
                fileStats,
                queryLower,
                queryTerms,
                dateRange,
                filePath // Pass absolute path for embedding cache key
              );

              if (searchResult) {
                results.push({ ...searchResult, vault: vaultName });
              }
            }
          } else {
            // Recursively search subdirectories
            const subResults = await this.searchDirectory(
              fullPath,
              relativeFilePath,
              vaultName,
              queryLower,
              queryTerms,
              dateRange
            );
            results.push(...subResults);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Process markdown file
          const fileStats = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, 'utf-8');

          // Determine category based on path
          let category = 'document';
          if (relativeFilePath.includes('sessions')) category = 'sessions';
          else if (relativeFilePath.includes('topics')) category = 'topics';
          else if (relativeFilePath.includes('decisions')) category = 'decisions';

          const searchResult = await this.keywordSearch.scoreSearchResult(
            category,
            relativeFilePath,
            entry.name,
            content,
            fileStats,
            queryLower,
            queryTerms,
            dateRange,
            fullPath // Pass absolute path for embedding cache key
          );

          if (searchResult) {
            results.push({ ...searchResult, vault: vaultName });
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be accessed
      logger.debug('Failed to search directory', {
        dirPath,
        error: (error as Error).message,
      });
    }

    return results;
  }

  /**
   * Format search results for display
   */
  formatResults(
    searchResults: SearchResults,
    detailLevel: ResponseDetail = ResponseDetail.SUMMARY
  ): string {
    return this.searchRanker.formatResults(
      searchResults.results,
      searchResults.totalMatches,
      detailLevel,
      searchResults.usedSemanticSearch,
      searchResults.query
    );
  }

  /**
   * Get the semantic search service
   */
  getSemanticSearch(): SemanticSearch {
    return this.semanticSearch;
  }

  /**
   * Get the keyword search service
   */
  getKeywordSearch(): KeywordSearch {
    return this.keywordSearch;
  }

  /**
   * Get the search ranker service
   */
  getSearchRanker(): SearchRanker {
    return this.searchRanker;
  }
}
