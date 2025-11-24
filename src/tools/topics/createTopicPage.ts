/**
 * Tool: create_topic_page
 *
 * Create a technical reference page in topics/ directory.
 *
 * USE FOR:
 * - Technical implementation details, architecture explanations, algorithms
 * - How-to guides, troubleshooting procedures, setup instructions
 * - System behavior documentation and API references
 * - Bug fix summaries, lessons learned, and design patterns
 *
 * DO NOT USE FOR:
 * - Strategic or organizational decisions (use create_decision instead)
 * - Git repository tracking (use create_project_page instead)
 * - Conversation logs (use save_session_note instead)
 */

import fs from 'fs/promises';
import path from 'path';
import { generateTopicTemplate } from '../../templates.js';

export interface CreateTopicPageArgs {
  topic: string;
  content: string;
  auto_analyze?: boolean | 'true' | 'smart';
}

export interface CreateTopicPageResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface CreateTopicPageContext {
  vaultPath: string;
  currentSessionId: string | null;
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  analyzeTopicContentInternal: (args: {
    content: string;
    topic_name?: string;
    context?: string;
  }) => Promise<{
    tags: string[];
    summary: string;
    key_concepts: string[];
    related_topics: string[];
    content_type: string;
  }>;
  findRelatedProjects: (topicContent: string) => Promise<Array<{ link: string; name: string }>>;
  trackTopicCreation: (topic: { slug: string; title: string; file: string }) => void;
}

export async function createTopicPage(
  args: CreateTopicPageArgs,
  context: CreateTopicPageContext
): Promise<CreateTopicPageResult> {
  // Validate that this is appropriate for a topic (not session-specific content)
  const investigationKeywords = [
    'investigation',
    'investigating',
    'bug fix',
    'fixing',
    'debugg',
    'found issue',
    'found problem',
    'discovered',
    'troubleshooting session',
    'worked on',
    'fixed issue',
    'resolved bug',
  ];

  const titleLower = args.topic.toLowerCase();
  const matchedKeyword = investigationKeywords.find(keyword => titleLower.includes(keyword));

  if (matchedKeyword) {
    throw new Error(
      `❌ Topic title contains "${matchedKeyword}" - this appears to be investigation/debugging details, not a topic.\n\n` +
        `Topics should be persistent, reusable knowledge:\n` +
        `  ✅ How-to guides\n` +
        `  ✅ Architecture explanations\n` +
        `  ✅ Troubleshooting procedures (generic)\n` +
        `  ✅ Implementation patterns\n\n` +
        `Investigation details belong in session notes instead.\n\n` +
        `If this is genuinely reusable knowledge, rephrase the title to focus on the solution/pattern, not the investigation.\n` +
        `Example: Instead of "Fixing search bug", use "Search Algorithm Implementation" or "Common Search Issues"`
    );
  }

  await context.ensureVaultStructure();

  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);
  const today = new Date().toISOString().split('T')[0];

  // Determine if we should analyze content
  let shouldAnalyze = false;
  let tags: string[] | undefined = undefined;

  // Handle both boolean true and string "true" (MCP SDK may convert)
  if (args.auto_analyze === true || args.auto_analyze === 'true') {
    shouldAnalyze = true;
  } else if (args.auto_analyze === 'smart') {
    // Smart mode: analyze if content is substantial (>500 words ~2500 chars) and no existing tags
    const wordCount = args.content.split(/\s+/).length;
    const hasExistingTags = args.content.toLowerCase().includes('tags:');
    shouldAnalyze = wordCount >= 500 && !hasExistingTags;
  }

  // Perform analysis if needed
  if (shouldAnalyze) {
    try {
      const analysis = await context.analyzeTopicContentInternal({
        content: args.content,
        topic_name: args.topic,
      });
      tags = analysis.tags;
    } catch (error) {
      // If analysis fails, fall back to default tags
      console.error('Topic analysis failed:', error);
    }
  }

  const content = generateTopicTemplate({
    title: args.topic,
    content: args.content,
    created: today,
    currentSessionId: context.currentSessionId || undefined,
    tags: tags,
  });

  await fs.writeFile(topicFile, content);

  // Track topic creation for lazy session creation
  context.trackTopicCreation({ slug, title: args.topic, file: topicFile });

  // Proactively search for related projects based on topic content
  const relatedProjects = await context.findRelatedProjects(args.content);

  // Add related projects to topic page if found
  if (relatedProjects.length > 0) {
    let updatedContent = await fs.readFile(topicFile, 'utf-8');
    const projectLinks = relatedProjects.map(p => `- [[${p.link}|${p.name}]]`).join('\n');

    updatedContent = updatedContent.replace(
      '## Related Projects\n',
      `## Related Projects\n${projectLinks}\n`
    );

    await fs.writeFile(topicFile, updatedContent);
  }

  return {
    content: [
      {
        type: 'text',
        text: `Topic page created: ${topicFile}\nObsidian link: [[topics/${slug}|${args.topic}]]${relatedProjects.length > 0 ? `\n\nFound ${relatedProjects.length} related project(s):` + relatedProjects.map(p => `\n- ${p.name}`).join('') : ''}`,
      },
    ],
  };
}
