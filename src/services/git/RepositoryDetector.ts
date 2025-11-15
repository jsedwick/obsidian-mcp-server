/**
 * RepositoryDetector - Repository detection from file access patterns
 *
 * Responsible for:
 * - Discovering Git repositories in filesystem
 * - Scoring repositories based on file access patterns
 * - Detecting relevant repositories for sessions
 * - Providing ranked repository candidates
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { GitService } from './GitService.js';
import type { RepoCandidate, RepositoryDetectionOptions } from '../../models/Git.js';
import type { FileAccess } from '../../models/Session.js';

const logger = createLogger('RepositoryDetector');

/**
 * Default scoring weights
 */
const SCORING = {
  EDITED_FILE: 10,
  READ_FILE: 5,
  SESSION_TOPIC_MATCH: 20,
  IS_CWD: 15,
  CWD_WITHIN_REPO: 8,
  REPO_WITHIN_CWD: 5,
} as const;

/**
 * Service for detecting Git repositories from file access patterns
 */
export class RepositoryDetector {
  private gitService: GitService;

  constructor(gitService: GitService) {
    this.gitService = gitService;
    logger.info('RepositoryDetector initialized');
  }

  /**
   * Find all Git repositories starting from a directory
   *
   * Searches subdirectories (up to maxDepth) and parent directories (up to 3 levels up)
   *
   * @param startPath - Starting directory path
   * @param maxDepth - Maximum depth to search subdirectories (default: 2)
   * @returns Array of repository paths
   */
  async findRepositories(startPath: string, maxDepth: number = 2): Promise<string[]> {
    logger.debug('Finding repositories', { startPath, maxDepth });

    const repos: string[] = [];

    // Search subdirectories
    const searchDir = async (dirPath: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;

      try {
        // Check if this directory is a git repo
        if (await this.gitService.isGitRepository(dirPath)) {
          repos.push(dirPath);
          logger.debug('Found repository in subdirectory', { path: dirPath, depth });
        }

        // Search subdirectories
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            await searchDir(path.join(dirPath, entry.name), depth + 1);
          }
        }
      } catch (error) {
        // Skip directories we can't access
        logger.debug('Skipping inaccessible directory', {
          dirPath,
          error: (error as Error).message,
        });
      }
    };

    await searchDir(startPath, 0);

    // Also check parent directories (up to 3 levels)
    let currentPath = startPath;
    for (let i = 0; i < 3; i++) {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break; // Reached root

      if (await this.gitService.isGitRepository(parentPath)) {
        if (!repos.includes(parentPath)) {
          repos.push(parentPath);
          logger.debug('Found repository in parent directory', { path: parentPath, level: i + 1 });
        }
      }

      currentPath = parentPath;
    }

    logger.info('Repository search complete', {
      startPath,
      repositoriesFound: repos.length,
    });

    return repos;
  }

  /**
   * Detect relevant repositories based on file access patterns
   *
   * @param filesAccessed - Array of file access records
   * @param options - Detection options
   * @returns Array of scored repository candidates
   */
  async detectFromFileAccess(
    filesAccessed: FileAccess[],
    options: RepositoryDetectionOptions & {
      cwd?: string;
      sessionId?: string;
    } = {}
  ): Promise<RepoCandidate[]> {
    const {
      minScore = 0,
      maxCandidates = 10,
      includeMetadata = true,
      cwd = process.env.PWD || process.cwd(),
      sessionId,
    } = options;

    logger.debug('Detecting repositories from file access', {
      filesAccessedCount: filesAccessed.length,
      cwd,
      sessionId,
    });

    // Find all repositories
    const repoPaths = await this.findRepositories(cwd);

    if (repoPaths.length === 0) {
      logger.info('No repositories found');
      return [];
    }

    // Score each repository
    const candidates: RepoCandidate[] = [];

    for (const repoPath of repoPaths) {
      const candidate = await this.scoreRepository(
        repoPath,
        filesAccessed,
        cwd,
        sessionId,
        includeMetadata
      );

      // Include if score meets threshold or if it's the only repo
      if (candidate.score >= minScore || repoPaths.length === 1) {
        candidates.push(candidate);
      }
    }

    // Sort by score (descending)
    candidates.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedCandidates = candidates.slice(0, maxCandidates);

    logger.info('Repository detection complete', {
      candidatesFound: limitedCandidates.length,
      topScore: limitedCandidates[0]?.score,
    });

    return limitedCandidates;
  }

  /**
   * Score a repository based on file access patterns and session context
   *
   * @param repoPath - Repository path
   * @param filesAccessed - File access records
   * @param cwd - Current working directory
   * @param sessionId - Session identifier
   * @param includeMetadata - Whether to fetch branch/remote info
   * @returns Scored repository candidate
   */
  private async scoreRepository(
    repoPath: string,
    filesAccessed: FileAccess[],
    cwd: string,
    sessionId?: string,
    includeMetadata: boolean = true
  ): Promise<RepoCandidate> {
    let score = 0;
    const reasons: string[] = [];

    logger.debug('Scoring repository', { repoPath });

    // Score based on files accessed in this repo
    const filesInRepo = filesAccessed.filter(f => f.path.startsWith(repoPath));
    const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
    const readFiles = filesInRepo.filter(f => f.action === 'read');

    if (editedFiles.length > 0) {
      const points = editedFiles.length * SCORING.EDITED_FILE;
      score += points;
      reasons.push(`${editedFiles.length} file(s) modified`);
      logger.debug('Scored edited files', { repoPath, editedFiles: editedFiles.length, points });
    }

    if (readFiles.length > 0) {
      const points = readFiles.length * SCORING.READ_FILE;
      score += points;
      reasons.push(`${readFiles.length} file(s) read`);
      logger.debug('Scored read files', { repoPath, readFiles: readFiles.length, points });
    }

    // Score based on session topic matching repo name
    if (sessionId) {
      const repoName = path.basename(repoPath);
      if (sessionId.toLowerCase().includes(repoName.toLowerCase())) {
        score += SCORING.SESSION_TOPIC_MATCH;
        reasons.push('Session topic matches repo name');
        logger.debug('Scored session topic match', { repoPath, repoName, sessionId });
      }
    }

    // Score based on proximity to CWD
    if (repoPath === cwd) {
      score += SCORING.IS_CWD;
      reasons.push('Repo is current working directory');
      logger.debug('Scored CWD match', { repoPath });
    } else if (cwd.startsWith(repoPath)) {
      score += SCORING.CWD_WITHIN_REPO;
      reasons.push('CWD is within this repo');
      logger.debug('Scored CWD within repo', { repoPath, cwd });
    } else if (repoPath.startsWith(cwd)) {
      score += SCORING.REPO_WITHIN_CWD;
      reasons.push('Repo is subdirectory of CWD');
      logger.debug('Scored repo within CWD', { repoPath, cwd });
    }

    // Get repository metadata if requested
    let branch: string | undefined;
    let remote: string | undefined;
    let name: string;

    if (includeMetadata) {
      name = await this.gitService.getRepositoryName(repoPath);
      branch = await this.gitService.getCurrentBranch(repoPath).catch(() => undefined);
      remote = await this.gitService.getRemoteUrl(repoPath).catch(() => undefined);
    } else {
      name = path.basename(repoPath);
    }

    logger.debug('Repository scored', { repoPath, name, score, reasonsCount: reasons.length });

    return {
      path: repoPath,
      name,
      score,
      reasons,
      branch,
      remote,
    };
  }

  /**
   * Get the top repository candidate from file access
   *
   * Helper method for sessions that want a single "best guess" repository
   *
   * @param filesAccessed - File access records
   * @param options - Detection options
   * @returns Top repository candidate or null if none found
   */
  async getTopCandidate(
    filesAccessed: FileAccess[],
    options: RepositoryDetectionOptions & {
      cwd?: string;
      sessionId?: string;
    } = {}
  ): Promise<RepoCandidate | null> {
    const candidates = await this.detectFromFileAccess(filesAccessed, {
      ...options,
      maxCandidates: 1,
    });

    return candidates[0] || null;
  }

  /**
   * Check if a candidate is a clear winner
   *
   * A candidate is considered a clear winner if:
   * - It's the only candidate, OR
   * - Its score is more than 2x the next highest score
   *
   * @param candidates - Sorted array of candidates (highest score first)
   * @returns true if first candidate is a clear winner
   */
  isClearWinner(candidates: RepoCandidate[]): boolean {
    if (candidates.length === 0) return false;
    if (candidates.length === 1) return true;

    const topScore = candidates[0].score;
    const secondScore = candidates[1].score;

    return topScore > secondScore * 2;
  }
}
