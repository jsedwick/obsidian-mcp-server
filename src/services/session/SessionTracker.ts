/**
 * SessionTracker - File access tracking for sessions
 *
 * Responsible for:
 * - Tracking file read/edit/create operations
 * - Maintaining chronological access log
 * - Filtering and querying file access patterns
 * - Providing access statistics
 */

import { createLogger } from '../../utils/logger.js';
import type { FileAccess, FileAccessAction } from '../../models/Session.js';

const logger = createLogger('SessionTracker');

/**
 * File access statistics
 */
export interface FileAccessStats {
  /** Total files accessed */
  totalFiles: number;
  /** Files read */
  filesRead: number;
  /** Files edited */
  filesEdited: number;
  /** Files created */
  filesCreated: number;
  /** Unique files accessed */
  uniqueFiles: number;
  /** File access timeline (first and last access) */
  timeline: {
    firstAccess: string;
    lastAccess: string;
  };
}

/**
 * Service for tracking file access during sessions
 */
export class SessionTracker {
  private filesAccessed: FileAccess[] = [];

  constructor() {
    logger.info('SessionTracker initialized');
  }

  /**
   * Track a file access operation
   *
   * @param path - Absolute file path
   * @param action - Type of access (read/edit/create)
   * @param timestamp - Optional timestamp (defaults to now)
   */
  trackAccess(path: string, action: FileAccessAction, timestamp?: string): void {
    const accessTime = timestamp || new Date().toISOString();

    this.filesAccessed.push({
      path,
      action,
      timestamp: accessTime,
    });

    logger.debug('File access tracked', { path, action, timestamp: accessTime });
  }

  /**
   * Get all file access records
   *
   * @returns Array of file access records
   */
  getAllAccess(): FileAccess[] {
    return [...this.filesAccessed];
  }

  /**
   * Get file access records filtered by action
   *
   * @param action - Action type to filter by
   * @returns Filtered file access records
   */
  getAccessByAction(action: FileAccessAction): FileAccess[] {
    return this.filesAccessed.filter(f => f.action === action);
  }

  /**
   * Get file access records filtered by path prefix
   *
   * @param pathPrefix - Path prefix to filter by
   * @returns Filtered file access records
   */
  getAccessByPathPrefix(pathPrefix: string): FileAccess[] {
    return this.filesAccessed.filter(f => f.path.startsWith(pathPrefix));
  }

  /**
   * Get file access records for a specific file
   *
   * @param filePath - Exact file path
   * @returns File access records for the file
   */
  getAccessForFile(filePath: string): FileAccess[] {
    return this.filesAccessed.filter(f => f.path === filePath);
  }

  /**
   * Get unique file paths accessed
   *
   * @returns Array of unique file paths
   */
  getUniqueFiles(): string[] {
    const uniquePaths = new Set(this.filesAccessed.map(f => f.path));
    return Array.from(uniquePaths);
  }

  /**
   * Get files that were edited or created (modified)
   *
   * @returns Array of modified file paths
   */
  getModifiedFiles(): string[] {
    const modifiedPaths = new Set(
      this.filesAccessed.filter(f => f.action === 'edit' || f.action === 'create').map(f => f.path)
    );
    return Array.from(modifiedPaths);
  }

  /**
   * Get file access statistics
   *
   * @returns File access statistics
   */
  getStats(): FileAccessStats {
    const uniqueFiles = this.getUniqueFiles();
    const filesRead = this.getAccessByAction('read').length;
    const filesEdited = this.getAccessByAction('edit').length;
    const filesCreated = this.getAccessByAction('create').length;

    let firstAccess = '';
    let lastAccess = '';

    if (this.filesAccessed.length > 0) {
      firstAccess = this.filesAccessed[0].timestamp;
      lastAccess = this.filesAccessed[this.filesAccessed.length - 1].timestamp;
    }

    const stats: FileAccessStats = {
      totalFiles: this.filesAccessed.length,
      filesRead,
      filesEdited,
      filesCreated,
      uniqueFiles: uniqueFiles.length,
      timeline: {
        firstAccess,
        lastAccess,
      },
    };

    logger.debug('Generated file access stats', stats);

    return stats;
  }

  /**
   * Check if any files have been accessed
   *
   * @returns true if files have been accessed
   */
  hasAccess(): boolean {
    return this.filesAccessed.length > 0;
  }

  /**
   * Check if a specific file has been accessed
   *
   * @param filePath - File path to check
   * @returns true if file has been accessed
   */
  hasAccessedFile(filePath: string): boolean {
    return this.filesAccessed.some(f => f.path === filePath);
  }

  /**
   * Clear all tracked file access
   *
   * Used when closing a session to reset for next session
   */
  clear(): void {
    const previousCount = this.filesAccessed.length;
    this.filesAccessed = [];
    logger.info('File access tracker cleared', { previousCount });
  }

  /**
   * Get access count
   *
   * @returns Number of file access records
   */
  getAccessCount(): number {
    return this.filesAccessed.length;
  }

  /**
   * Get most recently accessed file
   *
   * @returns Most recent file access or null if none
   */
  getMostRecentAccess(): FileAccess | null {
    if (this.filesAccessed.length === 0) return null;
    return this.filesAccessed[this.filesAccessed.length - 1];
  }

  /**
   * Get first accessed file
   *
   * @returns First file access or null if none
   */
  getFirstAccess(): FileAccess | null {
    if (this.filesAccessed.length === 0) return null;
    return this.filesAccessed[0];
  }

  /**
   * Export file access data for session persistence
   *
   * @returns Serialized file access data
   */
  exportData(): FileAccess[] {
    return this.getAllAccess();
  }

  /**
   * Import file access data from session
   *
   * Used when loading an existing session
   *
   * @param data - File access data to import
   */
  importData(data: FileAccess[]): void {
    this.filesAccessed = [...data];
    logger.info('File access data imported', { accessCount: data.length });
  }
}
