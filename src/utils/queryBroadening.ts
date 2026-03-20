/**
 * Query Broadening Utility
 *
 * Deterministic query broadening for search retry. Transforms a query that
 * produced poor results into a broader query that may match more documents.
 *
 * No LLM involved — uses heuristic rules consistent with Decision 006
 * and the existing queryAnalysis.ts pattern.
 */

// Temporal/scope qualifiers that narrow searches but aren't core content terms
const QUALIFIER_WORDS = new Set([
  'recent',
  'latest',
  'last',
  'new',
  'newest',
  'current',
  'old',
  'oldest',
  'first',
  'earliest',
  'initial',
  'original',
  'today',
  'yesterday',
  'week',
  'month',
  'year',
  'this',
  'that',
  'these',
  'those',
  'session',
  'topic',
  'decision',
  'project',
  'find',
  'search',
  'look',
  'show',
  'get',
  'list',
]);

// Common stop words to drop when reducing to core terms
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'about',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'and',
  'or',
  'but',
  'not',
  'no',
  'nor',
  'if',
  'then',
  'than',
  'when',
  'where',
  'how',
  'what',
  'which',
  'who',
  'it',
  'its',
  'my',
  'your',
  'our',
  'their',
  'we',
  'they',
  'he',
  'she',
  'all',
  'any',
  'some',
  'each',
  'every',
]);

// Simple suffix patterns for broadening (not a full stemmer)
const SUFFIX_PATTERNS: Array<{ suffix: string; minWordLength: number }> = [
  { suffix: 'ation', minWordLength: 7 },
  { suffix: 'tion', minWordLength: 6 },
  { suffix: 'ment', minWordLength: 6 },
  { suffix: 'ness', minWordLength: 6 },
  { suffix: 'ing', minWordLength: 5 },
  { suffix: 'ings', minWordLength: 6 },
  { suffix: 'ed', minWordLength: 5 },
  { suffix: 'es', minWordLength: 5 },
  { suffix: 'er', minWordLength: 5 },
  { suffix: 'ers', minWordLength: 6 },
  { suffix: 's', minWordLength: 4 },
];

/**
 * Broaden a search query to improve recall on retry.
 *
 * Returns a broadened query string, or null if broadening produces
 * an identical or empty result (in which case retry should be skipped).
 */
export function broadenQuery(originalQuery: string): string | null {
  const normalized = originalQuery.trim().toLowerCase();
  if (!normalized) return null;

  const words = normalized.split(/\s+/);

  // Step 1: Strip qualifier words
  let coreWords = words.filter(w => !QUALIFIER_WORDS.has(w));

  // If stripping qualifiers removed everything, keep original words
  if (coreWords.length === 0) {
    coreWords = words;
  }

  // Step 2: Drop stop words if we have 4+ words
  if (coreWords.length >= 4) {
    const withoutStops = coreWords.filter(w => !STOP_WORDS.has(w));
    if (withoutStops.length >= 2) {
      coreWords = withoutStops;
    }
  }

  // Step 3: If still 4+ terms, keep the 3 most distinctive (longest)
  if (coreWords.length > 3) {
    coreWords = coreWords
      .slice() // Don't mutate
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);
  }

  // Step 4: Simple suffix stripping for each word
  const stemmed = coreWords.map(word => stripSuffix(word));

  const broadened = stemmed.join(' ').trim();

  // Don't retry with the same query
  if (broadened === normalized || broadened === '') {
    return null;
  }

  return broadened;
}

/**
 * Strip common suffixes to broaden term matching.
 * Conservative — only strips if the remaining stem is long enough to be meaningful.
 */
function stripSuffix(word: string): string {
  for (const { suffix, minWordLength } of SUFFIX_PATTERNS) {
    if (word.length >= minWordLength && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      // Ensure stem is at least 3 chars
      if (stem.length >= 3) {
        return stem;
      }
    }
  }
  return word;
}
