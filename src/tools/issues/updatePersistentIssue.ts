/**
 * Tool: update_persistent_issue
 *
 * Append investigation entries to a persistent issue.
 * This tool is append-only - it can only add to the Investigation Log.
 *
 * CRITICAL: This tool has NO status parameter.
 * Issues can ONLY be resolved via /issue resolve command (human action).
 */

import fs from 'fs/promises';
import path from 'path';
import { getPersistentIssues } from './getPersistentIssues.js';

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

const PERSISTENT_ISSUES_FILE = 'persistent-issues.md';

export async function updatePersistentIssue(
  args: UpdatePersistentIssueArgs,
  context: UpdatePersistentIssueContext
): Promise<UpdatePersistentIssueResult> {
  const filePath = path.join(context.vaultPath, PERSISTENT_ISSUES_FILE);

  // Verify issue exists and is active
  const issues = await getPersistentIssues({}, context);

  if (!issues.hasFile) {
    return {
      content: [
        {
          type: 'text',
          text: '❌ No persistent issues file found. Create an issue first with `/issue create <name>`.',
        },
      ],
    };
  }

  const issue = issues.issues.find(i => i.slug === args.slug);

  if (!issue) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Issue not found: **${args.slug}**\n\n` +
            'Check the slug and ensure the issue is in the Active Issues section.',
        },
      ],
    };
  }

  // Read file content
  const content = await fs.readFile(filePath, 'utf-8');

  // Find the issue section
  const issuePattern = new RegExp(`(### ${args.slug}[\\s\\S]*?#### Investigation Log)`, 'i');
  const match = content.match(issuePattern);

  if (!match) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Could not find Investigation Log section for issue: **${args.slug}**\n\n` +
            'The issue file may have an invalid format.',
        },
      ],
    };
  }

  // Build the new entry
  const date = new Date().toISOString().split('T')[0];
  const sessionId = args.session_id || context.currentSessionId || 'unknown-session';
  const newEntry = `\n\n**${date} (${sessionId}):**\n${args.entry}`;

  // Find where to insert the entry (after Investigation Log header)
  const investigationLogHeader = '#### Investigation Log';
  const insertionPoint = content.indexOf(
    investigationLogHeader,
    content.indexOf(`### ${args.slug}`)
  );

  if (insertionPoint === -1) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Could not locate Investigation Log for issue: **${args.slug}**`,
        },
      ],
    };
  }

  // Find the end of the Investigation Log section (next --- or ## Archived)
  const afterHeader = insertionPoint + investigationLogHeader.length;
  let sectionEnd = content.indexOf('\n---\n', afterHeader);
  if (sectionEnd === -1) {
    sectionEnd = content.indexOf('\n## Archived', afterHeader);
  }
  if (sectionEnd === -1) {
    sectionEnd = content.length;
  }

  // Insert entry at the end of the Investigation Log section
  const newContent = content.slice(0, sectionEnd) + newEntry + content.slice(sectionEnd);

  await fs.writeFile(filePath, newContent, 'utf-8');

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
