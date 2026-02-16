/**
 * Integration tests for the topic lifecycle workflow
 *
 * E2E: Create topic → read & verify → update with edit strategy → archive
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { createTopicPage } from '../../src/tools/topics/createTopicPage.js';
import { archiveTopic } from '../../src/tools/topics/archiveTopic.js';
import { updateDocument } from '../../src/tools/document/updateDocument.js';
import {
  createTopicsToolsContext,
  createDocumentToolsContext,
  createTestVault,
  cleanupTestVault,
  readVaultFile,
  vaultFileExists,
  type TopicsToolsContext,
  type DocumentToolsContext,
} from '../helpers/index.js';

// Mock the logger to prevent noise
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Topic Lifecycle Workflow', () => {
  let vaultPath: string;
  let topicsContext: TopicsToolsContext;
  let documentContext: DocumentToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('topic-workflow');
    topicsContext = createTopicsToolsContext({
      vaultPath,
      currentSessionId: 'test-session-2026-02-16',
    });
    documentContext = createDocumentToolsContext({
      vaultPath,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should create a topic with proper file structure', async () => {
    const result = await createTopicPage(
      {
        topic: 'Test Feature',
        content: 'Original content about feature X.',
      },
      topicsContext
    );

    // Verify creation result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain('test-feature');

    // Verify file exists at expected path
    const exists = await vaultFileExists(vaultPath, 'topics/test-feature.md');
    expect(exists).toBe(true);

    // Verify file content structure
    const content = await readVaultFile(vaultPath, 'topics/test-feature.md');
    expect(content).toContain('---'); // Has frontmatter
    expect(content).toContain('Test Feature');
    expect(content).toContain('Original content about feature X.');
  });

  it('should update a topic using edit strategy', async () => {
    // Step 1: Create the topic
    await createTopicPage(
      {
        topic: 'Editable Topic',
        content: 'Original content here.',
      },
      topicsContext
    );

    const topicPath = path.join(vaultPath, 'topics/editable-topic.md');

    // Step 2: Update using edit strategy
    const updateResult = await updateDocument(
      {
        file_path: topicPath,
        strategy: 'edit',
        old_string: 'Original content here.',
        content: 'Updated content with new details.',
        reason: 'Integration test update',
      },
      documentContext
    );

    expect(updateResult.content[0].text).toContain('updated');

    // Step 3: Verify content changed
    const updatedContent = await readVaultFile(vaultPath, 'topics/editable-topic.md');
    expect(updatedContent).toContain('Updated content with new details.');
    expect(updatedContent).not.toContain('Original content here.');
  });

  it('should archive a topic moving it to archive/topics/', async () => {
    // Step 1: Create the topic
    await createTopicPage(
      {
        topic: 'Archivable Topic',
        content: 'Content to be archived.',
      },
      topicsContext
    );

    // Verify topic exists
    expect(await vaultFileExists(vaultPath, 'topics/archivable-topic.md')).toBe(true);

    // Step 2: Archive the topic
    const archiveResult = await archiveTopic(
      { topic: 'Archivable Topic', reason: 'test cleanup' },
      topicsContext
    );

    expect(archiveResult.content[0].text).toContain('archived');

    // Step 3: Verify moved to archive
    expect(await vaultFileExists(vaultPath, 'topics/archivable-topic.md')).toBe(false);
    expect(await vaultFileExists(vaultPath, 'archive/topics/archivable-topic.md')).toBe(true);

    // Step 4: Verify content preserved
    const archivedContent = await readVaultFile(vaultPath, 'archive/topics/archivable-topic.md');
    expect(archivedContent).toContain('Content to be archived.');
  });

  it('should handle full create → update → archive lifecycle', async () => {
    // Create
    await createTopicPage(
      {
        topic: 'Lifecycle Topic',
        content: 'Initial lifecycle content.',
      },
      topicsContext
    );

    const topicPath = path.join(vaultPath, 'topics/lifecycle-topic.md');

    // Update
    await updateDocument(
      {
        file_path: topicPath,
        strategy: 'edit',
        old_string: 'Initial lifecycle content.',
        content: 'Modified lifecycle content.',
        reason: 'lifecycle test',
      },
      documentContext
    );

    // Verify update
    const updated = await readVaultFile(vaultPath, 'topics/lifecycle-topic.md');
    expect(updated).toContain('Modified lifecycle content.');

    // Archive
    await archiveTopic({ topic: 'Lifecycle Topic', reason: 'lifecycle complete' }, topicsContext);

    // Verify final state
    expect(await vaultFileExists(vaultPath, 'topics/lifecycle-topic.md')).toBe(false);
    const archived = await readVaultFile(vaultPath, 'archive/topics/lifecycle-topic.md');
    expect(archived).toContain('Modified lifecycle content.');
  });

  it('should update topic frontmatter last_reviewed on edit', async () => {
    // Create the topic
    await createTopicPage(
      {
        topic: 'Reviewed Topic',
        content: 'Content for review tracking.',
      },
      topicsContext
    );

    const topicPath = path.join(vaultPath, 'topics/reviewed-topic.md');

    // Update using edit strategy (triggers last_reviewed update for topics)
    await updateDocument(
      {
        file_path: topicPath,
        strategy: 'edit',
        old_string: 'Content for review tracking.',
        content: 'Updated content for review tracking.',
        reason: 'review test',
      },
      documentContext
    );

    // Verify frontmatter was updated
    const content = await readVaultFile(vaultPath, 'topics/reviewed-topic.md');
    expect(content).toContain('last_reviewed');
  });
});
