/**
 * Tool: get_memory_base
 *
 * Description: Load session context including user reference,
 * recent handoffs, and recent corrections.
 * Provides layered context at session start:
 * 1. User reference (user identity and preferences)
 * 2. Recent handoffs (from last 2-3 sessions for continuity)
 * 3. Recent corrections (mistake/correction pairs from accumulator-corrections.md)
 * 4. Active persistent issues
 * 5. Task status (overdue and today's tasks - loaded via CLAUDE.md workflow)
 *
 * Used for session initialization and establishing timing for commit detection
 * in the two-phase close workflow.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { formatLocalDateTime } from '../../utils/dateFormat.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetMemoryBaseArgs {
  // No arguments needed - reads from fixed location
}

export interface GetMemoryBaseContext {
  sessionStartTime: Date;
}

/**
 * Extract handoff notes from recent session files by scanning sessions/ directory
 * Returns formatted handoff text from last N sessions, skipping empty handoffs
 */
async function extractRecentHandoffs(vaultPath: string, maxSessions = 3): Promise<string> {
  try {
    const sessionsPath = path.join(vaultPath, 'sessions');

    // Get all month directories (YYYY-MM format)
    const monthDirs = await fs.readdir(sessionsPath);
    const validMonthDirs = monthDirs
      .filter(dir => /^\d{4}-\d{2}$/.test(dir))
      .sort()
      .reverse(); // Most recent months first

    // Collect all session files across month directories
    const allSessionFiles: Array<{ path: string; mtime: number }> = [];

    for (const monthDir of validMonthDirs) {
      const monthPath = path.join(sessionsPath, monthDir);
      try {
        const files = await fs.readdir(monthPath);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(monthPath, file);
            const stats = await fs.stat(filePath);
            allSessionFiles.push({
              path: path.join('sessions', monthDir, file),
              mtime: stats.mtimeMs,
            });
          }
        }
      } catch {
        continue;
      }
    }

    // Sort by modification time (most recent first) and take top N
    allSessionFiles.sort((a, b) => b.mtime - a.mtime);
    const recentSessionPaths = allSessionFiles.slice(0, maxSessions).map(f => f.path);

    const handoffs: string[] = [];

    for (const sessionPath of recentSessionPaths) {
      try {
        const fullPath = path.join(vaultPath, sessionPath);
        const sessionContent = await fs.readFile(fullPath, 'utf-8');

        // Extract handoff section
        const handoffMatch = sessionContent.match(/## Handoff\n\n(.+?)(?=\n##|$)/s);

        if (handoffMatch) {
          const handoffText = handoffMatch[1].trim();

          // Skip empty or placeholder handoffs
          if (handoffText && handoffText !== '_No handoff notes_') {
            const sessionName = path.basename(sessionPath, '.md');
            handoffs.push(`**${sessionName}**\n${handoffText}`);
          }
        }
      } catch {
        // Skip sessions that can't be read
        continue;
      }
    }

    if (handoffs.length === 0) {
      return '';
    }

    return `## Recent Handoffs\n\n${handoffs.join('\n\n---\n\n')}`;
  } catch {
    return '';
  }
}

/**
 * Load active persistent issues summary for /mb display
 * Returns formatted summary of active issues (Decision 048)
 */
async function loadActivePersistentIssues(vaultPath: string): Promise<string> {
  try {
    const issuesPath = path.join(vaultPath, 'persistent-issues.md');
    const content = await fs.readFile(issuesPath, 'utf-8');

    // Find Active Issues section
    const activeStart = content.indexOf('## Active Issues');
    const archivedStart = content.indexOf('## Archived');

    if (activeStart === -1) {
      return '';
    }

    const activeEnd = archivedStart > -1 ? archivedStart : content.length;
    const activeSection = content.slice(activeStart + '## Active Issues'.length, activeEnd);

    // Parse individual issues (H3 headers)
    const issueMatches = activeSection.matchAll(
      /### ([^\n]+)\n[\s\S]*?\*\*Priority:\*\*\s*(high|medium|low)/gi
    );
    const issues: Array<{ slug: string; priority: string }> = [];

    for (const match of issueMatches) {
      issues.push({
        slug: match[1].trim(),
        priority: match[2].toLowerCase(),
      });
    }

    if (issues.length === 0) {
      return '';
    }

    let result = `## Active Persistent Issues (${issues.length})\n\n`;
    for (const issue of issues) {
      result += `- **${issue.slug}** (${issue.priority})\n`;
    }
    result += `\nUse \`/issue <slug>\` to load issue context and link this session.`;

    return result;
  } catch {
    // File doesn't exist or can't be read
    return '';
  }
}

/**
 * Load recent entries from an accumulator file
 * Returns last N entries (most recent first) with timestamps
 */
async function loadRecentAccumulatorEntries(
  vaultPath: string,
  filename: string,
  maxEntries = 3
): Promise<string> {
  try {
    const filePath = path.join(vaultPath, filename);
    const content = await fs.readFile(filePath, 'utf-8');

    // Split by H2 headers (## YYYY-MM-DD entries)
    const entries = content.split(/(?=^## )/m).filter(e => e.trim().startsWith('##'));

    if (entries.length === 0) {
      return '';
    }

    // Take the most recent N entries
    const recentEntries = entries.slice(0, maxEntries);

    return recentEntries.join('\n');
  } catch {
    // File doesn't exist or can't be read
    return '';
  }
}

export interface GetMemoryBaseResult {
  content: Array<{ type: string; text: string }>;
}

export async function getMemoryBase(
  _args: GetMemoryBaseArgs,
  vaultPath: string,
  context?: GetMemoryBaseContext
): Promise<GetMemoryBaseResult> {
  const userRefPath = path.join(vaultPath, 'user-reference.md');

  // Try to load user reference if it exists
  let userRefContent = '';
  try {
    userRefContent = await fs.readFile(userRefPath, 'utf-8');
  } catch (error) {
    // File doesn't exist - that's fine
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.warn('Failed to read user-reference.md:', (error as Error).message);
    }
  }

  // Extract recent handoffs from session files (scan filesystem directly)
  const recentHandoffs = await extractRecentHandoffs(vaultPath, 3);

  // Load all corrections (no truncation - reinforcement value outweighs context cost)
  const corrections = await loadRecentAccumulatorEntries(
    vaultPath,
    'accumulator-corrections.md',
    Infinity
  );

  let crossSessionKnowledge = '';
  if (corrections) {
    crossSessionKnowledge = `## Recent Corrections\n\n${corrections}`;
  }

  // Load active persistent issues (Decision 048)
  const persistentIssues = await loadActivePersistentIssues(vaultPath);

  // Build layered context: Session start -> User reference -> Handoffs -> Corrections -> Issues
  const sections = [];

  // Add session start time for context recovery (fallback if MCP server state is lost)
  // Use local timezone format for user-friendly display
  if (context?.sessionStartTime) {
    sections.push(`SESSION_START_TIME: ${formatLocalDateTime(context.sessionStartTime)}`);
  }

  if (userRefContent) {
    sections.push(userRefContent);
  }
  if (recentHandoffs) {
    sections.push(recentHandoffs);
  }
  if (crossSessionKnowledge) {
    sections.push(crossSessionKnowledge);
  }
  if (persistentIssues) {
    sections.push(persistentIssues);
  }

  const fullContent = sections.join('\n\n---\n\n');

  return {
    content: [
      {
        type: 'text',
        text: fullContent,
      },
    ],
  };
}
