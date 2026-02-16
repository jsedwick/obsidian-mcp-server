import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getPersistentIssues } from '../../../../src/tools/issues/getPersistentIssues.js';
import type { GetPersistentIssuesContext } from '../../../../src/tools/issues/getPersistentIssues.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

/**
 * Create a valid persistent issue file for testing
 */
async function createIssueFile(
  vaultPath: string,
  slug: string,
  opts?: { priority?: string; status?: string; sessions?: string[]; resolved?: string },
  dir?: string
): Promise<string> {
  const targetDir = dir || path.join(vaultPath, 'persistent-issues');
  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, `${slug}.md`);
  const priority = opts?.priority || 'medium';
  const status = opts?.status || 'active';
  const sessions = opts?.sessions || [];

  const content = `---
title: "${slug}"
category: persistent-issue
status: "${status}"
created: "2026-01-15"
priority: "${priority}"${opts?.resolved ? `\nresolved: "${opts.resolved}"` : ''}
sessions: ${JSON.stringify(sessions)}
---

# ${slug}

Issue description for ${slug}

## Investigation Log
`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('getPersistentIssues', () => {
  let vaultPath: string;
  let context: GetPersistentIssuesContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('get-issues');
    context = { vaultPath };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should return active issues', async () => {
    await createIssueFile(vaultPath, 'issue-a', { priority: 'high' });
    await createIssueFile(vaultPath, 'issue-b', { priority: 'low' });

    const result = await getPersistentIssues({}, context);

    expect(result.hasFile).toBe(true);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map(i => i.slug)).toContain('issue-a');
    expect(result.issues.map(i => i.slug)).toContain('issue-b');
    expect(result.content[0].text).toContain('Active Persistent Issues');
  });

  it('should include archived issues when requested', async () => {
    await createIssueFile(vaultPath, 'active-issue');
    const archiveDir = path.join(vaultPath, 'archive', 'persistent-issues');
    await createIssueFile(
      vaultPath,
      'resolved-issue',
      { status: 'resolved', resolved: '2026-02-01' },
      archiveDir
    );

    const result = await getPersistentIssues({ include_archived: true }, context);

    expect(result.issues).toHaveLength(2);
    expect(result.content[0].text).toContain('Archived Issues');
  });

  it('should not include archived issues by default', async () => {
    await createIssueFile(vaultPath, 'active-issue');
    const archiveDir = path.join(vaultPath, 'archive', 'persistent-issues');
    await createIssueFile(vaultPath, 'resolved-issue', { status: 'resolved' }, archiveDir);

    const result = await getPersistentIssues({}, context);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].slug).toBe('active-issue');
  });

  it('should report no issues when directory does not exist', async () => {
    const result = await getPersistentIssues({}, context);

    expect(result.hasFile).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it('should parse issue metadata correctly', async () => {
    await createIssueFile(vaultPath, 'detailed-issue', {
      priority: 'high',
      sessions: ['session-1', 'session-2'],
    });

    const result = await getPersistentIssues({}, context);
    const foundIssue = result.issues.find(i => i.slug === 'detailed-issue');

    expect(foundIssue).toBeDefined();
    expect(foundIssue!.priority).toBe('high');
    expect(foundIssue!.sessions).toHaveLength(2);
    expect(foundIssue!.status).toBe('active');
  });

  it('should skip files with invalid frontmatter', async () => {
    await createIssueFile(vaultPath, 'valid-issue');

    // Create invalid file
    const issuesDir = path.join(vaultPath, 'persistent-issues');
    await fs.writeFile(path.join(issuesDir, 'invalid.md'), 'No frontmatter at all', 'utf-8');

    const result = await getPersistentIssues({}, context);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].slug).toBe('valid-issue');
  });
});
