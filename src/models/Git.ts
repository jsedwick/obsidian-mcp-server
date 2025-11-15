/**
 * Git domain models and interfaces
 *
 * This file defines all types related to Git functionality:
 * - Repository information and metadata
 * - Repository detection and scoring
 * - Git operations results
 */

/**
 * Repository candidate with scoring for detection
 */
export interface RepoCandidate {
  /** Absolute path to repository root */
  path: string;
  /** Repository name (from directory or remote) */
  name: string;
  /** Detection confidence score (0-100) */
  score: number;
  /** Reasons why this repo was detected */
  reasons: string[];
  /** Current branch name */
  branch?: string;
  /** Remote URL (if available) */
  remote?: string | null;
}

/**
 * Repository metadata for sessions/projects
 */
export interface RepositoryInfo {
  /** Absolute path to repository root */
  path: string;
  /** Repository name */
  name: string;
  /** Commit hashes associated with this context */
  commits: string[];
}

/**
 * Git command result
 */
export interface GitCommandResult {
  /** Command stdout */
  stdout: string;
  /** Command stderr */
  stderr: string;
  /** Exit code */
  exitCode: number;
}

/**
 * Git branch information
 */
export interface GitBranchInfo {
  /** Branch name */
  name: string;
  /** Whether this is the current branch */
  current: boolean;
  /** Remote tracking branch (if any) */
  remote?: string;
}

/**
 * Git remote information
 */
export interface GitRemoteInfo {
  /** Remote name (e.g., 'origin') */
  name: string;
  /** Remote URL */
  url: string;
  /** Fetch URL (if different) */
  fetchUrl?: string;
}

/**
 * Git commit information
 */
export interface GitCommitInfo {
  /** Full commit hash */
  hash: string;
  /** Short commit hash */
  shortHash: string;
  /** Commit message */
  message: string;
  /** Author name */
  author: string;
  /** Author email */
  email: string;
  /** Commit date */
  date: Date;
  /** Branch(es) containing this commit */
  branches?: string[];
}

/**
 * Git diff statistics
 */
export interface GitDiffStats {
  /** Number of files changed */
  filesChanged: number;
  /** Number of insertions */
  insertions: number;
  /** Number of deletions */
  deletions: number;
  /** Detailed file changes */
  files: Array<{
    path: string;
    insertions: number;
    deletions: number;
  }>;
}

/**
 * Repository detection options
 */
export interface RepositoryDetectionOptions {
  /** Minimum score threshold for detection (0-100) */
  minScore?: number;
  /** Maximum number of candidates to return */
  maxCandidates?: number;
  /** Whether to include repository metadata (branch, remote) */
  includeMetadata?: boolean;
}
