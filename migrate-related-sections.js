#!/usr/bin/env node

/**
 * Migration script to standardize "Related" sections across all note types
 *
 * Changes:
 * 1. Commits: Convert `## Related` with inline bold labels to separate sections
 * 2. Projects: Rename `## Topics` to `## Related Topics`
 *
 * Usage:
 *   node migrate-related-sections.js [--dry-run] [--commits-only] [--projects-only]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VAULT_PATH = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const COMMITS_ONLY = process.argv.includes('--commits-only');
const PROJECTS_ONLY = process.argv.includes('--projects-only');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Migrate commit file from inline Related section to separate sections
 */
function migrateCommitFile(content) {
  // Pattern: ## Related\n- **Session:** [[session-id]]\n- **Project:** [[project-link]]
  const relatedPattern = /^## Related\n(- \*\*Session:\*\* (\[\[.*?\]\])\n)?- \*\*Project:\*\* (\[\[.*?\]\])\n/m;

  const match = content.match(relatedPattern);
  if (!match) {
    return { changed: false, content };
  }

  const sessionLink = match[2] || null;
  const projectLink = match[3];

  let newRelatedSection = '';

  if (sessionLink) {
    newRelatedSection += `## Related Sessions\n- ${sessionLink}\n\n`;
  }

  newRelatedSection += `## Related Projects\n- ${projectLink}\n`;

  const newContent = content.replace(relatedPattern, newRelatedSection);

  return { changed: true, content: newContent };
}

/**
 * Migrate project file from "## Topics" to "## Related Topics"
 */
function migrateProjectFile(content) {
  // Simple replacement of "## Topics" with "## Related Topics"
  // Need to be careful not to replace "## Topics Created" in sessions
  const topicsPattern = /^## Topics$/m;

  if (!topicsPattern.test(content)) {
    return { changed: false, content };
  }

  const newContent = content.replace(topicsPattern, '## Related Topics');

  return { changed: true, content: newContent };
}

/**
 * Find all commit files recursively
 */
async function findCommitFiles(dir) {
  const commits = [];

  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory() && entry.name === 'commits') {
        // Found a commits directory
        const commitFiles = await fs.readdir(fullPath);
        for (const file of commitFiles) {
          if (file.endsWith('.md')) {
            commits.push(path.join(fullPath, file));
          }
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await scan(fullPath);
      }
    }
  }

  await scan(dir);
  return commits;
}

/**
 * Find all project.md files
 */
async function findProjectFiles(dir) {
  const projects = [];

  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isFile() && entry.name === 'project.md') {
        projects.push(fullPath);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await scan(fullPath);
      }
    }
  }

  await scan(dir);
  return projects;
}

/**
 * Main migration function
 */
async function migrate() {
  log('\n🔧 Standardizing Related Sections', 'cyan');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  if (DRY_RUN) {
    log('DRY RUN MODE - No files will be modified\n', 'yellow');
  }

  let totalCommits = 0;
  let migratedCommits = 0;
  let totalProjects = 0;
  let migratedProjects = 0;

  // Migrate commit files
  if (!PROJECTS_ONLY) {
    log('\n📝 Processing commit files...', 'blue');
    const projectsDir = path.join(VAULT_PATH, 'projects');

    try {
      const commitFiles = await findCommitFiles(projectsDir);
      totalCommits = commitFiles.length;
      log(`Found ${totalCommits} commit file(s)`, 'blue');

      for (const file of commitFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const { changed, content: newContent } = migrateCommitFile(content);

        if (changed) {
          const relativePath = path.relative(VAULT_PATH, file);
          migratedCommits++;

          if (DRY_RUN) {
            log(`  [DRY RUN] Would migrate: ${relativePath}`, 'yellow');
          } else {
            await fs.writeFile(file, newContent, 'utf-8');
            log(`  ✓ Migrated: ${relativePath}`, 'green');
          }
        }
      }
    } catch (error) {
      log(`Error processing commits: ${error.message}`, 'red');
    }
  }

  // Migrate project files
  if (!COMMITS_ONLY) {
    log('\n📂 Processing project files...', 'blue');
    const projectsDir = path.join(VAULT_PATH, 'projects');

    try {
      const projectFiles = await findProjectFiles(projectsDir);
      totalProjects = projectFiles.length;
      log(`Found ${totalProjects} project file(s)`, 'blue');

      for (const file of projectFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const { changed, content: newContent } = migrateProjectFile(content);

        if (changed) {
          const relativePath = path.relative(VAULT_PATH, file);
          migratedProjects++;

          if (DRY_RUN) {
            log(`  [DRY RUN] Would migrate: ${relativePath}`, 'yellow');
          } else {
            await fs.writeFile(file, newContent, 'utf-8');
            log(`  ✓ Migrated: ${relativePath}`, 'green');
          }
        }
      }
    } catch (error) {
      log(`Error processing projects: ${error.message}`, 'red');
    }
  }

  // Summary
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('📊 Migration Summary', 'cyan');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  if (!PROJECTS_ONLY) {
    log(`\nCommits:`, 'blue');
    log(`  Total processed: ${totalCommits}`);
    log(`  Migrated: ${migratedCommits}`, migratedCommits > 0 ? 'green' : 'reset');
    log(`  Unchanged: ${totalCommits - migratedCommits}`);
  }

  if (!COMMITS_ONLY) {
    log(`\nProjects:`, 'blue');
    log(`  Total processed: ${totalProjects}`);
    log(`  Migrated: ${migratedProjects}`, migratedProjects > 0 ? 'green' : 'reset');
    log(`  Unchanged: ${totalProjects - migratedProjects}`);
  }

  if (DRY_RUN) {
    log('\n💡 Run without --dry-run to apply changes', 'yellow');
  } else if (migratedCommits > 0 || migratedProjects > 0) {
    log('\n✅ Migration complete!', 'green');
  } else {
    log('\n✨ No files needed migration', 'green');
  }
}

// Run migration
migrate().catch(error => {
  log(`\n❌ Migration failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
