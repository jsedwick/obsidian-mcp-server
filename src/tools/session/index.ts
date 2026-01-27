/**
 * Session tools exports
 *
 * This module exports all session-related MCP tools:
 * - analyze_session_commits: Analyze commits made during session for documentation impact
 * - close_session: Create session retroactively at end of conversation
 * - get_session_context: Retrieve full context from a session file
 * - list_recent_sessions: List recent sessions with metadata
 * - track_file_access: Track file access for repository detection
 * - detect_session_repositories: Detect relevant Git repositories
 */

export { analyzeSessionCommits } from './analyzeSessionCommits.js';
export type { AnalyzeSessionCommitsArgs, AnalyzeCommitsResult } from './analyzeSessionCommits.js';

export { closeSession } from './closeSession.js';
export type { CloseSessionArgs, CloseSessionResult } from './closeSession.js';

export { getSessionContext } from './getSessionContext.js';
export type { GetSessionContextArgs, GetSessionContextResult } from './getSessionContext.js';

export { listRecentSessions } from './listRecentSessions.js';
export type { ListRecentSessionsArgs, ListRecentSessionsResult } from './listRecentSessions.js';

export { trackFileAccess } from './trackFileAccess.js';
export type { TrackFileAccessArgs, TrackFileAccessResult } from './trackFileAccess.js';

export { detectSessionRepositories } from './detectSessionRepositories.js';
export type {
  DetectSessionRepositoriesArgs,
  DetectSessionRepositoriesResult,
} from './detectSessionRepositories.js';

export { restoreSessionData } from './restoreSessionData.js';
export type { RestoreSessionDataArgs, RestoreSessionDataResult } from './restoreSessionData.js';
