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
