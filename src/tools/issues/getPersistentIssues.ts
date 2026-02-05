/**
 * Tool: get_persistent_issues
 *
 * Read-only helper to retrieve persistent issues from the vault.
 * Returns only Active Issues by default (skips archived/resolved).
 * Used by /mb integration and internal issue lookups.
 *
 * Refactored to use directory-based structure:
 * - persistent-issues/*.md for active issues
 * - archive/persistent-issues/*.md for resolved issues
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { migrateIfNeeded } from './migration.js';
import { validatePersistentIssueFrontmatter } from '../../templates.js';

export interface PersistentIssue {
  slug: string;
  title: string;
  created: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'resolved';
  resolved?: string;
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

const ISSUES_DIR = 'persistent-issues';
const ARCHIVE_DIR = 'archive/persistent-issues';

/**
 * Parse a single issue file into structured data
 */
async function parseIssueFile(filePath: string): Promise<PersistentIssue | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);

    if (!validatePersistentIssueFrontmatter(frontmatter)) {
      return null;
    }

    // frontmatter is now narrowed to PersistentIssueFrontmatter by the type guard
    const slug = path.basename(filePath, '.md');

    // Extract description (content before Investigation Log section)
    const investigationStart = body.indexOf('## Investigation Log');
    let description = '';
    let investigationLog = '';

    if (investigationStart > -1) {
      // Get content between H1 header and Investigation Log
      const bodyBeforeInvestigation = body.slice(0, investigationStart);
      // Remove H1 header if present
      description = bodyBeforeInvestigation.replace(/^#\s+[^\n]+\n*/, '').trim();
      investigationLog = body.slice(investigationStart + '## Investigation Log'.length).trim();
    } else {
      // No investigation log section - all content is description
      description = body.replace(/^#\s+[^\n]+\n*/, '').trim();
    }

    return {
      slug,
      title: frontmatter.title,
      created: frontmatter.created,
      priority: frontmatter.priority,
      status: frontmatter.status,
      resolved: frontmatter.resolved,
      description,
      sessions: frontmatter.sessions,
      investigationLog,
    };
  } catch {
    return null;
  }
}

/**
 * Read all issues from a directory
 */
async function readIssuesFromDir(dirPath: string): Promise<PersistentIssue[]> {
  const issues: PersistentIssue[] = [];

  try {
    const files = await fs.readdir(dirPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const filePath = path.join(dirPath, file);
      const issue = await parseIssueFile(filePath);
      if (issue) {
        issues.push(issue);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return issues;
}

export async function getPersistentIssues(
  args: GetPersistentIssuesArgs,
  context: GetPersistentIssuesContext
): Promise<GetPersistentIssuesResult> {
  // Perform migration if needed (old format -> new format)
  await migrateIfNeeded(context.vaultPath);

  const issuesDirPath = path.join(context.vaultPath, ISSUES_DIR);
  const archiveDirPath = path.join(context.vaultPath, ARCHIVE_DIR);

  // Read active issues
  const activeIssues = await readIssuesFromDir(issuesDirPath);

  // Read archived issues if requested
  const archivedIssues = args.include_archived ? await readIssuesFromDir(archiveDirPath) : [];

  const allIssues = [...activeIssues, ...archivedIssues];
  const hasAnyIssues = activeIssues.length > 0 || archivedIssues.length > 0;

  // Check if directory exists (for hasFile compatibility)
  let dirExists = false;
  try {
    await fs.access(issuesDirPath);
    dirExists = true;
  } catch {
    // Directory doesn't exist
  }

  if (!dirExists && !hasAnyIssues) {
    return {
      content: [
        {
          type: 'text',
          text: 'No persistent issues found. Use `/issue create <name>` to create the first issue.',
        },
      ],
      issues: [],
      hasFile: false,
    };
  }

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

  if (args.include_archived && archivedIssues.length > 0) {
    responseText += `\n**Archived Issues (${archivedIssues.length}):**\n`;
    for (const issue of archivedIssues) {
      responseText += `- ${issue.slug}${issue.resolved ? ` (resolved ${issue.resolved})` : ''}\n`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: responseText,
      },
    ],
    issues: allIssues,
    hasFile: true,
  };
}
