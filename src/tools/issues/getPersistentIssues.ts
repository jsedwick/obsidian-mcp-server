/**
 * Tool: get_persistent_issues
 *
 * Read-only helper to retrieve persistent issues from the vault.
 * Returns only Active Issues by default (skips Archived section).
 * Used by /mb integration and internal issue lookups.
 */

import fs from 'fs/promises';
import path from 'path';

export interface PersistentIssue {
  slug: string;
  created: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
  sessions: string[];
  investigationLog: string;
}

export interface GetPersistentIssuesArgs {
  include_archived?: boolean;
}

export interface GetPersistentIssuesResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  issues: PersistentIssue[];
  hasFile: boolean;
}

export interface GetPersistentIssuesContext {
  vaultPath: string;
}

const PERSISTENT_ISSUES_FILE = 'persistent-issues.md';

/**
 * Parse a single issue section into structured data
 */
function parseIssueSection(section: string): PersistentIssue | null {
  // Extract slug from H3 header (### issue-slug)
  const slugMatch = section.match(/^###\s+(.+?)$/m);
  if (!slugMatch) return null;

  const slug = slugMatch[1].trim();

  // Extract created date
  const createdMatch = section.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  const created = createdMatch ? createdMatch[1] : '';

  // Extract priority
  const priorityMatch = section.match(/\*\*Priority:\*\*\s*(high|medium|low)/i);
  const priority = (priorityMatch ? priorityMatch[1].toLowerCase() : 'medium') as
    | 'high'
    | 'medium'
    | 'low';

  // Extract sessions list
  const sessionsMatch = section.match(/\*\*Sessions:\*\*\s*(.+?)(?=\n\n|\n\*\*|$)/s);
  const sessionsText = sessionsMatch ? sessionsMatch[1] : '';
  const sessions = sessionsText.match(/\[\[([^\]]+)\]\]/g) || [];
  const sessionsList = sessions.map(s => s.replace(/\[\[|\]\]/g, ''));

  // Extract description (text after metadata, before Investigation Log)
  const metadataEnd = section.indexOf('\n\n', section.indexOf('**Priority:**'));
  const investigationStart = section.indexOf('#### Investigation Log');

  let description = '';
  if (metadataEnd > -1) {
    const descEnd = investigationStart > -1 ? investigationStart : section.length;
    description = section.slice(metadataEnd, descEnd).trim();
  }

  // Extract investigation log
  let investigationLog = '';
  if (investigationStart > -1) {
    investigationLog = section.slice(investigationStart + '#### Investigation Log'.length).trim();
  }

  return {
    slug,
    created,
    priority,
    description,
    sessions: sessionsList,
    investigationLog,
  };
}

/**
 * Parse the persistent-issues.md file
 */
function parseIssuesFile(content: string): {
  activeIssues: PersistentIssue[];
  archivedIssues: PersistentIssue[];
} {
  const activeIssues: PersistentIssue[] = [];
  const archivedIssues: PersistentIssue[] = [];

  // Find Active Issues and Archived sections
  const activeStart = content.indexOf('## Active Issues');
  const archivedStart = content.indexOf('## Archived');

  if (activeStart === -1) {
    return { activeIssues: [], archivedIssues: [] };
  }

  // Extract Active Issues section
  const activeEnd = archivedStart > -1 ? archivedStart : content.length;
  const activeSection = content.slice(activeStart + '## Active Issues'.length, activeEnd);

  // Split into individual issues (separated by ---)
  const activeSections = activeSection.split(/\n---\n/).filter(s => s.trim());

  for (const section of activeSections) {
    const issue = parseIssueSection(section);
    if (issue) {
      activeIssues.push(issue);
    }
  }

  // Extract Archived section if requested
  if (archivedStart > -1) {
    const archivedSection = content.slice(archivedStart + '## Archived'.length);
    const archivedSections = archivedSection.split(/\n---\n/).filter(s => s.trim());

    for (const section of archivedSections) {
      const issue = parseIssueSection(section);
      if (issue) {
        archivedIssues.push(issue);
      }
    }
  }

  return { activeIssues, archivedIssues };
}

export async function getPersistentIssues(
  args: GetPersistentIssuesArgs,
  context: GetPersistentIssuesContext
): Promise<GetPersistentIssuesResult> {
  const filePath = path.join(context.vaultPath, PERSISTENT_ISSUES_FILE);

  // Check if file exists
  let fileExists = false;
  try {
    await fs.access(filePath);
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  if (!fileExists) {
    return {
      content: [
        {
          type: 'text',
          text: 'No persistent issues file found. Use `/issue create <name>` to create the first issue.',
        },
      ],
      issues: [],
      hasFile: false,
    };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const { activeIssues, archivedIssues } = parseIssuesFile(content);

  const includeArchived = args.include_archived === true;
  const issues = includeArchived ? [...activeIssues, ...archivedIssues] : activeIssues;

  // Format response
  let responseText = '';

  if (activeIssues.length === 0) {
    responseText = 'No active persistent issues.';
  } else {
    responseText = `**Active Persistent Issues (${activeIssues.length}):**\n\n`;
    for (const issue of activeIssues) {
      const sessionCount = issue.sessions.length;
      responseText += `- **${issue.slug}** (${issue.priority}) - ${sessionCount} session(s)\n`;
      if (issue.description) {
        const shortDesc =
          issue.description.length > 80
            ? issue.description.slice(0, 80) + '...'
            : issue.description;
        responseText += `  ${shortDesc}\n`;
      }
    }
  }

  if (includeArchived && archivedIssues.length > 0) {
    responseText += `\n**Archived Issues (${archivedIssues.length}):**\n`;
    for (const issue of archivedIssues) {
      responseText += `- ${issue.slug}\n`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: responseText,
      },
    ],
    issues,
    hasFile: true,
  };
}
