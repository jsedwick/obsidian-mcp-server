/**
 * Tool: close_session
 *
 * Description: Create a session retroactively to capture the work done in this conversation.
 * ONLY callable via the /close slash command. Call this at the end of a conversation to persist the session to the vault.
 */

import * as fs from 'fs/promises';
import fssync from 'fs';
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
import { formatLocalDate } from '../../utils/dateFormat.js';

const execAsync = promisify(exec);
const logger = createLogger('closeSession');

/**
 * Normalize a file path for consistent comparison.
 * Resolves symlinks and normalizes path format.
 * Falls back to original path if normalization fails (e.g., file doesn't exist).
 */
function normalizePath(filePath: string): string {
  try {
    return fssync.realpathSync(filePath);
  } catch {
    // File might not exist or path might be invalid - return normalized form
    return path.normalize(filePath);
  }
}

/**
 * Build context for handoff generation (Decision 052).
 * Structures session data into markdown format for AI analysis.
 */
function buildHandoffContext(params: {
  summary: string;
  filesEdited: Array<{ path: string; action: string }>;
  topicsCreated: Array<{ slug: string; title: string }>;
  decisionsCreated: Array<{ slug: string; title: string }>;
  detectedRepo: { name: string; path: string; branch?: string } | null;
}): string {
  const sections: string[] = [];

  // Session summary
  sections.push(`## Session Summary\n${params.summary}`);

  // Files modified
  if (params.filesEdited.length > 0) {
    sections.push(
      '## Files Modified\n' + params.filesEdited.map(f => `- ${f.path} (${f.action})`).join('\n')
    );
  }

  // Topics created
  if (params.topicsCreated.length > 0) {
    sections.push('## Topics Created\n' + params.topicsCreated.map(t => `- ${t.title}`).join('\n'));
  }

  // Decisions created
  if (params.decisionsCreated.length > 0) {
    sections.push(
      '## Decisions Created\n' + params.decisionsCreated.map(d => `- ${d.title}`).join('\n')
    );
  }

  // Repository info
  if (params.detectedRepo) {
    sections.push(
      `## Repository\n${params.detectedRepo.name}${params.detectedRepo.branch ? ` (${params.detectedRepo.branch})` : ''}`
    );
  }

  return sections.join('\n\n');
}

/**
 * Generate handoff prompt for AI execution (Decision 052).
 * Returns prompt text that AI will execute between Phase 1 and Phase 2.
 */
function generateHandoffPrompt(params: {
  summary: string;
  filesEdited: Array<{ path: string; action: string }>;
  topicsCreated: Array<{ slug: string; title: string }>;
  decisionsCreated: Array<{ slug: string; title: string }>;
  detectedRepo: { name: string; path: string; branch?: string } | null;
}): string {
  const context = buildHandoffContext(params);

  return `Analyze this session and generate actionable handoff notes for the next session.

${context}

Generate concise handoff notes (3-5 lines max) with emoji prefixes:
✅ Completed: [1-line summary of what was accomplished]
⏭️ Next: [Specific remaining tasks from this work, if any]
💡 Consider: [Logical next steps or project improvements, if applicable]
🔧 Working on: [Repository and branch if applicable]

Be specific and actionable. Don't suggest tests/documentation unless the changes genuinely warrant them.

Output only the handoff notes, no preamble.`;
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
        // Found a git repo root - normalize to resolve symlinks
        try {
          const realPath = await fs.realpath(currentPath);
          repoPaths.add(realPath);
        } catch {
          // If normalization fails, use the path as-is
          repoPaths.add(currentPath);
        }
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
    const sinceDate = lastSessionDate ? formatLocalDate(lastSessionDate) : null;

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
  // Collect commit-related decisions for proactive surfacing (Decision 057)
  const commitRelatedDecisions: Array<{
    path: string;
    title: string;
    relevance: string;
    commitHash: string;
  }> = [];
  const commitRelatedDecisionPaths = new Set<string>();

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

        // Collect related decisions from this commit (Decision 057)
        if (analysis.relatedDecisions) {
          for (const decision of analysis.relatedDecisions) {
            const decisionPath: string = decision.path;
            if (!commitRelatedDecisionPaths.has(decisionPath)) {
              commitRelatedDecisionPaths.add(decisionPath);
              commitRelatedDecisions.push({
                path: decisionPath,
                title: decision.title,
                relevance: decision.relevance,
                commitHash: commitHash.substring(0, 12),
              });
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

  // Run both semantic discovery searches in parallel (results reused by Phase 2)
  const [allDiscoveredTopics, allDiscoveredDecisions] = await Promise.all([
    discoverRelatedTopics(args.summary, context),
    discoverRelatedDecisions(args.summary, context),
  ]);

  // Semantic topic discovery for review (Decision 036) - uses pre-computed topics
  const rawSemanticTopics = await discoverTopicsForReview(
    args.summary,
    context,
    allDiscoveredTopics
  );

  // DEBUG: Log semantic discovery results before deduplication
  logger.info('=== SEMANTIC TOPIC DISCOVERY DEBUG ===');
  logger.info('rawSemanticTopics count:', { count: rawSemanticTopics.length });
  logger.info('rawSemanticTopics:', { paths: rawSemanticTopics.map(t => t.path) });
  logger.info('commitRelatedTopics count:', { count: commitRelatedTopics.length });
  logger.info('commitRelatedTopics:', { paths: commitRelatedTopics.map(t => t.path) });

  // Deduplicate: exclude topics already identified via commit analysis
  // Prevents same topic being listed twice and evaluated twice during Phase 2
  const commitRelatedPaths = new Set(commitRelatedTopics.map(t => t.path));
  const semanticTopicsForReview = rawSemanticTopics.filter(t => !commitRelatedPaths.has(t.path));

  logger.info('semanticTopicsForReview count (after dedupe):', {
    count: semanticTopicsForReview.length,
  });
  logger.info('=== END SEMANTIC TOPIC DISCOVERY DEBUG ===');

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
    handoff, // Handoff from Phase 1 (placeholder, updated by Phase 2 with AI-generated content)
    sessionCommits, // Pass commit hashes to Phase 2 for recording
    semanticTopicsPresented: semanticTopicsForReview.map(t => ({ path: t.path, title: t.title })),
    // Commit-related topics for enforcement (Decision 041)
    commitRelatedTopics: commitRelatedTopics.length > 0 ? commitRelatedTopics : undefined,
    // Phase 1 discovery results passed to Phase 2 to avoid redundant semantic search
    discoveredTopics: allDiscoveredTopics.map(t => ({
      path: t.path,
      title: t.title,
      similarity: t.similarity,
    })),
    discoveredDecisions: allDiscoveredDecisions.map(d => ({
      path: d.path,
      title: d.title,
      projectSlug: d.projectSlug,
      similarity: d.similarity,
    })),
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

  // Build new topic consideration section (Decision 055)
  const newTopicConsiderationSection =
    '\n\n---\n\n' +
    '📝 **New Topic Consideration**\n\n' +
    'Does this session introduce concepts that warrant **NEW** documentation?\n\n' +
    '**Consider creating a new topic when:**\n' +
    '- A new pattern, architecture, or approach was implemented\n' +
    '- A solution to a recurring problem was established\n' +
    '- A significant feature was added with non-obvious usage\n' +
    '- Knowledge was captured that would benefit future sessions\n' +
    '- The session summary describes work not covered by existing topics\n\n' +
    '**Do NOT create a topic for:**\n' +
    '- Trivial bug fixes or one-line changes\n' +
    '- Work already documented in existing topics (update instead)\n' +
    '- Temporary debugging or investigation notes\n\n' +
    'If creating: Use `create_topic_page` with comprehensive content.\n' +
    'If not: No action required (existing topics sufficient).';

  // Build new decision consideration section (Decision 056 + 057)
  let newDecisionConsiderationSection =
    '\n\n---\n\n' +
    '⚖️ **New Decision Consideration**\n\n' +
    'Did this session involve **strategic choices between alternatives**?\n\n';

  // Surface commit-related decisions for awareness (Decision 057)
  if (commitRelatedDecisions.length > 0) {
    newDecisionConsiderationSection +=
      '📋 **Existing decisions related to commits in this session:**\n' +
      commitRelatedDecisions
        .map(d => `- **${d.title}** (commit ${d.commitHash})\n  ${d.relevance}`)
        .join('\n') +
      '\n\nReview these before creating new decisions — your changes may warrant updating an existing ADR.\n\n';
  }

  newDecisionConsiderationSection +=
    '**Create an ADR (Architectural Decision Record) when:**\n' +
    '- You chose between 2+ libraries, frameworks, or tools\n' +
    '- You selected an architecture pattern over alternatives\n' +
    '- You made tradeoffs (cost vs. performance, simplicity vs. flexibility)\n' +
    '- You decided on data models, API designs, or cloud services\n' +
    '- The choice affects system structure or long-term maintainability\n\n' +
    '**Do NOT create a decision for:**\n' +
    '- Implementation details without alternatives considered\n' +
    '- Bug fixes or refactoring (use topics instead)\n' +
    '- Choices with only one viable option\n\n' +
    "**Litmus test:** Can you list 2-3 alternatives that were considered? If not, it's a topic, not a decision.\n\n" +
    'If creating: Use `create_decision` with context, alternatives, rationale, and consequences.\n' +
    'If not: No action required (no strategic choices made).';

  // Build Phase 1 structured content
  const structuredContent: CloseSessionPhase1Structured = {
    phase: 1,
    session_id: sessionId,
    session_file: sessionFile,
    detected_repo: detectedRepoInfo
      ? {
          name: detectedRepoInfo.name,
          path: detectedRepoInfo.path,
          branch: detectedRepoInfo.branch,
        }
      : null,
    commit_count: sessionCommits.length,
    commits: sessionCommits.map(hash => {
      const shortHash = hash.substring(0, 12);
      return {
        hash: shortHash,
        related_topics: commitRelatedTopics
          .filter(t => t.commitHash === shortHash)
          .map(t => ({ path: t.path, title: t.title, relevance: t.relevance })),
        related_decisions: commitRelatedDecisions
          .filter(d => d.commitHash === shortHash)
          .map(d => ({ path: d.path, title: d.title, relevance: d.relevance })),
      };
    }),
    topics_for_review: commitRelatedTopics.map(t => ({
      path: t.path,
      title: t.title,
      source: 'commit' as const,
      commit_hash: t.commitHash,
      relevance: t.relevance,
    })),
    semantic_topics_for_review: semanticTopicsForReview.map(t => ({
      path: t.path,
      title: t.title,
      source: 'semantic' as const,
    })),
    session_data: sessionData,
  };

  return {
    content: [
      {
        type: 'text',
        text:
          commitAnalysisReport +
          commitTopicsEnforcementSection +
          semanticTopicReviewSection +
          newTopicConsiderationSection +
          newDecisionConsiderationSection +
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
          '   - Always provide `reason` parameter explaining why updating (for audit trail)\n' +
          '   - **Err on the side of updating** rather than leaving documentation outdated\n\n' +
          `${sessionCommits.length > 0 ? '4' : '3'}. **CONSIDER NEW TOPIC CREATION** (Decision 055):\n` +
          '   - Review the "New Topic Consideration" section above\n' +
          '   - Does this session introduce concepts NOT covered by existing topics?\n' +
          '   - New patterns, architectures, or significant features deserve their own topics\n' +
          '   - Use `create_topic_page` for substantial new concepts\n' +
          '   - If no new topic warranted, proceed to next step (this is fine)\n\n' +
          `${sessionCommits.length > 0 ? '5' : '4'}. **CONSIDER NEW DECISION CREATION** (Decision 056 + 057):\n` +
          '   - Review the "New Decision Consideration" section above\n' +
          '   - Did this session involve strategic choices between alternatives?\n' +
          '   - Library/framework selection, architecture patterns, and tradeoffs deserve ADRs\n' +
          '   - Use `create_decision` with context, alternatives, rationale, and consequences\n' +
          '   - **Litmus test:** Can you list 2-3 alternatives considered? If not, use a topic instead\n' +
          '   - **You MUST acknowledge this step** in the finalize call via `decision_review` parameter:\n' +
          '     - If creating decisions: `decision_review: "created: decision-slug-1, decision-slug-2"`\n' +
          '     - If no decision warranted: `decision_review: "none_warranted: [brief reason]"`\n\n' +
          `${sessionCommits.length > 0 ? '6' : '5'}. **CURATE RELEVANT TOPICS** for session linking:\n` +
          "   - After reviewing all commit-related and semantic topics, determine which are GENUINELY related to this session's work\n" +
          '   - A topic is relevant if the session directly impacts, extends, or builds upon it\n' +
          '   - A topic is NOT relevant if it merely shares keywords (e.g., "contrast" in CSS vs accessibility)\n' +
          '   - Include the full path of each relevant topic in `relevant_topics` when finalizing\n' +
          '   - Topics you updated via `update_document` will also be linked automatically\n\n' +
          `${sessionCommits.length > 0 ? '7' : '6'}. **GENERATE HANDOFF NOTES** (Decision 052) - Use this prompt:\n\n` +
          '```\n' +
          generateHandoffPrompt({
            summary: args.summary,
            filesEdited: context.filesAccessed
              .filter(f => f.action === 'edit' || f.action === 'create')
              .map(f => ({ path: f.path, action: f.action })),
            topicsCreated: context.topicsCreated,
            decisionsCreated: context.decisionsCreated,
            detectedRepo: detectedRepoInfo,
          }) +
          '\n```\n\n' +
          `${sessionCommits.length > 0 ? '8' : '7'}. **FINALIZE SESSION** - Only when ALL documentation is current AND handoff is generated, call:\n\n` +
          '```typescript\n' +
          'close_session({\n' +
          `  summary: "${summary}",\n` +
          (topic ? `  ${topic}\n` : '') +
          '  finalize: true,\n' +
          '  handoff: "[paste generated handoff notes here]",  // REQUIRED (Decision 052)\n' +
          '  decision_review: "none_warranted: [brief reason]",  // REQUIRED (Decision 057) - or list created decision slugs\n' +
          '  relevant_topics: ["/path/to/topic1.md", "/path/to/topic2.md"],  // Only topics genuinely related to this session\n' +
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
    structuredContent,
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
    logger.error('Topic review discovery failed:', error instanceof Error ? error : undefined);
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
    logger.error(
      'Failed to count topics for adaptive threshold:',
      error instanceof Error ? error : undefined
    );
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
    logger.info('=== SEMANTIC TOPIC DISCOVERY - discoverRelatedTopics ===');
    logger.info('Keywords extracted:', { keywords, count: keywords.length });

    if (keywords.length === 0) {
      logger.info('No keywords extracted - returning empty');
      return [];
    }

    // Calculate adaptive threshold based on vault size
    const { threshold, topicCount, tier } = await calculateAdaptiveThreshold(context.vaultPath);

    logger.info('Semantic discovery threshold:', { topicCount, tier, threshold });

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
      logger.info('Search returned no results');
      return [];
    }

    // Parse search results (format: "Search results for...")
    const resultText = (searchResult.content[0] as { text: string }).text;
    const fileMatches = Array.from(resultText.matchAll(/\*\*(.+?)\*\*/g));
    logger.info('Search returned file matches:', { count: fileMatches.length });

    const topics: Array<{ path: string; title: string; similarity: number }> = [];
    const filterLog: Array<{
      path: string;
      reason: string;
      similarity?: number;
      matchCount?: number;
    }> = [];

    for (const match of fileMatches) {
      const filePath = match[1];

      // Extract similarity score from search result
      // Two possible formats:
      // 1. "[semantic: 27%]" - from indexed search with re-ranking (percentage)
      // 2. "Semantic match (score: 0.850)" - from pure semantic search (decimal)
      const matchIndex = match.index;
      const remainingText = resultText.substring(matchIndex);
      const nextFileMatch = remainingText.indexOf('**', match[0].length); // Find next file (skip past closing **)
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
          filterLog.push({ path: filePath, reason: 'below_threshold', similarity });
          continue; // Skip topics below threshold
        }

        // Quality check: Read topic and verify meaningful keyword matches
        let topicContent: string;
        try {
          topicContent = await fs.readFile(filePath, 'utf-8');
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
            filterLog.push({
              path: filePath,
              reason: 'insufficient_keyword_matches',
              similarity,
              matchCount,
            });
            continue; // Skip this topic
          }
        } catch (_error) {
          // If can't read file, skip it
          filterLog.push({ path: filePath, reason: 'read_error' });
          continue;
        }

        // Extract topic title from frontmatter (preserves casing like "MCP Server")
        // Falls back to filename-derived title if frontmatter unavailable
        const fileName = path.basename(filePath, '.md');
        let title: string;
        const titleMatch = topicContent.match(/^---\n[\s\S]*?^title:\s*"?([^"\n]+)"?\s*$/m);
        const h1Match = topicContent.match(/^# (.+)$/m);
        if (titleMatch) {
          title = titleMatch[1].trim();
        } else if (h1Match) {
          title = h1Match[1].trim();
        } else {
          title = fileName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }

        topics.push({ path: filePath, title, similarity });

        // Limit to top 5 topics
        if (topics.length >= 5) {
          break;
        }
      } else {
        // Log why file was rejected
        let reason = 'unknown';
        if (!filePath.startsWith(context.vaultPath)) reason = 'not_in_primary_vault';
        else if (!filePath.includes('/topics/')) reason = 'not_a_topic';
        else if (filePath.includes('/archive/')) reason = 'archived';
        filterLog.push({ path: filePath, reason });
      }
    }

    // Log final results and filter summary
    logger.info('Topics passed all filters:', {
      count: topics.length,
      topics: topics.map(t => ({ path: t.path, similarity: t.similarity })),
    });
    logger.info('Topics filtered out:', {
      count: filterLog.length,
      byReason: filterLog.reduce(
        (acc, f) => {
          acc[f.reason] = (acc[f.reason] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
    });

    // Log a few examples of each filter reason
    const reasonGroups = filterLog.reduce(
      (acc, f) => {
        if (!acc[f.reason]) acc[f.reason] = [];
        if (acc[f.reason].length < 3) {
          // Only log first 3 of each reason
          acc[f.reason].push({ path: f.path, similarity: f.similarity, matchCount: f.matchCount });
        }
        return acc;
      },
      {} as Record<string, Array<any>>
    );

    logger.info('Filter examples by reason:', reasonGroups);
    logger.info('=== END SEMANTIC TOPIC DISCOVERY ===');

    // Attach metadata for Phase 1 output
    return topics.map(t => ({
      ...t,
      _tier: tier,
      _threshold: threshold,
      _topicCount: topicCount,
    }));
  } catch (error) {
    // Silent failure - discovery is non-critical
    logger.error('Topic discovery failed:', error as Error);
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
    logger.error(
      'Failed to count decisions for adaptive threshold:',
      error instanceof Error ? error : undefined
    );
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
    logger.info('=== SEMANTIC DECISION DISCOVERY - discoverRelatedDecisions ===');
    logger.info('Keywords extracted:', { keywords, count: keywords.length });

    if (keywords.length === 0) {
      logger.info('No keywords extracted - returning empty');
      return [];
    }

    // Calculate adaptive threshold based on decision corpus size
    const { threshold, decisionCount, tier } = await calculateDecisionAdaptiveThreshold(
      context.vaultPath
    );

    logger.info('Decision discovery threshold:', { decisionCount, tier, threshold });

    // Search vault with keywords, filtering to decisions only
    const searchResult = await context.searchVault({
      query: keywords.join(' '),
      max_results: 15, // Get more results to filter down
      detail: 'summary',
      category: 'decision', // Only search decisions for semantic discovery
      directories: ['decisions'], // Pre-filter to decisions directory for better results
    });

    if (!searchResult.content || searchResult.content.length === 0) {
      logger.info('Search returned no results');
      return [];
    }

    // Parse search results (format: "Search results for...")
    const resultText = (searchResult.content[0] as { text: string }).text;
    const fileMatches = Array.from(resultText.matchAll(/\*\*(.+?)\*\*/g));
    logger.info('Search returned file matches:', { count: fileMatches.length });

    const decisions: Array<{
      path: string;
      title: string;
      projectSlug: string;
      similarity: number;
    }> = [];
    const filterLog: Array<{
      path: string;
      reason: string;
      similarity?: number;
      matchCount?: number;
    }> = [];

    for (const match of fileMatches) {
      const filePath = match[1];

      // Extract similarity score from search result
      // Two possible formats:
      // 1. "[semantic: 27%]" - from indexed search with re-ranking (percentage)
      // 2. "Semantic match (score: 0.850)" - from pure semantic search (decimal)
      const matchIndex = match.index;
      const remainingText = resultText.substring(matchIndex);
      const nextFileMatch = remainingText.indexOf('**', match[0].length); // Find next file (skip past closing **)
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
          filterLog.push({ path: filePath, reason: 'below_threshold', similarity });
          continue; // Skip decisions below threshold
        }

        // Quality check: Read decision and verify meaningful keyword matches
        let decisionContent: string;
        try {
          decisionContent = await fs.readFile(filePath, 'utf-8');
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
            filterLog.push({
              path: filePath,
              reason: 'insufficient_keyword_matches',
              similarity,
              matchCount,
            });
            continue; // Skip this decision
          }
        } catch (_error) {
          // If can't read file, skip it
          filterLog.push({ path: filePath, reason: 'read_error' });
          continue;
        }

        // Extract decision info from path
        const relativePath = filePath.substring(context.vaultPath.length + 1);
        const parts = relativePath.split('/');

        if (parts.length >= 3 && parts[0] === 'decisions') {
          const projectSlug = parts[1];
          const fileName = path.basename(filePath, '.md');

          // Extract title from frontmatter or H1 (preserves casing)
          // Falls back to filename-derived title if unavailable
          let title: string;
          const titleMatch = decisionContent.match(/^---\n[\s\S]*?^title:\s*"?([^"\n]+)"?\s*$/m);
          const h1Match = decisionContent.match(/^# (.+)$/m);
          if (titleMatch) {
            title = titleMatch[1].trim();
          } else if (h1Match) {
            title = h1Match[1].trim();
          } else {
            title = fileName
              .replace(/^\d+-/, '') // Remove leading number
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          }

          decisions.push({ path: filePath, title, projectSlug, similarity });

          // Limit to top 5 decisions
          if (decisions.length >= 5) {
            break;
          }
        }
      } else {
        // Log why file was rejected
        let reason = 'unknown';
        if (!filePath.startsWith(context.vaultPath)) reason = 'not_in_primary_vault';
        else if (!filePath.includes('/decisions/')) reason = 'not_a_decision';
        else if (filePath.includes('/archive/')) reason = 'archived';
        filterLog.push({ path: filePath, reason });
      }
    }

    // Log final results and filter summary
    logger.info('Decisions passed all filters:', {
      count: decisions.length,
      decisions: decisions.map(d => ({ path: d.path, similarity: d.similarity })),
    });
    logger.info('Decisions filtered out:', {
      count: filterLog.length,
      byReason: filterLog.reduce(
        (acc, f) => {
          acc[f.reason] = (acc[f.reason] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
    });

    // Log a few examples of each filter reason
    const reasonGroups = filterLog.reduce(
      (acc, f) => {
        if (!acc[f.reason]) acc[f.reason] = [];
        if (acc[f.reason].length < 3) {
          // Only log first 3 of each reason
          acc[f.reason].push({ path: f.path, similarity: f.similarity, matchCount: f.matchCount });
        }
        return acc;
      },
      {} as Record<string, Array<any>>
    );

    logger.info('Filter examples by reason:', reasonGroups);
    logger.info('=== END SEMANTIC DECISION DISCOVERY ===');

    return decisions;
  } catch (error) {
    // Silent failure - discovery is non-critical
    logger.error('Decision discovery failed:', error as Error);
    return [];
  }
}

/**
 * Resolve AI-curated relevant_topics paths into { path, title } objects.
 * Looks up each path in the candidate pools (discoveredTopics + commitRelatedTopics).
 * For unknown paths, derives title from the file slug as a graceful fallback.
 */
function resolveRelevantTopics(
  relevantPaths: string[],
  discoveredTopics: Array<{ path: string; title: string }>,
  commitRelatedTopics?: Array<{ path: string; title: string }>
): Array<{ path: string; title: string }> {
  // Build lookup map from all candidate pools
  const candidateMap = new Map<string, string>();
  for (const t of discoveredTopics) {
    candidateMap.set(normalizePath(t.path), t.title);
  }
  if (commitRelatedTopics) {
    for (const t of commitRelatedTopics) {
      candidateMap.set(normalizePath(t.path), t.title);
    }
  }

  return relevantPaths.map(p => {
    const normalized = normalizePath(p);
    const title = candidateMap.get(normalized);
    if (title) {
      return { path: p, title };
    }
    // Fallback: derive title from slug
    const slug = path.basename(p, '.md');
    const fallbackTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { path: p, title: fallbackTitle };
  });
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

  // Filter to vault files that were edited or created (not just read for review)
  // Reading a topic for commit-related review (Decision 041) should NOT create a link
  // Only actual modifications indicate a real relationship worth linking
  const topicFiles: Array<{ path: string; slug: string; title: string }> = [];
  const decisionFiles: Array<{ path: string; slug: string; title: string; projectSlug: string }> =
    [];
  const projectFiles: Array<{ path: string; slug: string; title: string }> = [];

  for (const file of filesAccessed) {
    // Skip if not in vault
    if (!file.path.startsWith(vaultPath)) continue;
    // Skip files that were only read — only link files that were actually modified
    if (file.action === 'read') continue;

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
    logger.info('Topic paths being checked (raw):', {
      topics: data.commitRelatedTopics.map(t => t.path),
    });
    logger.info('Topic paths being checked (normalized):', {
      topics: data.commitRelatedTopics.map(t => normalizePath(t.path)),
    });
    logger.info('All accessed file paths (raw):', {
      files: allFilesAccessed.map(f => `${f.path} (${f.action})`),
    });
    logger.info('All accessed file paths (normalized):', {
      files: allFilesAccessed.map(f => `${normalizePath(f.path)} (${f.action})`),
    });
    logger.info('=== END ENFORCEMENT DEBUG ===');

    // Normalize all paths for consistent comparison (fixes path format mismatch bug)
    // Topic paths from search results may not be normalized, but filesAccessed paths are
    const normalizedFilesAccessed = allFilesAccessed.map(f => ({
      ...f,
      normalizedPath: normalizePath(f.path),
    }));

    const unreviewedTopics = data.commitRelatedTopics.filter(topic => {
      // Normalize topic path for comparison
      const normalizedTopicPath = normalizePath(topic.path);
      // Check if topic was accessed (read, edit, or create all count as review)
      // Use normalized paths to handle format differences (symlinks, trailing slashes, etc.)
      return !normalizedFilesAccessed.some(
        f =>
          f.normalizedPath === normalizedTopicPath && ['read', 'edit', 'create'].includes(f.action)
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
    logger.info('Semantic topic paths being checked (raw):', {
      topics: data.semanticTopicsPresented.map(t => t.path),
    });
    logger.info('Semantic topic paths being checked (normalized):', {
      topics: data.semanticTopicsPresented.map(t => normalizePath(t.path)),
    });
    logger.info('All accessed file paths (raw):', {
      files: allFilesAccessed.map(f => `${f.path} (${f.action})`),
    });
    logger.info('All accessed file paths (normalized):', {
      files: allFilesAccessed.map(f => `${normalizePath(f.path)} (${f.action})`),
    });
    logger.info('=== END ENFORCEMENT DEBUG ===');

    // Normalize all paths for consistent comparison (fixes path format mismatch bug)
    // Topic paths from search results may not be normalized, but filesAccessed paths are
    const normalizedFilesAccessed = allFilesAccessed.map(f => ({
      ...f,
      normalizedPath: normalizePath(f.path),
    }));

    const unreviewedSemanticTopics = data.semanticTopicsPresented.filter(topic => {
      // Normalize topic path for comparison
      const normalizedTopicPath = normalizePath(topic.path);
      // Check if topic was accessed (read, edit, or create all count as review)
      // Use normalized paths to handle format differences (symlinks, trailing slashes, etc.)
      return !normalizedFilesAccessed.some(
        f =>
          f.normalizedPath === normalizedTopicPath && ['read', 'edit', 'create'].includes(f.action)
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

  // ENFORCEMENT CHECK (Decision 057): Require explicit decision review acknowledgment
  // Soft enforcement: warn but don't block finalization
  let decisionReviewWarning = '';
  if (!_args.decision_review || _args.decision_review.trim() === '') {
    decisionReviewWarning =
      '\n\n⚠️  **Decision Review Not Acknowledged (Decision 057)**\n' +
      'Phase 2 was called without `decision_review` parameter.\n' +
      'Future sessions should include either:\n' +
      '- `decision_review: "none_warranted: [reason]"` if no strategic choices were made\n' +
      '- `decision_review: "created: [decision-slug-1], [decision-slug-2]"` for decisions created\n';
    logger.warn('Decision review not acknowledged in Phase 2 (Decision 057)');
  } else {
    logger.info('Decision review acknowledged:', { decision_review: _args.decision_review });
  }

  // Use Phase 1 discovery results if available, otherwise fall back to fresh search
  const [discoveredTopics, discoveredDecisions] =
    data.discoveredTopics && data.discoveredDecisions
      ? [data.discoveredTopics, data.discoveredDecisions]
      : await Promise.all([
          discoverRelatedTopics(_args.summary, context),
          discoverRelatedDecisions(_args.summary, context),
        ]);

  // Batch all content updates in memory before writing to disk
  let updatedContent = data.sessionContent;

  // Decision 052 FIX: Update handoff section with AI-generated handoff from Phase 2 args
  // Phase 1 builds sessionContent with empty handoff; Phase 2 args contains the AI-generated handoff
  if (_args.handoff && _args.handoff.trim()) {
    // Replace the ## Handoff section with the new handoff from Phase 2
    // Matches everything between "## Handoff" and "## Files Accessed" (the known next section)
    // Non-greedy with specific terminator avoids truncation if handoff contains ## headers
    const handoffPattern = /## Handoff\n\n[\s\S]*?(?=\n\n## Files Accessed)/;
    if (handoffPattern.test(updatedContent)) {
      updatedContent = updatedContent.replace(
        handoffPattern,
        `## Handoff\n\n${_args.handoff.trim()}`
      );
    }
  }

  // Add topics: use AI-curated list if provided, otherwise fall back to all discovered (backward compat)
  if (_args.relevant_topics !== undefined) {
    logger.info('Using AI-curated relevant_topics:', {
      curated: _args.relevant_topics.length,
      discovered: discoveredTopics.length,
      paths: _args.relevant_topics,
    });
  } else {
    logger.info('No relevant_topics provided, falling back to all discovered topics:', {
      count: discoveredTopics.length,
    });
  }
  const topicsToLink =
    _args.relevant_topics !== undefined
      ? resolveRelevantTopics(_args.relevant_topics, discoveredTopics, data.commitRelatedTopics)
      : discoveredTopics;

  if (topicsToLink.length > 0) {
    updatedContent = addRelatedTopicsToSession(updatedContent, topicsToLink);
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

  // Update persistent issue file if session is linked to an issue (Decision 048)
  // Uses directory-based structure: persistent-issues/{slug}.md
  if (context.linkedIssueSlug) {
    const issueFilePath = path.join(
      context.vaultPath,
      'persistent-issues',
      `${context.linkedIssueSlug}.md`
    );
    try {
      const issueContent = await fs.readFile(issueFilePath, 'utf-8');

      // Parse frontmatter to update sessions array
      const frontmatterMatch = issueContent.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const body = issueContent.slice(frontmatterMatch[0].length);

        // Extract current sessions array
        const sessionsMatch = frontmatter.match(/sessions:\s*(\[[\s\S]*?\])/);
        let sessions: string[] = [];
        if (sessionsMatch) {
          try {
            sessions = JSON.parse(sessionsMatch[1]);
          } catch {
            sessions = [];
          }
        }

        // Add session if not already present
        if (!sessions.includes(data.sessionId)) {
          sessions.push(data.sessionId);

          // Update the sessions line in frontmatter
          const updatedFrontmatter = frontmatter.replace(
            /sessions:\s*\[[\s\S]*?\]/,
            `sessions: ${JSON.stringify(sessions)}`
          );

          const updatedContent = `---\n${updatedFrontmatter}\n---${body}`;
          await fs.writeFile(issueFilePath, updatedContent, 'utf-8');
        }
      }
    } catch (_error) {
      // Silent failure - persistent issues update is non-critical
      // The session still has the issue field in frontmatter
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

  // Build Phase 2 structured content
  const structuredContent: CloseSessionPhase2Structured = {
    phase: 2,
    session_id: data.sessionId,
    session_file: data.sessionFile,
    topics_linked: data.topicsCreated.map(t => ({ slug: t.slug, title: t.title })),
    decisions_linked: data.decisionsCreated.map(d => ({ slug: d.slug, title: d.title })),
    projects_linked: data.projectsCreated.map(p => ({ slug: p.slug, name: p.name })),
    files_accessed_count: data.filesAccessed.length,
    detected_repo: data.detectedRepoInfo
      ? {
          name: data.detectedRepoInfo.name,
          path: data.detectedRepoInfo.path,
          branch: data.detectedRepoInfo.branch,
        }
      : null,
    validation_warnings: validationWarnings,
    has_custodian_findings: vaultCustodianReport.length > 0,
  };

  return {
    content: [
      {
        type: 'text',
        text:
          lines.join('\n') +
          data.repoDetectionMessage +
          validationReport +
          decisionReviewWarning +
          vaultCustodianReport,
      },
    ],
    structuredContent,
  };
}

// Decision 044: runSinglePhaseClose was removed - two-phase workflow is always required

/**
 * Sync all git-tracked vaults to their remote repositories.
 * Runs git add, commit, and push for each vault that has a .git directory.
 * Non-blocking: failures are reported but do not throw.
 */
async function syncVaultsToGit(allVaultPaths: string[]): Promise<string> {
  const results: string[] = [];
  let commitCount = 0;
  const pushErrors: string[] = [];

  for (const vaultPath of allVaultPaths) {
    // Skip if not a git repository
    if (!fssync.existsSync(path.join(vaultPath, '.git'))) {
      continue;
    }

    const vaultName = path.basename(vaultPath);

    try {
      // Stage all changes
      await execAsync('git add .', { cwd: vaultPath });

      // Check if there are changes to commit
      try {
        await execAsync('git diff-index --quiet HEAD --', { cwd: vaultPath });
        // No changes - skip commit
      } catch {
        // Changes exist - commit them
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        await execAsync(`git commit -m "Session close auto-commit: ${timestamp}" --quiet`, {
          cwd: vaultPath,
        });
        commitCount++;
        logger.info(`Committed vault changes: ${vaultName}`);
      }

      // Push to remote
      try {
        await execAsync('git push --quiet', { cwd: vaultPath });
      } catch (pushErr) {
        pushErrors.push(vaultName);
        logger.info(`Git push failed for ${vaultName}`, {
          error: pushErr instanceof Error ? pushErr.message : String(pushErr),
        });
      }
    } catch (error) {
      logger.info(`Git sync error for ${vaultName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      pushErrors.push(vaultName);
    }
  }

  // Build report
  if (commitCount > 0) {
    results.push(`📝 Auto-committed changes in ${commitCount} vault(s)`);
  }

  if (pushErrors.length === 0 && commitCount > 0) {
    results.push('✅ All vaults synced to remote');
  } else if (pushErrors.length === 0 && commitCount === 0) {
    results.push('✅ All vaults up to date with remote');
  } else {
    results.push(`⚠️  Git push failed for: ${pushErrors.join(', ')}`);
  }

  return results.length > 0 ? '\n\n' + results.join('\n') : '';
}

export interface CloseSessionArgs {
  summary: string;
  topic?: string;
  handoff?: string; // Optional in Phase 1, REQUIRED in Phase 2 (AI-generated via prompt, Decision 052)
  decision_review?: string; // Phase 2: acknowledgment of decision consideration (Decision 057)
  relevant_topics?: string[]; // AI-curated list of topic paths genuinely related to this session
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
  // Explicit repository override - bypasses auto-detection scoring
  // Use when the edited repo is a subdirectory of a working directory and
  // would be shadowed by higher-scored working-directory repos under auto-detect
  detected_repo_override?: string; // Absolute path to Git repository
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
  handoff: string; // Placeholder from Phase 1, replaced by Phase 2 with AI-generated handoff
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
  // Phase 1 discovery results passed to Phase 2 to avoid redundant semantic search
  discoveredTopics?: Array<{ path: string; title: string; similarity: number }>;
  discoveredDecisions?: Array<{
    path: string;
    title: string;
    projectSlug: string;
    similarity: number;
  }>;
}

// Structured result interfaces for outputSchema support

export interface CloseSessionStructuredCommit {
  hash: string;
  related_topics: Array<{
    path: string;
    title: string;
    relevance: string;
  }>;
  related_decisions: Array<{
    path: string;
    title: string;
    relevance: string;
  }>;
}

export interface CloseSessionStructuredReviewTopic {
  path: string;
  title: string;
  source: 'commit' | 'semantic';
  commit_hash?: string;
  relevance?: string;
}

export interface CloseSessionPhase1Structured {
  phase: 1;
  session_id: string;
  session_file: string;
  detected_repo: {
    name: string;
    path: string;
    branch?: string;
  } | null;
  commit_count: number;
  commits: CloseSessionStructuredCommit[];
  topics_for_review: CloseSessionStructuredReviewTopic[];
  semantic_topics_for_review: CloseSessionStructuredReviewTopic[];
  session_data: SessionData;
}

export interface CloseSessionPhase2Structured {
  phase: 2;
  session_id: string;
  session_file: string;
  topics_linked: Array<{ slug: string; title: string }>;
  decisions_linked: Array<{ slug: string; title: string }>;
  projects_linked: Array<{ slug: string; name: string }>;
  files_accessed_count: number;
  detected_repo: {
    name: string;
    path: string;
    branch?: string;
  } | null;
  validation_warnings: string[];
  has_custodian_findings: boolean;
}

export type CloseSessionStructuredResult =
  | CloseSessionPhase1Structured
  | CloseSessionPhase2Structured;

export interface CloseSessionResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  structuredContent?: CloseSessionStructuredResult;
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
    strategy?: 'append' | 'replace' | 'section-edit' | 'edit';
    reason?: string;
  }) => Promise<any>;
  slugify: (text: string) => string;
  setCurrentSession: (sessionId: string, sessionFile: string) => void;
  clearSessionState: () => void;
  hasPhase1Completed: () => boolean;
  markPhase1Complete: () => void;
  storePhase1SessionData: (data: SessionData) => void;
  getStoredPhase1SessionData: () => SessionData | null;
  // Decision 054: File-based session state recovery
  restoreSessionStateFromFile: () => Promise<{ phase1SessionData: unknown } | null>;
  getMostRecentSessionDate: (repoSlug: string) => Promise<Date | null>;
  getSessionStartTime: () => Date | null; // Get first file access timestamp
  searchVault: (args: {
    query: string;
    max_results?: number;
    detail?: string;
    category?: 'topic' | 'task-list' | 'decision' | 'session' | 'project' | 'commit';
    directories?: string[];
  }) => Promise<{ content: Array<{ text: string }> }>;
  // Persistent issue linked to this session (Decision 048)
  linkedIssueSlug: string | null;
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

  // Validate session_data is present and complete if finalizing
  // Decision 048: Fallback to stored session_data if context was truncated
  // Decision 054: Extended fallback to file-based recovery if memory also lost
  //              Also handles malformed session_data (missing required fields)
  const isSessionDataMissing = !args.session_data;
  const isSessionDataMalformed =
    args.session_data &&
    (!args.session_data.sessionContent ||
      !args.session_data.sessionId ||
      !args.session_data.sessionFile);
  const needsRecovery = args.finalize && (isSessionDataMissing || isSessionDataMalformed);

  if (needsRecovery) {
    const recoveryReason = isSessionDataMalformed
      ? 'session_data is malformed (missing required fields)'
      : 'session_data is missing';

    // Try memory-based recovery first (Decision 048)
    const storedData = context.getStoredPhase1SessionData();
    if (storedData) {
      // Recovered from MCP server state after context truncation
      args.session_data = storedData;
    } else {
      // Decision 054: Try file-based recovery (handles MCP server restart)
      const fileRestored = await context.restoreSessionStateFromFile();
      if (fileRestored?.phase1SessionData) {
        args.session_data = fileRestored.phase1SessionData as SessionData;
      } else {
        throw new Error(
          `❌ Phase 2 Error: ${recoveryReason}\n\n` +
            'The two-phase workflow requires calling close_session twice:\n' +
            '1. First call (Phase 1): Run via /close command with _invoked_by_slash_command: true\n' +
            '   Returns: commit analysis + session_data\n' +
            '2. Second call (Phase 2): Claude calls directly with finalize: true\n' +
            '   Does NOT need _invoked_by_slash_command (only Phase 1 does)\n\n' +
            'Recovery attempted:\n' +
            '- Memory state: not available\n' +
            '- File-based (recovery file): not available or Phase 1 incomplete\n\n' +
            'Try running restore_session_data first, or re-run /close to start fresh.\n\n' +
            'Example Phase 2 call:\n' +
            'close_session({\n' +
            '  summary: "...",\n' +
            '  finalize: true,\n' +
            '  session_data: { ...data from Phase 1... }\n' +
            '})'
        );
      }
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

    // Run Phase 2 finalization
    // Only clear state on SUCCESS - on enforcement failure, preserve state so topic reads
    // can accumulate between retries (fixes session-close-topic-read-loop issue)
    try {
      const phase2Result = await runPhase2Finalization(args, context, args.session_data!);
      // SUCCESS: Clear session state to allow subsequent /close operations
      context.clearSessionState();

      // Sync all git-tracked vaults to remote after successful session close
      const vaultSyncReport = await syncVaultsToGit(context.allVaultPaths);
      if (vaultSyncReport && phase2Result.content.length > 0) {
        phase2Result.content[0].text += vaultSyncReport;
      }

      return phase2Result;
    } catch (error) {
      // Check if this is an enforcement error (Decision 041 or 042)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isEnforcementError =
        errorMessage.includes('Topics Not Reviewed') ||
        errorMessage.includes('Decision 041') ||
        errorMessage.includes('Decision 042');

      if (isEnforcementError) {
        // ENFORCEMENT FAILURE: Do NOT clear state - allow topic reads to accumulate
        // The user will read the required topics and retry, and those reads need to persist
        throw error;
      }

      // OTHER FAILURE: Clear state and re-throw
      // This allows fresh /close attempts after non-enforcement errors
      context.clearSessionState();
      throw error;
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

  // Priority 0: Explicit override — caller named the repo, skip scoring entirely.
  // Validation errors here throw (loud) rather than falling through to auto-detect,
  // since the override signals explicit user intent.
  if (args.detected_repo_override) {
    const overridePath = args.detected_repo_override.trim();
    const gitDir = path.join(overridePath, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      throw new Error(`detected_repo_override path is not a Git repository: ${overridePath}`);
    }
    const info = await context.getRepoInfo(overridePath);
    detectedRepoInfo = {
      path: overridePath,
      name: info.name,
      branch: info.branch,
      remote: info.remote ?? undefined,
    };
    try {
      await context.createProjectPage({ repo_path: overridePath });
      try {
        const userRefPath = path.join(context.vaultPath, 'user-reference.md');
        const description = args.topic ? `\n- **Description:** ${args.topic}` : '';
        const currentProjectContent = `## Current Project\n\n- **Project Name:** ${info.name}\n- **Last Updated:** ${dateStr}${description}`;
        await context.updateDocument({
          file_path: userRefPath,
          content: currentProjectContent,
          strategy: 'section-edit',
        });
      } catch (_error) {
        // Silent failure - user reference update is non-critical
      }
    } catch (_error) {
      // Project creation failure shouldn't block close
    }
  }

  // Priority 1-3 (skipped when override already set detectedRepoInfo):
  // 1. Use working_directories parameter if provided (AI-specific, e.g., Claude Code)
  // 2. Infer from filesAccessed if available (AI-agnostic, MCP tool usage)
  // 3. Fall back to process.cwd() as last resort
  if (!detectedRepoInfo) {
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

      // DEBUG: Log repo detection inputs
      logger.debug('searchDirs:', { searchDirs });
      logger.debug('filesAccessed:', {
        filesAccessed: context.filesAccessed.map(f => ({ path: f.path, action: f.action })),
      });

      // Search all working directories for Git repos
      const allRepoPaths = new Set<string>();
      for (const dir of searchDirs) {
        try {
          const repos = await context.findGitRepos(dir);
          logger.debug(`findGitRepos(${dir}) returned:`, { repos });
          repos.forEach(r => allRepoPaths.add(r));
        } catch (err) {
          logger.debug(`findGitRepos(${dir}) error:`, { error: String(err) });
          // Skip directories that can't be searched
        }
      }
      let repoPaths = Array.from(allRepoPaths);
      logger.debug('allRepoPaths (before vault filter):', { repoPaths });
      logger.debug('allVaultPaths:', { allVaultPaths: context.allVaultPaths });

      // Filter out repositories inside vault directories (they're just for syncing markdown)
      repoPaths = repoPaths.filter(repoPath => {
        const isInVault = context.allVaultPaths.some(
          vaultPath => repoPath === vaultPath || repoPath.startsWith(vaultPath + path.sep)
        );
        if (isInVault) {
          logger.debug('Filtering out repo in vault:', { repoPath });
        }
        return !isInVault;
      });
      logger.debug('repoPaths (after vault filter):', { repoPaths });

      if (repoPaths.length > 0) {
        const candidates: RepoCandidate[] = [];

        for (const repoPath of repoPaths) {
          let score = 0;
          const reasons: string[] = [];

          const filesInRepo = context.filesAccessed.filter(f => f.path.startsWith(repoPath));
          logger.debug(`Scoring repo ${repoPath}:`, { filesInRepoCount: filesInRepo.length });
          if (filesInRepo.length === 0) {
            logger.debug('No files match. Sample file paths:', {
              samplePaths: context.filesAccessed.slice(0, 3).map(f => f.path),
            });
          }
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

          logger.debug(`Repo ${repoPath} final score:`, { score, reasons: reasons.join(', ') });

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
        logger.debug('Final candidates:', {
          candidates: candidates.map(c => ({ name: c.name, score: c.score, reasons: c.reasons })),
        });

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

  // Decision 052: Handoff generation moved to AI-agnostic prompt return pattern
  // Phase 1 returns handoff generation prompt; AI executes it between phases
  // handoff parameter is REQUIRED in Phase 2 (enforced by schema)
  const handoffNotes = args.handoff || '';

  // Build session content using template
  // Use the first working directory as the primary CWD for session-to-project matching
  // Falls back to process.cwd() so sessions always have a working_directory in frontmatter
  const fallbackCwd = process.env.PWD || process.cwd();
  const primaryWorkingDirectory =
    args.working_directories?.[0]
      ?.replace(/^Working directory:\s*/i, '')
      .replace(/^Additional working directories?:\s*/i, '')
      .trim() || fallbackCwd;

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
    linkedIssue: context.linkedIssueSlug || undefined,
    workingDirectory: primaryWorkingDirectory,
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
