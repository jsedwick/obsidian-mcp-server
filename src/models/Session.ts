/**
 * Session domain models and interfaces
 *
 * This file defines all types related to session functionality:
 * - Session metadata and lifecycle
 * - File access tracking
 * - Session close results
 */

import type { RepositoryInfo } from './Git.js';

/**
 * File access action types
 */
export type FileAccessAction = 'read' | 'edit' | 'create';

/**
 * File access record
 */
export interface FileAccess {
  /** Absolute path to file */
  path: string;
  /** Type of access */
  action: FileAccessAction;
  /** When the access occurred */
  timestamp: string;
}

/**
 * Session status
 */
export type SessionStatus = 'ongoing' | 'completed';

/**
 * Session metadata (frontmatter)
 */
export interface SessionMetadata {
  /** Session date (YYYY-MM-DD format) */
  date: string;
  /** Unique session identifier */
  session_id: string;
  /** Topics referenced or created */
  topics: string[];
  /** Decisions referenced or created */
  decisions: string[];
  /** Session status */
  status: SessionStatus;
  /** Associated repository (if detected) */
  repository?: RepositoryInfo;
  /** Files accessed during session */
  files_accessed?: FileAccess[];
}

/**
 * Session close options
 */
export interface SessionCloseOptions {
  /** Session summary/description */
  summary: string;
  /** Optional custom topic/title for session */
  topic?: string;
  /** Whether to skip repository detection */
  skipRepoDetection?: boolean;
}

/**
 * Session close result
 */
export interface SessionCloseResult {
  /** Path to created session file */
  sessionFile: string;
  /** Session ID */
  sessionId: string;
  /** Number of repositories detected */
  repositoriesDetected: number;
  /** Repositories that were detected */
  repositories: RepositoryInfo[];
  /** Number of files accessed */
  filesAccessedCount: number;
  /** Topics mentioned in session */
  topics: string[];
  /** Decisions mentioned in session */
  decisions: string[];
}

/**
 * Session context (for reading existing sessions)
 */
export interface SessionContext {
  /** Session metadata */
  metadata: SessionMetadata;
  /** Session content (body) */
  content: string;
  /** Full file path */
  filePath: string;
}

/**
 * Session list entry (for list_recent_sessions)
 */
export interface SessionListEntry {
  /** Session ID */
  session_id: string;
  /** Session date */
  date: string;
  /** Session topic/title */
  topic?: string;
  /** Session status */
  status: SessionStatus;
  /** File path */
  file_path: string;
  /** Repository information (if any) */
  repository?: {
    name: string;
    path: string;
    commits: number;
  };
  /** Number of files accessed */
  files_accessed?: number;
}
