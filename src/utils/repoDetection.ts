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
  /**
   * Adds +20 to a candidate's score when its directory basename appears in
   * this hint string (case-insensitive). `close_session` passes the session
   * ID so a topic-named session promotes the matching repo. Optional;
   * `analyze_session_commits` does not pass it.
   */
  sessionIdHint?: string;
}

export interface DetectedRepo {
  path: string;
  name: string;
  branch?: string;
  remote?: string;
  source: 'override' | 'working_directories' | 'inferred' | 'cwd';
  /**
   * Heuristic score from `selectAllRepoCandidates`. Higher = stronger evidence
   * the repo is in scope for this session. Override candidates skip scoring
   * and report 0. Used by callers (close_session) to detect tied-top
   * candidates so they can apply secondary tiebreakers (e.g., commit count).
   */
  score: number;
}

/**
 * Pick the most likely repository for commit analysis using Decision 037
 * priority. Read-only: never writes, throws only when an explicit override
 * points at a non-Git path (loud failure for caller intent).
 */
export async function selectBestRepoForCommitAnalysis(
  opts: SelectBestRepoOptions
): Promise<DetectedRepo | null> {
  const all = await selectAllRepoCandidates(opts);
  return all.length > 0 ? all[0] : null;
}

/**
 * Return every repository candidate ranked by score (descending). Decision 061:
 * `close_session` uses this to capture commits from every repo with
 * session-window activity, not just the top scorer. Override short-circuits
 * to a single-element list. Source is uniform across all returned candidates.
 */
export async function selectAllRepoCandidates(
  opts: SelectBestRepoOptions
): Promise<DetectedRepo[]> {
  if (opts.detectedRepoOverride) {
    const overridePath = opts.detectedRepoOverride.trim();
    try {
      await fs.access(path.join(overridePath, '.git'));
    } catch {
      throw new Error(`detected_repo_override path is not a Git repository: ${overridePath}`);
    }
    const info = await opts.getRepoInfo(overridePath);
    return [
      {
        path: overridePath,
        name: info.name,
        branch: info.branch,
        remote: info.remote ?? undefined,
        source: 'override',
        score: 0,
      },
    ];
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

  if (repoPaths.length === 0) return [];

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

    // Workdir relationship: flat 15-point evidence for any of three matches
    // (exact, workdir-inside-repo, repo-inside-workdir). The earlier asymmetric
    // 15/8/5 scoring caused the >2x clear-winner gate to fire trivially when
    // one candidate was a workdir (e.g. ~/.claude) while the actual session repo
    // was a subdir of a broader workdir (~/Projects/<repo>). c4ee373 flattened
    // closeSession's inline copy of this scorer; this preserves parity now that
    // close_session calls back into this helper.
    for (const workDir of searchDirs) {
      if (repoPath === workDir || workDir.startsWith(repoPath) || repoPath.startsWith(workDir)) {
        score += 15;
        break;
      }
    }

    if (opts.sessionIdHint) {
      const repoBasename = path.basename(repoPath).toLowerCase();
      if (opts.sessionIdHint.toLowerCase().includes(repoBasename)) {
        score += 20;
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

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map(c => ({
    path: c.path,
    name: c.name,
    branch: c.branch,
    remote: c.remote,
    source,
    score: c.score,
  }));
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

    // Recorded filenames use git's %h (variable length per core.abbrev);
    // a full hash is recorded iff some recorded prefix matches it. Skip
    // sub-4-char entries so a stray `.md` filename can't make every commit
    // look recorded.
    return hashes.filter(h => {
      for (const prefix of recorded) {
        if (prefix.length < 4) continue;
        if (h.startsWith(prefix)) return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}
