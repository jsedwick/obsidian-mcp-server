/**
 * DocumentStore - Storage for document metadata and BM25 statistics
 *
 * Responsibilities:
 * - Store document metadata (path, category, date, etc.)
 * - Calculate BM25 statistics (avg doc length, doc frequency)
 * - Provide CRUD operations for documents
 * - Support cache invalidation via mtime/hash comparison
 *
 * Used for:
 * - BM25 scoring (need avg doc length, doc frequency)
 * - Cache validation (compare mtimes to detect changes)
 * - Result metadata (category, vault, date for display)
 */

import type { DocumentMetadata, IndexStatistics } from '../../../models/IndexModels.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('DocumentStore');

/**
 * Store for document metadata with BM25 statistics
 */
export class DocumentStore {
  /**
   * Map of document ID � metadata
   */
  private documents: Map<string, DocumentMetadata>;

  /**
   * Cached statistics (invalidated on add/remove)
   */
  private cachedStatistics: IndexStatistics | null;

  /**
   * Create a new document store
   */
  constructor() {
    this.documents = new Map();
    this.cachedStatistics = null;
    logger.debug('DocumentStore created');
  }

  /**
   * Add or update a document
   *
   * @param metadata - Document metadata to store
   */
  upsert(metadata: DocumentMetadata): void {
    const isNew = !this.documents.has(metadata.id);
    this.documents.set(metadata.id, metadata);
    this.cachedStatistics = null; // Invalidate cache

    logger.debug(isNew ? 'Document added' : 'Document updated', {
      docId: metadata.id,
      category: metadata.category,
      vault: metadata.vault,
    });
  }

  /**
   * Remove a document
   *
   * @param docId - Document ID to remove
   * @returns True if document was removed
   */
  remove(docId: string): boolean {
    const removed = this.documents.delete(docId);
    if (removed) {
      this.cachedStatistics = null; // Invalidate cache
      logger.debug('Document removed', { docId });
    }
    return removed;
  }

  /**
   * Get document metadata by ID
   *
   * @param docId - Document ID
   * @returns Document metadata, or undefined if not found
   */
  get(docId: string): DocumentMetadata | undefined {
    return this.documents.get(docId);
  }

  /**
   * Check if document exists
   *
   * @param docId - Document ID
   * @returns True if document exists
   */
  has(docId: string): boolean {
    return this.documents.has(docId);
  }

  /**
   * Get all documents
   *
   * @returns Array of all document metadata
   */
  getAll(): DocumentMetadata[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get all document IDs
   *
   * @returns Array of document IDs
   */
  getAllIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get all document paths
   * (Document ID is the absolute file path)
   *
   * @returns Array of absolute file paths
   */
  getAllPaths(): string[] {
    return this.getAllIds();
  }

  /**
   * Get total number of documents
   *
   * @returns Document count
   */
  getTotalDocuments(): number {
    return this.documents.size;
  }

  /**
   * Get average document length (in tokens)
   * Used for BM25 length normalization
   *
   * @returns Average document length
   */
  getAverageDocumentLength(): number {
    if (this.documents.size === 0) {
      return 0;
    }

    const totalLength = Array.from(this.documents.values()).reduce(
      (sum, doc) => sum + doc.contentLength,
      0
    );

    return totalLength / this.documents.size;
  }

  /**
   * Get document frequency for a term
   * (How many documents contain this term)
   *
   * Note: This requires the inverted index to calculate.
   * The DocumentStore just provides the interface.
   *
   * @param _term - The term (unused, provided by inverted index)
   * @returns Document frequency (calculated externally)
   */
  getDocumentFrequency(_term: string): number {
    // This is calculated by the inverted index
    // DocumentStore just provides the total document count for IDF calculation
    throw new Error('getDocumentFrequency should be called on InvertedIndex, not DocumentStore');
  }

  /**
   * Get statistics for BM25 scoring
   *
   * @param documentFrequencies - Map of term � doc frequency from inverted index
   * @returns Index statistics
   */
  getStatistics(documentFrequencies: Map<string, number>): IndexStatistics {
    // Return cached statistics if available
    if (this.cachedStatistics) {
      return this.cachedStatistics;
    }

    const stats: IndexStatistics = {
      totalDocuments: this.documents.size,
      averageDocumentLength: this.getAverageDocumentLength(),
      totalTerms: documentFrequencies.size,
      documentFrequency: documentFrequencies,
    };

    this.cachedStatistics = stats;
    return stats;
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.documents.clear();
    this.cachedStatistics = null;
    logger.info('DocumentStore cleared');
  }

  /**
   * Get documents by category
   *
   * @param category - Category to filter by (sessions, topics, decisions)
   * @returns Array of documents in that category
   */
  getByCategory(category: string): DocumentMetadata[] {
    return Array.from(this.documents.values()).filter(doc => doc.category === category);
  }

  /**
   * Get documents by vault
   *
   * @param vault - Vault name to filter by
   * @returns Array of documents in that vault
   */
  getByVault(vault: string): DocumentMetadata[] {
    return Array.from(this.documents.values()).filter(doc => doc.vault === vault);
  }

  /**
   * Get documents modified since a timestamp
   * Useful for incremental updates
   *
   * @param timestamp - Unix timestamp
   * @returns Array of documents modified since timestamp
   */
  getModifiedSince(timestamp: number): DocumentMetadata[] {
    return Array.from(this.documents.values()).filter(doc => doc.lastModified > timestamp);
  }

  /**
   * Detect documents that have changed (based on mtime or hash)
   *
   * @param currentFiles - Map of path � {lastModified, hash}
   * @returns Object with added, modified, deleted document IDs
   */
  detectChanges(
    currentFiles: Map<string, { lastModified: number; hash: string }>
  ): {
    added: string[];
    modified: string[];
    deleted: string[];
  } {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    // Check for added or modified files
    for (const [path, { lastModified, hash }] of currentFiles.entries()) {
      const existingDoc = this.documents.get(path);

      if (!existingDoc) {
        // New file
        added.push(path);
      } else if (existingDoc.lastModified !== lastModified || existingDoc.hash !== hash) {
        // Modified file
        modified.push(path);
      }
    }

    // Check for deleted files
    for (const docId of this.documents.keys()) {
      if (!currentFiles.has(docId)) {
        deleted.push(docId);
      }
    }

    logger.debug('Change detection complete', {
      added: added.length,
      modified: modified.length,
      deleted: deleted.length,
    });

    return { added, modified, deleted };
  }

  /**
   * Get memory usage estimate
   *
   * @returns Estimated memory in bytes
   */
  getMemoryUsage(): number {
    let bytes = 0;

    // Map overhead
    bytes += 100;

    // Each document metadata entry
    for (const doc of this.documents.values()) {
      bytes += 500; // Base metadata object
      bytes += doc.path.length * 2; // String (UTF-16)
      bytes += doc.category.length * 2;
      bytes += doc.vault.length * 2;
      bytes += doc.hash.length * 2;

      if (doc.frontmatter?.tags) {
        bytes += doc.frontmatter.tags.length * 50;
      }
    }

    return bytes;
  }

  /**
   * Serialize the document store to a plain object
   *
   * @returns Serialized document store
   */
  toJSON(): Record<string, unknown> {
    return {
      documents: Array.from(this.documents.entries()).map(([id, metadata]) => ({
        id,
        metadata,
      })),
    };
  }

  /**
   * Deserialize a document store from a plain object
   *
   * @param obj - Serialized document store
   * @returns New DocumentStore instance
   */
  static fromJSON(obj: Record<string, unknown>): DocumentStore {
    const store = new DocumentStore();

    const documents = obj.documents as Array<{ id: string; metadata: DocumentMetadata }>;
    for (const { id, metadata } of documents) {
      store.documents.set(id, metadata);
    }

    logger.info('DocumentStore loaded from JSON', {
      documentCount: store.documents.size,
    });

    return store;
  }

  /**
   * Get statistics about the document store
   *
   * @returns Store statistics
   */
  getStoreStatistics(): {
    totalDocuments: number;
    averageDocumentLength: number;
    memoryUsage: number;
    categoryCounts: Record<string, number>;
    vaultCounts: Record<string, number>;
  } {
    const categoryCounts: Record<string, number> = {};
    const vaultCounts: Record<string, number> = {};

    for (const doc of this.documents.values()) {
      categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
      vaultCounts[doc.vault] = (vaultCounts[doc.vault] || 0) + 1;
    }

    return {
      totalDocuments: this.documents.size,
      averageDocumentLength: this.getAverageDocumentLength(),
      memoryUsage: this.getMemoryUsage(),
      categoryCounts,
      vaultCounts,
    };
  }

  /**
   * Validate document store consistency
   * Checks for missing required fields, invalid data, etc.
   *
   * @returns Array of validation errors (empty if valid)
   */
  validate(): string[] {
    const errors: string[] = [];

    for (const [id, doc] of this.documents.entries()) {
      if (!doc.id) {
        errors.push(`Document ${id} missing id field`);
      }
      if (doc.id !== id) {
        errors.push(`Document ${id} has mismatched id: ${doc.id}`);
      }
      if (!doc.path) {
        errors.push(`Document ${id} missing path`);
      }
      if (!doc.category) {
        errors.push(`Document ${id} missing category`);
      }
      if (!doc.vault) {
        errors.push(`Document ${id} missing vault`);
      }
      if (!doc.hash) {
        errors.push(`Document ${id} missing hash`);
      }
      if (doc.contentLength < 0) {
        errors.push(`Document ${id} has negative contentLength: ${doc.contentLength}`);
      }
      if (doc.lastModified <= 0) {
        errors.push(`Document ${id} has invalid lastModified: ${doc.lastModified}`);
      }
    }

    if (errors.length > 0) {
      logger.warn('DocumentStore validation failed', { errorCount: errors.length });
    }

    return errors;
  }
}
