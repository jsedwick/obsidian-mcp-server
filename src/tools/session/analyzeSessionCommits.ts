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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AnalyzeSessionCommitsArgs {
  // No arguments needed - analyzes current session automatically
}

export interface AnalyzeCommitsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface AnalyzeCommitsContext {
  vaultPath: string;
  filesAccessed: Array<{ path: string; action: string; timestamp: string }>;
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
// eslint-disable-next-line max-lines-per-function
export async function analyzeSessionCommits(
  _args: AnalyzeSessionCommitsArgs,
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

  // Auto-detect Git repository from current working directory or accessed files
  let detectedRepoInfo: { path: string; name: string; branch?: string; remote?: string } | null =
    null;

  try {
    const cwd = process.env.PWD || process.cwd();
    const repoPaths = await context.findGitRepos(cwd);

    if (repoPaths.length > 0) {
      // Use scoring to find most relevant repo
      const candidates: Array<{
        path: string;
        name: string;
        score: number;
        branch?: string;
        remote?: string;
      }> = [];

      for (const repoPath of repoPaths) {
        let score = 0;

        const filesInRepo = context.filesAccessed.filter(f => f.path.startsWith(repoPath));
        const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
        const readFiles = filesInRepo.filter(f => f.action === 'read');

        if (editedFiles.length > 0) {
          score += editedFiles.length * 10;
        }

        if (readFiles.length > 0) {
          score += readFiles.length * 5;
        }

        if (repoPath === cwd) {
          score += 15;
        } else if (cwd.startsWith(repoPath)) {
          score += 8;
        } else if (repoPath.startsWith(cwd)) {
          score += 5;
        }

        if (score > 0 || repoPaths.length === 1) {
          const info = await context.getRepoInfo(repoPath);
          candidates.push({
            path: repoPath,
            name: info.name,
            score,
            branch: info.branch,
            remote: info.remote ?? undefined,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length > 0) {
        const topCandidate = candidates[0];
        detectedRepoInfo = {
          path: topCandidate.path,
          name: topCandidate.name,
          branch: topCandidate.branch,
          remote: topCandidate.remote,
        };
      }
    }
  } catch (_error) {
    // Silently fail - repo detection is optional
  }

  if (!detectedRepoInfo) {
    return {
      content: [
        {
          type: 'text',
          text:
            '**No Git Repository Detected**\n\n' +
            'Unable to detect a Git repository for this session. Commit analysis requires a Git repository.\n\n' +
            'Make sure you are working in a Git repository, or specify the repository path if needed.',
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
            `Path: ${detectedRepoInfo.path}\n\n` +
            'No commits were made during this session, so there are no code changes to analyze for documentation impact.',
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
