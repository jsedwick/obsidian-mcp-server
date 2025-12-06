/**
 * Tool: update_topic_page
 *
 * Update an existing topic page with new information.
 */

import fs from 'fs/promises';
import path from 'path';

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
    const relatedSectionPattern = /\n(## Related (?:Topics|Sessions|Projects|Decisions)[\s\S]*)$/;
    const relatedMatch = existingBody.match(relatedSectionPattern);

    let finalBody: string;
    if (relatedMatch) {
      // Insert new content before Related sections
      const bodyBeforeRelated = existingBody.slice(0, relatedMatch.index);
      const relatedSections = relatedMatch[1];
      finalBody = `${bodyBeforeRelated}\n${newBody}\n${relatedSections}`;
    } else {
      // No Related sections found, append normally
      finalBody = `${existingBody}\n${newBody}`;
    }

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
