/**
 * Unit tests for updateDocument tool
 *
 * Tests type detection, validation, frontmatter updates, and file tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updateDocument } from '../../../../src/tools/document/updateDocument.js';
import {
  createTestVault,
  cleanupTestVault,
  createDocumentToolsContext,
  type DocumentToolsContext,
} from '../../../helpers/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'yaml';

describe('updateDocument', () => {
  let vaultPath: string;
  let context: DocumentToolsContext;

  beforeEach(async () => {
    // Create a temporary vault for each test
    vaultPath = await createTestVault('update-document-test');

    // Create context with the vault path
    context = createDocumentToolsContext({
      vaultPath,
      currentSessionId: 'test-session-2025-01-06',
    });
  });

  afterEach(async () => {
    // Clean up temporary vault
    await cleanupTestVault(vaultPath);
  });

  describe('Type Detection', () => {
    it('should detect topic type from path', async () => {
      // Create a file without frontmatter in topics directory
      const topicPath = path.join(vaultPath, 'topics/test-topic.md');
      await fs.mkdir(path.dirname(topicPath), { recursive: true });
      await fs.writeFile(topicPath, 'Original content', 'utf-8');

      const result = await updateDocument(
        {
          file_path: topicPath,
          content: 'Updated content',
          strategy: 'replace',
          reason: 'Testing path-based detection',
        },
        context
      );

      expect(result.content[0].text).toContain('topic updated');
    });

    it('should detect type from valid frontmatter category', async () => {
      // Create a file with valid category in frontmatter
      const filePath = path.join(vaultPath, 'topics/test.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content = `---
category: topic
title: Test
---
Original content`;
      await fs.writeFile(filePath, content, 'utf-8');

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'Updated content',
          strategy: 'replace',
          reason: 'Testing frontmatter-based detection',
        },
        context
      );

      expect(result.content[0].text).toContain('topic updated');
    });

    it('should fallback to path-based detection for invalid frontmatter category', async () => {
      // Create a file with invalid category (like "reference") in frontmatter
      const filePath = path.join(vaultPath, 'topics/reference-test.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content = `---
category: reference
title: Test Reference
---
Original content`;
      await fs.writeFile(filePath, content, 'utf-8');

      // Should not throw "Cannot read properties of undefined" error
      // Should fallback to path-based detection and treat as 'topic'
      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'Updated content',
          strategy: 'replace',
          reason: 'Testing invalid category handling',
        },
        context
      );

      expect(result.content[0].text).toContain('topic updated');

      // Verify the file was actually updated
      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toContain('Updated content');
    });

    it('should throw error for unknown document type', async () => {
      // Create a file in an unrecognized location with invalid category
      const filePath = path.join(vaultPath, 'random/unknown.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'Content', 'utf-8');

      await expect(
        updateDocument(
          {
            file_path: filePath,
            content: 'Updated',
            strategy: 'replace',
          },
          context
        )
      ).rejects.toThrow('Unknown document type');
    });

    it('should throw helpful error for malformed YAML frontmatter', async () => {
      // Create a file with malformed YAML (unbalanced quote)
      const filePath = path.join(vaultPath, 'topics/malformed-yaml.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const malformedContent = `---
tags:
  - book
  - fiction
author: "[[Janelle Brown]]
date: 2026-01-07
---
Original content`;
      await fs.writeFile(filePath, malformedContent, 'utf-8');

      // Should throw descriptive error about YAML parsing failure
      await expect(
        updateDocument(
          {
            file_path: filePath,
            content: 'Updated content',
            strategy: 'replace',
            reason: 'Testing malformed YAML handling',
          },
          context
        )
      ).rejects.toThrow(/Failed to parse YAML frontmatter/);
    });
  });

  describe('Type Validation', () => {
    it('should prevent editing read-only session files', async () => {
      const sessionPath = path.join(vaultPath, 'sessions/2025-01/test-session.md');
      await fs.mkdir(path.dirname(sessionPath), { recursive: true });
      const content = `---
category: session
session_id: test-session
---
Session content`;
      await fs.writeFile(sessionPath, content, 'utf-8');

      await expect(
        updateDocument(
          {
            file_path: sessionPath,
            content: 'Updated',
            strategy: 'replace',
          },
          context
        )
      ).rejects.toThrow('Session files are read-only');
    });

    it('should prevent editing read-only commit files', async () => {
      const commitPath = path.join(vaultPath, 'projects/test-project/commits/abc123.md');
      await fs.mkdir(path.dirname(commitPath), { recursive: true });
      const content = `---
category: commit
commit_hash: abc123
---
Commit details`;
      await fs.writeFile(commitPath, content, 'utf-8');

      await expect(
        updateDocument(
          {
            file_path: commitPath,
            content: 'Updated',
            strategy: 'replace',
          },
          context
        )
      ).rejects.toThrow('Commit files are read-only');
    });

    it('should allow replacing accumulator files', async () => {
      const accumulatorPath = path.join(vaultPath, 'accumulator-corrections.md');
      const content = `---
category: accumulator
---
Existing corrections`;
      await fs.writeFile(accumulatorPath, content, 'utf-8');

      const result = await updateDocument(
        {
          file_path: accumulatorPath,
          content: 'Replaced',
          strategy: 'replace',
        },
        context
      );

      expect(result.content[0].text).toContain('accumulator updated');
      const updatedContent = await fs.readFile(accumulatorPath, 'utf-8');
      expect(updatedContent).toContain('Replaced');
      expect(updatedContent).not.toContain('Existing corrections');
    });

    it('should require reason parameter for topic updates', async () => {
      const topicPath = path.join(vaultPath, 'topics/test-topic.md');
      await fs.mkdir(path.dirname(topicPath), { recursive: true });
      const content = `---
category: topic
title: Test
---
Original content`;
      await fs.writeFile(topicPath, content, 'utf-8');

      await expect(
        updateDocument(
          {
            file_path: topicPath,
            content: 'Updated',
            strategy: 'replace',
            // Missing reason parameter
          },
          context
        )
      ).rejects.toThrow('Topic updates require a reason parameter');
    });
  });

  describe('Frontmatter Updates', () => {
    it('should update last_reviewed and review_count for topics', async () => {
      const topicPath = path.join(vaultPath, 'topics/test-topic.md');
      await fs.mkdir(path.dirname(topicPath), { recursive: true });
      const content = `---
category: topic
title: Test Topic
review_count: 5
last_reviewed: "2025-01-01"
---
Original content`;
      await fs.writeFile(topicPath, content, 'utf-8');

      await updateDocument(
        {
          file_path: topicPath,
          content: 'Updated content',
          strategy: 'replace',
          reason: 'Testing frontmatter updates',
        },
        context
      );

      const updated = await fs.readFile(topicPath, 'utf-8');
      const fmMatch = updated.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).toBeTruthy();

      const frontmatter = yaml.parse(fmMatch![1]);
      expect(frontmatter.review_count).toBe(6); // Incremented
      expect(frontmatter.last_reviewed).toBe(new Date().toISOString().split('T')[0]); // Today
    });

    it('should update last_updated for project files', async () => {
      const projectPath = path.join(vaultPath, 'projects/test-project/project.md');
      await fs.mkdir(path.dirname(projectPath), { recursive: true });
      const content = `---
category: project
title: Test Project
last_updated: "2025-01-01"
---
Project details`;
      await fs.writeFile(projectPath, content, 'utf-8');

      await updateDocument(
        {
          file_path: projectPath,
          content: 'Updated details',
          strategy: 'replace',
        },
        context
      );

      const updated = await fs.readFile(projectPath, 'utf-8');
      const fmMatch = updated.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = yaml.parse(fmMatch![1]);
      expect(frontmatter.last_updated).toBe(new Date().toISOString().split('T')[0]);
    });

    it('should maintain category for task lists', async () => {
      const taskPath = path.join(vaultPath, 'tasks/work-tasks.md');
      await fs.mkdir(path.dirname(taskPath), { recursive: true });
      const content = `---
title: Work Tasks
---
- [ ] Task 1`;
      await fs.writeFile(taskPath, content, 'utf-8');

      await updateDocument(
        {
          file_path: taskPath,
          content: '- [ ] Task 1\n- [ ] Task 2',
          strategy: 'replace',
        },
        context
      );

      const updated = await fs.readFile(taskPath, 'utf-8');
      const fmMatch = updated.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = yaml.parse(fmMatch![1]);
      expect(frontmatter.category).toBe('task-list');
    });
  });

  describe('Content Strategies', () => {
    it('should append content when strategy is append', async () => {
      const filePath = path.join(vaultPath, 'topics/test.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content = `---
category: topic
title: Test
---
Original content`;
      await fs.writeFile(filePath, content, 'utf-8');

      await updateDocument(
        {
          file_path: filePath,
          content: 'Appended content',
          strategy: 'append',
          reason: 'Testing append',
        },
        context
      );

      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toContain('Original content');
      expect(updated).toContain('Appended content');
    });

    it('should replace content when strategy is replace', async () => {
      const filePath = path.join(vaultPath, 'topics/test.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content = `---
category: topic
title: Test
---
Original content`;
      await fs.writeFile(filePath, content, 'utf-8');

      await updateDocument(
        {
          file_path: filePath,
          content: 'Replaced content',
          strategy: 'replace',
          reason: 'Testing replace',
        },
        context
      );

      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).not.toContain('Original content');
      expect(updated).toContain('Replaced content');
    });

    it('should handle section-edit for user-reference', async () => {
      const filePath = path.join(vaultPath, 'user-reference.md');
      const content = `---
title: User Reference
---
# User Reference

## Section One
Original content in section one.

## Section Two
Original content in section two.`;
      await fs.writeFile(filePath, content, 'utf-8');

      await updateDocument(
        {
          file_path: filePath,
          content: '## Section One\nUpdated content in section one.',
          strategy: 'section-edit',
        },
        context
      );

      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toContain('Updated content in section one');
      expect(updated).toContain('Original content in section two'); // Section Two unchanged
      expect(updated).not.toContain('Original content in section one');
    });
  });

  describe('File Access Tracking', () => {
    it('should track edit action for existing files', async () => {
      const filePath = path.join(vaultPath, 'topics/test.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content = `---
category: topic
title: Test
---
Original`;
      await fs.writeFile(filePath, content, 'utf-8');

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'Updated',
          strategy: 'replace',
          reason: 'Test',
        },
        context
      );

      expect(result.content[0].text).toContain('Action: edit');
      // Context should have tracked this file
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'edit');
    });

    it('should track create action for new files', async () => {
      const filePath = path.join(vaultPath, 'topics/new-topic.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'New content',
          strategy: 'replace',
          reason: 'Test',
        },
        context
      );

      expect(result.content[0].text).toContain('Action: create');
      expect(context.trackFileAccess).toHaveBeenCalledWith(filePath, 'create');
    });
  });
});
