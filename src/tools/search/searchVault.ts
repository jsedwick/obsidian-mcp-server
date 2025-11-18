/**
 * Tool: search_vault
 *
 * Description: Search the Obsidian vault for relevant notes and context. Returns ranked results with snippets.
 * Use get_session_context to read full files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ResponseDetail, parseDetailLevel } from '../../models/Search.js';
import type { IndexedSearch } from '../../services/search/IndexedSearch.js';
import { IndexBuilder, BuildMode } from '../../services/search/index/IndexBuilder.js';
import { DEFAULT_INDEX_CONFIG } from '../../models/IndexModels.js';

export interface SearchVaultArgs {
  query: string;
  directories?: string[];
  max_results?: number;
  date_range?: { start?: string; end?: string };
  snippets_only?: boolean;
  detail?: string;
}

export interface SearchVaultResult {
  content: Array<{ type: string; text: string }>;
}

export async function searchVault(
  args: SearchVaultArgs,
  context: {
    vaultPath: string;
    config: {
      primaryVault: { path: string; name: string };
      secondaryVaults: Array<{ path: string; name: string }>;
    };
    embeddingConfig: {
      enabled: boolean;
      keywordCandidatesLimit: number;
      confidenceThreshold: number;
    };
    indexedSearch?: IndexedSearch;
    indexBuilder?: IndexBuilder;
    ensureVaultStructure: () => Promise<void>;
    loadEmbeddingCache: () => Promise<void>;
    saveEmbeddingCache: () => Promise<void>;
    generateEmbedding: (text: string) => Promise<number[]>;
    getOrCreateEmbedding: (file: string, content: string, fileStats: any) => Promise<number[]>;
    cosineSimilarity: (vecA: number[], vecB: number[]) => number;
    scoreSearchResult: (
      dir: string,
      relPath: string,
      fileName: string,
      content: string,
      fileStats: any,
      queryLower: string,
      queryTerms: string[],
      dateRange?: { start?: string; end?: string },
      absolutePath?: string
    ) => Promise<any>;
    formatSearchResults: (
      results: Array<{
        file: string;
        matches: string[];
        date?: string;
        score: number;
        semanticScore?: number;
        vault?: string;
      }>,
      totalCount: number,
      detail: ResponseDetail,
      hasSemanticSearch: boolean,
      query: string
    ) => { content: Array<{ type: string; text: string }> };
    getAllVaults: () => Array<{ path: string; name: string }>;
  }
): Promise<SearchVaultResult> {
  await context.ensureVaultStructure();
  await context.loadEmbeddingCache(); // Load embedding cache at start of search

  const searchDirs = args.directories || ['sessions', 'topics', 'decisions'];
  const maxResults = args.max_results || 10;

  // Determine detail level (backwards compatible)
  let detailLevel: ResponseDetail;
  if (args.detail) {
    detailLevel = parseDetailLevel(args.detail);
  } else if (args.snippets_only === false) {
    detailLevel = ResponseDetail.FULL;
  } else {
    detailLevel = ResponseDetail.SUMMARY;
  }

  // Try indexed search first if enabled
  const useIndexedSearch = DEFAULT_INDEX_CONFIG.enabled && context.indexedSearch && context.indexBuilder;

  if (useIndexedSearch) {
    try {
      // Ensure index is built (lazy loading)
      // Build index if it doesn't exist
      try {
        await context.indexBuilder!.build({
          vaults: context.getAllVaults(),
          config: DEFAULT_INDEX_CONFIG,
          mode: BuildMode.AUTO, // Will auto-detect if index exists
        });
      } catch (buildError) {
        console.error('[Search] Failed to build index:', buildError);
        throw buildError;
      }

      // Prepare query terms
      const queryTermsArray = args.query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

      // Perform indexed search
      const indexedResults = await context.indexedSearch!.search({
        query: args.query,
        queryTerms: queryTermsArray,
        maxResults,
        directories: args.directories,
        dateRange: args.date_range,
      });

      // Convert indexed results to search result format
      // Note: vault field needs to be inferred from file path
      const convertedResults = indexedResults.map(result => {
        // Find which vault this file belongs to
        const allVaults = context.getAllVaults();
        const matchingVault = allVaults.find(v => result.file.startsWith(v.path));

        return {
          file: result.file,
          matches: result.matches,
          date: result.date,
          score: result.score,
          vault: matchingVault?.name || context.config.primaryVault.name,
          content: result.content,
          fileStats: result.fileStats,
        };
      });

      // If indexed search found no results and embeddings are enabled,
      // fall back to pure semantic search (no keyword filtering)
      if (indexedResults.length === 0 && context.embeddingConfig.enabled) {
        console.log('[Search] Zero indexed results, falling back to pure semantic search');
        // Fall through to linear search with semantic scoring
      } else {
        // Apply semantic re-ranking if enabled
        const finalResults = await applySemanticReranking(
          convertedResults,
          args.query,
          maxResults,
          context
        );

        // Save embedding cache after search
        await context.saveEmbeddingCache();

        // Format and return results
        return context.formatSearchResults(
          finalResults,
          indexedResults.length,
          detailLevel,
          context.embeddingConfig.enabled,
          args.query
        );
      }
    } catch (error) {
      console.error('[Search] Indexed search failed, falling back to linear search:', error);
      // Fall through to linear search
    }
  }

  const results: {
    file: string;
    matches: string[];
    date?: string;
    score: number;
    semanticScore?: number;
    vault?: string;
    content?: string; // Content for semantic re-ranking
    fileStats?: any; // File stats for embedding cache
  }[] = [];
  const queryLower = args.query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  // Generate query embedding if enabled
  let queryEmbedding: number[] | null = null;
  if (context.embeddingConfig.enabled) {
    try {
      queryEmbedding = await context.generateEmbedding(args.query);
    } catch (error) {
      console.error('[Search] Failed to generate query embedding, falling back to keyword search:', error);
    }
  }

  // Recursive function to search directories
  const searchDirectory = async (dirPath: string, relativePath: string = '', vaultName: string) => {
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

              const searchResult = await context.scoreSearchResult(
                'sessions',
                path.join(relativeFilePath, file),
                file,
                content,
                fileStats,
                queryLower,
                queryTerms,
                args.date_range,
                filePath // Pass absolute path for embedding cache key
              );
              if (searchResult) {
                results.push({ ...searchResult, vault: vaultName });
              }
            }
          } else {
            // Recursively search subdirectories
            await searchDirectory(fullPath, relativeFilePath, vaultName);
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

          const searchResult = await context.scoreSearchResult(
            category,
            relativeFilePath,
            entry.name,
            content,
            fileStats,
            queryLower,
            queryTerms,
            args.date_range,
            fullPath // Pass absolute path for embedding cache key
          );
          if (searchResult) {
            results.push({ ...searchResult, vault: vaultName });
          }
        }
      }
    } catch (_error) {
      // Directory doesn't exist or can't be accessed
    }
  };

  // Search across all configured vaults
  const vaults = context.getAllVaults();

  for (const vault of vaults) {
    // For primary vault, search only in standard directories
    const isPrimaryVault = vault.path === context.config.primaryVault.path;

    if (isPrimaryVault) {
      for (const dir of searchDirs) {
        const dirPath = path.join(vault.path, dir);
        await searchDirectory(dirPath, dir, vault.name);
      }
    } else {
      // For secondary vaults, search everything recursively
      await searchDirectory(vault.path, '', vault.name);
    }
  }

  // Save embedding cache after search
  await context.saveEmbeddingCache();

  // Phase 2: Semantic search / re-ranking (if embeddings enabled)
  let topResults: typeof results;

  // Special case: If zero keyword matches but embeddings enabled, do pure semantic search
  if (queryEmbedding && context.embeddingConfig.enabled && results.length === 0) {
    console.log('[Search] Zero keyword matches, performing pure semantic search across all documents');

    // Re-scan all documents with pure semantic scoring (no keyword filter)
    const vaults = context.getAllVaults();
    const allResults: typeof results = [];

    for (const vault of vaults) {
      const isPrimaryVault = vault.path === context.config.primaryVault.path;
      const dirsToScan = isPrimaryVault ? searchDirs : [''];

      for (const dir of dirsToScan) {
        const dirPath = isPrimaryVault ? path.join(vault.path, dir) : vault.path;

        // Recursively collect all .md files
        const collectFiles = async (currentPath: string): Promise<string[]> => {
          const files: string[] = [];
          try {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(currentPath, entry.name);
              if (entry.isDirectory() && !['.git', 'node_modules', '.DS_Store', '.obsidian'].includes(entry.name)) {
                files.push(...await collectFiles(fullPath));
              } else if (entry.isFile() && entry.name.endsWith('.md')) {
                files.push(fullPath);
              }
            }
          } catch (error) {
            // Directory doesn't exist or can't be accessed
          }
          return files;
        };

        const mdFiles = await collectFiles(dirPath);

        // Score each file by semantic similarity
        for (const filePath of mdFiles) {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const fileStats = await fs.stat(filePath);
            const docEmbedding = await context.getOrCreateEmbedding(filePath, content, fileStats);
            const semanticScore = context.cosineSimilarity(queryEmbedding, docEmbedding);

            // Only include documents with meaningful similarity (> 0.3 threshold)
            if (semanticScore > 0.3) {
              const relativePath = filePath.replace(vault.path, '').replace(/^\//, '');
              allResults.push({
                file: relativePath,
                matches: [`Semantic match (score: ${semanticScore.toFixed(3)})`],
                score: semanticScore,
                semanticScore: semanticScore,
                vault: vault.name,
              });
            }
          } catch (error) {
            console.error(`[Search] Failed to score ${filePath}:`, error);
          }
        }
      }
    }

    // Sort by semantic score and take top results
    allResults.sort((a, b) => b.score - a.score);
    topResults = allResults.slice(0, maxResults);

    await context.saveEmbeddingCache();
  } else if (queryEmbedding && context.embeddingConfig.enabled && results.length > 0) {
    // Sort by keyword score and take top N candidates for re-ranking
    results.sort((a, b) => b.score - a.score);

    // Confidence-based optimization: Check if top result is highly confident
    // If so, return it immediately without expensive semantic re-ranking
    const topResult = results[0];
    const confidenceThreshold = context.embeddingConfig.confidenceThreshold || 0.75;

    if (topResult && topResult.score >= confidenceThreshold && maxResults === 1) {
      // Skip semantic re-ranking for high-confidence single result
      delete topResult.content;
      delete topResult.fileStats;
      topResults = [topResult];
    } else {
      // Proceed with semantic re-ranking
      const candidates = results.slice(0, context.embeddingConfig.keywordCandidatesLimit);

      // Compute semantic similarity for each candidate
      for (const result of candidates) {
        if (result.content && result.fileStats) {
          try {
            const docEmbedding = await context.getOrCreateEmbedding(result.file, result.content, result.fileStats);
            const semanticScore = context.cosineSimilarity(queryEmbedding, docEmbedding);
            result.semanticScore = semanticScore;
            result.score = semanticScore; // Use semantic score as final ranking score
          } catch (error) {
            console.error(`[Search] Failed to compute semantic score for ${result.file}:`, error);
            // Keep keyword score if semantic scoring fails
          }
        }
        // Clean up temporary fields
        delete result.content;
        delete result.fileStats;
      }

      // Re-sort by semantic score and take top results
      candidates.sort((a, b) => b.score - a.score);
      topResults = candidates.slice(0, maxResults);
    }
  } else {
    // No semantic re-ranking: just use keyword scores
    results.sort((a, b) => b.score - a.score);
    topResults = results.slice(0, maxResults);

    // Clean up temporary fields
    for (const result of topResults) {
      delete result.content;
      delete result.fileStats;
    }
  }

  // Format and return results using tiered response levels
  return context.formatSearchResults(
    topResults,
    results.length,
    detailLevel,
    queryEmbedding !== null,
    args.query
  );
}

/**
 * Apply semantic re-ranking to search results if embeddings are enabled
 */
async function applySemanticReranking(
  results: Array<{
    file: string;
    matches: string[];
    date?: string;
    score: number;
    vault?: string;
    content?: string;
    fileStats?: any;
  }>,
  query: string,
  maxResults: number,
  context: {
    embeddingConfig: {
      enabled: boolean;
      keywordCandidatesLimit: number;
      confidenceThreshold: number;
    };
    generateEmbedding: (text: string) => Promise<number[]>;
    getOrCreateEmbedding: (file: string, content: string, fileStats: any) => Promise<number[]>;
    cosineSimilarity: (vecA: number[], vecB: number[]) => number;
  }
): Promise<typeof results> {
  if (!context.embeddingConfig.enabled || results.length === 0) {
    return results.slice(0, maxResults);
  }

  try {
    // Generate query embedding
    const queryEmbedding = await context.generateEmbedding(query);

    // Sort by score and take top candidates for re-ranking
    results.sort((a, b) => b.score - a.score);

    // Confidence-based optimization
    const topResult = results[0];
    const confidenceThreshold = context.embeddingConfig.confidenceThreshold || 0.75;

    if (topResult && topResult.score >= confidenceThreshold && maxResults === 1) {
      // Skip semantic re-ranking for high-confidence single result
      return [topResult];
    }

    // Load file contents for semantic re-ranking
    const candidates = results.slice(0, context.embeddingConfig.keywordCandidatesLimit);

    for (const result of candidates) {
      try {
        // Load file content if not already loaded
        if (!result.content) {
          result.content = await fs.readFile(result.file, 'utf-8');
          result.fileStats = await fs.stat(result.file);
        }

        // Compute semantic similarity
        const docEmbedding = await context.getOrCreateEmbedding(
          result.file,
          result.content,
          result.fileStats
        );
        const semanticScore = context.cosineSimilarity(queryEmbedding, docEmbedding);
        result.score = semanticScore;
      } catch (error) {
        console.error(`[Search] Failed to compute semantic score for ${result.file}:`, error);
        // Keep existing score if semantic scoring fails
      }

      // Clean up temporary fields
      delete result.content;
      delete result.fileStats;
    }

    // Re-sort by semantic score and take top results
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, maxResults);
  } catch (error) {
    console.error('[Search] Semantic re-ranking failed:', error);
    // Fall back to original scores
    return results.slice(0, maxResults);
  }
}
