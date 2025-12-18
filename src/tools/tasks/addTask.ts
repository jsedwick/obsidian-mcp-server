/**
 * Tool: add_task
 *
 * Description: Add a task to appropriate task list with automatic list selection.
 * Automatically creates task list if it doesn't exist (like update_user_reference).
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface AddTaskArgs {
  task: string;
  due?: string; // 'today' | 'tomorrow' | 'this-week' | YYYY-MM-DD format
  priority?: 'high' | 'medium' | 'low';
  project?: string;
  context?: 'work' | 'personal';
  list?: string; // Override auto-selection with specific list name
}

export interface AddTaskResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * Parse date string to YYYY-MM-DD format
 */
function parseDate(dateStr?: string): string | null {
  if (!dateStr) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dateStr === 'today') {
    return today.toISOString().split('T')[0];
  }

  if (dateStr === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  if (dateStr === 'this-week') {
    // For "this week", we'll add to backlog instead of specific date
    return null;
  }

  // Assume YYYY-MM-DD format
  return dateStr;
}

/**
 * Auto-select task list based on arguments
 */
function selectTaskList(args: AddTaskArgs): string {
  // Explicit list override
  if (args.list) {
    return args.list.endsWith('.md') ? args.list : `${args.list}.md`;
  }

  // Project-specific list
  if (args.project) {
    return `${args.project}-tasks.md`;
  }

  // Date-specific list for today's tasks
  if (args.due === 'today') {
    const today = new Date().toISOString().split('T')[0];
    const suffix = args.context ? `-${args.context}-tasks` : '-tasks';
    return `${today}${suffix}.md`;
  }

  // Context-specific list
  if (args.context) {
    return `${args.context}-tasks.md`;
  }

  // Default
  return 'tasks.md';
}

/**
 * Create task list template
 */
function createTaskListTemplate(listName: string, args: AddTaskArgs): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const title = listName
    .replace('.md', '')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const tags = ['tasks'];
  if (args.project) tags.push(args.project);
  if (args.context) tags.push(args.context);
  tags.push('active');

  return `---
title: "${title}"
category: task-list
created: "${timestamp}"
tags: [${tags.join(', ')}]
---

# ${title}

## Due Today (${timestamp})

## Due This Week

## Backlog

## Completed

`;
}

/**
 * Format task line with metadata
 */
function formatTask(args: AddTaskArgs): string {
  let taskLine = `- [ ] ${args.task}`;

  const metadata: string[] = [];
  if (args.project) metadata.push(`@project:${args.project}`);
  if (args.context) metadata.push(`@context:${args.context}`);
  if (args.priority) metadata.push(`@priority:${args.priority}`);

  if (metadata.length > 0) {
    taskLine += ' ' + metadata.join(' ');
  }

  return taskLine;
}

/**
 * Add task to existing task list
 */
async function addTaskToList(
  filePath: string,
  args: AddTaskArgs,
  dueDate: string | null
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const taskLine = formatTask(args);

  // Determine which section to add to
  let targetSection = '## Backlog';
  if (dueDate) {
    if (args.due === 'today' || args.due === dueDate) {
      targetSection = `## Due Today (${dueDate})`;
    } else if (args.due === 'tomorrow' || args.due === 'this-week') {
      targetSection = '## Due This Week';
    }
  }

  // Find target section
  let sectionIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(targetSection)) {
      sectionIndex = i;
      break;
    }
  }

  if (sectionIndex === -1) {
    // Section not found, append at end before Completed section
    const completedIndex = lines.findIndex(line => line.startsWith('## Completed'));
    if (completedIndex !== -1) {
      lines.splice(completedIndex, 0, targetSection, taskLine, '');
    } else {
      lines.push('', targetSection, taskLine);
    }
  } else {
    // Find next section or end of file
    let insertIndex = sectionIndex + 1;
    while (insertIndex < lines.length && !lines[insertIndex].startsWith('## ')) {
      insertIndex++;
    }

    // Insert before next section
    lines.splice(insertIndex, 0, taskLine);
  }

  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Add task to appropriate task list
 */
export async function addTask(args: AddTaskArgs, vaultPath: string): Promise<AddTaskResult> {
  const { task } = args;

  // Select task list
  const listName = selectTaskList(args);
  const tasksDir = path.join(vaultPath, 'tasks');
  const filePath = path.join(tasksDir, listName);

  // Parse due date
  const dueDate = parseDate(args.due);

  // Check if file exists
  let fileExists = false;
  try {
    await fs.access(filePath);
    fileExists = true;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error;
    }
  }

  if (!fileExists) {
    // Create tasks directory if it doesn't exist
    await fs.mkdir(tasksDir, { recursive: true });

    // Create new task list from template
    const template = createTaskListTemplate(listName, args);
    await fs.writeFile(filePath, template, 'utf-8');
  }

  // Add task to list
  await addTaskToList(filePath, args, dueDate);

  // Format response
  const section = dueDate
    ? args.due === 'today'
      ? `Due Today (${dueDate})`
      : args.due === 'tomorrow' || args.due === 'this-week'
        ? 'Due This Week'
        : `Due ${dueDate}`
    : 'Backlog';

  return {
    content: [
      {
        type: 'text',
        text: fileExists
          ? `✅ Added task to ${listName} (${section})\n\nTask: ${task}`
          : `✅ Created ${listName} and added task (${section})\n\nTask: ${task}`,
      },
    ],
  };
}
