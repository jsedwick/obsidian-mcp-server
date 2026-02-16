import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { completeTask } from '../../../../src/tools/tasks/completeTask.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

/**
 * Create a task list file with proper frontmatter for testing
 */
async function createTaskListFile(
  vaultPath: string,
  filename: string,
  tasks: string
): Promise<string> {
  const tasksDir = path.join(vaultPath, 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });
  const filePath = path.join(tasksDir, filename);
  const content = `---
title: "Test Tasks"
category: task-list
created: "2026-01-01"
tags: [tasks, active]
---

# Test Tasks

## Tasks

${tasks}

## Todo

## Completed

`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('completeTask', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('complete-task');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should complete a task by exact substring match', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      '- [ ] Fix authentication bug (due: 2026-02-15) @priority:high'
    );

    const result = await completeTask({ task: 'Fix authentication bug' }, vaultPath);

    expect(result.content[0].text).toContain('Completed');
    expect(result.content[0].text).toContain('Fix authentication bug');

    const content = await fs.readFile(path.join(vaultPath, 'tasks', 'work-tasks.md'), 'utf-8');
    // Should be marked complete and moved to Completed section
    expect(content).toContain('- [x]');
    expect(content).toContain('(completed:');
    // Due date should be removed
    expect(content).not.toMatch(/\(due:.*\).*\[x\]/);
  });

  it('should complete a task by fuzzy word match', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      '- [ ] Implement Secure Runtime Access on webapps (due: 2026-03-01)'
    );

    const result = await completeTask({ task: 'Secure Runtime' }, vaultPath);

    expect(result.content[0].text).toContain('Completed');
  });

  it('should move completed task to Completed section', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      '- [ ] Deploy to production (due: 2026-02-20)'
    );

    await completeTask({ task: 'Deploy to production' }, vaultPath);

    const content = await fs.readFile(path.join(vaultPath, 'tasks', 'work-tasks.md'), 'utf-8');
    const completedSectionIndex = content.indexOf('## Completed');
    const taskIndex = content.indexOf('- [x]');
    expect(taskIndex).toBeGreaterThan(completedSectionIndex);
  });

  it('should use custom completion date', async () => {
    await createTaskListFile(vaultPath, 'work-tasks.md', '- [ ] Review docs (due: 2026-02-15)');

    await completeTask({ task: 'Review docs', date: '2026-02-16' }, vaultPath);

    const content = await fs.readFile(path.join(vaultPath, 'tasks', 'work-tasks.md'), 'utf-8');
    expect(content).toContain('(completed: 2026-02-16)');
  });

  it('should report not found when task does not match', async () => {
    await createTaskListFile(vaultPath, 'work-tasks.md', '- [ ] Existing task (due: 2026-03-01)');

    const result = await completeTask({ task: 'nonexistent task' }, vaultPath);
    expect(result.content[0].text).toContain('not found');
  });

  it('should report no active task lists when directory is empty', async () => {
    const result = await completeTask({ task: 'anything' }, vaultPath);
    expect(result.content[0].text).toContain('No active task lists');
  });

  it('should search across multiple task list files', async () => {
    await createTaskListFile(vaultPath, 'work-tasks.md', '- [ ] Work task (due: 2026-03-01)');
    await createTaskListFile(
      vaultPath,
      'personal-tasks.md',
      '- [ ] Personal task (due: 2026-03-01)'
    );

    const result = await completeTask({ task: 'Personal task' }, vaultPath);
    expect(result.content[0].text).toContain('Completed');
    expect(result.content[0].text).toContain('personal-tasks.md');
  });
});
