/**
 * Tool: get_topic_context
 *
 * Description: Retrieve the full context from a topic file. Load full topic content when you need
 * complete, authoritative information. Topics are living documents that represent the gold standard
 * for their subject matter.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface GetTopicContextArgs {
  topic: string;
}

export interface GetTopicContextResult {
  content: Array<{ type: string; text: string }>;
}

export async function getTopicContext(
  args: GetTopicContextArgs,
  context: {
    vaultPath: string;
    slugify: (text: string) => string;
  }
): Promise<GetTopicContextResult> {
  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);

  try {
    await fs.access(topicFile);
  } catch {
    throw new Error(`Topic not found: ${args.topic}. Use search_vault to find available topics, or create_topic_page to create a new one.`);
  }

  const content = await fs.readFile(topicFile, 'utf-8');

  // Parse frontmatter to extract title
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let title = args.topic;

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/title:\s*(.+)/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      // Remove surrounding quotes if present
      if ((title.startsWith('"') && title.endsWith('"')) ||
          (title.startsWith("'") && title.endsWith("'"))) {
        title = title.slice(1, -1);
      }
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Topic context for "${title}" (topics/${slug}.md):\n\n${content}`,
      },
    ],
  };
}
