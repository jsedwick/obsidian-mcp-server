/**
 * Unit tests for createTopicPage tool
 *
 * Demonstrates usage of vault helpers and topics context builders
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTopicPage } from '../../../../src/tools/topics/createTopicPage.js';
import {
  createTopicsToolsContext,
  createTestVault,
  cleanupTestVault,
  type TopicsToolsContext,
} from '../../../helpers/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('createTopicPage', () => {
  let vaultPath: string;
  let context: TopicsToolsContext;

  beforeEach(async () => {
    // Create a temporary vault for each test
    vaultPath = await createTestVault('topic-test');

    // Create context with the vault path
    context = createTopicsToolsContext({
      vaultPath,
      currentSessionId: 'test-session-2025-01-15',
    });
  });

  afterEach(async () => {
    // Clean up temporary vault
    await cleanupTestVault(vaultPath);
  });

  describe('basic topic creation', () => {
    it('should create a topic file with basic content', async () => {
      const result = await createTopicPage(
        {
          topic: 'Test Topic',
          content: 'This is a test topic about feature X.',
        },
        context
      );

      // Check result
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Topic page created');
      expect(result.content[0].text).toContain('test-topic');

      // Verify file was created
      const exists = await fs
        .access(path.join(vaultPath, 'topics/test-topic.md'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify file content
      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      expect(content).toContain('title: "Test Topic"');
      expect(content).toContain('This is a test topic about feature X.');
    });

    it('should slugify topic title for filename', async () => {
      await createTopicPage(
        {
          topic: 'Complex Topic Name With Spaces & Special!',
          content: 'Content here',
        },
        context
      );

      // Should create file with slugified name
      const exists = await fs
        .access(path.join(vaultPath, 'topics/complex-topic-name-with-spaces-special.md'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('frontmatter generation', () => {
    it('should include required frontmatter fields', async () => {
      await createTopicPage(
        {
          topic: 'Session Topic',
          content: 'Topic created during session',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/session-topic.md'), 'utf-8');
      expect(content).toContain('title: "Session Topic"');
      expect(content).toContain('created:');
      expect(content).toContain('last_reviewed:');
      expect(content).toContain('review_count:');
      expect(content).toContain('tags:');
      expect(content).toContain('review_history:');
    });

    it('should generate default tags when auto_analyze is false', async () => {
      await createTopicPage(
        {
          topic: 'Unanalyzed Topic',
          content: 'Simple content',
          auto_analyze: false,
        },
        context
      );

      const content = await fs.readFile(
        path.join(vaultPath, 'topics/unanalyzed-topic.md'),
        'utf-8'
      );
      expect(content).toContain('tags:');
    });
  });

  describe('content validation', () => {
    it('should reject investigation-style titles', async () => {
      await expect(
        createTopicPage(
          {
            topic: 'Fixing search bug',
            content: 'Found and fixed a bug',
          },
          context
        )
      ).rejects.toThrow('investigation/debugging details');
    });

    it('should reject troubleshooting session titles', async () => {
      await expect(
        createTopicPage(
          {
            topic: 'Troubleshooting session for API errors',
            content: 'Debugged the API',
          },
          context
        )
      ).rejects.toThrow('investigation/debugging details');
    });

    it('should accept generic how-to titles', async () => {
      await expect(
        createTopicPage(
          {
            topic: 'How to Configure TypeScript',
            content: 'TypeScript configuration guide',
          },
          context
        )
      ).resolves.toBeDefined();
    });
  });

  describe('topic tracking', () => {
    it('should track topic creation in context', async () => {
      await createTopicPage(
        {
          topic: 'Tracked Topic',
          content: 'Content',
        },
        context
      );

      expect(context.trackTopicCreation).toHaveBeenCalledWith({
        slug: 'tracked-topic',
        title: 'Tracked Topic',
        file: expect.stringContaining('topics/tracked-topic.md'),
      });
    });
  });

  describe('related content sections', () => {
    it('should include Related Sessions, Projects, and Decisions sections', async () => {
      await createTopicPage(
        {
          topic: 'Topic With Sections',
          content: 'Content with sections',
        },
        context
      );

      const content = await fs.readFile(
        path.join(vaultPath, 'topics/topic-with-sections.md'),
        'utf-8'
      );
      expect(content).toContain('## Related Sessions');
      expect(content).toContain('## Related Projects');
      expect(content).toContain('## Related Decisions');
    });

    it('should add related projects if found', async () => {
      // Mock findRelatedProjects to return a project
      const contextWithProjects = createTopicsToolsContext({
        vaultPath,
        findRelatedProjects: async () => [
          { link: 'projects/test-project/project', name: 'Test Project' },
        ],
      });

      const result = await createTopicPage(
        {
          topic: 'Topic With Project',
          content: 'Mentions test-project repository',
        },
        contextWithProjects
      );

      // Check result mentions related project
      expect(result.content[0].text).toContain('Found 1 related project');
      expect(result.content[0].text).toContain('Test Project');

      // Check file contains project link
      const content = await fs.readFile(
        path.join(vaultPath, 'topics/topic-with-project.md'),
        'utf-8'
      );
      expect(content).toContain('[[projects/test-project/project|Test Project]]');
    });
  });

  describe('multiple topics', () => {
    it('should create multiple topics independently', async () => {
      await createTopicPage({ topic: 'Topic One', content: 'First topic' }, context);

      await createTopicPage({ topic: 'Topic Two', content: 'Second topic' }, context);

      await createTopicPage({ topic: 'Topic Three', content: 'Third topic' }, context);

      const exists1 = await fs
        .access(path.join(vaultPath, 'topics/topic-one.md'))
        .then(() => true)
        .catch(() => false);
      const exists2 = await fs
        .access(path.join(vaultPath, 'topics/topic-two.md'))
        .then(() => true)
        .catch(() => false);
      const exists3 = await fs
        .access(path.join(vaultPath, 'topics/topic-three.md'))
        .then(() => true)
        .catch(() => false);

      expect(exists1).toBe(true);
      expect(exists2).toBe(true);
      expect(exists3).toBe(true);

      expect(context.trackTopicCreation).toHaveBeenCalledTimes(3);
    });
  });

  describe('edge cases', () => {
    it('should handle very long topic content', async () => {
      const longContent = 'Lorem ipsum dolor sit amet. '.repeat(1000);

      await createTopicPage(
        {
          topic: 'Long Topic',
          content: longContent,
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/long-topic.md'), 'utf-8');
      expect(content).toContain(longContent);
    });

    it('should handle topics with special characters in content', async () => {
      const specialContent = 'Content with `code`, **bold**, and [[links]]';

      await createTopicPage(
        {
          topic: 'Special Topic',
          content: specialContent,
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/special-topic.md'), 'utf-8');
      expect(content).toContain(specialContent);
    });

    it('should handle unicode characters in title and content', async () => {
      await createTopicPage(
        {
          topic: 'Topic with émojis 🚀 and unicode',
          content: 'Content with 中文字符 and émojis 🎉',
        },
        context
      );

      const exists = await fs
        .access(path.join(vaultPath, 'topics/topic-with-mojis-and-unicode.md'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(
        path.join(vaultPath, 'topics/topic-with-mojis-and-unicode.md'),
        'utf-8'
      );
      expect(content).toContain('Content with 中文字符 and émojis 🎉');
    });
  });
});
