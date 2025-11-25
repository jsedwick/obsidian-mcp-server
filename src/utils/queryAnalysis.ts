/**
 * Query Analysis Utility
 *
 * Provides heuristic-based query pattern detection to optimize semantic search.
 * Extracts hints about temporal scope, content type, and sorting preferences
 * from natural language queries WITHOUT using AI/LLMs.
 *
 * This approach respects Decision 006 (no Claude Agent SDK integration)
 * while still providing intelligent query understanding for Decision 013.
 */

export interface QueryHints {
  // Temporal hints
  temporal: 'recent' | 'old' | 'specific-date' | null;
  dateRange?: {
    start?: Date;
    end?: Date;
  };

  // Content type hints
  scopeDirectories: string[];  // e.g., ['sessions', 'projects', 'topics']

  // Sorting hints
  sortPreference: 'date-desc' | 'date-asc' | 'relevance';

  // File limits (prevent full vault scans)
  maxFilesToScan?: number;
}

/**
 * Analyze a query and extract optimization hints
 */
export function analyzeQuery(query: string): QueryHints {
  const queryLower = query.toLowerCase();

  const hints: QueryHints = {
    temporal: null,
    scopeDirectories: [],
    sortPreference: 'relevance',
  };

  // Temporal detection
  const recentKeywords = ['recent', 'last', 'latest', 'new', 'newest', 'current'];
  const oldKeywords = ['old', 'oldest', 'first', 'earliest', 'initial', 'original'];
  const todayKeywords = ['today', 'today\'s'];
  const yesterdayKeywords = ['yesterday', 'yesterday\'s'];
  const thisWeekKeywords = ['this week', 'week', 'weekly'];
  const thisMonthKeywords = ['this month', 'month', 'monthly'];

  if (recentKeywords.some(kw => queryLower.includes(kw))) {
    hints.temporal = 'recent';
    hints.sortPreference = 'date-desc';
    hints.maxFilesToScan = 100; // Limit to recent files
  } else if (oldKeywords.some(kw => queryLower.includes(kw))) {
    hints.temporal = 'old';
    hints.sortPreference = 'date-asc';
    hints.maxFilesToScan = 100;
  }

  // Specific date patterns
  if (todayKeywords.some(kw => queryLower.includes(kw))) {
    hints.temporal = 'specific-date';
    hints.dateRange = {
      start: getStartOfDay(new Date()),
      end: new Date(),
    };
    hints.maxFilesToScan = 50;
  } else if (yesterdayKeywords.some(kw => queryLower.includes(kw))) {
    hints.temporal = 'specific-date';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    hints.dateRange = {
      start: getStartOfDay(yesterday),
      end: getEndOfDay(yesterday),
    };
    hints.maxFilesToScan = 50;
  } else if (thisWeekKeywords.some(kw => queryLower.includes(kw))) {
    hints.temporal = 'specific-date';
    hints.dateRange = {
      start: getStartOfWeek(new Date()),
      end: new Date(),
    };
    hints.maxFilesToScan = 150;
  } else if (thisMonthKeywords.some(kw => queryLower.includes(kw))) {
    hints.temporal = 'specific-date';
    hints.dateRange = {
      start: getStartOfMonth(new Date()),
      end: new Date(),
    };
    hints.maxFilesToScan = 300;
  }

  // Scope detection (content type)
  const scopePatterns: Record<string, string[]> = {
    sessions: ['session', 'conversation', 'work', 'worked on', 'did', 'discussion'],
    projects: ['project', 'repo', 'repository', 'codebase', 'git'],
    topics: ['topic', 'documentation', 'guide', 'how to', 'implementation'],
    decisions: ['decision', 'adr', 'architectural', 'chose', 'why'],
  };

  for (const [directory, keywords] of Object.entries(scopePatterns)) {
    if (keywords.some(kw => queryLower.includes(kw))) {
      hints.scopeDirectories.push(directory);
    }
  }

  // If no specific scope detected, don't limit (search all)
  // But if we have temporal hints, still apply them

  return hints;
}

/**
 * Apply query hints to filter file list
 */
export function applyFileFilters(
  files: Array<{ path: string; stats: { mtime: Date } }>,
  hints: QueryHints
): Array<{ path: string; stats: { mtime: Date } }> {
  let filtered = files;

  // Apply directory scope filter
  if (hints.scopeDirectories.length > 0) {
    filtered = filtered.filter(file => {
      return hints.scopeDirectories.some(dir =>
        file.path.includes(`/${dir}/`) || file.path.startsWith(`${dir}/`)
      );
    });
  }

  // Apply date range filter
  if (hints.dateRange) {
    filtered = filtered.filter(file => {
      const mtime = file.stats.mtime;
      if (hints.dateRange!.start && mtime < hints.dateRange!.start) {
        return false;
      }
      if (hints.dateRange!.end && mtime > hints.dateRange!.end) {
        return false;
      }
      return true;
    });
  }

  // Apply sorting
  if (hints.sortPreference === 'date-desc') {
    filtered.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
  } else if (hints.sortPreference === 'date-asc') {
    filtered.sort((a, b) => a.stats.mtime.getTime() - b.stats.mtime.getTime());
  }

  // Apply file limit
  if (hints.maxFilesToScan && filtered.length > hints.maxFilesToScan) {
    filtered = filtered.slice(0, hints.maxFilesToScan);
  }

  return filtered;
}

/**
 * Helper: Get start of day
 */
function getStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Helper: Get end of day
 */
function getEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Helper: Get start of week (Monday)
 */
function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Helper: Get start of month
 */
function getStartOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
