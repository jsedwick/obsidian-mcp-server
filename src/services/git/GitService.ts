/**
 * GitService - Git operations wrapper
 *
 * Responsible for:
 * - Executing Git commands with error handling
 * - Repository validation and detection
 * - Branch, commit, and remote operations
 * - Diff and log operations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { GitError } from '../../utils/errors.js';
import type { GitCommandResult, GitCommitInfo, GitDiffStats } from '../../models/Git.js';

const execAsync = promisify(exec);
const logger = createLogger('GitService');

/**
 * Service for Git operations
 */
export class GitService {
  /**
   * Check if a directory is a Git repository
   *
   * @param repoPath - Absolute path to check
   * @returns true if directory contains a .git folder
   */
  async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      const gitDir = path.join(repoPath, '.git');
      await fs.access(gitDir);
      logger.debug('Git repository detected', { repoPath });
      return true;
    } catch {
      logger.debug('Not a Git repository', { repoPath });
      return false;
    }
  }

  /**
   * Find Git repository root from a file path
   *
   * @param filePath - Absolute path to a file
   * @returns Repository root path or null if not in a Git repo
   */
  async findGitRoot(filePath: string): Promise<string | null> {
    let currentDir = path.dirname(filePath);
    const rootDir = path.parse(currentDir).root;

    while (currentDir !== rootDir) {
      if (await this.isGitRepository(currentDir)) {
        logger.debug('Found Git root', { filePath, gitRoot: currentDir });
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }

    logger.debug('No Git repository found', { filePath });
    return null;
  }

  /**
   * Get current branch name
   *
   * @param repoPath - Absolute path to repository
   * @returns Branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    logger.debug('Getting current branch', { repoPath });

    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
      const branch = stdout.trim();
      logger.debug('Current branch retrieved', { repoPath, branch });
      return branch;
    } catch (error) {
      logger.error('Failed to get current branch', error as Error, { repoPath });
      throw new GitError(`Failed to get current branch: ${repoPath}`, {
        repoPath,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Get remote URL for a repository
   *
   * @param repoPath - Absolute path to repository
   * @param remoteName - Remote name (default: 'origin')
   * @returns Remote URL or null if not found
   */
  async getRemoteUrl(repoPath: string, remoteName: string = 'origin'): Promise<string | null> {
    logger.debug('Getting remote URL', { repoPath, remoteName });

    try {
      const { stdout } = await execAsync(`git config --get remote.${remoteName}.url`, {
        cwd: repoPath,
      });
      const url = stdout.trim();
      logger.debug('Remote URL retrieved', { repoPath, remoteName, url });
      return url;
    } catch {
      logger.debug('No remote URL found', { repoPath, remoteName });
      return null;
    }
  }

  /**
   * Get branches containing a specific commit
   *
   * @param repoPath - Absolute path to repository
   * @param commitHash - Commit hash
   * @returns Array of branch names
   */
  async getBranchesContainingCommit(repoPath: string, commitHash: string): Promise<string[]> {
    logger.debug('Getting branches containing commit', { repoPath, commitHash });

    try {
      const { stdout } = await execAsync(
        `git branch --contains ${commitHash} --format='%(refname:short)'`,
        { cwd: repoPath }
      );

      const branches = stdout
        .trim()
        .split('\n')
        .filter(b => b.length > 0);

      logger.debug('Branches retrieved', {
        repoPath,
        commitHash,
        branchCount: branches.length,
      });

      return branches;
    } catch (error) {
      logger.error('Failed to get branches containing commit', error as Error, {
        repoPath,
        commitHash,
      });
      throw new GitError(`Failed to get branches for commit: ${commitHash}`, {
        repoPath,
        commitHash,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Get commit information
   *
   * @param repoPath - Absolute path to repository
   * @param commitHash - Commit hash
   * @returns Commit information
   */
  async getCommitInfo(repoPath: string, commitHash: string): Promise<GitCommitInfo> {
    logger.debug('Getting commit info', { repoPath, commitHash });

    try {
      const { stdout } = await execAsync(
        `git log -1 --format='%H%n%h%n%s%n%an%n%ae%n%ai' ${commitHash}`,
        { cwd: repoPath }
      );

      const lines = stdout.trim().split('\n');
      const [hash, shortHash, message, author, email, dateStr] = lines;

      const commitInfo: GitCommitInfo = {
        hash,
        shortHash,
        message,
        author,
        email,
        date: new Date(dateStr),
      };

      logger.debug('Commit info retrieved', { repoPath, commitHash, shortHash });

      return commitInfo;
    } catch (error) {
      logger.error('Failed to get commit info', error as Error, { repoPath, commitHash });
      throw new GitError(`Failed to get commit info: ${commitHash}`, {
        repoPath,
        commitHash,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Get diff statistics for a commit
   *
   * @param repoPath - Absolute path to repository
   * @param commitHash - Commit hash
   * @returns Diff statistics
   */
  async getDiffStats(repoPath: string, commitHash: string): Promise<GitDiffStats> {
    logger.debug('Getting diff stats', { repoPath, commitHash });

    try {
      const { stdout } = await execAsync(`git diff ${commitHash}^ ${commitHash} --stat --numstat`, {
        cwd: repoPath,
      });

      // Parse numstat output
      const lines = stdout.trim().split('\n');
      let filesChanged = 0;
      let insertions = 0;
      let deletions = 0;
      const files: Array<{ path: string; insertions: number; deletions: number }> = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split('\t');
        if (parts.length === 3) {
          const ins = parseInt(parts[0], 10) || 0;
          const del = parseInt(parts[1], 10) || 0;
          const filePath = parts[2];

          filesChanged++;
          insertions += ins;
          deletions += del;

          files.push({
            path: filePath,
            insertions: ins,
            deletions: del,
          });
        }
      }

      logger.debug('Diff stats retrieved', {
        repoPath,
        commitHash,
        filesChanged,
        insertions,
        deletions,
      });

      return {
        filesChanged,
        insertions,
        deletions,
        files,
      };
    } catch (error) {
      logger.error('Failed to get diff stats', error as Error, { repoPath, commitHash });
      throw new GitError(`Failed to get diff stats: ${commitHash}`, {
        repoPath,
        commitHash,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Get full diff for a commit
   *
   * @param repoPath - Absolute path to repository
   * @param commitHash - Commit hash
   * @param statOnly - Whether to return only statistics
   * @returns Diff output
   */
  async getDiff(repoPath: string, commitHash: string, statOnly: boolean = false): Promise<string> {
    logger.debug('Getting diff', { repoPath, commitHash, statOnly });

    try {
      const statFlag = statOnly ? '--stat' : '';
      const { stdout } = await execAsync(
        `git diff ${commitHash}^ ${commitHash} ${statFlag}`.trim(),
        { cwd: repoPath }
      );

      logger.debug('Diff retrieved', {
        repoPath,
        commitHash,
        size: stdout.length,
      });

      return stdout;
    } catch (error) {
      logger.error('Failed to get diff', error as Error, { repoPath, commitHash });
      throw new GitError(`Failed to get diff: ${commitHash}`, {
        repoPath,
        commitHash,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Execute a Git command
   *
   * @param command - Git command to execute
   * @param cwd - Working directory
   * @returns Command result
   */
  async executeCommand(command: string, cwd: string): Promise<GitCommandResult> {
    logger.debug('Executing Git command', { command, cwd });

    try {
      const { stdout, stderr } = await execAsync(command, { cwd });

      logger.debug('Git command executed successfully', {
        command,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };

      logger.error('Git command failed', error as Error, { command, cwd });

      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
      };
    }
  }

  /**
   * Get repository name from path or remote
   *
   * @param repoPath - Absolute path to repository
   * @returns Repository name
   */
  async getRepositoryName(repoPath: string): Promise<string> {
    logger.debug('Getting repository name', { repoPath });

    // Try to get from remote URL first
    const remoteUrl = await this.getRemoteUrl(repoPath);
    if (remoteUrl) {
      // Extract repo name from URL
      const match = remoteUrl.match(/\/([^/]+?)(\.git)?$/);
      if (match) {
        const name = match[1];
        logger.debug('Repository name from remote URL', { repoPath, name });
        return name;
      }
    }

    // Fallback to directory name
    const name = path.basename(repoPath);
    logger.debug('Repository name from directory', { repoPath, name });
    return name;
  }
}
