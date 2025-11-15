/**
 * GitService unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GitService } from '../../../../src/services/git/GitService.js';
import { GitError } from '../../../../src/utils/errors.js';
import * as fs from 'fs/promises';
import { exec } from 'child_process';

// Mock modules
vi.mock('fs/promises');
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('GitService', () => {
  let gitService: GitService;

  beforeEach(() => {
    gitService = new GitService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGitRepository', () => {
    it('should return true if .git directory exists', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await gitService.isGitRepository('/test/repo');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith('/test/repo/.git');
    });

    it('should return false if .git directory does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await gitService.isGitRepository('/test/not-a-repo');

      expect(result).toBe(false);
    });
  });

  describe('findGitRoot', () => {
    it('should find git root in current directory', async () => {
      vi.mocked(fs.access).mockImplementation(async path => {
        if (path === '/test/repo/.git') return undefined;
        throw new Error('ENOENT');
      });

      const result = await gitService.findGitRoot('/test/repo/src/file.ts');

      expect(result).toBe('/test/repo');
    });

    it('should find git root in parent directory', async () => {
      vi.mocked(fs.access).mockImplementation(async path => {
        if (path === '/test/.git') return undefined;
        throw new Error('ENOENT');
      });

      const result = await gitService.findGitRoot('/test/repo/src/file.ts');

      expect(result).toBe('/test');
    });

    it('should return null if no git root found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await gitService.findGitRoot('/test/file.ts');

      expect(result).toBe(null);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      const mockExec = vi.fn().mockResolvedValue({ stdout: 'main\n', stderr: '' });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getCurrentBranch('/test/repo');

      expect(result).toBe('main');
    });

    it('should throw GitError if command fails', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('fatal: not a git repository'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      await expect(gitService.getCurrentBranch('/test/not-a-repo')).rejects.toThrow(GitError);
    });
  });

  describe('getRemoteUrl', () => {
    it('should return remote URL for origin', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'https://github.com/user/repo.git\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getRemoteUrl('/test/repo');

      expect(result).toBe('https://github.com/user/repo.git');
    });

    it('should return null if no remote configured', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('exit code 1'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      const result = await gitService.getRemoteUrl('/test/repo');

      expect(result).toBe(null);
    });

    it('should support custom remote name', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'https://github.com/user/repo.git\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      await gitService.getRemoteUrl('/test/repo', 'upstream');

      expect(mockExec).toHaveBeenCalledWith(
        'git config --get remote.upstream.url',
        expect.any(Object)
      );
    });
  });

  describe('getBranchesContainingCommit', () => {
    it('should return array of branch names', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'main\nfeature/test\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getBranchesContainingCommit('/test/repo', 'abc123');

      expect(result).toEqual(['main', 'feature/test']);
    });

    it('should filter empty lines', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'main\n\nfeature/test\n\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getBranchesContainingCommit('/test/repo', 'abc123');

      expect(result).toEqual(['main', 'feature/test']);
    });

    it('should throw GitError if command fails', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('fatal: malformed object name'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      await expect(gitService.getBranchesContainingCommit('/test/repo', 'invalid')).rejects.toThrow(
        GitError
      );
    });
  });

  describe('getCommitInfo', () => {
    it('should return commit information', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout:
          'abc123def456\nabc123d\nInitial commit\nJohn Doe\njohn@example.com\n2025-01-14 10:30:00 -0500\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getCommitInfo('/test/repo', 'abc123');

      expect(result).toEqual({
        hash: 'abc123def456',
        shortHash: 'abc123d',
        message: 'Initial commit',
        author: 'John Doe',
        email: 'john@example.com',
        date: new Date('2025-01-14 10:30:00 -0500'),
      });
    });

    it('should throw GitError if command fails', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('fatal: bad object'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      await expect(gitService.getCommitInfo('/test/repo', 'invalid')).rejects.toThrow(GitError);
    });
  });

  describe('getDiffStats', () => {
    it('should parse diff statistics', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: '10\t5\tsrc/file1.ts\n20\t3\tsrc/file2.ts\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getDiffStats('/test/repo', 'abc123');

      expect(result).toEqual({
        filesChanged: 2,
        insertions: 30,
        deletions: 8,
        files: [
          { path: 'src/file1.ts', insertions: 10, deletions: 5 },
          { path: 'src/file2.ts', insertions: 20, deletions: 3 },
        ],
      });
    });

    it('should handle binary files (- - path)', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: '10\t5\tsrc/file.ts\n-\t-\timage.png\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getDiffStats('/test/repo', 'abc123');

      expect(result.filesChanged).toBe(2);
      expect(result.files[1]).toEqual({ path: 'image.png', insertions: 0, deletions: 0 });
    });

    it('should throw GitError if command fails', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('fatal: bad revision'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      await expect(gitService.getDiffStats('/test/repo', 'invalid')).rejects.toThrow(GitError);
    });
  });

  describe('getDiff', () => {
    it('should return full diff', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'diff --git a/file.ts b/file.ts\n+new line\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getDiff('/test/repo', 'abc123');

      expect(result).toBe('diff --git a/file.ts b/file.ts\n+new line\n');
    });

    it('should return stat-only diff when requested', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: ' src/file.ts | 5 +++--\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getDiff('/test/repo', 'abc123', true);

      expect(result).toContain('src/file.ts');
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('--stat'), expect.any(Object));
    });

    it('should throw GitError if command fails', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('fatal: bad revision'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      await expect(gitService.getDiff('/test/repo', 'invalid')).rejects.toThrow(GitError);
    });
  });

  describe('executeCommand', () => {
    it('should execute git command successfully', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'success output\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.executeCommand('git status', '/test/repo');

      expect(result).toEqual({
        stdout: 'success output\n',
        stderr: '',
        exitCode: 0,
      });
    });

    it('should return error result if command fails', async () => {
      const mockExec = vi.fn().mockRejectedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        code: 128,
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      const result = await gitService.executeCommand('git status', '/test/not-a-repo');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });
    });
  });

  describe('getRepositoryName', () => {
    it('should extract name from remote URL', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'https://github.com/user/my-repo.git\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getRepositoryName('/test/repo');

      expect(result).toBe('my-repo');
    });

    it('should extract name from SSH remote URL', async () => {
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'git@github.com:user/my-repo.git\n',
        stderr: '',
      });
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).then((result: any) => callback(null, result));
      }) as any);

      const result = await gitService.getRepositoryName('/test/repo');

      expect(result).toBe('my-repo');
    });

    it('should fall back to directory name if no remote', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('no remote'));
      vi.mocked(exec).mockImplementation(((cmd: any, options: any, callback: any) => {
        mockExec(cmd, options).catch((error: any) => callback(error));
      }) as any);

      const result = await gitService.getRepositoryName('/test/my-local-repo');

      expect(result).toBe('my-local-repo');
    });
  });
});
