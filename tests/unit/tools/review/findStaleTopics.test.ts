/**
 * Unit tests for findStaleTopics tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { findStaleTopics } from '../../../../src/tools/review/findStaleTopics.js';
import type { FindStaleTopicsContext } from '../../../../src/tools/review/findStaleTopics.js';
import { createTestVault, cleanupTestVault, createTopicFile } from '../../../helpers/vault.js';
import { slugify } from '../../../helpers/context.js';

describe('findStaleTopics', () => {
  let vaultPath: string;
  let context: FindStaleTopicsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('find-stale');
    context = {
      vaultPath,
      ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
      getFileAgeDays: vi.fn().mockReturnValue(60), // Default: 60 days old
      slugify,
      archiveTopic: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should find topics older than threshold', async () => {
    await createTopicFile(vaultPath, 'old-topic', 'Old Topic', 'Some content', {
      created: '2025-12-01',
    });
    await createTopicFile(vaultPath, 'another-old', 'Another Old Topic', 'More content', {
      created: '2025-11-15',
    });

    const result = await findStaleTopics({}, context);

    expect(result.content[0].text).toContain('Topics Needing Review');
    expect(result.content[0].text).toContain('Old Topic');
    expect(result.content[0].text).toContain('Another Old Topic');
  });

  it('should exclude recently reviewed topics', async () => {
    // Create a topic with frontmatter that includes last_reviewed (no YAML quotes)
    const topicPath = path.join(vaultPath, 'topics', 'fresh-topic.md');
    await fs.writeFile(
      topicPath,
      `---
title: Fresh Topic
created: 2025-12-01
last_reviewed: 2026-02-15
review_count: 3
---

# Fresh Topic

Content here
`,
      'utf-8'
    );

    // Mock getFileAgeDays to return different values based on date
    // The regex captures the raw frontmatter value string
    (context.getFileAgeDays as ReturnType<typeof vi.fn>).mockImplementation((date: string) => {
      if (date.includes('2026-02-15')) return 1; // 1 day old - not stale
      return 60; // Default old
    });

    const _result = await findStaleTopics({ age_threshold_days: 30 }, context);

    // Fresh topic should NOT appear in stale topics
    expect(_result.content[0].text).not.toContain('Fresh Topic');
  });

  it('should report no stale topics when all are current', async () => {
    await createTopicFile(vaultPath, 'current-topic', 'Current Topic', 'Content');

    (context.getFileAgeDays as ReturnType<typeof vi.fn>).mockReturnValue(5); // 5 days old

    const result = await findStaleTopics({}, context);
    expect(result.content[0].text).toContain('No stale topics found');
  });

  it('should auto-archive obsolete topics with high confidence', async () => {
    // Create a topic with strong obsolescence indicators
    const topicPath = path.join(vaultPath, 'topics', 'obsolete-topic.md');
    await fs.writeFile(
      topicPath,
      `---
title: "Obsolete Topic"
created: "2025-06-01"
review_count: 0
---

# Obsolete Topic

This approach is deprecated and no longer used.
CRITICAL ISSUE was RESOLVED in December.
The hook file /.config/old-hook.sh no longer exists.
`,
      'utf-8'
    );

    await findStaleTopics({}, context);

    // archiveTopic should have been called for the obsolete topic
    // (only if confidence is 'certain' = 3+ evidence points)
    expect(context.archiveTopic).toHaveBeenCalled();
  });

  it('should limit to top 10 oldest topics', async () => {
    // Create 12 topics
    for (let i = 0; i < 12; i++) {
      await createTopicFile(vaultPath, `topic-${i}`, `Topic ${i}`, `Content ${i}`, {
        created: '2025-01-01',
      });
    }

    const result = await findStaleTopics({}, context);

    // Should show max 10 topics
    const matches = result.content[0].text.match(/Created:/g) || [];
    expect(matches.length).toBeLessThanOrEqual(10);
  });

  it('should respect custom age threshold', async () => {
    await createTopicFile(vaultPath, 'medium-age', 'Medium Age Topic', 'Content');

    (context.getFileAgeDays as ReturnType<typeof vi.fn>).mockReturnValue(45);

    // With default 30-day threshold, should be stale
    const result30 = await findStaleTopics({ age_threshold_days: 30 }, context);
    expect(result30.content[0].text).toContain('Medium Age Topic');

    // With 60-day threshold, should NOT be stale
    const result60 = await findStaleTopics({ age_threshold_days: 60 }, context);
    expect(result60.content[0].text).toContain('No stale topics');
  });
});
