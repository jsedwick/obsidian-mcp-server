/**
 * Vault-related type definitions
 *
 * Types for vault configuration, structure, and operations.
 */

/**
 * Vault authority level for search ranking
 *
 * - curated: All content treated as authoritative (e.g., professional documentation)
 * - default: Use directory-based ranking (topics > decisions > sessions)
 * - conversational: All content treated as historical/lower priority
 */
export type VaultAuthority = 'curated' | 'default' | 'conversational';

/**
 * Configuration for a single vault
 */
export interface VaultConfig {
  path: string;
  name: string;
  /**
   * Content authority level for search ranking.
   * Defaults to 'default' if not specified.
   *
   * - curated: Professional/curated content (ranks with topics)
   * - default: Use directory-based ranking
   * - conversational: Historical/draft content (ranks with sessions)
   */
  authority?: VaultAuthority;
}

/**
 * Vault structure metadata
 */
export interface VaultStructure {
  hasSessionsDir: boolean;
  hasTopicsDir: boolean;
  hasDecisionsDir: boolean;
  hasProjectsDir: boolean;
  directories: string[];
}

/**
 * Vault directory types
 */
export enum VaultDirectory {
  SESSIONS = 'sessions',
  TOPICS = 'topics',
  DECISIONS = 'decisions',
  PROJECTS = 'projects',
  ARCHIVE = 'archive',
}

/**
 * File metadata in vault
 */
export interface VaultFile {
  path: string;
  relativePath: string;
  content: string;
  vaultName: string;
  vaultPath: string;
  isPrimary: boolean;
}

/**
 * Search options for vault operations
 */
export interface VaultSearchOptions {
  pattern?: string;
  directory?: VaultDirectory;
  recursive?: boolean;
  includeArchive?: boolean;
}
