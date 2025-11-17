/**
 * TrieNode - Node in a Trie (prefix tree) data structure
 *
 * Each node represents a character in a term, with children forming paths to complete terms.
 * Leaf nodes (end of words) contain document postings.
 *
 * Example trie for terms "cat", "car", "card":
 *
 *        root
 *         |
 *         c
 *         |
 *         a
 *        / \
 *       t   r
 *      [P]  |[P]
 *           d
 *          [P]
 *
 * Where [P] = postings (documents containing that term)
 */

import type { DocumentPosting } from '../../../models/IndexModels.js';

/**
 * A node in the Trie structure
 */
export class TrieNode {
  /**
   * Child nodes, keyed by character
   * Using Map for O(1) lookup performance
   */
  public children: Map<string, TrieNode>;

  /**
   * Whether this node marks the end of a complete term
   */
  public isEndOfWord: boolean;

  /**
   * Document postings for this term (only populated if isEndOfWord is true)
   * Contains list of documents that contain this term
   */
  public postings: DocumentPosting[];

  /**
   * Create a new TrieNode
   */
  constructor() {
    this.children = new Map();
    this.isEndOfWord = false;
    this.postings = [];
  }

  /**
   * Add a child node for the given character
   * Returns the child node (either newly created or existing)
   *
   * @param char - The character for this edge
   * @returns The child node
   */
  addChild(char: string): TrieNode {
    if (!this.children.has(char)) {
      this.children.set(char, new TrieNode());
    }
    return this.children.get(char)!;
  }

  /**
   * Get a child node for the given character
   *
   * @param char - The character to look up
   * @returns The child node, or undefined if not found
   */
  getChild(char: string): TrieNode | undefined {
    return this.children.get(char);
  }

  /**
   * Check if this node has a child for the given character
   *
   * @param char - The character to check
   * @returns True if child exists
   */
  hasChild(char: string): boolean {
    return this.children.has(char);
  }

  /**
   * Mark this node as the end of a word and set postings
   *
   * @param postings - Document postings for this term
   */
  markAsEndOfWord(postings: DocumentPosting[]): void {
    this.isEndOfWord = true;
    this.postings = postings;
  }

  /**
   * Add a posting to this node's postings list
   * Assumes this node is already marked as end of word
   *
   * @param posting - The posting to add
   */
  addPosting(posting: DocumentPosting): void {
    this.postings.push(posting);
  }

  /**
   * Remove a posting for a specific document
   *
   * @param docId - The document ID to remove
   * @returns True if a posting was removed
   */
  removePosting(docId: string): boolean {
    const initialLength = this.postings.length;
    this.postings = this.postings.filter(p => p.docId !== docId);
    return this.postings.length < initialLength;
  }

  /**
   * Get all postings for this term
   *
   * @returns Array of document postings
   */
  getPostings(): DocumentPosting[] {
    return this.postings;
  }

  /**
   * Check if this node has any children
   *
   * @returns True if node has children
   */
  hasChildren(): boolean {
    return this.children.size > 0;
  }

  /**
   * Get number of children
   *
   * @returns Number of child nodes
   */
  getChildCount(): number {
    return this.children.size;
  }

  /**
   * Remove a child node
   *
   * @param char - The character whose child to remove
   * @returns True if child was removed
   */
  removeChild(char: string): boolean {
    return this.children.delete(char);
  }

  /**
   * Clear all postings (but keep the node structure)
   */
  clearPostings(): void {
    this.postings = [];
    this.isEndOfWord = false;
  }

  /**
   * Serialize this node to a plain object (for persistence)
   *
   * @returns Plain object representation
   */
  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      isEndOfWord: this.isEndOfWord,
      postings: this.postings,
      children: {},
    };

    // Serialize children recursively
    for (const [char, child] of this.children.entries()) {
      (obj.children as Record<string, unknown>)[char] = child.toJSON();
    }

    return obj;
  }

  /**
   * Deserialize a plain object into a TrieNode (for loading from persistence)
   *
   * @param obj - Plain object to deserialize
   * @returns New TrieNode instance
   */
  static fromJSON(obj: Record<string, unknown>): TrieNode {
    const node = new TrieNode();
    node.isEndOfWord = obj.isEndOfWord as boolean;
    node.postings = obj.postings as DocumentPosting[];

    // Deserialize children recursively
    const children = obj.children as Record<string, Record<string, unknown>>;
    for (const [char, childObj] of Object.entries(children)) {
      node.children.set(char, TrieNode.fromJSON(childObj));
    }

    return node;
  }

  /**
   * Get memory usage estimate for this node and all descendants
   *
   * @returns Estimated memory in bytes
   */
  getMemoryUsage(): number {
    let bytes = 0;

    // Base object overhead (~100 bytes)
    bytes += 100;

    // Postings array
    bytes += this.postings.length * 200; // Rough estimate per posting

    // Children map overhead
    bytes += this.children.size * 50;

    // Recursively calculate children
    for (const child of this.children.values()) {
      bytes += child.getMemoryUsage();
    }

    return bytes;
  }

  /**
   * Get total number of terms in this subtree
   *
   * @returns Number of complete terms
   */
  countTerms(): number {
    let count = this.isEndOfWord ? 1 : 0;

    for (const child of this.children.values()) {
      count += child.countTerms();
    }

    return count;
  }

  /**
   * Get all terms in this subtree with their postings
   *
   * @param prefix - The prefix leading to this node
   * @returns Array of [term, postings] tuples
   */
  getAllTerms(prefix = ''): Array<[string, DocumentPosting[]]> {
    const terms: Array<[string, DocumentPosting[]]> = [];

    if (this.isEndOfWord) {
      terms.push([prefix, this.postings]);
    }

    for (const [char, child] of this.children.entries()) {
      terms.push(...child.getAllTerms(prefix + char));
    }

    return terms;
  }
}
