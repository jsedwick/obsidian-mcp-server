/**
 * Unit tests for updateTopicPage tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updateTopicPage } from '../../../../src/tools/topics/updateTopicPage.js';
import {
  createTopicsToolsContext,
  createTestVault,
  cleanupTestVault,
  type TopicsToolsContext,
} from '../../../helpers/index.js';
import { createTopicFile } from '../../../helpers/vault.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('updateTopicPage', () => {
  let vaultPath: string;
  let context: TopicsToolsContext;

  beforeEach(async () => {
    // Create a temporary vault for each test
    vaultPath = await createTestVault('update-topic-test');

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

  describe('existing topic update', () => {
    it('should append content by default', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Original content.');

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'More content.',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      expect(content).toContain('Original content.');
      expect(content).toContain('More content.');
    });

    it('should replace content when append is false', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Original content.');

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'New content.',
          append: false,
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      expect(content).not.toContain('Original content.');
      expect(content).toContain('New content.');
    });

    it('should preserve frontmatter when appending', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Content', {
        created: '2025-01-15',
        tags: ['test'],
      });

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'Appended content.',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      expect(content).toContain('created: "2025-01-15"');
      expect(content).toContain('tags: ["test"]');
      expect(content).toContain('Appended content.');
    });

    it('should automatically update last_reviewed date when appending', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Content', {
        created: '2025-01-15',
        last_reviewed: '2025-01-15',
      });

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'Updated content.',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      expect(content).toContain(`last_reviewed: ${today}`);
      expect(content).not.toContain('last_reviewed: 2025-01-15');
    });

    it('should add last_reviewed date if not present', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Content', {
        created: '2025-01-15',
      });

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: 'Updated content.',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      expect(content).toContain(`last_reviewed: ${today}`);
    });
  });

  describe('non-existent topic creation', () => {
    it('should create topic if it does not exist', async () => {
      await updateTopicPage(
        {
          topic: 'New Topic',
          content: 'This is a new topic.',
        },
        context
      );

      // Verify createTopicPage was called since topic doesn't exist
      expect(context.createTopicPage).toHaveBeenCalledWith({
        topic: 'New Topic',
        content: 'This is a new topic.',
      });
    });
  });

  describe('content handling', () => {
    it('should strip frontmatter from new content when appending', async () => {
      await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Original');

      await updateTopicPage(
        {
          topic: 'Test Topic',
          content: '---\nnew_prop: true\n---\n\nNew content',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/test-topic.md'), 'utf-8');
      expect(content).not.toContain('new_prop: true');
      expect(content).toContain('Original');
      expect(content).toContain('New content');
    });

    it('should handle content without frontmatter', async () => {
      await createTopicFile(vaultPath, 'simple-topic', 'Simple Topic', 'Simple content');

      await updateTopicPage(
        {
          topic: 'Simple Topic',
          content: 'and more',
        },
        context
      );

      const content = await fs.readFile(path.join(vaultPath, 'topics/simple-topic.md'), 'utf-8');
      expect(content).toContain('Simple content');
      expect(content).toContain('and more');
    });
  });
});
