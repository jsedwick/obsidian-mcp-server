/**
 * FileScanner - Discover markdown files in vaults
 *
 * Responsibilities:
 * - Recursively scan directories for .md files
 * - Filter out ignored directories (.git, node_modules, etc.)
 * - Extract file metadata (path, mtime, size)
 * - Support multiple vaults
 * - Generate content hashes for change detection
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('FileScanner');

/**
 * Information about a discovered file
 */
export interface ScannedFile {
  /** Absolute file path */
  absolutePath: string;

  /** Relative path within vault */
  relativePath: string;

  /** File size in bytes */
  size: number;

  /** Last modified timestamp (ms) */
  lastModified: number;

  /** Content hash (SHA-256) */
  hash: string;

  /** Vault name */
  vault: string;

  /** File category (sessions, topics, decisions, etc.) */
  category: string;
}

/**
 * Options for file scanning
 */
export interface ScanOptions {
  /** Directories to ignore */
  ignoredDirs?: Set<string>;

  /** File extensions to include (default: ['.md']) */
  extensions?: string[];

  /** Maximum depth to scan (-1 for unlimited) */
  maxDepth?: number;

  /** Whether to compute content hashes */
  computeHashes?: boolean;
}

/**
 * Default scan options
 */
const DEFAULT_SCAN_OPTIONS: Required<ScanOptions> = {
  ignoredDirs: new Set(['.git', 'node_modules', '.DS_Store', '.obsidian', 'dist', 'build']),
  extensions: ['.md'],
  maxDepth: -1, // Unlimited
  computeHashes: true,
};

/**
 * Scanner for discovering markdown files in vaults
 */
export class FileScanner {
  private options: Required<ScanOptions>;

  /**
   * Create a new file scanner
   *
   * @param options - Scan options
   */
  constructor(options: ScanOptions = {}) {
    this.options = {
      ...DEFAULT_SCAN_OPTIONS,
      ...options,
      ignoredDirs: options.ignoredDirs || DEFAULT_SCAN_OPTIONS.ignoredDirs,
    };

    logger.debug('FileScanner initialized', {
      extensions: this.options.extensions,
      ignoredDirs: Array.from(this.options.ignoredDirs),
    });
  }

  /**
   * Scan a vault for markdown files
   *
   * @param vaultPath - Absolute path to vault root
   * @param vaultName - Name of the vault
   * @returns Array of scanned files
   */
  async scanVault(vaultPath: string, vaultName: string): Promise<ScannedFile[]> {
    logger.info('Scanning vault', { vault: vaultName, path: vaultPath });

    const files: ScannedFile[] = [];

    try {
      await this.scanDirectory(vaultPath, vaultPath, vaultName, files, 0);

      logger.info('Vault scan complete', {
        vault: vaultName,
        filesFound: files.length,
      });

      return files;
    } catch (error) {
      logger.error('Failed to scan vault', error as Error, {
        vault: vaultName,
        path: vaultPath,
      });
      throw error;
    }
  }

  /**
   * Scan multiple vaults
   *
   * @param vaults - Array of {path, name} objects
   * @returns Array of scanned files from all vaults
   */
  async scanVaults(vaults: Array<{ path: string; name: string }>): Promise<ScannedFile[]> {
    logger.info('Scanning multiple vaults', { vaultCount: vaults.length });

    const allFiles: ScannedFile[] = [];

    for (const vault of vaults) {
      const files = await this.scanVault(vault.path, vault.name);
      allFiles.push(...files);
    }

    logger.info('Multi-vault scan complete', {
      vaultCount: vaults.length,
      totalFiles: allFiles.length,
    });

    return allFiles;
  }

  /**
   * Scan a directory recursively
   *
   * @param dirPath - Directory to scan
   * @param vaultRoot - Vault root path
   * @param vaultName - Vault name
   * @param files - Array to accumulate results
   * @param depth - Current recursion depth
   */
  private async scanDirectory(
    dirPath: string,
    vaultRoot: string,
    vaultName: string,
    files: ScannedFile[],
    depth: number
  ): Promise<void> {
    // Check max depth
    if (this.options.maxDepth !== -1 && depth > this.options.maxDepth) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Skip ignored directories
          if (this.options.ignoredDirs.has(entry.name)) {
            logger.debug('Skipping ignored directory', { dir: entry.name });
            continue;
          }

          // Recursively scan subdirectory
          await this.scanDirectory(fullPath, vaultRoot, vaultName, files, depth + 1);
        } else if (entry.isFile()) {
          // Check file extension
          const ext = path.extname(entry.name);
          if (!this.options.extensions.includes(ext)) {
            continue;
          }

          // Process markdown file
          const scannedFile = await this.processFile(fullPath, vaultRoot, vaultName);
          if (scannedFile) {
            files.push(scannedFile);
          }
        }
      }
    } catch (error) {
      // Directory might not exist or be inaccessible
      logger.debug('Failed to scan directory', {
        dirPath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Process a single file
   *
   * @param filePath - Absolute file path
   * @param vaultRoot - Vault root path
   * @param vaultName - Vault name
   * @returns Scanned file info or null if error
   */
  private async processFile(
    filePath: string,
    vaultRoot: string,
    vaultName: string
  ): Promise<ScannedFile | null> {
    try {
      const stats = await fs.stat(filePath);
      const relativePath = path.relative(vaultRoot, filePath);
      const category = this.determineCategory(relativePath);

      let hash = '';
      if (this.options.computeHashes) {
        hash = await this.computeFileHash(filePath);
      }

      return {
        absolutePath: filePath,
        relativePath,
        size: stats.size,
        lastModified: stats.mtimeMs,
        hash,
        vault: vaultName,
        category,
      };
    } catch (error) {
      logger.debug('Failed to process file', {
        filePath,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Determine document category from relative path
   *
   * @param relativePath - Path relative to vault root
   * @returns Category string (singular form matching frontmatter convention)
   */
  private determineCategory(relativePath: string): string {
    const parts = relativePath.split(path.sep);

    // Check first directory in path
    if (parts.length > 1) {
      const firstDir = parts[0];

      if (firstDir === 'sessions' || firstDir.match(/^\d{4}-\d{2}$/)) {
        return 'session';
      }

      if (firstDir === 'topics') {
        return 'topic';
      }

      if (firstDir === 'decisions') {
        return 'decision';
      }

      if (firstDir === 'projects') {
        return 'project';
      }
    }

    return 'document';
  }

  /**
   * Compute SHA-256 hash of file content
   *
   * @param filePath - File to hash
   * @returns Hex-encoded hash
   */
  private async computeFileHash(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      logger.debug('Failed to compute hash', {
        filePath,
        error: (error as Error).message,
      });
      return '';
    }
  }

  /**
   * Get file statistics without full scan
   * Useful for checking a specific file
   *
   * @param filePath - Absolute file path
   * @returns File stats or null if error
   */
  async getFileStats(filePath: string): Promise<{
    size: number;
    lastModified: number;
    hash: string;
  } | null> {
    try {
      const stats = await fs.stat(filePath);
      const hash = this.options.computeHashes ? await this.computeFileHash(filePath) : '';

      return {
        size: stats.size,
        lastModified: stats.mtimeMs,
        hash,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if a path should be ignored
   *
   * @param dirName - Directory name
   * @returns True if should be ignored
   */
  shouldIgnore(dirName: string): boolean {
    return this.options.ignoredDirs.has(dirName);
  }
}
