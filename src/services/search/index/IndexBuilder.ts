/**
 * IndexBuilder - Orchestrate index building and updates
 *
 * Responsibilities:
 * - Coordinate full index builds
 * - Perform incremental updates
 * - Integrate FileScanner, Tokenizer, CacheValidator
 * - Update InvertedIndex and DocumentStore
 * - Persist index to disk
 * - Track build statistics and performance
 */

import * as fs from 'fs/promises';
import type { DocumentMetadata, IndexConfiguration } from '../../../models/IndexModels.js';
import {
  DEFAULT_TOKENIZATION_OPTIONS,
  DEFAULT_FIELD_BOOSTS,
  DEFAULT_BM25_PARAMS,
} from '../../../models/IndexModels.js';
import { InvertedIndex } from './InvertedIndex.js';
import { DocumentStore } from './DocumentStore.js';
import { IndexPersistence } from './IndexPersistence.js';
import { FileScanner, type ScannedFile } from './FileScanner.js';
import { Tokenizer } from './Tokenizer.js';
import { CacheValidator } from './CacheValidator.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('IndexBuilder');

/**
 * Build mode for index creation
 */
export enum BuildMode {
  /** Build from scratch, ignoring existing cache */
  FULL = 'full',

  /** Update only changed files */
  INCREMENTAL = 'incremental',

  /** Auto-detect based on cache state */
  AUTO = 'auto',
}

/**
 * Build result statistics
 */
export interface BuildResult {
  /** Build mode used */
  mode: BuildMode;

  /** Build start timestamp */
  startTime: number;

  /** Build end timestamp */
  endTime: number;

  /** Build duration in ms */
  duration: number;

  /** Total files processed */
  filesProcessed: number;

  /** Files added to index */
  filesAdded: number;

  /** Files modified and reindexed */
  filesModified: number;

  /** Files removed from index */
  filesDeleted: number;

  /** Total documents in final index */
  totalDocuments: number;

  /** Total unique terms in final index */
  totalTerms: number;

  /** Success flag */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Options for index building
 */
export interface BuildOptions {
  /** Build mode (default: AUTO) */
  mode?: BuildMode;

  /** Vaults to index (path and name) */
  vaults: Array<{ path: string; name: string }>;

  /** Index configuration */
  config: IndexConfiguration;

  /** Incremental threshold (0-1, default 0.3) */
  incrementalThreshold?: number;

  /** Progress callback for long operations */
  onProgress?: (current: number, total: number, status: string) => void;
}

/**
 * Default build options
 */
const DEFAULT_BUILD_OPTIONS = {
  mode: BuildMode.AUTO,
  incrementalThreshold: 0.3,
  config: {
    tokenization: DEFAULT_TOKENIZATION_OPTIONS,
    fieldBoosts: DEFAULT_FIELD_BOOSTS,
    bm25: DEFAULT_BM25_PARAMS,
  },
};

/**
 * Builder for creating and updating inverted index
 */
export class IndexBuilder {
  private scanner: FileScanner;
  private tokenizer: Tokenizer;
  private validator: CacheValidator;
  private persistence: IndexPersistence;

  /**
   * Create a new index builder
   *
   * @param cacheDir - Directory for index cache files
   */
  constructor(cacheDir: string) {
    this.scanner = new FileScanner();
    this.tokenizer = new Tokenizer();
    this.validator = new CacheValidator();
    this.persistence = new IndexPersistence(cacheDir);

    logger.debug('IndexBuilder initialized', { cacheDir });
  }

  /**
   * Build or update the index
   *
   * @param options - Build options
   * @returns Build result with statistics
   */
  async build(options: BuildOptions): Promise<BuildResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };

    logger.info('Starting index build', {
      mode: opts.mode,
      vaults: opts.vaults.map(v => v.name),
    });

    try {
      // 1. Scan all vault files
      const scannedFiles = await this.scanner.scanVaults(opts.vaults);
      logger.info('File scan complete', { filesFound: scannedFiles.length });

      // 2. Load existing index if available
      const { index: existingIndex, store: existingStore } = await this.loadExistingIndex();

      // 3. Determine build mode
      const buildMode = this.determineBuildMode(
        opts.mode,
        scannedFiles,
        existingStore,
        opts.incrementalThreshold
      );

      logger.info('Build mode determined', { mode: buildMode });

      // 4. Execute build based on mode
      let result: BuildResult;
      if (buildMode === BuildMode.FULL) {
        result = await this.buildFull(scannedFiles, opts, startTime);
      } else {
        result = await this.buildIncremental(
          scannedFiles,
          existingIndex,
          existingStore,
          opts,
          startTime
        );
      }

      logger.info('Index build complete', {
        mode: result.mode,
        duration: result.duration,
        filesProcessed: result.filesProcessed,
        totalDocuments: result.totalDocuments,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Index build failed', error as Error);

      return {
        mode: opts.mode || BuildMode.AUTO,
        startTime,
        endTime: Date.now(),
        duration,
        filesProcessed: 0,
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        totalDocuments: 0,
        totalTerms: 0,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Build index from scratch
   *
   * @param scannedFiles - All files to index
   * @param options - Build options
   * @param startTime - Build start timestamp
   * @returns Build result
   */
  private async buildFull(
    scannedFiles: ScannedFile[],
    options: BuildOptions,
    startTime: number
  ): Promise<BuildResult> {
    logger.info('Performing full index build');

    const index = new InvertedIndex();
    const store = new DocumentStore();

    let processed = 0;

    for (const file of scannedFiles) {
      await this.indexFile(file, index, store);
      processed++;

      if (options.onProgress && processed % 100 === 0) {
        options.onProgress(processed, scannedFiles.length, `Indexing ${file.relativePath}`);
      }
    }

    // Save index to disk
    await this.persistence.save(index, store, options.config);

    const endTime = Date.now();

    return {
      mode: BuildMode.FULL,
      startTime,
      endTime,
      duration: endTime - startTime,
      filesProcessed: processed,
      filesAdded: processed,
      filesModified: 0,
      filesDeleted: 0,
      totalDocuments: store.getTotalDocuments(),
      totalTerms: index.getTermCount(),
      success: true,
    };
  }

  /**
   * Update index incrementally
   *
   * @param scannedFiles - Current files
   * @param existingIndex - Existing index to update
   * @param existingStore - Existing document store
   * @param options - Build options
   * @param startTime - Build start timestamp
   * @returns Build result
   */
  private async buildIncremental(
    scannedFiles: ScannedFile[],
    existingIndex: InvertedIndex,
    existingStore: DocumentStore,
    options: BuildOptions,
    startTime: number
  ): Promise<BuildResult> {
    logger.info('Performing incremental index update');

    // Validate cache and detect changes
    const validation = this.validator.validate(scannedFiles, existingStore);

    logger.info('Cache validation complete', {
      added: validation.added,
      modified: validation.modified,
      deleted: validation.deleted,
    });

    // Remove deleted files from index
    const deletedPaths = this.validator.getDeletedPaths(validation);
    for (const path of deletedPaths) {
      existingIndex.removeDocument(path);
      existingStore.remove(path);
    }

    // Reindex added/modified files
    const filesToReindex = this.validator.getFilesNeedingReindex(validation);
    let processed = 0;

    for (const file of filesToReindex) {
      // Remove old version if it exists (for modified files)
      if (existingStore.has(file.absolutePath)) {
        existingIndex.removeDocument(file.absolutePath);
        existingStore.remove(file.absolutePath);
      }

      // Add new version
      await this.indexFile(file, existingIndex, existingStore);
      processed++;

      if (options.onProgress && processed % 50 === 0) {
        options.onProgress(processed, filesToReindex.length, `Updating ${file.relativePath}`);
      }
    }

    // Save updated index
    await this.persistence.save(existingIndex, existingStore, options.config);

    const endTime = Date.now();

    return {
      mode: BuildMode.INCREMENTAL,
      startTime,
      endTime,
      duration: endTime - startTime,
      filesProcessed: processed + deletedPaths.length,
      filesAdded: validation.added,
      filesModified: validation.modified,
      filesDeleted: validation.deleted,
      totalDocuments: existingStore.getTotalDocuments(),
      totalTerms: existingIndex.getTermCount(),
      success: true,
    };
  }

  /**
   * Index a single file
   *
   * @param file - File to index
   * @param index - Inverted index to update
   * @param store - Document store to update
   */
  private async indexFile(
    file: ScannedFile,
    index: InvertedIndex,
    store: DocumentStore
  ): Promise<void> {
    try {
      // Read file content
      const content = await fs.readFile(file.absolutePath, 'utf-8');

      // Tokenize document
      const terms = this.tokenizer.tokenizeDocument(content, {
        path: file.relativePath,
      });

      // Add terms to inverted index
      for (const term of terms) {
        index.addTerm(term.text, {
          docId: file.absolutePath,
          termFrequency: 1, // Will be aggregated by index
          positions: [term.position],
          fieldScores: [
            {
              field: term.field,
              frequency: 1,
              boost: 1.0, // Will be calculated by scoring engine
            },
          ],
        });
      }

      // Create document metadata
      const uniqueTerms = this.tokenizer.getUniqueTerms(terms);
      const metadata: DocumentMetadata = {
        id: file.absolutePath,
        path: file.absolutePath, // Use absolute path for direct tool compatibility
        category: file.category,
        vault: file.vault,
        lastModified: file.lastModified,
        contentLength: uniqueTerms.length,
        hash: file.hash,
      };

      // Add to document store
      store.upsert(metadata);

      logger.debug('File indexed', {
        path: file.relativePath,
        terms: terms.length,
        uniqueTerms: uniqueTerms.length,
      });
    } catch (error) {
      logger.error('Failed to index file', error as Error, {
        path: file.absolutePath,
      });
      // Continue with other files even if one fails
    }
  }

  /**
   * Load existing index from disk
   *
   * @returns Existing index and store, or new instances if not found
   */
  private async loadExistingIndex(): Promise<{ index: InvertedIndex; store: DocumentStore }> {
    try {
      const loaded = await this.persistence.load();

      logger.info('Loaded existing index', {
        documents: loaded.store.getTotalDocuments(),
        terms: loaded.index.getTermCount(),
      });

      return { index: loaded.index, store: loaded.store };
    } catch (_error) {
      logger.debug('No existing index found, will build from scratch');
      return {
        index: new InvertedIndex(),
        store: new DocumentStore(),
      };
    }
  }

  /**
   * Determine build mode based on options and cache state
   *
   * @param requestedMode - User-requested mode
   * @param scannedFiles - Current files
   * @param existingStore - Existing document store
   * @param incrementalThreshold - Threshold for incremental vs full rebuild
   * @returns Determined build mode
   */
  private determineBuildMode(
    requestedMode: BuildMode | undefined,
    scannedFiles: ScannedFile[],
    existingStore: DocumentStore,
    incrementalThreshold?: number
  ): BuildMode {
    // User explicitly requested a mode
    if (requestedMode === BuildMode.FULL || requestedMode === BuildMode.INCREMENTAL) {
      return requestedMode;
    }

    // No existing cache = must do full build
    if (existingStore.getTotalDocuments() === 0) {
      logger.debug('No existing cache, using full build mode');
      return BuildMode.FULL;
    }

    // Validate and check if incremental is worthwhile
    const validation = this.validator.validate(scannedFiles, existingStore);
    const shouldUseIncremental = this.validator.shouldUseIncrementalUpdate(
      validation,
      incrementalThreshold
    );

    return shouldUseIncremental ? BuildMode.INCREMENTAL : BuildMode.FULL;
  }

  /**
   * Validate existing index
   *
   * @returns Validation issues found
   */
  async validateIndex(): Promise<string[]> {
    try {
      const { store } = await this.persistence.load();
      return this.validator.validateConsistency(store);
    } catch (error) {
      return [`Failed to load index: ${(error as Error).message}`];
    }
  }

  /**
   * Delete existing index
   */
  async deleteIndex(): Promise<void> {
    await this.persistence.delete();
    logger.info('Index deleted');
  }

  /**
   * Get index statistics
   *
   * @returns Index statistics or null if not found
   */
  async getIndexStats(): Promise<{
    documents: number;
    terms: number;
    fileSizes: { invertedIndex: number; documentStore: number; metadata: number; total: number };
  } | null> {
    try {
      const { index, store } = await this.persistence.load();
      const fileSizes = await this.persistence.getFileSizes();

      return {
        documents: store.getTotalDocuments(),
        terms: index.getTermCount(),
        fileSizes,
      };
    } catch {
      return null;
    }
  }
}
