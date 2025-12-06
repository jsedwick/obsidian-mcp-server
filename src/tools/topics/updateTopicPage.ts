/**
 * Tool: update_topic_page
 *
 * Update an existing topic page with new information.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Find the position of Related sections that are NOT inside code blocks.
 * Returns the index of the first real Related section, or -1 if none found.
 */
function findRealRelatedSectionIndex(content: string): number {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let relatedStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code block state (triple backticks)
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip if we're inside a code block
    if (inCodeBlock) {
      continue;
    }

    // Check for Related section headers (not inside code blocks)
    if (/^## Related (?:Topics|Sessions|Projects|Decisions|Git Commits)/.test(line)) {
      relatedStartLine = i;
      break;
    }
  }

  if (relatedStartLine === -1) {
    return -1;
  }

  // Calculate character index from line number
  let charIndex = 0;
  for (let i = 0; i < relatedStartLine; i++) {
    charIndex += lines[i].length + 1; // +1 for newline
  }

  return charIndex;
}

/**
 * Smart append that inserts content before Related sections,
 * but only if those sections are not inside code blocks.
 */
function smartAppendContent(existingBody: string, newBody: string): string {
  const relatedIndex = findRealRelatedSectionIndex(existingBody);

  if (relatedIndex > 0) {
    // Insert new content before Related sections
    const bodyBeforeRelated = existingBody.slice(0, relatedIndex);
    const relatedSections = existingBody.slice(relatedIndex);
    return `${bodyBeforeRelated}\n${newBody}\n${relatedSections}`;
  } else {
    // No Related sections found outside code blocks, append normally
    return `${existingBody}\n${newBody}`;
  }
}

export interface UpdateTopicPageArgs {
  topic: string;
  content: string;
  append?: boolean;
}

export interface UpdateTopicPageResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface UpdateTopicPageContext {
  vaultPath: string;
  slugify: (text: string) => string;
  createTopicPage: (args: {
    topic: string;
    content: string;
    auto_analyze?: boolean | 'true' | 'smart';
  }) => Promise<UpdateTopicPageResult>;
  trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
}

export async function updateTopicPage(
  args: UpdateTopicPageArgs,
  context: UpdateTopicPageContext
): Promise<UpdateTopicPageResult> {
  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);

  try {
    await fs.access(topicFile);
  } catch {
    // Topic doesn't exist, create it
    return await context.createTopicPage({ topic: args.topic, content: args.content });
  }

  const append = args.append !== false;

  if (append) {
    const existing = await fs.readFile(topicFile, 'utf-8');

    // Extract frontmatter and body from existing content
    const frontmatterMatch = existing.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
    const existingBody = frontmatterMatch ? frontmatterMatch[2] : existing;

    // Strip frontmatter from new content if present
    const newBodyMatch =
      args.content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/) || args.content.match(/^([\s\S]*)$/);
    const newBody = newBodyMatch ? newBodyMatch[1] : args.content;

    // Update last_reviewed date in frontmatter (per Decision 011)
    const today = new Date().toISOString().split('T')[0];
    const frontmatterLines = frontmatter.split('\n');
    const lastReviewedIndex = frontmatterLines.findIndex(line =>
      line.trim().startsWith('last_reviewed:')
    );

    if (lastReviewedIndex >= 0) {
      // Update existing last_reviewed
      frontmatterLines[lastReviewedIndex] = `last_reviewed: ${today}`;
    } else {
      // Add last_reviewed if not present
      frontmatterLines.push(`last_reviewed: ${today}`);
    }

    const updatedFrontmatter = frontmatterLines.join('\n');

    // Smart append: insert before Related sections if they exist at the end
    // This prevents new content from being placed after Related Topics/Sessions/etc.
    // IMPORTANT: Must ignore Related sections inside code blocks
    const finalBody = smartAppendContent(existingBody, newBody);

    // Reconstruct file with updated frontmatter + modified body
    const newContent = `---\n${updatedFrontmatter}\n---\n${finalBody}`;
    await fs.writeFile(topicFile, newContent);
  } else {
    await fs.writeFile(topicFile, args.content);
  }

  // Track file access for two-phase close workflow (ensures vault_custodian processes this file)
  if (context.trackFileAccess) {
    context.trackFileAccess(topicFile, 'edit');
  }

  return {
    content: [
      {
        type: 'text',
        text: `Topic page updated: ${topicFile}`,
      },
    ],
  };
}
