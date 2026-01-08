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
 * Date range for week-based queries
 */
interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/**
 * Get the week date range for a given date (Sunday-Saturday)
 */
function getWeekRange(date: Date): DateRange {
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
 * Parse natural language date header into date or date range
 * Supports:
 * - "## Due Week of January 5th" → week range containing Jan 5
 * - "## Due Next Week" → next week's range
 * - "## Due This Week" → current week's range
 * - "## Due Monday (2025-12-23)" → extracts specific date
 * - "## Due Today (2025-12-23)" → extracts specific date
 */
function parseNaturalLanguageHeader(header: string): string | DateRange | null {
  // Pattern 1: "## Due [Day] (YYYY-MM-DD)" - extract explicit date
  const explicitDateMatch = header.match(/## Due (?:\w+day) \((\d{4}-\d{2}-\d{2})\)/i);
  if (explicitDateMatch) {
    return explicitDateMatch[1];
  }

  // Pattern 2: "## Due Today (YYYY-MM-DD)" - already handled by original parser
  const dueTodayMatch = header.match(/## Due Today \((\d{4}-\d{2}-\d{2})\)/i);
  if (dueTodayMatch) {
    return dueTodayMatch[1];
  }

  // Pattern 3: "## Due Next Week"
  if (/## Due Next Week/i.test(header)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeekStart = new Date(today);
    nextWeekStart.setDate(today.getDate() + (7 - today.getDay())); // Next Sunday
    return getWeekRange(nextWeekStart);
  }

  // Pattern 4: "## Due This Week"
  if (/## Due This Week/i.test(header)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return getWeekRange(today);
  }

  // Pattern 5: "## Due Week of [Month] [Day]" or "## Due Week of [Month] [Day]th/st/nd/rd"
  const weekOfMatch = header.match(/## Due Week of (\w+) (\d+)(?:st|nd|rd|th)?/i);
  if (weekOfMatch) {
    const monthName = weekOfMatch[1];
    const day = parseInt(weekOfMatch[2], 10);

    // Parse month name to month number (0-11)
    const monthMap: Record<string, number> = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    };
    const month = monthMap[monthName.toLowerCase()];

    if (month !== undefined) {
      // Determine year (use current year, or next year if month has passed)
      const today = new Date();
      let year = today.getFullYear();
      const targetDate = new Date(year, month, day);

      // If target date is more than 6 months in the past, assume next year
      if (
        targetDate < today &&
        today.getTime() - targetDate.getTime() > 180 * 24 * 60 * 60 * 1000
      ) {
        year++;
      }

      const weekDate = new Date(year, month, day);
      return getWeekRange(weekDate);
    }
  }

  return null;
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
 * Check if a date falls within a date range (inclusive)
 */
function isDateInRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

/**
 * Parse task list file and extract tasks for specified date
 * Now supports natural language date headers and completed section
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

  // Find "Due Today (YYYY-MM-DD)" section (original strict format)
  const dueTodayRegex = new RegExp(`## Due Today \\(${targetDate.replace(/-/g, '\\-')}\\)`, 'i');
  let inTargetSection = false;
  let inCompletedSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is a section header (## Due ...)
    if (line.startsWith('## Due ')) {
      // First check strict format
      if (dueTodayRegex.test(line)) {
        inTargetSection = true;
        inCompletedSection = false;
        continue;
      }

      // Try natural language parsing
      const parsedDate = parseNaturalLanguageHeader(line);
      if (parsedDate) {
        // Check if target date matches
        if (typeof parsedDate === 'string') {
          // Exact date match
          inTargetSection = parsedDate === targetDate;
        } else {
          // Date range match
          inTargetSection = isDateInRange(targetDate, parsedDate);
        }
        inCompletedSection = false;
        continue;
      }

      // If we hit a ## header that doesn't match, we're leaving any previous section
      inTargetSection = false;
      inCompletedSection = false;
      continue;
    }

    // Check for Completed section
    if (line.startsWith('## Completed')) {
      inCompletedSection = true;
      inTargetSection = false;
      continue;
    }

    // Check if we've entered a different section (non-Due header)
    if (line.startsWith('## ')) {
      // We've left any previous section
      inTargetSection = false;
      inCompletedSection = false;
      continue;
    }

    // Parse task line from due date sections
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

    // Parse completed tasks from Completed section
    if (inCompletedSection && line.trim().startsWith('- [')) {
      // Extract completion date from (completed: YYYY-MM-DD) pattern
      const completionDateMatch = line.match(/\(completed: (\d{4}-\d{2}-\d{2})\)/);

      // Only include if completion date matches target date and status filter allows completed tasks
      if (
        completionDateMatch &&
        completionDateMatch[1] === targetDate &&
        (statusFilter === 'complete' || statusFilter === 'all')
      ) {
        const isComplete = line.includes('[x]') || line.includes('[X]');
        const status: 'complete' | 'incomplete' = isComplete ? 'complete' : 'incomplete';

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
 * Supports natural language queries and week-based date ranges
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
  } else if (date === 'this-week') {
    // Query all tasks for current week (each day Sun-Sat)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekRange = getWeekRange(today);

    // Collect tasks for each day in the week
    const daysInWeek: string[] = [];
    const currentDate = new Date(weekRange.start);
    while (currentDate <= new Date(weekRange.end)) {
      daysInWeek.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Parse tasks for all days in the week
    const weekTaskArrays = await Promise.all(
      daysInWeek.flatMap(day => taskListFiles.map(file => parseTaskListFile(file, day, status)))
    );
    taskArrays = [weekTaskArrays.flat()];
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
