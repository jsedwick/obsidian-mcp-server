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

    // Reconstruct file with preserved frontmatter + appended body
    const newContent = `---\n${frontmatter}\n---\n${existingBody}\n${newBody}`;
    await fs.writeFile(topicFile, newContent);
  } else {
    await fs.writeFile(topicFile, args.content);
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
