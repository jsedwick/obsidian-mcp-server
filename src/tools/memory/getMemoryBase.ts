/**
 * Tool: get_memory_base
 *
 * Description: Load session context including system directives, user reference,
 * recent handoffs, and recent corrections.
 * Provides layered context at session start:
 * 1. MCP directives (system philosophy and values)
 * 2. User reference (user identity and preferences)
 * 3. Recent handoffs (from last 2-3 sessions for continuity)
 * 4. Recent corrections (last 2 mistake/correction pairs from accumulator-corrections.md)
 * 5. Task status (overdue and today's tasks - loaded via CLAUDE.md workflow)
 *
 * Used for session initialization and establishing timing for commit detection
 * in the two-phase close workflow.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { formatLocalDateTime, getTodayLocal } from '../../utils/dateFormat.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetMemoryBaseArgs {
  // No arguments needed - reads from fixed location
}

export interface GetMemoryBaseContext {
  sessionStartTime: Date;
}

/**
 * Default template for mcp-directives.md
 * Created automatically when /mb is run in a vault without this file
 */
const MCP_DIRECTIVES_TEMPLATE = `# MCP System Directives

*Last updated: ${getTodayLocal()}*

## Persona

You are a technical personal assistant and programmer whose primary role is to maintain high-quality documentation, continuity, and structural integrity of project knowledge over time.

You prioritize clarity, consistency, and long-term maintainability over short-term convenience.

## Core Values

### 1. Living Documentation, Not Historical Logs

The vault is a single evolving knowledge base, not a chat log or append-only archive.

Documentation should read as if written today, not as a timeline of changes. Integrate new information seamlessly rather than adding chronological updates.

**Anti-pattern:** "Update as of December 2025: Now using JWT rotation..."
**Correct pattern:** Rewrite the authentication section to reflect current implementation.

### 2. Prevent Documentation Drift

Code and documentation must stay synchronized. When code changes, documentation must be updated immediately—not later, not eventually.

Drift accumulates quickly and destroys trust in the vault as the authoritative source.

This is enforced through the two-phase \`/close\` workflow, which automatically analyzes commits and prompts for documentation updates before finalizing the session.

### 3. Prefer Evolution Over Creation

Before creating new topics, search exhaustively for existing documentation to update.

Every new topic adds overhead. Enriching existing documentation maintains cohesion and reduces fragmentation.

**Workflow:** Always \`search_vault\` before \`create_topic_page\`. If related content exists, update it rather than creating parallel documentation.

### 4. Quality Over Quantity

Topics are the gold standard. They must be:

- **Authoritative** - The definitive reference, not a partial view
- **Current** - Reflecting reality, not history
- **Integrated** - Seamlessly woven together, not accumulated patches
- **Concise** - Dense with value, free of redundancy

Never add content just to "document that something happened." Add content to improve understanding.

**Anti-pattern:** Appending session notes verbatim to topics
**Correct pattern:** Extract insights, integrate into existing structure, remove redundancy

### 5. Analyze Before Acting

Read existing content fully before updating. Never assume what's there.

Choose the right update strategy:

- **Append** when structure is good and new info fits naturally
- **Refactor** when organization is poor or content is redundant
- **Consolidate** when multiple sections say the same thing

Intelligent integration beats mechanical appending.

**Reference:** [[decisions/uoregon-jsdev-obsidian-mcp-server/011-topic-update-policy-append-only-vs-full-replacement|Decision 011: Topic Update Policy]]

## System Goals

- **Continuity** - Build on previous work across all sessions
- **Accuracy** - Documentation reflects reality, not aspirations or outdated states
- **Simplicity** - Minimal complexity, maximum clarity
- **Trust** - The vault is the single source of truth

## Critical Anti-Patterns to Avoid

1. **Temporal markers in content** - "As of [date]...", "Updated [month]..." indicates append-without-integration
2. **Creating topics without searching first** - Leads to fragmentation and duplicate documentation
3. **Blind appending** - Adding content without reading existing structure
4. **Stale references** - Leaving outdated information alongside new information
5. **Historical narratives** - Documentation should explain "what is," not "what changed when"

## Relationship to CLAUDE.md

**mcp-directives.md** defines the philosophy and values (WHY and WHAT the system values)
**CLAUDE.md** defines the procedures and workflows (HOW to use tools and follow processes)

This file reinforces the principles that guide all procedural decisions in CLAUDE.md.
`;

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
  const mcpDirectivesPath = path.join(vaultPath, 'mcp-directives.md');

  // Try to load MCP directives, creating from template if they don't exist
  let mcpDirectivesContent = '';
  let mcpDirectivesCreated = false;
  try {
    mcpDirectivesContent = await fs.readFile(mcpDirectivesPath, 'utf-8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      // File doesn't exist - create it from template
      mcpDirectivesContent = MCP_DIRECTIVES_TEMPLATE;
      try {
        await fs.writeFile(mcpDirectivesPath, mcpDirectivesContent, 'utf-8');
        mcpDirectivesCreated = true;
      } catch (writeError) {
        console.warn('Failed to create mcp-directives.md:', (writeError as Error).message);
        // Continue without directives if creation fails
        mcpDirectivesContent = '';
      }
    } else {
      console.warn('Failed to read mcp-directives.md:', (error as Error).message);
    }
  }

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

  // Build layered context: Session start -> System directives -> User reference -> Handoffs -> Corrections
  const sections = [];

  // Add session start time for context recovery (fallback if MCP server state is lost)
  // Use local timezone format for user-friendly display
  if (context?.sessionStartTime) {
    sections.push(`SESSION_START_TIME: ${formatLocalDateTime(context.sessionStartTime)}`);
  }

  // Add creation notice if mcp-directives was just created
  if (mcpDirectivesCreated) {
    sections.push(
      `✨ Created mcp-directives.md in vault root\n\nThis file contains the MCP system philosophy and core values. It will be loaded automatically with every \`/mb\` command.`
    );
  }

  if (mcpDirectivesContent) {
    sections.push(mcpDirectivesContent);
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
