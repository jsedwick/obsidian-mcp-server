/**
 * Custom error types for Obsidian MCP Server
 *
 * Provides structured error handling with error codes and contextual details.
 */

/**
 * Base error class for all Obsidian MCP errors
 *
 * All custom errors should extend this class to maintain consistent error handling.
 */
export class ObsidianMCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to user-friendly message
   */
  toUserMessage(): string {
    return `${this.message}\n\nError code: ${this.code}`;
  }

  /**
   * Convert error to structured log format
   */
  toLogFormat(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Vault-related errors (file I/O, structure issues)
 *
 * @example
 * ```typescript
 * throw new VaultError('Failed to read file', { path: '/vault/topics/test.md' });
 * ```
 */
export class VaultError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VAULT_ERROR', details);
  }
}

/**
 * Search-related errors (query parsing, ranking failures)
 *
 * @example
 * ```typescript
 * throw new SearchError('Invalid search query', { query: 'test' });
 * ```
 */
export class SearchError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SEARCH_ERROR', details);
  }
}

/**
 * Git-related errors (command failures, repository issues)
 *
 * @example
 * ```typescript
 * throw new GitError('Repository not found', { path: '/path/to/repo' });
 * ```
 */
export class GitError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'GIT_ERROR', details);
  }
}

/**
 * Validation errors (invalid input, schema violations)
 *
 * @example
 * ```typescript
 * throw new ValidationError('Invalid topic name', { topic: '' });
 * ```
 */
export class ValidationError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

/**
 * Configuration errors (invalid config, missing required fields)
 *
 * @example
 * ```typescript
 * throw new ConfigError('Missing vault path', { config: configObj });
 * ```
 */
export class ConfigError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
  }
}

/**
 * Embedding-related errors (model load failures, cache issues)
 *
 * @example
 * ```typescript
 * throw new EmbeddingError('Failed to load model', { model: 'all-MiniLM-L6-v2' });
 * ```
 */
export class EmbeddingError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EMBEDDING_ERROR', details);
  }
}

/**
 * Session-related errors (lifecycle issues, tracking failures)
 *
 * @example
 * ```typescript
 * throw new SessionError('Session not found', { sessionId: '2024-01-01_12-00-00' });
 * ```
 */
export class SessionError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SESSION_ERROR', details);
  }
}

/**
 * Migration-related errors (version conflicts, migration failures)
 *
 * @example
 * ```typescript
 * throw new MigrationError('Migration failed', { version: '2.0.0', step: 'cache' });
 * ```
 */
export class MigrationError extends ObsidianMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'MIGRATION_ERROR', details);
  }
}
