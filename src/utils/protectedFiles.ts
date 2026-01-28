/**
 * Protected File Patterns
 *
 * This module defines file patterns that should be protected from accidental
 * modification. These files are critical to system operation and should only
 * be modified through dedicated tools.
 *
 * Inspired by duckdb-kb's protected entry pattern to prevent accidental overwrites
 * of critical configuration and accumulator files.
 */

import path from 'path';

/**
 * File patterns that are protected from general modification.
 * These should only be modified through dedicated tools.
 */
export const PROTECTED_FILE_PATTERNS = [
  'user-reference.md', // User identity and configuration - use update_user_reference tool
  /^accumulator-.+\.md$/, // Accumulators - use append_to_accumulator tool
] as const;

/**
 * Check if a file path matches any protected pattern
 */
export function isProtectedFile(filePath: string): boolean {
  const fileName = path.basename(filePath);

  for (const pattern of PROTECTED_FILE_PATTERNS) {
    if (typeof pattern === 'string') {
      if (fileName === pattern) {
        return true;
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(fileName)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the reason why a file is protected (for error messages)
 */
export function getProtectionReason(filePath: string): string | null {
  const fileName = path.basename(filePath);

  if (fileName === 'user-reference.md') {
    return 'user-reference.md is protected. Use the update_user_reference tool to modify this file.';
  }

  if (/^accumulator-.+\.md$/.test(fileName)) {
    return `${fileName} is a protected accumulator file. Use the append_to_accumulator tool to add content to accumulators.`;
  }

  return null;
}

/**
 * Validate that a file operation is allowed on the given path.
 * Throws an error if the file is protected.
 */
export function validateFileOperation(filePath: string, operation: string): void {
  if (isProtectedFile(filePath)) {
    const reason = getProtectionReason(filePath);
    throw new Error(
      `❌ Protected File: Cannot ${operation} ${path.basename(filePath)}\n\n${reason}\n\n` +
        'This protection prevents accidental data loss on critical files.'
    );
  }
}
