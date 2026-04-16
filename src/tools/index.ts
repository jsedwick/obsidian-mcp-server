/**
 * Tool Registry - Exports all 33 MCP tools
 *
 * This module serves as the central registry for all Obsidian MCP Server tools.
 * Tools are organized by category for better maintainability.
 */

// Session tools (5)
export * from './session/index.js';

// Search tools (2)
export * from './search/index.js';

// Topic tools (3)
export * from './topics/index.js';

// Review tools (1)
export * from './review/index.js';

// Git/Project tools (7)
export * from './git/index.js';

// Decision tools (3)
export * from './decisions/index.js';

// Maintenance tools (2)
export * from './maintenance/index.js';

// Memory tools (1)
export * from './memory/index.js';

// Task tools (3)
export * from './tasks/index.js';

// Document tools (1)
export * from './document/index.js';

// Code tools (1)
export * from './code/index.js';

// Workflow tools (2)
export * from './workflows/index.js';

// Issues tools (3)
export * from './issues/index.js';

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
 * TOPICS (3 tools):
 * - create_topic_page
 * - archive_topic
 * - analyze_topic_content
 *
 * REVIEW (1 tool):
 * - find_stale_topics
 *
 * GIT (5 tools):
 * - create_project_page
 * - record_commit
 * - analyze_commit_impact
 * - link_session_to_repository
 * - list_recent_projects
 *
 * DECISIONS (2 tools):
 * - create_decision
 * - find_undocumented_decisions
 *
 * MAINTENANCE (2 tools):
 * - vault_custodian
 * - toggle_embeddings
 *
 * MEMORY (1 tool):
 * - get_memory_base
 *
 * TASKS (3 tools):
 * - get_tasks_by_date
 * - add_task
 * - complete_task
 *
 * DOCUMENT (1 tool):
 * - update_document
 *
 * CODE (1 tool):
 * - code_file
 *
 * WORKFLOWS (2 tools):
 * - workflow
 * - list_vault_monitors
 *
 * ISSUES (3 tools):
 * - issue
 * - get_persistent_issues
 * - update_persistent_issue
 *
 * Total: 33 tools
 */
