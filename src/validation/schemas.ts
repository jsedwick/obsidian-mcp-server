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
  handoff: z.string(), // Placeholder from Phase 1, replaced by Phase 2 with AI-generated handoff
  // Enforcement fields - CRITICAL: Must be included or Zod strips them (see bug fix 2026-01-05)
  sessionCommits: z.array(z.string()).optional(),
  semanticTopicsPresented: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
      })
    )
    .optional(),
  commitRelatedTopics: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
        relevance: z.string(),
        commitHash: z.string(),
      })
    )
    .optional(),
});

export const CloseSessionArgsSchema = z
  .object({
    summary: NonEmptyString.describe('Summary of what was accomplished in this conversation'),
    topic: z.string().optional().describe('Optional topic or title for this session'),
    handoff: z
      .string()
      .optional()
      .describe(
        'Handoff notes for next session. REQUIRED in Phase 2 (finalize: true) - generate using prompt from Phase 1 (Decision 052).'
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
    // Working directories from Claude Code (fixes repo detection gap)
    working_directories: z
      .array(z.string())
      .optional()
      .describe(
        "Claude Code's working directories. The MCP server's process.cwd() differs from Claude Code's, " +
          'so passing these enables correct repository detection.'
      ),
    // Session start time fallback - if MCP server state was lost mid-session
    session_start_override: z
      .string()
      .optional()
      .describe(
        'ISO 8601 timestamp of session start. Extracted from context (SESSION_START_TIME: ...) ' +
          'as fallback when MCP server state is lost.'
      ),
  })
  .refine(
    data => {
      // Phase 2 requires handoff (Decision 052)
      if (data.finalize === true) {
        return data.handoff !== undefined && data.handoff !== null && data.handoff.trim() !== '';
      }
      return true;
    },
    {
      message:
        'handoff is REQUIRED when finalize: true (Decision 052). Generate using Phase 1 prompt.',
      path: ['handoff'],
    }
  );

// detect_session_repositories
export const DetectSessionRepositoriesArgsSchema = z.object({
  working_directories: z
    .array(z.string())
    .optional()
    .describe(
      "Claude Code's working directories. The MCP server runs as a separate process with a different cwd, " +
        'so passing working directories enables correct Git repository detection.'
    ),
});

// restore_session_data (Decision 054)
export const RestoreSessionDataArgsSchema = z.object({
  // No arguments needed - reads from known vault location
});

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
    .enum(['topic', 'task-list', 'decision', 'session', 'project', 'commit', 'workflow'])
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
 * REVIEW TOOLS (2 tools)
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

// submit_topic_reviews
const TopicReviewAssessmentSchema = z.object({
  topic_slug: NonEmptyString.describe('Topic slug (filename without .md)'),

  // Technical accuracy
  technical_accuracy: z
    .enum(['verified', 'outdated', 'needs_check'])
    .describe('Technical accuracy assessment'),
  technical_accuracy_notes: z.string().optional().describe('Required if outdated or needs_check'),

  // Completeness
  completeness: z
    .enum(['comprehensive', 'needs_expansion', 'adequate'])
    .describe('Completeness assessment'),
  completeness_notes: z.string().optional().describe('Required if needs_expansion'),

  // Organization
  organization: z
    .enum(['excellent', 'needs_improvement', 'poor'])
    .describe('Organization assessment'),
  organization_notes: z.string().optional().describe('Required if needs_improvement or poor'),

  // Redundancy check
  redundancy_check: z
    .enum(['no_duplicates', 'consolidate_with', 'not_checked'])
    .describe('Redundancy/consolidation check'),
  consolidate_with_topic: z.string().optional().describe('Required if consolidate_with'),

  // Final outcome
  outcome: z
    .enum(['current', 'expand', 'reorganize', 'consolidate', 'archive'])
    .describe('Final review outcome'),

  // Issues and updates
  issues_found: z.array(z.string()).describe('Issues discovered during review'),
  updates_needed: z.array(z.string()).describe('Updates needed'),
});

export const SubmitTopicReviewsArgsSchema = z.object({
  reviews: z
    .array(TopicReviewAssessmentSchema)
    .min(1, 'At least one review is required')
    .describe('Structured assessments for each topic'),
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
    'Date to query tasks for (all, today, tomorrow, this-week, overdue, todo, or YYYY-MM-DD)'
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
const UpdateStrategySchema = z.enum(['append', 'replace', 'section-edit', 'edit'], {
  errorMap: () => ({
    message: 'strategy must be one of: append, replace, section-edit, edit',
  }),
});

// update_document
export const UpdateDocumentArgsSchema = z
  .object({
    file_path: AbsolutePath.describe('Absolute path to the document to update'),
    content: NonEmptyString.describe(
      'New content to write or append. For edit strategy: the replacement text (new_string)'
    ),
    strategy: UpdateStrategySchema.optional().describe(
      'Update strategy: append (add to end), replace (full replacement), section-edit (header-based section replacement), edit (search-and-replace like native Edit). Default: replace'
    ),
    reason: z
      .string()
      .optional()
      .describe(
        'Why updating (required for topics per Decision 011, optional for others). Used for Git commit message audit trail.'
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        'If true, allow replacing files with corrupted YAML frontmatter by using frontmatter from new content. Only works with strategy: replace.'
      ),
    old_string: z
      .string()
      .optional()
      .describe('Required for edit strategy: the text to find and replace'),
  })
  .refine(data => !(data.strategy === 'edit' && !data.old_string), {
    message: 'old_string is required when strategy is "edit"',
  });

/**
 * CODE TOOLS (1 tool)
 */

// Code file operation enum
const CodeFileOperationSchema = z.enum(['edit', 'write'], {
  errorMap: () => ({ message: 'operation must be one of: edit, write' }),
});

// code_file
export const CodeFileArgsSchema = z
  .object({
    file_path: AbsolutePath.describe('Absolute path to the code file'),
    operation: CodeFileOperationSchema.describe(
      'Operation type: edit (search-replace) or write (create/overwrite)'
    ),
    content: NonEmptyString.describe(
      'For write: full file content. For edit: replacement text (new_string)'
    ),
    old_string: z.string().optional().describe('Required for edit: text to find and replace'),
  })
  .refine(data => !(data.operation === 'edit' && !data.old_string), {
    message: 'old_string is required when operation is "edit"',
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

export const WorkflowArgsSchema = z.object({
  workflow_name: z
    .string()
    .optional()
    .describe(
      'The name of the workflow to execute (without .md extension). If omitted, lists all available workflows.'
    ),
  _invoked_by_slash_command: z
    .boolean()
    .default(false)
    .describe('Internal parameter - must be true to invoke this tool. Only set by slash commands.'),
});

/**
 * ISSUES TOOLS (3 tools)
 */

// Issue priority enum
const IssuePrioritySchema = z.enum(['high', 'medium', 'low'], {
  errorMap: () => ({ message: 'priority must be one of: high, medium, low' }),
});

// Issue mode enum
const IssueModeSchema = z.enum(['list', 'load', 'create', 'resolve'], {
  errorMap: () => ({ message: 'mode must be one of: list, load, create, resolve' }),
});

// issue - slash command handler
export const IssueArgsSchema = z.object({
  mode: IssueModeSchema.optional().describe(
    'Operation mode: list, load, create, resolve (default: list)'
  ),
  slug: z.string().optional().describe('Issue slug for load/resolve modes'),
  name: z.string().optional().describe('Issue name for create mode (will be slugified)'),
  priority: IssuePrioritySchema.optional()
    .default('medium')
    .describe('Issue priority for create mode'),
  _invoked_by_slash_command: z
    .boolean()
    .optional()
    .describe('Required for resolve mode - ensures human-only resolution'),
});

// get_persistent_issues - read-only helper
export const GetPersistentIssuesArgsSchema = z.object({
  include_archived: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include archived issues (default: false - only shows active)'),
});

// update_persistent_issue - append investigation entries
export const UpdatePersistentIssueArgsSchema = z.object({
  slug: NonEmptyString.describe('Issue slug to update'),
  entry: NonEmptyString.describe('Investigation entry text to append'),
  session_id: z.string().optional().describe('Session ID (auto-detected if not provided)'),
  // NOTE: Intentionally NO status parameter - resolution is human-only via /issue resolve
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
  restore_session_data: RestoreSessionDataArgsSchema,

  // Search tools
  search_vault: SearchVaultArgsSchema,
  toggle_embeddings: ToggleEmbeddingsArgsSchema,

  // Topics tools
  create_topic_page: CreateTopicPageArgsSchema,
  archive_topic: ArchiveTopicArgsSchema,
  analyze_topic_content: AnalyzeTopicContentArgsSchema,

  // Review tools
  find_stale_topics: FindStaleTopicsArgsSchema,
  submit_topic_reviews: SubmitTopicReviewsArgsSchema,

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
  append_to_accumulator: AppendToAccumulatorArgsSchema,

  // Task tools
  get_tasks_by_date: GetTasksByDateArgsSchema,
  add_task: AddTaskArgsSchema,
  complete_task: CompleteTaskArgsSchema,

  // Document tools
  update_document: UpdateDocumentArgsSchema,

  // Code tools
  code_file: CodeFileArgsSchema,

  // Mode tools
  switch_mode: SwitchModeArgsSchema,
  get_current_mode: GetCurrentModeArgsSchema,

  // Workflow tools
  workflow: WorkflowArgsSchema,

  // Issues tools
  issue: IssueArgsSchema,
  get_persistent_issues: GetPersistentIssuesArgsSchema,
  update_persistent_issue: UpdatePersistentIssueArgsSchema,
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
