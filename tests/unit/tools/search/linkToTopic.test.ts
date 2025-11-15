/**
 * Unit tests for linkToTopic tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { linkToTopic } from '../../../../src/tools/search/linkToTopic.js';
import {
  createSearchToolsContext,
  createTestVault,
  cleanupTestVault,
  createTopicFile,
  vaultFileExists,
} from '../../../helpers/index.js';

describe('linkToTopic', () => {
  let vaultPath: string;
  let context: any;

  beforeEach(async () => {
    vaultPath = await createTestVault('link-topic');
    context = {
      vaultPath,
      slugify: (text: string) =>
        text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-'),
      createTopicPage: vi.fn().mockResolvedValue({ content: [] }),
    };
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it('should return wiki link for existing topic', async () => {
    await createTopicFile(vaultPath, 'existing-topic', 'Existing Topic', 'Content');

    const result = await linkToTopic({ topic: 'Existing Topic' }, context);

    expect(result.content[0].text).toBe('[[topics/existing-topic|Existing Topic]]');
    expect(context.createTopicPage).not.toHaveBeenCalled();
  });

  it('should create topic if it does not exist', async () => {
    const result = await linkToTopic({ topic: 'New Topic' }, context);

    expect(context.createTopicPage).toHaveBeenCalledWith({
      topic: 'New Topic',
      content: 'Topic created automatically via link.',
    });
    expect(result.content[0].text).toBe('[[topics/new-topic|New Topic]]');
  });

  it('should slugify topic name', async () => {
    const result = await linkToTopic({ topic: 'Topic With Spaces' }, context);

    expect(result.content[0].text).toContain('topics/topic-with-spaces');
  });
});
