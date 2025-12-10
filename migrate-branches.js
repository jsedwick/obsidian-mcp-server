#!/usr/bin/env node

/**
 * Standalone script to migrate commit files and add branch information
 * This duplicates the logic from the migrate_commit_branches MCP tool
 * so it can be run directly without restarting the MCP server
 */

import { promises as fs } from 'fs';
import fssync from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// Load vault path from config file (same logic as MCP server)
function loadVaultPath() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.join(currentDir, '..');

  const configPaths = [
    path.join(projectRoot, '.obsidian-mcp.json'),    // project-root/.obsidian-mcp.json
    path.join(process.env.HOME || '', '.obsidian-mcp.json'),  // ~/.obsidian-mcp.json
    path.join(process.env.HOME || '', '.config', '.obsidian-mcp.json')  // ~/.config/.obsidian-mcp.json
  ];

  // Try each path until we find one that exists
  for (const configPath of configPaths) {
    try {
      const configData = fssync.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);

      if (config.primaryVault && config.primaryVault.path) {
        return config.primaryVault.path.replace(/\/+$/, ''); // Remove trailing slashes
      }
    } catch (_error) {
      // Try next config path
      continue;
    }
  }

  // Fall back to environment variable or default
  return process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '', 'obsidian-vault');
}

const VAULT_PATH = loadVaultPath();

async function migrateCommitBranches(projectSlug = null, dryRun = false) {
  const projectsDir = path.join(VAULT_PATH, 'projects');

  try {
    // Get all project directories or just the specified one
    const projectDirs = projectSlug
      ? [path.join(projectsDir, projectSlug)]
      : (await fs.readdir(projectsDir, { withFileTypes: true }))
          .filter(dirent => dirent.isDirectory())
          .map(dirent => path.join(projectsDir, dirent.name));

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const errors = [];
    const updates = [];

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
      let repoPath = null;

      try {
        const projectContent = await fs.readFile(projectFile, 'utf-8');
        const repoPathMatch = projectContent.match(/^  path: (.+)$/m);
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
            const { stdout: branchOutput } = await execAsync(
              `git branch --contains ${commitHash} --format='%(refname:short)'`,
              { cwd: repoPath }
            );
            const branches = branchOutput.trim().split('\n').filter(b => b);
            // Prefer non-detached branches, prefer main/master, otherwise take first
            branch = branches.find(b => b === 'main') ||
                     branches.find(b => b === 'master') ||
                     branches.find(b => !b.startsWith('HEAD')) ||
                     branches[0] ||
                     'unknown';
          } catch (error) {
            // If branch detection fails, try to get current branch
            try {
              const { stdout: currentBranch } = await execAsync(
                `git rev-parse --abbrev-ref HEAD`,
                { cwd: repoPath }
              );
              branch = currentBranch.trim() || 'unknown';
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
          errors.push(`Failed to process ${commitFile}: ${error.message}`);
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
      summary.push(``, `💡 Run again with --no-dry-run to apply changes.`);
    }

    console.log(summary.join('\n'));

  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectSlugArg = args.find(arg => arg.startsWith('--project='));
const projectSlug = projectSlugArg ? projectSlugArg.split('=')[1] : null;

// Run migration
migrateCommitBranches(projectSlug, dryRun).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
