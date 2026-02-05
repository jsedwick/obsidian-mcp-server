/**
 * Migration helper for persistent issues directory structure refactor.
 *
 * Automatically migrates from single-file format (persistent-issues.md)
 * to directory-based format (persistent-issues/*.md).
 *
 * Migration is triggered on first access to issue tools when:
 * - Old file (persistent-issues.md) exists
 * - New directory (persistent-issues/) doesn't exist or is empty
 */

import fs from 'fs/promises';
import path from 'path';
import type { PersistentIssueFrontmatter } from '../../templates.js';

export interface MigrationResult {
  migrated: boolean;
  issuesMigrated: number;
  resolvedIssuesMigrated: number;
  backupFile?: string;
  errors: string[];
}

interface ParsedIssue {
  slug: string;
  title: string;
  created: string;
  resolved?: string;
  priority: 'high' | 'medium' | 'low';
  sessions: string[];
  description: string;
  investigationLog: string;
  isResolved: boolean;
}

const OLD_FILE = 'persistent-issues.md';
const NEW_DIR = 'persistent-issues';
const ARCHIVE_DIR = 'archive/persistent-issues';

/**
 * Parse a single issue section from the old format
 */
function parseIssueSection(section: string): ParsedIssue | null {
  // Extract slug from H3 header (### issue-slug)
  const slugMatch = section.match(/^###\s+(.+?)$/m);
  if (!slugMatch) return null;

  const slug = slugMatch[1].trim();

  // Extract created date
  const createdMatch = section.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  const created = createdMatch ? createdMatch[1] : new Date().toISOString().split('T')[0];

  // Extract resolved date (for archived issues)
  const resolvedMatch = section.match(/\*\*Resolved:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  const resolved = resolvedMatch ? resolvedMatch[1] : undefined;

  // Extract priority
  const priorityMatch = section.match(/\*\*Priority:\*\*\s*(high|medium|low)/i);
  const priority = (priorityMatch ? priorityMatch[1].toLowerCase() : 'medium') as
    | 'high'
    | 'medium'
    | 'low';

  // Extract sessions list
  const sessionsMatch = section.match(/\*\*Sessions:\*\*\s*(.+?)(?=\n\n|\n\*\*|$)/s);
  const sessionsText = sessionsMatch ? sessionsMatch[1] : '';
  const sessionMatches = sessionsText.match(/\[\[([^\]]+)\]\]/g) || [];
  const sessions = sessionMatches.map(s => s.replace(/\[\[|\]\]/g, ''));

  // Extract description (text after metadata, before Investigation Log)
  const priorityIndex = section.indexOf('**Priority:**');
  const metadataEnd = priorityIndex > -1 ? section.indexOf('\n\n', priorityIndex) : -1;
  const investigationStart = section.indexOf('#### Investigation Log');

  let description = '';
  if (metadataEnd > -1) {
    const descEnd = investigationStart > -1 ? investigationStart : section.length;
    description = section.slice(metadataEnd, descEnd).trim();
  }

  // Extract investigation log
  let investigationLog = '';
  if (investigationStart > -1) {
    // Get content after "#### Investigation Log" but before next issue separator
    const afterHeader = section.slice(investigationStart + '#### Investigation Log'.length);
    investigationLog = afterHeader.trim();
  }

  return {
    slug,
    title: slug, // In old format, slug was used as title
    created,
    resolved,
    priority,
    sessions,
    description,
    investigationLog,
    isResolved: !!resolved,
  };
}

/**
 * Parse the old persistent-issues.md file format
 */
function parseOldFormat(content: string): {
  activeIssues: ParsedIssue[];
  archivedIssues: ParsedIssue[];
} {
  const activeIssues: ParsedIssue[] = [];
  const archivedIssues: ParsedIssue[] = [];

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

  // Extract Archived section
  if (archivedStart > -1) {
    const archivedSection = content.slice(archivedStart + '## Archived'.length);
    const archivedSections = archivedSection.split(/\n---\n/).filter(s => s.trim());

    for (const section of archivedSections) {
      const issue = parseIssueSection(section);
      if (issue) {
        issue.isResolved = true;
        archivedIssues.push(issue);
      }
    }
  }

  return { activeIssues, archivedIssues };
}

/**
 * Generate frontmatter for a migrated issue file
 */
function generateMigratedIssueContent(issue: ParsedIssue): string {
  const frontmatter: PersistentIssueFrontmatter = {
    title: issue.title,
    category: 'persistent-issue',
    status: issue.isResolved ? 'resolved' : 'active',
    created: issue.created,
    priority: issue.priority,
    sessions: issue.sessions,
  };

  // Add resolved date if present
  const resolvedField = issue.resolved ? `\nresolved: "${issue.resolved}"` : '';

  return `---
title: "${frontmatter.title}"
category: ${frontmatter.category}
status: "${frontmatter.status}"
created: "${frontmatter.created}"
priority: "${frontmatter.priority}"${resolvedField}
sessions: ${JSON.stringify(frontmatter.sessions)}
---

# ${issue.title}

${issue.description || '_No description provided_'}

## Investigation Log

${issue.investigationLog}
`;
}

/**
 * Check if migration is needed and perform it if so.
 *
 * Migration is needed when:
 * 1. Old file (persistent-issues.md) exists
 * 2. New directory (persistent-issues/) doesn't exist or is empty
 *
 * @param vaultPath Path to the vault
 * @returns Migration result
 */
export async function migrateIfNeeded(vaultPath: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    migrated: false,
    issuesMigrated: 0,
    resolvedIssuesMigrated: 0,
    errors: [],
  };

  const oldFilePath = path.join(vaultPath, OLD_FILE);
  const newDirPath = path.join(vaultPath, NEW_DIR);
  const archiveDirPath = path.join(vaultPath, ARCHIVE_DIR);

  // Check if old file exists
  try {
    await fs.access(oldFilePath);
  } catch {
    // Old file doesn't exist - no migration needed
    return result;
  }

  // Check if new directory exists and has files
  let newDirHasFiles = false;
  try {
    const files = await fs.readdir(newDirPath);
    newDirHasFiles = files.some(f => f.endsWith('.md'));
  } catch {
    // Directory doesn't exist - migration needed
  }

  // If new directory already has files, don't migrate
  if (newDirHasFiles) {
    return result;
  }

  // Perform migration
  try {
    const oldContent = await fs.readFile(oldFilePath, 'utf-8');
    const { activeIssues, archivedIssues } = parseOldFormat(oldContent);

    // Create directories
    await fs.mkdir(newDirPath, { recursive: true });
    await fs.mkdir(archiveDirPath, { recursive: true });

    // Migrate active issues
    for (const issue of activeIssues) {
      try {
        const content = generateMigratedIssueContent(issue);
        const filePath = path.join(newDirPath, `${issue.slug}.md`);
        await fs.writeFile(filePath, content, 'utf-8');
        result.issuesMigrated++;
      } catch (error) {
        result.errors.push(
          `Failed to migrate active issue ${issue.slug}: ${(error as Error).message}`
        );
      }
    }

    // Migrate archived issues
    for (const issue of archivedIssues) {
      try {
        const content = generateMigratedIssueContent(issue);
        const filePath = path.join(archiveDirPath, `${issue.slug}.md`);
        await fs.writeFile(filePath, content, 'utf-8');
        result.resolvedIssuesMigrated++;
      } catch (error) {
        result.errors.push(
          `Failed to migrate archived issue ${issue.slug}: ${(error as Error).message}`
        );
      }
    }

    // Backup old file
    const backupPath = oldFilePath + '.backup';
    await fs.rename(oldFilePath, backupPath);
    result.backupFile = backupPath;
    result.migrated = true;
  } catch (error) {
    result.errors.push(`Migration failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Slugify a name for use as issue identifier (same logic as issue.ts)
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
