import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getTasksByDate } from '../../../../src/tools/tasks/getTasksByDate.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

/**
 * Create a task list file with proper frontmatter for testing
 */
async function createTaskListFile(
  vaultPath: string,
  filename: string,
  body: string
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

${body}`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('getTasksByDate', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('get-tasks');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should return tasks for a specific date', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Task for today (due: 2026-02-16) @priority:high
- [ ] Task for tomorrow (due: 2026-02-17)

## Todo

## Completed
`
    );

    const result = await getTasksByDate({ date: '2026-02-16' }, vaultPath);
    expect(result.content[0].text).toContain('Task for today');
    expect(result.content[0].text).not.toContain('Task for tomorrow');
  });

  it('should return todo items (no due date)', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Dated task (due: 2026-03-01)

## Todo

- [ ] Undated todo item @priority:medium
- [ ] Another todo

## Completed
`
    );

    const result = await getTasksByDate({ date: 'todo' }, vaultPath);
    expect(result.content[0].text).toContain('Undated todo item');
    expect(result.content[0].text).toContain('Another todo');
    expect(result.content[0].text).not.toContain('Dated task');
  });

  it('should return overdue tasks', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Overdue task (due: 2020-01-01) @priority:high
- [ ] Future task (due: 2030-12-31)

## Todo

## Completed
`
    );

    const result = await getTasksByDate({ date: 'overdue' }, vaultPath);
    expect(result.content[0].text).toContain('Overdue task');
    expect(result.content[0].text).not.toContain('Future task');
  });

  it('should filter by project', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Project A task (due: 2026-02-16) @project:alpha
- [ ] Project B task (due: 2026-02-16) @project:beta

## Todo

## Completed
`
    );

    const result = await getTasksByDate({ date: '2026-02-16', project: 'alpha' }, vaultPath);
    expect(result.content[0].text).toContain('Project A task');
    expect(result.content[0].text).not.toContain('Project B task');
  });

  it('should report no active task lists when directory missing', async () => {
    const result = await getTasksByDate({ date: 'today' }, vaultPath);
    expect(result.content[0].text).toContain('No active task lists');
  });

  it('should report no tasks found when none match', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Some task (due: 2030-12-31)

## Todo

## Completed
`
    );

    const result = await getTasksByDate({ date: '2026-02-16' }, vaultPath);
    expect(result.content[0].text).toMatch(/No.*tasks found/i);
  });

  it('should search across multiple task list files', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Work task (due: 2026-02-16)

## Todo

## Completed
`
    );
    await createTaskListFile(
      vaultPath,
      'personal-tasks.md',
      `## Tasks

- [ ] Personal task (due: 2026-02-16)

## Todo

## Completed
`
    );

    const result = await getTasksByDate({ date: '2026-02-16' }, vaultPath);
    expect(result.content[0].text).toContain('Work task');
    expect(result.content[0].text).toContain('Personal task');
    expect(result.content[0].text).toContain('Found 2');
  });

  it('should exclude archived/inactive task lists', async () => {
    // Active list
    await createTaskListFile(
      vaultPath,
      'active-tasks.md',
      `## Tasks

- [ ] Active task (due: 2026-02-16)

## Todo

## Completed
`
    );

    // Archived list - manually create with archived tag
    const tasksDir = path.join(vaultPath, 'tasks');
    await fs.writeFile(
      path.join(tasksDir, 'old-tasks.md'),
      `---
title: "Old Tasks"
category: task-list
created: "2025-01-01"
tags: [tasks, archived]
---

# Old Tasks

## Tasks

- [ ] Old task (due: 2026-02-16)

## Completed
`,
      'utf-8'
    );

    const result = await getTasksByDate({ date: '2026-02-16' }, vaultPath);
    expect(result.content[0].text).toContain('Active task');
    expect(result.content[0].text).not.toContain('Old task');
  });
});
