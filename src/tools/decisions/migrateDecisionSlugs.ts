/**
 * Tool: migrate_decision_slugs
 * Description: Migrate existing decision directories to use remote-based slug naming.
 *              Renames directories and updates all wiki links across the vault.
 *
 * This aligns decision directory naming with project directory naming (Decision 021)
 * to ensure collision-resistant slugs across the vault.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { GitService } from '../../services/git/GitService.js';
import { generateProjectSlug } from '../../utils/projectSlug.js';

export interface MigrateDecisionSlugsArgs {
  dry_run?: boolean;
}

export interface MigrateDecisionSlugsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface DecisionMigration {
  oldSlug: string;
  newSlug: string;
  oldPath: string;
  newPath: string;
  repoPath: string;
  remoteUrl: string | null;
}

/**
 * Find all markdown files in a directory recursively
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip certain directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        files.push(...(await findMarkdownFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Update wiki links in a file
 */
async function updateLinksInFile(
  filePath: string,
  migrations: DecisionMigration[],
  dryRun: boolean
): Promise<number> {
  let content = await fs.readFile(filePath, 'utf-8');
  let updateCount = 0;

  for (const migration of migrations) {
    // Pattern: [[decisions/old-slug/... → [[decisions/new-slug/...
    const oldPattern = new RegExp(`\\[\\[decisions/${migration.oldSlug}/`, 'g');
    const newReplacement = `[[decisions/${migration.newSlug}/`;

    const matches = content.match(oldPattern);
    if (matches) {
      updateCount += matches.length;
      content = content.replace(oldPattern, newReplacement);
    }
  }

  if (updateCount > 0 && !dryRun) {
    await fs.writeFile(filePath, content);
  }

  return updateCount;
}

/**
 * Try to find the repository path associated with a decision directory.
 *
 * Strategy: Look for a corresponding project directory with the same or similar name
 * and extract the repo_path from its project.md file.
 */
async function findRepoPathForDecisionSlug(
  oldSlug: string,
  projectsDir: string
): Promise<{ repoPath: string; remoteUrl: string | null } | null> {
  try {
    const projectDirs = (await fs.readdir(projectsDir, { withFileTypes: true }))
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    // Try to find a project that matches this decision slug
    // First, try exact match, then try partial match
    const candidates = projectDirs.filter(
      projectSlug =>
        projectSlug === oldSlug || // Exact match
        projectSlug.endsWith(`-${oldSlug}`) || // e.g., uoregon-jsdev-obsidian-mcp-server ends with obsidian-mcp-server
        oldSlug.endsWith(`-${projectSlug}`) // Reverse case
    );

    for (const projectSlug of candidates) {
      const projectFile = path.join(projectsDir, projectSlug, 'project.md');

      try {
        const content = await fs.readFile(projectFile, 'utf-8');

        // Extract repository path (support both old and new formats)
        let repoPath: string | null = null;
        const newFormatMatch = content.match(/^ {2}path: "?(.+?)"?$/m);
        const oldFormatMatch = content.match(/^repo_path: "?(.+?)"?$/m);

        if (newFormatMatch) {
          repoPath = newFormatMatch[1];
        } else if (oldFormatMatch) {
          repoPath = oldFormatMatch[1];
        }

        if (!repoPath) {
          continue;
        }

        // Extract remote URL
        let remoteUrl: string | null = null;
        const newRemoteMatch = content.match(/^ {2}remote: "?(.+?)"?$/m);
        const oldRemoteMatch = content.match(/^repo_url: "?(.+?)"?$/m);

        if (newRemoteMatch) {
          remoteUrl = newRemoteMatch[1];
        } else if (oldRemoteMatch) {
          remoteUrl = oldRemoteMatch[1];
        }

        return { repoPath, remoteUrl };
      } catch {
        // Skip files we can't read
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function migrateDecisionSlugs(
  args: MigrateDecisionSlugsArgs,
  context: {
    vaultPath: string;
    gitService: GitService;
  }
): Promise<MigrateDecisionSlugsResult> {
  const dryRun = args.dry_run ?? false;
  const decisionsDir = path.join(context.vaultPath, 'decisions');
  const projectsDir = path.join(context.vaultPath, 'projects');

  try {
    const migrations: DecisionMigration[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];

    // Phase 1: Scan existing decision directories and plan migrations
    const decisionDirs = (await fs.readdir(decisionsDir, { withFileTypes: true }))
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const oldSlug of decisionDirs) {
      // Skip 'vault' directory - it's for vault-level decisions
      if (oldSlug === 'vault') {
        skipped.push(`${oldSlug} (vault-level decisions, no migration needed)`);
        continue;
      }

      // Try to find corresponding repo information
      const repoInfo = await findRepoPathForDecisionSlug(oldSlug, projectsDir);

      if (!repoInfo) {
        errors.push(
          `${oldSlug}: Could not find corresponding project. Please migrate manually or provide repo_path.`
        );
        continue;
      }

      // Generate new slug using the same strategy as projects
      const newSlug = generateProjectSlug(repoInfo.repoPath, repoInfo.remoteUrl);

      // Only migrate if slug has changed
      if (newSlug !== oldSlug) {
        migrations.push({
          oldSlug,
          newSlug,
          oldPath: path.join(decisionsDir, oldSlug),
          newPath: path.join(decisionsDir, newSlug),
          repoPath: repoInfo.repoPath,
          remoteUrl: repoInfo.remoteUrl,
        });
      } else {
        skipped.push(`${oldSlug} (already using correct slug)`);
      }
    }

    if (migrations.length === 0) {
      const summary = [
        '✅ No migrations needed. All decision directories are using correct slugs.',
      ];
      if (skipped.length > 0) {
        summary.push('', '📋 Skipped directories:');
        skipped.forEach(s => summary.push(`- ${s}`));
      }
      if (errors.length > 0) {
        summary.push('', '⚠️ Directories requiring manual attention:');
        errors.forEach(e => summary.push(`- ${e}`));
      }
      return {
        content: [
          {
            type: 'text',
            text: summary.join('\n'),
          },
        ],
      };
    }

    // Phase 2: Rename directories
    const renamed: string[] = [];
    for (const migration of migrations) {
      try {
        // Check if new path already exists
        try {
          await fs.access(migration.newPath);
          errors.push(
            `Cannot migrate ${migration.oldSlug} → ${migration.newSlug}: destination already exists`
          );
          continue;
        } catch {
          // Good, destination doesn't exist
        }

        if (!dryRun) {
          await fs.rename(migration.oldPath, migration.newPath);
        }

        renamed.push(`${migration.oldSlug} → ${migration.newSlug}`);
      } catch (error) {
        errors.push(
          `Failed to rename ${migration.oldSlug}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Phase 3: Update wiki links across vault
    let totalFilesScanned = 0;
    let totalFilesUpdated = 0;
    let totalLinksUpdated = 0;

    const vaultFiles = await findMarkdownFiles(context.vaultPath);
    totalFilesScanned = vaultFiles.length;

    for (const file of vaultFiles) {
      try {
        const updateCount = await updateLinksInFile(file, migrations, dryRun);
        if (updateCount > 0) {
          totalFilesUpdated++;
          totalLinksUpdated += updateCount;
        }
      } catch (error) {
        errors.push(
          `Failed to update links in ${path.relative(context.vaultPath, file)}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Build summary report
    const summary = [
      `Decision Slug Migration ${dryRun ? '(DRY RUN)' : 'Complete'}`,
      ``,
      `📊 Statistics:`,
      `- Decision directories scanned: ${decisionDirs.length}`,
      `- Directories renamed: ${renamed.length}`,
      `- Vault files scanned: ${totalFilesScanned}`,
      `- Files with updated links: ${totalFilesUpdated}`,
      `- Total links updated: ${totalLinksUpdated}`,
      `- Skipped: ${skipped.length}`,
      `- Errors: ${errors.length}`,
    ];

    if (renamed.length > 0) {
      summary.push(``, `✅ Directories migrated:`);
      renamed.forEach(migration => summary.push(`- ${migration}`));
    }

    if (skipped.length > 0) {
      summary.push(``, `📋 Skipped:`);
      skipped.forEach(s => summary.push(`- ${s}`));
    }

    if (errors.length > 0) {
      summary.push(``, `❌ Errors:`);
      errors.forEach(error => summary.push(`- ${error}`));
    }

    if (dryRun && renamed.length > 0) {
      summary.push(
        ``,
        `💡 Run again with dry_run: false to apply changes.`,
        ``,
        `⚠️  This will:`,
        `   - Rename ${renamed.length} decision director${renamed.length === 1 ? 'y' : 'ies'}`,
        `   - Update ${totalLinksUpdated} wiki link${totalLinksUpdated === 1 ? '' : 's'} across ${totalFilesUpdated} file${totalFilesUpdated === 1 ? '' : 's'}`
      );
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
