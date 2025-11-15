/**
 * Vault-related type definitions
 *
 * Types for vault configuration, structure, and operations.
 */

/**
 * Configuration for a single vault
 */
export interface VaultConfig {
  path: string;
  name: string;
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
