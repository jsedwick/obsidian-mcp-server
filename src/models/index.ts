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
