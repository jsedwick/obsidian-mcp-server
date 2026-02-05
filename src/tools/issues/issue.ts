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
 *
 * Uses directory-based structure:
 * - persistent-issues/*.md for active issues
 * - archive/persistent-issues/*.md for resolved issues
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { getPersistentIssues } from './getPersistentIssues.js';
import { migrateIfNeeded, slugify } from './migration.js';
import {
  generatePersistentIssueTemplate,
  validatePersistentIssueFrontmatter,
} from '../../templates.js';
import type { PersistentIssueFrontmatter } from '../../templates.js';
import { getTodayLocal } from '../../utils/dateFormat.js';

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

const ISSUES_DIR = 'persistent-issues';
const ARCHIVE_DIR = 'archive/persistent-issues';

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

  // Filter to only active issues
  const activeIssues = result.issues.filter(i => i.status === 'active');

  if (activeIssues.length === 0) {
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
  for (const issue of activeIssues) {
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
  // Ensure migration has been performed
  await migrateIfNeeded(context.vaultPath);

  const filePath = path.join(context.vaultPath, ISSUES_DIR, `${slug}.md`);

  // Check if issue file exists
  let fileExists = false;
  try {
    await fs.access(filePath);
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  if (!fileExists) {
    // Check if it might be in archive
    const archivePath = path.join(context.vaultPath, ARCHIVE_DIR, `${slug}.md`);
    let inArchive = false;
    try {
      await fs.access(archivePath);
      inArchive = true;
    } catch {
      // Not in archive either
    }

    if (inArchive) {
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ Issue **${slug}** is resolved and archived.\n\n` +
              'Resolved issues cannot be loaded. Create a new issue if needed.',
          },
        ],
      };
    }

    // List available issues
    const result = await getPersistentIssues({}, context);
    const activeIssues = result.issues.filter(i => i.status === 'active');
    const availableSlugs = activeIssues.map(i => i.slug).join(', ');

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

  // Read and parse issue file
  const content = await fs.readFile(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(content);

  if (!validatePersistentIssueFrontmatter(frontmatter)) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Invalid issue file format for **${slug}**.\n\n` +
            'The issue file has invalid or missing frontmatter.',
        },
      ],
    };
  }

  const fm = frontmatter;

  // Extract description and investigation log
  const investigationStart = body.indexOf('## Investigation Log');
  let description = '';
  let investigationLog = '';

  if (investigationStart > -1) {
    description = body
      .slice(0, investigationStart)
      .replace(/^#\s+[^\n]+\n*/, '')
      .trim();
    investigationLog = body.slice(investigationStart + '## Investigation Log'.length).trim();
  } else {
    description = body.replace(/^#\s+[^\n]+\n*/, '').trim();
  }

  // Link session to issue
  if (context.linkIssueToSession) {
    context.linkIssueToSession(slug);
  }

  // Track file read
  if (context.trackFileAccess) {
    context.trackFileAccess(filePath, 'read');
  }

  // Format issue content for display
  let text = `📋 **Loaded persistent issue: ${slug}**\n\n`;
  text += `**Status:** Active (${fm.sessions.length} sessions, started ${fm.created})\n`;
  text += `**Priority:** ${fm.priority}\n\n`;

  if (description && description !== '_No description provided_') {
    text += `**Problem:**\n${description}\n\n`;
  }

  if (investigationLog) {
    text += `**Investigation Log:**\n${investigationLog}\n\n`;
  }

  text += `---\n\n✅ Session linked to this issue. Investigation entries will be recorded.`;

  return {
    content: [{ type: 'text', text }],
    linkedIssue: {
      slug,
      priority: fm.priority,
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
  // Ensure migration has been performed
  await migrateIfNeeded(context.vaultPath);

  const slug = slugify(name);
  const issuesDirPath = path.join(context.vaultPath, ISSUES_DIR);
  const filePath = path.join(issuesDirPath, `${slug}.md`);

  // Check if slug already exists
  let fileExists = false;
  try {
    await fs.access(filePath);
    fileExists = true;
  } catch {
    // File doesn't exist - good
  }

  if (fileExists) {
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

  // Also check archive
  const archivePath = path.join(context.vaultPath, ARCHIVE_DIR, `${slug}.md`);
  let inArchive = false;
  try {
    await fs.access(archivePath);
    inArchive = true;
  } catch {
    // Not in archive - good
  }

  if (inArchive) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ A resolved issue with slug **${slug}** already exists in archive.\n\n` +
            'Choose a different name for the new issue.',
        },
      ],
    };
  }

  // Create issues directory if needed
  await fs.mkdir(issuesDirPath, { recursive: true });

  // Generate issue content
  const date = getTodayLocal();
  const content = generatePersistentIssueTemplate({
    slug,
    title: name,
    created: date,
    priority,
    description: name,
  });

  await fs.writeFile(filePath, content, 'utf-8');

  if (context.trackFileAccess) {
    context.trackFileAccess(filePath, 'create');
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

  // Ensure migration has been performed
  await migrateIfNeeded(context.vaultPath);

  const filePath = path.join(context.vaultPath, ISSUES_DIR, `${slug}.md`);
  const archivePath = path.join(context.vaultPath, ARCHIVE_DIR, `${slug}.md`);

  // Check if issue file exists
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Issue **${slug}** not found in active issues.\n\n` +
            'Check the issue slug and try again.',
        },
      ],
    };
  }

  const { data: frontmatter, content: body } = matter(content);

  if (!validatePersistentIssueFrontmatter(frontmatter)) {
    return {
      content: [
        {
          type: 'text',
          text:
            `❌ Invalid issue file format for **${slug}**.\n\n` +
            'The issue file has invalid or missing frontmatter.',
        },
      ],
    };
  }

  const fm = frontmatter;
  const resolvedDate = getTodayLocal();

  // Update frontmatter
  const updatedFrontmatter: PersistentIssueFrontmatter = {
    ...fm,
    status: 'resolved',
    resolved: resolvedDate,
  };

  // Generate updated content
  const updatedContent = `---
title: "${updatedFrontmatter.title}"
category: ${updatedFrontmatter.category}
status: "${updatedFrontmatter.status}"
created: "${updatedFrontmatter.created}"
priority: "${updatedFrontmatter.priority}"
resolved: "${updatedFrontmatter.resolved}"
sessions: ${JSON.stringify(updatedFrontmatter.sessions)}
---
${body}`;

  // Ensure archive directory exists
  await fs.mkdir(path.dirname(archivePath), { recursive: true });

  // Move to archive
  await fs.writeFile(archivePath, updatedContent, 'utf-8');
  await fs.unlink(filePath);

  if (context.trackFileAccess) {
    context.trackFileAccess(archivePath, 'create');
    context.trackFileAccess(filePath, 'edit');
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `✅ Resolved issue: **${slug}**\n\n` +
          `The issue has been moved to the archive.\n` +
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
