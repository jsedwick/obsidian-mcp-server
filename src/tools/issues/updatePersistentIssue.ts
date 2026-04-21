/**
 * Tool: update_persistent_issue
 *
 * Append investigation entries to a persistent issue.
 * This tool is append-only - it can only add to the Investigation Log.
 *
 * CRITICAL: This tool has NO status parameter.
 * Issues can ONLY be resolved via /issue resolve command (human action).
 *
 * Uses directory-based structure:
 * - Reads from persistent-issues/{slug}.md
 * - Updates frontmatter sessions array
 * - Appends to Investigation Log section
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { migrateIfNeeded } from './migration.js';
import {
  normalizeIssueFrontmatterDates,
  validatePersistentIssueFrontmatter,
} from '../../templates.js';
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface UpdatePersistentIssueArgs {
  slug: string;
  entry: string;
  session_id?: string;
  // NOTE: Intentionally NO status parameter - resolution is human-only
}

export interface UpdatePersistentIssueResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface UpdatePersistentIssueContext {
  vaultPath: string;
  currentSessionId?: string;
  trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
}

const ISSUES_DIR = 'persistent-issues';

export async function updatePersistentIssue(
  args: UpdatePersistentIssueArgs,
  context: UpdatePersistentIssueContext
): Promise<UpdatePersistentIssueResult> {
  // Ensure migration has been performed
  await migrateIfNeeded(context.vaultPath);

  const filePath = path.join(context.vaultPath, ISSUES_DIR, `${args.slug}.md`);

  // Read issue file
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Issue not found: **${args.slug}**\n\n` +
            'Check the slug and ensure the issue exists in the persistent-issues directory.',
        },
      ],
    };
  }

  const { data: frontmatter, content: body } = matter(content);
  normalizeIssueFrontmatterDates(frontmatter);

  if (!validatePersistentIssueFrontmatter(frontmatter)) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Invalid issue file format for **${args.slug}**\n\n` +
            'The issue file has invalid or missing frontmatter.',
        },
      ],
    };
  }

  // frontmatter is now narrowed to PersistentIssueFrontmatter by the type guard

  // Build the new entry
  const date = getTodayLocal();
  const sessionId = args.session_id || context.currentSessionId || 'unknown-session';
  const newEntry = `\n\n**${date} ([[${sessionId}]]):**\n${args.entry}`;

  // Update sessions array in frontmatter (add session if not already present)
  const updatedSessions = [...frontmatter.sessions];
  if (!updatedSessions.includes(sessionId)) {
    updatedSessions.push(sessionId);
  }

  // Find Investigation Log section and append entry
  const investigationHeader = '## Investigation Log';
  const investigationIndex = body.indexOf(investigationHeader);

  let updatedBody: string;
  if (investigationIndex > -1) {
    // Append to existing Investigation Log section
    const beforeSection = body.slice(0, investigationIndex + investigationHeader.length);
    const afterSection = body.slice(investigationIndex + investigationHeader.length);
    updatedBody = beforeSection + afterSection + newEntry;
  } else {
    // No Investigation Log section - add one
    updatedBody = body + '\n\n## Investigation Log' + newEntry;
  }

  // Generate updated content with updated frontmatter
  const updatedContent = `---
title: "${frontmatter.title}"
category: ${frontmatter.category}
status: "${frontmatter.status}"
created: "${frontmatter.created}"
priority: "${frontmatter.priority}"${frontmatter.resolved ? `\nresolved: "${frontmatter.resolved}"` : ''}
sessions: ${JSON.stringify(updatedSessions)}
---
${updatedBody}`;

  await fs.writeFile(filePath, updatedContent, 'utf-8');

  if (context.trackFileAccess) {
    context.trackFileAccess(filePath, 'edit');
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `✅ Updated issue: **${args.slug}**\n\n` +
          `Added investigation entry for ${date}\n\n` +
          `Session: ${sessionId}`,
      },
    ],
  };
}
