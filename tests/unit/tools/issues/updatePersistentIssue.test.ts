import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { updatePersistentIssue } from '../../../../src/tools/issues/updatePersistentIssue.js';
import type { UpdatePersistentIssueContext } from '../../../../src/tools/issues/updatePersistentIssue.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

/**
 * Create a valid persistent issue file for testing
 */
async function createIssueFile(
  vaultPath: string,
  slug: string,
  opts?: { sessions?: string[] }
): Promise<string> {
  const issuesDir = path.join(vaultPath, 'persistent-issues');
  await fs.mkdir(issuesDir, { recursive: true });
  const filePath = path.join(issuesDir, `${slug}.md`);
  const sessions = opts?.sessions || [];

  const content = `---
title: "${slug}"
category: persistent-issue
status: "active"
created: "2026-01-15"
priority: "medium"
sessions: ${JSON.stringify(sessions)}
---

# ${slug}

Test issue description

## Investigation Log
`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('updatePersistentIssue', () => {
  let vaultPath: string;
  let context: UpdatePersistentIssueContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('update-issue');
    context = {
      vaultPath,
      currentSessionId: 'test-session-2026-02-16',
      trackFileAccess: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should append investigation entry', async () => {
    await createIssueFile(vaultPath, 'test-issue');

    const result = await updatePersistentIssue(
      { slug: 'test-issue', entry: 'Found root cause in module X' },
      context
    );

    expect(result.content[0].text).toContain('Updated issue');

    const content = await fs.readFile(
      path.join(vaultPath, 'persistent-issues', 'test-issue.md'),
      'utf-8'
    );
    expect(content).toContain('Found root cause in module X');
    expect(content).toContain('test-session-2026-02-16');
  });

  it('should add session to frontmatter sessions array', async () => {
    await createIssueFile(vaultPath, 'test-issue', { sessions: ['prev-session'] });

    await updatePersistentIssue({ slug: 'test-issue', entry: 'New finding' }, context);

    const content = await fs.readFile(
      path.join(vaultPath, 'persistent-issues', 'test-issue.md'),
      'utf-8'
    );
    expect(content).toContain('prev-session');
    expect(content).toContain('test-session-2026-02-16');
  });

  it('should not duplicate session ID', async () => {
    await createIssueFile(vaultPath, 'test-issue', { sessions: ['test-session-2026-02-16'] });

    await updatePersistentIssue({ slug: 'test-issue', entry: 'Another entry' }, context);

    const content = await fs.readFile(
      path.join(vaultPath, 'persistent-issues', 'test-issue.md'),
      'utf-8'
    );
    // Session ID should appear only once in sessions array
    const sessionsMatch = content.match(/"test-session-2026-02-16"/g);
    expect(sessionsMatch).toHaveLength(1);
  });

  it('should error when issue not found', async () => {
    const result = await updatePersistentIssue({ slug: 'nonexistent', entry: 'test' }, context);
    expect(result.content[0].text).toContain('not found');
  });

  it('should track file access as edit', async () => {
    await createIssueFile(vaultPath, 'tracked-issue');

    await updatePersistentIssue({ slug: 'tracked-issue', entry: 'Track this' }, context);

    expect(context.trackFileAccess).toHaveBeenCalledWith(
      expect.stringContaining('tracked-issue.md'),
      'edit'
    );
  });

  it('should use provided session_id over context', async () => {
    await createIssueFile(vaultPath, 'test-issue');

    await updatePersistentIssue(
      { slug: 'test-issue', entry: 'Override session', session_id: 'custom-session-id' },
      context
    );

    const content = await fs.readFile(
      path.join(vaultPath, 'persistent-issues', 'test-issue.md'),
      'utf-8'
    );
    expect(content).toContain('custom-session-id');
  });
});
