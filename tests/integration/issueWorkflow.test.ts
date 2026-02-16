/**
 * Integration tests for the persistent issue lifecycle workflow
 *
 * E2E: Create issue → update investigation → list → load → resolve
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { issue } from '../../src/tools/issues/issue.js';
import type { IssueContext } from '../../src/tools/issues/issue.js';
import { getPersistentIssues } from '../../src/tools/issues/getPersistentIssues.js';
import type { GetPersistentIssuesContext } from '../../src/tools/issues/getPersistentIssues.js';
import { updatePersistentIssue } from '../../src/tools/issues/updatePersistentIssue.js';
import type { UpdatePersistentIssueContext } from '../../src/tools/issues/updatePersistentIssue.js';
import { createTestVault, cleanupTestVault, vaultFileExists } from '../helpers/vault.js';

// Mock the logger to prevent noise
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Issue Lifecycle Workflow', () => {
  let vaultPath: string;
  let issueContext: IssueContext;
  let getIssuesContext: GetPersistentIssuesContext;
  let updateIssueContext: UpdatePersistentIssueContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('issue-workflow');
    issueContext = {
      vaultPath,
      linkIssueToSession: vi.fn(),
      trackFileAccess: vi.fn(),
    };
    getIssuesContext = { vaultPath };
    updateIssueContext = {
      vaultPath,
      currentSessionId: 'test-session-2026-02-16',
      trackFileAccess: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should create a persistent issue', async () => {
    const result = await issue(
      { mode: 'create', name: 'Test Bug', priority: 'high' },
      issueContext
    );

    expect(result.content[0].text).toContain('test-bug');

    // Verify issue file was created
    const exists = await vaultFileExists(vaultPath, 'persistent-issues/test-bug.md');
    expect(exists).toBe(true);

    // Verify file content
    const content = await fs.readFile(
      path.join(vaultPath, 'persistent-issues/test-bug.md'),
      'utf-8'
    );
    expect(content).toContain('category: persistent-issue');
    expect(content).toContain('priority: "high"');
    expect(content).toContain('status: "active"');
  });

  it('should list created issues via getPersistentIssues', async () => {
    // Create an issue
    await issue({ mode: 'create', name: 'Listable Bug', priority: 'medium' }, issueContext);

    // List issues
    const result = await getPersistentIssues({}, getIssuesContext);

    expect(result.content[0].text).toContain('listable-bug');
  });

  it('should append investigation log entries', async () => {
    // Create an issue
    await issue({ mode: 'create', name: 'Investigated Bug', priority: 'high' }, issueContext);

    // Update with investigation entry
    const updateResult = await updatePersistentIssue(
      { slug: 'investigated-bug', entry: 'Found root cause: null pointer in handler' },
      updateIssueContext
    );

    expect(updateResult.content[0].text).toContain('investigation');

    // Verify investigation log was updated
    const content = await fs.readFile(
      path.join(vaultPath, 'persistent-issues/investigated-bug.md'),
      'utf-8'
    );
    expect(content).toContain('Found root cause: null pointer in handler');
  });

  it('should load full issue content via issue load mode', async () => {
    // Create an issue
    await issue({ mode: 'create', name: 'Loadable Bug', priority: 'high' }, issueContext);

    // Add investigation entry
    await updatePersistentIssue(
      { slug: 'loadable-bug', entry: 'Investigating memory leak' },
      updateIssueContext
    );

    // Load the issue
    const result = await issue({ mode: 'load', slug: 'loadable-bug' }, issueContext);

    const text = result.content[0].text;
    expect(text).toContain('loadable-bug');
    expect(text).toContain('Investigating memory leak');
  });

  it('should resolve an issue (requires _invoked_by_slash_command)', async () => {
    // Create an issue
    await issue({ mode: 'create', name: 'Resolvable Bug', priority: 'high' }, issueContext);

    // Verify it shows in active list
    const beforeResolve = await getPersistentIssues({}, getIssuesContext);
    expect(beforeResolve.content[0].text).toContain('resolvable-bug');

    // Resolve the issue
    const resolveResult = await issue(
      { mode: 'resolve', slug: 'resolvable-bug', _invoked_by_slash_command: true },
      issueContext
    );
    expect(resolveResult.content[0].text).toContain('Resolved');

    // Verify it's no longer in active list
    const afterResolve = await getPersistentIssues({}, getIssuesContext);
    expect(afterResolve.content[0].text).not.toContain('resolvable-bug');
  });

  it('should handle the full create → investigate → load → resolve lifecycle', async () => {
    // Step 1: Create
    await issue({ mode: 'create', name: 'Full Lifecycle Bug', priority: 'high' }, issueContext);

    // Step 2: List and verify
    const listed = await getPersistentIssues({}, getIssuesContext);
    expect(listed.content[0].text).toContain('full-lifecycle-bug');

    // Step 3: Investigate
    await updatePersistentIssue(
      { slug: 'full-lifecycle-bug', entry: 'Step 1: Reproduced the issue' },
      updateIssueContext
    );
    await updatePersistentIssue(
      { slug: 'full-lifecycle-bug', entry: 'Step 2: Found the root cause' },
      updateIssueContext
    );

    // Step 4: Load and verify investigation
    const loaded = await issue({ mode: 'load', slug: 'full-lifecycle-bug' }, issueContext);
    expect(loaded.content[0].text).toContain('Reproduced the issue');
    expect(loaded.content[0].text).toContain('Found the root cause');

    // Step 5: Resolve
    await issue(
      { mode: 'resolve', slug: 'full-lifecycle-bug', _invoked_by_slash_command: true },
      issueContext
    );

    // Step 6: Verify resolved
    const afterResolve = await getPersistentIssues({}, getIssuesContext);
    expect(afterResolve.content[0].text).not.toContain('full-lifecycle-bug');
  });
});
