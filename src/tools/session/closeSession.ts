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
import { GitError } from '../../utils/errors.js';

const execAsync = promisify(exec);

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
  autoCommitMessage: string
): Promise<CloseSessionResult> {
  const sessionStartTime = context.getSessionStartTime();

  if (!detectedRepoInfo || !sessionStartTime) {
    return runSinglePhaseClose(
      args,
      context,
      sessionId,
      sessionFile,
      sessionContent,
      dateStr,
      monthDir,
      detectedRepoInfo,
      autoCommitMessage
    );
  }

  let sessionCommits: string[] = [];
  let commitDetectionError = '';
  try {
    sessionCommits = await findSessionCommits(detectedRepoInfo.path, sessionStartTime);
  } catch (error) {
    commitDetectionError = `⚠️  Failed to detect session commits: ${String(error)}\n\n`;
  }

  if (sessionCommits.length === 0) {
    return runSinglePhaseClose(
      args,
      context,
      sessionId,
      sessionFile,
      sessionContent,
      dateStr,
      monthDir,
      detectedRepoInfo,
      commitDetectionError + autoCommitMessage
    );
  }

  let commitAnalysisReport = commitDetectionError;
  if (sessionCommits.length > 0) {
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
      } catch (_error) {
        commitAnalysisReport += `⚠️  Failed to analyze commit ${commitHash.substring(0, 12)}\n\n`;
      }
    }
  }

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
    handoff: args.handoff,
  };

  const summary = args.summary.replace(/"/g, '\\"');
  const topic = args.topic ? `topic: "${args.topic.replace(/"/g, '\\"')}",` : '';

  return {
    content: [
      {
        type: 'text',
        text:
          commitAnalysisReport +
          '\n\n---\n\n**Phase 1 Complete: Commit Analysis**\n\n' +
          `${sessionCommits.length} commit${
            sessionCommits.length > 1 ? 's were' : ' was'
          } made during this session. The analysis above identifies topics that may need updating.` +
          '\n\n**Next Steps - AGGRESSIVE DOCUMENTATION DRIFT PREVENTION:**\n\n' +
          "1. **PROACTIVELY ANALYZE** each commit's impact:\n" +
          '   - Read the analysis suggestions carefully\n' +
          '   - Think beyond direct mentions - consider conceptual relationships\n' +
          '   - Search vault for related topics that might be affected\n' +
          '   - If a commit changes authentication, consider ALL auth-related topics\n' +
          '   - If a commit changes an API, consider topics about usage, integration, examples\n\n' +
          '2. **IMMEDIATELY UPDATE** all affected documentation:\n' +
          '   - **Do NOT ask for user permission** - preventing documentation drift is your core responsibility\n' +
          '   - Use `search_vault` to find related files that need updates\n' +
          '   - Use `update_document` to update ANY file type (topics, decisions, user reference, etc.)\n' +
          "   - **NEVER use Edit/Write directly** - they don't track file access for vault_custodian\n" +
          '   - Create new topics with `create_topic_page` if concepts warrant documentation\n' +
          '   - Always provide `reason` parameter explaining why updating (for audit trail)\n' +
          '   - **Err on the side of updating** rather than leaving documentation outdated\n\n' +
          '3. **Only when ALL documentation is current**, call close_session again:\n\n' +
          '```typescript\n' +
          'close_session({\n' +
          `  summary: "${summary}",\n` +
          (topic ? `  ${topic}\n` : '') +
          '  finalize: true,\n' +
          '  _invoked_by_slash_command: true,\n' +
          `  session_data: ${JSON.stringify(sessionData, null, 2)}
` +
          '})\n' +
          '```\n\n' +
          '**Skip updates ONLY if** you have verified that no topics are affected by analyzing the commit impact.',
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
  ]);

  // Extract words, filter stop words, keep significant terms
  const words = summary
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ') // Keep hyphens for technical terms
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));

  // Return unique keywords, limit to 10
  return Array.from(new Set(words)).slice(0, 10);
}

/**
 * Discover related topics using semantic search on session summary
 * Filters to primary vault topics only to avoid cross-vault pollution
 */
async function discoverRelatedTopics(
  summary: string,
  context: CloseSessionContext
): Promise<Array<{ path: string; title: string }>> {
  try {
    // Extract keywords for search
    const keywords = extractKeywords(summary);
    if (keywords.length === 0) {
      return [];
    }

    // Search vault with keywords
    const searchResult = await context.searchVault({
      query: keywords.join(' '),
      max_results: 15, // Get more results to filter down
      detail: 'summary',
    });

    if (!searchResult.content || searchResult.content.length === 0) {
      return [];
    }

    // Parse search results (format: "Search results for...")
    const resultText = (searchResult.content[0] as { text: string }).text;
    const fileMatches = resultText.matchAll(/\*\*(.+?)\*\*/g);

    const topics: Array<{ path: string; title: string }> = [];

    for (const match of fileMatches) {
      const filePath = match[1];

      // Filter: Only include topics from primary vault
      if (
        filePath.startsWith(context.vaultPath) && // In primary vault
        filePath.includes('/topics/') && // Is a topic file
        !filePath.includes('/archive/') // Not archived
      ) {
        // Extract topic title from filename
        const fileName = path.basename(filePath, '.md');
        const title = fileName
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        topics.push({ path: filePath, title });

        // Limit to top 5 topics
        if (topics.length >= 5) {
          break;
        }
      }
    }

    return topics;
  } catch (error) {
    // Silent failure - discovery is non-critical
    console.error('Topic discovery failed:', error);
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
  const relatedTopicsRegex = /## Related Topics\n([^\n].*?)(?=\n##|$)/s;
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

    const relatedTopicsRegex = /## Related Topics\n([^\n].*?)(?=\n##|$)/s;
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

    const relatedDecisionsRegex = /## Related Decisions\n([^\n].*?)(?=\n##|$)/s;
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

  await fs.writeFile(data.sessionFile, data.sessionContent);

  context.setCurrentSession(data.sessionId, data.sessionFile);

  // Discover related topics using semantic search
  const discoveredTopics = await discoverRelatedTopics(_args.summary, context);
  if (discoveredTopics.length > 0) {
    // Add discovered topics to session file
    const updatedContent = addRelatedTopicsToSession(data.sessionContent, discoveredTopics);
    await fs.writeFile(data.sessionFile, updatedContent);
    data.sessionContent = updatedContent; // Update session data
  }

  // Add links for accessed files (topics/decisions modified via update_document)
  const updatedContentWithAccessed = addAccessedFilesLinksToSession(
    data.sessionContent,
    context.filesAccessed,
    context.vaultPath
  );
  if (updatedContentWithAccessed !== data.sessionContent) {
    await fs.writeFile(data.sessionFile, updatedContentWithAccessed);
    data.sessionContent = updatedContentWithAccessed;
  }

  // Dynamic filesToCheck: merge Phase 1 files with any files modified between Phase 1 and Phase 2
  // This catches documentation updates made during commit analysis review
  const phase2EditedFiles = context.filesAccessed
    .filter(
      f => (f.action === 'edit' || f.action === 'create') && f.path.startsWith(context.vaultPath)
    )
    .map(f => f.path);

  const allFilesToCheck = Array.from(
    new Set([...data.filesToCheck, ...phase2EditedFiles, ...discoveredTopics.map(t => t.path)])
  );

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

  context.clearSessionState();

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
  await fs.writeFile(sessionFile, sessionContent);

  context.setCurrentSession(sessionId, sessionFile);

  // Discover related topics using semantic search
  const discoveredTopics = await discoverRelatedTopics(_args.summary, context);
  if (discoveredTopics.length > 0) {
    // Add discovered topics to session file
    const updatedContent = addRelatedTopicsToSession(sessionContent, discoveredTopics);
    await fs.writeFile(sessionFile, updatedContent);
    sessionContent = updatedContent; // Update for potential Phase 2 use
  }

  // Add links for accessed files (topics/decisions modified via update_document)
  const updatedContentWithAccessed = addAccessedFilesLinksToSession(
    sessionContent,
    context.filesAccessed,
    context.vaultPath
  );
  if (updatedContentWithAccessed !== sessionContent) {
    await fs.writeFile(sessionFile, updatedContentWithAccessed);
    sessionContent = updatedContentWithAccessed;
  }

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
  ];

  const uniqueFilesToCheck = Array.from(new Set(filesToCheck));

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

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n') + repoDetectionMessage + autoCommitMessage + vaultCustodianReport,
      },
    ],
  };
}

export interface CloseSessionArgs {
  summary: string;
  topic?: string;
  handoff?: string; // Handoff notes for next session
  _invoked_by_slash_command?: boolean;
  // Phase control for two-phase workflow (Decision 022)
  analyze_only?: boolean; // Phase 1: analyze commits, return suggestions
  finalize?: boolean; // Phase 2: run custodian, save session
  session_data?: SessionData; // Pass state from Phase 1 to Phase 2
  skip_analysis?: boolean; // Skip commit analysis, go straight to finalization
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
  handoff?: string; // Handoff notes for next session
}

export interface CloseSessionResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface CloseSessionContext {
  vaultPath: string;
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
  updateUserReference: (args: { section: string; key: string; value: string }) => Promise<any>;
  slugify: (text: string) => string;
  setCurrentSession: (sessionId: string, sessionFile: string) => void;
  clearSessionState: () => void;
  hasPhase1Completed: () => boolean;
  markPhase1Complete: () => void;
  getMostRecentSessionDate: (repoSlug: string) => Promise<Date | null>;
  getSessionStartTime: () => Date | null; // Get first file access timestamp
  searchVault: (args: {
    query: string;
    max_results?: number;
    detail?: string;
  }) => Promise<{ content: Array<{ text: string }> }>;
}

export async function closeSession(
  args: CloseSessionArgs,
  context: CloseSessionContext
): Promise<CloseSessionResult> {
  // Enforce that this tool can only be called via the /close slash command
  if (args._invoked_by_slash_command !== true) {
    throw new Error(
      '❌ The close_session tool can ONLY be called via the /close slash command. Please ask the user to run the /close command to close this session.'
    );
  }

  await context.ensureVaultStructure();

  // Validate session_data is present if finalizing
  if (args.finalize && !args.session_data) {
    throw new Error(
      '❌ Phase 2 Error: finalize=true requires session_data from Phase 1.\n\n' +
        'The two-phase workflow requires calling close_session twice:\n' +
        '1. First call: Receives commit analysis and session_data\n' +
        '2. Second call: Pass finalize=true AND session_data from step 1\n\n' +
        'Example:\n' +
        'close_session({\n' +
        '  summary: "...",\n' +
        '  finalize: true,\n' +
        '  session_data: { ...data from Phase 1... },\n' +
        '  _invoked_by_slash_command: true\n' +
        '})'
    );
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

    return runPhase2Finalization(args, context, args.session_data!);
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

  // Always attempt repo detection - either from tracked files or from CWD
  try {
    const cwd = process.env.PWD || process.cwd();
    const repoPaths = await context.findGitRepos(cwd);

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

        if (repoPath === cwd) {
          score += 15;
          reasons.push('Repo is current working directory');
        } else if (cwd.startsWith(repoPath)) {
          score += 8;
          reasons.push('CWD is within this repo');
        } else if (repoPath.startsWith(cwd)) {
          score += 5;
          reasons.push('Repo is subdirectory of CWD');
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
              await context.updateUserReference({
                section: 'current_project',
                key: 'Project Name',
                value: topCandidate.name,
              });

              await context.updateUserReference({
                section: 'current_project',
                key: 'Last Updated',
                value: dateStr,
              });

              // Use session topic as description if available
              if (args.topic) {
                await context.updateUserReference({
                  section: 'current_project',
                  key: 'Description',
                  value: args.topic,
                });
              }
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

  // Build session content using template
  const sessionContent = generateSessionTemplate({
    sessionId,
    date: dateStr,
    topic: args.topic,
    topicsList,
    decisionsList,
    summary: args.summary,
    handoff: args.handoff,
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
  if (!args.skip_analysis && !args.finalize) {
    // Prevent Phase 1 from running more than once per session (prevents loop bug)
    if (context.hasPhase1Completed()) {
      throw new Error(
        '❌ Phase 1 Error: Commit analysis already completed for this session.\n\n' +
          'Phase 1 can only run once per session. You should either:\n' +
          '1. Call close_session with finalize: true and session_data from Phase 1\n' +
          '2. Use skip_analysis: true to bypass commit analysis entirely\n\n' +
          'This prevents the Phase 1 loop bug where commit analysis repeats indefinitely.'
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
      autoCommitMessage
    );

    // Mark Phase 1 as completed to prevent re-running
    context.markPhase1Complete();

    return result;
  }

  return runSinglePhaseClose(
    args,
    context,
    sessionId,
    sessionFile,
    sessionContent,
    dateStr,
    monthDir,
    detectedRepoInfo,
    autoCommitMessage
  );
}
