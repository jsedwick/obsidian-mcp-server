/**
 * Tool: complete_task
 *
 * Description: Mark a task as complete across any task list.
 * Searches both ## Tasks and ## Todo sections, marks complete,
 * and moves to ## Completed section with completion date.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface CompleteTaskArgs {
  task: string; // Full or partial task description for fuzzy matching
  date?: string; // Completion date (YYYY-MM-DD format, defaults to today)
}

export interface CompleteTaskResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * Get all task list files from vault
 */
async function getTaskListFiles(vaultPath: string): Promise<string[]> {
  const tasksDir = path.join(vaultPath, 'tasks');

  try {
    const files = await fs.readdir(tasksDir);
    const taskListFiles: string[] = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(tasksDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Check if file has category: task-list and active tag
        const { data } = matter(content);
        if (
          data.category === 'task-list' &&
          Array.isArray(data.tags) &&
          data.tags.includes('active')
        ) {
          taskListFiles.push(filePath);
        }
      }
    }

    return taskListFiles;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return []; // tasks/ directory doesn't exist
    }
    throw error;
  }
}

/**
 * Fuzzy match task description
 */
function fuzzyMatch(taskLine: string, searchTerm: string): boolean {
  const normalizedLine = taskLine.toLowerCase();
  const normalizedSearch = searchTerm.toLowerCase();

  // Exact substring match
  if (normalizedLine.includes(normalizedSearch)) {
    return true;
  }

  // Check if all words in search term appear in line
  const searchWords = normalizedSearch.split(/\s+/);
  return searchWords.every(word => normalizedLine.includes(word));
}

/**
 * Clean task text for display (remove checkbox, metadata, dates)
 */
function cleanTaskText(taskLine: string): string {
  return taskLine
    .replace(/^- \[[xX ]\]\s*/, '') // Remove checkbox
    .replace(/\(due:\s*[^)]+\)/gi, '') // Remove due date
    .replace(/\(completed:\s*[^)]+\)/gi, '') // Remove completed date
    .replace(/@\w+:[^\s@]+/g, '') // Remove metadata
    .trim();
}

/**
 * Find and complete task in file
 */
async function completeTaskInFile(
  filePath: string,
  searchTerm: string,
  completionDate: string
): Promise<{ found: boolean; taskText?: string; hadDueDate?: boolean }> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  let found = false;
  let taskText = '';
  let taskIndex = -1;
  let hadDueDate = false;
  let currentSection: 'tasks' | 'todo' | 'completed' | 'other' = 'other';

  // Find the task in ## Tasks or ## Todo sections
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track which section we're in
    if (line.startsWith('## Tasks')) {
      currentSection = 'tasks';
      continue;
    } else if (line.startsWith('## Todo')) {
      currentSection = 'todo';
      continue;
    } else if (line.startsWith('## Completed')) {
      currentSection = 'completed';
      continue;
    } else if (line.startsWith('## ')) {
      currentSection = 'other';
      continue;
    }

    // Only search in Tasks and Todo sections
    if (currentSection !== 'tasks' && currentSection !== 'todo') continue;

    // Check for incomplete task that matches
    if (line.trim().startsWith('- [ ]') && fuzzyMatch(line, searchTerm)) {
      taskIndex = i;
      taskText = cleanTaskText(line);
      hadDueDate = /\(due:\s*[^)]+\)/i.test(line);
      found = true;
      break;
    }
  }

  if (!found) {
    return { found: false };
  }

  // Get the original line and preserve metadata
  const originalLine = lines[taskIndex];

  // Build completed line: mark complete, remove due date, add completion date
  let completedLine = originalLine
    .replace('- [ ]', '- [x]')
    .replace(/\(due:\s*[^)]+\)/gi, '') // Remove due date
    .trim();

  // Add completion date
  completedLine += ` (completed: ${completionDate})`;

  // Remove from current position
  lines.splice(taskIndex, 1);

  // Find ## Completed section
  let completedSectionIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## Completed')) {
      completedSectionIndex = i;
      break;
    }
  }

  if (completedSectionIndex === -1) {
    // Add Completed section at end
    lines.push('', '## Completed', completedLine);
  } else {
    // Insert after Completed header (and any blank line)
    let insertIndex = completedSectionIndex + 1;
    while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
      insertIndex++;
    }
    lines.splice(insertIndex, 0, completedLine);
  }

  // Write back
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');

  return { found: true, taskText, hadDueDate };
}

/**
 * Complete a task across all task lists
 */
export async function completeTask(
  args: CompleteTaskArgs,
  vaultPath: string
): Promise<CompleteTaskResult> {
  const { task, date } = args;

  // Default completion date to today
  const completionDate = date || getTodayLocal();

  // Get all task list files
  const taskListFiles = await getTaskListFiles(vaultPath);

  if (taskListFiles.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No active task lists found in tasks/ directory.`,
        },
      ],
    };
  }

  // Search through all task lists
  for (const filePath of taskListFiles) {
    const result = await completeTaskInFile(filePath, task, completionDate);

    if (result.found) {
      const fileName = path.basename(filePath);
      const sourceSection = result.hadDueDate ? 'Tasks' : 'Todo';
      return {
        content: [
          {
            type: 'text',
            text: `✅ Completed in ${fileName} (${sourceSection} → Completed)\n\nTask: ${result.taskText}\nDate: ${completionDate}`,
          },
        ],
      };
    }
  }

  // Task not found in any list
  return {
    content: [
      {
        type: 'text',
        text: `❌ Task not found: "${task}"\n\nSearched ${taskListFiles.length} active task list(s) in ## Tasks and ## Todo sections.`,
      },
    ],
  };
}
