/**
 * RepositoryDetector unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RepositoryDetector } from '../../../../src/services/git/RepositoryDetector.js';
import { GitService } from '../../../../src/services/git/GitService.js';
import type { FileAccess } from '../../../../src/models/Session.js';
import type { RepoCandidate } from '../../../../src/models/Git.js';
import * as fs from 'fs/promises';

// Mock modules
vi.mock('fs/promises');

describe('RepositoryDetector', () => {
  let gitService: GitService;
  let repositoryDetector: RepositoryDetector;

  beforeEach(() => {
    gitService = new GitService();
    repositoryDetector = new RepositoryDetector(gitService);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findRepositories', () => {
    it('should find repositories in subdirectories', async () => {
      vi.spyOn(gitService, 'isGitRepository').mockImplementation(async path => {
        return path === '/test/repo1' || path === '/test/subdir/repo2';
      });

      vi.mocked(fs.readdir).mockImplementation(async path => {
        if (path === '/test') {
          return [
            { name: 'repo1', isDirectory: () => true },
            { name: 'subdir', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false },
          ] as any;
        }
        if (path === '/test/subdir') {
          return [{ name: 'repo2', isDirectory: () => true }] as any;
        }
        return [] as any;
      });

      const repos = await repositoryDetector.findRepositories('/test');

      expect(repos).toContain('/test/repo1');
      expect(repos).toContain('/test/subdir/repo2');
    });

    it('should find repositories in parent directories', async () => {
      vi.spyOn(gitService, 'isGitRepository').mockImplementation(async path => {
        return path === '/parent-repo';
      });

      vi.mocked(fs.readdir).mockResolvedValue([] as any);

      const repos = await repositoryDetector.findRepositories('/parent-repo/test/subdir');

      expect(repos).toContain('/parent-repo');
    });

    it('should skip node_modules and .git directories', async () => {
      vi.spyOn(gitService, 'isGitRepository').mockResolvedValue(false);

      const mockReaddir = vi.fn().mockResolvedValue([
        { name: 'node_modules', isDirectory: () => true },
        { name: '.git', isDirectory: () => true },
        { name: 'src', isDirectory: () => true },
      ] as any);

      vi.mocked(fs.readdir).mockImplementation(mockReaddir);

      await repositoryDetector.findRepositories('/test');

      // Should not have tried to read node_modules or .git
      expect(mockReaddir).not.toHaveBeenCalledWith(
        expect.stringContaining('node_modules'),
        expect.anything()
      );
      expect(mockReaddir).not.toHaveBeenCalledWith(
        expect.stringContaining('.git'),
        expect.anything()
      );
    });

    it('should respect maxDepth parameter', async () => {
      vi.spyOn(gitService, 'isGitRepository').mockResolvedValue(false);

      vi.mocked(fs.readdir).mockImplementation(async _path => {
        return [{ name: 'deep', isDirectory: () => true }] as any;
      });

      const mockIsGitRepo = vi.spyOn(gitService, 'isGitRepository');

      await repositoryDetector.findRepositories('/test', 1);

      // Should check /test and /test/deep but not /test/deep/deep
      const checkedPaths = mockIsGitRepo.mock.calls.map(call => call[0]);
      expect(checkedPaths).not.toContain('/test/deep/deep');
    });

    it('should handle inaccessible directories gracefully', async () => {
      vi.spyOn(gitService, 'isGitRepository').mockResolvedValue(false);

      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      const repos = await repositoryDetector.findRepositories('/test');

      expect(repos).toEqual([]);
    });
  });

  describe('detectFromFileAccess', () => {
    it('should score repositories based on edited files', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo1/src/file1.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
        { path: '/repo1/src/file2.ts', action: 'edit', timestamp: '2025-01-14T10:01:00Z' },
        { path: '/repo2/src/file3.ts', action: 'read', timestamp: '2025-01-14T10:02:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/repo1', '/repo2']);
      vi.spyOn(gitService, 'getRepositoryName').mockImplementation(
        async path => path.split('/').pop()!
      );
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed);

      expect(candidates[0].path).toBe('/repo1');
      expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
      expect(candidates[0].reasons).toContain('2 file(s) modified');
    });

    it('should score repositories based on read files', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo1/README.md', action: 'read', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/repo1']);
      vi.spyOn(gitService, 'getRepositoryName').mockResolvedValue('repo1');
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed);

      expect(candidates[0].score).toBeGreaterThan(0);
      expect(candidates[0].reasons).toContain('1 file(s) read');
    });

    it('should bonus score for session topic matching repo name', async () => {
      const filesAccessed: FileAccess[] = [];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/test/my-project']);
      vi.spyOn(gitService, 'getRepositoryName').mockResolvedValue('my-project');
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed, {
        sessionId: '2025-01-14_working-on-my-project',
      });

      expect(candidates[0].score).toBeGreaterThan(0);
      expect(candidates[0].reasons).toContain('Session topic matches repo name');
    });

    it('should bonus score for repo being CWD', async () => {
      const filesAccessed: FileAccess[] = [];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/test/repo']);
      vi.spyOn(gitService, 'getRepositoryName').mockResolvedValue('repo');
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed, {
        cwd: '/test/repo',
      });

      expect(candidates[0].score).toBeGreaterThan(0);
      expect(candidates[0].reasons).toContain('Repo is current working directory');
    });

    it('should bonus score for CWD within repo', async () => {
      const filesAccessed: FileAccess[] = [];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/test/repo']);
      vi.spyOn(gitService, 'getRepositoryName').mockResolvedValue('repo');
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed, {
        cwd: '/test/repo/src/nested',
      });

      expect(candidates[0].score).toBeGreaterThan(0);
      expect(candidates[0].reasons).toContain('CWD is within this repo');
    });

    it('should filter by minScore', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo1/file.ts', action: 'read', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/repo1', '/repo2']);
      vi.spyOn(gitService, 'getRepositoryName').mockImplementation(
        async path => path.split('/').pop()!
      );
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed, {
        minScore: 100,
      });

      // repo2 has score 0, should be filtered out even if minScore is high
      // repo1 has score from read file, but might not reach 100
      expect(candidates.length).toBeLessThanOrEqual(1);
    });

    it('should limit results by maxCandidates', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo1/file.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
        { path: '/repo2/file.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
        { path: '/repo3/file.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue([
        '/repo1',
        '/repo2',
        '/repo3',
      ]);
      vi.spyOn(gitService, 'getRepositoryName').mockImplementation(
        async path => path.split('/').pop()!
      );
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed, {
        maxCandidates: 2,
      });

      expect(candidates.length).toBe(2);
    });

    it('should include metadata when requested', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo/file.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/repo']);
      vi.spyOn(gitService, 'getRepositoryName').mockResolvedValue('my-repo');
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('feature/test');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue('https://github.com/user/my-repo');

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed, {
        includeMetadata: true,
      });

      expect(candidates[0].branch).toBe('feature/test');
      expect(candidates[0].remote).toBe('https://github.com/user/my-repo');
    });

    it('should not include metadata when not requested', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo/file.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/repo']);
      vi.spyOn(gitService, 'getRepositoryName').mockResolvedValue('my-repo');

      const mockGetCurrentBranch = vi.spyOn(gitService, 'getCurrentBranch');
      const mockGetRemoteUrl = vi.spyOn(gitService, 'getRemoteUrl');

      await repositoryDetector.detectFromFileAccess(filesAccessed, {
        includeMetadata: false,
      });

      expect(mockGetCurrentBranch).not.toHaveBeenCalled();
      expect(mockGetRemoteUrl).not.toHaveBeenCalled();
    });

    it('should return empty array if no repositories found', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/vault/topic.md', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue([]);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed);

      expect(candidates).toEqual([]);
    });

    it('should sort candidates by score descending', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo1/file.ts', action: 'read', timestamp: '2025-01-14T10:00:00Z' },
        { path: '/repo2/file1.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
        { path: '/repo2/file2.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'findRepositories').mockResolvedValue(['/repo1', '/repo2']);
      vi.spyOn(gitService, 'getRepositoryName').mockImplementation(
        async path => path.split('/').pop()!
      );
      vi.spyOn(gitService, 'getCurrentBranch').mockResolvedValue('main');
      vi.spyOn(gitService, 'getRemoteUrl').mockResolvedValue(null);

      const candidates = await repositoryDetector.detectFromFileAccess(filesAccessed);

      expect(candidates[0].path).toBe('/repo2');
      expect(candidates[1].path).toBe('/repo1');
      expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    });
  });

  describe('getTopCandidate', () => {
    it('should return the highest-scored candidate', async () => {
      const filesAccessed: FileAccess[] = [
        { path: '/repo1/file.ts', action: 'edit', timestamp: '2025-01-14T10:00:00Z' },
      ];

      vi.spyOn(repositoryDetector, 'detectFromFileAccess').mockResolvedValue([
        {
          path: '/repo1',
          name: 'repo1',
          score: 100,
          reasons: ['test'],
        },
        {
          path: '/repo2',
          name: 'repo2',
          score: 50,
          reasons: ['test'],
        },
      ]);

      const candidate = await repositoryDetector.getTopCandidate(filesAccessed);

      expect(candidate).toEqual({
        path: '/repo1',
        name: 'repo1',
        score: 100,
        reasons: ['test'],
      });
    });

    it('should return null if no candidates', async () => {
      const filesAccessed: FileAccess[] = [];

      vi.spyOn(repositoryDetector, 'detectFromFileAccess').mockResolvedValue([]);

      const candidate = await repositoryDetector.getTopCandidate(filesAccessed);

      expect(candidate).toBeNull();
    });
  });

  describe('isClearWinner', () => {
    it('should return true if only one candidate', () => {
      const candidates: RepoCandidate[] = [
        { path: '/repo1', name: 'repo1', score: 10, reasons: [] },
      ];

      expect(repositoryDetector.isClearWinner(candidates)).toBe(true);
    });

    it('should return true if score is more than 2x second place', () => {
      const candidates: RepoCandidate[] = [
        { path: '/repo1', name: 'repo1', score: 100, reasons: [] },
        { path: '/repo2', name: 'repo2', score: 40, reasons: [] },
      ];

      expect(repositoryDetector.isClearWinner(candidates)).toBe(true);
    });

    it('should return false if score is less than 2x second place', () => {
      const candidates: RepoCandidate[] = [
        { path: '/repo1', name: 'repo1', score: 100, reasons: [] },
        { path: '/repo2', name: 'repo2', score: 60, reasons: [] },
      ];

      expect(repositoryDetector.isClearWinner(candidates)).toBe(false);
    });

    it('should return false if no candidates', () => {
      const candidates: RepoCandidate[] = [];

      expect(repositoryDetector.isClearWinner(candidates)).toBe(false);
    });
  });
});
