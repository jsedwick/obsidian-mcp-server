/**
 * Decision Tools
 *
 * Tools for creating and managing Architectural Decision Records (ADRs).
 *
 * Related: [[decisions/vault/008-hardcoded-templates-in-typescript-vs-user-configurable-templates]]
 */

export { createDecision } from './createDecision.js';
export type {
  CreateDecisionArgs,
  CreateDecisionResult,
  CreateDecisionContext,
} from './createDecision.js';

export { migrateDecisionSlugs } from './migrateDecisionSlugs.js';
export type {
  MigrateDecisionSlugsArgs,
  MigrateDecisionSlugsResult,
} from './migrateDecisionSlugs.js';
