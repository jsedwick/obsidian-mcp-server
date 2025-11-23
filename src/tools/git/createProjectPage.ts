/**
 * Tool: create_project_page
 * Description: Create or update a project page in the Obsidian vault for tracking a Git repository.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { GitService } from '../../services/git/GitService.js';
import { generateProjectTemplate } from '../../templates.js';

/**
 * Extract repository slug from various URL formats
 */
function extractRepoSlug(url: string): string | null {
  if (!url || url === 'N/A') return null;

  // Handle various Git URL formats:
  // - ssh://git@git.uoregon.edu/jsdev/claude-code-hooks.git
  // - https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse
  // - git@github.com:user/repo.git
  // - https://github.com/user/repo

  // Remove .git suffix if present
  url = url.replace(/\.git$/, '');

  // Try to extract the repository name (last path component)
  const patterns = [
    /\/repos\/([^\/]+)/,           // Bitbucket/Stash style: /repos/claude-code-hooks
    /\/([^\/]+)\.git$/,             // Git clone URLs ending in .git
    /\/([^\/]+)$/,                  // Last path component
    /:([^\/]+\/[^\/]+)$/,           // SSH style: git@host:user/repo
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

/**
 * Find topics related to a project by searching for repo URL
 */
async function findRelatedTopics(
  repoUrl: string,
  topicsDir: string,
  vaultPath: string
): Promise<Array<{ link: string; title: string }>> {
  const relatedTopics: Array<{ link: string; title: string; source: string }> = [];

  // Extract repository slug from project URL for fuzzy matching
  const projectRepoSlug = extractRepoSlug(repoUrl);

  try {
    // Search for topics with matching repository URL in frontmatter
    if (repoUrl && repoUrl !== 'N/A') {
      const topicFiles = await findMarkdownFiles(topicsDir);

      for (const topicFile of topicFiles) {
        try {
          const content = await fs.readFile(topicFile, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

          if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];

            // Check for repository field in frontmatter
            const repoMatch = frontmatter.match(/repository:\s*(.+)/);
            if (repoMatch) {
              const topicRepoUrl = repoMatch[1].trim();

              // Strategy 1a: Exact URL match
              if (topicRepoUrl === repoUrl) {
                const titleMatch = frontmatter.match(/title:\s*(.+)/);
                const title = titleMatch ? titleMatch[1].trim() : path.basename(topicFile, '.md');
                const relativePath = path.relative(vaultPath, topicFile);

                relatedTopics.push({
                  link: relativePath.replace(/\.md$/, ''),
                  title,
                  source: 'url-exact-match',
                });
                continue;
              }

              // Strategy 1b: Fuzzy match by repository slug
              if (projectRepoSlug) {
                const topicRepoSlug = extractRepoSlug(topicRepoUrl);
                if (topicRepoSlug && topicRepoSlug === projectRepoSlug) {
                  const titleMatch = frontmatter.match(/title:\s*(.+)/);
                  const title = titleMatch ? titleMatch[1].trim() : path.basename(topicFile, '.md');
                  const relativePath = path.relative(vaultPath, topicFile);

                  relatedTopics.push({
                    link: relativePath.replace(/\.md$/, ''),
                    title,
                    source: 'url-slug-match',
                  });
                }
              }
            }
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  } catch {
    // If topics directory doesn't exist or can't be read, return empty array
  }

  // Remove duplicates and return
  const seen = new Set<string>();
  return relatedTopics
    .filter(t => {
      if (seen.has(t.link)) return false;
      seen.add(t.link);
      return true;
    })
    .map(({ link, title }) => ({ link, title }));
}

/**
 * Find all markdown files recursively
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip archive and hidden directories
        if (entry.name === 'archive' || entry.name.startsWith('.')) {
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
 * Slugify a string for use in filenames
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CreateProjectPageArgs {
  repo_path: string;
}

export interface CreateProjectPageResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export async function createProjectPage(
  args: CreateProjectPageArgs,
  context: {
    vaultPath: string;
    gitService: GitService;
    currentSessionId?: string;
    trackProjectCreation?: (project: { slug: string; name: string; file: string }) => void;
    vaultCustodian: (args: { files_to_check: string[] }) => Promise<CreateProjectPageResult>;
  }
): Promise<CreateProjectPageResult> {
  // Get repository info
  const name = await context.gitService.getRepositoryName(args.repo_path);
  const branch = await context.gitService.getCurrentBranch(args.repo_path);
  const remote = await context.gitService.getRemoteUrl(args.repo_path);

  const slug = slugify(name);
  const projectDir = path.join(context.vaultPath, 'projects', slug);
  const projectFile = path.join(projectDir, 'project.md');

  // Create project directory structure
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, 'commits'), { recursive: true });

  const today = new Date().toISOString().split('T')[0];

  // Track project creation for lazy session creation
  if (context.trackProjectCreation) {
    context.trackProjectCreation({ slug, name, file: projectFile });
  }

  // Check if project page already exists
  let content: string;
  try {
    content = await fs.readFile(projectFile, 'utf-8');

    // Update existing project page (only if session exists)
    if (context.currentSessionId) {
      const sessionLink = `- [[${context.currentSessionId}]]`;
      if (!content.includes(sessionLink)) {
        content = content.replace(
          /## Related Sessions\n/,
          `## Related Sessions\n${sessionLink}\n`
        );
      }
      await fs.writeFile(projectFile, content);
    }
  } catch {
    // Create new project page
    content = generateProjectTemplate({
      projectName: name,
      repoPath: args.repo_path,
      repoUrl: remote || 'N/A',
      branch: branch || 'unknown',
      created: today,
      currentSessionId: context.currentSessionId || undefined
    });
    await fs.writeFile(projectFile, content);
  }

  // Proactively search for related topics
  const topicsDir = path.join(context.vaultPath, 'topics');
  const relatedTopics = await findRelatedTopics(remote || '', topicsDir, context.vaultPath);

  // Add related topics to project page if found
  if (relatedTopics.length > 0) {
    content = await fs.readFile(projectFile, 'utf-8');
    const topicLinks = relatedTopics.map(t => `- [[${t.link}|${t.title}]]`).join('\n');

    // Check if Related Topics section has content already
    if (content.includes('## Related Topics\n\n')) {
      // Empty Related Topics section - add links
      content = content.replace('## Related Topics\n\n', `## Related Topics\n${topicLinks}\n\n`);
    } else if (content.includes('## Related Topics\n')) {
      // Empty Related Topics section without extra newline - add links
      content = content.replace('## Related Topics\n', `## Related Topics\n${topicLinks}\n`);
    } else {
      // Related Topics section has content - only add if not already present
      for (const topic of relatedTopics) {
        if (!content.includes(topic.link)) {
          content = content.replace(
            /## Related Topics\n/,
            `## Related Topics\n- [[${topic.link}|${topic.title}]]\n`
          );
        }
      }
    }

    await fs.writeFile(projectFile, content);
  }

  // Run vault custodian on the created/updated project page
  let custodianReport = '';
  try {
    const custodianResult = await context.vaultCustodian({
      files_to_check: [projectFile]
    });
    if (custodianResult.content && custodianResult.content[0]) {
      custodianReport = '\n\n' + (custodianResult.content[0] as { text: string }).text;
    }
  } catch (error) {
    custodianReport = '\n\n⚠️  Vault custodian check failed: ' +
      (error instanceof Error ? error.message : String(error));
  }

  return {
    content: [
      {
        type: 'text',
        text: `Project page created/updated: projects/${slug}/project.md${relatedTopics.length > 0 ? `\n\nFound ${relatedTopics.length} related topic(s):` + relatedTopics.map(t => `\n- ${t.title}`).join('') : ''}${custodianReport}`,
      },
    ],
  };
}
