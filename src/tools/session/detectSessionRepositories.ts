/**
 * Tool: detect_session_repositories
 *
 * Description: Analyze the current session to detect relevant Git repositories
 * based on files accessed and session context.
 */

import * as path from 'path';
import type { FileAccess } from '../../models/Session.js';
import type { RepoCandidate } from '../../models/Git.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DetectSessionRepositoriesArgs {
  // No arguments
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
  _args: DetectSessionRepositoriesArgs,
  context: DetectSessionRepositoriesContext
): Promise<DetectSessionRepositoriesResult> {
  // Can be called before or after session creation
  // If before, it helps inform user. If after, it can update session metadata.

  // Get current working directory from environment or use vault path
  const cwd = process.env.PWD || process.cwd();

  // Find all git repositories
  const repoPaths = await context.findGitRepos(cwd);

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

    // Score based on proximity to CWD
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
