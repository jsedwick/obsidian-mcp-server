/**
 * InvertedIndex - Trie-based inverted index for full-text search
 *
 * Maps terms � documents using a compressed Trie structure.
 * Provides O(log n) term lookups and supports incremental updates.
 *
 * Responsibilities:
 * - Add/remove terms for documents
 * - Retrieve postings (documents containing a term)
 * - Prefix search for autocomplete/fuzzy matching
 * - Persistence (serialize/deserialize)
 */

import { TrieNode } from './TrieNode.js';
import type { DocumentPosting } from '../../../models/IndexModels.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('InvertedIndex');

/**
 * Inverted index implementation using Trie data structure
 */
export class InvertedIndex {
  /**
   * Root of the Trie
   */
  private root: TrieNode;

  /**
   * Total number of unique terms in the index
   */
  private termCount: number;

  /**
   * Create a new inverted index
   */
  constructor() {
    this.root = new TrieNode();
    this.termCount = 0;
    logger.debug('InvertedIndex created');
  }

  /**
   * Add a term to the index for a specific document
   *
   * @param term - The term to add (should be normalized/lowercased)
   * @param posting - Document posting information
   */
  addTerm(term: string, posting: DocumentPosting): void {
    if (!term || term.length === 0) {
      logger.warn('Attempted to add empty term');
      return;
    }

    let node = this.root;

    // Traverse/create path for each character
    for (const char of term) {
      node = node.addChild(char);
    }

    // Mark as end of word and add posting
    if (!node.isEndOfWord) {
      node.markAsEndOfWord([]);
      this.termCount++;
      logger.debug('New term added to index', { term, termCount: this.termCount });
    }

    // Check if posting already exists for this document
    const existingPosting = node.getPostings().find(p => p.docId === posting.docId);
    if (!existingPosting) {
      node.addPosting(posting);
      logger.debug('Posting added for term', { term, docId: posting.docId });
    } else {
      // Merge with existing posting
      existingPosting.termFrequency += posting.termFrequency;
      existingPosting.positions.push(...posting.positions);

      // Merge field scores (aggregate by field)
      for (const newFieldScore of posting.fieldScores) {
        const existingFieldScore = existingPosting.fieldScores.find(
          fs => fs.field === newFieldScore.field
        );
        if (existingFieldScore) {
          // Update frequency for existing field
          existingFieldScore.frequency += newFieldScore.frequency;
        } else {
          // Add new field score
          existingPosting.fieldScores.push(newFieldScore);
        }
      }

      logger.debug('Posting merged for term', {
        term,
        docId: posting.docId,
        totalFrequency: existingPosting.termFrequency,
        fields: existingPosting.fieldScores.map(fs => fs.field),
      });
    }
  }

  /**
   * Get all document postings for a term
   *
   * @param term - The term to look up
   * @returns Array of postings, or empty array if term not found
   */
  getPostings(term: string): DocumentPosting[] {
    if (!term || term.length === 0) {
      return [];
    }

    let node = this.root;

    // Traverse the trie
    for (const char of term) {
      const child = node.getChild(char);
      if (!child) {
        // Term not in index
        return [];
      }
      node = child;
    }

    // Return postings if this is a complete term
    if (node.isEndOfWord) {
      return node.getPostings();
    }

    return [];
  }

  /**
   * Remove all postings for a specific document from a term
   *
   * @param term - The term to update
   * @param docId - The document ID to remove
   * @returns True if posting was removed
   */
  removeTerm(term: string, docId: string): boolean {
    if (!term || term.length === 0) {
      return false;
    }

    let node = this.root;
    const path: Array<{ node: TrieNode; char: string }> = [];

    // Traverse the trie, recording path
    for (const char of term) {
      const child = node.getChild(char);
      if (!child) {
        // Term not in index
        return false;
      }
      path.push({ node, char });
      node = child;
    }

    // Remove posting if term exists
    if (node.isEndOfWord) {
      const removed = node.removePosting(docId);

      // If no postings left, clean up the trie
      if (node.getPostings().length === 0 && !node.hasChildren()) {
        node.clearPostings();

        // Remove nodes from bottom up if they have no children and aren't end of other words
        for (let i = path.length - 1; i >= 0; i--) {
          const { node: parentNode, char } = path[i];
          const childNode = parentNode.getChild(char);

          if (childNode && !childNode.hasChildren() && !childNode.isEndOfWord) {
            parentNode.removeChild(char);
          } else {
            break; // Stop if we hit a node that's still needed
          }
        }

        this.termCount--;
        logger.debug('Term removed from index', { term, termCount: this.termCount });
      }

      return removed;
    }

    return false;
  }

  /**
   * Remove all terms for a specific document
   * This is expensive (O(n) where n = total terms) - use sparingly
   *
   * @param docId - The document ID to remove
   * @returns Number of terms removed
   */
  removeDocument(docId: string): number {
    let removedCount = 0;

    // Get all terms and their postings
    const allTerms = this.getAllTerms();

    // Remove this document from each term's postings
    for (const [term] of allTerms) {
      if (this.removeTerm(term, docId)) {
        removedCount++;
      }
    }

    logger.debug('Document removed from index', { docId, termsRemoved: removedCount });
    return removedCount;
  }

  /**
   * Get all terms with a given prefix
   * Useful for autocomplete and fuzzy search
   *
   * @param prefix - The prefix to search for
   * @returns Array of terms matching the prefix
   */
  getTermsWithPrefix(prefix: string): string[] {
    if (!prefix || prefix.length === 0) {
      return [];
    }

    let node = this.root;

    // Navigate to the prefix node
    for (const char of prefix) {
      const child = node.getChild(char);
      if (!child) {
        // Prefix not in index
        return [];
      }
      node = child;
    }

    // Collect all complete terms from this node
    const terms = node.getAllTerms(prefix);
    return terms.map(([term]) => term);
  }

  /**
   * Check if a term exists in the index
   *
   * @param term - The term to check
   * @returns True if term exists
   */
  hasTerm(term: string): boolean {
    return this.getPostings(term).length > 0;
  }

  /**
   * Get total number of unique terms
   *
   * @returns Number of terms
   */
  getTermCount(): number {
    return this.termCount;
  }

  /**
   * Get all terms and their postings
   * WARNING: This is expensive for large indexes
   *
   * @returns Array of [term, postings] tuples
   */
  getAllTerms(): Array<[string, DocumentPosting[]]> {
    return this.root.getAllTerms();
  }

  /**
   * Get document frequency (number of documents containing a term)
   *
   * @param term - The term to check
   * @returns Number of documents containing this term
   */
  getDocumentFrequency(term: string): number {
    return this.getPostings(term).length;
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.root = new TrieNode();
    this.termCount = 0;
    logger.info('Index cleared');
  }

  /**
   * Get estimated memory usage
   *
   * @returns Estimated memory in bytes
   */
  getMemoryUsage(): number {
    return this.root.getMemoryUsage();
  }

  /**
   * Serialize the index to a plain object (for persistence)
   *
   * @returns Serialized index
   */
  toJSON(): Record<string, unknown> {
    return {
      root: this.root.toJSON(),
      termCount: this.termCount,
    };
  }

  /**
   * Deserialize an index from a plain object
   *
   * @param obj - Serialized index
   * @returns New InvertedIndex instance
   */
  static fromJSON(obj: Record<string, unknown>): InvertedIndex {
    const index = new InvertedIndex();
    index.root = TrieNode.fromJSON(obj.root as Record<string, unknown>);
    index.termCount = obj.termCount as number;
    logger.info('Index loaded from JSON', { termCount: index.termCount });
    return index;
  }

  /**
   * Get statistics about the index
   *
   * @returns Index statistics
   */
  getStatistics(): {
    termCount: number;
    memoryUsage: number;
    avgPostingsPerTerm: number;
  } {
    const allTerms = this.getAllTerms();
    const totalPostings = allTerms.reduce((sum, [, postings]) => sum + postings.length, 0);

    return {
      termCount: this.termCount,
      memoryUsage: this.getMemoryUsage(),
      avgPostingsPerTerm: this.termCount > 0 ? totalPostings / this.termCount : 0,
    };
  }
}
