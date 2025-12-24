/**
 * Global test setup and teardown hooks
 *
 * This file provides centralized cleanup utilities to prevent memory leaks
 * during test execution. The primary issue is IndexedSearch instances caching
 * large inverted indices and document stores that accumulate across test runs.
 */

import { afterEach } from 'vitest';

/**
 * Global cleanup after each test
 *
 * Forces garbage collection opportunities by clearing references.
 * Note: Actual GC is non-deterministic and controlled by V8.
 */
afterEach(() => {
  // Force GC hint (requires node --expose-gc flag to actually work)
  if (global.gc) {
    global.gc();
  }
});

/**
 * Helper to clear IndexedSearch caches
 *
 * Call this in test afterEach hooks when working with search services:
 *
 * @example
 * ```typescript
 * import { clearSearchCaches } from '../../setup.js';
 *
 * afterEach(async () => {
 *   clearSearchCaches(context.indexedSearches);
 *   await cleanupTestVault(vaultPath);
 * });
 * ```
 */
export function clearSearchCaches(indexedSearches?: Map<string, any>): void {
  if (!indexedSearches) return;

  for (const [_, searcher] of indexedSearches) {
    if (searcher && typeof searcher.clearCache === 'function') {
      searcher.clearCache();
    }
  }
}

/**
 * Helper to safely cleanup context objects
 *
 * Clears all Maps and arrays in test contexts to release memory.
 */
export function cleanupContext(context: any): void {
  if (!context) return;

  // Clear Maps (IndexBuilders, IndexedSearches, etc.)
  if (context.indexBuilders instanceof Map) {
    context.indexBuilders.clear();
  }
  if (context.indexedSearches instanceof Map) {
    // Clear caches before clearing the map
    clearSearchCaches(context.indexedSearches);
    context.indexedSearches.clear();
  }

  // Clear arrays
  if (Array.isArray(context.filesAccessed)) {
    context.filesAccessed.length = 0;
  }
  if (Array.isArray(context.topicsCreated)) {
    context.topicsCreated.length = 0;
  }
  if (Array.isArray(context.decisionsCreated)) {
    context.decisionsCreated.length = 0;
  }
  if (Array.isArray(context.projectsCreated)) {
    context.projectsCreated.length = 0;
  }
  if (Array.isArray(context.commitsRecorded)) {
    context.commitsRecorded.length = 0;
  }
}
