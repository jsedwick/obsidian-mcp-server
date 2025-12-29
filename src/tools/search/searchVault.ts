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
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('SearchVault');

export interface SearchVaultArgs {
  query: string;
  directories?: string[];
  category?: 'topic' | 'task-list' | 'decision' | 'session' | 'project' | 'commit';
  max_results?: number;
  date_range?: { start?: string; end?: string };
  snippets_only?: boolean;
  detail?: string;
  include_archived?: boolean;
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
      enableSmartSearch?: boolean;
    };
    indexedSearches: Map<string, IndexedSearch>;
    indexBuilders: Map<string, IndexBuilder>;
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
      absolutePath?: string,
      includeArchived?: boolean
    ) => {
      file: string;
      matches: string[];
      date?: string;
      score: number;
      content?: string;
      fileStats?: any;
    } | null;
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
  const useIndexedSearch =
    DEFAULT_INDEX_CONFIG.enabled &&
    context.indexedSearches.size > 0 &&
    context.indexBuilders.size > 0;

  if (useIndexedSearch) {
    try {
      // Prepare query terms
      const queryTermsArray = args.query
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2);

      // Search each vault's index and merge results
      const allIndexedResults: any[] = [];
      const allVaults = context.getAllVaults();

      // Debug logging
      // Debug logging disabled - causes JSON-RPC parsing errors in Claude Desktop
      // console.error(
      //   '[Search] All vaults:',
      //   allVaults.map(v => ({ name: v.name, path: v.path }))
      // );
      // console.error('[Search] IndexBuilders keys:', Array.from(context.indexBuilders.keys()));
      // console.error('[Search] IndexedSearches keys:', Array.from(context.indexedSearches.keys()));

      for (const vault of allVaults) {
        // Debug logging disabled - causes JSON-RPC parsing errors in Claude Desktop
        // console.error(`[Search] Looking up vault: ${vault.name} at path: ${vault.path}`);
        const builder = context.indexBuilders.get(vault.path);
        const searcher = context.indexedSearches.get(vault.path);

        // Debug logging disabled - causes JSON-RPC parsing errors in Claude Desktop
        // console.error(`[Search] Found builder: ${!!builder}, Found searcher: ${!!searcher}`);

        if (!builder || !searcher) {
          // Debug logging disabled - causes JSON-RPC parsing errors in Claude Desktop
          // console.error(`[Search] No index for vault ${vault.name}, skipping`);
          continue;
        }

        // Ensure index is built for this vault (lazy loading)
        try {
          await builder.build({
            vaults: [vault], // Build index for just this vault
            config: DEFAULT_INDEX_CONFIG,
            mode: BuildMode.AUTO, // Will auto-detect if index exists
          });
        } catch (buildError) {
          logger.error(
            `Failed to build index for vault ${vault.name}`,
            buildError instanceof Error ? buildError : new Error(String(buildError))
          );
          continue; // Skip this vault but try others
        }

        // Perform indexed search on this vault
        try {
          const isPrimaryVault = vault.path === context.config.primaryVault.path;

          // Categories that only exist in primary vault - skip secondary vaults when filtering by these
          const primaryVaultOnlyCategories = ['topic', 'decision', 'project', 'commit', 'session'];
          const isPrimaryVaultOnlyCategory =
            args.category && primaryVaultOnlyCategories.includes(args.category);

          // Skip secondary vaults when searching for primary-vault-only categories
          // Topics, decisions, projects, commits, and sessions only exist in primary vault
          if (!isPrimaryVault && isPrimaryVaultOnlyCategory) {
            continue;
          }

          // For secondary vaults, search all directories and skip category filtering
          // (they don't have the same structure or frontmatter as primary vault)
          const directoriesToSearch = isPrimaryVault ? args.directories : undefined;
          const categoryToFilter = isPrimaryVault ? args.category : undefined;

          const vaultResults = await searcher.search({
            query: args.query,
            queryTerms: queryTermsArray,
            maxResults, // Each vault can return up to maxResults
            directories: directoriesToSearch,
            category: categoryToFilter,
            dateRange: args.date_range,
            includeArchived: args.include_archived,
          });

          // Add vault information to results
          vaultResults.forEach(result => {
            allIndexedResults.push({
              ...result,
              vault: vault.name,
            });
          });
        } catch (searchError) {
          logger.error(
            `Failed to search vault ${vault.name}`,
            searchError instanceof Error ? searchError : new Error(String(searchError))
          );
          continue; // Skip this vault but try others
        }
      }

      // Sort combined results by score and limit to maxResults
      allIndexedResults.sort((a, b) => b.score - a.score);
      const indexedResults = allIndexedResults.slice(0, maxResults);

      // Convert indexed results to search result format
      const convertedResults = indexedResults.map(result => ({
        file: result.file,
        matches: result.matches,
        date: result.date,
        score: result.score,
        vault: result.vault,
        content: result.content,
        fileStats: result.fileStats,
      }));

      // If indexed search found no results and embeddings are enabled,
      // fall back to pure semantic search (no keyword filtering)
      if (indexedResults.length === 0 && context.embeddingConfig.enabled) {
        logger.info('Zero indexed results, falling back to pure semantic search');
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
      logger.error(
        'Indexed search failed, falling back to linear search',
        error instanceof Error ? error : new Error(String(error))
      );
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
      logger.error(
        'Failed to generate query embedding, falling back to keyword search',
        error instanceof Error ? error : new Error(String(error))
      );
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

              const searchResult = context.scoreSearchResult(
                'sessions',
                path.join(relativeFilePath, file),
                file,
                content,
                fileStats,
                queryLower,
                queryTerms,
                args.date_range,
                filePath, // Pass absolute path for embedding cache key
                args.include_archived
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
          if (relativeFilePath.includes('sessions')) category = 'session';
          else if (relativeFilePath.includes('topics')) category = 'topic';
          else if (relativeFilePath.includes('decisions')) category = 'decision';

          const searchResult = context.scoreSearchResult(
            category,
            relativeFilePath,
            entry.name,
            content,
            fileStats,
            queryLower,
            queryTerms,
            args.date_range,
            fullPath, // Pass absolute path for embedding cache key
            args.include_archived
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
    const useSmartSearch = context.embeddingConfig.enableSmartSearch !== false;
    console.log(
      `[Search] Zero keyword matches, performing ${useSmartSearch ? 'smart' : 'standard'} semantic search`
    );

    // Hard limit to prevent unbounded memory growth on large vaults
    // Even with smart search disabled, we cap at 500 files (most recent first)
    const SEMANTIC_SEARCH_HARD_LIMIT = 500;

    // Analyze query for optimization hints (if smart search enabled)
    let queryHints = null;
    if (useSmartSearch) {
      const { analyzeQuery } = await import('../../utils/queryAnalysis.js');
      queryHints = analyzeQuery(args.query);

      logger.debug('Query hints analyzed', {
        temporal: queryHints.temporal,
        scope: queryHints.scopeDirectories,
        sort: queryHints.sortPreference,
        maxFiles: queryHints.maxFilesToScan || 'unlimited',
      });
    }

    // Re-scan all documents with pure semantic scoring (no keyword filter)
    const vaults = context.getAllVaults();
    const allResults: typeof results = [];

    // Collect files from ALL vaults first, then sort globally by recency
    const allFilesGlobal: Array<{
      path: string;
      stats: { mtime: Date };
      vault: (typeof vaults)[0];
    }> = [];

    for (const vault of vaults) {
      const isPrimaryVault = vault.path === context.config.primaryVault.path;
      const dirsToScan = isPrimaryVault ? searchDirs : [''];

      for (const dir of dirsToScan) {
        const dirPath = isPrimaryVault ? path.join(vault.path, dir) : vault.path;

        // Recursively collect all .md files with metadata
        const collectFilesWithStats = async (
          currentPath: string
        ): Promise<Array<{ path: string; stats: { mtime: Date } }>> => {
          const files: Array<{ path: string; stats: { mtime: Date } }> = [];
          try {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(currentPath, entry.name);
              if (
                entry.isDirectory() &&
                !['.git', 'node_modules', '.DS_Store', '.obsidian', '.embedding-cache'].includes(
                  entry.name
                )
              ) {
                files.push(...(await collectFilesWithStats(fullPath)));
              } else if (entry.isFile() && entry.name.endsWith('.md')) {
                try {
                  const stats = await fs.stat(fullPath);
                  files.push({ path: fullPath, stats: { mtime: stats.mtime } });
                } catch {
                  // Skip files we can't stat
                }
              }
            }
          } catch {
            // Directory doesn't exist or can't be accessed
          }
          return files;
        };

        const allFiles = await collectFilesWithStats(dirPath);
        // Tag each file with its vault for later processing
        allFilesGlobal.push(...allFiles.map(f => ({ ...f, vault })));
      }
    }

    // Sort ALL files by mtime (most recent first) - this ensures we process recent files first
    allFilesGlobal.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

    // Apply smart filtering based on query hints (if enabled)
    let filesToScore = allFilesGlobal;
    if (useSmartSearch && queryHints) {
      const { applyFileFilters } = await import('../../utils/queryAnalysis.js');
      // applyFileFilters expects {path, stats} - it will handle the extra vault field
      filesToScore = applyFileFilters(allFilesGlobal, queryHints) as typeof allFilesGlobal;

      const filesBeforeFilter = allFilesGlobal.length;
      const filesAfterFilter = filesToScore.length;

      if (filesBeforeFilter > filesAfterFilter) {
        const reductionPct = Math.round((1 - filesAfterFilter / filesBeforeFilter) * 100);
        logger.debug('Smart filtering applied', {
          before: filesBeforeFilter,
          after: filesAfterFilter,
          reductionPercent: reductionPct,
        });
      }
    }

    // Apply hard limit to prevent memory issues on very large vaults
    const effectiveLimit = queryHints?.maxFilesToScan
      ? Math.min(queryHints.maxFilesToScan, SEMANTIC_SEARCH_HARD_LIMIT)
      : SEMANTIC_SEARCH_HARD_LIMIT;

    if (filesToScore.length > effectiveLimit) {
      logger.debug('Applying hard limit to semantic search', {
        filesBeforeLimit: filesToScore.length,
        effectiveLimit,
      });
      filesToScore = filesToScore.slice(0, effectiveLimit);
    }

    // Score each file by semantic similarity
    for (const fileInfo of filesToScore) {
      const vault = fileInfo.vault;
      try {
        const content = await fs.readFile(fileInfo.path, 'utf-8');
        const fileStats = await fs.stat(fileInfo.path);
        const docEmbedding = await context.getOrCreateEmbedding(fileInfo.path, content, fileStats);
        const semanticScore = context.cosineSimilarity(queryEmbedding, docEmbedding);

        // Only include documents with meaningful similarity (> 0.3 threshold)
        if (semanticScore > 0.3) {
          const relativePath = fileInfo.path.replace(vault.path, '').replace(/^\//, '');
          allResults.push({
            file: relativePath,
            matches: [`Semantic match (score: ${semanticScore.toFixed(3)})`],
            score: semanticScore,
            semanticScore: semanticScore,
            vault: vault.name,
          });
        }
      } catch (error) {
        logger.error(
          `Failed to score ${fileInfo.path}`,
          error instanceof Error ? error : new Error(String(error))
        );
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
            const docEmbedding = await context.getOrCreateEmbedding(
              result.file,
              result.content,
              result.fileStats
            );
            const semanticScore = context.cosineSimilarity(queryEmbedding, docEmbedding);
            result.semanticScore = semanticScore;
            result.score = semanticScore; // Use semantic score as final ranking score
          } catch (error) {
            logger.error(
              `Failed to compute semantic score for ${result.file}`,
              error instanceof Error ? error : new Error(String(error))
            );
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
        logger.error(
          `Failed to compute semantic score for ${result.file}`,
          error instanceof Error ? error : new Error(String(error))
        );
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
    logger.error(
      'Semantic re-ranking failed',
      error instanceof Error ? error : new Error(String(error))
    );
    // Fall back to original scores
    return results.slice(0, maxResults);
  }
}
