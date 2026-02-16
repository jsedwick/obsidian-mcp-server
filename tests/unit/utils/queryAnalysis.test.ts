/**
 * queryAnalysis utility unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeQuery,
  applyFileFilters,
  type QueryHints,
} from '../../../src/utils/queryAnalysis.js';

describe('queryAnalysis', () => {
  describe('analyzeQuery', () => {
    describe('temporal detection', () => {
      it('should detect "recent" as temporal=recent', () => {
        const hints = analyzeQuery('recent sessions about testing');
        expect(hints.temporal).toBe('recent');
        expect(hints.sortPreference).toBe('date-desc');
        expect(hints.maxFilesToScan).toBe(100);
      });

      it('should detect "latest" as temporal=recent', () => {
        const hints = analyzeQuery('latest topic updates');
        expect(hints.temporal).toBe('recent');
      });

      it('should detect "last" as temporal=recent', () => {
        const hints = analyzeQuery('last conversation about MCP');
        expect(hints.temporal).toBe('recent');
      });

      it('should detect "old" as temporal=old', () => {
        const hints = analyzeQuery('old decisions about architecture');
        expect(hints.temporal).toBe('old');
        expect(hints.sortPreference).toBe('date-asc');
        expect(hints.maxFilesToScan).toBe(100);
      });

      it('should detect "earliest" as temporal=old', () => {
        const hints = analyzeQuery('earliest session logs');
        expect(hints.temporal).toBe('old');
      });
    });

    describe('specific date patterns', () => {
      it('should detect "today" as specific-date', () => {
        const hints = analyzeQuery('what did I work on today');
        expect(hints.temporal).toBe('specific-date');
        expect(hints.dateRange).toBeDefined();
        expect(hints.maxFilesToScan).toBe(50);
      });

      it('should detect "yesterday" as specific-date', () => {
        const hints = analyzeQuery("yesterday's session notes");
        expect(hints.temporal).toBe('specific-date');
        expect(hints.dateRange).toBeDefined();
        expect(hints.maxFilesToScan).toBe(50);
      });

      it('should detect "this week" as specific-date', () => {
        const hints = analyzeQuery("this week's progress");
        expect(hints.temporal).toBe('specific-date');
        expect(hints.dateRange).toBeDefined();
        expect(hints.maxFilesToScan).toBe(150);
      });

      it('should detect "this month" as specific-date', () => {
        const hints = analyzeQuery("this month's decisions");
        expect(hints.temporal).toBe('specific-date');
        expect(hints.dateRange).toBeDefined();
        expect(hints.maxFilesToScan).toBe(300);
      });

      it('should set date range start at beginning of day for today', () => {
        const hints = analyzeQuery('today');
        expect(hints.dateRange!.start!.getHours()).toBe(0);
        expect(hints.dateRange!.start!.getMinutes()).toBe(0);
        expect(hints.dateRange!.start!.getSeconds()).toBe(0);
      });
    });

    describe('scope detection', () => {
      it('should detect "session" scope', () => {
        const hints = analyzeQuery('session about MCP server');
        expect(hints.scopeDirectories).toContain('sessions');
      });

      it('should detect "project" scope', () => {
        const hints = analyzeQuery('project documentation');
        expect(hints.scopeDirectories).toContain('projects');
      });

      it('should detect "topic" scope', () => {
        const hints = analyzeQuery('topic about caching');
        expect(hints.scopeDirectories).toContain('topics');
      });

      it('should detect "decision" scope', () => {
        const hints = analyzeQuery('decision about testing strategy');
        expect(hints.scopeDirectories).toContain('decisions');
      });

      it('should detect multiple scopes', () => {
        const hints = analyzeQuery('session or topic about git');
        expect(hints.scopeDirectories).toContain('sessions');
        expect(hints.scopeDirectories).toContain('topics');
      });

      it('should detect scope via alternate keywords', () => {
        const hints = analyzeQuery('repository codebase');
        expect(hints.scopeDirectories).toContain('projects');
      });

      it('should return empty scope for generic queries', () => {
        const hints = analyzeQuery('search for everything');
        expect(hints.scopeDirectories).toHaveLength(0);
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase keywords', () => {
        const hints = analyzeQuery('RECENT SESSIONS');
        expect(hints.temporal).toBe('recent');
        expect(hints.scopeDirectories).toContain('sessions');
      });

      it('should handle mixed case', () => {
        const hints = analyzeQuery('Latest Decision about Architecture');
        expect(hints.temporal).toBe('recent');
        expect(hints.scopeDirectories).toContain('decisions');
      });
    });

    describe('default behavior', () => {
      it('should default to null temporal for generic queries', () => {
        const hints = analyzeQuery('search for testing patterns');
        expect(hints.temporal).toBeNull();
      });

      it('should default to relevance sort', () => {
        const hints = analyzeQuery('testing patterns');
        expect(hints.sortPreference).toBe('relevance');
      });

      it('should not set maxFilesToScan for generic queries', () => {
        const hints = analyzeQuery('testing patterns');
        expect(hints.maxFilesToScan).toBeUndefined();
      });
    });
  });

  describe('applyFileFilters', () => {
    const makeFile = (filePath: string, mtime: Date) => ({
      path: filePath,
      stats: { mtime },
    });

    const sampleFiles = [
      makeFile('/vault/sessions/s1.md', new Date('2026-01-01')),
      makeFile('/vault/topics/t1.md', new Date('2026-01-15')),
      makeFile('/vault/decisions/d1.md', new Date('2026-02-01')),
      makeFile('/vault/sessions/s2.md', new Date('2026-02-10')),
      makeFile('/vault/topics/t2.md', new Date('2026-02-15')),
    ];

    it('should filter by scope directories', () => {
      const hints: QueryHints = {
        temporal: null,
        scopeDirectories: ['sessions'],
        sortPreference: 'relevance',
      };
      const result = applyFileFilters(sampleFiles, hints);
      expect(result).toHaveLength(2);
      expect(result.every(f => f.path.includes('/sessions/'))).toBe(true);
    });

    it('should filter by multiple scope directories', () => {
      const hints: QueryHints = {
        temporal: null,
        scopeDirectories: ['sessions', 'topics'],
        sortPreference: 'relevance',
      };
      const result = applyFileFilters(sampleFiles, hints);
      expect(result).toHaveLength(4);
    });

    it('should sort date-desc', () => {
      const hints: QueryHints = {
        temporal: 'recent',
        scopeDirectories: [],
        sortPreference: 'date-desc',
      };
      const result = applyFileFilters(sampleFiles, hints);
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].stats.mtime.getTime()).toBeGreaterThanOrEqual(
          result[i].stats.mtime.getTime()
        );
      }
    });

    it('should sort date-asc', () => {
      const hints: QueryHints = {
        temporal: 'old',
        scopeDirectories: [],
        sortPreference: 'date-asc',
      };
      const result = applyFileFilters(sampleFiles, hints);
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].stats.mtime.getTime()).toBeLessThanOrEqual(
          result[i].stats.mtime.getTime()
        );
      }
    });

    it('should apply maxFilesToScan limit', () => {
      const hints: QueryHints = {
        temporal: null,
        scopeDirectories: [],
        sortPreference: 'relevance',
        maxFilesToScan: 2,
      };
      const result = applyFileFilters(sampleFiles, hints);
      expect(result).toHaveLength(2);
    });

    it('should filter by date range', () => {
      const hints: QueryHints = {
        temporal: 'specific-date',
        scopeDirectories: [],
        sortPreference: 'relevance',
        dateRange: {
          start: new Date('2026-02-01'),
          end: new Date('2026-02-28'),
        },
      };
      const result = applyFileFilters(sampleFiles, hints);
      expect(result).toHaveLength(3);
      expect(result.every(f => f.stats.mtime >= new Date('2026-02-01'))).toBe(true);
    });

    it('should return all files when no filters apply', () => {
      const hints: QueryHints = {
        temporal: null,
        scopeDirectories: [],
        sortPreference: 'relevance',
      };
      const result = applyFileFilters(sampleFiles, hints);
      expect(result).toHaveLength(5);
    });

    it('should handle empty file list', () => {
      const hints: QueryHints = {
        temporal: null,
        scopeDirectories: ['sessions'],
        sortPreference: 'relevance',
      };
      const result = applyFileFilters([], hints);
      expect(result).toHaveLength(0);
    });
  });
});
