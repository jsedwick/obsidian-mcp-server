/**
 * CacheValidator - Detect changes in vault files
 *
 * Responsibilities:
 * - Compare current file state with cached metadata
 * - Identify added, modified, and deleted files
 * - Support incremental index updates
 * - Validate cache consistency
 * - Track change statistics
 */

import type { ScannedFile } from './FileScanner.js';
import type { DocumentMetadata } from '../../../models/IndexModels.js';
import { DocumentStore } from './DocumentStore.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('CacheValidator');

/**
 * Type of file change detected
 */
export enum ChangeType {
  ADDED = 'added',
  MODIFIED = 'modified',
  DELETED = 'deleted',
  UNCHANGED = 'unchanged',
}

/**
 * Information about a detected file change
 */
export interface FileChange {
  /** Absolute file path */
  path: string;

  /** Type of change */
  changeType: ChangeType;

  /** Current file state (null if deleted) */
  currentFile: ScannedFile | null;

  /** Previous metadata (null if added) */
  previousMetadata: DocumentMetadata | null;

  /** Reason for change detection */
  reason?: string;
}

/**
 * Summary of validation results
 */
export interface ValidationResult {
  /** Total files scanned */
  totalScanned: number;

  /** Total files in cache */
  totalCached: number;

  /** Files added since last build */
  added: number;

  /** Files modified since last build */
  modified: number;

  /** Files deleted since last build */
  deleted: number;

  /** Files unchanged */
  unchanged: number;

  /** Detailed change information */
  changes: FileChange[];

  /** Validation timestamp */
  timestamp: number;
}

/**
 * Options for cache validation
 */
export interface ValidationOptions {
  /**
   * Use hash comparison for change detection
   * If false, only use mtime (faster but less reliable)
   */
  useHashComparison?: boolean;

  /**
   * Skip unchanged files in result
   * Reduces memory usage for large vaults
   */
  skipUnchanged?: boolean;

  /**
   * Maximum mtime difference (ms) to consider files identical
   * Accounts for filesystem timestamp precision
   */
  mtimeTolerance?: number;
}

/**
 * Default validation options
 */
const DEFAULT_VALIDATION_OPTIONS: Required<ValidationOptions> = {
  useHashComparison: true,
  skipUnchanged: true,
  mtimeTolerance: 1000, // 1 second
};

/**
 * Validator for detecting file changes against cached index
 */
export class CacheValidator {
  private options: Required<ValidationOptions>;

  /**
   * Create a new cache validator
   *
   * @param options - Validation options
   */
  constructor(options: ValidationOptions = {}) {
    this.options = {
      ...DEFAULT_VALIDATION_OPTIONS,
      ...options,
    };

    logger.debug('CacheValidator initialized', {
      useHashComparison: this.options.useHashComparison,
      skipUnchanged: this.options.skipUnchanged,
    });
  }

  /**
   * Validate current file state against cached metadata
   *
   * @param scannedFiles - Current files from FileScanner
   * @param documentStore - Cached document metadata
   * @returns Validation result with detected changes
   */
  validate(scannedFiles: ScannedFile[], documentStore: DocumentStore): ValidationResult {
    logger.info('Validating cache', {
      scannedFiles: scannedFiles.length,
      cachedDocuments: documentStore.getTotalDocuments(),
    });

    const changes: FileChange[] = [];
    const scannedPaths = new Set<string>();

    // 1. Check scanned files against cache (detect added/modified)
    for (const file of scannedFiles) {
      scannedPaths.add(file.absolutePath);
      const change = this.detectChange(file, documentStore);

      if (!this.options.skipUnchanged || change.changeType !== ChangeType.UNCHANGED) {
        changes.push(change);
      }
    }

    // 2. Check cached files for deletions
    const allCachedPaths = documentStore.getAllPaths();
    for (const cachedPath of allCachedPaths) {
      if (!scannedPaths.has(cachedPath)) {
        const metadata = documentStore.get(cachedPath);
        changes.push({
          path: cachedPath,
          changeType: ChangeType.DELETED,
          currentFile: null,
          previousMetadata: metadata || null,
          reason: 'File no longer exists',
        });
      }
    }

    // 3. Calculate statistics
    const result: ValidationResult = {
      totalScanned: scannedFiles.length,
      totalCached: documentStore.getTotalDocuments(),
      added: changes.filter(c => c.changeType === ChangeType.ADDED).length,
      modified: changes.filter(c => c.changeType === ChangeType.MODIFIED).length,
      deleted: changes.filter(c => c.changeType === ChangeType.DELETED).length,
      unchanged: changes.filter(c => c.changeType === ChangeType.UNCHANGED).length,
      changes,
      timestamp: Date.now(),
    };

    logger.info('Cache validation complete', {
      added: result.added,
      modified: result.modified,
      deleted: result.deleted,
      unchanged: result.unchanged,
    });

    return result;
  }

  /**
   * Detect change type for a single file
   *
   * @param file - Current file state
   * @param documentStore - Cached metadata
   * @returns File change information
   */
  private detectChange(file: ScannedFile, documentStore: DocumentStore): FileChange {
    const cached = documentStore.get(file.absolutePath);

    // File not in cache = added
    if (!cached) {
      return {
        path: file.absolutePath,
        changeType: ChangeType.ADDED,
        currentFile: file,
        previousMetadata: null,
        reason: 'New file',
      };
    }

    // Compare hash if enabled
    if (this.options.useHashComparison) {
      if (file.hash !== cached.hash) {
        return {
          path: file.absolutePath,
          changeType: ChangeType.MODIFIED,
          currentFile: file,
          previousMetadata: cached,
          reason: 'Content hash mismatch',
        };
      }
    }

    // Compare mtime (with tolerance)
    const mtimeDiff = Math.abs(file.lastModified - cached.lastModified);
    if (mtimeDiff > this.options.mtimeTolerance) {
      return {
        path: file.absolutePath,
        changeType: ChangeType.MODIFIED,
        currentFile: file,
        previousMetadata: cached,
        reason: `Modified time changed (diff: ${mtimeDiff}ms)`,
      };
    }

    // Note: We don't compare file size separately since hash comparison is more reliable
    // If hash matches, content is identical regardless of encoding differences

    // No changes detected
    return {
      path: file.absolutePath,
      changeType: ChangeType.UNCHANGED,
      currentFile: file,
      previousMetadata: cached,
    };
  }

  /**
   * Filter validation result to only changed files
   *
   * @param result - Validation result
   * @returns Changes excluding unchanged files
   */
  getChangedFiles(result: ValidationResult): FileChange[] {
    return result.changes.filter(c => c.changeType !== ChangeType.UNCHANGED);
  }

  /**
   * Filter validation result by change type
   *
   * @param result - Validation result
   * @param changeType - Type of change to filter
   * @returns Filtered changes
   */
  filterByType(result: ValidationResult, changeType: ChangeType): FileChange[] {
    return result.changes.filter(c => c.changeType === changeType);
  }

  /**
   * Get files that need reindexing (added + modified)
   *
   * @param result - Validation result
   * @returns Files requiring index updates
   */
  getFilesNeedingReindex(result: ValidationResult): ScannedFile[] {
    return result.changes
      .filter(c => c.changeType === ChangeType.ADDED || c.changeType === ChangeType.MODIFIED)
      .map(c => c.currentFile!)
      .filter((file): file is ScannedFile => file !== null);
  }

  /**
   * Get paths of deleted files
   *
   * @param result - Validation result
   * @returns Paths of deleted files
   */
  getDeletedPaths(result: ValidationResult): string[] {
    return result.changes
      .filter(c => c.changeType === ChangeType.DELETED)
      .map(c => c.path);
  }

  /**
   * Check if incremental update is worthwhile
   * Returns false if full rebuild would be more efficient
   *
   * @param result - Validation result
   * @param threshold - Percentage threshold (0-1) for incremental vs full
   * @returns True if incremental update recommended
   */
  shouldUseIncrementalUpdate(result: ValidationResult, threshold: number = 0.3): boolean {
    if (result.totalCached === 0) {
      // No cache exists, must do full build
      return false;
    }

    const changedCount = result.added + result.modified + result.deleted;
    const changeRatio = changedCount / result.totalScanned;

    // If more than threshold% of files changed, full rebuild is more efficient
    if (changeRatio > threshold) {
      logger.info('Recommending full rebuild', {
        changeRatio: changeRatio.toFixed(2),
        threshold,
        changedFiles: changedCount,
        totalFiles: result.totalScanned,
      });
      return false;
    }

    logger.info('Recommending incremental update', {
      changeRatio: changeRatio.toFixed(2),
      changedFiles: changedCount,
    });
    return true;
  }

  /**
   * Validate cache consistency
   * Checks for potential issues in cached data
   *
   * @param documentStore - Document store to validate
   * @returns Array of consistency issues found
   */
  validateConsistency(documentStore: DocumentStore): string[] {
    const issues: string[] = [];

    // Check for missing required fields
    const allDocs = documentStore.getAll();
    for (const doc of allDocs) {
      if (!doc.id) {
        issues.push(`Document missing id`);
      }
      if (!doc.path) {
        issues.push(`Document missing path: ${doc.id}`);
      }
      if (doc.contentLength < 0) {
        issues.push(`Document has negative content length: ${doc.id}`);
      }
      if (doc.lastModified <= 0) {
        issues.push(`Document has invalid lastModified: ${doc.id}`);
      }
      if (!doc.hash) {
        issues.push(`Document missing hash: ${doc.id}`);
      }
    }

    // Check for duplicate IDs (shouldn't happen with Map, but validate)
    const idCounts = new Map<string, number>();
    for (const doc of allDocs) {
      const count = idCounts.get(doc.id) || 0;
      idCounts.set(doc.id, count + 1);
    }
    for (const [id, count] of idCounts.entries()) {
      if (count > 1) {
        issues.push(`Duplicate document ID in store: ${id} (${count} occurrences)`);
      }
    }

    if (issues.length > 0) {
      logger.warn('Cache consistency issues found', { issueCount: issues.length });
    } else {
      logger.debug('Cache consistency validated successfully');
    }

    return issues;
  }

  /**
   * Generate a detailed validation report
   *
   * @param result - Validation result
   * @returns Formatted report string
   */
  generateReport(result: ValidationResult): string {
    const lines: string[] = [];

    lines.push('Cache Validation Report');
    lines.push('======================');
    lines.push('');
    lines.push(`Timestamp: ${new Date(result.timestamp).toISOString()}`);
    lines.push(`Total Files Scanned: ${result.totalScanned}`);
    lines.push(`Total Files Cached: ${result.totalCached}`);
    lines.push('');
    lines.push('Changes Detected:');
    lines.push(`  Added:     ${result.added}`);
    lines.push(`  Modified:  ${result.modified}`);
    lines.push(`  Deleted:   ${result.deleted}`);
    lines.push(`  Unchanged: ${result.unchanged}`);
    lines.push('');

    const changeRatio = result.totalScanned > 0
      ? ((result.added + result.modified + result.deleted) / result.totalScanned * 100).toFixed(1)
      : '0.0';
    lines.push(`Change Ratio: ${changeRatio}%`);

    const recommendation = this.shouldUseIncrementalUpdate(result)
      ? 'INCREMENTAL UPDATE'
      : 'FULL REBUILD';
    lines.push(`Recommendation: ${recommendation}`);

    return lines.join('\n');
  }

  /**
   * Get detailed change information for debugging
   *
   * @param result - Validation result
   * @param changeType - Optional filter by change type
   * @returns Detailed change descriptions
   */
  getChangeDetails(result: ValidationResult, changeType?: ChangeType): string[] {
    const changes = changeType
      ? this.filterByType(result, changeType)
      : this.getChangedFiles(result);

    return changes.map(change => {
      const type = change.changeType.toUpperCase().padEnd(10);
      const path = change.path;
      const reason = change.reason ? ` (${change.reason})` : '';
      return `${type} ${path}${reason}`;
    });
  }
}
