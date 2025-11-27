/**
 * Tool: record_commit
 * Description: Record a Git commit in the Obsidian vault, creating a commit page with diff and session links.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GitService } from '../../services/git/GitService.js';
import { generateCommitTemplate } from '../../templates.js';
import { getOrGenerateProjectSlug } from '../../utils/projectSlug.js';

const execAsync = promisify(exec);

export interface RecordCommitArgs {
  repo_path: string;
  commit_hash: string;
}

export interface RecordCommitResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export async function recordCommit(
  args: RecordCommitArgs,
  context: {
    vaultPath: string;
    gitService: GitService;
    currentSessionId: string | null;
    currentSessionFile: string | null;
  }
): Promise<RecordCommitResult> {
  if (!context.currentSessionId) {
    throw new Error('No active session.');
  }

  // Get repository info
  const name = await context.gitService.getRepositoryName(args.repo_path);
  const remote = await context.gitService.getRemoteUrl(args.repo_path);

  // Get or generate slug - checks for existing project first to prevent orphaning
  // when remotes are added/changed
  const projectsDir = path.join(context.vaultPath, 'projects');
  const slug = await getOrGenerateProjectSlug(args.repo_path, remote, projectsDir);
  const projectDir = path.join(projectsDir, slug);
  const commitsDir = path.join(projectDir, 'commits');

  await fs.mkdir(commitsDir, { recursive: true });

  // Get commit information
  const { stdout: commitInfo } = await execAsync(
    `git show --format="%H%n%h%n%an%n%ae%n%aI%n%s%n%b" --stat ${args.commit_hash}`,
    { cwd: args.repo_path }
  );

  const lines = commitInfo.split('\n');
  const fullHash = lines[0];
  const shortHash = lines[1];
  const authorName = lines[2];
  const authorEmail = lines[3];
  const date = lines[4];
  const subject = lines[5];
  const body = lines.slice(6).join('\n');

  // Get diff
  const { stdout: diff } = await execAsync(`git show ${args.commit_hash}`, { cwd: args.repo_path });

  // Get stats
  const { stdout: stats } = await execAsync(`git show --stat ${args.commit_hash}`, {
    cwd: args.repo_path,
  });

  // Get branch information
  let branch = 'unknown';
  try {
    const branches = await context.gitService.getBranchesContainingCommit(
      args.repo_path,
      args.commit_hash
    );

    // Prefer non-detached branches, prefer main/master, otherwise take first
    branch =
      branches.find(b => b === 'main') ||
      branches.find(b => b === 'master') ||
      branches.find(b => !b.startsWith('HEAD')) ||
      branches[0] ||
      'unknown';
  } catch {
    // If branch detection fails, try to get current branch
    try {
      branch = await context.gitService.getCurrentBranch(args.repo_path);
    } catch {
      // Keep default 'unknown'
    }
  }

  const commitFile = path.join(commitsDir, `${shortHash}.md`);
  const today = new Date().toISOString().split('T')[0];

  const content = generateCommitTemplate({
    commitHash: fullHash,
    shortHash,
    authorName,
    authorEmail,
    date,
    branch,
    subject,
    body,
    stats,
    diff,
    sessionId: context.currentSessionId,
    projectName: name,
    projectSlug: slug,
  });

  await fs.writeFile(commitFile, content);

  // Update project page with commit link
  const projectFile = path.join(projectDir, 'project.md');
  const projectContent = await fs.readFile(projectFile, 'utf-8');
  const commitLink = `- [[projects/${slug}/commits/${shortHash}|${shortHash}: ${subject}]] (${today})`;

  const updatedContent = projectContent.replace(
    /## Recent Activity\n/,
    `## Recent Activity\n${commitLink}\n`
  );

  await fs.writeFile(projectFile, updatedContent);

  // Update session file with commit reference
  if (context.currentSessionFile) {
    const sessionContent = await fs.readFile(context.currentSessionFile, 'utf-8');
    const appendContent = `\n## Git Commit\n- [[projects/${slug}/commits/${shortHash}|${shortHash}]]: ${subject}\n`;
    await fs.writeFile(context.currentSessionFile, sessionContent + appendContent);
  }

  return {
    content: [
      {
        type: 'text',
        text: `Commit recorded: ${shortHash}\nCommit page: projects/${slug}/commits/${shortHash}.md\nLinked to session and project.`,
      },
    ],
  };
}
