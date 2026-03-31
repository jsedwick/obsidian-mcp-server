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
import { getTodayLocal } from '../../../../src/utils/dateFormat.js';

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

    it('should recover from corrupted frontmatter with force: true', async () => {
      // Create a file with corrupted YAML frontmatter
      const filePath = path.join(vaultPath, 'topics/corrupted-frontmatter.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const corruptedContent = `---
title: Test Topic
category: topic
archived: 2026-01-19
archive_reason: Topic appears obsolete: Some long reason
---
Original corrupted content`;
      await fs.writeFile(filePath, corruptedContent, 'utf-8');

      // New content with valid frontmatter
      const newContent = `---
title: "Fixed Topic"
category: topic
created: "2026-01-19"
tags: ["topic", "fixed"]
---
# Fixed Topic

This content has been fixed with valid frontmatter.`;

      // Should succeed with force: true
      const result = await updateDocument(
        {
          file_path: filePath,
          content: newContent,
          strategy: 'replace',
          reason: 'Fixing corrupted frontmatter',
          force: true,
        },
        context
      );

      expect(result.content[0].text).toContain('updated');
      expect(result.content[0].text).toContain('Recovered from corrupted frontmatter');

      // Verify the file was updated with new content
      const savedContent = await fs.readFile(filePath, 'utf-8');
      expect(savedContent).toContain('Fixed Topic');
      expect(savedContent).toContain('This content has been fixed');
    });

    it('should fail with force: true if new content has no valid frontmatter', async () => {
      // Create a file with corrupted YAML frontmatter
      const filePath = path.join(vaultPath, 'topics/corrupted-no-recovery.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const corruptedContent = `---
title: Test Topic
archived: 2026-01-19
archive_reason: Some reason with: colons that break: yaml
---
Original content`;
      await fs.writeFile(filePath, corruptedContent, 'utf-8');

      // New content WITHOUT frontmatter
      const newContent = `# No Frontmatter

This content has no frontmatter at all.`;

      // Should fail because new content has no frontmatter to use
      await expect(
        updateDocument(
          {
            file_path: filePath,
            content: newContent,
            strategy: 'replace',
            reason: 'Attempting recovery without frontmatter',
            force: true,
          },
          context
        )
      ).rejects.toThrow(/force: true requires new content to have YAML frontmatter/);
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
      expect(frontmatter.last_reviewed).toBe(getTodayLocal()); // Today in local timezone
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
      expect(frontmatter.last_updated).toBe(getTodayLocal());
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

  describe('Post-Write Verification', () => {
    it('should include verification confirmation in output', async () => {
      const filePath = path.join(vaultPath, 'topics/test-verify.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(
        filePath,
        '---\ncategory: topic\ntitle: Test\n---\nOriginal content',
        'utf-8'
      );

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'Updated content',
          strategy: 'replace',
          reason: 'Testing verification output',
        },
        context
      );

      expect(result.content[0].text).toContain('Verified: ✅');
      expect(result.content[0].text).toMatch(/\d+ bytes/);
    });

    it('should warn when replace strategy causes significant content loss', async () => {
      const filePath = path.join(vaultPath, 'topics/large-topic.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // Create a file with >100 chars of body content
      const longBody = 'A'.repeat(200);
      await fs.writeFile(
        filePath,
        `---\ncategory: topic\ntitle: Large Topic\n---\n${longBody}`,
        'utf-8'
      );

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'Short replacement',
          strategy: 'replace',
          reason: 'Testing content loss detection',
        },
        context
      );

      expect(result.content[0].text).toContain('CONTENT LOSS WARNING');
      expect(result.content[0].text).toContain('git checkout');
    });

    it('should not warn when replace content is similar size', async () => {
      const filePath = path.join(vaultPath, 'topics/normal-topic.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const body = 'A'.repeat(150);
      await fs.writeFile(filePath, `---\ncategory: topic\ntitle: Normal\n---\n${body}`, 'utf-8');

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'B'.repeat(150),
          strategy: 'replace',
          reason: 'Testing no false positive',
        },
        context
      );

      expect(result.content[0].text).not.toContain('CONTENT LOSS WARNING');
    });

    it('should verify edit strategy replaced old_string', async () => {
      const filePath = path.join(vaultPath, 'topics/edit-verify.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(
        filePath,
        '---\ncategory: topic\ntitle: Edit Test\n---\nHello world, this is a test.',
        'utf-8'
      );

      const result = await updateDocument(
        {
          file_path: filePath,
          content: 'goodbye universe',
          strategy: 'edit',
          old_string: 'Hello world',
          reason: 'Testing edit verification',
        },
        context
      );

      expect(result.content[0].text).toContain('Verified: ✅');
      // Verify the replacement actually happened
      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toContain('goodbye universe');
      expect(updated).not.toContain('Hello world');
    });

    it('should not false-positive when replacement contains old_string', async () => {
      const filePath = path.join(vaultPath, 'topics/edit-superset.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(
        filePath,
        '---\ncategory: topic\ntitle: Superset Test\n---\n- item 1\n- item 2',
        'utf-8'
      );

      // Replace with content that contains the old_string as a subset
      const result = await updateDocument(
        {
          file_path: filePath,
          content: '- item 1\n- item 2\n- item 3',
          strategy: 'edit',
          old_string: '- item 1\n- item 2',
          reason: 'Testing superset replacement',
        },
        context
      );

      expect(result.content[0].text).toContain('Verified: ✅');
      expect(result.content[0].text).not.toContain('VERIFICATION FAILED');
      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toContain('- item 3');
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
