/**
 * IndexPersistence - Save and load index structures to/from disk
 *
 * Responsibilities:
 * - Serialize InvertedIndex and DocumentStore to JSONL format
 * - Deserialize from disk back into memory
 * - Manage index cache directory and files
 * - Validate index integrity on load
 *
 * File format:
 * - inverted-index.jsonl: One term per line with postings
 * - document-store.jsonl: One document per line with metadata
 * - index-metadata.json: Index version, stats, configuration
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { InvertedIndex } from './InvertedIndex.js';
import { DocumentStore } from './DocumentStore.js';
import type {
  IndexMetadata,
  IndexPaths,
  SerializedIndexEntry,
  SerializedDocumentEntry,
  IndexConfiguration,
} from '../../../models/IndexModels.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('IndexPersistence');

/**
 * Current index format version
 * Increment when making breaking changes to serialization format
 */
export const INDEX_VERSION = '1.0.0';

/**
 * Persistence layer for inverted index
 */
export class IndexPersistence {
  /**
   * Paths for index files
   */
  private paths: IndexPaths;

  /**
   * Create a new persistence layer
   *
   * @param cacheDir - Root directory for index cache
   */
  constructor(cacheDir: string) {
    this.paths = {
      root: cacheDir,
      invertedIndex: path.join(cacheDir, 'inverted-index.jsonl'),
      documentStore: path.join(cacheDir, 'document-store.jsonl'),
      metadata: path.join(cacheDir, 'index-metadata.json'),
    };

    logger.debug('IndexPersistence created', { cacheDir });
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.paths.root, { recursive: true });
    } catch (error) {
      logger.error('Failed to create cache directory', error as Error);
      throw error;
    }
  }

  /**
   * Save inverted index to disk (JSONL format)
   *
   * @param index - The inverted index to save
   */
  private async saveInvertedIndex(index: InvertedIndex): Promise<void> {
    const lines: string[] = [];

    // Get all terms and their postings
    const allTerms = index.getAllTerms();

    for (const [term, postings] of allTerms) {
      const entry: SerializedIndexEntry = {
        term,
        postings,
      };
      lines.push(JSON.stringify(entry));
    }

    // Write to file (one entry per line)
    await fs.writeFile(this.paths.invertedIndex, lines.join('\n'), 'utf-8');

    logger.info('Inverted index saved', {
      path: this.paths.invertedIndex,
      termCount: allTerms.length,
    });
  }

  /**
   * Load inverted index from disk
   *
   * @returns Loaded inverted index
   */
  private async loadInvertedIndex(): Promise<InvertedIndex> {
    const index = new InvertedIndex();

    try {
      const content = await fs.readFile(this.paths.invertedIndex, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      for (const line of lines) {
        const entry = JSON.parse(line) as SerializedIndexEntry;

        // Add each posting to the index
        for (const posting of entry.postings) {
          index.addTerm(entry.term, posting);
        }
      }

      logger.info('Inverted index loaded', {
        path: this.paths.invertedIndex,
        termCount: index.getTermCount(),
      });

      return index;
    } catch (error) {
      logger.error('Failed to load inverted index', error as Error);
      throw error;
    }
  }

  /**
   * Save document store to disk (JSONL format)
   *
   * @param store - The document store to save
   */
  private async saveDocumentStore(store: DocumentStore): Promise<void> {
    const lines: string[] = [];

    // Get all documents
    const allDocuments = store.getAll();

    for (const metadata of allDocuments) {
      const entry: SerializedDocumentEntry = {
        metadata,
      };
      lines.push(JSON.stringify(entry));
    }

    // Write to file (one entry per line)
    await fs.writeFile(this.paths.documentStore, lines.join('\n'), 'utf-8');

    logger.info('Document store saved', {
      path: this.paths.documentStore,
      documentCount: allDocuments.length,
    });
  }

  /**
   * Load document store from disk
   *
   * @returns Loaded document store
   */
  private async loadDocumentStore(): Promise<DocumentStore> {
    const store = new DocumentStore();

    try {
      const content = await fs.readFile(this.paths.documentStore, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      for (const line of lines) {
        const entry = JSON.parse(line) as SerializedDocumentEntry;
        store.upsert(entry.metadata);
      }

      logger.info('Document store loaded', {
        path: this.paths.documentStore,
        documentCount: store.getTotalDocuments(),
      });

      return store;
    } catch (error) {
      logger.error('Failed to load document store', error as Error);
      throw error;
    }
  }

  /**
   * Save index metadata
   *
   * @param metadata - Index metadata to save
   */
  private async saveMetadata(metadata: IndexMetadata): Promise<void> {
    // Convert Map to plain object for JSON serialization
    const serializedMetadata = {
      ...metadata,
      statistics: {
        ...metadata.statistics,
        documentFrequency: Array.from(metadata.statistics.documentFrequency.entries()),
      },
    };

    await fs.writeFile(this.paths.metadata, JSON.stringify(serializedMetadata, null, 2), 'utf-8');

    logger.info('Index metadata saved', {
      path: this.paths.metadata,
      version: metadata.version,
    });
  }

  /**
   * Load index metadata
   *
   * @returns Loaded index metadata
   */
  private async loadMetadata(): Promise<IndexMetadata> {
    try {
      const content = await fs.readFile(this.paths.metadata, 'utf-8');
      const data = JSON.parse(content);

      // Convert plain object back to Map
      const metadata: IndexMetadata = {
        ...data,
        lastBuilt: new Date(data.lastBuilt),
        lastValidated: new Date(data.lastValidated),
        statistics: {
          ...data.statistics,
          documentFrequency: new Map(data.statistics.documentFrequency),
        },
      };

      logger.info('Index metadata loaded', {
        path: this.paths.metadata,
        version: metadata.version,
      });

      return metadata;
    } catch (error) {
      logger.error('Failed to load index metadata', error as Error);
      throw error;
    }
  }

  /**
   * Check if index exists on disk
   *
   * @returns True if index files exist
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.paths.invertedIndex);
      await fs.access(this.paths.documentStore);
      await fs.access(this.paths.metadata);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save complete index to disk
   *
   * @param index - Inverted index
   * @param store - Document store
   * @param config - Index configuration
   */
  async save(
    index: InvertedIndex,
    store: DocumentStore,
    config: IndexConfiguration
  ): Promise<void> {
    logger.info('Saving index to disk');

    await this.ensureCacheDir();

    // Build document frequency map from index
    const documentFrequency = new Map<string, number>();
    const allTerms = index.getAllTerms();
    for (const [term, postings] of allTerms) {
      documentFrequency.set(term, postings.length);
    }

    // Build metadata
    const metadata: IndexMetadata = {
      version: INDEX_VERSION,
      lastBuilt: new Date(),
      lastValidated: new Date(),
      statistics: store.getStatistics(documentFrequency),
      configuration: {
        tokenization: config.tokenization,
        fieldBoosts: config.fieldBoosts,
        bm25: config.bm25,
      },
    };

    // Save all components
    await Promise.all([
      this.saveInvertedIndex(index),
      this.saveDocumentStore(store),
      this.saveMetadata(metadata),
    ]);

    logger.info('Index saved successfully', {
      termCount: index.getTermCount(),
      documentCount: store.getTotalDocuments(),
    });
  }

  /**
   * Load complete index from disk
   *
   * @returns Loaded index, store, and metadata
   */
  async load(): Promise<{
    index: InvertedIndex;
    store: DocumentStore;
    metadata: IndexMetadata;
  }> {
    logger.info('Loading index from disk');

    if (!(await this.exists())) {
      throw new Error('Index does not exist on disk');
    }

    // Load all components in parallel
    const [index, store, metadata] = await Promise.all([
      this.loadInvertedIndex(),
      this.loadDocumentStore(),
      this.loadMetadata(),
    ]);

    // Validate version
    if (metadata.version !== INDEX_VERSION) {
      logger.warn('Index version mismatch', {
        expected: INDEX_VERSION,
        actual: metadata.version,
      });
      throw new Error(
        `Index version mismatch: expected ${INDEX_VERSION}, got ${metadata.version}`
      );
    }

    logger.info('Index loaded successfully', {
      termCount: index.getTermCount(),
      documentCount: store.getTotalDocuments(),
      version: metadata.version,
    });

    return { index, store, metadata };
  }

  /**
   * Delete index from disk
   */
  async delete(): Promise<void> {
    logger.info('Deleting index from disk');

    try {
      await Promise.all([
        fs.unlink(this.paths.invertedIndex).catch(() => {}),
        fs.unlink(this.paths.documentStore).catch(() => {}),
        fs.unlink(this.paths.metadata).catch(() => {}),
      ]);

      // Try to remove directory if empty
      try {
        await fs.rmdir(this.paths.root);
      } catch {
        // Directory not empty or doesn't exist, ignore
      }

      logger.info('Index deleted successfully');
    } catch (error) {
      logger.error('Failed to delete index', error as Error);
      throw error;
    }
  }

  /**
   * Get index file sizes
   *
   * @returns Object with file sizes in bytes
   */
  async getFileSizes(): Promise<{
    invertedIndex: number;
    documentStore: number;
    metadata: number;
    total: number;
  }> {
    const sizes = {
      invertedIndex: 0,
      documentStore: 0,
      metadata: 0,
      total: 0,
    };

    try {
      const [indexStat, storeStat, metaStat] = await Promise.all([
        fs.stat(this.paths.invertedIndex),
        fs.stat(this.paths.documentStore),
        fs.stat(this.paths.metadata),
      ]);

      sizes.invertedIndex = indexStat.size;
      sizes.documentStore = storeStat.size;
      sizes.metadata = metaStat.size;
      sizes.total = sizes.invertedIndex + sizes.documentStore + sizes.metadata;
    } catch (error) {
      logger.warn('Failed to get file sizes', { error });
    }

    return sizes;
  }

  /**
   * Validate index integrity
   *
   * @returns Array of validation errors (empty if valid)
   */
  async validate(): Promise<string[]> {
    const errors: string[] = [];

    if (!(await this.exists())) {
      errors.push('Index files do not exist');
      return errors;
    }

    try {
      const { index, store, metadata } = await this.load();

      // Check version
      if (metadata.version !== INDEX_VERSION) {
        errors.push(`Version mismatch: expected ${INDEX_VERSION}, got ${metadata.version}`);
      }

      // Check term count matches
      if (index.getTermCount() !== metadata.statistics.totalTerms) {
        errors.push(
          `Term count mismatch: index has ${index.getTermCount()}, metadata says ${metadata.statistics.totalTerms}`
        );
      }

      // Check document count matches
      if (store.getTotalDocuments() !== metadata.statistics.totalDocuments) {
        errors.push(
          `Document count mismatch: store has ${store.getTotalDocuments()}, metadata says ${metadata.statistics.totalDocuments}`
        );
      }

      // Validate document store
      const storeErrors = store.validate();
      errors.push(...storeErrors);
    } catch (error) {
      errors.push(`Failed to load index: ${(error as Error).message}`);
    }

    return errors;
  }
}
