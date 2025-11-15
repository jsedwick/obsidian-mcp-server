/**
 * Unit tests for getTopicContext tool (moved from topics to search)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTopicContext } from '../../../../src/tools/search/getTopicContext.js';
import {
  createSearchToolsContext,
  createTestVault,
  cleanupTestVault,
  createTopicFile,
} from '../../../helpers/index.js';

describe('getTopicContext', () => {
  let vaultPath: string;
  let context: any;

  beforeEach(async () => {
    vaultPath = await createTestVault('get-topic');
    context = {
      vaultPath,
      slugify: (text: string) =>
        text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-'),
    };
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it('should retrieve topic context', async () => {
    await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Topic content here');

    const result = await getTopicContext({ topic: 'Test Topic' }, context);

    expect(result.content[0].text).toContain('Topic context for "Test Topic"');
    expect(result.content[0].text).toContain('Topic content here');
  });

  it('should throw error for non-existent topic', async () => {
    await expect(
      getTopicContext({ topic: 'Nonexistent Topic' }, context)
    ).rejects.toThrow('Topic not found');
  });

  it('should include frontmatter in output', async () => {
    await createTopicFile(vaultPath, 'topic-with-meta', 'Topic With Meta', 'Content', {
      created: '2025-01-15',
      tags: ['test', 'example'],
    });

    const result = await getTopicContext({ topic: 'Topic With Meta' }, context);

    expect(result.content[0].text).toContain('created:');
    expect(result.content[0].text).toContain('tags:');
  });
});
