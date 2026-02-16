/**
 * Unit tests for analyzeTopicContent tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  analyzeTopicContent,
  analyzeTopicContentInternal,
} from '../../../../src/tools/topics/analyzeTopicContent.js';
import type { AnalyzeTopicContentContext } from '../../../../src/tools/topics/analyzeTopicContent.js';

describe('analyzeTopicContent', () => {
  let context: AnalyzeTopicContentContext;

  beforeEach(() => {
    context = {
      searchVault: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Found 0 matches' }],
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return analysis prompt and duplicate check', async () => {
    const result = await analyzeTopicContent(
      {
        content: 'TypeScript implementation of a search algorithm using BM25 scoring.',
        topic_name: 'BM25 Search Algorithm',
      },
      context
    );

    expect(result.content[0].text).toContain('Topic Content Analysis');
    expect(result.content[0].text).toContain('Analysis Prompt');
    expect(result.content[0].text).toContain('Potential Duplicate Topics');
  });

  it('should search vault for similar topics', async () => {
    await analyzeTopicContent(
      {
        content: 'Some content about authentication and authorization patterns.',
      },
      context
    );

    expect(context.searchVault).toHaveBeenCalledWith(
      expect.objectContaining({
        directories: ['topics'],
        max_results: 5,
      })
    );
  });

  it('should report potential duplicates when found', async () => {
    context.searchVault = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Found 2 matches:\n\n**auth-patterns.md**\n**security-guide.md**' },
      ],
    });

    const result = await analyzeTopicContent(
      {
        content: 'Authentication and security patterns for web applications.',
      },
      context
    );

    expect(result.content[0].text).toContain('potentially similar');
    expect(result.content[0].text).toContain('auth-patterns.md');
  });

  it('should handle search failure gracefully', async () => {
    context.searchVault = vi.fn().mockRejectedValue(new Error('Search failed'));

    const result = await analyzeTopicContent(
      {
        content: 'Some content.',
      },
      context
    );

    expect(result.content[0].text).toContain('Error');
  });
});

describe('analyzeTopicContentInternal', () => {
  it('should extract tags from content', () => {
    const result = analyzeTopicContentInternal({
      content:
        'The TypeScript compiler uses BM25 scoring algorithm for search indexing. TypeScript provides type safety and BM25 provides relevance ranking.',
      topic_name: 'Search Algorithm',
    });

    expect(result.tags.length).toBeGreaterThanOrEqual(1);
    // Tags should NOT include words from the title
    expect(result.tags).not.toContain('search');
    expect(result.tags).not.toContain('algorithm');
  });

  it('should detect technical terms and acronyms', () => {
    const result = analyzeTopicContentInternal({
      content:
        'The API uses REST endpoints with JWT authentication. REST provides stateless communication and JWT enables token-based auth.',
      topic_name: 'API Design',
    });

    // Should detect acronyms
    expect(result.tags.some(t => ['jwt', 'rest'].includes(t))).toBe(true);
  });

  it('should return default tag when content is minimal', () => {
    const result = analyzeTopicContentInternal({
      content: 'A B.',
      topic_name: 'Short Topic',
    });

    expect(result.tags).toContain('topic');
  });

  it('should exclude title words from tags', () => {
    const result = analyzeTopicContentInternal({
      content: 'TypeScript provides type safety. TypeScript compiler. TypeScript tools.',
      topic_name: 'TypeScript Overview',
    });

    // "typescript" and "overview" should NOT be tags (they're in the title)
    expect(result.tags).not.toContain('typescript');
    expect(result.tags).not.toContain('overview');
  });

  it('should detect hyphenated technical terms', () => {
    const result = analyzeTopicContentInternal({
      content:
        'The server-side rendering approach uses client-side hydration. server-side rendering is fast.',
      topic_name: 'Rendering Strategies',
    });

    expect(result.tags.some(t => t.includes('-'))).toBe(true);
  });
});
