/**
 * Unit tests for toggleEmbeddings tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toggleEmbeddings } from '../../../../src/tools/maintenance/toggleEmbeddings.js';

describe('toggleEmbeddings', () => {
  let context: any;

  beforeEach(() => {
    context = {
      embeddingConfig: { enabled: false },
      embeddingToggleFile: '/tmp/embedding-toggle.json',
      embeddingCache: new Map(),
      setExtractor: vi.fn(),
      setEmbeddingInitPromise: vi.fn(),
    };
  });

  it('should enable embeddings when disabled', async () => {
    const result = await toggleEmbeddings({ enabled: true }, context);

    expect(context.embeddingConfig.enabled).toBe(true);
    expect(result.content[0].text).toContain('enabled');
  });

  it('should disable embeddings when enabled', async () => {
    context.embeddingConfig.enabled = true;

    const result = await toggleEmbeddings({ enabled: false }, context);

    expect(context.embeddingConfig.enabled).toBe(false);
    expect(result.content[0].text).toContain('disabled');
    expect(context.setExtractor).toHaveBeenCalledWith(null);
  });

  it('should toggle current state when no argument provided', async () => {
    const result = await toggleEmbeddings({}, context);

    expect(context.embeddingConfig.enabled).toBe(true);
  });

  it('should clear cache when disabling', async () => {
    context.embeddingConfig.enabled = true;
    context.embeddingCache.set('test', {});

    await toggleEmbeddings({ enabled: false }, context);

    expect(context.embeddingCache.size).toBe(0);
  });
});
