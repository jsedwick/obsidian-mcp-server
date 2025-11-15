/**
 * Unit tests for updateTopicPage tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { updateTopicPage } from '../../../../src/tools/topics/updateTopicPage.js';
import {
  createTopicsToolsContext,
  createTestVault,
  cleanupTestVault,
  createTopicFile,
  readVaultFile,
  vaultFileExists,
  type TopicsToolsContext,
} from '../../../helpers/index.js';

describe('updateTopicPage', () => {
  let vaultPath: string;
  let context: TopicsToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('update-topic');
    context = createTopicsToolsContext({
      vaultPath,
      createTopicPage: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Topic created' }] }),
    });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  describe('existing topic update', () => {
    it('should append content by default', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Original content');

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'Additional content',
        },
        context
      );

      const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
      expect(content).toContain('Original content');
      expect(content).toContain('Additional content');
    });

    it('should replace content when append is false', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Original content');

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: '---\ntitle: "Test Topic"\n---\n\nNew content only',
          append: false,
        },
        context
      );

      const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
      expect(content).not.toContain('Original content');
      expect(content).toContain('New content only');
    });

    it('should preserve frontmatter when appending', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Content', {
        created: '2025-01-15',
        tags: ['test'],
      });

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'More content',
        },
        context
      );

      const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
      expect(content).toContain('created:');
      expect(content).toContain('tags:');
    });
  });

  describe('non-existent topic creation', () => {
    it('should create topic if it does not exist', async () => {
      await updateTopicPage(
        {
          topic: 'New Topic',
          content: 'Brand new content',
        },
        context
      );

      expect(context.createTopicPage).toHaveBeenCalledWith({
        topic: 'New Topic',
        content: 'Brand new content',
      });
    });
  });

  describe('content handling', () => {
    it('should strip frontmatter from new content when appending', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Original');

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: '---\ntitle: "Test"\n---\n\nNew content',
        },
        context
      );

      const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
      const frontmatterCount = (content.match(/^---$/gm) || []).length;
      expect(frontmatterCount).toBe(2); // Only one frontmatter block
    });

    it('should handle content without frontmatter', async () => {
      await createTopicFile(vaultPath, 'simple-topic', 'Simple Topic', 'Simple content');

      await updateTopicPage(
        {
          topic: 'Simple Topic',
          content: 'More simple content',
        },
        context
      );

      const content = await readVaultFile(vaultPath, 'topics/simple-topic.md');
      expect(content).toContain('Simple content');
      expect(content).toContain('More simple content');
    });
  });
});
