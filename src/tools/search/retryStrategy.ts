/**
 * Search Retry Strategy
 *
 * Assesses search result quality and decides whether to retry with a broadened query.
 * Used by searchVault to automatically improve poor results before returning them to the AI.
 */

// Tunable thresholds
export const RETRY_MIN_RESULTS = 3; // Retry if fewer than this many results
export const RETRY_MIN_KEYWORD_SCORE = 8; // Retry if top keyword score below this
export const RETRY_MIN_SEMANTIC_SCORE = 0.4; // Retry if top semantic score below this

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
}

/**
 * Assess whether search results are poor enough to warrant a retry with broadened query.
 */
export function shouldRetry(
  results: Array<{ score: number; semanticScore?: number }>,
  maxResults: number
): RetryDecision {
  // Zero results — obvious failure
  if (results.length === 0) {
    return { shouldRetry: true, reason: 'no results' };
  }

  // Too few results
  const minExpected = Math.min(RETRY_MIN_RESULTS, maxResults);
  if (results.length < minExpected) {
    return { shouldRetry: true, reason: 'few results' };
  }

  const topResult = results[0];

  // Check semantic score if available (takes precedence as it's the final ranking score)
  if (topResult.semanticScore !== undefined) {
    if (topResult.semanticScore < RETRY_MIN_SEMANTIC_SCORE) {
      return {
        shouldRetry: true,
        reason: `low relevance (${(topResult.semanticScore * 100).toFixed(0)}% semantic match)`,
      };
    }
    // Semantic score is good — no retry needed
    return { shouldRetry: false, reason: '' };
  }

  // Fall back to keyword score check
  if (topResult.score < RETRY_MIN_KEYWORD_SCORE) {
    return {
      shouldRetry: true,
      reason: `low relevance (keyword score ${topResult.score.toFixed(1)})`,
    };
  }

  return { shouldRetry: false, reason: '' };
}
