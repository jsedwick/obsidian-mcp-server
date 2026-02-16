import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { issue } from '../../../../src/tools/issues/issue.js';
import type { IssueContext } from '../../../../src/tools/issues/issue.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

/**
 * Create a valid persistent issue file in the test vault
 */
async function createIssueFile(
  vaultPath: string,
  slug: string,
  opts?: {
    priority?: string;
    sessions?: string[];
    status?: string;
    description?: string;
    investigation?: string;
  }
): Promise<string> {
  const issuesDir = path.join(vaultPath, 'persistent-issues');
  await fs.mkdir(issuesDir, { recursive: true });
  const filePath = path.join(issuesDir, `${slug}.md`);
  const priority = opts?.priority || 'medium';
  const sessions = opts?.sessions || [];
  const status = opts?.status || 'active';
  const description = opts?.description || 'Test issue description';
  const investigation = opts?.investigation || '';

  const content = `---
title: "${slug}"
category: persistent-issue
status: "${status}"
created: "2026-01-15"
priority: "${priority}"
sessions: ${JSON.stringify(sessions)}
---

# ${slug}

${description}

## Investigation Log
${investigation}
`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('issue', () => {
  let vaultPath: string;
  let context: IssueContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('issue-tool');
    context = {
      vaultPath,
      linkIssueToSession: vi.fn(),
      trackFileAccess: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('list mode', () => {
    it('should list active issues', async () => {
      await createIssueFile(vaultPath, 'bug-123', { priority: 'high' });
      await createIssueFile(vaultPath, 'feature-456', { priority: 'low' });

      const result = await issue({ mode: 'list' }, context);
      expect(result.content[0].text).toContain('bug-123');
      expect(result.content[0].text).toContain('feature-456');
      expect(result.content[0].text).toContain('high');
    });

    it('should report no active issues when directory is empty', async () => {
      const result = await issue({ mode: 'list' }, context);
      expect(result.content[0].text).toContain('No active persistent issues');
    });
  });

  describe('load mode', () => {
    it('should load issue and link to session', async () => {
      await createIssueFile(vaultPath, 'test-issue', {
        priority: 'high',
        description: 'Something is broken',
        investigation: '\n\n**2026-01-15:** Initial investigation',
      });

      const result = await issue({ mode: 'load', slug: 'test-issue' }, context);
      expect(result.content[0].text).toContain('Loaded persistent issue');
      expect(result.content[0].text).toContain('test-issue');
      expect(result.linkedIssue?.slug).toBe('test-issue');
      expect(context.linkIssueToSession).toHaveBeenCalledWith('test-issue');
      expect(context.trackFileAccess).toHaveBeenCalled();
    });

    it('should error when slug is missing', async () => {
      const result = await issue({ mode: 'load' }, context);
      expect(result.content[0].text).toContain('Missing slug');
    });

    it('should error when issue not found', async () => {
      const result = await issue({ mode: 'load', slug: 'nonexistent' }, context);
      expect(result.content[0].text).toContain('not found');
    });

    it('should detect archived issues', async () => {
      const archiveDir = path.join(vaultPath, 'archive', 'persistent-issues');
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.writeFile(
        path.join(archiveDir, 'old-issue.md'),
        `---
title: "old-issue"
category: persistent-issue
status: "resolved"
created: "2026-01-01"
priority: "medium"
sessions: []
---

# old-issue
`,
        'utf-8'
      );

      const result = await issue({ mode: 'load', slug: 'old-issue' }, context);
      expect(result.content[0].text).toContain('resolved and archived');
    });
  });

  describe('create mode', () => {
    it('should create a new issue file', async () => {
      const result = await issue({ mode: 'create', name: 'New Bug', priority: 'high' }, context);

      expect(result.content[0].text).toContain('Created persistent issue');
      expect(result.content[0].text).toContain('new-bug');

      const filePath = path.join(vaultPath, 'persistent-issues', 'new-bug.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('priority: "high"');
      expect(content).toContain('status: "active"');
    });

    it('should error when name is missing', async () => {
      const result = await issue({ mode: 'create' }, context);
      expect(result.content[0].text).toContain('Missing name');
    });

    it('should error when slug already exists', async () => {
      await createIssueFile(vaultPath, 'existing-issue');

      const result = await issue({ mode: 'create', name: 'Existing Issue' }, context);
      expect(result.content[0].text).toContain('already exists');
    });

    it('should default priority to medium', async () => {
      await issue({ mode: 'create', name: 'Default Priority Issue' }, context);

      const filePath = path.join(vaultPath, 'persistent-issues', 'default-priority-issue.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('priority: "medium"');
    });
  });

  describe('resolve mode', () => {
    it('should require slash command flag', async () => {
      await createIssueFile(vaultPath, 'test-issue');

      const result = await issue({ mode: 'resolve', slug: 'test-issue' }, context);
      expect(result.content[0].text).toContain('requires explicit user action');
    });

    it('should resolve and archive issue with slash command flag', async () => {
      await createIssueFile(vaultPath, 'resolve-me');

      const result = await issue(
        { mode: 'resolve', slug: 'resolve-me', _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain('Resolved issue');

      // Original file should be removed
      const originalPath = path.join(vaultPath, 'persistent-issues', 'resolve-me.md');
      await expect(fs.access(originalPath)).rejects.toThrow();

      // Should be in archive
      const archivePath = path.join(vaultPath, 'archive', 'persistent-issues', 'resolve-me.md');
      const archived = await fs.readFile(archivePath, 'utf-8');
      expect(archived).toContain('status: "resolved"');
      expect(archived).toContain('resolved:');
    });

    it('should error when issue not found', async () => {
      const result = await issue(
        { mode: 'resolve', slug: 'nonexistent', _invoked_by_slash_command: true },
        context
      );
      expect(result.content[0].text).toContain('not found');
    });
  });
});
