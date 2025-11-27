/**
 * Utility for generating project slugs from Git repository information.
 *
 * Strategy: Use remote URL as canonical identifier (portable, stable).
 * Fallback to path hash for local-only repos.
 *
 * IMPORTANT: Always check for existing projects by repo path before generating
 * a new slug. This prevents orphaned projects when remotes are added/changed.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Components extracted from a remote URL
 */
interface RemoteParts {
  host: string; // Simplified host (e.g., "github", "gitlab", "uoregon")
  path: string; // Repository path (e.g., "user-my-repo", "company-project")
}

/**
 * Extract host and path components from various Git remote URL formats.
 *
 * Supported formats:
 * - HTTPS: https://github.com/user/my-repo
 * - SSH: git@github.com:user/my-repo.git
 * - SSH protocol: ssh://git@host/path/repo.git
 * - Enterprise: https://git.uoregon.edu/projects/JSDEV/repos/my-app/browse
 *
 * @param remoteUrl - Git remote URL
 * @returns Extracted host and path, or null if parsing fails
 */
function extractRemoteParts(remoteUrl: string): RemoteParts | null {
  if (!remoteUrl || remoteUrl === 'N/A') {
    return null;
  }

  let url = remoteUrl.trim();

  // Remove .git suffix if present
  url = url.replace(/\.git$/, '');

  // Remove trailing /browse or similar suffixes (common in Bitbucket/Stash)
  url = url.replace(/\/(browse|commits|tree|blob).*$/, '');

  try {
    // Case 1: SSH format (git@host:path/repo)
    const sshMatch = url.match(/^(?:ssh:\/\/)?git@([^:/]+):(.+)$/);
    if (sshMatch) {
      const [, host, repoPath] = sshMatch;
      return {
        host: simplifyHost(host),
        path: slugifyPath(repoPath),
      };
    }

    // Case 2: SSH protocol (ssh://git@host/path/repo)
    const sshProtocolMatch = url.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/);
    if (sshProtocolMatch) {
      const [, host, repoPath] = sshProtocolMatch;
      return {
        host: simplifyHost(host),
        path: slugifyPath(repoPath),
      };
    }

    // Case 3: HTTP(S) URL
    const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+)$/);
    if (httpsMatch) {
      const [, host, repoPath] = httpsMatch;

      // Special handling for Bitbucket/Stash URLs: /projects/TEAM/repos/name
      const bitbucketMatch = repoPath.match(/projects\/([^/]+)\/repos\/([^/]+)/);
      if (bitbucketMatch) {
        const [, project, repo] = bitbucketMatch;
        return {
          host: simplifyHost(host),
          path: slugifyPath(`${project}-${repo}`),
        };
      }

      return {
        host: simplifyHost(host),
        path: slugifyPath(repoPath),
      };
    }

    // Unrecognized format
    return null;
  } catch {
    return null;
  }
}

/**
 * Simplify a host name for use in slugs.
 *
 * Examples:
 * - github.com → github
 * - gitlab.com → gitlab
 * - git.uoregon.edu → uoregon
 * - bitbucket.org → bitbucket
 *
 * @param host - Full hostname
 * @returns Simplified host name
 */
function simplifyHost(host: string): string {
  // Remove common prefixes
  host = host.replace(/^(git\.|www\.)/, '');

  // Extract main name (before first dot or entire string)
  const match = host.match(/^([^.]+)/);
  if (match) {
    return match[1].toLowerCase();
  }

  return host.toLowerCase();
}

/**
 * Slugify a repository path for use in filenames.
 *
 * Examples:
 * - user/my-repo → user-my-repo
 * - company/team/project → company-team-project
 *
 * @param repoPath - Repository path from URL
 * @returns Slugified path
 */
function slugifyPath(repoPath: string): string {
  return repoPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Hash a file path to create a unique identifier.
 *
 * @param repoPath - Absolute path to repository
 * @returns First 6 characters of MD5 hash
 */
function hashPath(repoPath: string): string {
  return crypto.createHash('md5').update(repoPath).digest('hex').substring(0, 6);
}

/**
 * Generate a project slug from repository information.
 *
 * Strategy:
 * 1. If remote URL exists: Use host + path (e.g., "github-user-my-repo")
 * 2. If no remote: Use directory name + path hash (e.g., "my-repo-a1b2c3")
 *
 * @param repoPath - Absolute path to repository
 * @param remoteUrl - Git remote URL (or null if no remote)
 * @returns Project slug for use in directory/file names
 */
export function generateProjectSlug(repoPath: string, remoteUrl: string | null): string {
  // Primary strategy: Use remote URL if available
  if (remoteUrl) {
    const parts = extractRemoteParts(remoteUrl);
    if (parts) {
      return `${parts.host}-${parts.path}`;
    }
  }

  // Fallback strategy: Local repo without remote
  const dirName = path.basename(repoPath);
  const pathHash = hashPath(repoPath);
  return `${slugifyPath(dirName)}-${pathHash}`;
}

/**
 * Find an existing project slug by repository path.
 *
 * This function scans all project directories to find one that matches
 * the given repository path. This is critical for preventing orphaned
 * projects when:
 * - A local repo adds a remote later
 * - A remote URL changes
 * - The repo is cloned to a different location
 *
 * If multiple projects exist for the same repo (duplicate bug scenario),
 * returns the oldest one based on creation date in frontmatter.
 *
 * @param repoPath - Absolute path to the repository
 * @param projectsDir - Absolute path to the projects directory in the vault
 * @returns The existing project slug if found, null otherwise
 */
export async function findExistingProjectSlug(
  repoPath: string,
  projectsDir: string
): Promise<string | null> {
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    const projectDirs = entries.filter(e => e.isDirectory());

    const matches: Array<{ slug: string; created: string }> = [];

    for (const dirent of projectDirs) {
      const projectFile = path.join(projectsDir, dirent.name, 'project.md');

      try {
        const content = await fs.readFile(projectFile, 'utf-8');

        // Check both old and new frontmatter formats for repository path
        // New format: "  path: /path/to/repo" (nested under repository:)
        // Old format: "repo_path: /path/to/repo" (flat)
        // Note: Values may be quoted or unquoted in YAML frontmatter
        const newFormatMatch = content.match(/^ {2}path: "?(.+?)"?$/m);
        const oldFormatMatch = content.match(/^repo_path: "?(.+?)"?$/m);

        const existingPath = newFormatMatch?.[1] || oldFormatMatch?.[1];

        if (existingPath === repoPath) {
          // Extract creation date for duplicate resolution
          const createdMatch = content.match(/^created: "?(\d{4}-\d{2}-\d{2})"?$/m);
          const created = createdMatch?.[1] || '9999-99-99'; // Default to future date if missing

          matches.push({ slug: dirent.name, created });
        }
      } catch {
        // Skip files we can't read (project.md doesn't exist, etc.)
        continue;
      }
    }

    if (matches.length === 0) {
      return null; // No existing project found for this repo path
    }

    // If multiple matches (duplicates), return the oldest one (earliest creation date)
    matches.sort((a, b) => a.created.localeCompare(b.created));
    return matches[0].slug;
  } catch {
    // Projects directory doesn't exist or can't be read
    return null;
  }
}

/**
 * Get or generate a project slug for a repository.
 *
 * This is the recommended function to use when you need a project slug.
 * It first checks for an existing project with the same repo path,
 * and only generates a new slug if no existing project is found.
 *
 * @param repoPath - Absolute path to the repository
 * @param remoteUrl - Git remote URL (or null if no remote)
 * @param projectsDir - Absolute path to the projects directory in the vault
 * @returns The project slug (existing or newly generated)
 */
export async function getOrGenerateProjectSlug(
  repoPath: string,
  remoteUrl: string | null,
  projectsDir: string
): Promise<string> {
  // First, check if a project already exists for this repo path
  const existingSlug = await findExistingProjectSlug(repoPath, projectsDir);
  if (existingSlug) {
    return existingSlug;
  }

  // No existing project found, generate a new slug
  return generateProjectSlug(repoPath, remoteUrl);
}
