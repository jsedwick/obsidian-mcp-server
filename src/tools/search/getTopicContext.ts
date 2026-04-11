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

export interface GetTopicContextStructuredResult {
  title: string;
  slug: string;
  category: string;
  created: string;
  last_reviewed: string;
  tags: string[];
  review_count: number;
  file_path: string;
  body: string;
}

export interface GetTopicContextResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: GetTopicContextStructuredResult;
}

/**
 * Parse topic frontmatter into structured fields.
 */
function parseTopicFrontmatter(
  content: string,
  slug: string,
  filePath: string
): { title: string; structured: GetTopicContextStructuredResult; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!frontmatterMatch) {
    return {
      title: slug,
      structured: {
        title: slug,
        slug,
        category: '',
        created: '',
        last_reviewed: '',
        tags: [],
        review_count: 0,
        file_path: filePath,
        body: content,
      },
      body: content,
    };
  }

  const fm = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  const getField = (name: string): string => {
    const match = fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, 'm'));
    return match ? match[1].trim() : '';
  };

  // Parse YAML array in either inline [...] or multi-line "- item" format
  const getArrayField = (name: string): string[] => {
    // Inline format: tags: ["a", "b"]
    const inlineMatch = fm.match(new RegExp(`^${name}:\\s*\\[([^\\]]*)\\]`, 'm'));
    if (inlineMatch) {
      return inlineMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    // Multi-line format:
    // tags:
    //   - a
    //   - b
    const multiMatch = fm.match(new RegExp(`^${name}:\\s*\\n((?:\\s+-\\s+.+\\n?)*)`, 'm'));
    if (multiMatch) {
      return multiMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s+-\s+/, '').trim())
        .filter(Boolean);
    }
    return [];
  };

  let title = getField('title');
  // Remove surrounding quotes if present
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }
  if (!title) title = slug;

  const reviewCountStr = getField('review_count');

  const structured: GetTopicContextStructuredResult = {
    title,
    slug,
    category: getField('category'),
    created: getField('created'),
    last_reviewed: getField('last_reviewed'),
    tags: getArrayField('tags'),
    review_count: reviewCountStr ? parseInt(reviewCountStr, 10) || 0 : 0,
    file_path: filePath,
    body,
  };

  return { title, structured, body };
}

export async function getTopicContext(
  args: GetTopicContextArgs,
  context: {
    vaultPath: string;
    slugify: (text: string) => string;
    trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
  }
): Promise<GetTopicContextResult> {
  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);

  try {
    await fs.access(topicFile);
  } catch {
    throw new Error(
      `Topic not found: ${args.topic}. Use search_vault to find available topics, or create_topic_page to create a new one.`
    );
  }

  const content = await fs.readFile(topicFile, 'utf-8');

  // Track file access for enforcement (Decision 041)
  if (context.trackFileAccess) {
    context.trackFileAccess(topicFile, 'read');
  }

  const { title, structured } = parseTopicFrontmatter(content, slug, topicFile);

  return {
    content: [
      {
        type: 'text',
        text: `Topic context for "${title}" (topics/${slug}.md):\n\n${content}`,
      },
    ],
    structuredContent: structured,
  };
}
