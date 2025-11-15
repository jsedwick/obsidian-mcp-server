/**
 * Tool: link_session_to_repository
 * Description: Link the current session to a specific Git repository.
 */

import * as fs from 'fs/promises';
import { GitService } from '../../services/git/GitService.js';
import type { FileAccess } from '../../models/Session.js';

export interface LinkSessionToRepositoryArgs {
  repo_path: string;
}

export interface LinkSessionToRepositoryResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export async function linkSessionToRepository(
  args: LinkSessionToRepositoryArgs,
  context: {
    currentSessionFile: string | null;
    filesAccessed: FileAccess[];
    gitService: GitService;
    createProjectPage: (args: { repo_path: string }) => Promise<LinkSessionToRepositoryResult>;
  }
): Promise<LinkSessionToRepositoryResult> {
  if (!context.currentSessionFile) {
    throw new Error('No active session.');
  }

  // Verify repo exists and is a git repo
  if (!(await context.gitService.isGitRepository(args.repo_path))) {
    throw new Error(`Not a valid Git repository: ${args.repo_path}`);
  }

  // Get repository info
  const name = await context.gitService.getRepositoryName(args.repo_path);

  // Update session file with repository info
  const content = await fs.readFile(context.currentSessionFile, 'utf-8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    throw new Error('Invalid session file format');
  }

  let frontmatter = frontmatterMatch[1];

  // Add or update repository field
  if (frontmatter.includes('repository:')) {
    // Update existing
    frontmatter = frontmatter.replace(
      /repository:[\s\S]*?(?=\n[a-z_]+:|$)/,
      `repository:\n  path: ${args.repo_path}\n  name: ${name}\n  commits: []`
    );
  } else {
    // Add new
    frontmatter += `\nrepository:\n  path: ${args.repo_path}\n  name: ${name}\n  commits: []`;
  }

  // Add files accessed
  if (context.filesAccessed.length > 0) {
    const filesYaml = context.filesAccessed.map(f =>
      `  - path: ${f.path}\n    action: ${f.action}\n    timestamp: ${f.timestamp}`
    ).join('\n');
    frontmatter += `\nfiles_accessed:\n${filesYaml}`;
  }

  const mainContent = content.substring(frontmatterMatch[0].length);
  const newContent = `---\n${frontmatter}\n---${mainContent}`;

  await fs.writeFile(context.currentSessionFile, newContent);

  // Create or update project page
  await context.createProjectPage({ repo_path: args.repo_path });

  return {
    content: [
      {
        type: 'text',
        text: `Session linked to repository: ${name}\nPath: ${args.repo_path}\nProject page created/updated in vault.`,
      },
    ],
  };
}
