/**
 * Tool: close_session
 *
 * Description: Create a session retroactively to capture the work done in this conversation.
 * ONLY callable via the /close slash command. Call this at the end of a conversation to persist the session to the vault.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generateSessionTemplate } from '../../templates.js';
import { analyzeTopicContentInternal } from '../topics/analyzeTopicContent.js';
import type { FileAccess } from '../../models/Session.js';
import type { RepoCandidate } from '../../models/Git.js';
import type { RelatedTopic } from '../git/analyzeCommitImpact.js';
import { GitError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';

const execAsync = promisify(exec);
const logger = createLogger('closeSession');

/**
 * Generate automatic handoff notes based on session activity (Decision 046).
 * Analyzes what was accomplished and suggests what might need follow-up.
 *
 * @param params Session analysis parameters
 * @returns Formatted handoff notes for next session
 */
function generateAutomaticHandoff(params: {
  topicsCreated: Array<{ slug: string; title: string }>;
  decisionsCreated: Array<{ slug: string; title: string }>;
  filesEdited: FileAccess[];
  detectedRepo: { name: string; path: string; branch?: string } | null;
  summary: string;
}): string {
  const notes: string[] = [];

  // Extract possible next steps from summary
  const hasNextSteps = /(?:next|todo|need to|should|will|plan to|consider)/i.test(params.summary);
  const hasUnfinished = /(?:incomplete|partial|wip|work in progress|not yet|still need)/i.test(
    params.summary
  );

  // Check for created content that might need follow-up
  if (params.topicsCreated.length > 0) {
    const topicsList = params.topicsCreated.map(t => `[[topics/${t.slug}|${t.title}]]`).join(', ');
    notes.push(
      `📝 **Created topics:** ${topicsList} - Consider expanding with examples or related content.`
    );
  }

  if (params.decisionsCreated.length > 0) {
    const decisionsList = params.decisionsCreated
      .map(d => `[[decisions/${d.slug}|${d.title}]]`)
      .join(', ');
    notes.push(
      `⚖️  **Made decisions:** ${decisionsList} - May need documentation updates or implementation.`
    );
  }

  // Check for code changes
  if (params.filesEdited.length > 0) {
    const nonVaultFiles = params.filesEdited.filter(f => !f.path.includes('/Documents/Obsidian/'));
    if (nonVaultFiles.length > 0) {
      notes.push(
        `💻 **Modified ${nonVaultFiles.length} code file(s)** - Consider adding tests or updating related documentation.`
      );
    }
  }

  // Repository context
  if (params.detectedRepo) {
    notes.push(
      `🔧 **Working on:** ${params.detectedRepo.name}${params.detectedRepo.branch ? ` (${params.detectedRepo.branch})` : ''}`
    );
  }

  // Explicit unfinished work indicators
  if (hasUnfinished) {
    notes.push(
      `⏸️  **Incomplete work mentioned in summary** - Review session notes for specifics.`
    );
  }

  // If summary mentions next steps
  if (hasNextSteps && !hasUnfinished) {
    notes.push(`➡️  **Next steps mentioned in summary** - See above for continuation points.`);
  }

  // If nothing specific was found, provide minimal context
  if (notes.length === 0) {
    return `Session completed. Review summary for details on work accomplished.`;
  }

  return notes.join('\n\n');
}

/**
 * Helper function to infer working directories from file access patterns.
 * Extracts unique Git repository roots from all accessed files.
 * This provides AI-agnostic repository detection as a fallback when
 * working_directories parameter is not provided.
 *
 * @param filesAccessed Array of file access records
 * @returns Array of unique Git repository root paths
 */
async function inferWorkingDirectoriesFromFileAccess(
  filesAccessed: FileAccess[]
): Promise<string[]> {
  const repoPaths = new Set<string>();

  // Extract unique parent directories from accessed files
  const directories = new Set<string>();
  for (const file of filesAccessed) {
    directories.add(path.dirname(file.path));
  }

  // For each directory, search upward to find git repo root
  for (const dir of directories) {
    let currentPath = dir;
    // Search up to 10 levels (reasonable maximum)
    for (let i = 0; i < 10; i++) {
      try {
        const gitDir = path.join(currentPath, '.git');
        await fs.access(gitDir);
        // Found a git repo root
        repoPaths.add(currentPath);
        break;
      } catch {
        // No .git here, try parent
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) break; // Reached filesystem root
        currentPath = parentPath;
      }
    }
  }

  return Array.from(repoPaths);
}

export async function findUnrecordedCommits(
  repoPath: string,
  repoSlug: string,
  vaultPath: string,
  getMostRecentSessionDate: (repoSlug: string) => Promise<Date | null>
): Promise<string[]> {
  try {
    // Get the current branch
    const { stdout: currentBranchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
    });
    const currentBranch = currentBranchOutput.trim();

    // Don't process main/master branch (commits there are historical)
    if (currentBranch === 'main' || currentBranch === 'master') {
      return [];
    }

    // Get most recent session date for this repo
    const lastSessionDate = await getMostRecentSessionDate(repoSlug);
    const sinceDate = lastSessionDate ? lastSessionDate.toISOString().split('T')[0] : null;

    // Get commits on current branch but not on main
    let commitCommand = `git log main..HEAD --format=%H --date=short --no-merges`;
    if (sinceDate) {
      commitCommand += ` --since="${sinceDate}"`;
    }

    const { stdout: commitsOutput } = await execAsync(commitCommand, { cwd: repoPath });
    const commitHashes = commitsOutput
      .trim()
      .split('\n')
      .filter((hash: string) => hash.length > 0);

    if (commitHashes.length === 0) {
      return [];
    }

    // Filter out commits that are already recorded in vault
    const recordedCommits = new Set<string>();
    const commitsDir = path.join(vaultPath, 'projects', repoSlug, 'commits');

    try {
      const files = await fs.readdir(commitsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          // Filename is the short hash
          const shortHash = file.replace('.md', '');
          recordedCommits.add(shortHash);
        }
      }
    } catch {
      // commits directory doesn't exist yet, that's fine
    }

    // Filter to only unrecorded commits
    const unrecordedCommits = commitHashes.filter(hash => {
      const shortHash = hash.substring(0, 7);
      return !recordedCommits.has(shortHash);
    });

    return unrecordedCommits;
  } catch (_error) {
    // If anything fails, just return empty array - this is non-critical
    return [];
  }
}

export async function findSessionCommits(
  repoPath: string,
  sessionStartTime: Date | null
): Promise<string[]> {
  if (!sessionStartTime) {
    return [];
  }

  try {
    const sinceDate = sessionStartTime.toISOString();
    const { stdout: commitsOutput } = await execAsync(
      `git -C "${repoPath}" log --since="${sinceDate}" --format=%H --no-merges`,
      { cwd: repoPath }
    );

    const commitHashes = commitsOutput
      .trim()
      .split('\n')
      .filter((hash: string) => hash.length > 0);

    return commitHashes;
  } catch (error) {
    // If git command fails, throw a GitError
    throw new GitError(`Failed to find session commits: ${repoPath}`, {
      repoPath,
      originalError: (error as Error).message,
    });
  }
}

export async function runPhase1Analysis(
  args: CloseSessionArgs,
  context: CloseSessionContext,
  sessionId: string,
  sessionFile: string,
  sessionContent: string,
  dateStr: string,
  monthDir: string,
  detectedRepoInfo: { path: string; name: string; branch?: string; remote?: string } | null,
  autoCommitMessage: string,
  handoff: string // Required - already generated by parent function
): Promise<CloseSessionResult> {
  // Get session start time - prefer MCP server state, fall back to context override
  let sessionStartTime = context.getSessionStartTime();
  if (!sessionStartTime && args.session_start_override) {
    try {
      sessionStartTime = new Date(args.session_start_override);
      // Validate the parsed date is reasonable (not NaN, not in future, not too old)
      if (isNaN(sessionStartTime.getTime())) {
        sessionStartTime = null;
      }
    } catch {
      sessionStartTime = null;
    }
  }

  // Decision 044 FIX: Remove early return to single-phase mode
  // The previous bypass at this location (!detectedRepoInfo || !sessionStartTime)
  // allowed enforcement to be skipped when repo detection failed.
  // Now we continue with two-phase workflow regardless, just without commit analysis.

  let sessionCommits: string[] = [];
  let commitDetectionError = '';

  if (detectedRepoInfo && sessionStartTime) {
    // Both repo and session start time available - can detect commits
    try {
      sessionCommits = await findSessionCommits(detectedRepoInfo.path, sessionStartTime);
    } catch (error) {
      commitDetectionError = `⚠️  Failed to detect session commits: ${String(error)}\n\n`;
    }
  } else {
    // Missing repo or session start time - can't detect commits but still run two-phase
    // This ensures semantic topic enforcement (Decision 042) cannot be bypassed
    if (!detectedRepoInfo) {
      commitDetectionError += '⚠️  No Git repository detected - commit analysis skipped\n\n';
    }
    if (!sessionStartTime) {
      commitDetectionError += '⚠️  Session start time unknown - commit analysis skipped\n\n';
    }
  }

  // Decision 044: Always run two-phase workflow, never skip to single-phase
  // Even with 0 commits, Phase 2 is required for semantic topic enforcement (Decision 042)
  // The previous early-return to runSinglePhaseClose() bypassed critical enforcement checks

  let commitAnalysisReport = commitDetectionError;
  // Collect commit-related topics for enforcement (Decision 041)
  const commitRelatedTopicsMap = new Map<string, RelatedTopic & { commitHash: string }>();

  if (sessionCommits.length > 0 && detectedRepoInfo) {
    commitAnalysisReport += `

📝 **Commit Analysis (${sessionCommits.length} commit${sessionCommits.length > 1 ? 's' : ''} made during session)**

`;

    for (const commitHash of sessionCommits) {
      try {
        const analysis = await context.analyzeCommitImpact({
          repo_path: detectedRepoInfo.path,
          commit_hash: commitHash,
          include_diff: false,
        });

        if (analysis.content && analysis.content[0]) {
          commitAnalysisReport += `---\n${(analysis.content[0] as { text: string }).text}\n\n`;
        }

        // Collect related topics from this commit (Decision 041)
        if (analysis.relatedTopics) {
          for (const topic of analysis.relatedTopics) {
            const topicPath: string = topic.path;
            if (!commitRelatedTopicsMap.has(topicPath)) {
              const typedTopic: RelatedTopic & { commitHash: string } = {
                path: topic.path,
                title: topic.title,
                relevance: topic.relevance,
                commitHash: commitHash.substring(0, 12),
              };
              commitRelatedTopicsMap.set(topicPath, typedTopic);
            }
          }
        }
      } catch (_error) {
        commitAnalysisReport += `⚠️  Failed to analyze commit ${commitHash.substring(0, 12)}\n\n`;
      }
    }
  }

  // Convert to array for sessionData
  const commitRelatedTopics = Array.from(commitRelatedTopicsMap.values());

  let repoDetectionMessage = '';
  if (detectedRepoInfo) {
    const repoLines = [
      '',
      'Git Repository Auto-Linked:',
      `  Name: ${detectedRepoInfo.name}`,
      `  Path: ${detectedRepoInfo.path}`,
    ];
    if (detectedRepoInfo.branch) repoLines.push(`  Branch: ${detectedRepoInfo.branch}`);
    repoDetectionMessage = repoLines.join('\n');
  }

  const editedOrCreatedFiles = context.filesAccessed
    .filter(
      f => (f.action === 'edit' || f.action === 'create') && f.path.startsWith(context.vaultPath)
    )
    .map(f => f.path);

  const filesToCheck: string[] = [
    sessionFile,
    ...context.topicsCreated.map(t => t.file),
    ...context.decisionsCreated.map(d => d.file),
    ...context.projectsCreated.map(p => p.file),
    ...editedOrCreatedFiles,
  ];

  const uniqueFilesToCheck = Array.from(new Set(filesToCheck));

  // Semantic topic discovery for review (Decision 036)
  const semanticTopicsForReview = await discoverTopicsForReview(args.summary, context);
  const semanticTopicReviewSection = buildSemanticTopicReviewSection(semanticTopicsForReview);

  const sessionData: SessionData = {
    phase: 1, // Mark as Phase 1 output
    sessionId,
    sessionFile,
    sessionContent,
    dateStr,
    monthDir,
    detectedRepoInfo,
    topicsCreated: context.topicsCreated,
    decisionsCreated: context.decisionsCreated,
    projectsCreated: context.projectsCreated,
    filesAccessed: context.filesAccessed,
    filesToCheck: uniqueFilesToCheck,
    repoDetectionMessage,
    autoCommitMessage,
    handoff, // Required handoff (auto-generated if not provided by user)
    sessionCommits, // Pass commit hashes to Phase 2 for recording
    semanticTopicsPresented: semanticTopicsForReview.map(t => ({ path: t.path, title: t.title })),
    // Commit-related topics for enforcement (Decision 041)
    commitRelatedTopics: commitRelatedTopics.length > 0 ? commitRelatedTopics : undefined,
  };

  // Store session_data in MCP server state for context truncation recovery (Decision 048)
  context.storePhase1SessionData(sessionData);

  const summary = args.summary.replace(/"/g, '\\"');
  const topic = args.topic ? `topic: "${args.topic.replace(/"/g, '\\"')}",` : '';

  // Build commit-related topics enforcement section (Decision 041)
  let commitTopicsEnforcementSection = '';
  if (commitRelatedTopics.length > 0) {
    commitTopicsEnforcementSection =
      '\n\n---\n\n' +
      '⚠️ **COMMIT-RELATED TOPICS - REVIEW REQUIRED (Decision 041)**\n\n' +
      'The following topics were identified as potentially affected by commits.\n' +
      '**You MUST read each topic** using `get_topic_context` before finalizing.\n' +
      'Finalization will be BLOCKED if any topic is not reviewed.\n\n' +
      commitRelatedTopics
        .map(
          t =>
            `- **${t.title}**\n` +
            `  - Path: \`${t.path}\`\n` +
            `  - Commit: ${t.commitHash}\n` +
            `  - Reason: ${t.relevance}`
        )
        .join('\n\n') +
      '\n';
  }

  return {
    content: [
      {
        type: 'text',
        text:
          commitAnalysisReport +
          commitTopicsEnforcementSection +
          semanticTopicReviewSection +
          '\n\n---\n\n**Session Analysis Complete**\n\n' +
          (sessionCommits.length === 0
            ? 'No commits were made during this session.'
            : `${sessionCommits.length} commit${sessionCommits.length > 1 ? 's were' : ' was'} made during this session.`) +
          (sessionCommits.length > 0
            ? ' The analysis above identifies topics that may need updating.'
            : '') +
          (commitRelatedTopics.length > 0
            ? ` **${commitRelatedTopics.length} commit-related topic(s) MUST be reviewed** before finalization (Decision 041).`
            : '') +
          (semanticTopicsForReview.length > 0
            ? ` **${semanticTopicsForReview.length} semantically-related topic(s) MUST be reviewed** before finalization (Decision 042).`
            : '') +
          '\n\n**INTERNAL WORKFLOW - AI ASSISTANT HANDLES THIS AUTOMATICALLY:**\n\n' +
          (sessionCommits.length > 0
            ? "1. **PROACTIVELY ANALYZE** each commit's impact:\n" +
              '   - Read the analysis suggestions carefully\n' +
              '   - Think beyond direct mentions - consider conceptual relationships\n' +
              '   - Search vault for related topics that might be affected\n' +
              '   - If a commit changes authentication, consider ALL auth-related topics\n' +
              '   - If a commit changes an API, consider topics about usage, integration, examples\n\n'
            : '') +
          (semanticTopicsForReview.length > 0
            ? `${sessionCommits.length > 0 ? '2' : '1'}. **REVIEW SEMANTICALLY RELATED TOPICS** (Decision 042):\n`
            : '1. **REVIEW SEMANTICALLY RELATED TOPICS** (Decision 042):\n') +
          '   - These topics MUST be read (hard enforcement like commit-related topics)\n' +
          '   - Check the semantic topic review section above\n' +
          '   - These topics may need updates even if not directly mentioned in commits\n' +
          '   - Update if session content reveals drift or new information\n\n' +
          `${sessionCommits.length > 0 ? '3' : '2'}. **IMMEDIATELY UPDATE** all affected documentation:\n` +
          '   - **Do NOT ask for user permission** - preventing documentation drift is your core responsibility\n' +
          '   - Use `search_vault` to find related files that need updates\n' +
          '   - Use `update_document` to update ANY file type (topics, decisions, user reference, etc.)\n' +
          "   - **NEVER use Edit/Write directly** - they don't track file access for vault_custodian\n" +
          '   - Create new topics with `create_topic_page` if concepts warrant documentation\n' +
          '   - Always provide `reason` parameter explaining why updating (for audit trail)\n' +
          '   - **Err on the side of updating** rather than leaving documentation outdated\n\n' +
          `${sessionCommits.length > 0 ? '4' : '3'}. **FINALIZE SESSION** - Only when ALL documentation is current, call:\n\n` +
          '```typescript\n' +
          'close_session({\n' +
          `  summary: "${summary}",\n` +
          (topic ? `  ${topic}\n` : '') +
          '  finalize: true,\n' +
          `  session_data: ${JSON.stringify(sessionData, null, 2)}
` +
          '})\n' +
          '```\n\n' +
          '**Note:** Finalization does not need `_invoked_by_slash_command: true`.\n\n' +
          (sessionCommits.length > 0
            ? '**Skip updates ONLY if** you have verified that no topics are affected by analyzing the commit impact and reviewing semantic topics.'
            : '**Skip updates ONLY if** you have verified that no semantic topics need updating after reading each one.'),
      },
    ],
  };
}

/**
 * Extract meaningful keywords from session summary for semantic search
 * Removes stop words and extracts technical terms
 */
function extractKeywords(summary: string): string[] {
  // Common stop words to filter out
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'he',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'that',
    'the',
    'to',
    'was',
    'will',
    'with',
    'we',
    'this',
    'but',
    'they',
    'have',
    'had',
    'what',
    'when',
    'where',
    'who',
    'which',
    'why',
    'how',
    // Generic action words that cause false positives
    'created',
    'updated',
    'added',
    'modified',
    'changed',
    'removed',
    'deleted',
    'fixed',
    'implemented',
    'documented',
    // Generic document/file terms
    'file',
    'files',
    'document',
    'documents',
    'content',
    'section',
    'sections',
    'page',
    'pages',
    // Generic descriptors that match too broadly
    'comprehensive',
    'complete',
    'both',
    'existing',
    'reference',
    'information',
    'details',
    'system',
    'work',
    'using',
    'based',
    'related',
  ]);

  // Extract words, filter stop words, keep significant terms
  const words = summary
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ') // Keep hyphens for technical terms
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));

  // Get unique words
  const uniqueWords = Array.from(new Set(words));

  // Limit to 10 most distinctive keywords to improve search precision
  // Keep first 10 as they appear in order in summary (usually most important)
  return uniqueWords.slice(0, 10);
}

/**
 * Discover topics for review consideration (Decision 036)
 * Returns top 3 semantically-related topics with last_reviewed metadata
 * Used in Phase 1 to prompt documentation review
 *
 * @param summary - Session summary text for keyword extraction
 * @param context - Close session context with searchVault
 * @param precomputedTopics - Optional pre-computed topics to avoid duplicate search
 */
async function discoverTopicsForReview(
  summary: string,
  context: CloseSessionContext,
  precomputedTopics?: Array<{
    path: string;
    title: string;
    similarity?: number;
    _tier?: string;
    _threshold?: number;
    _topicCount?: number;
  }>
): Promise<
  Array<{
    path: string;
    title: string;
    similarity: number;
    lastReviewed: string | null;
    daysSinceReview: number | null;
    _tier?: string;
    _threshold?: number;
    _topicCount?: number;
  }>
> {
  try {
    // Use pre-computed topics if provided, otherwise search
    const topics = precomputedTopics ?? (await discoverRelatedTopics(summary, context));
    const topicsForReview = topics.slice(0, 3);

    // Enrich with last_reviewed metadata
    const enrichedTopics: Array<{
      path: string;
      title: string;
      similarity: number;
      lastReviewed: string | null;
      daysSinceReview: number | null;
      _tier?: string;
      _threshold?: number;
      _topicCount?: number;
    }> = [];

    for (const topic of topicsForReview) {
      try {
        const content = await fs.readFile(topic.path, 'utf-8');
        // Extract last_reviewed from frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let lastReviewed: string | null = null;
        let daysSinceReview: number | null = null;

        if (frontmatterMatch) {
          const lastReviewedMatch = frontmatterMatch[1].match(
            /last_reviewed:\s*(\d{4}-\d{2}-\d{2})/
          );
          if (lastReviewedMatch) {
            lastReviewed = lastReviewedMatch[1];
            const reviewDate = new Date(lastReviewed);
            const today = new Date();
            daysSinceReview = Math.floor(
              (today.getTime() - reviewDate.getTime()) / (1000 * 60 * 60 * 24)
            );
          }
        }

        enrichedTopics.push({
          path: topic.path,
          title: topic.title,
          similarity: topic.similarity ?? 0.0,
          lastReviewed,
          daysSinceReview,
          _tier: topic._tier,
          _threshold: topic._threshold,
          _topicCount: topic._topicCount,
        });
      } catch {
        // If we can't read the file, include it without metadata
        enrichedTopics.push({
          path: topic.path,
          title: topic.title,
          similarity: topic.similarity ?? 0.0,
          lastReviewed: null,
          daysSinceReview: null,
          _tier: topic._tier,
          _threshold: topic._threshold,
          _topicCount: topic._topicCount,
        });
      }
    }

    return enrichedTopics;
  } catch (error) {
    console.error('Topic review discovery failed:', error);
    return [];
  }
}

/**
 * Build the semantic topic review section for Phase 1 output (Decision 049)
 * Shows similarity scores and adaptive threshold tier for transparency
 */
function buildSemanticTopicReviewSection(
  topics: Array<{
    path: string;
    title: string;
    similarity: number;
    lastReviewed: string | null;
    daysSinceReview: number | null;
    _tier?: string;
    _threshold?: number;
    _topicCount?: number;
  }>
): string {
  if (topics.length === 0) {
    return '';
  }

  const tier = topics[0]._tier || 'unknown';
  const threshold = topics[0]._threshold || 0.55;
  const topicCount = topics[0]._topicCount || 0;

  let section = '\n\n---\n\n📚 **Semantic Topic Review (Decision 042)**\n\n';
  section += `Related topics (${topicCount} topics in vault [${tier}], threshold: ${threshold}):\n\n`;

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const slug = path.basename(topic.path, '.md');
    const simScore = topic.similarity.toFixed(2);

    let reviewInfo = '';
    if (topic.daysSinceReview !== null) {
      reviewInfo = ` - ${topic.daysSinceReview} days since review`;
    } else if (topic.lastReviewed === null) {
      reviewInfo = ' - never reviewed';
    }

    section += `${i + 1}. **[[${slug}|${topic.title}]]** (${simScore})${reviewInfo}\n`;
  }

  section +=
    '\n**Action Required:** Read each topic using `get_topic_context`. ' +
    'Evaluate if session content reveals outdated information. ' +
    'Update topics that need changes using `update_document`.';

  return section;
}

/**
 * Calculate adaptive similarity threshold based on vault topic count (Decision 049)
 * Automatically scales as vault grows: small vaults require stronger matches
 */
async function calculateAdaptiveThreshold(
  vaultPath: string
): Promise<{ threshold: number; topicCount: number; tier: string }> {
  try {
    const topicsDir = path.join(vaultPath, 'topics');
    const files = await fs.readdir(topicsDir);

    // Count non-archived .md files
    const topicFiles = files.filter(
      f => f.endsWith('.md') && !f.startsWith('.') && !f.includes('archive')
    );

    const count = topicFiles.length;

    // Tier mapping: more topics = lower threshold (better match likelihood)
    if (count < 25) {
      return { threshold: 0.6, topicCount: count, tier: 'very-small' };
    } else if (count < 50) {
      return { threshold: 0.45, topicCount: count, tier: 'small' };
    } else if (count < 100) {
      return { threshold: 0.45, topicCount: count, tier: 'medium' };
    } else if (count < 200) {
      return { threshold: 0.45, topicCount: count, tier: 'large' };
    } else {
      return { threshold: 0.4, topicCount: count, tier: 'very-large' };
    }
  } catch (error) {
    // Default fallback if directory read fails
    console.error('Failed to count topics for adaptive threshold:', error);
    return { threshold: 0.55, topicCount: 0, tier: 'unknown' };
  }
}

/**
 * Discover related topics using semantic search on session summary
 * Filters to primary vault topics only to avoid cross-vault pollution
 * Applies adaptive threshold based on vault size (Decision 049)
 */
async function discoverRelatedTopics(
  summary: string,
  context: CloseSessionContext
): Promise<
  Array<{
    path: string;
    title: string;
    similarity: number;
    _tier?: string;
    _threshold?: number;
    _topicCount?: number;
  }>
> {
  try {
    // Extract keywords for search
    const keywords = extractKeywords(summary);
    if (keywords.length === 0) {
      return [];
    }

    // Calculate adaptive threshold based on vault size
    const { threshold, topicCount, tier } = await calculateAdaptiveThreshold(context.vaultPath);

    console.log(
      `Semantic discovery: ${topicCount} topics (${tier} vault) → threshold ${threshold}`
    );

    // Search vault with keywords, filtering to topics only
    // Embeddings provide semantic understanding to distinguish contexts
    // (e.g., "California vacation" vs "California AWS region")
    const searchResult = await context.searchVault({
      query: keywords.join(' '),
      max_results: 15, // Get more results to filter down
      detail: 'summary',
      category: 'topic', // Only search topics for semantic discovery
      directories: ['topics'], // Pre-filter to topics directory for better results
    });

    if (!searchResult.content || searchResult.content.length === 0) {
      return [];
    }

    // Parse search results (format: "Search results for...")
    const resultText = (searchResult.content[0] as { text: string }).text;
    const fileMatches = resultText.matchAll(/\*\*(.+?)\*\*/g);

    const topics: Array<{ path: string; title: string; similarity: number }> = [];

    for (const match of fileMatches) {
      const filePath = match[1];

      // Extract similarity score from search result
      // Two possible formats:
      // 1. "[semantic: 27%]" - from indexed search with re-ranking (percentage)
      // 2. "Semantic match (score: 0.850)" - from pure semantic search (decimal)
      const matchIndex = match.index;
      const remainingText = resultText.substring(matchIndex);
      const nextFileMatch = remainingText.indexOf('**', 2); // Find next file
      const sectionText =
        nextFileMatch > 0
          ? remainingText.substring(0, nextFileMatch)
          : remainingText.substring(0, 500); // Limit search area

      // Try percentage format first (more common with indexed search)
      const percentMatch = sectionText.match(/\[semantic:\s*([\d.]+)%\]/);
      const decimalMatch = sectionText.match(/score:\s*([\d.]+)/);
      const similarity = percentMatch
        ? parseFloat(percentMatch[1]) / 100
        : decimalMatch
          ? parseFloat(decimalMatch[1])
          : 0.0;

      // Filter: Only include topics from primary vault
      if (
        filePath.startsWith(context.vaultPath) && // In primary vault
        filePath.includes('/topics/') && // Is a topic file
        !filePath.includes('/archive/') // Not archived
      ) {
        // Apply adaptive threshold filter (Decision 049)
        if (similarity < threshold) {
          continue; // Skip topics below threshold
        }

        // Quality check: Read topic and verify meaningful keyword matches
        try {
          const topicContent = await fs.readFile(filePath, 'utf-8');
          const contentLower = topicContent.toLowerCase();

          // Count how many keywords appear in topic content
          const matchCount = keywords.filter(keyword => {
            // Skip single-char or very short keywords
            if (keyword.length < 4) return false;
            return contentLower.includes(keyword);
          }).length;

          // Require at least 3 keyword matches OR very high similarity (≥0.75)
          // This prevents false positives from single generic term matches
          if (matchCount < 3 && similarity < 0.75) {
            continue; // Skip this topic
          }
        } catch {
          // If can't read file, skip it
          continue;
        }

        // Extract topic title from filename
        const fileName = path.basename(filePath, '.md');
        const title = fileName
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        topics.push({ path: filePath, title, similarity });

        // Limit to top 5 topics
        if (topics.length >= 5) {
          break;
        }
      }
    }

    // Attach metadata for Phase 1 output
    return topics.map(t => ({
      ...t,
      _tier: tier,
      _threshold: threshold,
      _topicCount: topicCount,
    }));
  } catch (error) {
    // Silent failure - discovery is non-critical
    console.error('Topic discovery failed:', error);
    return [];
  }
}

/**
 * Calculate adaptive similarity threshold for decision discovery based on decision count
 * More decisions = lower threshold (better match likelihood in larger corpus)
 * Decision 049 pattern applied to decisions
 */
async function calculateDecisionAdaptiveThreshold(
  vaultPath: string
): Promise<{ threshold: number; decisionCount: number; tier: string }> {
  try {
    const decisionsDir = path.join(vaultPath, 'decisions');
    const projects = await fs.readdir(decisionsDir);

    // Count non-archived .md files across all project directories
    let decisionCount = 0;
    for (const project of projects) {
      const projectPath = path.join(decisionsDir, project);
      try {
        const stat = await fs.stat(projectPath);
        if (stat.isDirectory() && !project.startsWith('.')) {
          const files = await fs.readdir(projectPath);
          const decisionFiles = files.filter(
            f => f.endsWith('.md') && !f.startsWith('.') && !f.includes('archive')
          );
          decisionCount += decisionFiles.length;
        }
      } catch {
        // Skip if can't read directory
        continue;
      }
    }

    // Tier mapping: more decisions = lower threshold (better match likelihood)
    if (decisionCount < 25) {
      return { threshold: 0.6, decisionCount, tier: 'very-small' };
    } else if (decisionCount < 50) {
      return { threshold: 0.45, decisionCount, tier: 'small' };
    } else if (decisionCount < 100) {
      return { threshold: 0.45, decisionCount, tier: 'medium' };
    } else if (decisionCount < 200) {
      return { threshold: 0.45, decisionCount, tier: 'large' };
    } else {
      return { threshold: 0.4, decisionCount, tier: 'very-large' };
    }
  } catch (error) {
    // Default fallback if directory read fails
    console.error('Failed to count decisions for adaptive threshold:', error);
    return { threshold: 0.55, decisionCount: 0, tier: 'unknown' };
  }
}

/**
 * Discover related decisions using semantic search on session summary
 * Filters to primary vault decisions only to avoid cross-vault pollution
 * Applies adaptive threshold based on decision count (Decision 049 pattern)
 */
async function discoverRelatedDecisions(
  summary: string,
  context: CloseSessionContext
): Promise<Array<{ path: string; title: string; projectSlug: string; similarity: number }>> {
  try {
    // Extract keywords for search
    const keywords = extractKeywords(summary);
    if (keywords.length === 0) {
      return [];
    }

    // Calculate adaptive threshold based on decision corpus size
    const { threshold, decisionCount, tier } = await calculateDecisionAdaptiveThreshold(
      context.vaultPath
    );

    console.log(
      `Decision discovery: ${decisionCount} decisions (${tier} vault) → threshold ${threshold}`
    );

    // Search vault with keywords, filtering to decisions only
    const searchResult = await context.searchVault({
      query: keywords.join(' '),
      max_results: 15, // Get more results to filter down
      detail: 'summary',
      category: 'decision', // Only search decisions for semantic discovery
      directories: ['decisions'], // Pre-filter to decisions directory for better results
    });

    if (!searchResult.content || searchResult.content.length === 0) {
      return [];
    }

    // Parse search results (format: "Search results for...")
    const resultText = (searchResult.content[0] as { text: string }).text;
    const fileMatches = resultText.matchAll(/\*\*(.+?)\*\*/g);

    const decisions: Array<{
      path: string;
      title: string;
      projectSlug: string;
      similarity: number;
    }> = [];

    for (const match of fileMatches) {
      const filePath = match[1];

      // Extract similarity score from search result
      // Two possible formats:
      // 1. "[semantic: 27%]" - from indexed search with re-ranking (percentage)
      // 2. "Semantic match (score: 0.850)" - from pure semantic search (decimal)
      const matchIndex = match.index;
      const remainingText = resultText.substring(matchIndex);
      const nextFileMatch = remainingText.indexOf('**', 2); // Find next file
      const sectionText =
        nextFileMatch > 0
          ? remainingText.substring(0, nextFileMatch)
          : remainingText.substring(0, 500); // Limit search area

      // Try percentage format first (more common with indexed search)
      const percentMatch = sectionText.match(/\[semantic:\s*([\d.]+)%\]/);
      const decimalMatch = sectionText.match(/score:\s*([\d.]+)/);
      const similarity = percentMatch
        ? parseFloat(percentMatch[1]) / 100
        : decimalMatch
          ? parseFloat(decimalMatch[1])
          : 0.0;

      // Filter: Only include decisions from primary vault
      // decisions/project-slug/###-decision-name.md
      if (
        filePath.startsWith(context.vaultPath) && // In primary vault
        filePath.includes('/decisions/') && // Is a decision file
        !filePath.includes('/archive/') // Not archived
      ) {
        // Apply adaptive threshold filter
        if (similarity < threshold) {
          continue; // Skip decisions below threshold
        }

        // Quality check: Read decision and verify meaningful keyword matches
        try {
          const decisionContent = await fs.readFile(filePath, 'utf-8');
          const contentLower = decisionContent.toLowerCase();

          // Count how many keywords appear in decision content
          const matchCount = keywords.filter(keyword => {
            // Skip single-char or very short keywords
            if (keyword.length < 4) return false;
            return contentLower.includes(keyword);
          }).length;

          // Require at least 3 keyword matches OR very high similarity (≥0.75)
          // This prevents false positives from single generic term matches
          if (matchCount < 3 && similarity < 0.75) {
            continue; // Skip this decision
          }
        } catch {
          // If can't read file, skip it
          continue;
        }

        // Extract decision info from path
        const relativePath = filePath.substring(context.vaultPath.length + 1);
        const parts = relativePath.split('/');

        if (parts.length >= 3 && parts[0] === 'decisions') {
          const projectSlug = parts[1];
          const fileName = path.basename(filePath, '.md');

          // Extract title from filename (remove number prefix if present)
          const title = fileName
            .replace(/^\d+-/, '') // Remove leading number
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          decisions.push({ path: filePath, title, projectSlug, similarity });

          // Limit to top 5 decisions
          if (decisions.length >= 5) {
            break;
          }
        }
      }
    }

    return decisions;
  } catch (error) {
    // Silent failure - discovery is non-critical
    console.error('Decision discovery failed:', error);
    return [];
  }
}

/**
 * Add discovered related topics to session file content
 * Finds or creates "## Related Topics" section and adds wiki links
 */
function addRelatedTopicsToSession(
  sessionContent: string,
  topics: Array<{ path: string; title: string }>
): string {
  if (topics.length === 0) {
    return sessionContent;
  }

  // Create wiki links for discovered topics
  // Extract slug from path (basename without .md extension) for proper wiki link format
  const topicLinks = topics
    .map(t => {
      const slug = path.basename(t.path, '.md');
      return `- [[${slug}|${t.title}]]`;
    })
    .join('\n');

  // Check if "## Related Topics" section exists
  const relatedTopicsRegex = /## Related Topics\n+(.+?)(?=\n##|$)/s;
  const match = sessionContent.match(relatedTopicsRegex);

  if (match) {
    // Section exists - check if it has content
    const existingContent = match[1].trim();

    if (existingContent === '_None found_' || existingContent === '') {
      // Replace empty section with discovered topics
      return sessionContent.replace(relatedTopicsRegex, `## Related Topics\n${topicLinks}\n`);
    } else {
      // Append to existing content (avoid duplicates)
      const updatedContent = `${existingContent}\n${topicLinks}`;
      return sessionContent.replace(relatedTopicsRegex, `## Related Topics\n${updatedContent}\n`);
    }
  } else {
    // Section doesn't exist - should not happen with template, but handle gracefully
    return sessionContent.replace(
      /## Related Projects/,
      `## Related Topics\n${topicLinks}\n\n## Related Projects`
    );
  }
}

/**
 * Add discovered related decisions to session file content
 * Finds or creates "## Related Decisions" section and adds wiki links
 */
function addRelatedDecisionsToSession(
  sessionContent: string,
  decisions: Array<{ path: string; title: string; projectSlug: string; similarity: number }>
): string {
  if (decisions.length === 0) {
    return sessionContent;
  }

  // Create wiki links for discovered decisions
  // Format: [[decisions/project-slug/###-decision-name|Title]]
  const decisionLinks = decisions
    .map(d => {
      const fileName = path.basename(d.path, '.md');
      return `- [[decisions/${d.projectSlug}/${fileName}|${d.title}]]`;
    })
    .join('\n');

  // Check if "## Related Decisions" section exists
  const relatedDecisionsRegex = /## Related Decisions\n+(.+?)(?=\n##|$)/s;
  const match = sessionContent.match(relatedDecisionsRegex);

  if (match) {
    // Section exists - check if it has content
    const existingContent = match[1].trim();

    if (existingContent === '_None found_' || existingContent === '') {
      // Replace empty section with discovered decisions
      return sessionContent.replace(
        relatedDecisionsRegex,
        `## Related Decisions\n${decisionLinks}\n`
      );
    } else {
      // Append to existing content (avoid duplicates)
      const updatedContent = `${existingContent}\n${decisionLinks}`;
      return sessionContent.replace(
        relatedDecisionsRegex,
        `## Related Decisions\n${updatedContent}\n`
      );
    }
  } else {
    // Section doesn't exist - should not happen with template, but handle gracefully
    return sessionContent.replace(
      /## Related Git Commits/,
      `## Related Decisions\n${decisionLinks}\n\n## Related Git Commits`
    );
  }
}

/**
 * Validate that session summary claims match actual session file content
 * Detects when summary mentions topics/decisions/files that aren't actually linked
 */
function validateSummaryAccuracy(
  summary: string,
  sessionContent: string,
  vaultPath: string
): string[] {
  const warnings: string[] = [];

  // Extract potential topic/decision/file references from summary
  // Look for patterns like "updated X", "created Y", "modified Z"
  const updatePatterns = [
    /updated?\s+(?:the\s+)?([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\s+(?:topic|decision|file)/gi,
    /modified?\s+(?:the\s+)?([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\s+(?:topic|decision|file)/gi,
    /created?\s+(?:the\s+)?([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\s+(?:topic|decision)/gi,
  ];

  const claimedItems = new Set<string>();
  for (const pattern of updatePatterns) {
    const matches = summary.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        // Convert to slug format (lowercase, hyphens)
        const slug = match[1].toLowerCase().trim().replace(/\s+/g, '-');
        claimedItems.add(slug);
      }
    }
  }

  // Extract what's actually in the session file
  const relatedTopicsSection = sessionContent.match(/## Related Topics\n+(.+?)(?=\n##|$)/s);
  const relatedDecisionsSection = sessionContent.match(/## Related Decisions\n+(.+?)(?=\n##|$)/s);
  const filesAccessedSection = sessionContent.match(/## Files Accessed\n+(.+?)(?=\n##|$)/s);

  const linkedSlugs = new Set<string>();

  // Extract slugs from Related Topics
  if (relatedTopicsSection && relatedTopicsSection[1] !== '_None found_') {
    const topicLinks = relatedTopicsSection[1].matchAll(/\[\[([^\]|]+)/g);
    for (const match of topicLinks) {
      // Extract slug from link (handles both [[slug]] and [[topics/slug]])
      const slug = match[1].split('/').pop();
      if (slug) linkedSlugs.add(slug);
    }
  }

  // Extract slugs from Related Decisions
  if (relatedDecisionsSection && relatedDecisionsSection[1] !== '_None found_') {
    const decisionLinks = relatedDecisionsSection[1].matchAll(/\[\[decisions\/[^/]+\/([^\]|]+)/g);
    for (const match of decisionLinks) {
      if (match[1]) linkedSlugs.add(match[1]);
    }
  }

  // Extract file paths from Files Accessed
  if (filesAccessedSection && filesAccessedSection[1] !== '_No files tracked_') {
    const filePaths = filesAccessedSection[1].matchAll(/\] (.+?)$/gm);
    for (const match of filePaths) {
      if (match[1] && match[1].startsWith(vaultPath)) {
        const relativePath = match[1].substring(vaultPath.length + 1);
        if (relativePath.startsWith('topics/') || relativePath.startsWith('decisions/')) {
          const fileName = path.basename(match[1], '.md');
          linkedSlugs.add(fileName);
        }
      }
    }
  }

  // Check for claimed items that aren't in the session file
  for (const claimed of claimedItems) {
    if (!linkedSlugs.has(claimed)) {
      warnings.push(
        `⚠️  Summary claims work on "${claimed}" but it doesn't appear in Related Topics/Decisions or Files Accessed`
      );
    }
  }

  return warnings;
}

/**
 * Convert filesAccessed entries to Related section links in session file
 * This ensures files modified via update_document are linked in the session
 */
function addAccessedFilesLinksToSession(
  sessionContent: string,
  filesAccessed: Array<{ path: string; action: string; timestamp: string }>,
  vaultPath: string
): string {
  if (filesAccessed.length === 0) {
    return sessionContent;
  }

  // Filter to vault files only and categorize by type
  const topicFiles: Array<{ path: string; slug: string; title: string }> = [];
  const decisionFiles: Array<{ path: string; slug: string; title: string; projectSlug: string }> =
    [];
  const projectFiles: Array<{ path: string; slug: string; title: string }> = [];

  for (const file of filesAccessed) {
    // Skip if not in vault
    if (!file.path.startsWith(vaultPath)) continue;

    const relativePath = file.path.substring(vaultPath.length + 1);

    // Categorize by path
    if (relativePath.startsWith('topics/') && !relativePath.includes('/archive/')) {
      const slug = path.basename(file.path, '.md');
      const title = slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      topicFiles.push({ path: file.path, slug, title });
    } else if (relativePath.startsWith('decisions/')) {
      // decisions/project-slug/123-decision-name.md
      const parts = relativePath.split('/');
      if (parts.length >= 3) {
        const projectSlug = parts[1];
        const slug = path.basename(file.path, '.md');
        const title = slug
          .split('-')
          .slice(1)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        decisionFiles.push({ path: file.path, slug, title, projectSlug });
      }
    } else if (relativePath.startsWith('projects/') && relativePath.endsWith('/project.md')) {
      // projects/project-slug/project.md
      const projectSlug = relativePath.split('/')[1];
      const title = projectSlug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      projectFiles.push({ path: file.path, slug: projectSlug, title });
    }
  }

  let updatedContent = sessionContent;

  // Add topic links to "## Related Topics" section
  if (topicFiles.length > 0) {
    const topicLinks = topicFiles.map(t => `- [[${t.slug}|${t.title}]]`).join('\n');

    const relatedTopicsRegex = /## Related Topics\n+(.+?)(?=\n##|$)/s;
    const match = updatedContent.match(relatedTopicsRegex);

    if (match) {
      const existingContent = match[1].trim();
      if (existingContent === '_None found_' || existingContent === '') {
        updatedContent = updatedContent.replace(
          relatedTopicsRegex,
          `## Related Topics\n${topicLinks}\n`
        );
      } else {
        // Filter out duplicates before adding
        const existingLinks = new Set(
          existingContent.match(/\[\[([^\]|]+)/g)?.map(l => l.substring(2)) || []
        );
        const newLinks = topicFiles.filter(t => !existingLinks.has(t.slug));
        if (newLinks.length > 0) {
          const newTopicLinks = newLinks.map(t => `- [[${t.slug}|${t.title}]]`).join('\n');
          updatedContent = updatedContent.replace(
            relatedTopicsRegex,
            `## Related Topics\n${existingContent}\n${newTopicLinks}\n`
          );
        }
      }
    }
  }

  // Add decision links to "## Related Decisions" section
  if (decisionFiles.length > 0) {
    const decisionLinks = decisionFiles
      .map(d => `- [[decisions/${d.projectSlug}/${d.slug}|${d.title}]]`)
      .join('\n');

    const relatedDecisionsRegex = /## Related Decisions\n+(.+?)(?=\n##|$)/s;
    const match = updatedContent.match(relatedDecisionsRegex);

    if (match) {
      const existingContent = match[1].trim();
      if (existingContent === '_None found_' || existingContent === '') {
        updatedContent = updatedContent.replace(
          relatedDecisionsRegex,
          `## Related Decisions\n${decisionLinks}\n`
        );
      } else {
        updatedContent = updatedContent.replace(
          relatedDecisionsRegex,
          `## Related Decisions\n${existingContent}\n${decisionLinks}\n`
        );
      }
    }
  }

  // Project links are handled separately by the repo detection logic
  // So we don't need to add them here

  return updatedContent;
}

export async function runPhase2Finalization(
  _args: CloseSessionArgs,
  context: CloseSessionContext,
  sessionData: SessionData
): Promise<CloseSessionResult> {
  const data = sessionData;

  // ENFORCEMENT CHECK (Decision 041): Require review of commit-related topics
  // This ensures Claude reads each topic identified as potentially affected by commits
  if (data.commitRelatedTopics && data.commitRelatedTopics.length > 0) {
    // Use stored Phase 1 data's filesAccessed (which accumulates file accesses after Phase 1)
    // This fixes the bug where get_topic_context reads weren't persisting across turns
    // Fallback chain: stored Phase 1 data -> args session_data -> current context
    const storedPhase1Data = context.getStoredPhase1SessionData();
    // Check array length, not just truthiness (empty arrays are truthy!)
    const phase1Files =
      (storedPhase1Data?.filesAccessed?.length ?? 0) > 0
        ? storedPhase1Data!.filesAccessed
        : data.filesAccessed || [];
    const allFilesAccessed = [...phase1Files, ...context.filesAccessed];

    // DEBUG: Log enforcement data to diagnose bug
    logger.info('=== ENFORCEMENT DEBUG (Decision 041) ===');
    logger.info('storedPhase1Data exists:', { exists: !!storedPhase1Data });
    logger.info('storedPhase1Data.filesAccessed count:', {
      count: storedPhase1Data?.filesAccessed?.length || 0,
    });
    logger.info('data.filesAccessed count:', { count: data.filesAccessed?.length || 0 });
    logger.info('context.filesAccessed count:', { count: context.filesAccessed?.length || 0 });
    logger.info('allFilesAccessed count:', { count: allFilesAccessed.length });
    logger.info('commitRelatedTopics count:', { count: data.commitRelatedTopics.length });
    logger.info('Topic paths being checked:', {
      topics: data.commitRelatedTopics.map(t => t.path),
    });
    logger.info('All accessed file paths:', {
      files: allFilesAccessed.map(f => `${f.path} (${f.action})`),
    });
    logger.info('=== END ENFORCEMENT DEBUG ===');

    const unreviewedTopics = data.commitRelatedTopics.filter(topic => {
      // Check if topic was accessed (read, edit, or create all count as review)
      return !allFilesAccessed.some(
        f => f.path === topic.path && ['read', 'edit', 'create'].includes(f.action)
      );
    });

    if (unreviewedTopics.length > 0) {
      throw new Error(
        '❌ Commit-Related Topics Not Reviewed (Decision 041)\n\n' +
          `${unreviewedTopics.length} topic(s) were identified as potentially affected by commits but were not examined:\n\n` +
          unreviewedTopics
            .map(
              t =>
                `- **${t.title}**\n` +
                `  Path: ${t.path}\n` +
                `  Commit: ${t.commitHash}\n` +
                `  Reason: ${t.relevance}`
            )
            .join('\n\n') +
          '\n\n**What you must do:**\n' +
          '1. Read each topic using `get_topic_context`\n' +
          '2. Decide if the commit warrants updates to that topic\n' +
          '3. Update topics that need changes using `update_document`\n' +
          '4. Call close_session with finalize: true again after reviewing all topics\n\n' +
          '**Why this is enforced:**\n' +
          'Commit analysis identified these topics as potentially outdated. ' +
          'Reading them ensures you consciously evaluate whether updates are needed.\n\n' +
          'Reference: Decision 041 - Enforce Topic Review for Commit-Related Documentation'
      );
    }
  }

  // ENFORCEMENT CHECK (Decision 042): Require review of semantic topics
  // This ensures Claude reads the top 3 semantically-related topics presented in Phase 1
  if (data.semanticTopicsPresented && data.semanticTopicsPresented.length > 0) {
    // Use stored Phase 1 data's filesAccessed (which accumulates file accesses after Phase 1)
    // This fixes the bug where get_topic_context reads weren't persisting across turns
    // Fallback chain: stored Phase 1 data -> args session_data -> current context
    const storedPhase1Data = context.getStoredPhase1SessionData();
    // Check array length, not just truthiness (empty arrays are truthy!)
    const phase1Files =
      (storedPhase1Data?.filesAccessed?.length ?? 0) > 0
        ? storedPhase1Data!.filesAccessed
        : data.filesAccessed || [];
    const allFilesAccessed = [...phase1Files, ...context.filesAccessed];

    // DEBUG: Log enforcement data to diagnose bug
    logger.info('=== ENFORCEMENT DEBUG (Decision 042) ===');
    logger.info('storedPhase1Data exists:', { exists: !!storedPhase1Data });
    logger.info('storedPhase1Data.filesAccessed count:', {
      count: storedPhase1Data?.filesAccessed?.length || 0,
    });
    logger.info('data.filesAccessed count:', { count: data.filesAccessed?.length || 0 });
    logger.info('context.filesAccessed count:', { count: context.filesAccessed?.length || 0 });
    logger.info('allFilesAccessed count:', { count: allFilesAccessed.length });
    logger.info('semanticTopicsPresented count:', {
      count: data.semanticTopicsPresented.length,
    });
    logger.info('Semantic topic paths being checked:', {
      topics: data.semanticTopicsPresented.map(t => t.path),
    });
    logger.info('All accessed file paths:', {
      files: allFilesAccessed.map(f => `${f.path} (${f.action})`),
    });
    logger.info('=== END ENFORCEMENT DEBUG ===');

    const unreviewedSemanticTopics = data.semanticTopicsPresented.filter(topic => {
      // Check if topic was accessed (read, edit, or create all count as review)
      return !allFilesAccessed.some(
        f => f.path === topic.path && ['read', 'edit', 'create'].includes(f.action)
      );
    });

    if (unreviewedSemanticTopics.length > 0) {
      throw new Error(
        '❌ Semantic Topics Not Reviewed (Decision 042)\n\n' +
          `${unreviewedSemanticTopics.length} semantically-related topic(s) were presented in Phase 1 but were not examined:\n\n` +
          unreviewedSemanticTopics.map(t => `- **${t.title}**\n  Path: ${t.path}`).join('\n\n') +
          '\n\n**What you must do:**\n' +
          '1. Read each topic using `get_topic_context`\n' +
          '2. Evaluate if the session content reveals outdated information\n' +
          '3. Update topics that need changes using `update_document`\n' +
          '4. Call close_session with finalize: true again after reviewing all topics\n\n' +
          '**Why this is enforced:**\n' +
          'Semantic search identified these topics as highly related to this session. ' +
          'If confidence was high enough to surface them in the top 3, they deserve review.\n\n' +
          'Reference: Decision 042 - Extend Hard Enforcement to Semantic Topics'
      );
    }
  }

  // Discover related content using semantic search (run in parallel)
  const [discoveredTopics, discoveredDecisions] = await Promise.all([
    discoverRelatedTopics(_args.summary, context),
    discoverRelatedDecisions(_args.summary, context),
  ]);

  // Batch all content updates in memory before writing to disk
  let updatedContent = data.sessionContent;

  // Add discovered topics
  if (discoveredTopics.length > 0) {
    updatedContent = addRelatedTopicsToSession(updatedContent, discoveredTopics);
  }

  // Add discovered decisions
  if (discoveredDecisions.length > 0) {
    updatedContent = addRelatedDecisionsToSession(updatedContent, discoveredDecisions);
  }

  // Add links for accessed files (topics/decisions modified via update_document)
  updatedContent = addAccessedFilesLinksToSession(
    updatedContent,
    context.filesAccessed,
    context.vaultPath
  );

  // Single write to disk after all in-memory updates
  await fs.writeFile(data.sessionFile, updatedContent);
  data.sessionContent = updatedContent;

  context.setCurrentSession(data.sessionId, data.sessionFile);

  // Record session commits (Phase 2 step 3)
  if (data.sessionCommits && data.sessionCommits.length > 0 && data.detectedRepoInfo) {
    for (const commitHash of data.sessionCommits) {
      try {
        await context.recordCommit({
          repo_path: data.detectedRepoInfo.path,
          commit_hash: commitHash,
        });
        // Commit files are automatically tracked via filesAccessed
      } catch (_error) {
        // Silent failure - commit recording is non-critical
        // If a commit file wasn't created, it won't be in vault_custodian filesToCheck
        // but that's acceptable since the commit still exists in git
      }
    }
  }

  // Dynamic filesToCheck: merge Phase 1 files with any files modified between Phase 1 and Phase 2
  // This catches documentation updates made during commit analysis review
  const phase2EditedFiles = context.filesAccessed
    .filter(
      f => (f.action === 'edit' || f.action === 'create') && f.path.startsWith(context.vaultPath)
    )
    .map(f => f.path);

  const allFilesToCheck = Array.from(
    new Set([
      ...data.filesToCheck,
      ...phase2EditedFiles,
      ...discoveredTopics.map(t => t.path),
      ...discoveredDecisions.map(d => d.path),
    ])
  );

  // Validate that summary claims match actual session file content
  const validationWarnings = validateSummaryAccuracy(
    _args.summary,
    data.sessionContent,
    context.vaultPath
  );
  let validationReport = '';
  if (validationWarnings.length > 0) {
    validationReport =
      '\n\n⚠️  **Summary Validation Warnings:**\n\n' + validationWarnings.join('\n');
  }

  let vaultCustodianReport = '';
  if (allFilesToCheck.length > 0) {
    try {
      const custodianResult = await context.vaultCustodian({
        files_to_check: allFilesToCheck,
      });
      if (custodianResult.content && custodianResult.content[0]) {
        vaultCustodianReport = '\n\n' + (custodianResult.content[0] as { text: string }).text;
      }
    } catch (error) {
      vaultCustodianReport =
        '\n\n⚠️  Vault custodian check failed: ' +
        (error instanceof Error ? error.message : String(error));
    }
  }

  // NOTE: Session state is NOT cleared here - it will be cleared by closeSession() after Phase 2
  // This allows record_commit() and other operations to run while session context is still active

  const lines: string[] = [
    `Session finalized: ${data.sessionId}`,
    `Session file: ${data.sessionFile}`,
  ];

  if (data.topicsCreated.length > 0) {
    lines.push(`Topics linked: ${data.topicsCreated.length}`);
    data.topicsCreated.forEach(t => lines.push(`  - ${t.title}`));
  }

  if (data.decisionsCreated.length > 0) {
    lines.push(`Decisions linked: ${data.decisionsCreated.length}`);
    data.decisionsCreated.forEach(d => lines.push(`  - ${d.title}`));
  }

  if (data.projectsCreated.length > 0) {
    lines.push(`Projects linked: ${data.projectsCreated.length}`);
    data.projectsCreated.forEach(p => lines.push(`  - ${p.name}`));
  }

  if (data.filesAccessed.length > 0) {
    lines.push(`Files accessed: ${data.filesAccessed.length}`);
  }

  return {
    content: [
      {
        type: 'text',
        text:
          lines.join('\n') +
          data.repoDetectionMessage +
          (data.autoCommitMessage || '') +
          validationReport +
          vaultCustodianReport,
      },
    ],
  };
}

export async function runSinglePhaseClose(
  _args: CloseSessionArgs,
  context: CloseSessionContext,
  sessionId: string,
  sessionFile: string,
  sessionContent: string,
  _dateStr: string,
  _monthDir: string,
  detectedRepoInfo: { path: string; name: string; branch?: string; remote?: string } | null,
  autoCommitMessage: string
): Promise<CloseSessionResult> {
  // Discover related content using semantic search (run in parallel)
  const [discoveredTopics, discoveredDecisions] = await Promise.all([
    discoverRelatedTopics(_args.summary, context),
    discoverRelatedDecisions(_args.summary, context),
  ]);

  // Enrich top 3 discovered topics with review metadata (Decision 036)
  // Pass pre-computed topics to avoid duplicate search
  const topicsForReview = await discoverTopicsForReview(_args.summary, context, discoveredTopics);

  // Batch all content updates in memory before writing to disk
  let updatedContent = sessionContent;

  // Add discovered topics
  if (discoveredTopics.length > 0) {
    updatedContent = addRelatedTopicsToSession(updatedContent, discoveredTopics);
  }

  // Add discovered decisions
  if (discoveredDecisions.length > 0) {
    updatedContent = addRelatedDecisionsToSession(updatedContent, discoveredDecisions);
  }

  // Add links for accessed files (topics/decisions modified via update_document)
  updatedContent = addAccessedFilesLinksToSession(
    updatedContent,
    context.filesAccessed,
    context.vaultPath
  );

  // Single write to disk after all in-memory updates
  await fs.writeFile(sessionFile, updatedContent);
  sessionContent = updatedContent;

  context.setCurrentSession(sessionId, sessionFile);

  let repoDetectionMessage = '';
  if (detectedRepoInfo) {
    const repoLines = [
      '',
      'Git Repository Auto-Linked:',
      `  Name: ${detectedRepoInfo.name}`,
      `  Path: ${detectedRepoInfo.path}`,
    ];
    if (detectedRepoInfo.branch) repoLines.push(`  Branch: ${detectedRepoInfo.branch}`);
    repoLines.push('  Project page created/updated');
    if (context.topicsCreated.length > 0) {
      repoLines.push(`  ${context.topicsCreated.length} topic(s) linked to project`);
    }
    repoDetectionMessage = repoLines.join('\n');
  }

  const lines: string[] = [`Session created: ${sessionId}`, `Session file: ${sessionFile}`];

  if (context.topicsCreated.length > 0) {
    lines.push(`Topics linked: ${context.topicsCreated.length}`);
    context.topicsCreated.forEach(t => lines.push(`  - ${t.title}`));
  }

  if (context.decisionsCreated.length > 0) {
    lines.push(`Decisions linked: ${context.decisionsCreated.length}`);
    context.decisionsCreated.forEach(d => lines.push(`  - ${d.title}`));
  }

  if (context.projectsCreated.length > 0) {
    lines.push(`Projects linked: ${context.projectsCreated.length}`);
    context.projectsCreated.forEach(p => lines.push(`  - ${p.name}`));
  }

  if (context.filesAccessed.length > 0) {
    lines.push(`Files accessed: ${context.filesAccessed.length}`);
  }

  const editedOrCreatedFiles = context.filesAccessed
    .filter(
      f => (f.action === 'edit' || f.action === 'create') && f.path.startsWith(context.vaultPath)
    )
    .map(f => f.path);

  const filesToCheck: string[] = [
    sessionFile,
    ...context.topicsCreated.map(t => t.file),
    ...context.decisionsCreated.map(d => d.file),
    ...context.projectsCreated.map(p => p.file),
    ...editedOrCreatedFiles,
    ...discoveredTopics.map(t => t.path), // Add discovered topics for reciprocal linking
    ...discoveredDecisions.map(d => d.path), // Add discovered decisions for reciprocal linking
  ];

  const uniqueFilesToCheck = Array.from(new Set(filesToCheck));

  // Validate that summary claims match actual session file content
  const validationWarnings = validateSummaryAccuracy(
    _args.summary,
    sessionContent,
    context.vaultPath
  );
  let validationReport = '';
  if (validationWarnings.length > 0) {
    validationReport =
      '\n\n⚠️  **Summary Validation Warnings:**\n\n' + validationWarnings.join('\n');
  }

  let vaultCustodianReport = '';
  if (uniqueFilesToCheck.length > 0) {
    try {
      const custodianResult = await context.vaultCustodian({ files_to_check: uniqueFilesToCheck });
      if (custodianResult.content && custodianResult.content[0]) {
        vaultCustodianReport = '\n\n' + (custodianResult.content[0] as { text: string }).text;
      }
    } catch (error) {
      vaultCustodianReport =
        '\n\n⚠️  Vault custodian check failed: ' +
        (error instanceof Error ? error.message : String(error));
    }
  }

  context.clearSessionState();

  // Build semantic topic review section for no-commit sessions (Decision 042)
  // Hard enforcement - these topics are reviewed for linking but not enforced
  // (enforcement only applies to two-phase workflow where topics are presented in Phase 1)
  let semanticReviewNote = '';
  if (topicsForReview.length > 0) {
    semanticReviewNote = '\n\n📚 **Semantically Related Topics** (Decision 042)\n\n';
    semanticReviewNote +=
      'The following topics may be related to this session. Consider reviewing if content is outdated:\n';
    for (const topic of topicsForReview) {
      const slug = path.basename(topic.path, '.md');
      let reviewInfo = '';
      if (topic.daysSinceReview !== null) {
        reviewInfo = ` (${topic.daysSinceReview} days since review)`;
      } else {
        reviewInfo = ' (never reviewed)';
      }
      semanticReviewNote += `  - [[${slug}|${topic.title}]]${reviewInfo}\n`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text:
          lines.join('\n') +
          repoDetectionMessage +
          autoCommitMessage +
          semanticReviewNote +
          validationReport +
          vaultCustodianReport,
      },
    ],
  };
}

export interface CloseSessionArgs {
  summary: string;
  topic?: string;
  handoff?: string; // Optional - auto-generated if not provided (Decision 046)
  _invoked_by_slash_command?: boolean;
  // Phase control for two-phase workflow (Decision 022)
  analyze_only?: boolean; // Phase 1: analyze commits, return suggestions
  finalize?: boolean; // Phase 2: run custodian, save session
  session_data?: SessionData; // Pass state from Phase 1 to Phase 2
  // Working directories from Claude Code environment (fixes repo detection gap)
  // The MCP server's process.cwd() differs from Claude Code's working directory
  working_directories?: string[]; // Claude Code passes its CWD and additional working dirs
  // Session start time override - fallback if MCP server state was lost
  // Claude extracts this from context (SESSION_START_TIME: ...) and passes it back
  session_start_override?: string; // ISO 8601 timestamp
}

/**
 * Session data passed between Phase 1 and Phase 2
 */
export interface SessionData {
  phase: 1 | 2; // Explicit phase tracking to prevent loops
  sessionId: string;
  sessionFile: string;
  sessionContent: string;
  dateStr: string;
  monthDir: string;
  detectedRepoInfo: {
    path: string;
    name: string;
    branch?: string;
    remote?: string;
  } | null;
  topicsCreated: Array<{ slug: string; title: string; file: string }>;
  decisionsCreated: Array<{ slug: string; title: string; file: string }>;
  projectsCreated: Array<{ slug: string; name: string; file: string }>;
  filesAccessed: FileAccess[];
  filesToCheck: string[];
  repoDetectionMessage: string;
  autoCommitMessage?: string;
  handoff: string; // Required - auto-generated if not provided in args
  sessionCommits?: string[]; // Commit hashes made during this session
  // Semantic topic review (Decision 036): Topics presented for review consideration
  semanticTopicsPresented?: Array<{ path: string; title: string }>;
  // Commit-related topics for hard enforcement (Decision 041)
  // These topics MUST be read before Phase 2 can complete
  commitRelatedTopics?: Array<{
    path: string;
    title: string;
    relevance: string;
    commitHash: string;
  }>;
}

export interface CloseSessionResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface CloseSessionContext {
  vaultPath: string;
  allVaultPaths: string[]; // All vault paths (primary + secondary) for filtering during repo detection
  currentSessionId: string | null;
  filesAccessed: FileAccess[];
  topicsCreated: Array<{ slug: string; title: string; file: string }>;
  decisionsCreated: Array<{ slug: string; title: string; file: string }>;
  projectsCreated: Array<{ slug: string; name: string; file: string }>;
  ensureVaultStructure: () => Promise<void>;
  findGitRepos: (startPath: string, maxDepth?: number) => Promise<string[]>;
  getRepoInfo: (
    repoPath: string
  ) => Promise<{ name: string; branch?: string; remote?: string | null }>;
  createProjectPage: (args: { repo_path: string }) => Promise<any>;
  findRelatedContentInText: (text: string) => Promise<{
    topics: Array<{ link: string; title: string }>;
    decisions: Array<{ link: string; title: string }>;
    projects: Array<{ link: string; name: string }>;
  }>;
  vaultCustodian: (args: { files_to_check: string[] }) => Promise<any>;
  recordCommit: (args: { repo_path: string; commit_hash: string }) => Promise<any>;
  analyzeCommitImpact: (args: {
    repo_path: string;
    commit_hash: string;
    include_diff?: boolean;
  }) => Promise<any>;
  updateDocument: (args: {
    file_path: string;
    content: string;
    strategy?: 'append' | 'replace' | 'section-edit';
    reason?: string;
  }) => Promise<any>;
  slugify: (text: string) => string;
  setCurrentSession: (sessionId: string, sessionFile: string) => void;
  clearSessionState: () => void;
  hasPhase1Completed: () => boolean;
  markPhase1Complete: () => void;
  storePhase1SessionData: (data: SessionData) => void;
  getStoredPhase1SessionData: () => SessionData | null;
  getMostRecentSessionDate: (repoSlug: string) => Promise<Date | null>;
  getSessionStartTime: () => Date | null; // Get first file access timestamp
  searchVault: (args: {
    query: string;
    max_results?: number;
    detail?: string;
    category?: 'topic' | 'task-list' | 'decision' | 'session' | 'project' | 'commit';
    directories?: string[];
  }) => Promise<{ content: Array<{ text: string }> }>;
}

export async function closeSession(
  args: CloseSessionArgs,
  context: CloseSessionContext
): Promise<CloseSessionResult> {
  // Enforce that Phase 1 (workflow initiation) can only be called via the /close slash command
  // Phase 2 (finalization) can be called by Claude directly after Phase 1 completes
  const isPhase1 = !args.finalize;

  if (isPhase1 && args._invoked_by_slash_command !== true) {
    throw new Error(
      '❌ The close_session tool can ONLY be called via the /close slash command to start the workflow. Please ask the user to run the /close command to close this session.'
    );
  }

  await context.ensureVaultStructure();

  // Validate session_data is present if finalizing
  // Decision 048: Fallback to stored session_data if context was truncated
  if (args.finalize && !args.session_data) {
    const storedData = context.getStoredPhase1SessionData();
    if (storedData) {
      // Recovered from MCP server state after context truncation
      args.session_data = storedData;
    } else {
      throw new Error(
        '❌ Phase 2 Error: finalize=true requires session_data from Phase 1.\n\n' +
          'The two-phase workflow requires calling close_session twice:\n' +
          '1. First call (Phase 1): Run via /close command with _invoked_by_slash_command: true\n' +
          '   Returns: commit analysis + session_data\n' +
          '2. Second call (Phase 2): Claude calls directly with finalize: true\n' +
          '   Does NOT need _invoked_by_slash_command (only Phase 1 does)\n\n' +
          'Example Phase 2 call:\n' +
          'close_session({\n' +
          '  summary: "...",\n' +
          '  finalize: true,\n' +
          '  session_data: { ...data from Phase 1... }\n' +
          '})'
      );
    }
  }

  // PHASE 2: Finalization mode (Decision 022)
  if (args.finalize) {
    // Validate phase marker to prevent loops
    if (args.session_data!.phase !== 1) {
      throw new Error(
        '❌ Phase 2 Error: session_data.phase must be 1 (from Phase 1 analysis).\n\n' +
          `Received: phase ${args.session_data!.phase}\n\n` +
          'This error prevents accidental loops. Only session_data from Phase 1 can be used for finalization.'
      );
    }

    // Check if session was already finalized (extra safety against loops)
    try {
      await fs.access(args.session_data!.sessionFile);
      // File exists - session already closed
      return {
        content: [
          {
            type: 'text',
            text:
              `⚠️  Session ${args.session_data!.sessionId} was already finalized.\n\n` +
              `File: ${args.session_data!.sessionFile}\n\n` +
              'If you need to make changes, edit the session file directly or create a new session.',
          },
        ],
      };
    } catch {
      // File doesn't exist - proceed with finalization
    }

    // Run Phase 2 finalization (this does NOT clear session state anymore)
    // Wrap in try-finally to ensure state is always cleared, even if Phase 2 fails
    // This allows multiple /close operations in the same Claude Code session
    try {
      const phase2Result = await runPhase2Finalization(args, context, args.session_data!);
      return phase2Result;
    } finally {
      // Clear session state now that Phase 2 is complete (or failed)
      // This allows record_commit() and other post-finalization operations to work if needed
      // AND allows subsequent /close operations in the same session
      context.clearSessionState();
    }
  }

  // Generate session ID from current timestamp and optional topic (using local timezone)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const topicSlug = args.topic ? `_${context.slugify(args.topic)}` : '';
  const sessionId = `${dateStr}_${timeStr}${topicSlug}`;

  // Organize sessions by month
  const monthStr = dateStr.substring(0, 7); // YYYY-MM
  const monthDir = path.join(context.vaultPath, 'sessions', monthStr);
  await fs.mkdir(monthDir, { recursive: true });
  const sessionFile = path.join(monthDir, `${sessionId}.md`);

  // Auto-detect Git repositories BEFORE building session content
  // This allows the project to be included in the session's Projects section
  let detectedRepoInfo: { path: string; name: string; branch?: string; remote?: string } | null =
    null;
  let autoCommitMessage = '';

  // Always attempt repo detection using hybrid approach:
  // 1. Use working_directories parameter if provided (AI-specific, e.g., Claude Code)
  // 2. Infer from filesAccessed if available (AI-agnostic, MCP tool usage)
  // 3. Fall back to process.cwd() as last resort
  try {
    const fallbackCwd = process.env.PWD || process.cwd();

    let searchDirs: string[];
    if (args.working_directories?.length) {
      // Priority 1: AI provided working directories (Claude Code)
      // Sanitize: strip common prefixes from <env> context display format
      searchDirs = args.working_directories.map(dir => {
        return dir
          .replace(/^Working directory:\s*/i, '') // "Working directory: /path"
          .replace(/^Additional working directories?:\s*/i, '') // "Additional working directories: /path"
          .trim();
      });
    } else {
      // Priority 2: Infer from file access patterns (AI-agnostic)
      const inferredDirs = await inferWorkingDirectoriesFromFileAccess(context.filesAccessed);
      if (inferredDirs.length > 0) {
        searchDirs = inferredDirs;
      } else {
        // Priority 3: Fall back to MCP server's cwd
        searchDirs = [fallbackCwd];
      }
    }

    // Search all working directories for Git repos
    const allRepoPaths = new Set<string>();
    for (const dir of searchDirs) {
      try {
        const repos = await context.findGitRepos(dir);
        repos.forEach(r => allRepoPaths.add(r));
      } catch {
        // Skip directories that can't be searched
      }
    }
    let repoPaths = Array.from(allRepoPaths);

    // Filter out repositories inside vault directories (they're just for syncing markdown)
    repoPaths = repoPaths.filter(repoPath => {
      return !context.allVaultPaths.some(
        vaultPath => repoPath === vaultPath || repoPath.startsWith(vaultPath + path.sep)
      );
    });

    if (repoPaths.length > 0) {
      const candidates: RepoCandidate[] = [];

      for (const repoPath of repoPaths) {
        let score = 0;
        const reasons: string[] = [];

        const filesInRepo = context.filesAccessed.filter(f => f.path.startsWith(repoPath));
        const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
        const readFiles = filesInRepo.filter(f => f.action === 'read');

        if (editedFiles.length > 0) {
          score += editedFiles.length * 10;
          reasons.push(`${editedFiles.length} file(s) modified`);
        }

        if (readFiles.length > 0) {
          score += readFiles.length * 5;
          reasons.push(`${readFiles.length} file(s) read`);
        }

        if (sessionId) {
          const repoName = path.basename(repoPath);
          if (sessionId.toLowerCase().includes(repoName.toLowerCase())) {
            score += 20;
            reasons.push('Session topic matches repo name');
          }
        }

        // Score based on relationship to Claude Code's working directories
        for (const workDir of searchDirs) {
          if (repoPath === workDir) {
            score += 15;
            reasons.push('Repo is a working directory');
            break;
          } else if (workDir.startsWith(repoPath)) {
            score += 8;
            reasons.push('Working directory is within this repo');
            break;
          } else if (repoPath.startsWith(workDir)) {
            score += 5;
            reasons.push('Repo is subdirectory of working directory');
            break;
          }
        }

        if (score > 0 || repoPaths.length === 1) {
          const info = await context.getRepoInfo(repoPath);
          candidates.push({
            path: repoPath,
            name: info.name,
            score,
            reasons,
            branch: info.branch,
            remote: info.remote,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length > 0) {
        const topCandidate = candidates[0];

        // High confidence - automatically create project page
        if (candidates.length === 1 || topCandidate.score > (candidates[1]?.score || 0) * 2) {
          try {
            detectedRepoInfo = {
              path: topCandidate.path,
              name: topCandidate.name,
              branch: topCandidate.branch,
              remote: topCandidate.remote ?? undefined,
            };
            await context.createProjectPage({ repo_path: topCandidate.path });

            // Auto-update current project in user reference
            try {
              const userRefPath = path.join(context.vaultPath, 'user-reference.md');
              const description = args.topic ? `\n- **Description:** ${args.topic}` : '';
              const currentProjectContent = `## Current Project

- **Project Name:** ${topCandidate.name}
- **Last Updated:** ${dateStr}${description}`;

              await context.updateDocument({
                file_path: userRefPath,
                content: currentProjectContent,
                strategy: 'section-edit',
              });
            } catch (_error) {
              // Silent failure - user reference update is non-critical
            }
          } catch (_error) {
            // If project creation fails, continue anyway
          }
        }
      }
    }
  } catch (_error) {
    // Silently fail - repo detection is optional
  }

  // Auto-commit uncommitted changes
  if (detectedRepoInfo) {
    try {
      const { stdout: gitStatus } = await execAsync('git status --porcelain', {
        cwd: detectedRepoInfo.path,
      });

      if (gitStatus.trim()) {
        await execAsync('git add .', { cwd: detectedRepoInfo.path });

        const commitTitle = 'feat: Auto-commit changes from session';
        // Escape summary for commit body
        const commitBody = args.summary.replace(/'/g, "'\\''");

        await execAsync(`git commit -m '${commitTitle}' -m '${commitBody}'`, {
          cwd: detectedRepoInfo.path,
        });

        autoCommitMessage = '\n\n✅ Automatically committed uncommitted changes.';
      }
    } catch (error) {
      autoCommitMessage =
        '\n\n⚠️  Could not automatically commit changes: ' +
        (error instanceof Error ? error.message : String(error));
    }
  }

  // Build topics list from created content
  const topicsList = context.topicsCreated.map(t => t.title);
  const decisionsList = context.decisionsCreated.map(d => d.title);

  // Proactively search for related existing content mentioned in the summary
  const relatedContent = await context.findRelatedContentInText(args.summary);

  // Extract tags from session summary using heuristic analysis (smart mode: 500+ words only)
  // Short summaries produce generic, uninformative tags like "changes", "made", "updated"
  const wordCount = args.summary.split(/\s+/).length;
  const sessionTags =
    wordCount >= 500
      ? analyzeTopicContentInternal({
          content: args.summary,
          topic_name: args.topic || 'Work session',
        }).tags
      : [];

  // Generate automatic handoff if not provided (Decision 046: Required Handoff with Auto-generation)
  const handoffNotes =
    args.handoff ||
    generateAutomaticHandoff({
      topicsCreated: context.topicsCreated,
      decisionsCreated: context.decisionsCreated,
      filesEdited: context.filesAccessed.filter(f => f.action === 'edit' || f.action === 'create'),
      detectedRepo: detectedRepoInfo,
      summary: args.summary,
    });

  // Build session content using template
  const sessionContent = generateSessionTemplate({
    sessionId,
    date: dateStr,
    topic: args.topic,
    topicsList,
    decisionsList,
    summary: args.summary,
    handoff: handoffNotes,
    filesAccessed: context.filesAccessed,
    topicsCreated: context.topicsCreated,
    decisionsCreated: context.decisionsCreated,
    projectsCreated: context.projectsCreated,
    relatedTopics: relatedContent.topics,
    relatedDecisions: relatedContent.decisions,
    relatedProjects: relatedContent.projects,
    tags: sessionTags,
  });

  // PHASE 1: Analyze commits and return suggestions (Decision 022)
  // Decision 044: Always run two-phase workflow, skip_analysis parameter removed
  if (!args.finalize) {
    // Prevent Phase 1 from running more than once per session (prevents loop bug)
    if (context.hasPhase1Completed()) {
      throw new Error(
        '❌ Phase 1 Error: Commit analysis already completed for this session.\n\n' +
          'Phase 1 can only run once per session. You must:\n' +
          'Call close_session with finalize: true and session_data from Phase 1\n\n' +
          'This prevents the Phase 1 loop bug where commit analysis repeats indefinitely.\n' +
          '(Decision 044: Two-phase workflow is always required)'
      );
    }

    const result = await runPhase1Analysis(
      args,
      context,
      sessionId,
      sessionFile,
      sessionContent,
      dateStr,
      monthDir,
      detectedRepoInfo,
      autoCommitMessage,
      handoffNotes
    );

    // Mark Phase 1 as completed to prevent re-running
    context.markPhase1Complete();

    return result;
  }

  // Decision 044: This code path should never be reached
  // Two-phase workflow is always required - skip_analysis was removed
  throw new Error(
    '❌ Internal Error: Unreachable code path reached.\n\n' +
      'This indicates a bug in the close_session flow. The two-phase workflow ' +
      'should always be used (Decision 044). Please report this issue.'
  );
}
