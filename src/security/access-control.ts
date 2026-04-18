/**
 * Layer 6: Access Control
 *
 * Centralized path validation with symlink resolution.
 * Enforces vault boundaries and deny lists for all path-bearing tool arguments.
 */

import fssync from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { SecurityError } from '../utils/errors.js';
import type { AccessControlConfig, SecurityContext } from './types.js';

const logger = createLogger('Security:AccessControl');

export const DEFAULT_ACCESS_CONTROL_CONFIG: AccessControlConfig = {
  resolveSymlinks: true,
  allowedPaths: [],
  deniedPaths: [],
  deniedPatterns: ['**/.env', '**/.env.*', '**/.git/config', '**/credentials*'],
};

/**
 * Map of tool name → arg fields that contain file/directory paths.
 * Tools not listed here pass through without path checks
 * (they operate on configured vaults internally).
 */
const PATH_FIELDS: Record<string, string[]> = {
  track_file_access: ['path'],
  update_document: ['file_path'],
  code_file: ['file_path'],
  record_commit: ['repo_path'],
  link_session_to_repository: ['repo_path'],
  analyze_commit_impact: ['repo_path'],
  create_project_page: ['repo_path'],
  create_decision: ['repo_path'],
  vault_custodian: ['files_to_check'],
  close_session: ['working_directories', 'detected_repo_override'],
  detect_session_repositories: ['working_directories'],
};

/**
 * Tools that intentionally operate outside vault boundaries.
 * These get the broader allowlist (vault paths + allowedPaths).
 */
const EXTERNAL_TOOLS = new Set([
  'code_file',
  'record_commit',
  'link_session_to_repository',
  'analyze_commit_impact',
  'create_project_page',
  'create_decision',
  'close_session',
  'detect_session_repositories',
]);

/**
 * Validate access for all path fields in a tool call.
 * Throws SecurityError if any path violates access rules.
 */
export function validateAccess(ctx: SecurityContext, config: AccessControlConfig): void {
  const fields = PATH_FIELDS[ctx.toolName];
  if (!fields) return; // Tool doesn't use file paths

  for (const fieldName of fields) {
    const rawValue = ctx.args[fieldName];

    // Collect paths to check — handle both single strings and arrays of strings
    const pathsToCheck: string[] = [];
    if (typeof rawValue === 'string') {
      pathsToCheck.push(rawValue);
    } else if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (typeof item === 'string') pathsToCheck.push(item);
      }
    } else {
      continue;
    }

    // Build allowed roots based on tool type
    const allowedRoots = EXTERNAL_TOOLS.has(ctx.toolName)
      ? [...ctx.vaultPaths, ...config.allowedPaths]
      : [...ctx.vaultPaths];

    for (const rawPath of pathsToCheck) {
      const resolvedPath = resolvePath(rawPath, config.resolveSymlinks);

      // Check denied paths first (deny takes precedence)
      if (isDenied(resolvedPath, config.deniedPaths, config.deniedPatterns)) {
        logger.warn('Access denied by deny list', {
          tool: ctx.toolName,
          field: fieldName,
          path: rawPath,
          resolvedPath,
        });
        throw new SecurityError(`Access denied: path "${rawPath}" matches deny list`, {
          tool: ctx.toolName,
          field: fieldName,
          path: rawPath,
        });
      }

      // Check if path falls within any allowed root
      if (!isUnderAllowedRoot(resolvedPath, allowedRoots)) {
        logger.warn('Access denied: path outside allowed roots', {
          tool: ctx.toolName,
          field: fieldName,
          path: rawPath,
          resolvedPath,
          allowedRoots,
        });
        throw new SecurityError(`Access denied: path "${rawPath}" is outside allowed boundaries`, {
          tool: ctx.toolName,
          field: fieldName,
          path: rawPath,
        });
      }
    }
  }
}

/**
 * Resolve a path, optionally following symlinks.
 * Falls back gracefully for paths that don't exist yet.
 */
export function resolvePath(filePath: string, resolveSymlinks: boolean): string {
  if (!resolveSymlinks) {
    return path.resolve(filePath);
  }

  try {
    // Try full realpath first
    return fssync.realpathSync(filePath);
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'ENOENT') {
      // File doesn't exist yet — resolve parent and append filename
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      try {
        return path.join(fssync.realpathSync(dir), base);
      } catch {
        // Parent doesn't exist either — fall back to path.resolve
        return path.resolve(filePath);
      }
    }
    return path.resolve(filePath);
  }
}

/**
 * Check if a resolved path falls under any allowed root.
 */
function isUnderAllowedRoot(resolvedPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(root => {
    const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
    return resolvedPath === root || resolvedPath.startsWith(normalizedRoot);
  });
}

/**
 * Check if a path matches any deny rule.
 */
function isDenied(resolvedPath: string, deniedPaths: string[], deniedPatterns: string[]): boolean {
  // Check exact denied paths
  for (const denied of deniedPaths) {
    const resolvedDenied = path.resolve(denied);
    if (resolvedPath === resolvedDenied || resolvedPath.startsWith(resolvedDenied + path.sep)) {
      return true;
    }
  }

  // Check denied patterns (simple glob matching)
  const basename = path.basename(resolvedPath);
  for (const pattern of deniedPatterns) {
    if (matchesGlobPattern(resolvedPath, basename, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Simple glob pattern matching for deny patterns.
 * Supports: **\/filename, *.ext, exact matches
 */
function matchesGlobPattern(fullPath: string, basename: string, pattern: string): boolean {
  // Pattern like "**/.env" or "**/.git/config" — match anywhere in path
  if (pattern.startsWith('**/')) {
    const target = pattern.slice(3);
    // Multi-segment target (e.g., ".git/config") — check if path contains this segment
    if (target.includes('/')) {
      return fullPath.includes(path.sep + target) || fullPath.endsWith(target);
    }
    // Single segment with wildcards
    if (target.includes('*')) {
      return matchWildcard(basename, target);
    }
    return basename === target;
  }

  // Pattern like "*.ext" — match against basename
  if (pattern.includes('*')) {
    return matchWildcard(basename, pattern);
  }

  // Exact match
  return basename === pattern || fullPath.endsWith(path.sep + pattern);
}

/**
 * Simple wildcard matching (supports * only).
 */
function matchWildcard(str: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(str);
}
