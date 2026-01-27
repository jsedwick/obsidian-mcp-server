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
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface CreateTopicPageArgs {
  topic: string;
  content: string;
  auto_analyze?: boolean | 'true' | 'smart';
  skip_duplicate_check?: boolean;
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
  }) =>
    | {
        tags: string[];
        summary: string;
        key_concepts: string[];
        related_topics: string[];
        content_type: string;
      }
    | Promise<{
        tags: string[];
        summary: string;
        key_concepts: string[];
        related_topics: string[];
        content_type: string;
      }>;
  findRelatedProjects: (topicContent: string) => Promise<Array<{ link: string; name: string }>>;
  trackTopicCreation: (topic: { slug: string; title: string; file: string }) => void;
  trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
  searchVault: (args: {
    query: string;
    category?: 'topic' | 'task-list' | 'decision' | 'session' | 'project' | 'commit';
    max_results?: number;
    detail?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * Helper: Check for duplicate topics using semantic search
 */
interface DuplicateCheckResult {
  hasDuplicates: boolean;
  similar: Array<{ path: string; title: string }>;
}

async function checkForDuplicates(
  args: CreateTopicPageArgs,
  context: CreateTopicPageContext
): Promise<DuplicateCheckResult> {
  try {
    // Build search query from title + content preview (first 300 chars)
    const contentPreview = args.content.substring(0, 300).replace(/\n/g, ' ');
    const searchQuery = `${args.topic} ${contentPreview}`;

    // Search for similar topics (category filter, exclude archives)
    const searchResults = await context.searchVault({
      query: searchQuery,
      category: 'topic',
      max_results: 5,
      detail: 'minimal',
    });

    // Parse search results to extract topic paths and titles
    const similar: Array<{ path: string; title: string }> = [];

    if (searchResults.content && searchResults.content.length > 0) {
      const resultText = searchResults.content[0].text;

      // Check if we got zero results
      if (resultText.includes('Found 0 matches')) {
        return { hasDuplicates: false, similar: [] };
      }

      // Extract file paths from search results
      // Format: "**/path/to/file.md**"
      const pathMatches = resultText.matchAll(/\*\*([^*]+\.md)\*\*/g);

      for (const match of pathMatches) {
        const filePath = match[1];

        // Skip archived topics
        if (filePath.includes('/archive/')) {
          continue;
        }

        // Extract topic title from path (filename without .md)
        const filename = filePath.split('/').pop() || '';
        const title = filename.replace('.md', '').replace(/-/g, ' ');

        similar.push({ path: filePath, title });

        // Limit to top 3 matches
        if (similar.length >= 3) {
          break;
        }
      }
    }

    return {
      hasDuplicates: similar.length > 0,
      similar,
    };
  } catch (error) {
    // Silent failure - duplicate detection is non-critical
    console.error(
      `Duplicate check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { hasDuplicates: false, similar: [] };
  }
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

  // Check for duplicate topics (unless explicitly skipped)
  if (!args.skip_duplicate_check) {
    const duplicateCheck = await checkForDuplicates(args, context);

    if (duplicateCheck.hasDuplicates) {
      const similarList = duplicateCheck.similar
        .map((topic, i) => `  ${i + 1}. [[${topic.path}|${topic.title}]]`)
        .join('\n');

      throw new Error(
        `⚠️  Found ${duplicateCheck.similar.length} similar topic(s) that may already cover this content:\n\n` +
          similarList +
          `\n\n` +
          `Consider:\n` +
          `  • Reading these topics to see if they already cover this content\n` +
          `  • Updating an existing topic instead of creating a new one\n` +
          `  • Proceeding if this topic is genuinely different\n\n` +
          `To proceed anyway, call create_topic_page with skip_duplicate_check: true`
      );
    }
  }

  await context.ensureVaultStructure();

  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);
  const today = getTodayLocal();

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
      console.error(
        `Topic analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
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

  // Track file access for two-phase close workflow (ensures vault_custodian processes this file)
  if (context.trackFileAccess) {
    context.trackFileAccess(topicFile, 'create');
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
