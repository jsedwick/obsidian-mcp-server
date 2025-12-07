/**
 * Tool Registry - Exports all 25 MCP tools
 *
 * This module serves as the central registry for all Obsidian MCP Server tools.
 * Tools are organized by category for better maintainability.
 */

// Session tools (5)
export * from './session/index.js';

// Search tools (2)
export * from './search/index.js';

// Topic tools (4)
export * from './topics/index.js';

// Review tools (1)
export * from './review/index.js';

// Git/Project tools (7)
export * from './git/index.js';

// Decision tools (2)
export * from './decisions/index.js';

// Maintenance tools (2)
export * from './maintenance/index.js';

// Memory tools (2)
export * from './memory/index.js';

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
 * SEARCH (2 tools):
 * - search_vault
 * - get_topic_context
 *
 * TOPICS (4 tools):
 * - create_topic_page
 * - update_topic_page
 * - archive_topic
 * - analyze_topic_content
 *
 * REVIEW (1 tool):
 * - find_stale_topics
 *
 * GIT (7 tools):
 * - create_project_page
 * - record_commit
 * - analyze_commit_impact
 * - link_session_to_repository
 * - migrate_commit_branches
 * - migrate_project_slugs
 * - list_recent_projects
 *
 * DECISIONS (2 tools):
 * - create_decision
 * - migrate_decision_slugs
 *
 * MAINTENANCE (2 tools):
 * - vault_custodian
 * - toggle_embeddings
 *
 * MEMORY (2 tools):
 * - get_memory_base
 * - generate_vault_index
 *
 * Total: 25 tools
 */
