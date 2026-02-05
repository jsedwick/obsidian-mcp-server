/**
 * Issues tools exports
 *
 * This module exports persistent issue tracking tools:
 * - issue: Slash command handler for /issue (list, load, create, resolve)
 * - get_persistent_issues: Read-only helper to list active issues
 * - update_persistent_issue: Append investigation entries to issues
 * - migrateIfNeeded: Migration helper for directory-based structure
 */

export { issue } from './issue.js';
export type { IssueArgs, IssueResult, IssueContext } from './issue.js';

export { getPersistentIssues } from './getPersistentIssues.js';
export type {
  GetPersistentIssuesArgs,
  GetPersistentIssuesResult,
  GetPersistentIssuesContext,
  PersistentIssue,
} from './getPersistentIssues.js';

export { updatePersistentIssue } from './updatePersistentIssue.js';
export type {
  UpdatePersistentIssueArgs,
  UpdatePersistentIssueResult,
  UpdatePersistentIssueContext,
} from './updatePersistentIssue.js';

export { migrateIfNeeded, slugify } from './migration.js';
export type { MigrationResult } from './migration.js';
