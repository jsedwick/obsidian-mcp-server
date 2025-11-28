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

const execAsync = promisify(exec);

/**
 * Find commits on the current branch that haven't been recorded in the vault yet
 * Applies three filters:
 * 1. Time-based: Only commits after the most recent session date for the repo
 * 2. Branch-based: Only commits on current branch but not on parent branch (main)
 * 3. Unrecorded: Only commits that don't already exist in vault
 */
async function findUnrecordedCommits(
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

/**
 * Find commits made during this session (since session start time)
 * Used for Phase 1 commit analysis
 */
async function findSessionCommits(
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
  } catch (_error) {
    // If git command fails, return empty array
    return [];
  }
}

export interface CloseSessionArgs {
  summary: string;
  topic?: string;
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
  slugify: (text: string) => string;
  setCurrentSession: (sessionId: string, sessionFile: string) => void;
  clearSessionState: () => void;
  getMostRecentSessionDate: (repoSlug: string) => Promise<Date | null>;
  getSessionStartTime: () => Date | null; // Get first file access timestamp
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

  // PHASE 2: Finalization mode (Decision 022)
  // Claude has finished updating topics, now run vault_custodian and save session
  if (args.finalize) {
    // Validate session_data is present
    if (!args.session_data) {
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

    const data = args.session_data;

    // Write session file (already generated in Phase 1)
    await fs.writeFile(data.sessionFile, data.sessionContent);

    // Set current session for back-linking
    context.setCurrentSession(data.sessionId, data.sessionFile);

    // Run vault custodian on all files from Phase 1
    let vaultCustodianReport = '';
    if (data.filesToCheck.length > 0) {
      try {
        const custodianResult = await context.vaultCustodian({
          files_to_check: data.filesToCheck,
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

    // Clear state for next conversation
    context.clearSessionState();

    // Build summary message
    let summary = `✅ Session finalized: ${data.sessionId}\n`;
    summary += `📄 Session file: ${data.sessionFile}\n\n`;

    if (data.topicsCreated.length > 0) {
      summary += `📚 Topics linked (${data.topicsCreated.length}):\n`;
      summary += data.topicsCreated.map(t => `   - ${t.title}`).join('\n') + '\n\n';
    }

    if (data.decisionsCreated.length > 0) {
      summary += `🎯 Decisions linked (${data.decisionsCreated.length}):\n`;
      summary += data.decisionsCreated.map(d => `   - ${d.title}`).join('\n') + '\n\n';
    }

    if (data.projectsCreated.length > 0) {
      summary += `📦 Projects linked (${data.projectsCreated.length}):\n`;
      summary += data.projectsCreated.map(p => `   - ${p.name}`).join('\n') + '\n\n';
    }

    if (data.filesAccessed.length > 0) {
      summary += `📁 Files accessed: ${data.filesAccessed.length}\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text: summary + data.repoDetectionMessage + vaultCustodianReport,
        },
      ],
    };
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

            // Auto-detect and record unrecorded commits on the current branch
            const repoSlug = context.slugify(topCandidate.name);
            const unrecordedCommits = await findUnrecordedCommits(
              topCandidate.path,
              repoSlug,
              context.vaultPath,
              context.getMostRecentSessionDate
            );

            if (unrecordedCommits.length > 0) {
              for (const commitHash of unrecordedCommits) {
                try {
                  await context.recordCommit({
                    repo_path: topCandidate.path,
                    commit_hash: commitHash,
                  });
                } catch (_error) {
                  // Log but don't fail - continue with next commit
                  console.error(
                    `Failed to record commit ${commitHash}: ${_error instanceof Error ? _error.message : String(_error)}`
                  );
                }
              }
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

  // Build topics list from created content
  const topicsList = context.topicsCreated.map(t => t.title);
  const decisionsList = context.decisionsCreated.map(d => d.title);

  // Proactively search for related existing content mentioned in the summary
  const relatedContent = await context.findRelatedContentInText(args.summary);

  // Extract tags from session summary using heuristic analysis
  const tagAnalysis = analyzeTopicContentInternal({
    content: args.summary,
    topic_name: args.topic || 'Work session',
  });
  const sessionTags = tagAnalysis.tags;

  // Build session content using template
  const sessionContent = generateSessionTemplate({
    sessionId,
    date: dateStr,
    topic: args.topic,
    topicsList,
    decisionsList,
    summary: args.summary,
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
  // Do NOT write session file or run vault_custodian yet
  if (!args.skip_analysis && !args.finalize) {
    // Default behavior: analyze commits and ask user
    const sessionStartTime = context.getSessionStartTime();

    if (detectedRepoInfo && sessionStartTime) {
      // Find commits made during this session
      const sessionCommits = await findSessionCommits(detectedRepoInfo.path, sessionStartTime);

      if (sessionCommits.length > 0) {
        // Analyze each commit for documentation impact
        let commitAnalysisReport = `\n\n📝 **Commit Analysis (${sessionCommits.length} commit${sessionCommits.length > 1 ? 's' : ''} made during session)**\n\n`;

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
            // Skip failed analyses
            commitAnalysisReport += `⚠️  Failed to analyze commit ${commitHash.substring(0, 12)}\n\n`;
          }
        }

        // Build repository detection message (for later)
        let repoDetectionMessage = '';
        if (detectedRepoInfo) {
          repoDetectionMessage = `\n\n📦 Git Repository Auto-Linked:\n`;
          repoDetectionMessage += `   ${detectedRepoInfo.name}\n`;
          repoDetectionMessage += `   Path: ${detectedRepoInfo.path}\n`;
          if (detectedRepoInfo.branch)
            repoDetectionMessage += `   Branch: ${detectedRepoInfo.branch}\n`;
        }

        // Build filesToCheck list
        const editedOrCreatedFiles = context.filesAccessed
          .filter(
            f =>
              (f.action === 'edit' || f.action === 'create') && f.path.startsWith(context.vaultPath)
          )
          .map(f => f.path);

        const filesToCheck: string[] = [
          sessionFile,
          ...context.topicsCreated.map(t => t.file),
          ...context.decisionsCreated.map(d => d.file),
          ...context.projectsCreated.map(p => p.file),
          ...editedOrCreatedFiles,
        ];

        // Remove duplicates
        const uniqueFilesToCheck = Array.from(new Set(filesToCheck));

        // Save session data for Phase 2
        const sessionData: SessionData = {
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
        };

        // Return commit analysis and instructions to Claude
        return {
          content: [
            {
              type: 'text',
              text: `${commitAnalysisReport}

---

**Phase 1 Complete: Commit Analysis**

${sessionCommits.length} commit${sessionCommits.length > 1 ? 's were' : ' was'} made during this session. The analysis above identifies topics that may need updating.

**Next Steps:**

1. **Review the suggested documentation updates** from each commit analysis
2. **Update relevant topics** using the suggestions (if applicable)
3. **When finished with updates**, call close_session again with these parameters:

\`\`\`typescript
close_session({
  summary: "${args.summary.replace(/"/g, '\\"')}",
  ${args.topic ? `topic: "${args.topic.replace(/"/g, '\\"')}",` : ''}
  finalize: true,
  _invoked_by_slash_command: true,
  session_data: ${JSON.stringify(sessionData, null, 2)}
})
\`\`\`

**Or skip updates** if no documentation changes are needed:
- Simply call with \`finalize: true\` and the session_data provided above`,
            },
          ],
        };
      }
    }

    // No commits found or no repo detected, proceed to legacy single-phase behavior
    // (fall through to write file and run vault_custodian)
  }

  // Legacy/skip_analysis mode: Write session file immediately
  await fs.writeFile(sessionFile, sessionContent);

  // Set current session for back-linking
  context.setCurrentSession(sessionId, sessionFile);

  // Note: Reciprocal linking is now handled automatically by vault_custodian
  // which runs at the end of this method. No need for manual back-linking here.

  // Build repository detection message
  let repoDetectionMessage = '';
  if (detectedRepoInfo) {
    repoDetectionMessage = `\n\n📦 Git Repository Auto-Linked:\n`;
    repoDetectionMessage += `   ${detectedRepoInfo.name}\n`;
    repoDetectionMessage += `   Path: ${detectedRepoInfo.path}\n`;
    if (detectedRepoInfo.branch) repoDetectionMessage += `   Branch: ${detectedRepoInfo.branch}\n`;
    repoDetectionMessage += `   ✅ Project page created/updated\n`;
    if (context.topicsCreated.length > 0) {
      repoDetectionMessage += `   ✅ ${context.topicsCreated.length} topic(s) linked to project\n`;
    }

    // Try to get unrecorded commits count for final message
    try {
      const repoSlug = context.slugify(detectedRepoInfo.name);
      const unrecordedCommits = await findUnrecordedCommits(
        detectedRepoInfo.path,
        repoSlug,
        context.vaultPath,
        context.getMostRecentSessionDate
      );
      if (unrecordedCommits.length > 0) {
        repoDetectionMessage += `   ✅ ${unrecordedCommits.length} commit(s) auto-recorded\n`;
      }
    } catch {
      // Silently fail - this is just for the message
    }
  }

  // Build summary message
  let summary = `✅ Session created: ${sessionId}\n`;
  summary += `📄 Session file: ${sessionFile}\n\n`;

  if (context.topicsCreated.length > 0) {
    summary += `📚 Topics linked (${context.topicsCreated.length}):\n`;
    summary += context.topicsCreated.map(t => `   - ${t.title}`).join('\n') + '\n\n';
  }

  if (context.decisionsCreated.length > 0) {
    summary += `🎯 Decisions linked (${context.decisionsCreated.length}):\n`;
    summary += context.decisionsCreated.map(d => `   - ${d.title}`).join('\n') + '\n\n';
  }

  if (context.projectsCreated.length > 0) {
    summary += `📦 Projects linked (${context.projectsCreated.length}):\n`;
    summary += context.projectsCreated.map(p => `   - ${p.name}`).join('\n') + '\n\n';
  }

  if (context.filesAccessed.length > 0) {
    summary += `📁 Files accessed: ${context.filesAccessed.length}\n`;
  }

  // Run vault custodian on files created/updated during this session
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

  // Remove duplicates
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

  // Clear state for next conversation
  context.clearSessionState();

  return {
    content: [
      {
        type: 'text',
        text: summary + repoDetectionMessage + vaultCustodianReport,
      },
    ],
  };
}
