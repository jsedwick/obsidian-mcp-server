/**
 * SearchRanker - Result ranking and formatting
 *
 * Responsible for:
 * - Final result ranking
 * - Result deduplication
 * - Response formatting based on detail level
 * - Truncation and summarization
 */

import { createLogger } from '../../utils/logger.js';
import { ResponseDetail } from '../../models/Search.js';
import type { SearchMatch, InternalSearchMatch } from '../../models/Search.js';

const logger = createLogger('SearchRanker');

/**
 * Service for ranking and formatting search results
 */
export class SearchRanker {
  /**
   * Format search results based on detail level
   *
   * @param results - Search results to format
   * @param totalMatches - Total number of matches before limiting
   * @param detailLevel - Response detail level
   * @param usedSemanticSearch - Whether semantic search was used
   * @param query - Original search query
   * @returns Formatted search results string
   */
  formatResults(
    results: SearchMatch[],
    totalMatches: number,
    detailLevel: ResponseDetail,
    usedSemanticSearch: boolean,
    query: string
  ): string {
    logger.debug('Formatting search results', {
      resultCount: results.length,
      totalMatches,
      detailLevel,
      usedSemanticSearch,
    });

    if (results.length === 0) {
      return `No results found for query: "${query}"`;
    }

    let output = '';

    // Header
    output += `Search results for "${query}":\n\n`;
    output += `Found ${totalMatches} matches. Top ${results.length} results:\n\n`;

    // Results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      output += `${i + 1}. **${result.file}**`;

      if (result.date) {
        output += ` (${result.date})`;
      }

      if (result.semanticScore !== undefined) {
        output += ` [semantic: ${Math.round(result.semanticScore * 100)}%]`;
      }

      if (result.vault) {
        output += ` [${result.vault} Vault]`;
      }

      output += '\n';

      // Add snippets based on detail level
      if (detailLevel !== ResponseDetail.MINIMAL && result.matches.length > 0) {
        for (const match of result.matches) {
          const truncated = this.smartTruncate(match, 200);
          output += `   ${truncated}\n`;
        }
      }

      output += '\n';
    }

    // Footer
    if (totalMatches > results.length) {
      output += `\n_Showing top ${results.length} of ${totalMatches} results. Refine your query or increase max_results for more._\n`;
    }

    output += `\n💡 Use get_session_context/get_topic_context for full content\n`;
    output += `💡 Use detail: "detailed" for more context per result\n`;

    if (usedSemanticSearch) {
      output += `✨ Results semantically re-ranked from top ${Math.min(100, totalMatches)} keyword matches\n`;
    }

    return output;
  }

  /**
   * Smart truncation that preserves sentence boundaries
   *
   * @param text - Text to truncate
   * @param maxLength - Maximum length
   * @param ellipsis - Ellipsis string
   * @returns Truncated text
   */
  smartTruncate(text: string, maxLength: number, ellipsis: string = '...'): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Try to truncate at sentence boundary
    const truncateAt = maxLength - ellipsis.length;
    let truncated = text.substring(0, truncateAt);

    // Look for sentence end markers within last 20% of the truncated text
    const searchStart = Math.floor(truncateAt * 0.8);
    const sentenceEndMatch = truncated.substring(searchStart).match(/[.!?]\s+/);

    if (sentenceEndMatch && sentenceEndMatch.index !== undefined) {
      const endIndex = searchStart + sentenceEndMatch.index + 1;
      truncated = truncated.substring(0, endIndex);
    } else {
      // Try to truncate at word boundary
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > searchStart) {
        truncated = truncated.substring(0, lastSpace);
      }
    }

    return truncated + ellipsis;
  }

  /**
   * Deduplicate results by file path
   *
   * @param results - Results to deduplicate
   * @returns Deduplicated results
   */
  deduplicateResults(results: InternalSearchMatch[]): InternalSearchMatch[] {
    const seen = new Set<string>();
    const deduplicated: InternalSearchMatch[] = [];

    for (const result of results) {
      if (!seen.has(result.file)) {
        seen.add(result.file);
        deduplicated.push(result);
      }
    }

    if (seen.size < results.length) {
      logger.debug('Deduplicated results', {
        original: results.length,
        deduplicated: seen.size,
        removed: results.length - seen.size,
      });
    }

    return deduplicated;
  }

  /**
   * Clean up temporary fields from search results
   *
   * @param results - Results to clean
   * @returns Cleaned results
   */
  cleanupResults(results: InternalSearchMatch[]): SearchMatch[] {
    return results.map(result => {
      const cleaned: SearchMatch = {
        file: result.file,
        matches: result.matches,
        score: result.score,
      };

      if (result.date) cleaned.date = result.date;
      if (result.semanticScore !== undefined) cleaned.semanticScore = result.semanticScore;
      if (result.vault) cleaned.vault = result.vault;

      return cleaned;
    });
  }
}
