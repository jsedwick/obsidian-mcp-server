/**
 * Zod validation schemas for all 26 MCP tool inputs
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
// SessionData schema for Phase 2 finalization (must match CloseSessionArgs.session_data)
const SessionDataSchema = z.object({
  phase: z.literal(1).describe('Phase marker - must be 1 for Phase 2 finalization'),
  sessionId: z.string(),
  sessionFile: z.string(),
  sessionContent: z.string(),
  dateStr: z.string(),
  monthDir: z.string(),
  detectedRepoInfo: z
    .object({
      path: z.string(),
      name: z.string(),
      branch: z.string().optional(),
      remote: z.string().optional(),
    })
    .nullable(),
  topicsCreated: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      file: z.string(),
    })
  ),
  decisionsCreated: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      file: z.string(),
    })
  ),
  projectsCreated: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      file: z.string(),
    })
  ),
  filesAccessed: z.array(
    z.object({
      path: z.string(),
      action: z.enum(['read', 'edit', 'create']),
      timestamp: z.string().optional(),
    })
  ),
  filesToCheck: z.array(z.string()),
  repoDetectionMessage: z.string(),
  autoCommitMessage: z.string().optional(),
  handoff: z.string().optional(),
});

export const CloseSessionArgsSchema = z.object({
  summary: NonEmptyString.describe('Summary of what was accomplished in this conversation'),
  topic: z.string().optional().describe('Optional topic or title for this session'),
  handoff: z
    .string()
    .optional()
    .describe(
      'Handoff notes for next session - unfinished business, queued questions, context needed. Verbose encouraged.'
    ),
  _invoked_by_slash_command: z
    .boolean()
    .optional()
    .describe('Internal flag - set by slash commands only'),
  // Phase 2 parameters (Decision 022 - Two-phase close workflow)
  finalize: z
    .boolean()
    .optional()
    .default(false)
    .describe('Phase 2 flag: Set to true to finalize session after documentation updates'),
  session_data: SessionDataSchema.optional().describe(
    'Session state from Phase 1. Required when finalize=true'
  ),
  skip_analysis: z
    .boolean()
    .optional()
    .default(false)
    .describe('Skip commit analysis and go straight to single-phase finalization'),
  // Working directories from Claude Code (fixes repo detection gap)
  working_directories: z
    .array(z.string())
    .optional()
    .describe(
      "Claude Code's working directories. The MCP server's process.cwd() differs from Claude Code's, " +
        'so passing these enables correct repository detection.'
    ),
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
  category: z
    .enum(['topic', 'task-list', 'decision', 'session', 'project', 'commit'])
    .optional()
    .describe('Filter by document category'),
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
  include_archived: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include archived files in search results (default: false)'),
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
  skip_duplicate_check: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Skip automatic duplicate topic detection (use when creating intentionally similar topics)'
    ),
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
    .default(30)
    .describe('Number of days since creation or last review to consider a topic stale'),
  include_never_reviewed: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include topics that have never been reviewed'),
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
 * DECISIONS TOOLS (1 tool)
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
  repo_path: AbsolutePath.optional().describe(
    'Absolute path to Git repository. If provided, auto-generates collision-resistant project slug from remote URL (preferred over project parameter)'
  ),
  project: z
    .string()
    .optional()
    .describe(
      'Optional manual project slug override. Deprecated: prefer repo_path for automatic slug generation'
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set to true to bypass keyword detection warnings'),
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
 * MEMORY TOOLS (4 tools)
 */

// get_memory_base
export const GetMemoryBaseArgsSchema = z.object({}).describe('No arguments required');

// generate_vault_index
export const GenerateVaultIndexArgsSchema = z.object({
  max_files: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe('Maximum number of files to include in index (default: 100)'),
  max_size_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10240)
    .describe('Maximum size of generated index in bytes (default: 10240)'),
  include_tags: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include frontmatter tags in index entries (default: true)'),
  include_description: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include frontmatter description in index entries (default: false)'),
});

// append_to_accumulator
export const AppendToAccumulatorArgsSchema = z.object({
  filename: z
    .string()
    .regex(/^accumulator-.+\.md$/, {
      message: 'Filename must match pattern: accumulator-{name}.md',
    })
    .describe('Accumulator filename (e.g., accumulator-corrections.md)'),
  content: NonEmptyString.describe('Content to append to the accumulator'),
  add_timestamp: z
    .boolean()
    .optional()
    .default(true)
    .describe('Add timestamp to entry (default: true)'),
});

/**
 * TASK TOOLS (3 tools)
 */

// Task status enum
const TaskStatusSchema = z.enum(['incomplete', 'complete', 'all'], {
  errorMap: () => ({ message: 'status must be one of: incomplete, complete, all' }),
});

// Task priority enum
const TaskPrioritySchema = z.enum(['high', 'medium', 'low'], {
  errorMap: () => ({ message: 'priority must be one of: high, medium, low' }),
});

// Task context enum
const TaskContextSchema = z.enum(['work', 'personal'], {
  errorMap: () => ({ message: 'context must be one of: work, personal' }),
});

// get_tasks_by_date
export const GetTasksByDateArgsSchema = z.object({
  date: NonEmptyString.describe(
    'Date to query tasks for (today, tomorrow, this-week, overdue, or YYYY-MM-DD)'
  ),
  status: TaskStatusSchema.optional().describe('Filter by task status (default: incomplete)'),
  project: z.string().optional().describe('Filter tasks by project slug'),
});

// add_task
export const AddTaskArgsSchema = z.object({
  task: NonEmptyString.describe('Task description'),
  due: z
    .string()
    .optional()
    .describe('When task is due (today, tomorrow, this-week, or YYYY-MM-DD)'),
  priority: TaskPrioritySchema.optional().describe('Task priority'),
  project: z.string().optional().describe('Project slug'),
  context: TaskContextSchema.optional().describe('Task context (work or personal)'),
  list: z.string().optional().describe('Override auto-selection with specific list name'),
});

// complete_task
export const CompleteTaskArgsSchema = z.object({
  task: NonEmptyString.describe('Full or partial task description for fuzzy matching'),
  date: z.string().optional().describe('Completion date (YYYY-MM-DD format, defaults to today)'),
});

/**
 * DOCUMENT TOOLS (1 tool)
 */

// Document update strategy enum
const UpdateStrategySchema = z.enum(['append', 'replace', 'section-edit'], {
  errorMap: () => ({
    message: 'strategy must be one of: append, replace, section-edit',
  }),
});

// update_document
export const UpdateDocumentArgsSchema = z.object({
  file_path: AbsolutePath.describe('Absolute path to the document to update'),
  content: NonEmptyString.describe('New content to write or append'),
  strategy: UpdateStrategySchema.optional().describe(
    'Update strategy: append (add to end), replace (full replacement), section-edit (user-reference sections). Default: replace'
  ),
  reason: z
    .string()
    .optional()
    .describe(
      'Why updating (required for topics per Decision 011, optional for others). Used for audit trail in review_history.'
    ),
});

/**
 * MODE TOOLS (2 tools)
 */

// Vault mode enum
const VaultModeSchema = z.enum(['work', 'personal'], {
  errorMap: () => ({ message: 'mode must be one of: work, personal' }),
});

// switch_mode
export const SwitchModeArgsSchema = z.object({
  mode: VaultModeSchema.describe('The vault mode to switch to'),
});

// get_current_mode
export const GetCurrentModeArgsSchema = z.object({}).describe('No arguments required');

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
  toggle_embeddings: ToggleEmbeddingsArgsSchema,

  // Topics tools
  create_topic_page: CreateTopicPageArgsSchema,
  archive_topic: ArchiveTopicArgsSchema,
  analyze_topic_content: AnalyzeTopicContentArgsSchema,

  // Review tools
  find_stale_topics: FindStaleTopicsArgsSchema,

  // Git tools
  create_project_page: CreateProjectPageArgsSchema,
  record_commit: RecordCommitArgsSchema,
  link_session_to_repository: LinkSessionToRepositoryArgsSchema,
  list_recent_projects: ListRecentProjectsArgsSchema,
  analyze_commit_impact: AnalyzeCommitImpactArgsSchema,

  // Decisions tools
  create_decision: CreateDecisionArgsSchema,

  // Maintenance tools
  vault_custodian: VaultCustodianArgsSchema,

  // Additional search tools
  get_topic_context: GetTopicContextArgsSchema,

  // Memory tools
  get_memory_base: GetMemoryBaseArgsSchema,
  generate_vault_index: GenerateVaultIndexArgsSchema,
  append_to_accumulator: AppendToAccumulatorArgsSchema,

  // Task tools
  get_tasks_by_date: GetTasksByDateArgsSchema,
  add_task: AddTaskArgsSchema,
  complete_task: CompleteTaskArgsSchema,

  // Document tools
  update_document: UpdateDocumentArgsSchema,

  // Mode tools
  switch_mode: SwitchModeArgsSchema,
  get_current_mode: GetCurrentModeArgsSchema,
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
