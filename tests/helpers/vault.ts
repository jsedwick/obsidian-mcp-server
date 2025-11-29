/**
 * Test vault utilities for creating and managing temporary test vaults
 *
 * This module provides utilities for:
 * - Creating temporary test vaults with proper directory structure
 * - Populating vaults with sample content
 * - Managing vault lifecycle in tests
 * - Common file operations for testing
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Vault structure configuration
 */
export interface VaultStructure {
  sessions?: boolean;
  topics?: boolean;
  decisions?: boolean;
  projects?: boolean;
  archive?: boolean;
}

/**
 * Default vault structure (all directories)
 */
const DEFAULT_STRUCTURE: Required<VaultStructure> = {
  sessions: true,
  topics: true,
  decisions: true,
  projects: true,
  archive: true,
};

/**
 * Create a temporary test vault with the specified structure
 *
 * @param name - Optional name for the vault (used in temp directory name)
 * @param structure - Which directories to create (defaults to all)
 * @returns Path to the created vault
 *
 * @example
 * ```ts
 * const vaultPath = await createTestVault('my-test');
 * // vaultPath: /tmp/test-vault-my-test-abc123
 * ```
 */
export async function createTestVault(
  name?: string,
  structure: VaultStructure = DEFAULT_STRUCTURE
): Promise<string> {
  const suffix = name ? `-${name}` : '';
  const random = Math.random().toString(36).substring(7);
  const vaultPath = path.join(os.tmpdir(), `test-vault${suffix}-${random}`);

  await fs.mkdir(vaultPath, { recursive: true });

  // Create standard directories
  const dirs = Object.entries({ ...DEFAULT_STRUCTURE, ...structure })
    .filter(([_, enabled]) => enabled)
    .map(([dir, _]) => dir);

  for (const dir of dirs) {
    await fs.mkdir(path.join(vaultPath, dir), { recursive: true });
  }

  // Create archive subdirectories if archive is enabled
  if (structure.archive !== false) {
    await fs.mkdir(path.join(vaultPath, 'archive', 'topics'), { recursive: true });
    await fs.mkdir(path.join(vaultPath, 'archive', 'decisions'), { recursive: true });
    await fs.mkdir(path.join(vaultPath, 'archive', 'sessions'), { recursive: true });
  }

  return vaultPath;
}

/**
 * Remove a test vault and all its contents
 *
 * @param vaultPath - Path to the vault to remove
 *
 * @example
 * ```ts
 * await cleanupTestVault(vaultPath);
 * ```
 */
export async function cleanupTestVault(vaultPath: string): Promise<void> {
  try {
    await fs.rm(vaultPath, { recursive: true, force: true });
  } catch {
    // Ignore errors (vault may not exist)
  }
}

/**
 * Create a session file in a test vault
 *
 * @param vaultPath - Path to the vault
 * @param sessionId - Session ID (e.g., 'test-session-2025-01-15')
 * @param content - Session content (frontmatter will be added automatically)
 * @param metadata - Session metadata for frontmatter
 * @returns Path to the created session file
 *
 * @example
 * ```ts
 * const sessionFile = await createSessionFile(vaultPath, 'test-session', 'Session summary');
 * ```
 */
export async function createSessionFile(
  vaultPath: string,
  sessionId: string,
  content: string,
  metadata?: {
    date?: string;
    topics?: string[];
    decisions?: string[];
    status?: string;
    repository?: any;
  }
): Promise<string> {
  const date = metadata?.date || new Date().toISOString().split('T')[0];
  let sessionFile: string;

  // If session has a date in metadata, create in monthly directory
  if (metadata?.date) {
    const [year, month] = date.split('-');
    const sessionDir = path.join(vaultPath, 'sessions', `${year}-${month}`);
    await fs.mkdir(sessionDir, { recursive: true });
    sessionFile = path.join(sessionDir, `${sessionId}.md`);
  } else {
    // Otherwise create directly in sessions/ (legacy format)
    const sessionDir = path.join(vaultPath, 'sessions');
    await fs.mkdir(sessionDir, { recursive: true });
    sessionFile = path.join(sessionDir, `${sessionId}.md`);
  }

  const frontmatter = `---
date: ${date}
session_id: ${sessionId}
topics: ${JSON.stringify(metadata?.topics || [])}
decisions: ${JSON.stringify(metadata?.decisions || [])}
status: ${metadata?.status || 'completed'}
${metadata?.repository ? `repository:\n  path: ${metadata.repository.path}\n  name: ${metadata.repository.name}` : ''}
---

${content}
`;

  await fs.writeFile(sessionFile, frontmatter);
  return sessionFile;
}

/**
 * Create a topic file in a test vault
 *
 * @param vaultPath - Path to the vault
 * @param slug - Topic slug (used for filename)
 * @param title - Topic title
 * @param content - Topic content
 * @param metadata - Additional metadata for frontmatter
 * @returns Path to the created topic file
 *
 * @example
 * ```ts
 * const topicFile = await createTopicFile(vaultPath, 'test-topic', 'Test Topic', 'Content here');
 * ```
 */
export async function createTopicFile(
  vaultPath: string,
  slug: string,
  title: string,
  content: string,
  metadata?: {
    created?: string;
    tags?: string[];
    session?: string;
  }
): Promise<string> {
  const topicFile = path.join(vaultPath, 'topics', `${slug}.md`);
  const frontmatter = `---
title: "${title}"
created: "${metadata?.created || new Date().toISOString().split('T')[0]}"
tags: ${JSON.stringify(metadata?.tags || [])}
${metadata?.session ? `session: "${metadata.session}"` : ''}
---

${content}

## Related Topics

## Related Projects
`;

  await fs.writeFile(topicFile, frontmatter);
  return topicFile;
}

/**
 * Create a decision file in a test vault
 *
 * @param vaultPath - Path to the vault
 * @param number - Decision number (e.g., '001')
 * @param title - Decision title
 * @param content - Decision content
 * @param projectSlug - Optional project slug (for project-specific decisions)
 * @param metadata - Additional metadata
 * @returns Path to the created decision file
 *
 * @example
 * ```ts
 * const decisionFile = await createDecisionFile(vaultPath, '001', 'Use TypeScript', 'Decision content');
 * ```
 */
export async function createDecisionFile(
  vaultPath: string,
  number: string,
  title: string,
  content: string,
  projectSlug?: string,
  metadata?: {
    date?: string;
    status?: string;
    session?: string;
  }
): Promise<string> {
  const scope = projectSlug || 'vault';
  const decisionsDir = path.join(vaultPath, 'decisions', scope);
  await fs.mkdir(decisionsDir, { recursive: true });

  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  const decisionFile = path.join(decisionsDir, `${number}-${slug}.md`);
  const frontmatter = `---
number: "${number}"
title: "${title}"
date: "${metadata?.date || new Date().toISOString().split('T')[0]}"
status: "${metadata?.status || 'accepted'}"
${metadata?.session ? `session: "${metadata.session}"` : ''}
${projectSlug ? `project: "${projectSlug}"` : ''}
---

${content}

## Related Topics

## Related Decisions
`;

  await fs.writeFile(decisionFile, frontmatter);
  return decisionFile;
}

/**
 * Create a project page in a test vault
 *
 * @param vaultPath - Path to the vault
 * @param slug - Project slug
 * @param name - Project name
 * @param content - Project content
 * @param metadata - Additional metadata
 * @returns Path to the created project file
 *
 * @example
 * ```ts
 * const projectFile = await createProjectFile(vaultPath, 'my-project', 'My Project', 'Description');
 * ```
 */
export async function createProjectFile(
  vaultPath: string,
  slug: string,
  name: string,
  content: string,
  metadata?: {
    repoPath?: string;
    repoUrl?: string;
    branch?: string;
    created?: string;
  }
): Promise<string> {
  const projectDir = path.join(vaultPath, 'projects', slug);
  const commitsDir = path.join(projectDir, 'commits');
  await fs.mkdir(commitsDir, { recursive: true });

  const projectFile = path.join(projectDir, 'project.md');
  const frontmatter = `---
project: "${name}"
repository_path: "${metadata?.repoPath || '/path/to/repo'}"
repository_url: "${metadata?.repoUrl || 'https://github.com/user/repo.git'}"
branch: "${metadata?.branch || 'main'}"
created: "${metadata?.created || new Date().toISOString().split('T')[0]}"
---

${content}

## Related Topics

## Related Sessions

## Recent Commits
`;

  await fs.writeFile(projectFile, frontmatter);
  return projectFile;
}

/**
 * Create a commit file in a test vault
 *
 * @param vaultPath - Path to the vault
 * @param projectSlug - Project slug
 * @param hash - Commit hash
 * @param content - Commit content (diff, etc.)
 * @param metadata - Additional metadata
 * @returns Path to the created commit file
 *
 * @example
 * ```ts
 * const commitFile = await createCommitFile(vaultPath, 'my-project', 'abc123', 'Commit message');
 * ```
 */
export async function createCommitFile(
  vaultPath: string,
  projectSlug: string,
  hash: string,
  content: string,
  metadata?: {
    shortHash?: string;
    message?: string;
    author?: string;
    date?: string;
    branch?: string;
    session?: string;
  }
): Promise<string> {
  const commitsDir = path.join(vaultPath, 'projects', projectSlug, 'commits');
  await fs.mkdir(commitsDir, { recursive: true });

  const commitFile = path.join(commitsDir, `${hash}.md`);
  const frontmatter = `---
hash: "${hash}"
short_hash: "${metadata?.shortHash || hash.substring(0, 7)}"
message: "${metadata?.message || 'Commit message'}"
author: "${metadata?.author || 'Test Author'}"
date: "${metadata?.date || new Date().toISOString().split('T')[0]}"
${metadata?.branch ? `branch: "${metadata.branch}"` : ''}
${metadata?.session ? `session: "${metadata.session}"` : ''}
---

${content}
`;

  await fs.writeFile(commitFile, frontmatter);
  return commitFile;
}

/**
 * Read a file from a test vault
 *
 * @param vaultPath - Path to the vault
 * @param relativePath - Relative path to the file within the vault
 * @returns File contents
 *
 * @example
 * ```ts
 * const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
 * ```
 */
export async function readVaultFile(vaultPath: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(vaultPath, relativePath), 'utf-8');
}

/**
 * Check if a file exists in a test vault
 *
 * @param vaultPath - Path to the vault
 * @param relativePath - Relative path to the file within the vault
 * @returns True if file exists
 *
 * @example
 * ```ts
 * const exists = await vaultFileExists(vaultPath, 'topics/test-topic.md');
 * ```
 */
export async function vaultFileExists(vaultPath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultPath, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * List all markdown files in a vault directory
 *
 * @param vaultPath - Path to the vault
 * @param directory - Directory to list (e.g., 'topics', 'sessions')
 * @returns Array of relative file paths
 *
 * @example
 * ```ts
 * const topics = await listVaultFiles(vaultPath, 'topics');
 * // ['test-topic.md', 'another-topic.md']
 * ```
 */
export async function listVaultFiles(vaultPath: string, directory: string): Promise<string[]> {
  const dirPath = path.join(vaultPath, directory);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Recursively list subdirectories
        const subFiles = await listVaultFiles(vaultPath, path.join(directory, entry.name));
        files.push(...subFiles.map(f => path.join(entry.name, f)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(entry.name);
      }
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Populate a test vault with sample content
 *
 * @param vaultPath - Path to the vault
 * @returns Object containing paths to created files
 *
 * @example
 * ```ts
 * const { sessions, topics, decisions } = await populateTestVault(vaultPath);
 * ```
 */
export async function populateTestVault(vaultPath: string): Promise<{
  sessions: string[];
  topics: string[];
  decisions: string[];
  projects: string[];
}> {
  const sessions: string[] = [];
  const topics: string[] = [];
  const decisions: string[] = [];
  const projects: string[] = [];

  // Create sample topics
  topics.push(
    await createTopicFile(
      vaultPath,
      'test-topic-1',
      'Test Topic 1',
      'This is a test topic about feature A.\n\n## Overview\n\nFeature A does X, Y, and Z.',
      { tags: ['testing', 'feature-a'] }
    )
  );

  topics.push(
    await createTopicFile(
      vaultPath,
      'test-topic-2',
      'Test Topic 2',
      'This is a test topic about bug B.\n\n## Problem\n\nBug B causes issues.\n\n## Solution\n\nFix was applied.',
      { tags: ['testing', 'bug-fix'] }
    )
  );

  // Create sample decisions
  decisions.push(
    await createDecisionFile(
      vaultPath,
      '001',
      'Use TypeScript',
      '## Context\n\nWe need type safety.\n\n## Decision\n\nUse TypeScript.\n\n## Consequences\n\nBetter tooling.'
    )
  );

  decisions.push(
    await createDecisionFile(
      vaultPath,
      '002',
      'Use Vitest',
      '## Context\n\nNeed a test framework.\n\n## Decision\n\nUse Vitest.\n\n## Consequences\n\nFaster tests.'
    )
  );

  // Create sample sessions
  sessions.push(
    await createSessionFile(
      vaultPath,
      'test-session-2025-01-15',
      'Worked on implementing feature A and fixing bug B.',
      {
        date: '2025-01-15',
        topics: ['topics/test-topic-1', 'topics/test-topic-2'],
        decisions: ['decisions/vault/001-use-typescript'],
      }
    )
  );

  // Create sample project
  projects.push(
    await createProjectFile(vaultPath, 'test-project', 'Test Project', 'A test project', {
      repoPath: '/tmp/test-repo',
      repoUrl: 'https://github.com/user/test-project.git',
    })
  );

  return { sessions, topics, decisions, projects };
}

/**
 * Check if vault has proper structure
 *
 * @param vaultPath - Path to the vault
 * @returns True if all standard directories exist
 */
export async function hasVaultStructure(vaultPath: string): Promise<boolean> {
  const dirs = ['sessions', 'topics', 'decisions', 'projects'];
  for (const dir of dirs) {
    try {
      await fs.access(path.join(vaultPath, dir));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Get vault statistics
 *
 * @param vaultPath - Path to the vault
 * @returns Statistics about vault contents
 */
export async function getVaultStats(vaultPath: string): Promise<{
  sessions: number;
  topics: number;
  decisions: number;
  projects: number;
}> {
  const stats = {
    sessions: 0,
    topics: 0,
    decisions: 0,
    projects: 0,
  };

  stats.sessions = (await listVaultFiles(vaultPath, 'sessions')).length;
  stats.topics = (await listVaultFiles(vaultPath, 'topics')).length;
  stats.decisions = (await listVaultFiles(vaultPath, 'decisions')).length;

  // Count projects (each subdirectory in projects/ is a project)
  try {
    const projectDirs = await fs.readdir(path.join(vaultPath, 'projects'), { withFileTypes: true });
    stats.projects = projectDirs.filter(d => d.isDirectory()).length;
  } catch {
    stats.projects = 0;
  }

  return stats;
}
