/**
 * Tool: get_tasks_by_date
 *
 * Description: Query and aggregate tasks across all task lists by date.
 * Automatically reads all task list files and aggregates tasks due on specified date.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';

export interface GetTasksByDateArgs {
  date: string; // 'today' | 'tomorrow' | 'this-week' | 'overdue' | YYYY-MM-DD format
  status?: 'incomplete' | 'complete' | 'all';
  project?: string; // Optional filter by project
}

export interface TaskResult {
  task: string;
  source: string; // File path
  priority?: string;
  project?: string;
  context?: string;
  status: 'complete' | 'incomplete';
  metadata: Record<string, string>; // All @key:value metadata
}

export interface GetTasksByDateResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * Parse date string to YYYY-MM-DD format
 */
function parseDate(dateStr: string): string {
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
    // Return date range for this week (for now, just return today as placeholder)
    return today.toISOString().split('T')[0];
  }

  // Assume YYYY-MM-DD format
  return dateStr;
}

/**
 * Extract metadata from task string
 * Example: "Task description @project:foo @priority:high @context:work"
 */
function extractMetadata(taskText: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const metadataRegex = /@(\w+):([^\s@]+)/g;
  let match;

  while ((match = metadataRegex.exec(taskText)) !== null) {
    metadata[match[1]] = match[2];
  }

  return metadata;
}

/**
 * Parse task list file and extract tasks for specified date
 */
async function parseTaskListFile(
  filePath: string,
  targetDate: string,
  statusFilter: 'incomplete' | 'complete' | 'all'
): Promise<TaskResult[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const tasks: TaskResult[] = [];

  // Split into lines
  const lines = content.split('\n');

  // Find "Due Today (YYYY-MM-DD)" section
  const dueTodayRegex = new RegExp(`## Due Today \\(${targetDate.replace(/-/g, '\\-')}\\)`, 'i');
  let inTargetSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we've entered the target date section
    if (dueTodayRegex.test(line)) {
      inTargetSection = true;
      continue;
    }

    // Check if we've entered a different section
    if (line.startsWith('## ') && inTargetSection) {
      // We've left the target section
      inTargetSection = false;
      continue;
    }

    // Parse task line
    if (inTargetSection && line.trim().startsWith('- [')) {
      const isComplete = line.includes('[x]') || line.includes('[X]');
      const status: 'complete' | 'incomplete' = isComplete ? 'complete' : 'incomplete';

      // Apply status filter
      if (statusFilter !== 'all' && status !== statusFilter) {
        continue;
      }

      // Extract task text (remove checkbox and completion date)
      let taskText = line
        .replace(/^- \[[xX ]\]\s*/, '')
        .replace(/\(completed: \d{4}-\d{2}-\d{2}\)/, '')
        .trim();

      // Extract metadata
      const metadata = extractMetadata(taskText);

      // Remove metadata from task text for cleaner display
      taskText = taskText.replace(/@\w+:[^\s@]+/g, '').trim();

      tasks.push({
        task: taskText,
        source: filePath,
        priority: metadata.priority,
        project: metadata.project,
        context: metadata.context,
        status,
        metadata,
      });
    }
  }

  return tasks;
}

/**
 * Parse task list file and extract overdue tasks (all dates before today)
 */
async function parseOverdueTasksFromFile(
  filePath: string,
  statusFilter: 'incomplete' | 'complete' | 'all'
): Promise<TaskResult[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const tasks: TaskResult[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // Split into lines
  const lines = content.split('\n');

  // Find all "Due Today (YYYY-MM-DD)" sections
  const dueTodayRegex = /## Due Today \((\d{4}-\d{2}-\d{2})\)/i;
  let currentDate: string | null = null;
  let inDateSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we've entered a date section
    const match = dueTodayRegex.exec(line);
    if (match) {
      currentDate = match[1];
      // Check if this date is before today
      inDateSection = currentDate < todayStr;
      continue;
    }

    // Check if we've entered a different section
    if (line.startsWith('## ') && inDateSection) {
      // We've left the date section
      inDateSection = false;
      currentDate = null;
      continue;
    }

    // Parse task line from overdue sections
    if (inDateSection && currentDate && line.trim().startsWith('- [')) {
      const isComplete = line.includes('[x]') || line.includes('[X]');
      const status: 'complete' | 'incomplete' = isComplete ? 'complete' : 'incomplete';

      // Apply status filter
      if (statusFilter !== 'all' && status !== statusFilter) {
        continue;
      }

      // Extract task text (remove checkbox and completion date)
      let taskText = line
        .replace(/^- \[[xX ]\]\s*/, '')
        .replace(/\(completed: \d{4}-\d{2}-\d{2}\)/, '')
        .trim();

      // Extract metadata
      const metadata = extractMetadata(taskText);

      // Add due date to metadata
      metadata.due = currentDate;

      // Remove metadata from task text for cleaner display
      taskText = taskText.replace(/@\w+:[^\s@]+/g, '').trim();

      tasks.push({
        task: taskText,
        source: filePath,
        priority: metadata.priority,
        project: metadata.project,
        context: metadata.context,
        status,
        metadata,
      });
    }
  }

  return tasks;
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
 * Get tasks by date across all task lists
 */
export async function getTasksByDate(
  args: GetTasksByDateArgs,
  vaultPath: string
): Promise<GetTasksByDateResult> {
  const { date, status = 'incomplete', project } = args;

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

  // Parse all task lists based on whether we're querying overdue tasks
  let taskArrays: TaskResult[][];
  if (date === 'overdue') {
    // Query all overdue tasks
    taskArrays = await Promise.all(
      taskListFiles.map(file => parseOverdueTasksFromFile(file, status))
    );
  } else {
    // Query tasks for specific date
    const targetDate = parseDate(date);
    taskArrays = await Promise.all(
      taskListFiles.map(file => parseTaskListFile(file, targetDate, status))
    );
  }

  // Flatten and filter by project if specified
  let allTasks = taskArrays.flat();
  if (project) {
    allTasks = allTasks.filter(task => task.project === project);
  }

  // Format results
  const dateDescription = date === 'overdue' ? 'overdue' : date === 'today' ? 'today' : date;

  if (allTasks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No ${status} ${date === 'overdue' ? 'overdue tasks' : `tasks found for ${dateDescription}`}${project ? ` in project "${project}"` : ''}.`,
        },
      ],
    };
  }

  // Group by source file
  const tasksByFile = new Map<string, TaskResult[]>();
  for (const task of allTasks) {
    const fileName = path.basename(task.source);
    if (!tasksByFile.has(fileName)) {
      tasksByFile.set(fileName, []);
    }
    tasksByFile.get(fileName)!.push(task);
  }

  // Format output
  let output = `Found ${allTasks.length} ${status} ${date === 'overdue' ? 'overdue task(s)' : `task(s) for ${dateDescription}`}:\n\n`;

  for (const [fileName, tasks] of tasksByFile) {
    output += `**${fileName}**\n`;
    for (const task of tasks) {
      const metadataStr = Object.entries(task.metadata)
        .map(([key, value]) => `@${key}:${value}`)
        .join(' ');
      output += `- [${task.status === 'complete' ? 'x' : ' '}] ${task.task}`;
      if (metadataStr) {
        output += ` ${metadataStr}`;
      }
      output += '\n';
    }
    output += '\n';
  }

  return {
    content: [
      {
        type: 'text',
        text: output.trim(),
      },
    ],
  };
}
