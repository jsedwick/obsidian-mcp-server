/**
 * Unit tests for findStaleTopics tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReviewToolsContext, createTestVault, cleanupTestVault, createTopicFile } from '../../../helpers/index.js';

describe('findStaleTopics', () => {
  let vaultPath: string;
  let context: any;

  beforeEach(async () => {
    vaultPath = await createTestVault('find-stale');
    context = createReviewToolsContext({ vaultPath });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it.skip('should find topics older than threshold', () => {
    // TODO: Implement after reading findStaleTopics source
  });

  it.skip('should exclude recently reviewed topics', () => {
    // TODO: Implement
  });
});
