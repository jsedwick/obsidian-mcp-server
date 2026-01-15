/**
 * Tool: detect_session_repositories
 *
 * Description: Analyze the current session to detect relevant Git repositories
 * based on files accessed and session context.
 */

import * as path from 'path';
import type { FileAccess } from '../../models/Session.js';
import type { RepoCandidate } from '../../models/Git.js';

export interface DetectSessionRepositoriesArgs {
  working_directories?: string[];
}

export interface DetectSessionRepositoriesResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface DetectSessionRepositoriesContext {
  currentSessionId: string | null;
  filesAccessed: FileAccess[];
  findGitRepos: (startPath: string, maxDepth?: number) => Promise<string[]>;
  getRepoInfo: (
    repoPath: string
  ) => Promise<{ name: string; branch?: string; remote?: string | null }>;
}

export async function detectSessionRepositories(
  args: DetectSessionRepositoriesArgs,
  context: DetectSessionRepositoriesContext
): Promise<DetectSessionRepositoriesResult> {
  // Can be called before or after session creation
  // If before, it helps inform user. If after, it can update session metadata.

  // Determine search directories:
  // 1. Use working_directories if provided (Claude Code passes its CWD and additional dirs)
  // 2. Fall back to process.env.PWD or process.cwd() (MCP server's CWD - usually not useful)
  const searchDirs: string[] =
    args.working_directories && args.working_directories.length > 0
      ? args.working_directories
      : [process.env.PWD || process.cwd()];

  // Find all git repositories from all search directories
  const allRepoPaths = new Set<string>();
  for (const dir of searchDirs) {
    try {
      const repos = await context.findGitRepos(dir);
      repos.forEach(r => allRepoPaths.add(r));
    } catch {
      // Skip directories that don't exist or can't be searched
    }
  }
  const repoPaths = Array.from(allRepoPaths);

  if (repoPaths.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No Git repositories found in the current working directory or subdirectories.',
        },
      ],
    };
  }

  // Score each repository
  const candidates: RepoCandidate[] = [];

  for (const repoPath of repoPaths) {
    let score = 0;
    const reasons: string[] = [];

    // Score based on files accessed
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

    // Score based on session topic
    if (context.currentSessionId) {
      const repoName = path.basename(repoPath);
      const sessionIdLower = context.currentSessionId.toLowerCase();
      const repoNameLower = repoName.toLowerCase();

      // Check if session ID contains repo name, or if they share significant words
      if (sessionIdLower.includes(repoNameLower)) {
        score += 20;
        reasons.push('Session topic matches repo name');
      } else {
        // Check for partial matches (e.g., "my-feature" in both "my-feature-repo" and "my-feature-implementation")
        const repoWords = repoNameLower.split(/[-_]/);
        const sessionWords = sessionIdLower.split(/[-_]/);
        const commonWords = repoWords.filter(
          word => word.length > 2 && sessionWords.some(sw => sw.includes(word) || word.includes(sw))
        );

        if (commonWords.length >= 2 || (commonWords.length === 1 && commonWords[0].length > 5)) {
          score += 20;
          reasons.push('Session topic matches repo name');
        }
      }
    }

    // Score based on proximity to any working directory
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

  // Sort by score
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No relevant repositories detected for this session. This may be a research/exploratory session.',
        },
      ],
    };
  }

  // Format results
  let resultText = `Detected ${candidates.length} repository candidate(s):\n\n`;

  candidates.forEach((candidate, idx) => {
    resultText += `${idx + 1}. **${candidate.name}** (score: ${candidate.score})\n`;
    resultText += `   Path: ${candidate.path}\n`;
    if (candidate.branch) resultText += `   Branch: ${candidate.branch}\n`;
    if (candidate.remote) resultText += `   Remote: ${candidate.remote}\n`;
    resultText += `   Reasons: ${candidate.reasons.join(', ')}\n\n`;
  });

  if (candidates.length === 1 || candidates[0].score > candidates[1]?.score * 2) {
    resultText += `\nRecommendation: Auto-select **${candidates[0].name}**\n`;
    resultText += `Use link_session_to_repository with path: ${candidates[0].path}`;
  } else {
    resultText += `\nMultiple candidates detected. Please select the appropriate repository using link_session_to_repository.`;
  }

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
