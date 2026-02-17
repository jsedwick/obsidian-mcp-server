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

  it('should parse "this-week" natural language date', async () => {
    // Mock Date to control "today" for consistent test results
    const mockToday = new Date('2026-02-16T12:00:00Z'); // Monday
    vi.useFakeTimers();
    vi.setSystemTime(mockToday);

    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Task due this week (due: this-week) @priority:medium
- [ ] Task due specific date (due: 2026-02-20) @priority:high
- [ ] Task due next week (due: 2026-02-23)

## Todo

## Completed
`
    );

    // Query for this week (Feb 16-22, 2026 is Mon-Sun)
    const result = await getTasksByDate({ date: 'this-week' }, vaultPath);

    // Should find both "this-week" task (converts to Friday 2026-02-20) and explicit 2026-02-20
    expect(result.content[0].text).toContain('Task due this week');
    expect(result.content[0].text).toContain('Task due specific date');
    expect(result.content[0].text).not.toContain('Task due next week');
    expect(result.content[0].text).toContain('Found 2');

    vi.useRealTimers();
  });

  it('should return all tasks grouped by urgency with date: "all"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z')); // Monday

    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Overdue task (due: 2026-01-31) @priority:high
- [ ] Due today task (due: 2026-02-16) @priority:medium
- [ ] Due this week task (due: this-week) @priority:medium
- [ ] Due later task (due: 2026-06-01) @priority:low
- [ ] Ambiguous date task (due: somethng weird) @priority:low

## Todo

- [ ] Undated todo item @priority:medium

## Completed
`
    );

    const result = await getTasksByDate({ date: 'all' }, vaultPath);
    const text = result.content[0].text;

    // Should contain all tasks
    expect(text).toContain('Found 6');

    // Should have urgency group headers
    expect(text).toContain('Overdue');
    expect(text).toContain('Due Today');
    expect(text).toContain('Due This Week');
    expect(text).toContain('Due Later');
    expect(text).toContain('Ambiguous Date');
    expect(text).toContain('Todo (no date)');

    // Tasks should appear under correct groups
    expect(text).toContain('Overdue task');
    expect(text).toContain('Due today task');
    expect(text).toContain('Due this week task');
    expect(text).toContain('Due later task');
    expect(text).toContain('Ambiguous date task');
    expect(text).toContain('Undated todo item');

    // Ambiguous should have warning
    expect(text).toContain('⚠️ unrecognized date format');

    vi.useRealTimers();
  });

  it('should omit empty groups in "all" mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Overdue task (due: 2020-01-01) @priority:high

## Todo

## Completed
`
    );

    const result = await getTasksByDate({ date: 'all' }, vaultPath);
    const text = result.content[0].text;

    expect(text).toContain('Overdue');
    expect(text).not.toContain('Due Today');
    expect(text).not.toContain('Due This Week');
    expect(text).not.toContain('Due Later');
    expect(text).not.toContain('Ambiguous');
    expect(text).not.toContain('Todo');

    vi.useRealTimers();
  });

  it('should filter by project in "all" mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Alpha overdue (due: 2020-01-01) @project:alpha
- [ ] Beta overdue (due: 2020-01-01) @project:beta

## Todo

- [ ] Alpha todo @project:alpha

## Completed
`
    );

    const result = await getTasksByDate({ date: 'all', project: 'alpha' }, vaultPath);
    const text = result.content[0].text;

    expect(text).toContain('Alpha overdue');
    expect(text).toContain('Alpha todo');
    expect(text).not.toContain('Beta overdue');
    expect(text).toContain('Found 2');

    vi.useRealTimers();
  });

  it('should include tasks with unparseable dates and show warning', async () => {
    await createTaskListFile(
      vaultPath,
      'work-tasks.md',
      `## Tasks

- [ ] Future task (due: 2027-12-31) @priority:high
- [ ] Task with typo (due: thsi-week) @priority:medium
- [ ] Task with invalid format (due: some random text) @priority:low

## Todo

## Completed
`
    );

    // Query for this-week should include unparseable dates (with warnings)
    const result = await getTasksByDate({ date: 'this-week' }, vaultPath);
    expect(result.content[0].text).toContain('Task with typo');
    expect(result.content[0].text).toContain('Task with invalid format');
    expect(result.content[0].text).toContain('⚠️ unrecognized date format');
    expect(result.content[0].text).not.toContain('Future task'); // Outside this week
    expect(result.content[0].text).toContain('Found 2'); // Only unparseable ones

    // Query for specific date should also include unparseable dates
    const result2 = await getTasksByDate({ date: '2026-02-16' }, vaultPath);
    expect(result2.content[0].text).toContain('Task with typo');
    expect(result2.content[0].text).toContain('Task with invalid format');
    expect(result2.content[0].text).toContain('⚠️ unrecognized date format');
    expect(result2.content[0].text).not.toContain('Future task'); // Wrong date
    expect(result2.content[0].text).toContain('Found 2');
  });
});
