/**
 * Integration tests for the task lifecycle workflow
 *
 * E2E: Add task → getTasksByDate → completeTask
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { addTask } from '../../src/tools/tasks/addTask.js';
import { getTasksByDate } from '../../src/tools/tasks/getTasksByDate.js';
import { completeTask } from '../../src/tools/tasks/completeTask.js';
import { createTestVault, cleanupTestVault, vaultFileExists } from '../helpers/vault.js';

// Mock the logger to prevent noise
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Task Lifecycle Workflow', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('task-workflow');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should create a task list when adding the first task', async () => {
    const result = await addTask(
      { task: 'Write integration tests', due: 'today', priority: 'high', context: 'work' },
      vaultPath
    );

    // Verify task list was created
    expect(result.content[0].text).toContain('Created');
    expect(await vaultFileExists(vaultPath, 'tasks/work-tasks.md')).toBe(true);

    // Verify file content
    const content = await fs.readFile(path.join(vaultPath, 'tasks/work-tasks.md'), 'utf-8');
    expect(content).toContain('Write integration tests');
    expect(content).toContain('category: task-list');
    expect(content).toContain('@priority:high');
  });

  it('should retrieve tasks by date after adding them', async () => {
    // Add a dated task
    await addTask(
      { task: 'Review pull request', due: 'today', priority: 'high', context: 'work' },
      vaultPath
    );

    // Get tasks for today
    const result = await getTasksByDate({ date: 'today' }, vaultPath);
    const text = result.content[0].text;

    expect(text).toContain('Review pull request');
  });

  it('should add undated tasks to Todo section', async () => {
    await addTask({ task: 'Undated backlog item', context: 'work' }, vaultPath);

    const content = await fs.readFile(path.join(vaultPath, 'tasks/work-tasks.md'), 'utf-8');

    // Undated tasks should be in the Todo section
    const todoIndex = content.indexOf('## Todo');
    const completedIndex = content.indexOf('## Completed');
    const taskIndex = content.indexOf('Undated backlog item');

    expect(taskIndex).toBeGreaterThan(todoIndex);
    expect(taskIndex).toBeLessThan(completedIndex);
  });

  it('should complete a task and move it to Completed section', async () => {
    // Add a task
    await addTask(
      { task: 'Fix critical bug', due: 'today', priority: 'high', context: 'work' },
      vaultPath
    );

    // Complete the task
    const result = await completeTask({ task: 'Fix critical bug' }, vaultPath);
    expect(result.content[0].text).toContain('Completed');

    // Verify task moved to Completed section
    const content = await fs.readFile(path.join(vaultPath, 'tasks/work-tasks.md'), 'utf-8');

    // The completed task should have [x] instead of [ ]
    expect(content).toContain('[x]');

    // The task should be in the Completed section
    const completedIndex = content.indexOf('## Completed');
    const taskIndex = content.indexOf('[x]');
    expect(taskIndex).toBeGreaterThan(completedIndex);
  });

  it('should handle the full add → query → complete lifecycle', async () => {
    // Step 1: Add task
    await addTask(
      { task: 'Deploy to staging', due: 'today', priority: 'medium', context: 'work' },
      vaultPath
    );

    // Step 2: Query and find it
    const queryResult = await getTasksByDate({ date: 'today' }, vaultPath);
    expect(queryResult.content[0].text).toContain('Deploy to staging');

    // Step 3: Complete it
    await completeTask({ task: 'Deploy to staging' }, vaultPath);

    // Step 4: Verify it's no longer in active tasks for today
    const afterComplete = await getTasksByDate({ date: 'today' }, vaultPath);
    // Completed tasks should not show up in incomplete query
    expect(afterComplete.content[0].text).not.toContain('Deploy to staging');
  });
});
