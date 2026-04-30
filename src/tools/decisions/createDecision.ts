/**
 * Tool: create_decision
 *
 * Create an architectural decision record (ADR) in decisions/ directory.
 *
 * USE FOR:
 * - Strategic architectural choices between alternatives (flat vs hierarchical)
 * - Technology selection decisions (which library, framework, or approach)
 * - Organizational decisions with tradeoffs (process changes, standards)
 * - Major design decisions that affect system structure or behavior
 *
 * DO NOT USE FOR:
 * - Bug fixes or implementation details (use create_topic_page instead)
 * - General technical documentation (use create_topic_page instead)
 * - How-to guides or troubleshooting (use create_topic_page instead)
 *
 * A decision should have: context, multiple alternatives considered, rationale for choice, and consequences.
 *
 * CONTENT STYLE: Be direct and concise. State context in 2-3 sentences, list
 * alternatives as brief bullet points with key tradeoffs, and focus rationale
 * on the decisive factors.
 */

import fs from 'fs/promises';
import path from 'path';
import { generateDecisionTemplate } from '../../templates.js';
import { getOrGenerateProjectSlug } from '../../utils/projectSlug.js';
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface CreateDecisionArgs {
  title: string;
  content: string;
  context?: string;
  /** @deprecated Use repo_path instead for automatic slug generation */
  project?: string;
  repo_path?: string;
  force?: boolean;
}

export interface CreateDecisionResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface CreateDecisionContext {
  vaultPath: string;
  currentSessionId: string | null;
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  findRelatedContentInText: (text: string) => Promise<{
    topics: Array<{ link: string; title: string }>;
    decisions: Array<{ link: string; title: string }>;
    projects: Array<{ link: string; name: string }>;
  }>;
  trackDecisionCreation: (decision: { slug: string; title: string; file: string }) => void;
  getRemoteUrl: (repoPath: string) => Promise<string | null>;
  trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
}

export async function createDecision(
  args: CreateDecisionArgs,
  context: CreateDecisionContext
): Promise<CreateDecisionResult> {
  await context.ensureVaultStructure();

  const titleLower = args.title.toLowerCase();
  const contentLower = args.content.toLowerCase();

  // Validation 1: Check if title suggests this should be a topic instead
  const topicKeywords = [
    'fix',
    'bug',
    'issue',
    'implement',
    'how',
    'guide',
    'setup',
    'error',
    'crash',
    'problem',
  ];
  const matchedTopicKeywords = topicKeywords.filter(kw => titleLower.includes(kw));

  if (matchedTopicKeywords.length > 0 && !args.force) {
    return {
      content: [
        {
          type: 'text',
          text: `⚠️  This title suggests it might be better suited as a topic page, not a decision.

Title contains keywords typical of topics: ${matchedTopicKeywords.join(', ')}

DECISIONS are for strategic choices with alternatives considered (e.g., "Flat vs Hierarchical Organization").
TOPICS are for implementation details, bug fixes, and how-to guides (e.g., "Fix search algorithm bug").

If you still want to create this as a decision, provide context that explains the strategic choice and alternatives.
Otherwise, use create_topic_page instead.

To proceed anyway, call create_decision again with force: true.`,
        },
      ],
    };
  }

  // Validation 2: Check if decision indicates alternatives were considered
  const decisionIndicators = [
    'vs',
    'versus',
    'between',
    'alternative',
    'option',
    'approach',
    'choice',
  ];
  const hasDecisionIndicator = decisionIndicators.some(
    indicator => titleLower.includes(indicator) || contentLower.includes(indicator)
  );

  if (!hasDecisionIndicator && !args.force) {
    return {
      content: [
        {
          type: 'text',
          text: `⚠️  This doesn't appear to be a strategic decision with alternatives.

Decisions should document:
  ✅ Multiple alternatives that were considered
  ✅ Why one was chosen over others
  ✅ Trade-offs and consequences

Your title/content doesn't mention alternatives (no "vs", "between", "alternative", "option", etc.)

Examples of proper decisions:
  ✅ "Use Obsidian vs Notion for Context Management"
  ✅ "Flat vs Hierarchical Topic Organization"
  ✅ "CSS-in-JS vs CSS Custom Properties for Theming"

If this documents a single solution/implementation without comparing alternatives, use create_topic_page instead.

To proceed anyway, call create_decision again with force: true.`,
        },
      ],
    };
  }

  // Determine decision scope: project-specific or vault-level
  // Priority: repo_path (auto-generate) > project (manual) > vault (default)
  let scope: string;
  if (args.repo_path) {
    // Reuse the canonical project slug if a project page already exists for
    // this repo path. Falls back to remote-URL-derived slug only when no
    // project page is found. Prevents drift when a repo's remote URL changes
    // and a fresh slug would otherwise split decisions across two directories.
    const remoteUrl = await context.getRemoteUrl(args.repo_path);
    const projectsDir = path.join(context.vaultPath, 'projects');
    scope = await getOrGenerateProjectSlug(args.repo_path, remoteUrl, projectsDir);
  } else {
    scope = args.project || 'vault';
  }
  const decisionsDir = path.join(context.vaultPath, 'decisions', scope);

  // Ensure the project-specific or vault directory exists
  try {
    await fs.mkdir(decisionsDir, { recursive: true });
  } catch {
    // Directory might already exist, that's fine
  }

  // Read existing decision files to determine next number
  const files = await fs.readdir(decisionsDir);
  const decisionNumbers = files
    .filter(f => f.match(/^\d{3}-/))
    .map(f => parseInt(f.split('-')[0]))
    .filter(n => !isNaN(n));

  const nextNumber = decisionNumbers.length > 0 ? Math.max(...decisionNumbers) + 1 : 1;
  const numberStr = String(nextNumber).padStart(3, '0');
  const slug = context.slugify(args.title);
  const decisionFile = path.join(decisionsDir, `${numberStr}-${slug}.md`);
  const today = getTodayLocal();

  const content = generateDecisionTemplate({
    number: numberStr,
    title: args.title,
    date: today,
    context: args.context,
    content: args.content,
    currentSessionId: context.currentSessionId || undefined,
  });

  await fs.writeFile(decisionFile, content);

  // Track decision creation for lazy session creation
  context.trackDecisionCreation({
    slug: `${numberStr}-${slug}`,
    title: args.title,
    file: decisionFile,
  });

  // Proactively search for related content based on decision title and content
  const searchText = `${args.title} ${args.content} ${args.context || ''}`;
  const relatedContent = await context.findRelatedContentInText(searchText);

  // Add related topics and projects to decision page if found
  if (relatedContent.topics.length > 0 || relatedContent.projects.length > 0) {
    let updatedContent = await fs.readFile(decisionFile, 'utf-8');

    if (relatedContent.topics.length > 0) {
      const topicLinks = relatedContent.topics.map(t => `- [[${t.link}|${t.title}]]`).join('\n');
      updatedContent = updatedContent.replace(
        '## Related Topics\n',
        `## Related Topics\n${topicLinks}\n`
      );
    }

    if (relatedContent.projects.length > 0) {
      const projectLinks = relatedContent.projects.map(p => `- [[${p.link}|${p.name}]]`).join('\n');
      updatedContent = updatedContent.replace(
        '## Related Projects\n',
        `## Related Projects\n${projectLinks}\n`
      );
    }

    await fs.writeFile(decisionFile, updatedContent);
  }

  // Track file access for two-phase close workflow (ensures vault_custodian processes this file)
  if (context.trackFileAccess) {
    context.trackFileAccess(decisionFile, 'create');
  }

  const scopeMsg = scope === 'vault' ? ' (vault-level)' : ` (project: ${scope})`;
  return {
    content: [
      {
        type: 'text',
        text: `Decision record created${scopeMsg}: ${decisionFile}\nDecision number: ${numberStr}${relatedContent.topics.length > 0 ? `\n\nFound ${relatedContent.topics.length} related topic(s):` + relatedContent.topics.map(t => `\n- ${t.title}`).join('') : ''}${relatedContent.projects.length > 0 ? `\n\nFound ${relatedContent.projects.length} related project(s):` + relatedContent.projects.map(p => `\n- ${p.name}`).join('') : ''}`,
      },
    ],
  };
}
