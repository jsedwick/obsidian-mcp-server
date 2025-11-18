/**
 * Index domain models and interfaces
 *
 * This file defines all types related to inverted index functionality:
 * - Trie nodes and postings
 * - Document metadata and storage
 * - BM25 scoring parameters
 * - Index persistence
 */

/**
 * A single posting in the inverted index
 * Represents one document containing a term
 */
export interface DocumentPosting {
  /** Document ID (absolute file path) */
  docId: string;

  /** How many times this term appears in the document */
  termFrequency: number;

  /** Positions where term appears (for phrase search in future) */
  positions: number[];

  /** Scores broken down by field type */
  fieldScores: FieldScore[];
}

/**
 * Score contribution from a specific field
 */
export interface FieldScore {
  /** Field type */
  field: IndexField;

  /** Number of times term appears in this field */
  frequency: number;

  /** Boost multiplier for this field (e.g., title=2.0, content=1.0) */
  boost: number;
}

/**
 * Document fields that can be indexed
 */
export enum IndexField {
  TITLE = 'title',
  CONTENT = 'content',
  TAGS = 'tags',
  FRONTMATTER = 'frontmatter',
}

/**
 * Field boost configuration
 */
export interface FieldBoosts {
  [IndexField.TITLE]: number;
  [IndexField.CONTENT]: number;
  [IndexField.TAGS]: number;
  [IndexField.FRONTMATTER]: number;
}

/**
 * Default field boost values
 * Title and tags are more important than content
 */
export const DEFAULT_FIELD_BOOSTS: FieldBoosts = {
  [IndexField.TITLE]: 2.0,
  [IndexField.CONTENT]: 1.0,
  [IndexField.TAGS]: 1.5,
  [IndexField.FRONTMATTER]: 1.2,
};

/**
 * Document metadata stored alongside the index
 * Used for BM25 scoring and cache invalidation
 */
export interface DocumentMetadata {
  /** Unique document ID (absolute file path) */
  id: string;

  /** Absolute file path (enables direct use with Read and other file tools) */
  path: string;

  /** Document category (sessions, topics, decisions, etc.) */
  category: string;

  /** Vault name (for multi-vault support) */
  vault: string;

  /** Document date (extracted from frontmatter or filename) */
  date?: string;

  /** Last modified timestamp (for cache invalidation) */
  lastModified: number;

  /** Document length in tokens (for BM25 length normalization) */
  contentLength: number;

  /** Content hash for change detection */
  hash: string;

  /** Cached frontmatter (for quick access) */
  frontmatter?: {
    created?: string;
    last_reviewed?: string;
    tags?: string[];
  };
}

/**
 * Statistics for BM25 scoring
 */
export interface IndexStatistics {
  /** Total number of documents in the index */
  totalDocuments: number;

  /** Average document length (in tokens) */
  averageDocumentLength: number;

  /** Total number of unique terms */
  totalTerms: number;

  /** Document frequency for each term (how many docs contain it) */
  documentFrequency: Map<string, number>;
}

/**
 * BM25 scoring parameters
 */
export interface BM25Parameters {
  /**
   * Term frequency saturation parameter
   * Controls how quickly additional term occurrences have diminishing returns
   * Typical range: 1.2 - 2.0
   * Default: 1.2
   */
  k1: number;

  /**
   * Length normalization parameter
   * Controls how much document length affects scoring
   * Range: 0 (no normalization) - 1 (full normalization)
   * Default: 0.75
   */
  b: number;
}

/**
 * Default BM25 parameters (industry standard)
 */
export const DEFAULT_BM25_PARAMS: BM25Parameters = {
  k1: 1.2,
  b: 0.75,
};

/**
 * Tokenization options
 */
export interface TokenizationOptions {
  /** Minimum term length to index */
  minTermLength: number;

  /** Whether to remove stop words */
  removeStopWords: boolean;

  /** Custom stop words list (if removeStopWords is true) */
  stopWords?: Set<string>;

  /** Whether to apply stemming (not implemented in v1) */
  applyStemming: boolean;
}

/**
 * Default tokenization options
 */
export const DEFAULT_TOKENIZATION_OPTIONS: TokenizationOptions = {
  minTermLength: 3,
  removeStopWords: false, // Disabled by default for exact matching
  stopWords: new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
  ]),
  applyStemming: false, // Deferred to v2
};

/**
 * A term extracted during tokenization
 */
export interface Term {
  /** The normalized term text */
  text: string;

  /** Position in the document (for phrase search) */
  position: number;

  /** Field this term came from */
  field: IndexField;
}

/**
 * File change detected by cache validator
 */
export interface FileChange {
  /** Absolute file path */
  path: string;

  /** Type of change */
  type: 'added' | 'modified' | 'deleted';

  /** File content (for added/modified) */
  content?: string;

  /** Document metadata (for added/modified) */
  metadata?: DocumentMetadata;
}

/**
 * Index metadata (persisted with the index)
 */
export interface IndexMetadata {
  /** Index format version (for migrations) */
  version: string;

  /** When the index was last built */
  lastBuilt: Date;

  /** When the index was last validated */
  lastValidated: Date;

  /** Statistics about the index */
  statistics: IndexStatistics;

  /** Configuration used to build the index */
  configuration: {
    tokenization: TokenizationOptions;
    fieldBoosts: FieldBoosts;
    bm25: BM25Parameters;
  };
}

/**
 * Serialized format for inverted index (JSONL)
 */
export interface SerializedIndexEntry {
  /** The term */
  term: string;

  /** Postings for this term */
  postings: DocumentPosting[];
}

/**
 * Serialized format for document store (JSONL)
 */
export interface SerializedDocumentEntry {
  /** Document metadata */
  metadata: DocumentMetadata;
}

/**
 * Index persistence paths
 */
export interface IndexPaths {
  /** Root directory for index files */
  root: string;

  /** Inverted index JSONL file */
  invertedIndex: string;

  /** Document store JSONL file */
  documentStore: string;

  /** Index metadata JSON file */
  metadata: string;
}

/**
 * Index configuration
 */
export interface IndexConfiguration {
  /** Whether indexed search is enabled */
  enabled: boolean;

  /** Index cache directory */
  cacheDir: string;

  /** Full rebuild interval (in hours, 0 = never) */
  rebuildInterval: number;

  /** Whether to watch files for changes */
  watchFiles: boolean;

  /** Tokenization options */
  tokenization: TokenizationOptions;

  /** Field boost configuration */
  fieldBoosts: FieldBoosts;

  /** BM25 parameters */
  bm25: BM25Parameters;

  /** Debug mode (compare indexed vs linear results) */
  debug: boolean;
}

/**
 * Default index configuration
 */
export const DEFAULT_INDEX_CONFIG: IndexConfiguration = {
  enabled: true, // Enabled by default (Phase 6: Migration)
  cacheDir: '.search-index',
  rebuildInterval: 168, // Weekly
  watchFiles: false, // Opt-in
  tokenization: DEFAULT_TOKENIZATION_OPTIONS,
  fieldBoosts: DEFAULT_FIELD_BOOSTS,
  bm25: DEFAULT_BM25_PARAMS,
  debug: false,
};

/**
 * Query result from indexed search
 */
export interface IndexedSearchResult {
  /** Document ID */
  docId: string;

  /** BM25 relevance score */
  score: number;

  /** Matching terms found in this document */
  matchingTerms: string[];

  /** Document metadata */
  metadata: DocumentMetadata;
}
