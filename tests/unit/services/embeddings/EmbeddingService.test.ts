/**
 * EmbeddingService unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @xenova/transformers before importing EmbeddingService
const { mockPipeline } = vi.hoisted(() => {
  const mockPipeline = vi.fn();
  return { mockPipeline };
});
vi.mock('@xenova/transformers', () => ({
  pipeline: mockPipeline,
}));

import { EmbeddingService } from '../../../../src/services/embeddings/EmbeddingService.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lazy loading', () => {
    it('should not call pipeline until first generateEmbedding', () => {
      new EmbeddingService('test-model');
      expect(mockPipeline).not.toHaveBeenCalled();
    });
  });

  describe('concurrent initialization', () => {
    it('should share a single promise for concurrent calls', async () => {
      const fakeEmbedding = { data: new Float32Array([0.1, 0.2, 0.3]) };
      const fakeExtractor = vi.fn().mockResolvedValue(fakeEmbedding);
      mockPipeline.mockResolvedValue(fakeExtractor);

      const service = new EmbeddingService('test-model');

      // Fire two calls concurrently
      const [result1, result2] = await Promise.all([
        service.generateEmbedding('hello'),
        service.generateEmbedding('world'),
      ]);

      // Pipeline should only be called once (shared initialization)
      expect(mockPipeline).toHaveBeenCalledTimes(1);
      expect(result1).toEqual([0.10000000149011612, 0.20000000298023224, 0.30000001192092896]);
      expect(result2).toEqual([0.10000000149011612, 0.20000000298023224, 0.30000001192092896]);
    });
  });

  describe('returns normalized vector', () => {
    it('should return an array of numbers from extractor result', async () => {
      const fakeEmbedding = { data: new Float32Array([0.5, 0.5, 0.5]) };
      const fakeExtractor = vi.fn().mockResolvedValue(fakeEmbedding);
      mockPipeline.mockResolvedValue(fakeExtractor);

      const service = new EmbeddingService('test-model');
      const result = await service.generateEmbedding('test text');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      result.forEach(v => expect(typeof v).toBe('number'));
    });
  });

  describe('model load failure', () => {
    it('should throw when pipeline fails to load', async () => {
      mockPipeline.mockRejectedValue(new Error('Model not found'));

      const service = new EmbeddingService('bad-model');

      await expect(service.generateEmbedding('test')).rejects.toThrow('Model not found');
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const service = new EmbeddingService();
      const vec = [1, 0, 0];
      expect(service.cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
    });

    it('should return 0.0 for orthogonal vectors', () => {
      const service = new EmbeddingService();
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      expect(service.cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0);
    });

    it('should return 0 when a vector has zero magnitude', () => {
      const service = new EmbeddingService();
      const vecA = [0, 0, 0];
      const vecB = [1, 2, 3];
      expect(service.cosineSimilarity(vecA, vecB)).toBe(0);
    });
  });
});
