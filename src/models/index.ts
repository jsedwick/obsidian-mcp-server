/**
 * Models barrel export
 */

export type { VaultConfig, VaultStructure, VaultFile, VaultSearchOptions } from './Vault.js';
export { VaultDirectory } from './Vault.js';

export type {
  SearchOptions,
  SearchMatch,
  InternalSearchMatch,
  SearchResults,
  DateRange,
  EmbeddingConfig,
  CachedEmbedding,
  KeywordScoreFactors,
  FileMetadata,
} from './Search.js';
export { ResponseDetail, parseDetailLevel } from './Search.js';

export type {
  RepoCandidate,
  RepositoryInfo,
  GitCommandResult,
  GitBranchInfo,
  GitRemoteInfo,
  GitCommitInfo,
  GitDiffStats,
  RepositoryDetectionOptions,
} from './Git.js';

export type {
  FileAccessAction,
  FileAccess,
  SessionStatus,
  SessionMetadata,
  SessionCloseOptions,
  SessionCloseResult,
  SessionContext,
  SessionListEntry,
} from './Session.js';

export type {
  DocumentPosting,
  FieldScore,
  FieldBoosts,
  DocumentMetadata,
  IndexStatistics,
  BM25Parameters,
  TokenizationOptions,
  Term,
  FileChange,
  IndexMetadata,
  SerializedIndexEntry,
  SerializedDocumentEntry,
  IndexPaths,
  IndexConfiguration,
  IndexedSearchResult,
} from './IndexModels.js';
export {
  IndexField,
  DEFAULT_FIELD_BOOSTS,
  DEFAULT_BM25_PARAMS,
  DEFAULT_TOKENIZATION_OPTIONS,
  DEFAULT_INDEX_CONFIG,
} from './IndexModels.js';
