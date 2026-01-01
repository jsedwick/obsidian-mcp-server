/**
 * Unit tests for archiveTopic tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { archiveTopic } from '../../../../src/tools/topics/archiveTopic.js';
import {
  createTopicsToolsContext,
  createTestVault,
  cleanupTestVault,
  createTopicFile,
  vaultFileExists,
  readVaultFile,
  type TopicsToolsContext,
} from '../../../helpers/index.js';

describe('archiveTopic', () => {
  let vaultPath: string;
  let context: TopicsToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('archive-topic');
    context = createTopicsToolsContext({ vaultPath });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it('should move topic to archive', async () => {
    await createTopicFile(vaultPath, 'old-topic', 'Old Topic', 'Outdated content');

    await archiveTopic({ topic: 'Old Topic' }, context);

    const originalExists = await vaultFileExists(vaultPath, 'topics/old-topic.md');
    const archiveExists = await vaultFileExists(vaultPath, 'archive/topics/old-topic.md');

    expect(originalExists).toBe(false);
    expect(archiveExists).toBe(true);
  });

  it('should preserve content when archiving', async () => {
    const originalContent = 'This is the original topic content';
    await createTopicFile(vaultPath, 'archive-me', 'Archive Me', originalContent);

    await archiveTopic({ topic: 'Archive Me' }, context);

    const archivedContent = await readVaultFile(vaultPath, 'archive/topics/archive-me.md');
    expect(archivedContent).toContain(originalContent);
  });

  it('should add archived metadata', async () => {
    await createTopicFile(vaultPath, 'archive-me', 'Archive Me', 'Content');

    await archiveTopic({ topic: 'Archive Me', reason: 'No longer relevant' }, context);

    const content = await readVaultFile(vaultPath, 'archive/topics/archive-me.md');
    expect(content).toContain('archived:');
    expect(content).toContain('archive_reason: No longer relevant');
  });

  it('should add archived metadata (Decision 043: review_history deprecated)', async () => {
    await createTopicFile(vaultPath, 'review-topic', 'Review Topic', 'Content');

    await archiveTopic({ topic: 'Review Topic', reason: 'Outdated' }, context);

    const content = await readVaultFile(vaultPath, 'archive/topics/review-topic.md');
    // Decision 043: review_history no longer updated, check archived fields instead
    expect(content).toContain('archived:');
    expect(content).toContain('archive_reason: Outdated');
  });

  it('should throw error for non-existent topic', async () => {
    await expect(archiveTopic({ topic: 'Nonexistent Topic' }, context)).rejects.toThrow(
      'Topic not found'
    );
  });
});
