/**
 * Shared Git-repository detection helpers used by close_session and
 * analyze_session_commits. Decision 037 defines the priority order:
 *   0. detected_repo_override (caller-supplied absolute path)
 *   1. working_directories (Claude Code's <env> CWDs)
 *   2. infer from files accessed via MCP tools
 *   3. fall back to the MCP server's own cwd
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileAccess } from '../models/Session.js';

export async function inferWorkingDirectoriesFromFileAccess(
  filesAccessed: FileAccess[]
): Promise<string[]> {
  const repoPaths = new Set<string>();
  const directories = new Set<string>();
  for (const file of filesAccessed) {
    directories.add(path.dirname(file.path));
  }

  for (const dir of directories) {
    let currentPath = dir;
    for (let i = 0; i < 10; i++) {
      try {
        await fs.access(path.join(currentPath, '.git'));
        try {
          repoPaths.add(await fs.realpath(currentPath));
        } catch {
          repoPaths.add(currentPath);
        }
        break;
      } catch {
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) break;
        currentPath = parentPath;
      }
    }
  }

  return Array.from(repoPaths);
}

/**
 * Strip Claude Code's <env> display prefixes that occasionally leak into
 * working_directories entries (e.g. "Working directory: /path").
 */
export function sanitizeWorkingDirectories(dirs: string[]): string[] {
  return dirs.map(d =>
    d
      .replace(/^Working directory:\s*/i, '')
      .replace(/^Additional working directories?:\s*/i, '')
      .trim()
  );
}

export interface SelectBestRepoOptions {
  detectedRepoOverride?: string;
  workingDirectories?: string[];
  filesAccessed: FileAccess[];
  fallbackCwd: string;
  vaultPaths: string[];
  findGitRepos: (startPath: string, maxDepth?: number) => Promise<string[]>;
  getRepoInfo: (
    repoPath: string
  ) => Promise<{ name: string; branch?: string; remote?: string | null }>;
}

export interface DetectedRepo {
  path: string;
  name: string;
  branch?: string;
  remote?: string;
  source: 'override' | 'working_directories' | 'inferred' | 'cwd';
}

/**
 * Pick the most likely repository for commit analysis using Decision 037
 * priority. Read-only: never writes, throws only when an explicit override
 * points at a non-Git path (loud failure for caller intent).
 */
export async function selectBestRepoForCommitAnalysis(
  opts: SelectBestRepoOptions
): Promise<DetectedRepo | null> {
  if (opts.detectedRepoOverride) {
    const overridePath = opts.detectedRepoOverride.trim();
    try {
      await fs.access(path.join(overridePath, '.git'));
    } catch {
      throw new Error(`detected_repo_override path is not a Git repository: ${overridePath}`);
    }
    const info = await opts.getRepoInfo(overridePath);
    return {
      path: overridePath,
      name: info.name,
      branch: info.branch,
      remote: info.remote ?? undefined,
      source: 'override',
    };
  }

  let searchDirs: string[];
  let source: DetectedRepo['source'];
  if (opts.workingDirectories?.length) {
    searchDirs = sanitizeWorkingDirectories(opts.workingDirectories);
    source = 'working_directories';
  } else {
    const inferred = await inferWorkingDirectoriesFromFileAccess(opts.filesAccessed);
    if (inferred.length > 0) {
      searchDirs = inferred;
      source = 'inferred';
    } else {
      searchDirs = [opts.fallbackCwd];
      source = 'cwd';
    }
  }

  const allRepoPaths = new Set<string>();
  for (const dir of searchDirs) {
    try {
      const repos = await opts.findGitRepos(dir);
      repos.forEach(r => allRepoPaths.add(r));
    } catch {
      // Skip dirs that can't be searched
    }
  }

  const repoPaths = Array.from(allRepoPaths).filter(repoPath => {
    return !opts.vaultPaths.some(
      vaultPath => repoPath === vaultPath || repoPath.startsWith(vaultPath + path.sep)
    );
  });

  if (repoPaths.length === 0) return null;

  const candidates: Array<{
    path: string;
    name: string;
    score: number;
    branch?: string;
    remote?: string;
  }> = [];

  for (const repoPath of repoPaths) {
    let score = 0;
    const filesInRepo = opts.filesAccessed.filter(f => f.path.startsWith(repoPath));
    const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
    const readFiles = filesInRepo.filter(f => f.action === 'read');
    if (editedFiles.length > 0) score += editedFiles.length * 10;
    if (readFiles.length > 0) score += readFiles.length * 5;

    for (const workDir of searchDirs) {
      if (repoPath === workDir) {
        score += 15;
        break;
      } else if (workDir.startsWith(repoPath)) {
        score += 8;
        break;
      } else if (repoPath.startsWith(workDir)) {
        score += 5;
        break;
      }
    }

    if (score > 0 || repoPaths.length === 1) {
      const info = await opts.getRepoInfo(repoPath);
      candidates.push({
        path: repoPath,
        name: info.name,
        score,
        branch: info.branch,
        remote: info.remote ?? undefined,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  return {
    path: top.path,
    name: top.name,
    branch: top.branch,
    remote: top.remote,
    source,
  };
}

/**
 * Look back N hours on HEAD for commits that haven't yet been recorded as
 * vault commit pages. Used as a Phase-1 diagnostic when the strict --since
 * window (sessionStartTime) returns 0 — `getMemoryBase` resets sessionStartTime
 * to "now," so legitimate pre-/mb commits get excluded by the strict window.
 */
export async function findUnrecordedRecentCommits(opts: {
  repoPath: string;
  vaultPath: string;
  repoSlug: string;
  hoursBack: number;
  execAsync: (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string }>;
}): Promise<string[]> {
  try {
    const { stdout } = await opts.execAsync(
      `git log --since="${opts.hoursBack} hours ago" --format=%H --no-merges`,
      { cwd: opts.repoPath }
    );
    const hashes = stdout
      .trim()
      .split('\n')
      .filter(h => h.length > 0);
    if (hashes.length === 0) return [];

    const recorded = new Set<string>();
    const commitsDir = path.join(opts.vaultPath, 'projects', opts.repoSlug, 'commits');
    try {
      const files = await fs.readdir(commitsDir);
      for (const file of files) {
        if (file.endsWith('.md')) recorded.add(file.replace('.md', ''));
      }
    } catch {
      // commits dir doesn't exist yet — all hashes are unrecorded
    }

    return hashes.filter(h => !recorded.has(h.substring(0, 7)));
  } catch {
    return [];
  }
}
