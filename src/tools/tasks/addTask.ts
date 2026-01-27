/**
 * Tool: add_task
 *
 * Description: Add a task to appropriate task list with automatic list selection.
 * Automatically creates task list if it doesn't exist.
 *
 * Uses simplified task format:
 * - ## Tasks - items with (due: ...) dates
 * - ## Todo - items without due dates
 * - ## Completed - finished items
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface AddTaskArgs {
  task: string;
  due?: string; // 'today' | 'tomorrow' | 'this-week' | YYYY-MM-DD format | natural language
  priority?: 'high' | 'medium' | 'low';
  project?: string;
  context?: 'work' | 'personal';
  list?: string; // Override auto-selection with specific list name
}

export interface AddTaskResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * Format due date for display
 * Keeps natural language dates as-is, normalizes YYYY-MM-DD
 */
function formatDueDate(dateStr?: string): string | null {
  if (!dateStr) return null;

  // Keep common natural language as-is for readability
  const naturalDates = ['today', 'tomorrow', 'this-week', 'next week', 'end of month'];
  if (naturalDates.includes(dateStr.toLowerCase())) {
    return dateStr.toLowerCase();
  }

  // Day names - keep as-is
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (dayNames.includes(dateStr.toLowerCase())) {
    return dateStr.charAt(0).toUpperCase() + dateStr.slice(1).toLowerCase();
  }

  // YYYY-MM-DD format - keep as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Other formats - keep as-is and let the parser handle it
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

  // Context-specific list
  if (args.context) {
    return `${args.context}-tasks.md`;
  }

  // Default
  return 'tasks.md';
}

/**
 * Create task list template with new simplified structure
 */
function createTaskListTemplate(listName: string, args: AddTaskArgs): string {
  const timestamp = getTodayLocal();
  const title =
    listName
      .replace('.md', '')
      .replace(/-tasks$/, '')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') + ' Tasks';

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

## Tasks

## Todo

## Completed

`;
}

/**
 * Format task line with metadata and optional due date
 */
function formatTask(args: AddTaskArgs): string {
  let taskLine = `- [ ] ${args.task}`;

  // Add due date if provided
  const dueDate = formatDueDate(args.due);
  if (dueDate) {
    taskLine += ` (due: ${dueDate})`;
  }

  // Add metadata
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
async function addTaskToList(filePath: string, args: AddTaskArgs): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const taskLine = formatTask(args);

  // Determine target section based on whether task has a due date
  const targetSection = args.due ? '## Tasks' : '## Todo';

  // Find target section
  let sectionIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(targetSection)) {
      sectionIndex = i;
      break;
    }
  }

  if (sectionIndex === -1) {
    // Section not found, create it before ## Completed
    const completedIndex = lines.findIndex(line => line.startsWith('## Completed'));
    if (completedIndex !== -1) {
      lines.splice(completedIndex, 0, targetSection, taskLine, '');
    } else {
      // No Completed section, add at end
      lines.push('', targetSection, taskLine);
    }
  } else {
    // Find next section header or end of content
    let insertIndex = sectionIndex + 1;

    // Skip blank lines right after section header
    while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
      insertIndex++;
    }

    // Find end of section (next ## header or end of file)
    let endOfSection = insertIndex;
    while (endOfSection < lines.length && !lines[endOfSection].startsWith('## ')) {
      endOfSection++;
    }

    // Insert task at the beginning of the section content (after header and blank lines)
    // If section is empty, insert right after header
    if (insertIndex === endOfSection) {
      lines.splice(sectionIndex + 1, 0, taskLine);
    } else {
      // Insert at the position where content starts
      lines.splice(insertIndex, 0, taskLine);
    }
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
  await addTaskToList(filePath, args);

  // Format response
  const section = args.due ? 'Tasks' : 'Todo';
  const dueInfo = args.due ? ` (due: ${formatDueDate(args.due)})` : '';

  return {
    content: [
      {
        type: 'text',
        text: fileExists
          ? `✅ Added to ${listName} → ${section}${dueInfo}\n\nTask: ${task}`
          : `✅ Created ${listName} and added task → ${section}${dueInfo}\n\nTask: ${task}`,
      },
    ],
  };
}
