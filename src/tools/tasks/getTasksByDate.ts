/**
 * Tool: get_tasks_by_date
 *
 * Description: Query and aggregate tasks across all task lists by date.
 * Supports the simplified task format with inline dates:
 * - ## Tasks - items with (due: ...) dates
 * - ## Todo - items without due dates
 * - ## Completed - finished items with (completed: ...) dates
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';

export interface GetTasksByDateArgs {
  date: string; // 'today' | 'tomorrow' | 'this-week' | 'overdue' | 'todo' | YYYY-MM-DD format
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
  dueDate?: string; // YYYY-MM-DD or natural language
  completedDate?: string; // YYYY-MM-DD
  metadata: Record<string, string>; // All @key:value metadata
}

export interface GetTasksByDateResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * Parse natural language date to YYYY-MM-DD format
 */
function parseNaturalDate(dateStr: string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const normalized = dateStr.toLowerCase().trim();

  if (normalized === 'today') {
    return today.toISOString().split('T')[0];
  }

  if (normalized === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  // Check for day names (monday, tuesday, etc.)
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = dayNames.indexOf(normalized);
  if (dayIndex !== -1) {
    const currentDay = today.getDay();
    let daysUntil = dayIndex - currentDay;
    if (daysUntil <= 0) daysUntil += 7; // Next week if today or past
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate.toISOString().split('T')[0];
  }

  // Check for "end of month"
  if (normalized.includes('end of month')) {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return lastDay.toISOString().split('T')[0];
  }

  // Check for "next week"
  if (normalized === 'next week') {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  }

  // Check for YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  // Month name mapping (used by multiple patterns)
  const monthMap: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  // Check for month day format (e.g., "January 31", "Jan 31")
  const monthDayMatch = normalized.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?$/i
  );
  if (monthDayMatch) {
    const month = monthMap[monthDayMatch[1].toLowerCase()];
    const day = parseInt(monthDayMatch[2], 10);
    let year = today.getFullYear();
    const targetDate = new Date(year, month, day);
    // If date is in the past by more than 6 months, assume next year
    if (targetDate < today && today.getTime() - targetDate.getTime() > 180 * 24 * 60 * 60 * 1000) {
      year++;
    }
    return new Date(year, month, day).toISOString().split('T')[0];
  }

  // Check for "week of [month] [day]" format (e.g., "week of March 5", "week of January 5th")
  const weekOfMatch = normalized.match(
    /^week\s+of\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?$/i
  );
  if (weekOfMatch) {
    const month = monthMap[weekOfMatch[1].toLowerCase()];
    const day = parseInt(weekOfMatch[2], 10);
    let year = today.getFullYear();
    const targetDate = new Date(year, month, day);
    // If date is in the past by more than 6 months, assume next year
    if (targetDate < today && today.getTime() - targetDate.getTime() > 180 * 24 * 60 * 60 * 1000) {
      year++;
    }
    // Return the Sunday of that week
    const weekDate = new Date(year, month, day);
    const sunday = new Date(weekDate);
    sunday.setDate(weekDate.getDate() - weekDate.getDay());
    return sunday.toISOString().split('T')[0];
  }

  // Check for ordinal week format (e.g., "first week of March", "2nd week of January")
  const ordinalWeekMatch = normalized.match(
    /^(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+week\s+of\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i
  );
  if (ordinalWeekMatch) {
    const ordinalMap: Record<string, number> = {
      first: 1,
      '1st': 1,
      second: 2,
      '2nd': 2,
      third: 3,
      '3rd': 3,
      fourth: 4,
      '4th': 4,
      fifth: 5,
      '5th': 5,
      last: -1,
    };
    const weekNum = ordinalMap[ordinalWeekMatch[1].toLowerCase()];
    const month = monthMap[ordinalWeekMatch[2].toLowerCase()];
    let year = today.getFullYear();

    // If month is in the past, assume next year
    const checkDate = new Date(year, month, 1);
    if (checkDate < today && today.getTime() - checkDate.getTime() > 180 * 24 * 60 * 60 * 1000) {
      year++;
    }

    if (weekNum === -1) {
      // "last week of month" - find the last Sunday of the month
      const lastDay = new Date(year, month + 1, 0); // Last day of month
      const lastSunday = new Date(lastDay);
      lastSunday.setDate(lastDay.getDate() - lastDay.getDay());
      return lastSunday.toISOString().split('T')[0];
    } else {
      // Find the nth week: first Sunday of month + (weekNum-1) weeks
      const firstOfMonth = new Date(year, month, 1);
      const firstSunday = new Date(firstOfMonth);
      // If 1st isn't Sunday, move to first Sunday
      if (firstOfMonth.getDay() !== 0) {
        firstSunday.setDate(firstOfMonth.getDate() + (7 - firstOfMonth.getDay()));
      }
      // Add (weekNum - 1) weeks
      firstSunday.setDate(firstSunday.getDate() + (weekNum - 1) * 7);
      return firstSunday.toISOString().split('T')[0];
    }
  }

  return null;
}

/**
 * Get date range for "this-week" query (Sunday-Saturday)
 */
function getWeekRange(date: Date): { start: string; end: string } {
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  sunday.setHours(0, 0, 0, 0);

  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);

  return {
    start: sunday.toISOString().split('T')[0],
    end: saturday.toISOString().split('T')[0],
  };
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
 * Extract due date from task line
 * Looks for (due: ...) pattern
 */
function extractDueDate(taskLine: string): string | null {
  const match = taskLine.match(/\(due:\s*([^)]+)\)/i);
  return match ? match[1].trim() : null;
}

/**
 * Extract completion date from task line
 * Looks for (completed: ...) pattern
 */
function extractCompletedDate(taskLine: string): string | null {
  const match = taskLine.match(/\(completed:\s*([^)]+)\)/i);
  return match ? match[1].trim() : null;
}

/**
 * Clean task text by removing checkbox, dates, and metadata
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
 * Parse tasks from a task list file
 */
async function parseTaskListFile(
  filePath: string,
  queryDate: string,
  queryType: 'specific' | 'this-week' | 'overdue' | 'todo',
  statusFilter: 'incomplete' | 'complete' | 'all',
  weekRange?: { start: string; end: string }
): Promise<TaskResult[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const tasks: TaskResult[] = [];
  const lines = content.split('\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  let currentSection: 'tasks' | 'todo' | 'completed' | 'other' = 'other';

  for (const line of lines) {
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

    // Only process task lines
    if (!line.trim().startsWith('- [')) continue;

    const isComplete = line.includes('[x]') || line.includes('[X]');
    const status: 'complete' | 'incomplete' = isComplete ? 'complete' : 'incomplete';

    // Apply status filter
    if (statusFilter !== 'all' && status !== statusFilter) continue;

    const dueDate = extractDueDate(line);
    const completedDate = extractCompletedDate(line);
    const metadata = extractMetadata(line);
    const taskText = cleanTaskText(line);

    // Handle different query types
    if (queryType === 'todo') {
      // Return tasks from ## Todo section (no due date)
      if (currentSection !== 'todo') continue;
    } else if (queryType === 'overdue') {
      // Only tasks from ## Tasks section with past due dates
      if (currentSection !== 'tasks') continue;
      if (!dueDate) continue;
      const parsedDue = parseNaturalDate(dueDate);
      if (!parsedDue || parsedDue >= todayStr) continue;
    } else if (queryType === 'this-week' && weekRange) {
      // Tasks due within the week range
      if (currentSection === 'completed') {
        // For completed tasks, check completion date
        if (!completedDate) continue;
        const parsedCompleted = parseNaturalDate(completedDate);
        if (
          !parsedCompleted ||
          parsedCompleted < weekRange.start ||
          parsedCompleted > weekRange.end
        )
          continue;
      } else if (currentSection === 'tasks') {
        if (!dueDate) continue;
        const parsedDue = parseNaturalDate(dueDate);
        if (!parsedDue || parsedDue < weekRange.start || parsedDue > weekRange.end) continue;
      } else {
        continue; // Skip todo items for this-week query
      }
    } else if (queryType === 'specific') {
      // Tasks for specific date
      if (currentSection === 'completed') {
        // Match by completion date
        if (!completedDate) continue;
        const parsedCompleted = parseNaturalDate(completedDate);
        if (parsedCompleted !== queryDate) continue;
      } else if (currentSection === 'tasks') {
        // Match by due date
        if (!dueDate) continue;
        const parsedDue = parseNaturalDate(dueDate);
        if (parsedDue !== queryDate) continue;
      } else {
        continue;
      }
    }

    tasks.push({
      task: taskText,
      source: filePath,
      priority: metadata.priority,
      project: metadata.project,
      context: metadata.context,
      status,
      dueDate: dueDate || undefined,
      completedDate: completedDate || undefined,
      metadata,
    });
  }

  return tasks;
}

/**
 * Get all task list files from vault
 *
 * Inclusion logic:
 * - Files with frontmatter: include if category=task-list AND has 'active' tag
 * - Files without frontmatter or missing category: include by default (assume active)
 * - Explicit exclusion: files with 'archived' or 'inactive' tag are excluded
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
        const { data } = matter(content);

        // Check for explicit exclusion tags
        const tags = Array.isArray(data.tags) ? data.tags : [];
        if (tags.includes('archived') || tags.includes('inactive')) {
          continue; // Explicitly excluded
        }

        // If file has category: task-list, require 'active' tag
        // If no category or different category, include by default (assume active task list)
        if (data.category === 'task-list') {
          if (tags.includes('active')) {
            taskListFiles.push(filePath);
          }
          // Has task-list category but no active tag - skip
        } else {
          // No category frontmatter - include by default
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

  // Determine query type and target date
  let queryType: 'specific' | 'this-week' | 'overdue' | 'todo';
  let queryDate: string;
  let weekRange: { start: string; end: string } | undefined;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date === 'todo') {
    queryType = 'todo';
    queryDate = '';
  } else if (date === 'overdue') {
    queryType = 'overdue';
    queryDate = '';
  } else if (date === 'this-week') {
    queryType = 'this-week';
    queryDate = '';
    weekRange = getWeekRange(today);
  } else if (date === 'today') {
    queryType = 'specific';
    queryDate = today.toISOString().split('T')[0];
  } else if (date === 'tomorrow') {
    queryType = 'specific';
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    queryDate = tomorrow.toISOString().split('T')[0];
  } else {
    queryType = 'specific';
    queryDate = date; // Assume YYYY-MM-DD
  }

  // Parse all task lists
  const taskArrays = await Promise.all(
    taskListFiles.map(file => parseTaskListFile(file, queryDate, queryType, status, weekRange))
  );

  // Flatten and filter by project if specified
  let allTasks = taskArrays.flat();
  if (project) {
    allTasks = allTasks.filter(task => task.project === project);
  }

  // Format results
  const dateDescription =
    date === 'overdue'
      ? 'overdue'
      : date === 'todo'
        ? 'todo (no due date)'
        : date === 'today'
          ? 'today'
          : date === 'this-week'
            ? 'this week'
            : date;

  if (allTasks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No ${status} ${date === 'overdue' ? 'overdue tasks' : date === 'todo' ? 'todo items' : `tasks found for ${dateDescription}`}${project ? ` in project "${project}"` : ''}.`,
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
  let output = `Found ${allTasks.length} ${status} ${date === 'overdue' ? 'overdue task(s)' : date === 'todo' ? 'todo item(s)' : `task(s) for ${dateDescription}`}:\n\n`;

  for (const [fileName, tasks] of tasksByFile) {
    output += `**${fileName}**\n`;
    for (const task of tasks) {
      const checkbox = task.status === 'complete' ? '[x]' : '[ ]';
      let line = `- ${checkbox} ${task.task}`;
      if (task.dueDate) line += ` (due: ${task.dueDate})`;
      if (task.completedDate) line += ` (completed: ${task.completedDate})`;
      const metadataStr = Object.entries(task.metadata)
        .filter(([key]) => !['due', 'completed'].includes(key))
        .map(([key, value]) => `@${key}:${value}`)
        .join(' ');
      if (metadataStr) line += ` ${metadataStr}`;
      output += line + '\n';
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
