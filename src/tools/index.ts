/**
 * Tool Registry - Exports all 27 MCP tools
 *
 * This module serves as the central registry for all Obsidian MCP Server tools.
 * Tools are organized by category for better maintainability.
 */

// Session tools (5)
export * from './session/index.js';

// Search tools (4)
export * from './search/index.js';

// Topic tools (4)
export * from './topics/index.js';

// Review tools (3)
export * from './review/index.js';

// Git/Project tools (7)
export * from './git/index.js';

// Decision tools (2)
export * from './decisions/index.js';

// Maintenance tools (2)
export * from './maintenance/index.js';

/**
 * Tool Summary:
 *
 * SESSION (5 tools):
 * - close_session
 * - get_session_context
 * - list_recent_sessions
 * - track_file_access
 * - detect_session_repositories
 *
 * SEARCH (4 tools):
 * - search_vault
 * - enhanced_search
 * - get_topic_context
 * - link_to_topic
 *
 * TOPICS (4 tools):
 * - create_topic_page
 * - update_topic_page
 * - archive_topic
 * - analyze_topic_content
 *
 * REVIEW (3 tools):
 * - find_stale_topics
 * - review_topic
 * - approve_topic_update
 *
 * GIT (7 tools):
 * - create_project_page
 * - record_commit
 * - analyze_commit_impact
 * - link_session_to_repository
 * - migrate_commit_branches
 * - list_recent_projects
 * - detect_session_repositories (git-related)
 *
 * DECISIONS (2 tools):
 * - create_decision
 * - extract_decisions_from_session
 *
 * MAINTENANCE (2 tools):
 * - vault_custodian
 * - toggle_embeddings
 *
 * Total: 27 tools
 */
