/**
 * Tool: migrate_commit_branches
 * Description: Migrate existing commit files to add branch information. Scans all recorded commits and adds branch field to frontmatter based on Git history.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { GitService } from '../../services/git/GitService.js';

export interface MigrateCommitBranchesArgs {
  project_slug?: string;
  dry_run?: boolean;
}

export interface MigrateCommitBranchesResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export async function migrateCommitBranches(
  args: MigrateCommitBranchesArgs,
  context: {
    vaultPath: string;
    gitService: GitService;
  }
): Promise<MigrateCommitBranchesResult> {
  const dryRun = args.dry_run ?? false;
  const projectsDir = path.join(context.vaultPath, 'projects');

  try {
    // Get all project directories or just the specified one
    const projectDirs = args.project_slug
      ? [path.join(projectsDir, args.project_slug)]
      : (await fs.readdir(projectsDir, { withFileTypes: true }))
          .filter(dirent => dirent.isDirectory())
          .map(dirent => path.join(projectsDir, dirent.name));

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const updates: string[] = [];

    for (const projectDir of projectDirs) {
      const commitsDir = path.join(projectDir, 'commits');

      // Check if commits directory exists
      try {
        await fs.access(commitsDir);
      } catch {
        continue; // Skip if no commits directory
      }

      // Get repository path from project.md
      const projectFile = path.join(projectDir, 'project.md');
      let repoPath: string | null = null;

      try {
        const projectContent = await fs.readFile(projectFile, 'utf-8');
        const repoPathMatch = projectContent.match(/^ {2}path: (.+)$/m);
        if (repoPathMatch) {
          repoPath = repoPathMatch[1];
        }
      } catch (error) {
        errors.push(`Failed to read project file: ${projectFile}`);
        continue;
      }

      if (!repoPath) {
        errors.push(`No repository path found in ${projectFile}`);
        continue;
      }

      // Get all commit files
      const commitFiles = (await fs.readdir(commitsDir))
        .filter(file => file.endsWith('.md'));

      for (const commitFile of commitFiles) {
        totalProcessed++;
        const commitPath = path.join(commitsDir, commitFile);

        try {
          const content = await fs.readFile(commitPath, 'utf-8');

          // Check if branch field already exists
          if (content.match(/^branch: /m)) {
            totalSkipped++;
            continue;
          }

          // Extract commit hash from frontmatter
          const hashMatch = content.match(/^commit_hash: ([a-f0-9]+)$/m);
          if (!hashMatch) {
            errors.push(`No commit hash found in ${commitFile}`);
            continue;
          }

          const commitHash = hashMatch[1];

          // Get branch information
          let branch = 'unknown';
          try {
            const branches = await context.gitService.getBranchesContainingCommit(
              repoPath,
              commitHash
            );

            // Prefer non-detached branches, prefer main/master, otherwise take first
            branch = branches.find(b => b === 'main') ||
                     branches.find(b => b === 'master') ||
                     branches.find(b => !b.startsWith('HEAD')) ||
                     branches[0] ||
                     'unknown';
          } catch (error) {
            // If branch detection fails, try to get current branch
            try {
              branch = await context.gitService.getCurrentBranch(repoPath);
            } catch {
              branch = 'unknown';
            }
          }

          // Add branch field to frontmatter (after date field)
          const updatedContent = content.replace(
            /^(date: .+)$/m,
            `$1\nbranch: ${branch}`
          );

          // Also add branch to the display section if it doesn't exist
          const finalContent = updatedContent.replace(
            /^(\*\*Project:\*\* .+)$/m,
            `$1\n**Branch:** \`${branch}\``
          );

          if (!dryRun) {
            await fs.writeFile(commitPath, finalContent);
          }

          totalUpdated++;
          updates.push(`${commitFile}: ${branch}`);

        } catch (error) {
          errors.push(`Failed to process ${commitFile}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const summary = [
      `Branch Migration ${dryRun ? '(DRY RUN)' : 'Complete'}`,
      ``,
      `📊 Statistics:`,
      `- Total commits processed: ${totalProcessed}`,
      `- Commits updated: ${totalUpdated}`,
      `- Commits skipped (already had branch): ${totalSkipped}`,
      `- Errors: ${errors.length}`,
    ];

    if (updates.length > 0 && updates.length <= 20) {
      summary.push(``, `✅ Updated commits:`);
      updates.forEach(update => summary.push(`- ${update}`));
    } else if (updates.length > 20) {
      summary.push(``, `✅ Updated ${updates.length} commits (showing first 20):`);
      updates.slice(0, 20).forEach(update => summary.push(`- ${update}`));
    }

    if (errors.length > 0) {
      summary.push(``, `❌ Errors:`);
      errors.forEach(error => summary.push(`- ${error}`));
    }

    if (dryRun && totalUpdated > 0) {
      summary.push(``, `💡 Run again with dry_run: false to apply changes.`);
    }

    return {
      content: [
        {
          type: 'text',
          text: summary.join('\n'),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
