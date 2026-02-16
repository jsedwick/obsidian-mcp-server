import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { addTask } from '../../../../src/tools/tasks/addTask.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('addTask', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('add-task');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('task list auto-selection', () => {
    it('should use project-specific list when project is provided', async () => {
      await addTask({ task: 'Fix bug', project: 'my-project' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'my-project-tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Fix bug');
      expect(content).toContain('@project:my-project');
    });

    it('should use context-specific list when context is provided', async () => {
      await addTask({ task: 'Review PR', context: 'work' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'work-tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Review PR');
    });

    it('should use explicit list override', async () => {
      await addTask({ task: 'Custom task', list: 'custom-list' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'custom-list.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Custom task');
    });

    it('should default to tasks.md when no selection criteria', async () => {
      await addTask({ task: 'Default task' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Default task');
    });
  });

  describe('task list creation', () => {
    it('should create task list if missing', async () => {
      const result = await addTask({ task: 'New task' }, vaultPath);

      expect(result.content[0].text).toContain('Created');
      const filePath = path.join(vaultPath, 'tasks', 'tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('category: task-list');
      expect(content).toContain('## Tasks');
      expect(content).toContain('## Todo');
      expect(content).toContain('## Completed');
    });

    it('should add to existing task list', async () => {
      // Create task list first
      await addTask({ task: 'First task' }, vaultPath);
      const result = await addTask({ task: 'Second task' }, vaultPath);

      expect(result.content[0].text).toContain('Added to');
      const filePath = path.join(vaultPath, 'tasks', 'tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('First task');
      expect(content).toContain('Second task');
    });
  });

  describe('section targeting', () => {
    it('should add tasks with due dates to Tasks section', async () => {
      await addTask({ task: 'Due task', due: '2026-03-01' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('- [ ] Due task (due: 2026-03-01)');
    });

    it('should add tasks without due dates to Todo section', async () => {
      await addTask({ task: 'Todo item' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      // The task should appear after ## Todo
      const todoIndex = content.indexOf('## Todo');
      const taskIndex = content.indexOf('- [ ] Todo item');
      const completedIndex = content.indexOf('## Completed');
      expect(taskIndex).toBeGreaterThan(todoIndex);
      expect(taskIndex).toBeLessThan(completedIndex);
    });
  });

  describe('task formatting', () => {
    it('should format due date for natural language dates', async () => {
      await addTask({ task: 'Today task', due: 'today' }, vaultPath);

      const filePath = path.join(vaultPath, 'tasks', 'tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('(due: today)');
    });

    it('should include metadata tags', async () => {
      await addTask(
        { task: 'Tagged task', project: 'myproj', priority: 'high', context: 'work' },
        vaultPath
      );

      const filePath = path.join(vaultPath, 'tasks', 'myproj-tasks.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('@project:myproj');
      expect(content).toContain('@priority:high');
      expect(content).toContain('@context:work');
    });
  });
});
