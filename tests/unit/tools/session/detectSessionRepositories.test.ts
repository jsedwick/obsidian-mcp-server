/**
 * Unit tests for detectSessionRepositories tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectSessionRepositories } from '../../../../src/tools/session/detectSessionRepositories.js';
import { createSessionToolsContext, type SessionToolsContext } from '../../../helpers/index.js';

describe('detectSessionRepositories', () => {
  let context: SessionToolsContext;

  beforeEach(() => {
    context = createSessionToolsContext({
      currentSessionId: null,
      filesAccessed: [],
      findGitRepos: vi.fn().mockResolvedValue([]),
      getRepoInfo: vi.fn().mockResolvedValue({ name: 'test-repo', branch: 'main', remote: null }),
    });
  });

  describe('no repositories found', () => {
    it('should handle no Git repositories in CWD', async () => {
      context.findGitRepos = vi.fn().mockResolvedValue([]);

      const result = await detectSessionRepositories({}, context);

      expect(result.content[0].text).toContain('No Git repositories found');
    });
  });

  describe('single repository detection', () => {
    it('should detect single repository with high confidence', async () => {
      const repoPath = '/tmp/my-project';
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'my-project',
        branch: 'main',
        remote: 'https://github.com/user/my-project.git',
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Detected 1 repository candidate');
      expect(text).toContain('my-project');
      expect(text).toContain('main');
      expect(text).toContain('Auto-select');
    });

    it('should include repository path in results', async () => {
      const repoPath = '/home/user/projects/awesome-repo';
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'awesome-repo',
        branch: 'develop',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      expect(result.content[0].text).toContain(repoPath);
      expect(result.content[0].text).toContain('develop');
    });
  });

  describe('scoring based on file access', () => {
    it('should score edited files higher than read files', async () => {
      const repo1 = '/tmp/repo1';
      const repo2 = '/tmp/repo2';

      context.filesAccessed = [
        { path: `${repo1}/src/file.ts`, action: 'edit', timestamp: '2025-01-15T10:00:00Z' },
        { path: `${repo2}/README.md`, action: 'read', timestamp: '2025-01-15T10:00:00Z' },
      ];

      context.findGitRepos = vi.fn().mockResolvedValue([repo1, repo2]);
      context.getRepoInfo = vi
        .fn()
        .mockResolvedValueOnce({ name: 'repo1', branch: 'main', remote: null })
        .mockResolvedValueOnce({ name: 'repo2', branch: 'main', remote: null });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      // repo1 should be listed first (higher score due to edit)
      const repo1Index = text.indexOf('repo1');
      const repo2Index = text.indexOf('repo2');
      expect(repo1Index).toBeLessThan(repo2Index);
      expect(text).toContain('1 file(s) modified');
      expect(text).toContain('1 file(s) read');
    });

    it('should score multiple edits', async () => {
      const repoPath = '/tmp/active-repo';

      context.filesAccessed = [
        { path: `${repoPath}/src/file1.ts`, action: 'edit', timestamp: '2025-01-15T10:00:00Z' },
        { path: `${repoPath}/src/file2.ts`, action: 'create', timestamp: '2025-01-15T10:01:00Z' },
        { path: `${repoPath}/README.md`, action: 'read', timestamp: '2025-01-15T10:02:00Z' },
      ];

      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'active-repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('2 file(s) modified'); // edit + create
      expect(text).toContain('1 file(s) read');
    });
  });

  describe('scoring based on session topic', () => {
    it('should boost score when session topic matches repo name', async () => {
      const repoPath = '/tmp/my-feature-repo';

      context.currentSessionId = '2025-01-15_my-feature-implementation';
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'my-feature-repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Session topic matches repo name');
    });

    it('should not boost score when topic does not match', async () => {
      const repoPath = '/tmp/unrelated-repo';

      context.currentSessionId = '2025-01-15_different-topic';
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'unrelated-repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).not.toContain('Session topic matches repo name');
    });
  });

  describe('scoring based on CWD proximity', () => {
    beforeEach(() => {
      // Mock process.env.PWD or process.cwd()
      vi.stubEnv('PWD', '/tmp/current-working-dir');
    });

    it('should boost score for repo that IS the CWD', async () => {
      const repoPath = '/tmp/current-working-dir';

      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'current-working-dir',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Repo is a working directory');
    });

    it('should boost score for repo containing CWD', async () => {
      const repoPath = '/tmp';

      vi.stubEnv('PWD', '/tmp/current-working-dir/subfolder');
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'tmp',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Working directory is within this repo');
    });

    it('should boost score for repo as subdirectory of CWD', async () => {
      const repoPath = '/tmp/current-working-dir/subfolder/repo';

      vi.stubEnv('PWD', '/tmp/current-working-dir');
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Repo is subdirectory of working directory');
    });
  });

  describe('multiple repository candidates', () => {
    it('should list all candidates sorted by score', async () => {
      const repo1 = '/tmp/repo1';
      const repo2 = '/tmp/repo2';
      const repo3 = '/tmp/repo3';

      // repo2 has edited files (highest score)
      // repo1 has read files (medium score)
      // repo3 has no files accessed (lowest score)
      context.filesAccessed = [
        { path: `${repo2}/src/file.ts`, action: 'edit', timestamp: '2025-01-15T10:00:00Z' },
        { path: `${repo1}/README.md`, action: 'read', timestamp: '2025-01-15T10:00:00Z' },
      ];

      vi.stubEnv('PWD', '/tmp');
      context.findGitRepos = vi.fn().mockResolvedValue([repo1, repo2, repo3]);
      context.getRepoInfo = vi
        .fn()
        .mockResolvedValueOnce({ name: 'repo1', branch: 'main', remote: null })
        .mockResolvedValueOnce({ name: 'repo2', branch: 'main', remote: null })
        .mockResolvedValueOnce({ name: 'repo3', branch: 'main', remote: null });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Detected 3 repository candidate');

      // repo2 should be first (edited files)
      const repo2Index = text.indexOf('repo2');
      const repo1Index = text.indexOf('repo1');
      const repo3Index = text.indexOf('repo3');
      expect(repo2Index).toBeLessThan(repo1Index);
      expect(repo1Index).toBeLessThan(repo3Index);
    });

    it('should recommend auto-select when top candidate has 2x score', async () => {
      const repo1 = '/tmp/repo1';
      const repo2 = '/tmp/repo2';

      // repo1 has 3 edited files (score: 30), repo2 has 1 read file (score: 5)
      // 30 > 5 * 2, so should auto-select
      context.filesAccessed = [
        { path: `${repo1}/file1.ts`, action: 'edit', timestamp: '2025-01-15T10:00:00Z' },
        { path: `${repo1}/file2.ts`, action: 'edit', timestamp: '2025-01-15T10:01:00Z' },
        { path: `${repo1}/file3.ts`, action: 'edit', timestamp: '2025-01-15T10:02:00Z' },
        { path: `${repo2}/README.md`, action: 'read', timestamp: '2025-01-15T10:03:00Z' },
      ];

      context.findGitRepos = vi.fn().mockResolvedValue([repo1, repo2]);
      context.getRepoInfo = vi
        .fn()
        .mockResolvedValueOnce({ name: 'repo1', branch: 'main', remote: null })
        .mockResolvedValueOnce({ name: 'repo2', branch: 'main', remote: null });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Auto-select **repo1**');
    });

    it('should suggest manual selection when scores are close', async () => {
      const repo1 = '/tmp/repo1';
      const repo2 = '/tmp/repo2';

      // Both have similar scores
      context.filesAccessed = [
        { path: `${repo1}/file.ts`, action: 'edit', timestamp: '2025-01-15T10:00:00Z' },
        { path: `${repo2}/file.ts`, action: 'edit', timestamp: '2025-01-15T10:01:00Z' },
      ];

      context.findGitRepos = vi.fn().mockResolvedValue([repo1, repo2]);
      context.getRepoInfo = vi
        .fn()
        .mockResolvedValueOnce({ name: 'repo1', branch: 'main', remote: null })
        .mockResolvedValueOnce({ name: 'repo2', branch: 'main', remote: null });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Multiple candidates detected');
      expect(text).toContain('link_session_to_repository');
    });
  });

  describe('no relevant repositories', () => {
    it('should handle repositories with zero score', async () => {
      const repoPath = '/tmp/unrelated-repo';

      // No files accessed from this repo, no session topic match, not CWD
      vi.stubEnv('PWD', '/home/user/different/path');
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'unrelated-repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      // Single repo should still be included even with score 0
      expect(result.content[0].text).toContain('Detected 1 repository candidate');
    });

    it('should indicate research/exploratory session when no files accessed', async () => {
      const repoPath = '/tmp/repo';

      context.filesAccessed = [];
      vi.stubEnv('PWD', '/home/user/different/path');
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      // Should still list the repo but indicate it's not highly relevant
      expect(result.content[0].text).toContain('repository candidate');
    });
  });

  describe('edge cases', () => {
    it('should handle repository without remote', async () => {
      const repoPath = '/tmp/local-repo';

      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'local-repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('local-repo');
      expect(text).not.toContain('Remote:');
    });

    it('should handle repository with non-main branch', async () => {
      const repoPath = '/tmp/feature-repo';

      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'feature-repo',
        branch: 'feature/new-feature',
        remote: 'https://github.com/user/feature-repo.git',
      });

      const result = await detectSessionRepositories({}, context);

      const text = result.content[0].text;
      expect(text).toContain('Branch: feature/new-feature');
    });

    it('should handle empty filesAccessed array', async () => {
      const repoPath = '/tmp/repo';

      context.filesAccessed = [];
      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'repo',
        branch: 'main',
        remote: null,
      });

      const result = await detectSessionRepositories({}, context);

      expect(result.content[0].text).toContain('repository candidate');
    });
  });
});
