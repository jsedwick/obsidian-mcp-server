/**
 * SemanticSearch unit tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SemanticSearch } from '../../../../src/services/search/SemanticSearch.js';
import type { EmbeddingService } from '../../../../src/services/embeddings/EmbeddingService.js';
import type { EmbeddingCache } from '../../../../src/services/embeddings/EmbeddingCache.js';
import type { InternalSearchMatch } from '../../../../src/models/Search.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockEmbeddingService(overrides: Partial<EmbeddingService> = {}): EmbeddingService {
  return {
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    cosineSimilarity: vi.fn().mockReturnValue(0.85),
    isInitialized: vi.fn().mockReturnValue(true),
    getModelName: vi.fn().mockReturnValue('test-model'),
    ...overrides,
  } as unknown as EmbeddingService;
}

function mockEmbeddingCache(overrides: Partial<EmbeddingCache> = {}): EmbeddingCache {
  return {
    isEnabled: vi.fn().mockReturnValue(true),
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn().mockReturnValue({ size: 0, vaultCount: 0, enabled: true }),
    setEnabled: vi.fn(),
    ...overrides,
  } as unknown as EmbeddingCache;
}

describe('SemanticSearch', () => {
  describe('generateQueryEmbedding', () => {
    it('should return embedding when enabled', async () => {
      const service = mockEmbeddingService();
      const cache = mockEmbeddingCache();
      const ss = new SemanticSearch(service, cache);

      const result = await ss.generateQueryEmbedding('test query');
      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(service.generateEmbedding).toHaveBeenCalledWith('test query');
    });

    it('should return null when disabled', async () => {
      const service = mockEmbeddingService();
      const cache = mockEmbeddingCache({ isEnabled: vi.fn().mockReturnValue(false) });
      const ss = new SemanticSearch(service, cache);

      const result = await ss.generateQueryEmbedding('test query');
      expect(result).toBeNull();
      expect(service.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should return null on failure', async () => {
      const service = mockEmbeddingService({
        generateEmbedding: vi.fn().mockRejectedValue(new Error('model fail')),
      });
      const cache = mockEmbeddingCache();
      const ss = new SemanticSearch(service, cache);

      const result = await ss.generateQueryEmbedding('test query');
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateDocumentEmbedding', () => {
    it('should return cached embedding and skip generation', async () => {
      const cachedEmbedding = [0.5, 0.6, 0.7];
      const service = mockEmbeddingService();
      const cache = mockEmbeddingCache({ get: vi.fn().mockReturnValue(cachedEmbedding) });
      const ss = new SemanticSearch(service, cache);

      const result = await ss.getOrCreateDocumentEmbedding('/vault/test.md', 'content', {
        mtime: new Date(),
      });

      expect(result).toEqual(cachedEmbedding);
      expect(service.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should generate and cache on miss', async () => {
      const service = mockEmbeddingService();
      const cache = mockEmbeddingCache();
      const ss = new SemanticSearch(service, cache);
      const fileStats = { mtime: new Date() };

      const result = await ss.getOrCreateDocumentEmbedding(
        '/vault/test.md',
        'content',
        fileStats,
        '/vault'
      );

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(service.generateEmbedding).toHaveBeenCalledWith('content');
      expect(cache.set).toHaveBeenCalledWith(
        '/vault/test.md',
        [0.1, 0.2, 0.3],
        fileStats,
        '/vault'
      );
    });
  });

  describe('reRankResults', () => {
    it('should re-sort results by semantic score', async () => {
      const service = mockEmbeddingService({
        cosineSimilarity: vi
          .fn()
          .mockReturnValueOnce(0.3) // doc-a gets low semantic
          .mockReturnValueOnce(0.9), // doc-b gets high semantic
      });
      const cache = mockEmbeddingCache();
      const ss = new SemanticSearch(service, cache);

      const results: InternalSearchMatch[] = [
        { file: 'doc-a', matches: [], score: 20, content: 'aaa', fileStats: { mtime: new Date() } },
        { file: 'doc-b', matches: [], score: 10, content: 'bbb', fileStats: { mtime: new Date() } },
      ];

      const reRanked = await ss.reRankResults([0.1, 0.2], results, 10);

      // doc-b should now be first (higher semantic score)
      expect(reRanked[0].file).toBe('doc-b');
      expect(reRanked[0].semanticScore).toBe(0.9);
    });
  });
});
