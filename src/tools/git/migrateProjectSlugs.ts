/**
 * Tool: migrate_project_slugs
 * Description: Migrate existing project directories to use remote-based slug naming.
 *              Renames directories and updates all wiki links across the vault.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { GitService } from '../../services/git/GitService.js';
import { generateProjectSlug } from '../../utils/projectSlug.js';

export interface MigrateProjectSlugsArgs {
  dry_run?: boolean;
}

export interface MigrateProjectSlugsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface ProjectMigration {
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
  migrations: ProjectMigration[],
  dryRun: boolean
): Promise<number> {
  let content = await fs.readFile(filePath, 'utf-8');
  let updateCount = 0;

  for (const migration of migrations) {
    // Pattern: [[projects/old-slug/... → [[projects/new-slug/...
    const oldPattern = new RegExp(`\\[\\[projects/${migration.oldSlug}/`, 'g');
    const newReplacement = `[[projects/${migration.newSlug}/`;

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

export async function migrateProjectSlugs(
  args: MigrateProjectSlugsArgs,
  context: {
    vaultPath: string;
    gitService: GitService;
  }
): Promise<MigrateProjectSlugsResult> {
  const dryRun = args.dry_run ?? false;
  const projectsDir = path.join(context.vaultPath, 'projects');

  try {
    const migrations: ProjectMigration[] = [];
    const errors: string[] = [];

    // Phase 1: Scan existing projects and plan migrations
    const projectDirs = (await fs.readdir(projectsDir, { withFileTypes: true }))
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const oldSlug of projectDirs) {
      const projectDir = path.join(projectsDir, oldSlug);
      const projectFile = path.join(projectDir, 'project.md');

      try {
        const content = await fs.readFile(projectFile, 'utf-8');

        // Extract repository path (support both old and new formats)
        // New format: "  path: /path/to/repo" (nested under repository:)
        // Old format: "repo_path: /path/to/repo" (flat)
        let repoPath: string | null = null;
        const newFormatMatch = content.match(/^ {2}path: (.+)$/m);
        const oldFormatMatch = content.match(/^repo_path: (.+)$/m);

        if (newFormatMatch) {
          repoPath = newFormatMatch[1];
        } else if (oldFormatMatch) {
          repoPath = oldFormatMatch[1];
        }

        if (!repoPath) {
          errors.push(`No repository path found in ${oldSlug}/project.md`);
          continue;
        }

        // Extract remote URL (support both old and new formats)
        // New format: "  remote: https://..." (nested under repository:)
        // Old format: "repo_url: https://..." (flat)
        let remoteUrl: string | null = null;
        const newRemoteMatch = content.match(/^ {2}remote: (.+)$/m);
        const oldRemoteMatch = content.match(/^repo_url: (.+)$/m);

        if (newRemoteMatch) {
          remoteUrl = newRemoteMatch[1];
        } else if (oldRemoteMatch) {
          remoteUrl = oldRemoteMatch[1];
        }

        // Generate new slug
        const newSlug = generateProjectSlug(repoPath, remoteUrl);

        // Only migrate if slug has changed
        if (newSlug !== oldSlug) {
          migrations.push({
            oldSlug,
            newSlug,
            oldPath: projectDir,
            newPath: path.join(projectsDir, newSlug),
            repoPath,
            remoteUrl,
          });
        }
      } catch (error) {
        errors.push(
          `Failed to read ${oldSlug}/project.md: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (migrations.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: '✅ No migrations needed. All project slugs are already using the new format.',
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

          // Update project_slug in frontmatter
          const projectFile = path.join(migration.newPath, 'project.md');
          let content = await fs.readFile(projectFile, 'utf-8');

          // Update or add project_slug field
          if (content.match(/^project_slug: /m)) {
            content = content.replace(/^project_slug: .+$/m, `project_slug: ${migration.newSlug}`);
          } else {
            // Add after title field
            content = content.replace(/^(title: .+)$/m, `$1\nproject_slug: ${migration.newSlug}`);
          }

          await fs.writeFile(projectFile, content);
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
      `Project Slug Migration ${dryRun ? '(DRY RUN)' : 'Complete'}`,
      ``,
      `📊 Statistics:`,
      `- Projects scanned: ${projectDirs.length}`,
      `- Projects renamed: ${renamed.length}`,
      `- Vault files scanned: ${totalFilesScanned}`,
      `- Files with updated links: ${totalFilesUpdated}`,
      `- Total links updated: ${totalLinksUpdated}`,
      `- Errors: ${errors.length}`,
    ];

    if (renamed.length > 0) {
      summary.push(``, `✅ Projects migrated:`);
      renamed.forEach(migration => summary.push(`- ${migration}`));
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
        `   - Rename ${renamed.length} project director${renamed.length === 1 ? 'y' : 'ies'}`,
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
