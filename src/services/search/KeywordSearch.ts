/**
 * KeywordSearch - Traditional text-based search
 *
 * Responsible for:
 * - Keyword matching and scoring
 * - Frequency-based relevance
 * - Position-based scoring (headers, first paragraph, etc.)
 * - Date range filtering
 */

import { createLogger } from '../../utils/logger.js';
import type { InternalSearchMatch, DateRange } from '../../models/Search.js';

const logger = createLogger('KeywordSearch');

/**
 * Service for keyword-based search
 */
export class KeywordSearch {
  /**
   * Score a search result based on keyword matching
   *
   * @param dir - Directory category (sessions, topics, decisions, etc.)
   * @param relPath - Relative file path
   * @param fileName - File name
   * @param content - File content
   * @param fileStats - File statistics
   * @param queryLower - Lowercased query string
   * @param queryTerms - Individual query terms
   * @param dateRange - Optional date range filter
   * @param absolutePath - Absolute file path (for cache key)
   * @returns Search match or null if no match
   */
  scoreSearchResult(
    dir: string,
    relPath: string,
    fileName: string,
    content: string,
    fileStats: any,
    queryLower: string,
    queryTerms: string[],
    dateRange?: DateRange,
    absolutePath?: string
  ): InternalSearchMatch | null {
    const contentLower = content.toLowerCase();
    let keywordScore = 0;
    let hasMatch = false;

    // Extract date from frontmatter or filename
    let fileDate: string | undefined;
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';

    if (frontmatterMatch) {
      const createdMatch = frontmatter.match(/created:\s*(.+)/);
      const dateMatch = frontmatter.match(/date:\s*(.+)/);
      if (createdMatch) {
        fileDate = createdMatch[1].trim().replace(/"/g, '');
      } else if (dateMatch) {
        fileDate = dateMatch[1].trim().replace(/"/g, '');
      }
    }

    // Try to extract date from filename (YYYY-MM-DD format)
    if (!fileDate) {
      const filenameDateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
      if (filenameDateMatch) {
        fileDate = filenameDateMatch[1];
      }
    }

    // Filter by date range if provided
    if (dateRange && fileDate) {
      if (dateRange.start && fileDate < dateRange.start) {
        return null;
      }
      if (dateRange.end && fileDate > dateRange.end) {
        return null;
      }
    }

    // Parse content structure
    const lines = content.split('\n');
    let frontmatterEnd = 0;
    if (frontmatterMatch) {
      frontmatterEnd = frontmatterMatch[0].split('\n').length;
    }

    // Find first paragraph (after frontmatter)
    let firstParagraphStart = frontmatterEnd;
    let firstParagraphEnd = frontmatterEnd;
    for (let i = frontmatterEnd; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#')) {
        firstParagraphStart = i;
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          if (!lines[j].trim() || lines[j].trim().startsWith('#')) {
            firstParagraphEnd = j;
            break;
          }
          firstParagraphEnd = j;
        }
        break;
      }
    }
    const firstParagraph = lines
      .slice(firstParagraphStart, firstParagraphEnd + 1)
      .join('\n')
      .toLowerCase();

    // Exact phrase match (highest weight)
    if (queryTerms.length > 1 && contentLower.includes(queryLower)) {
      keywordScore += 15;
      hasMatch = true;
      logger.debug('Exact phrase match', { file: fileName, score: 15 });
    }

    // Term matching
    for (const term of queryTerms) {
      const termRegex = new RegExp(term, 'g');
      const matches = contentLower.match(termRegex) || [];
      const termCount = matches.length;

      // Check if term matches filename first
      const matchesFilename = fileName.toLowerCase().includes(term);

      if (termCount > 0) {
        hasMatch = true;

        // Frequency scoring (logarithmic to prevent spam)
        const frequencyScore = Math.log(termCount + 1) * 3;
        keywordScore += frequencyScore;

        // Position-based scoring (headers get higher weight)
        for (const line of lines) {
          if (line.trim().startsWith('#') && line.toLowerCase().includes(term)) {
            keywordScore += 10;
            break;
          }
        }

        // Tag matching
        if (
          frontmatter.toLowerCase().includes(`tags:`) &&
          frontmatter.toLowerCase().includes(term)
        ) {
          keywordScore += 7;
        }

        // First paragraph matching
        if (firstParagraph.includes(term)) {
          keywordScore += 3;
        }

        // Recency bonus
        if (fileDate) {
          const age = this.getFileAgeDays(fileDate);
          if (age < 7) keywordScore += 3;
          else if (age < 30) keywordScore += 2;
          else if (age < 90) keywordScore += 1;
        }
      }

      // Filename matching - contributes to hasMatch even if content doesn't match
      if (matchesFilename) {
        hasMatch = true;
        keywordScore += 5;
      }
    }

    // Topic review scoring (recently reviewed topics score higher)
    if (dir === 'topics' && hasMatch) {
      if (frontmatterMatch) {
        const lastReviewedMatch = frontmatter.match(/last_reviewed:\s*(.+)/);
        const createdMatch = frontmatter.match(/created:\s*(.+)/);

        if (lastReviewedMatch) {
          const lastReviewed = lastReviewedMatch[1].trim();
          const reviewAge = this.getFileAgeDays(lastReviewed);
          if (reviewAge < 365) {
            keywordScore += 2;
          }
        } else if (createdMatch) {
          const created = createdMatch[1].trim();
          const creationAge = this.getFileAgeDays(created);
          if (creationAge > 365) {
            keywordScore -= 2; // Penalize very old unreviewable topics
          }
        }
      }
    }

    // Return keyword-based results only
    // Semantic re-ranking will happen in a separate phase
    if (hasMatch) {
      const matchingLines = lines
        .filter(line => {
          const lineLower = line.toLowerCase();
          return queryTerms.some(term => lineLower.includes(term));
        })
        .slice(0, 3); // Take top 3 matching lines

      logger.debug('Keyword match found', {
        file: fileName,
        score: keywordScore,
        matchingLines: matchingLines.length,
      });

      return {
        file: absolutePath || `${dir}/${relPath}`, // Use absolute path when available
        matches: matchingLines,
        date: fileDate,
        score: keywordScore,
        content: content, // Include content for later semantic scoring
        fileStats: fileStats, // Include file stats for embedding cache
      };
    }

    return null;
  }

  /**
   * Calculate file age in days from a date string
   */
  private getFileAgeDays(dateStr: string): number {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    } catch {
      return Infinity; // Invalid date = very old
    }
  }
}
