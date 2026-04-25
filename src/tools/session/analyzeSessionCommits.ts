/**
 * Tool: analyze_session_commits
 *
 * Description: Analyze commits made during the current session to identify documentation that may need updating.
 * This is a read-only analysis tool that helps prevent documentation drift by proactively identifying
 * topics, decisions, and other documentation that should be updated based on code changes.
 *
 * Usage: Call this tool BEFORE closing a session if you want to see what commits were made
 * and get suggestions for documentation updates. This allows for proactive documentation maintenance.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { GitError } from '../../utils/errors.js';
import { formatLocalDateTime } from '../../utils/dateFormat.js';
import type { FileAccess } from '../../models/Session.js';
import { selectBestRepoForCommitAnalysis, type DetectedRepo } from '../../utils/repoDetection.js';

const execAsync = promisify(exec);

/**
 * Find commits made since session start time
 */
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
    throw new GitError(`Failed to find session commits: ${repoPath}`, {
      repoPath,
      originalError: (error as Error).message,
    });
  }
}

export interface AnalyzeSessionCommitsArgs {
  /**
   * Claude Code's working directories. The MCP server runs as a separate
   * process with a different cwd, so passing these enables correct
   * Git repository detection. Decision 037.
   */
  working_directories?: string[];

  /**
   * Absolute path to the Git repository to analyze. When provided, bypasses
   * auto-detection scoring entirely. Use when the session was linked to a
   * specific repo via close_session's detected_repo_override.
   */
  detected_repo_override?: string;
}

export interface AnalyzeCommitsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface AnalyzeCommitsContext {
  vaultPath: string;
  allVaultPaths: string[];
  filesAccessed: FileAccess[];
  findGitRepos: (startPath: string, maxDepth?: number) => Promise<string[]>;
  getRepoInfo: (
    repoPath: string
  ) => Promise<{ name: string; branch?: string; remote?: string | null }>;
  analyzeCommitImpact: (args: {
    repo_path: string;
    commit_hash: string;
    include_diff?: boolean;
  }) => Promise<{ content: Array<{ text: string }> }>;
  getSessionStartTime: () => Date | null;
}

/**
 * Analyze commits made during the current session
 *
 * Returns:
 * - List of commits with detailed impact analysis
 * - Suggestions for which topics/decisions to update
 * - Files changed and their significance
 *
 * This tool is read-only and does not modify any files.
 */
export async function analyzeSessionCommits(
  args: AnalyzeSessionCommitsArgs,
  context: AnalyzeCommitsContext
): Promise<AnalyzeCommitsResult> {
  const sessionStartTime = context.getSessionStartTime();

  if (!sessionStartTime) {
    return {
      content: [
        {
          type: 'text',
          text:
            '**No Session Start Time**\n\n' +
            'Unable to determine when this session started. Commit analysis requires knowing when the session began to identify which commits were made during this conversation.\n\n' +
            'This typically means no files have been accessed yet during this session.',
        },
      ],
    };
  }

  // Decision 037 priority: override → working_directories → infer → cwd.
  // Previously this tool only used process.cwd(), which silently returned
  // the wrong repo when the session was linked via detected_repo_override
  // or when the user's working dir differed from the MCP server's cwd.
  let detectedRepoInfo: DetectedRepo | null = null;
  try {
    detectedRepoInfo = await selectBestRepoForCommitAnalysis({
      detectedRepoOverride: args.detected_repo_override,
      workingDirectories: args.working_directories,
      filesAccessed: context.filesAccessed,
      fallbackCwd: process.env.PWD || process.cwd(),
      vaultPaths: context.allVaultPaths,
      findGitRepos: context.findGitRepos,
      getRepoInfo: context.getRepoInfo,
    });
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `**Repository Detection Error**\n\n${(error as Error).message}`,
        },
      ],
    };
  }

  if (!detectedRepoInfo) {
    return {
      content: [
        {
          type: 'text',
          text:
            '**No Git Repository Detected**\n\n' +
            'Unable to detect a Git repository for this session. Commit analysis requires a Git repository.\n\n' +
            'Tips:\n' +
            "- Pass `working_directories` (Claude Code's `<env>` CWDs) so the tool can search the right place.\n" +
            '- Pass `detected_repo_override` with an absolute repo path if the session is linked to a specific repo.\n',
        },
      ],
    };
  }

  // Find commits made during this session
  let sessionCommits: string[] = [];
  let commitDetectionError = '';

  try {
    sessionCommits = await findSessionCommits(detectedRepoInfo.path, sessionStartTime);
  } catch (error) {
    commitDetectionError = `⚠️  Failed to detect session commits: ${String(error)}\n\n`;
  }

  if (sessionCommits.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            (commitDetectionError || '') +
            '**No Commits Detected**\n\n' +
            `Session started: ${formatLocalDateTime(sessionStartTime)}\n` +
            `Repository: ${detectedRepoInfo.name}\n` +
            `Path: ${detectedRepoInfo.path}\n` +
            `Detection source: ${detectedRepoInfo.source}\n\n` +
            'No commits were made during this session, so there are no code changes to analyze for documentation impact.\n\n' +
            'If you expected commits here:\n' +
            '- Verify `detected_repo_override` points at the correct repo.\n' +
            '- Check whether the commits predate `getSessionStartTime()` (e.g., the MCP server was restarted mid-session and reset its session start to "now").\n',
        },
      ],
    };
  }

  // Analyze each commit
  let commitAnalysisReport = commitDetectionError;
  commitAnalysisReport += `
**Commit Analysis for ${detectedRepoInfo.name}**

Repository: ${detectedRepoInfo.path}
Branch: ${detectedRepoInfo.branch || 'unknown'}
Detection source: ${detectedRepoInfo.source}
Session started: ${formatLocalDateTime(sessionStartTime)}
Commits detected: ${sessionCommits.length}

---

`;

  for (const commitHash of sessionCommits) {
    try {
      const analysis = await context.analyzeCommitImpact({
        repo_path: detectedRepoInfo.path,
        commit_hash: commitHash,
        include_diff: false,
      });

      if (analysis.content?.[0]) {
        commitAnalysisReport += `${analysis.content[0].text}\n\n---\n\n`;
      }
    } catch (_error) {
      commitAnalysisReport += `⚠️  Failed to analyze commit ${commitHash.substring(0, 12)}\n\n`;
    }
  }

  commitAnalysisReport += `
**Recommended Actions**

Based on the commit analysis above, you should:

1. **Search the vault** for topics related to the changed code:
   - Use \`search_vault\` with keywords from the commit messages
   - Think conceptually - if a commit changes authentication, consider ALL auth-related topics
   - If a commit changes an API, consider topics about usage, integration, and examples

2. **Update affected documentation** proactively:
   - Use \`update_document\` to update topics, decisions, or other vault files
   - Always provide a \`reason\` parameter referencing the commit (e.g., "Updated for commit ${sessionCommits[0].substring(0, 12)}")
   - Create new topics with \`create_topic_page\` if new concepts warrant documentation
   - **Err on the side of updating** rather than leaving documentation outdated

3. **After all documentation is current**, run \`/close\` to finalize the session:
   - Documentation updates will be automatically linked in the session file
   - vault_custodian will validate and organize all updated files
   - Commits will be recorded and linked to the project

**Note:** This is a read-only analysis. No files have been modified yet.
`;

  return {
    content: [
      {
        type: 'text',
        text: commitAnalysisReport,
      },
    ],
  };
}
