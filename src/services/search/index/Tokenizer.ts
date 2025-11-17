/**
 * Tokenizer - Extract and normalize terms from text
 *
 * Responsibilities:
 * - Split text into individual terms
 * - Normalize terms (lowercase, trim)
 * - Filter out stop words (optional)
 * - Extract terms from different fields (title, content, tags, frontmatter)
 * - Track term positions for phrase search
 */

import type { Term, TokenizationOptions, IndexField } from '../../../models/IndexModels.js';
import { IndexField as Field, DEFAULT_TOKENIZATION_OPTIONS } from '../../../models/IndexModels.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('Tokenizer');

/**
 * Tokenizer for extracting searchable terms from documents
 */
export class Tokenizer {
  private options: TokenizationOptions;

  /**
   * Create a new tokenizer
   *
   * @param options - Tokenization options (defaults to DEFAULT_TOKENIZATION_OPTIONS)
   */
  constructor(options: Partial<TokenizationOptions> = {}) {
    this.options = {
      ...DEFAULT_TOKENIZATION_OPTIONS,
      ...options,
    };

    logger.debug('Tokenizer initialized', {
      minTermLength: this.options.minTermLength,
      removeStopWords: this.options.removeStopWords,
      applyStemming: this.options.applyStemming,
    });
  }

  /**
   * Tokenize a complete document into terms
   *
   * @param content - Full document content (markdown)
   * @param metadata - Document metadata for extracting fields
   * @returns Array of terms with positions and field information
   */
  tokenizeDocument(
    content: string,
    metadata?: {
      path?: string;
      frontmatter?: Record<string, unknown>;
    }
  ): Term[] {
    const terms: Term[] = [];

    // Extract frontmatter if present
    const { frontmatter, contentWithoutFrontmatter } = this.extractFrontmatter(content);

    // 1. Tokenize title from filename or frontmatter
    const title = this.extractTitle(metadata?.path, frontmatter);
    if (title) {
      const titleTerms = this.tokenizeField(title, Field.TITLE);
      terms.push(...titleTerms);
    }

    // 2. Tokenize tags from frontmatter
    const tags = this.extractTags(frontmatter);
    if (tags.length > 0) {
      const tagTerms = this.tokenizeField(tags.join(' '), Field.TAGS);
      terms.push(...tagTerms);
    }

    // 3. Tokenize frontmatter fields (excluding title and tags)
    const frontmatterText = this.extractFrontmatterText(frontmatter);
    if (frontmatterText) {
      const frontmatterTerms = this.tokenizeField(frontmatterText, Field.FRONTMATTER);
      terms.push(...frontmatterTerms);
    }

    // 4. Tokenize main content
    const contentTerms = this.tokenizeField(contentWithoutFrontmatter, Field.CONTENT);
    terms.push(...contentTerms);

    logger.debug('Document tokenized', {
      totalTerms: terms.length,
      uniqueTerms: new Set(terms.map(t => t.text)).size,
    });

    return terms;
  }

  /**
   * Tokenize a specific field
   *
   * @param text - Text to tokenize
   * @param field - Field type
   * @returns Array of terms with positions
   */
  private tokenizeField(text: string, field: IndexField): Term[] {
    const tokens = this.tokenize(text);
    return tokens.map((token, index) => ({
      text: token,
      position: index,
      field,
    }));
  }

  /**
   * Tokenize text into normalized terms
   *
   * @param text - Text to tokenize
   * @returns Array of normalized term strings
   */
  tokenize(text: string): string[] {
    if (!text || text.length === 0) {
      return [];
    }

    // 1. Normalize: lowercase
    const normalized = text.toLowerCase();

    // 2. Split on word boundaries
    // Matches: spaces, hyphens, underscores, punctuation
    const tokens = normalized
      .split(/[\s\-_.,!?;:()\[\]{}'"]+/)
      .filter(token => token.length > 0);

    // 3. Filter by minimum length
    const lengthFiltered = tokens.filter(
      token => token.length >= this.options.minTermLength
    );

    // 4. Remove stop words (if enabled)
    const stopWordFiltered = this.options.removeStopWords
      ? lengthFiltered.filter(token => !this.isStopWord(token))
      : lengthFiltered;

    // 5. Apply stemming (if enabled) - NOT IMPLEMENTED in v1
    // const stemmed = this.options.applyStemming
    //   ? stopWordFiltered.map(token => this.stem(token))
    //   : stopWordFiltered;

    return stopWordFiltered;
  }

  /**
   * Check if a term is a stop word
   *
   * @param term - The term to check
   * @returns True if it's a stop word
   */
  private isStopWord(term: string): boolean {
    return this.options.stopWords?.has(term) ?? false;
  }

  /**
   * Extract frontmatter from markdown content
   *
   * @param content - Markdown content
   * @returns Parsed frontmatter and content without frontmatter
   */
  private extractFrontmatter(content: string): {
    frontmatter: Record<string, unknown>;
    contentWithoutFrontmatter: string;
  } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return {
        frontmatter: {},
        contentWithoutFrontmatter: content,
      };
    }

    const frontmatterText = match[1];
    const frontmatter = this.parseFrontmatter(frontmatterText);
    const contentWithoutFrontmatter = content.slice(match[0].length);

    return { frontmatter, contentWithoutFrontmatter };
  }

  /**
   * Parse YAML frontmatter into object
   * Simple parser for common patterns (not full YAML)
   *
   * @param text - Frontmatter text
   * @returns Parsed frontmatter object
   */
  private parseFrontmatter(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const lines = text.split('\n');
    for (const line of lines) {
      // Match key: value patterns
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        let value: unknown = match[2].trim();

        // Remove quotes
        if (typeof value === 'string') {
          value = value.replace(/^["']|["']$/g, '');
        }

        // Parse arrays (simple case: [a, b, c])
        if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value
            .slice(1, -1)
            .split(',')
            .map(item => item.trim().replace(/^["']|["']$/g, ''));
        }

        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Extract title from filename or frontmatter
   *
   * @param path - File path
   * @param frontmatter - Parsed frontmatter
   * @returns Title string or null
   */
  private extractTitle(path?: string, frontmatter?: Record<string, unknown>): string | null {
    // Try frontmatter title first
    if (frontmatter?.title) {
      return String(frontmatter.title);
    }

    // Extract from filename
    if (path) {
      const filename = path.split('/').pop() || '';
      const titleWithoutExt = filename.replace(/\.md$/, '');
      return titleWithoutExt;
    }

    return null;
  }

  /**
   * Extract tags from frontmatter
   *
   * @param frontmatter - Parsed frontmatter
   * @returns Array of tags
   */
  private extractTags(frontmatter?: Record<string, unknown>): string[] {
    if (!frontmatter?.tags) {
      return [];
    }

    const tags = frontmatter.tags;

    if (Array.isArray(tags)) {
      return tags.map(String);
    }

    if (typeof tags === 'string') {
      // Handle comma-separated tags
      return tags.split(',').map(tag => tag.trim());
    }

    return [];
  }

  /**
   * Extract searchable text from frontmatter
   * (excludes title and tags which are indexed separately)
   *
   * @param frontmatter - Parsed frontmatter
   * @returns Combined frontmatter text
   */
  private extractFrontmatterText(frontmatter?: Record<string, unknown>): string | null {
    if (!frontmatter) {
      return null;
    }

    const excludeKeys = new Set(['title', 'tags', 'created', 'last_reviewed', 'review_count']);
    const textParts: string[] = [];

    for (const [key, value] of Object.entries(frontmatter)) {
      if (excludeKeys.has(key)) {
        continue;
      }

      if (typeof value === 'string') {
        textParts.push(value);
      } else if (Array.isArray(value)) {
        textParts.push(...value.map(String));
      }
    }

    return textParts.length > 0 ? textParts.join(' ') : null;
  }

  /**
   * Get unique terms from a list of terms
   *
   * @param terms - Array of terms
   * @returns Array of unique term texts
   */
  getUniqueTerms(terms: Term[]): string[] {
    return Array.from(new Set(terms.map(t => t.text)));
  }

  /**
   * Group terms by field
   *
   * @param terms - Array of terms
   * @returns Map of field ’ terms
   */
  groupByField(terms: Term[]): Map<IndexField, Term[]> {
    const grouped = new Map<IndexField, Term[]>();

    for (const term of terms) {
      const existing = grouped.get(term.field) || [];
      existing.push(term);
      grouped.set(term.field, existing);
    }

    return grouped;
  }

  /**
   * Get term frequency (how many times each term appears)
   *
   * @param terms - Array of terms
   * @returns Map of term ’ frequency
   */
  getTermFrequencies(terms: Term[]): Map<string, number> {
    const frequencies = new Map<string, number>();

    for (const term of terms) {
      frequencies.set(term.text, (frequencies.get(term.text) || 0) + 1);
    }

    return frequencies;
  }
}
