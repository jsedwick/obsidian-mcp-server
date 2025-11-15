# Runtime Validation with Zod

This document describes the comprehensive runtime validation system implemented for all 27 MCP tools.

## Overview

All tool inputs are validated using [Zod](https://zod.dev/) schemas before execution. This provides:

- **Type safety at runtime** - catches invalid inputs before they reach tool logic
- **Helpful error messages** - user-friendly validation errors with specific details
- **Consistent validation** - centralized schemas ensure uniform validation across all tools
- **Developer experience** - type inference and IntelliSense support

## Architecture

### Components

1. **Validation Schemas** (`src/validation/schemas.ts`)
   - Zod schemas for all 27 tools
   - Reusable sub-schemas (DetailLevel, FileAccessAction, etc.)
   - Custom validators (absolute paths, commit hashes, etc.)

2. **Validation Utilities** (`src/validation/index.ts`)
   - `validateToolArgs()` - main validation function
   - `safeValidateToolArgs()` - returns Result type instead of throwing
   - `getValidationSchema()` - get schema for a specific tool
   - `validateBatch()` - validate multiple tool calls at once
   - `isValid()` - boolean check without throwing

3. **Integration** (`src/index.ts`)
   - Validation runs before every tool execution
   - Enhanced error handling for validation errors
   - Type-safe tool argument passing

## Usage

### Basic Validation

```typescript
import { validateToolArgs } from './validation/index.js';

// Validate tool arguments
const args = validateToolArgs('search_vault', {
  query: 'test',
  max_results: 10
});
// args is now typed and validated
```

### Safe Validation (No Throws)

```typescript
import { safeValidateToolArgs } from './validation/index.js';

const result = safeValidateToolArgs('create_topic_page', args);
if (result.success) {
  console.log('Valid:', result.data);
} else {
  console.error('Invalid:', result.error.message);
}
```

### Batch Validation

```typescript
import { validateBatch } from './validation/index.js';

const results = validateBatch([
  { toolName: 'search_vault', args: { query: 'test' } },
  { toolName: 'create_topic_page', args: { topic: 'My Topic', content: '...' } }
]);

const allValid = results.every(r => r.success);
```

## Validation Rules

### Common Patterns

#### Required vs Optional Fields

```typescript
// Required field - must be present and non-empty
topic: NonEmptyString

// Optional field - can be omitted
context?: string

// Optional with default
limit?: number (default: 5)
```

#### String Constraints

```typescript
// Non-empty string
query: z.string().min(1, 'Cannot be empty')

// Minimum length
topic: z.string().min(3, 'Must be at least 3 characters')

// Pattern matching
commit_hash: z.string().regex(/^[a-f0-9]{7,40}$/i, 'Invalid commit hash')
```

#### Number Constraints

```typescript
// Positive integer
limit: z.number().int().positive('Must be a positive integer')

// Range
age_threshold_days: z.number().int().min(1).max(3650)
```

#### Enums

```typescript
// Fixed set of values
action: z.enum(['read', 'edit', 'create'])
detail: z.enum(['minimal', 'summary', 'detailed', 'full'])
```

#### Custom Validators

```typescript
// Absolute path validation
path: z.string().min(1).refine(
  (path) => path.startsWith('/') || /^[A-Z]:\\/.test(path),
  { message: 'Path must be absolute' }
)

// Git commit hash (7-40 hex characters)
commit_hash: z.string().regex(/^[a-f0-9]{7,40}$/i)
```

### Tool-Specific Rules

#### Session Tools

- `track_file_access`: Requires absolute path and valid action enum
- `close_session`: Summary must be non-empty string
- `list_recent_sessions`: Limit must be positive, detail must be valid enum

#### Search Tools

- `search_vault`: Query must be non-empty, max_results must be positive
- `enhanced_search`: Query required, context optional
- `link_to_topic`: Topic name must be non-empty

#### Topics Tools

- `create_topic_page`: Topic ≥3 chars, content ≥10 chars
- `update_topic_page`: Both topic and content required
- `archive_topic`: Topic required, reason optional

#### Review Tools

- `find_stale_topics`: age_threshold_days must be positive
- `approve_topic_update`: review_id required, action must be valid enum

#### Git Tools

- `create_project_page`: repo_path must be absolute
- `record_commit`: commit_hash must be 7-40 hex characters
- `analyze_commit_impact`: Both repo_path and commit_hash required

#### Decisions Tools

- `create_decision`: title ≥5 chars, content ≥20 chars
- `extract_decisions_from_session`: All fields optional

#### Maintenance Tools

- `vault_custodian`: files_to_check array must contain absolute paths

## Error Messages

Validation errors provide helpful, user-friendly messages:

### Example: Missing Required Field

```
Invalid arguments for tool "create_topic_page":

  • content: Required

Please check your input and try again.
```

### Example: Wrong Type

```
Invalid arguments for tool "list_recent_sessions":

  • limit: Expected number, received string

Please check your input and try again.
```

### Example: Invalid Enum Value

```
Invalid arguments for tool "track_file_access":

  • action: action must be one of: read, edit, create

Please check your input and try again.
```

### Example: Pattern Violation

```
Invalid arguments for tool "record_commit":

  • commit_hash: Invalid commit hash format (expected 7-40 hexadecimal characters)

Please check your input and try again.
```

## Testing

All 27 tools have comprehensive validation tests covering:

- ✅ Valid inputs
- ✅ Invalid inputs (missing fields, wrong types)
- ✅ Edge cases (empty strings, negative numbers)
- ✅ Enum validation
- ✅ Custom validator logic
- ✅ Error message quality

Run validation tests:

```bash
npm test -- tests/unit/validation/schemas.test.ts
```

## Schema Registry

All schemas are exported from a central registry:

```typescript
export const ValidationSchemas = {
  // Session tools (5)
  track_file_access: TrackFileAccessArgsSchema,
  get_session_context: GetSessionContextArgsSchema,
  list_recent_sessions: ListRecentSessionsArgsSchema,
  close_session: CloseSessionArgsSchema,
  detect_session_repositories: DetectSessionRepositoriesArgsSchema,

  // Search tools (4)
  search_vault: SearchVaultArgsSchema,
  enhanced_search: EnhancedSearchArgsSchema,
  link_to_topic: LinkToTopicArgsSchema,
  toggle_embeddings: ToggleEmbeddingsArgsSchema,

  // Topics tools (4)
  create_topic_page: CreateTopicPageArgsSchema,
  update_topic_page: UpdateTopicPageArgsSchema,
  archive_topic: ArchiveTopicArgsSchema,
  analyze_topic_content: AnalyzeTopicContentArgsSchema,

  // Review tools (3)
  find_stale_topics: FindStaleTopicsArgsSchema,
  review_topic: ReviewTopicArgsSchema,
  approve_topic_update: ApproveTopicUpdateArgsSchema,

  // Git tools (6)
  create_project_page: CreateProjectPageArgsSchema,
  record_commit: RecordCommitArgsSchema,
  link_session_to_repository: LinkSessionToRepositoryArgsSchema,
  list_recent_projects: ListRecentProjectsArgsSchema,
  migrate_commit_branches: MigrateCommitBranchesArgsSchema,
  analyze_commit_impact: AnalyzeCommitImpactArgsSchema,

  // Decisions tools (2)
  create_decision: CreateDecisionArgsSchema,
  extract_decisions_from_session: ExtractDecisionsFromSessionArgsSchema,

  // Maintenance tools (2)
  vault_custodian: VaultCustodianArgsSchema,
  get_topic_context: GetTopicContextArgsSchema,
} as const;
```

## Type Inference

Zod schemas provide automatic TypeScript type inference:

```typescript
import { InferSchemaType } from './validation/index.js';

// Get the TypeScript type for a tool's arguments
type SearchVaultArgs = InferSchemaType<'search_vault'>;

// Equivalent to:
// type SearchVaultArgs = {
//   query: string;
//   directories?: string[];
//   max_results?: number;
//   date_range?: { start?: string; end?: string };
//   snippets_only?: boolean;
//   detail?: 'minimal' | 'summary' | 'detailed' | 'full';
// }
```

## Benefits

### For Users

- **Immediate feedback** - validation errors caught before tool execution
- **Clear error messages** - specific, actionable error descriptions
- **Consistent experience** - all tools validated the same way

### For Developers

- **Type safety** - runtime validation matches TypeScript types
- **Easy maintenance** - centralized schema definitions
- **Test coverage** - comprehensive validation test suite
- **IntelliSense support** - IDE autocomplete for schemas

## Future Enhancements

Potential improvements for the validation system:

1. **Custom Error Formatters** - Tool-specific error message formatting
2. **Async Validators** - Validate file existence, check permissions, etc.
3. **Schema Composition** - Build complex schemas from smaller pieces
4. **Validation Hints** - Suggest corrections for common mistakes
5. **Performance Optimization** - Cache compiled schemas for faster validation
