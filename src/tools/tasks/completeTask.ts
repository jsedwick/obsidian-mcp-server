/**
 * Tool: complete_task
 *
 * Description: Mark a task as complete across any task list.
 * Automatically searches all task lists, marks task complete, and moves to Completed section.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';

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

        // Check if file has category: task-list
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
 * Find and complete task in file
 */
async function completeTaskInFile(
  filePath: string,
  searchTerm: string,
  completionDate: string
): Promise<{ found: boolean; taskText?: string }> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  let found = false;
  let taskText = '';
  let taskIndex = -1;

  // Find the task
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for incomplete task that matches
    if (line.trim().startsWith('- [ ]') && fuzzyMatch(line, searchTerm)) {
      taskIndex = i;
      taskText = line.replace(/^- \[ \]\s*/, '').trim();
      found = true;
      break;
    }
  }

  if (!found) {
    return { found: false };
  }

  // Mark task complete
  const completedLine =
    lines[taskIndex].replace('- [ ]', '- [x]') + ` (completed: ${completionDate})`;

  // Remove from current section
  lines.splice(taskIndex, 1);

  // Find Completed section
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
    // Insert after Completed header
    lines.splice(completedSectionIndex + 1, 0, completedLine);
  }

  // Write back
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');

  return { found: true, taskText };
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
  const completionDate = date || new Date().toISOString().split('T')[0];

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
      return {
        content: [
          {
            type: 'text',
            text: `✅ Task marked complete in ${fileName}\n\nCompleted: ${result.taskText}\nDate: ${completionDate}`,
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
        text: `❌ Task not found: "${task}"\n\nSearched ${taskListFiles.length} active task list(s).`,
      },
    ],
  };
}
