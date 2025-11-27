#!/usr/bin/env node

/**
 * Test script for project slug migration
 * Run with: node scripts/test-migration.js [--dry-run]
 */

import { migrateProjectSlugs } from '../dist/tools/git/migrateProjectSlugs.js';
import { GitService } from '../dist/services/git/GitService.js';

const dryRun = process.argv.includes('--dry-run');
const vaultPath = '/Users/jsedwick/Documents/Obsidian/Claude/Claude';

console.log(`Running migration${dryRun ? ' (DRY RUN)' : ''}...`);
console.log(`Vault: ${vaultPath}\n`);

const gitService = new GitService();

try {
  const result = await migrateProjectSlugs(
    { dry_run: dryRun },
    { vaultPath, gitService }
  );

  console.log(result.content[0].text);
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}
