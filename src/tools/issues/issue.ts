/**
 * Tool: issue
 *
 * Slash command handler for /issue command.
 * Manages persistent issues across sessions.
 *
 * Modes:
 * - list (default): List all active issues
 * - load: Load specific issue and link to current session
 * - create: Create a new persistent issue
 * - resolve: Archive an issue (requires _invoked_by_slash_command - human only)
 */

import fs from 'fs/promises';
import path from 'path';
import { getPersistentIssues } from './getPersistentIssues.js';

export interface IssueArgs {
  mode?: 'list' | 'load' | 'create' | 'resolve';
  slug?: string;
  name?: string;
  priority?: 'high' | 'medium' | 'low';
  _invoked_by_slash_command?: boolean;
}

export interface IssueResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  linkedIssue?: {
    slug: string;
    priority: string;
  };
}

export interface IssueContext {
  vaultPath: string;
  linkIssueToSession?: (slug: string) => void;
  trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
}

const PERSISTENT_ISSUES_FILE = 'persistent-issues.md';

/**
 * Generate the initial persistent-issues.md file template
 */
function generateInitialTemplate(): string {
  return `---
title: Persistent Issues
category: persistent-issues
created: "${new Date().toISOString().split('T')[0]}"
---

# Persistent Issues

Track long-running problems that span multiple sessions. Issues remain active until explicitly resolved.

## Active Issues

## Archived

`;
}

/**
 * Generate template for a new issue
 */
function generateIssueTemplate(
  slug: string,
  name: string,
  priority: 'high' | 'medium' | 'low'
): string {
  const date = new Date().toISOString().split('T')[0];
  return `
### ${slug}

**Created:** ${date}
**Priority:** ${priority}
**Sessions:** 

${name}

#### Investigation Log

---
`;
}

/**
 * Slugify a name for use as issue identifier
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * List all active issues
 */
async function handleList(context: IssueContext): Promise<IssueResult> {
  const result = await getPersistentIssues({}, context);

  if (!result.hasFile || result.issues.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            '**No active persistent issues.**\n\n' +
            'Use `/issue create <name>` to create a new persistent issue for tracking ' +
            'problems that span multiple sessions.',
        },
      ],
    };
  }

  let text = '**Active Persistent Issues:**\n\n';
  for (const issue of result.issues) {
    const sessionCount = issue.sessions.length;
    text += `**${issue.slug}** (${issue.priority})\n`;
    text += `  Created: ${issue.created} | Sessions: ${sessionCount}\n`;
    if (issue.description) {
      const shortDesc =
        issue.description.length > 100
          ? issue.description.slice(0, 100) + '...'
          : issue.description;
      text += `  ${shortDesc}\n`;
    }
    text += '\n';
  }

  text += '\nUse `/issue <slug>` to load an issue and link this session to it.';

  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * Load a specific issue and link session to it
 */
async function handleLoad(slug: string, context: IssueContext): Promise<IssueResult> {
  const result = await getPersistentIssues({}, context);

  if (!result.hasFile) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ No persistent issues file found. Use \`/issue create <name>\` to create the first issue.`,
        },
      ],
    };
  }

  const issue = result.issues.find(i => i.slug === slug);

  if (!issue) {
    const availableSlugs = result.issues.map(i => i.slug).join(', ');
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Issue not found: **${slug}**\n\n` +
            (availableSlugs
              ? `Available issues: ${availableSlugs}`
              : 'No active issues. Use `/issue create <name>` to create one.'),
        },
      ],
    };
  }

  // Link session to issue
  if (context.linkIssueToSession) {
    context.linkIssueToSession(slug);
  }

  // Format issue content for display
  let text = `📋 **Loaded persistent issue: ${issue.slug}**\n\n`;
  text += `**Status:** Active (${issue.sessions.length} sessions, started ${issue.created})\n`;
  text += `**Priority:** ${issue.priority}\n\n`;

  if (issue.description) {
    text += `**Problem:**\n${issue.description}\n\n`;
  }

  if (issue.investigationLog) {
    text += `**Investigation Log:**\n${issue.investigationLog}\n\n`;
  }

  text += `---\n\n✅ Session linked to this issue. Investigation entries will be recorded.`;

  return {
    content: [{ type: 'text', text }],
    linkedIssue: {
      slug: issue.slug,
      priority: issue.priority,
    },
  };
}

/**
 * Create a new persistent issue
 */
async function handleCreate(
  name: string,
  priority: 'high' | 'medium' | 'low',
  context: IssueContext
): Promise<IssueResult> {
  const filePath = path.join(context.vaultPath, PERSISTENT_ISSUES_FILE);
  const slug = slugify(name);

  // Check if file exists
  let fileExists = false;
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf-8');
    fileExists = true;
  } catch {
    // File doesn't exist, will create it
  }

  // Check if slug already exists
  if (fileExists) {
    const existingResult = await getPersistentIssues({}, context);
    const existingIssue = existingResult.issues.find(i => i.slug === slug);
    if (existingIssue) {
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ Issue with slug **${slug}** already exists.\n\n` +
              `Use \`/issue ${slug}\` to load it, or choose a different name.`,
          },
        ],
      };
    }
  }

  // Create or update the file
  if (!fileExists) {
    content = generateInitialTemplate();
  }

  // Insert new issue into Active Issues section
  const issueTemplate = generateIssueTemplate(slug, name, priority);
  const activeMarker = '## Active Issues';
  const insertPos = content.indexOf(activeMarker) + activeMarker.length;

  const newContent = content.slice(0, insertPos) + '\n' + issueTemplate + content.slice(insertPos);

  await fs.writeFile(filePath, newContent, 'utf-8');

  if (context.trackFileAccess) {
    context.trackFileAccess(filePath, fileExists ? 'edit' : 'create');
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `✅ Created persistent issue: **${slug}**\n\n` +
          `Priority: ${priority}\n\n` +
          `Use \`/issue ${slug}\` to load it and link future sessions to this issue.`,
      },
    ],
  };
}

/**
 * Resolve (archive) a persistent issue
 * REQUIRES _invoked_by_slash_command - human only action
 */
async function handleResolve(
  slug: string,
  invokedBySlashCommand: boolean,
  context: IssueContext
): Promise<IssueResult> {
  // CRITICAL: Enforce human-only resolution
  if (!invokedBySlashCommand) {
    return {
      content: [
        {
          type: 'text',
          text:
            '❌ **Issue resolution requires explicit user action.**\n\n' +
            'Only the `/issue resolve <slug>` command can mark an issue as resolved.\n\n' +
            'This ensures issues are only closed when a human confirms the problem is actually fixed.',
        },
      ],
    };
  }

  const filePath = path.join(context.vaultPath, PERSISTENT_ISSUES_FILE);

  // Read file
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: '❌ No persistent issues file found.',
        },
      ],
    };
  }

  // Find issue in Active section
  const activeStart = content.indexOf('## Active Issues');
  const archivedStart = content.indexOf('## Archived');

  if (activeStart === -1 || archivedStart === -1) {
    return {
      content: [
        {
          type: 'text',
          text: '❌ Invalid persistent issues file format.',
        },
      ],
    };
  }

  const activeSection = content.slice(activeStart, archivedStart);
  const issuePattern = new RegExp(`(\\n### ${slug}\\n[\\s\\S]*?)(?=\\n---\\n|\\n## Archived)`, 'i');
  const issueMatch = activeSection.match(issuePattern);

  if (!issueMatch) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Issue **${slug}** not found in Active Issues.\n\n` +
            'Check the issue slug and try again.',
        },
      ],
    };
  }

  const issueContent = issueMatch[1];
  const resolvedDate = new Date().toISOString().split('T')[0];

  // Add resolved date to the issue
  const resolvedIssue = issueContent.replace(
    /(\*\*Created:\*\* \d{4}-\d{2}-\d{2})/,
    `$1\n**Resolved:** ${resolvedDate}`
  );

  // Remove from Active, add to Archived
  const newActiveSection = activeSection
    .replace(issueContent, '')
    .replace(/\n---\n\s*\n---\n/g, '\n---\n');
  const archivedSection = content.slice(archivedStart);
  const newArchivedSection = archivedSection.replace(
    '## Archived',
    '## Archived\n' + resolvedIssue + '\n---'
  );

  const newContent =
    content.slice(0, activeStart) +
    newActiveSection.replace(/\n\n\n+/g, '\n\n') +
    newArchivedSection;

  await fs.writeFile(filePath, newContent, 'utf-8');

  if (context.trackFileAccess) {
    context.trackFileAccess(filePath, 'edit');
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `✅ Resolved issue: **${slug}**\n\n` +
          `The issue has been moved to the Archived section.\n` +
          `Resolved: ${resolvedDate}`,
      },
    ],
  };
}

export async function issue(args: IssueArgs, context: IssueContext): Promise<IssueResult> {
  const mode = args.mode || 'list';

  switch (mode) {
    case 'list':
      return handleList(context);

    case 'load':
      if (!args.slug) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ Missing slug. Use `/issue <slug>` to load an issue.',
            },
          ],
        };
      }
      return handleLoad(args.slug, context);

    case 'create':
      if (!args.name) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ Missing name. Use `/issue create <name>` to create an issue.',
            },
          ],
        };
      }
      return handleCreate(args.name, args.priority || 'medium', context);

    case 'resolve':
      if (!args.slug) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ Missing slug. Use `/issue resolve <slug>` to resolve an issue.',
            },
          ],
        };
      }
      return handleResolve(args.slug, args._invoked_by_slash_command === true, context);

    default: {
      // Exhaustive check - mode should never reach here
      const unknownMode: string = mode as string;
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ Unknown mode: ${unknownMode}\n\n` +
              'Valid modes: list, load, create, resolve\n\n' +
              'Usage:\n' +
              '- `/issue` - List active issues\n' +
              '- `/issue <slug>` - Load and link to issue\n' +
              '- `/issue create <name>` - Create new issue\n' +
              '- `/issue resolve <slug>` - Archive issue',
          },
        ],
      };
    }
  }
}
