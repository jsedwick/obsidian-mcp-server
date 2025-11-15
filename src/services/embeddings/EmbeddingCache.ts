/**
 * EmbeddingCache - Persistent caching of document embeddings
 *
 * Responsible for:
 * - Caching embeddings per vault
 * - Loading and saving cache to disk
 * - Cache invalidation based on file modification time
 * - Multi-vault support
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('EmbeddingCache');

/**
 * Cache entry for a single document embedding
 */
export interface EmbeddingCacheEntry {
  /** File path (absolute for in-memory, relative for storage) */
  file: string;
  /** Embedding vector */
  embedding: number[];
  /** Unix timestamp when embedding was generated */
  timestamp: number;
  /** Vault path (for multi-vault support) */
  vaultPath?: string;
}

/**
 * Cache for document embeddings with multi-vault support
 */
export class EmbeddingCache {
  private cache: Map<string, EmbeddingCacheEntry> = new Map();
  private cacheDirs: Map<string, string>; // vaultPath -> cacheDir mapping
  private enabled: boolean;

  constructor(enabled: boolean = true, cacheDirs?: Map<string, string>) {
    this.enabled = enabled;
    this.cacheDirs = cacheDirs || new Map();
    logger.info('EmbeddingCache initialized', {
      enabled,
      vaultCount: this.cacheDirs.size,
    });
  }

  /**
   * Set cache directories for vaults
   */
  setCacheDirs(cacheDirs: Map<string, string>): void {
    this.cacheDirs = cacheDirs;
    logger.debug('Cache directories updated', { vaultCount: cacheDirs.size });
  }

  /**
   * Load cache from all vault directories
   */
  async load(): Promise<void> {
    if (!this.enabled) {
      logger.debug('Cache disabled, skipping load');
      return;
    }

    logger.info('Loading embedding caches from all vaults');
    let totalLoaded = 0;

    for (const [vaultPath, cacheDir] of this.cacheDirs) {
      try {
        const cacheFile = path.join(cacheDir, 'embeddings.json');
        const data = await fs.readFile(cacheFile, 'utf-8');
        const entries = JSON.parse(data) as EmbeddingCacheEntry[];

        for (const entry of entries) {
          // Reconstruct absolute file path for cache key
          const absolutePath = path.join(vaultPath, entry.file);
          const cacheEntry: EmbeddingCacheEntry = {
            ...entry,
            vaultPath: vaultPath,
            file: absolutePath, // Store absolute path as cache key
          };
          this.cache.set(absolutePath, cacheEntry);
          totalLoaded++;
        }

        logger.debug('Loaded cache for vault', {
          vaultPath,
          entriesLoaded: entries.length,
        });
      } catch (_error) {
        // Cache file doesn't exist for this vault yet, which is fine
        logger.debug('No cache file found for vault (will be created on save)', {
          vaultPath,
        });
      }
    }

    logger.info('Embedding caches loaded', {
      totalEntries: totalLoaded,
      vaultCount: this.cacheDirs.size,
    });
  }

  /**
   * Save cache to all vault directories
   *
   * @param getVaultForFile - Function to determine which vault a file belongs to
   */
  async save(
    getVaultForFile: (filePath: string) => { path: string; name: string } | null
  ): Promise<void> {
    if (!this.enabled) {
      logger.debug('Cache disabled, skipping save');
      return;
    }

    logger.info('Saving embedding caches to all vaults');

    // Group cache entries by vault
    const entriesByVault = new Map<string, EmbeddingCacheEntry[]>();

    for (const [absolutePath, entry] of this.cache) {
      const vault = getVaultForFile(absolutePath);
      if (!vault) continue;

      if (!entriesByVault.has(vault.path)) {
        entriesByVault.set(vault.path, []);
      }

      // Convert absolute path back to relative path for storage
      const relativePath = path.relative(vault.path, absolutePath);
      const storeEntry: EmbeddingCacheEntry = {
        ...entry,
        file: relativePath,
        vaultPath: vault.path,
      };

      entriesByVault.get(vault.path)!.push(storeEntry);
    }

    // Save each vault's cache to its directory
    let totalSaved = 0;
    for (const [vaultPath, entries] of entriesByVault) {
      try {
        const cacheDir = this.cacheDirs.get(vaultPath);
        if (!cacheDir) {
          logger.warn('No cache directory configured for vault', { vaultPath });
          continue;
        }

        await fs.mkdir(cacheDir, { recursive: true });
        const cacheFile = path.join(cacheDir, 'embeddings.json');
        await fs.writeFile(cacheFile, JSON.stringify(entries, null, 2));

        totalSaved += entries.length;

        logger.debug('Saved cache for vault', {
          vaultPath,
          entriesSaved: entries.length,
        });
      } catch (error) {
        logger.error('Failed to save cache for vault', error as Error, { vaultPath });
      }
    }

    logger.info('Embedding caches saved', {
      totalEntries: totalSaved,
      vaultCount: entriesByVault.size,
    });
  }

  /**
   * Get cached embedding for a file
   *
   * @param filePath - Absolute file path
   * @param fileStats - File statistics (must have mtime property)
   * @returns Cached embedding or null if not found/invalid
   */
  get(filePath: string, fileStats: any): number[] | null {
    if (!this.enabled) {
      return null;
    }

    const cached = this.cache.get(filePath);
    if (!cached) {
      logger.debug('Cache miss', { filePath });
      return null;
    }

    // Check if file has been modified since cache
    const fileMtime = Math.floor(fileStats.mtime.getTime() / 1000);
    if (cached.timestamp < fileMtime) {
      logger.debug('Cache entry stale (file modified)', {
        filePath,
        cachedTimestamp: cached.timestamp,
        fileTimestamp: fileMtime,
      });
      return null;
    }

    logger.debug('Cache hit', { filePath });
    return cached.embedding;
  }

  /**
   * Set cached embedding for a file
   *
   * @param filePath - Absolute file path
   * @param embedding - Embedding vector
   * @param fileStats - File statistics (must have mtime property)
   * @param vaultPath - Vault path for multi-vault support
   */
  set(filePath: string, embedding: number[], fileStats: any, vaultPath?: string): void {
    if (!this.enabled) {
      return;
    }

    const timestamp = Math.floor(fileStats.mtime.getTime() / 1000);

    this.cache.set(filePath, {
      file: filePath,
      embedding,
      timestamp,
      vaultPath,
    });

    logger.debug('Cache entry set', {
      filePath,
      embeddingDimension: embedding.length,
      timestamp,
    });
  }

  /**
   * Clear all cached embeddings
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info('Cache cleared', { entriesRemoved: size });
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    vaultCount: number;
    enabled: boolean;
  } {
    return {
      size: this.cache.size,
      vaultCount: this.cacheDirs.size,
      enabled: this.enabled,
    };
  }

  /**
   * Enable or disable the cache
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info('Cache enabled status changed', { enabled });
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
