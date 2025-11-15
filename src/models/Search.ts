/**
 * Search domain models and interfaces
 *
 * This file defines all types related to search functionality:
 * - Search queries and options
 * - Search results and matches
 * - Response detail levels
 */

/**
 * Response detail level for search results
 */
export enum ResponseDetail {
  MINIMAL = 'minimal', // File paths only
  SUMMARY = 'summary', // File paths + snippets (default)
  DETAILED = 'detailed', // Extended context
  FULL = 'full', // Complete file contents
}

/**
 * Parse detail level string to enum
 */
export function parseDetailLevel(detail: string): ResponseDetail {
  const normalized = detail.toLowerCase();
  switch (normalized) {
    case 'minimal':
      return ResponseDetail.MINIMAL;
    case 'summary':
      return ResponseDetail.SUMMARY;
    case 'detailed':
      return ResponseDetail.DETAILED;
    case 'full':
      return ResponseDetail.FULL;
    default:
      return ResponseDetail.SUMMARY;
  }
}

/**
 * Date range filter for search
 */
export interface DateRange {
  start?: string;
  end?: string;
}

/**
 * Search query options
 */
export interface SearchOptions {
  /** Search query string */
  query: string;
  /** Directories to search in (relative to vault root) */
  directories?: string[];
  /** Maximum number of results to return */
  maxResults?: number;
  /** Date range filter */
  dateRange?: DateRange;
  /** Response detail level */
  detail?: ResponseDetail;
}

/**
 * Search match result
 */
export interface SearchMatch {
  /** File path (relative to vault root or absolute) */
  file: string;
  /** Matching lines/snippets */
  matches: string[];
  /** File date (if available) */
  date?: string;
  /** Overall relevance score */
  score: number;
  /** Semantic similarity score (if available) */
  semanticScore?: number;
  /** Vault name (for multi-vault support) */
  vault?: string;
}

/**
 * Internal search result (includes temporary fields for processing)
 */
export interface InternalSearchMatch extends SearchMatch {
  /** Full file content (for semantic re-ranking) */
  content?: string;
  /** File statistics (for embedding cache) */
  fileStats?: any;
}

/**
 * Search result summary
 */
export interface SearchResults {
  /** Matching results */
  results: SearchMatch[];
  /** Total number of matches before limiting */
  totalMatches: number;
  /** Whether semantic search was used */
  usedSemanticSearch: boolean;
  /** Original query */
  query: string;
  /** Number of vaults searched */
  vaultsSearched: number;
}

/**
 * Embedding configuration
 */
export interface EmbeddingConfig {
  /** Whether semantic search is enabled */
  enabled: boolean;
  /** Maximum number of keyword candidates to re-rank semantically */
  keywordCandidatesLimit: number;
  /** Model name for embeddings */
  model: string;
}

/**
 * Cached embedding with metadata
 */
export interface CachedEmbedding {
  /** The embedding vector */
  embedding: number[];
  /** Last time this embedding was accessed */
  lastAccessed: Date;
  /** Number of times accessed */
  accessCount: number;
}

/**
 * Keyword scoring factors
 */
export interface KeywordScoreFactors {
  /** Exact phrase match bonus */
  exactPhrase: number;
  /** Term frequency score */
  termFrequency: number;
  /** Position-based score (headers, first paragraph, etc.) */
  position: number;
  /** Filename match score */
  filename: number;
  /** Tag match score */
  tags: number;
  /** Recency score */
  recency: number;
  /** Review status score (for topics) */
  reviewStatus: number;
}

/**
 * File metadata for search scoring
 */
export interface FileMetadata {
  /** File path */
  path: string;
  /** File category (sessions, topics, decisions, etc.) */
  category: string;
  /** File date (extracted from frontmatter or filename) */
  date?: string;
  /** File statistics (size, modified time, etc.) */
  stats: any;
  /** Parsed frontmatter */
  frontmatter?: Record<string, unknown>;
}
