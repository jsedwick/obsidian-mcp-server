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

export interface GetMemoryBaseArgs {
  working_directory?: string; // Primary CWD for prioritizing project-relevant handoffs
}

export interface GetMemoryBaseContext {
  sessionStartTime: Date;
}

/**
 * Extract handoff notes from recent session files by scanning sessions/ directory.
 * When a working_directory is provided, prioritizes sessions that match that CWD,
 * then fills remaining slots with the most recent sessions overall.
 * Returns formatted handoff text from last N sessions, skipping empty handoffs.
 */
async function extractRecentHandoffs(
  vaultPath: string,
  maxSessions = 3,
  workingDirectory?: string
): Promise<{ text: string; structured: GetMemoryBaseStructuredHandoff[] }> {
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

    // Sort by modification time (most recent first)
    allSessionFiles.sort((a, b) => b.mtime - a.mtime);

    // If we have a working directory, do a two-pass prioritized retrieval:
    // Pass 1: Sessions matching the CWD (most relevant for continuity)
    // Pass 2: Fill remaining slots with most recent sessions overall
    let orderedSessionPaths: string[];

    if (workingDirectory) {
      const cwdMatches: string[] = [];
      const others: string[] = [];

      // Scan a reasonable number of recent sessions to find CWD matches
      const scanLimit = Math.min(allSessionFiles.length, 20);
      for (let i = 0; i < scanLimit; i++) {
        const sessionPath = allSessionFiles[i].path;
        try {
          const fullPath = path.join(vaultPath, sessionPath);
          const content = await fs.readFile(fullPath, 'utf-8');

          // Check frontmatter for working_directory match
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const wdMatch = fmMatch[1].match(/working_directory:\s*"?([^"\n]+)"?/);
            if (wdMatch && wdMatch[1].trim() === workingDirectory) {
              cwdMatches.push(sessionPath);
              continue;
            }
          }
        } catch {
          // Skip unreadable files
        }
        others.push(sessionPath);
      }

      // Prioritize: CWD-matching sessions first, then fill with recent others
      const selected: string[] = [];
      for (const p of cwdMatches) {
        if (selected.length >= maxSessions) break;
        selected.push(p);
      }
      for (const p of others) {
        if (selected.length >= maxSessions) break;
        selected.push(p);
      }
      orderedSessionPaths = selected;
    } else {
      orderedSessionPaths = allSessionFiles.slice(0, maxSessions).map(f => f.path);
    }

    const handoffTexts: string[] = [];
    const structuredHandoffs: GetMemoryBaseStructuredHandoff[] = [];

    for (const sessionPath of orderedSessionPaths) {
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
            handoffTexts.push(`**${sessionName}**\n${handoffText}`);
            structuredHandoffs.push({
              session_id: sessionName,
              content: handoffText,
            });
          }
        }
      } catch {
        // Skip sessions that can't be read
        continue;
      }
    }

    if (handoffTexts.length === 0) {
      return { text: '', structured: [] };
    }

    return {
      text: `## Recent Handoffs\n\n${handoffTexts.join('\n\n---\n\n')}`,
      structured: structuredHandoffs,
    };
  } catch {
    return { text: '', structured: [] };
  }
}

/**
 * Load active persistent issues summary for /mb display
 * Returns formatted summary of active issues (Decision 048)
 *
 * Uses directory-based structure:
 * - persistent-issues/*.md for active issues
 * - Parses frontmatter for priority
 */
async function loadActivePersistentIssues(
  vaultPath: string
): Promise<{ text: string; structured: GetMemoryBaseStructuredIssue[] }> {
  try {
    const issuesDir = path.join(vaultPath, 'persistent-issues');
    const files = await fs.readdir(issuesDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      return { text: '', structured: [] };
    }

    const issues: GetMemoryBaseStructuredIssue[] = [];

    for (const file of mdFiles) {
      try {
        const filePath = path.join(issuesDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse frontmatter to extract priority
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const priorityMatch = frontmatter.match(/priority:\s*["']?(high|medium|low)["']?/i);
          const statusMatch = frontmatter.match(/status:\s*["']?(active|resolved)["']?/i);

          // Only include active issues
          if (statusMatch && statusMatch[1].toLowerCase() === 'active') {
            issues.push({
              slug: path.basename(file, '.md'),
              priority: priorityMatch ? priorityMatch[1].toLowerCase() : 'medium',
            });
          }
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    if (issues.length === 0) {
      return { text: '', structured: [] };
    }

    let text = `## Active Persistent Issues (${issues.length})\n\n`;
    for (const issue of issues) {
      text += `- **${issue.slug}** (${issue.priority})\n`;
    }
    text += `\nUse \`/issue <slug>\` to load issue context and link this session.`;

    return { text, structured: issues };
  } catch {
    // Directory doesn't exist or can't be read
    return { text: '', structured: [] };
  }
}

/**
 * Load corrections as condensed actionable rules
 * Extracts title + "How to prevent" bullets from each correction entry
 * for a compact, directive format that stays effective in context
 */
async function loadCondensedCorrectionRules(
  vaultPath: string,
  filename: string
): Promise<{ text: string; structured: GetMemoryBaseStructuredCorrection[] }> {
  try {
    const filePath = path.join(vaultPath, filename);
    const content = await fs.readFile(filePath, 'utf-8');

    // Split by H2 headers and filter to correction entries
    const entries = content.split(/(?=^## )/m).filter(e => e.trim().startsWith('## 🚫'));

    if (entries.length === 0) {
      return { text: '', structured: [] };
    }

    const ruleTexts: string[] = [];
    const structuredRules: GetMemoryBaseStructuredCorrection[] = [];
    for (const entry of entries) {
      // Extract title (strip emoji prefix and date suffix)
      const titleMatch = entry.match(/^## 🚫\s+(.+?)(?:\s*-\s*\d{4}-\d{2}-\d{2})?\s*$/m);
      const title = titleMatch ? titleMatch[1].trim() : null;

      // Extract "How to prevent" bullets
      const preventMatch = entry.match(/\*\*How to prevent:\*\*\n((?:- .+\n?)*)/);

      if (title && preventMatch) {
        const bulletsText = preventMatch[1].trim();
        ruleTexts.push(`**${title}:**\n${bulletsText}`);
        structuredRules.push({
          title,
          bullets: bulletsText
            .split('\n')
            .map(b => b.replace(/^- /, '').trim())
            .filter(Boolean),
        });
      }
    }

    return { text: ruleTexts.join('\n\n'), structured: structuredRules };
  } catch {
    // File doesn't exist or can't be read
    return { text: '', structured: [] };
  }
}

export interface GetMemoryBaseStructuredHandoff {
  session_id: string;
  content: string;
}

export interface GetMemoryBaseStructuredCorrection {
  title: string;
  bullets: string[];
}

export interface GetMemoryBaseStructuredIssue {
  slug: string;
  priority: string;
}

export interface GetMemoryBaseStructuredResult {
  session_start_time?: string;
  has_user_reference: boolean;
  handoffs: GetMemoryBaseStructuredHandoff[];
  correction_rules: GetMemoryBaseStructuredCorrection[];
  persistent_issues: GetMemoryBaseStructuredIssue[];
  section_count: number;
}

export interface GetMemoryBaseResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: GetMemoryBaseStructuredResult;
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
  // When working_directory is provided, prioritize sessions matching that project
  const recentHandoffs = await extractRecentHandoffs(vaultPath, 3, _args.working_directory);

  // Load corrections as condensed actionable rules
  const corrections = await loadCondensedCorrectionRules(vaultPath, 'accumulator-corrections.md');

  let crossSessionKnowledge = '';
  if (corrections.text) {
    crossSessionKnowledge = `## ⚠️ Correction Rules\n\n${corrections.text}`;
  }

  // Load active persistent issues (Decision 048)
  const persistentIssues = await loadActivePersistentIssues(vaultPath);

  // Build layered context: Session start -> User reference -> Handoffs -> Corrections -> Issues
  const sections = [];
  let sectionCount = 0;

  // Add session start time for context recovery (fallback if MCP server state is lost)
  // Use local timezone format for user-friendly display
  const sessionStartTimeStr = context?.sessionStartTime
    ? formatLocalDateTime(context.sessionStartTime)
    : undefined;
  if (sessionStartTimeStr) {
    sections.push(`SESSION_START_TIME: ${sessionStartTimeStr}`);
    sectionCount++;
  }

  if (userRefContent) {
    sections.push(userRefContent);
    sectionCount++;
  }
  if (recentHandoffs.text) {
    sections.push(recentHandoffs.text);
    sectionCount++;
  }
  if (crossSessionKnowledge) {
    sections.push(crossSessionKnowledge);
    sectionCount++;
  }
  if (persistentIssues.text) {
    sections.push(persistentIssues.text);
    sectionCount++;
  }

  const fullContent = sections.join('\n\n---\n\n');

  // Build structured content (required by outputSchema)
  const structuredContent: GetMemoryBaseStructuredResult = {
    ...(sessionStartTimeStr ? { session_start_time: sessionStartTimeStr } : {}),
    has_user_reference: !!userRefContent,
    handoffs: recentHandoffs.structured,
    correction_rules: corrections.structured,
    persistent_issues: persistentIssues.structured,
    section_count: sectionCount,
  };

  return {
    content: [
      {
        type: 'text',
        text: fullContent,
      },
    ],
    structuredContent,
  };
}
