/**
 * Git test utilities for creating and managing temporary Git repositories
 *
 * This module provides utilities for:
 * - Creating temporary Git repositories for testing
 * - Making test commits with various configurations
 * - Setting up repository state (branches, remotes, etc.)
 * - Cleaning up test repositories
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Git repository configuration
 */
export interface GitRepoConfig {
  /** Repository name */
  name?: string;
  /** Initial branch name (default: main) */
  branch?: string;
  /** Remote URL (optional) */
  remoteUrl?: string;
  /** Remote name (default: origin) */
  remoteName?: string;
  /** Initial commit message (default: "Initial commit") */
  initialCommit?: string;
}

/**
 * Test commit configuration
 */
export interface TestCommitConfig {
  /** Commit message */
  message: string;
  /** Author name (default: "Test Author") */
  author?: string;
  /** Author email (default: "test@example.com") */
  email?: string;
  /** Files to create/modify */
  files?: Record<string, string>;
  /** Branch to commit on (creates if doesn't exist) */
  branch?: string;
}

/**
 * Create a temporary Git repository for testing
 *
 * @param config - Repository configuration
 * @returns Path to the created repository
 *
 * @example
 * ```ts
 * const repoPath = await createTestGitRepo({
 *   name: 'test-repo',
 *   branch: 'main',
 *   remoteUrl: 'https://github.com/user/test-repo.git'
 * });
 * ```
 */
export async function createTestGitRepo(config: GitRepoConfig = {}): Promise<string> {
  const name = config.name || 'test-repo';
  const random = Math.random().toString(36).substring(7);
  const repoPath = path.join(os.tmpdir(), `git-repo-${name}-${random}`);

  await fs.mkdir(repoPath, { recursive: true });

  // Initialize Git repository
  await execAsync('git init', { cwd: repoPath });

  // Set default branch if specified
  if (config.branch) {
    await execAsync(`git checkout -b ${config.branch}`, { cwd: repoPath });
  }

  // Configure user for commits
  await execAsync('git config user.name "Test Author"', { cwd: repoPath });
  await execAsync('git config user.email "test@example.com"', { cwd: repoPath });

  // Add remote if specified
  if (config.remoteUrl) {
    const remoteName = config.remoteName || 'origin';
    await execAsync(`git remote add ${remoteName} ${config.remoteUrl}`, { cwd: repoPath });
  }

  // Create initial commit
  const initialMessage = config.initialCommit || 'Initial commit';
  const readmePath = path.join(repoPath, 'README.md');
  await fs.writeFile(readmePath, `# ${name}\n\nTest repository\n`);
  await execAsync('git add README.md', { cwd: repoPath });
  await execAsync(`git commit -m "${initialMessage}"`, { cwd: repoPath });

  return repoPath;
}

/**
 * Create a test commit in a Git repository
 *
 * @param repoPath - Path to the repository
 * @param config - Commit configuration
 * @returns Commit hash
 *
 * @example
 * ```ts
 * const hash = await createTestCommit(repoPath, {
 *   message: 'Add feature X',
 *   files: { 'src/feature.ts': 'export function feature() {}' },
 *   author: 'Jane Doe',
 *   email: 'jane@example.com'
 * });
 * ```
 */
export async function createTestCommit(
  repoPath: string,
  config: TestCommitConfig
): Promise<string> {
  // Switch to branch if specified
  if (config.branch) {
    try {
      await execAsync(`git checkout ${config.branch}`, { cwd: repoPath });
    } catch {
      // Branch doesn't exist, create it
      await execAsync(`git checkout -b ${config.branch}`, { cwd: repoPath });
    }
  }

  // Configure author if specified
  const authorName = config.author || 'Test Author';
  const authorEmail = config.email || 'test@example.com';
  await execAsync(`git config user.name "${authorName}"`, { cwd: repoPath });
  await execAsync(`git config user.email "${authorEmail}"`, { cwd: repoPath });

  // Create/modify files
  if (config.files) {
    for (const [filePath, content] of Object.entries(config.files)) {
      const fullPath = path.join(repoPath, filePath);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content);
      await execAsync(`git add "${filePath}"`, { cwd: repoPath });
    }
  }

  // Create commit
  await execAsync(`git commit -m "${config.message}"`, { cwd: repoPath });

  // Get commit hash
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
  return stdout.trim();
}

/**
 * Create multiple test commits in sequence
 *
 * @param repoPath - Path to the repository
 * @param commits - Array of commit configurations
 * @returns Array of commit hashes
 *
 * @example
 * ```ts
 * const hashes = await createTestCommits(repoPath, [
 *   { message: 'First commit', files: { 'file1.ts': 'content' } },
 *   { message: 'Second commit', files: { 'file2.ts': 'content' } }
 * ]);
 * ```
 */
export async function createTestCommits(
  repoPath: string,
  commits: TestCommitConfig[]
): Promise<string[]> {
  const hashes: string[] = [];
  for (const commit of commits) {
    const hash = await createTestCommit(repoPath, commit);
    hashes.push(hash);
  }
  return hashes;
}

/**
 * Create a branch in a test repository
 *
 * @param repoPath - Path to the repository
 * @param branchName - Name of the branch to create
 * @param fromBranch - Branch to create from (optional, uses current branch)
 *
 * @example
 * ```ts
 * await createTestBranch(repoPath, 'feature/new-feature', 'main');
 * ```
 */
export async function createTestBranch(
  repoPath: string,
  branchName: string,
  fromBranch?: string
): Promise<void> {
  if (fromBranch) {
    await execAsync(`git checkout ${fromBranch}`, { cwd: repoPath });
  }
  await execAsync(`git checkout -b ${branchName}`, { cwd: repoPath });
}

/**
 * Checkout a branch in a test repository
 *
 * @param repoPath - Path to the repository
 * @param branchName - Name of the branch to checkout
 *
 * @example
 * ```ts
 * await checkoutTestBranch(repoPath, 'main');
 * ```
 */
export async function checkoutTestBranch(repoPath: string, branchName: string): Promise<void> {
  await execAsync(`git checkout ${branchName}`, { cwd: repoPath });
}

/**
 * Add a remote to a test repository
 *
 * @param repoPath - Path to the repository
 * @param remoteName - Name of the remote
 * @param remoteUrl - URL of the remote
 *
 * @example
 * ```ts
 * await addTestRemote(repoPath, 'origin', 'https://github.com/user/repo.git');
 * ```
 */
export async function addTestRemote(
  repoPath: string,
  remoteName: string,
  remoteUrl: string
): Promise<void> {
  await execAsync(`git remote add ${remoteName} ${remoteUrl}`, { cwd: repoPath });
}

/**
 * Get the current branch of a test repository
 *
 * @param repoPath - Path to the repository
 * @returns Current branch name
 *
 * @example
 * ```ts
 * const branch = await getTestRepoBranch(repoPath);
 * ```
 */
export async function getTestRepoBranch(repoPath: string): Promise<string> {
  const { stdout } = await execAsync('git branch --show-current', { cwd: repoPath });
  return stdout.trim();
}

/**
 * Get the commit hash at HEAD
 *
 * @param repoPath - Path to the repository
 * @returns Commit hash
 *
 * @example
 * ```ts
 * const hash = await getTestRepoHead(repoPath);
 * ```
 */
export async function getTestRepoHead(repoPath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
  return stdout.trim();
}

/**
 * Get the short commit hash at HEAD
 *
 * @param repoPath - Path to the repository
 * @returns Short commit hash
 *
 * @example
 * ```ts
 * const shortHash = await getTestRepoShortHead(repoPath);
 * ```
 */
export async function getTestRepoShortHead(repoPath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --short HEAD', { cwd: repoPath });
  return stdout.trim();
}

/**
 * Get commit information
 *
 * @param repoPath - Path to the repository
 * @param hash - Commit hash (defaults to HEAD)
 * @returns Commit information
 *
 * @example
 * ```ts
 * const info = await getTestCommitInfo(repoPath, 'abc123');
 * ```
 */
export async function getTestCommitInfo(
  repoPath: string,
  hash: string = 'HEAD'
): Promise<{
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  email: string;
  date: string;
}> {
  const format = '%H%n%h%n%s%n%an%n%ae%n%aI';
  const { stdout } = await execAsync(`git log -1 --format="${format}" ${hash}`, {
    cwd: repoPath,
  });

  const [fullHash, shortHash, message, author, email, date] = stdout.trim().split('\n');

  return {
    hash: fullHash,
    shortHash,
    message,
    author,
    email,
    date,
  };
}

/**
 * Get diff statistics for a commit
 *
 * @param repoPath - Path to the repository
 * @param hash - Commit hash (defaults to HEAD)
 * @returns Diff statistics
 *
 * @example
 * ```ts
 * const stats = await getTestCommitDiffStats(repoPath, 'abc123');
 * ```
 */
export async function getTestCommitDiffStats(
  repoPath: string,
  hash: string = 'HEAD'
): Promise<{
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: Array<{ path: string; insertions: number; deletions: number }>;
}> {
  const { stdout } = await execAsync(`git show --numstat --format="" ${hash}`, {
    cwd: repoPath,
  });

  const lines = stdout.trim().split('\n').filter(l => l);
  const files: Array<{ path: string; insertions: number; deletions: number }> = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (const line of lines) {
    const [insertions, deletions, filePath] = line.split('\t');
    const ins = insertions === '-' ? 0 : parseInt(insertions, 10);
    const del = deletions === '-' ? 0 : parseInt(deletions, 10);

    files.push({ path: filePath, insertions: ins, deletions: del });
    totalInsertions += ins;
    totalDeletions += del;
  }

  return {
    filesChanged: files.length,
    insertions: totalInsertions,
    deletions: totalDeletions,
    files,
  };
}

/**
 * Get full diff for a commit
 *
 * @param repoPath - Path to the repository
 * @param hash - Commit hash (defaults to HEAD)
 * @returns Diff content
 *
 * @example
 * ```ts
 * const diff = await getTestCommitDiff(repoPath, 'abc123');
 * ```
 */
export async function getTestCommitDiff(repoPath: string, hash: string = 'HEAD'): Promise<string> {
  const { stdout } = await execAsync(`git show ${hash}`, { cwd: repoPath });
  return stdout;
}

/**
 * List all branches in a test repository
 *
 * @param repoPath - Path to the repository
 * @returns Array of branch names
 *
 * @example
 * ```ts
 * const branches = await listTestBranches(repoPath);
 * ```
 */
export async function listTestBranches(repoPath: string): Promise<string[]> {
  const { stdout } = await execAsync('git branch --format="%(refname:short)"', { cwd: repoPath });
  return stdout
    .trim()
    .split('\n')
    .filter(b => b);
}

/**
 * Check if a commit exists on a branch
 *
 * @param repoPath - Path to the repository
 * @param hash - Commit hash
 * @param branch - Branch name
 * @returns True if commit exists on branch
 *
 * @example
 * ```ts
 * const exists = await commitExistsOnBranch(repoPath, 'abc123', 'main');
 * ```
 */
export async function commitExistsOnBranch(
  repoPath: string,
  hash: string,
  branch: string
): Promise<boolean> {
  try {
    await execAsync(`git merge-base --is-ancestor ${hash} ${branch}`, { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get branches containing a specific commit
 *
 * @param repoPath - Path to the repository
 * @param hash - Commit hash
 * @returns Array of branch names containing the commit
 *
 * @example
 * ```ts
 * const branches = await getBranchesContainingCommit(repoPath, 'abc123');
 * ```
 */
export async function getBranchesContainingCommit(
  repoPath: string,
  hash: string
): Promise<string[]> {
  const { stdout } = await execAsync(`git branch --contains ${hash} --format="%(refname:short)"`, {
    cwd: repoPath,
  });
  return stdout
    .trim()
    .split('\n')
    .filter(b => b);
}

/**
 * Remove a test Git repository
 *
 * @param repoPath - Path to the repository to remove
 *
 * @example
 * ```ts
 * await cleanupTestGitRepo(repoPath);
 * ```
 */
export async function cleanupTestGitRepo(repoPath: string): Promise<void> {
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors (repo may not exist)
  }
}

/**
 * Create a test repository with a realistic commit history
 *
 * @param name - Repository name
 * @returns Repository path and commit information
 *
 * @example
 * ```ts
 * const { repoPath, commits } = await createRealisticTestRepo('my-project');
 * ```
 */
export async function createRealisticTestRepo(name?: string): Promise<{
  repoPath: string;
  commits: Array<{
    hash: string;
    message: string;
    branch: string;
  }>;
}> {
  const repoPath = await createTestGitRepo({
    name: name || 'realistic-repo',
    branch: 'main',
    remoteUrl: 'https://github.com/user/realistic-repo.git',
  });

  const commits: Array<{ hash: string; message: string; branch: string }> = [];

  // Initial commit (already created)
  const initialHash = await getTestRepoHead(repoPath);
  commits.push({ hash: initialHash, message: 'Initial commit', branch: 'main' });

  // Add some commits to main
  const mainCommits = await createTestCommits(repoPath, [
    {
      message: 'Add basic project structure',
      files: {
        'src/index.ts': 'export function main() {}',
        'package.json': '{"name": "test", "version": "1.0.0"}',
      },
    },
    {
      message: 'Add configuration files',
      files: {
        'tsconfig.json': '{"compilerOptions": {}}',
        '.gitignore': 'node_modules/\ndist/',
      },
    },
  ]);

  commits.push(
    { hash: mainCommits[0], message: 'Add basic project structure', branch: 'main' },
    { hash: mainCommits[1], message: 'Add configuration files', branch: 'main' }
  );

  // Create feature branch
  await createTestBranch(repoPath, 'feature/new-feature', 'main');
  const featureCommits = await createTestCommits(repoPath, [
    {
      message: 'Implement feature X',
      files: { 'src/feature-x.ts': 'export function featureX() {}' },
    },
    {
      message: 'Add tests for feature X',
      files: { 'src/feature-x.test.ts': 'test("feature X works", () => {})' },
    },
  ]);

  commits.push(
    { hash: featureCommits[0], message: 'Implement feature X', branch: 'feature/new-feature' },
    {
      hash: featureCommits[1],
      message: 'Add tests for feature X',
      branch: 'feature/new-feature',
    }
  );

  // Return to main
  await checkoutTestBranch(repoPath, 'main');

  return { repoPath, commits };
}
