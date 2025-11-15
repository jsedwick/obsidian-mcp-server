/**
 * Unit tests for searchVault tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchVault } from '../../../../src/tools/search/searchVault.js';
import {
  createSearchToolsContext,
  createTestVault,
  cleanupTestVault,
  createTopicFile,
  createSessionFile,
  type SearchToolsContext,
} from '../../../helpers/index.js';

describe('searchVault', () => {
  let vaultPath: string;
  let context: SearchToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('search-vault');
    context = createSearchToolsContext({
      vaultPath,
      scoreSearchResult: vi.fn().mockResolvedValue({
        file: 'topics/test-topic.md',
        matches: ['Test match'],
        score: 100,
      }),
      formatSearchResults: vi.fn().mockReturnValue({
        content: [{ type: 'text', text: 'Search results' }],
      }),
    });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  describe('basic search', () => {
    it('should search vault for query', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Content with keyword');

      const result = await searchVault({ query: 'keyword' }, context);

      expect(result.content).toHaveLength(1);
      expect(context.formatSearchResults).toHaveBeenCalled();
    });

    it('should handle empty query results', async () => {
      context.scoreSearchResult = vi.fn().mockResolvedValue(null);

      const result = await searchVault({ query: 'nonexistent' }, context);

      expect(result.content).toBeDefined();
    });
  });

  describe('search parameters', () => {
    it('should respect max_results limit', async () => {
      const result = await searchVault(
        { query: 'test', max_results: 5 },
        context
      );

      expect(result.content).toBeDefined();
    });

    it('should filter by directories', async () => {
      const result = await searchVault(
        { query: 'test', directories: ['topics'] },
        context
      );

      expect(result.content).toBeDefined();
    });

    it('should support date range filtering', async () => {
      const result = await searchVault(
        {
          query: 'test',
          date_range: { start: '2025-01-01', end: '2025-01-31' },
        },
        context
      );

      expect(result.content).toBeDefined();
    });
  });

  describe('detail levels', () => {
    it('should use summary detail by default', async () => {
      await searchVault({ query: 'test' }, context);

      const formatCall = (context.formatSearchResults as any).mock.calls[0];
      expect(formatCall[2]).toBe('summary');
    });

    it('should support minimal detail level', async () => {
      await searchVault({ query: 'test', detail: 'minimal' }, context);

      const formatCall = (context.formatSearchResults as any).mock.calls[0];
      expect(formatCall[2]).toBe('minimal');
    });

    it('should support full detail level', async () => {
      await searchVault({ query: 'test', detail: 'full' }, context);

      const formatCall = (context.formatSearchResults as any).mock.calls[0];
      expect(formatCall[2]).toBe('full');
    });
  });

  describe('embedding integration', () => {
    it('should load embedding cache before search', async () => {
      await searchVault({ query: 'test' }, context);

      expect(context.loadEmbeddingCache).toHaveBeenCalled();
    });

    it('should handle disabled embeddings', async () => {
      context.embeddingConfig.enabled = false;

      const result = await searchVault({ query: 'test' }, context);

      expect(result.content).toBeDefined();
    });
  });
});
