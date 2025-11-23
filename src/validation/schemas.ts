/**
 * Zod validation schemas for all 29 MCP tool inputs
 *
 * This module provides comprehensive runtime validation using Zod v3.
 * Each schema corresponds to a tool's Args interface and includes:
 * - Required vs optional field validation
 * - Type constraints (strings, numbers, booleans, enums)
 * - Custom validation rules (min length, patterns, etc.)
 * - Helpful error messages for users
 *
 * Usage:
 *   import { ValidationSchemas } from './validation/schemas.js';
 *   const validatedArgs = ValidationSchemas.search_vault.parse(args);
 */

import { z } from 'zod';

/**
 * Common reusable schemas
 */

// Detail level enum (used across multiple tools)
const DetailLevelSchema = z.enum(['minimal', 'summary', 'detailed', 'full'], {
  errorMap: () => ({ message: 'detail must be one of: minimal, summary, detailed, full' }),
});

// File access action enum
const FileAccessActionSchema = z.enum(['read', 'edit', 'create'], {
  errorMap: () => ({ message: 'action must be one of: read, edit, create' }),
});

// Review action enum
const ReviewActionSchema = z.enum(['update', 'archive', 'keep', 'dismiss'], {
  errorMap: () => ({ message: 'action must be one of: update, archive, keep, dismiss' }),
});

// Date range object (used in search)
const DateRangeSchema = z
  .object({
    start: z.string().optional(),
    end: z.string().optional(),
  })
  .optional();

// Non-empty string validator
const NonEmptyString = z.string().min(1, 'This field cannot be empty');

// Positive number validator
const PositiveNumber = z.number().int().positive('Must be a positive integer');

// Absolute path validator (basic check for absolute paths)
const AbsolutePath = z
  .string()
  .min(1)
  .refine(path => path.startsWith('/') || /^[A-Z]:\\/.test(path), {
    message: 'Path must be an absolute path (starting with / on Unix or C:\\ on Windows)',
  });

// Git commit hash validator (7-40 hex characters)
const CommitHash = z.string().regex(/^[a-f0-9]{7,40}$/i, {
  message: 'Invalid commit hash format (expected 7-40 hexadecimal characters)',
});

/**
 * SESSION TOOLS (5 tools)
 */

// track_file_access
export const TrackFileAccessArgsSchema = z.object({
  path: AbsolutePath.describe('Absolute path to the file that was accessed'),
  action: FileAccessActionSchema.describe('Type of file access'),
});

// get_session_context
export const GetSessionContextArgsSchema = z.object({
  session_id: z.string().optional().describe('Optional session ID (defaults to current session)'),
});

// list_recent_sessions
export const ListRecentSessionsArgsSchema = z.object({
  limit: PositiveNumber.optional().default(5).describe('Maximum number of sessions to return'),
  detail: DetailLevelSchema.optional().default('summary').describe('Response detail level'),
  _invoked_by_slash_command: z
    .boolean()
    .optional()
    .describe('Internal flag - set by slash commands only'),
});

// close_session
export const CloseSessionArgsSchema = z.object({
  summary: NonEmptyString.describe('Summary of what was accomplished in this conversation'),
  topic: z.string().optional().describe('Optional topic or title for this session'),
  _invoked_by_slash_command: z
    .boolean()
    .optional()
    .describe('Internal flag - set by slash commands only'),
});

// detect_session_repositories
export const DetectSessionRepositoriesArgsSchema = z.object({}).describe('No arguments required');

/**
 * SEARCH TOOLS (4 tools)
 */

// search_vault
export const SearchVaultArgsSchema = z.object({
  query: NonEmptyString.describe('Search query string'),
  directories: z
    .array(z.string())
    .optional()
    .describe('Directories to search (e.g., ["sessions", "topics"])'),
  max_results: PositiveNumber.optional()
    .default(10)
    .describe('Maximum number of results to return'),
  date_range: DateRangeSchema.describe('Optional date range filter'),
  snippets_only: z
    .boolean()
    .optional()
    .default(true)
    .describe('Return condensed snippets instead of full matches'),
  detail: DetailLevelSchema.optional().default('summary').describe('Response detail level'),
});

// enhanced_search
export const EnhancedSearchArgsSchema = z.object({
  query: NonEmptyString.describe('The search query to understand and expand'),
  context: z.string().optional().describe('Optional additional context to refine the search'),
  current_session_id: z
    .string()
    .optional()
    .describe('Optional session ID to use for contextual search'),
  max_results_per_query: PositiveNumber.optional()
    .default(5)
    .describe('Maximum results per query variation'),
});

// link_to_topic
export const LinkToTopicArgsSchema = z.object({
  topic: NonEmptyString.describe('Topic name to link to'),
});

// toggle_embeddings
export const ToggleEmbeddingsArgsSchema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe('Set to true to enable, false to disable (toggles if omitted)'),
});

/**
 * TOPICS TOOLS (4 tools)
 */

// create_topic_page
export const CreateTopicPageArgsSchema = z.object({
  topic: NonEmptyString.min(3, 'Topic name must be at least 3 characters').describe(
    'Topic name (will be slugified for filename)'
  ),
  content: NonEmptyString.min(10, 'Content must be at least 10 characters').describe(
    'Content for the topic page'
  ),
  auto_analyze: z
    .union([z.boolean(), z.literal('smart')])
    .optional()
    .default(false)
    .describe('Auto-analyze content for tags and metadata'),
});

// update_topic_page
export const UpdateTopicPageArgsSchema = z.object({
  topic: NonEmptyString.describe('Topic name or slug'),
  content: NonEmptyString.describe('Content to add or replace'),
  append: z
    .boolean()
    .optional()
    .default(true)
    .describe('If true, append to existing content; if false, replace'),
});

// archive_topic
export const ArchiveTopicArgsSchema = z.object({
  topic: NonEmptyString.describe('Topic name or slug to archive'),
  reason: z.string().optional().describe('Optional reason for archiving'),
});

// analyze_topic_content
export const AnalyzeTopicContentArgsSchema = z.object({
  content: NonEmptyString.describe('The topic content to analyze'),
  context: z.string().optional().describe('Optional additional context about the topic'),
  topic_name: z.string().optional().describe('Optional topic name for better context'),
});

/**
 * REVIEW TOOLS (3 tools)
 */

// find_stale_topics
export const FindStaleTopicsArgsSchema = z.object({
  age_threshold_days: z
    .number()
    .int()
    .positive()
    .optional()
    .default(365)
    .describe('Number of days since creation or last review to consider a topic stale'),
  include_never_reviewed: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include topics that have never been reviewed'),
});

// review_topic
export const ReviewTopicArgsSchema = z.object({
  topic: NonEmptyString.describe('Topic name or slug to review'),
  analysis_prompt: z
    .string()
    .optional()
    .describe('Optional custom instructions for the review analysis'),
});

// approve_topic_update
export const ApproveTopicUpdateArgsSchema = z.object({
  review_id: NonEmptyString.describe('Review ID from review_topic call'),
  action: ReviewActionSchema.describe('Action to take on the review'),
  modified_content: z
    .string()
    .optional()
    .describe('Optional: edited content if you want to modify the AI suggestion before applying'),
});

/**
 * GIT TOOLS (6 tools)
 */

// create_project_page
export const CreateProjectPageArgsSchema = z.object({
  repo_path: AbsolutePath.describe('Absolute path to the Git repository'),
});

// record_commit
export const RecordCommitArgsSchema = z.object({
  repo_path: AbsolutePath.describe('Absolute path to the Git repository'),
  commit_hash: CommitHash.describe('Git commit hash'),
});

// link_session_to_repository
export const LinkSessionToRepositoryArgsSchema = z.object({
  repo_path: AbsolutePath.describe('Absolute path to the Git repository'),
});

// list_recent_projects
export const ListRecentProjectsArgsSchema = z.object({
  limit: PositiveNumber.optional().default(5).describe('Maximum number of projects to return'),
  detail: DetailLevelSchema.optional().default('summary').describe('Response detail level'),
  _invoked_by_slash_command: z
    .boolean()
    .optional()
    .describe('Internal flag - set by slash commands only'),
});

// migrate_commit_branches
export const MigrateCommitBranchesArgsSchema = z.object({
  project_slug: z
    .string()
    .optional()
    .describe('Optional: Project slug to migrate (e.g., "obsidian-mcp-server")'),
  dry_run: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, shows what would be changed without making changes'),
});

// analyze_commit_impact
export const AnalyzeCommitImpactArgsSchema = z.object({
  repo_path: AbsolutePath.describe('Absolute path to the Git repository'),
  commit_hash: CommitHash.describe('Git commit hash to analyze'),
  include_diff: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include full diff in analysis (default: false, uses stat summary)'),
});

/**
 * DECISIONS TOOLS (2 tools)
 */

// create_decision
export const CreateDecisionArgsSchema = z.object({
  title: NonEmptyString.min(5, 'Decision title must be at least 5 characters').describe(
    'Decision title'
  ),
  content: NonEmptyString.min(20, 'Decision content must be at least 20 characters').describe(
    'Decision content (rationale, alternatives, consequences)'
  ),
  context: z.string().optional().describe('Optional context for the decision'),
  project: z.string().optional().describe('Optional project slug (e.g., "obsidian-mcp-server")'),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set to true to bypass keyword detection warnings'),
});

// extract_decisions_from_session
export const ExtractDecisionsFromSessionArgsSchema = z.object({
  session_id: z
    .string()
    .optional()
    .describe('Optional session ID to analyze (defaults to current session)'),
  content: z
    .string()
    .optional()
    .describe('Optional content to analyze instead of reading from session file'),
});

/**
 * MAINTENANCE TOOLS (2 tools)
 */

// vault_custodian
export const VaultCustodianArgsSchema = z.object({
  files_to_check: z
    .array(AbsolutePath)
    .optional()
    .describe(
      'Optional: Array of absolute file paths to check (checks all vault files if not provided)'
    ),
});

// Note: toggle_embeddings already defined above in SEARCH TOOLS section

/**
 * get_topic_context (listed in search but it's actually a separate tool)
 */
export const GetTopicContextArgsSchema = z.object({
  topic: NonEmptyString.describe('Topic name or slug to retrieve'),
});

/**
 * MEMORY TOOLS (2 tools)
 */

// get_memory_base
export const GetMemoryBaseArgsSchema = z.object({}).describe('No arguments required');

// append_to_memory_base
export const AppendToMemoryBaseArgsSchema = z.object({
  summary: NonEmptyString.describe('Session summary to append'),
  session_topic: z.string().optional().describe('Optional topic/title for the session'),
  max_size_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10240)
    .describe('Maximum file size in bytes (default: 10240)'),
});

/**
 * Validation schemas registry
 * Maps tool names to their Zod schemas
 */
export const ValidationSchemas = {
  // Session tools
  track_file_access: TrackFileAccessArgsSchema,
  get_session_context: GetSessionContextArgsSchema,
  list_recent_sessions: ListRecentSessionsArgsSchema,
  close_session: CloseSessionArgsSchema,
  detect_session_repositories: DetectSessionRepositoriesArgsSchema,

  // Search tools
  search_vault: SearchVaultArgsSchema,
  enhanced_search: EnhancedSearchArgsSchema,
  link_to_topic: LinkToTopicArgsSchema,
  toggle_embeddings: ToggleEmbeddingsArgsSchema,

  // Topics tools
  create_topic_page: CreateTopicPageArgsSchema,
  update_topic_page: UpdateTopicPageArgsSchema,
  archive_topic: ArchiveTopicArgsSchema,
  analyze_topic_content: AnalyzeTopicContentArgsSchema,

  // Review tools
  find_stale_topics: FindStaleTopicsArgsSchema,
  review_topic: ReviewTopicArgsSchema,
  approve_topic_update: ApproveTopicUpdateArgsSchema,

  // Git tools
  create_project_page: CreateProjectPageArgsSchema,
  record_commit: RecordCommitArgsSchema,
  link_session_to_repository: LinkSessionToRepositoryArgsSchema,
  list_recent_projects: ListRecentProjectsArgsSchema,
  migrate_commit_branches: MigrateCommitBranchesArgsSchema,
  analyze_commit_impact: AnalyzeCommitImpactArgsSchema,

  // Decisions tools
  create_decision: CreateDecisionArgsSchema,
  extract_decisions_from_session: ExtractDecisionsFromSessionArgsSchema,

  // Maintenance tools
  vault_custodian: VaultCustodianArgsSchema,

  // Additional search tools
  get_topic_context: GetTopicContextArgsSchema,

  // Memory tools
  get_memory_base: GetMemoryBaseArgsSchema,
  append_to_memory_base: AppendToMemoryBaseArgsSchema,
} as const;

/**
 * Type helper to get the inferred TypeScript type from a schema
 */
export type InferSchemaType<T extends keyof typeof ValidationSchemas> = z.infer<
  (typeof ValidationSchemas)[T]
>;

/**
 * List of all tool names (for validation)
 */
export const TOOL_NAMES = Object.keys(ValidationSchemas) as Array<keyof typeof ValidationSchemas>;
