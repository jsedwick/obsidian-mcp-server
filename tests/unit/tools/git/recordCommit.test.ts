/**
 * Unit tests for recordCommit tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { recordCommit } from '../../../../src/tools/git/recordCommit.js';
import type { GitService } from '../../../../src/services/git/GitService.js';
import { createTestVault, cleanupTestVault, createProjectFile } from '../../../helpers/vault.js';

// Mock child_process exec
const { mockExec } = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockExec,
}));

vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: () => mockExec,
  };
});

describe('recordCommit', () => {
  let vaultPath: string;
  let context: {
    vaultPath: string;
    gitService: GitService;
    currentSessionId: string | null;
    currentSessionFile: string | null;
  };

  beforeEach(async () => {
    vaultPath = await createTestVault('record-commit');
    context = {
      vaultPath,
      gitService: {
        getRepositoryName: vi.fn().mockResolvedValue('test-repo'),
        getRemoteUrl: vi.fn().mockResolvedValue('https://github.com/user/test-repo.git'),
        getBranchesContainingCommit: vi.fn().mockResolvedValue(['main']),
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
      } as unknown as GitService,
      currentSessionId: 'test-session-2026-02-16',
      currentSessionFile: null,
    };

    // Create a project page (recordCommit expects it to exist)
    await createProjectFile(vaultPath, 'github-user-test-repo', 'test-repo', 'Test project');

    // Mock exec to return commit info
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('--format=')) {
        return {
          stdout:
            'abc123def456789\nabc123d\nTest Author\ntest@example.com\n2026-02-16T10:00:00\nFix search bug\nDetailed body\n\n file1.ts | 5 ++--\n',
        };
      }
      if (cmd.includes('git show')) {
        return { stdout: 'diff --git a/file1.ts...\n+new line\n-old line' };
      }
      return { stdout: '' };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should throw when no active session', async () => {
    context.currentSessionId = null;

    await expect(
      recordCommit({ repo_path: '/tmp/repo', commit_hash: 'abc123' }, context)
    ).rejects.toThrow('No active session');
  });

  it('should create commit file with metadata', async () => {
    const result = await recordCommit(
      { repo_path: '/tmp/repo', commit_hash: 'abc123def456789' },
      context
    );

    expect(result.content[0].text).toContain('Commit recorded');
    expect(result.content[0].text).toContain('abc123d');

    // Check commit file exists
    const commitsDir = path.join(vaultPath, 'projects', 'github-user-test-repo', 'commits');
    const files = await fs.readdir(commitsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe('abc123d.md');
  });

  it('should handle branch detection failure gracefully', async () => {
    (context.gitService.getBranchesContainingCommit as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('branch detection failed')
    );
    (context.gitService.getCurrentBranch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('not on a branch')
    );

    const result = await recordCommit(
      { repo_path: '/tmp/repo', commit_hash: 'abc123def456789' },
      context
    );

    // Should still succeed with 'unknown' branch
    expect(result.content[0].text).toContain('Commit recorded');
  });
});
