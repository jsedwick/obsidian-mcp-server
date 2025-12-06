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

  describe('smart append with Related sections', () => {
    it('should insert content before Related sections', async () => {
      // Create topic with Related sections at the end
      const topicPath = path.join(vaultPath, 'topics/test-with-related.md');
      const existingContent = `---
title: Test With Related
created: 2025-01-15
---
# Test With Related

Original content here.

## Related Topics

## Related Sessions
`;
      await fs.writeFile(topicPath, existingContent);

      await updateTopicPage(
        {
          topic: 'Test With Related',
          content: '## New Section\n\nAppended content.',
        },
        context
      );

      const content = await fs.readFile(topicPath, 'utf-8');

      // New content should appear BEFORE Related sections
      const newSectionIndex = content.indexOf('## New Section');
      const relatedTopicsIndex = content.indexOf('## Related Topics');

      expect(newSectionIndex).toBeGreaterThan(-1);
      expect(relatedTopicsIndex).toBeGreaterThan(-1);
      expect(newSectionIndex).toBeLessThan(relatedTopicsIndex);
    });

    it('should NOT insert inside code blocks containing Related sections', async () => {
      // This tests the bug fix: Related sections inside code blocks should be ignored
      const topicPath = path.join(vaultPath, 'topics/test-with-code-block.md');
      const existingContent = `---
title: Test With Code Block
created: 2025-01-15
---
# Test With Code Block

Here's an example of a topic structure:

\`\`\`markdown
# Example Topic

Some content.

## Related Topics
- [[example-link]]

## Related Sessions
- [[example-session]]
\`\`\`

The above is just an example.

## Related Topics

## Related Sessions
`;
      await fs.writeFile(topicPath, existingContent);

      await updateTopicPage(
        {
          topic: 'Test With Code Block',
          content: '## New Section\n\nAppended content.',
        },
        context
      );

      const content = await fs.readFile(topicPath, 'utf-8');

      // The code block should remain intact
      expect(content).toContain('```markdown');
      expect(content).toContain('- [[example-link]]');

      // Find the real Related Topics section (not inside code block)
      const lines = content.split('\n');
      let realRelatedLineIndex = -1;
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
        }
        if (!inCodeBlock && lines[i] === '## Related Topics') {
          realRelatedLineIndex = i;
          break;
        }
      }

      // New section should appear BEFORE the real Related Topics
      const newSectionLineIndex = lines.findIndex(l => l === '## New Section');
      expect(newSectionLineIndex).toBeGreaterThan(-1); // New section exists
      expect(realRelatedLineIndex).toBeGreaterThan(-1); // Real Related section exists
      expect(newSectionLineIndex).toBeLessThan(realRelatedLineIndex); // New section is before Related

      // Verify the code block example links are still intact (not corrupted)
      expect(content).toContain('- [[example-link]]');
      expect(content).toContain('- [[example-session]]');
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
