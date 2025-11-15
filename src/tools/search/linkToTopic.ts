/**
 * Tool: link_to_topic
 *
 * Description: Get the Obsidian link format for a topic, creating the page if it doesn't exist.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface LinkToTopicArgs {
  topic: string;
}

export interface LinkToTopicResult {
  content: Array<{ type: string; text: string }>;
}

export async function linkToTopic(
  args: LinkToTopicArgs,
  context: {
    vaultPath: string;
    slugify: (text: string) => string;
    createTopicPage: (args: { topic: string; content: string }) => Promise<any>;
  }
): Promise<LinkToTopicResult> {
  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);

  try {
    await fs.access(topicFile);
  } catch {
    // Create minimal topic page if it doesn't exist
    await context.createTopicPage({
      topic: args.topic,
      content: 'Topic created automatically via link.',
    });
  }

  return {
    content: [
      {
        type: 'text',
        text: `[[topics/${slug}|${args.topic}]]`,
      },
    ],
  };
}
