/**
 * Tool: list_recent_projects
 * Description: List the most recent projects. Returns project metadata including name, repository path, creation date, and activity.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Response detail levels
 */
export enum ResponseDetail {
  MINIMAL = 'minimal', // Just project names
  SUMMARY = 'summary', // Names, paths, dates (default)
  DETAILED = 'detailed', // + recent commits
  FULL = 'full', // + full project pages
}

/**
 * Parse detail level from string
 */
function parseDetailLevel(detail?: string): ResponseDetail {
  if (!detail) return ResponseDetail.SUMMARY;

  const normalized = detail.toLowerCase();
  switch (normalized) {
    case 'minimal':
      return ResponseDetail.MINIMAL;
    case 'summary':
      return ResponseDetail.SUMMARY;
    case 'detailed':
      return ResponseDetail.DETAILED;
    case 'full':
      return ResponseDetail.FULL;
    default:
      return ResponseDetail.SUMMARY;
  }
}

/**
 * Project file metadata
 */
interface ProjectFile {
  file: string;
  filePath: string;
  mtime: Date;
  title?: string;
  projectSlug?: string;
  repoPath?: string;
  repoName?: string;
  created?: string;
  status?: string;
}

export interface ListRecentProjectsArgs {
  limit?: number;
  detail?: string;
  _invoked_by_slash_command?: boolean;
}

export interface ListRecentProjectsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export async function listRecentProjects(
  args: ListRecentProjectsArgs,
  context: {
    vaultPath: string;
  }
): Promise<ListRecentProjectsResult> {
  const limit = args.limit || 5;
  const detailLevel = parseDetailLevel(args.detail);
  const projectsDir = path.join(context.vaultPath, 'projects');

  try {
    // Check if projects directory exists
    try {
      await fs.access(projectsDir);
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'No projects directory found. Create a project with create_project_page.',
          },
        ],
      };
    }

    // Find all project.md files in subdirectories
    const projectFiles: ProjectFile[] = [];

    const entries = await fs.readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectFile = path.join(projectsDir, entry.name, 'project.md');
      try {
        const stats = await fs.stat(projectFile);
        const content = await fs.readFile(projectFile, 'utf-8');

        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let title: string | undefined;
        let projectSlug: string | undefined;
        let repoPath: string | undefined;
        let repoName: string | undefined;
        let created: string | undefined;
        let status: string | undefined;

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const titleMatch = frontmatter.match(/title:\s*(.+)/);
          const slugMatch = frontmatter.match(/project_slug:\s*(.+)/);
          const createdMatch = frontmatter.match(/created:\s*(.+)/);
          const statusMatch = frontmatter.match(/status:\s*(.+)/);

          // Extract repository info
          const repoPathMatch = frontmatter.match(/repository:\s*\n\s*path:\s*(.+)/);
          const repoNameMatch = frontmatter.match(/repository:\s*\n\s*path:.*\n\s*name:\s*(.+)/);

          if (titleMatch) title = titleMatch[1].trim();
          if (slugMatch) projectSlug = slugMatch[1].trim();
          if (createdMatch) created = createdMatch[1].trim();
          if (statusMatch) status = statusMatch[1].trim();
          if (repoPathMatch) repoPath = repoPathMatch[1].trim();
          if (repoNameMatch) repoName = repoNameMatch[1].trim();
        }

        projectFiles.push({
          file: entry.name,
          filePath: projectFile,
          mtime: stats.mtime,
          title: title || entry.name,
          projectSlug,
          repoPath,
          repoName,
          created,
          status,
        });
      } catch {
        // Skip if project.md doesn't exist in this directory
        continue;
      }
    }

    if (projectFiles.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No projects found. Create a project with create_project_page.',
          },
        ],
      };
    }

    // Sort by modification time (most recent first)
    projectFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Limit results
    const recentProjects = projectFiles.slice(0, limit);

    // Format using tiered response levels
    return await formatProjectList(recentProjects, detailLevel);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to list projects: ${errorMessage}`);
  }
}

async function formatProjectList(
  projects: ProjectFile[],
  detail: ResponseDetail
): Promise<ListRecentProjectsResult> {
  let resultText = `Found ${projects.length} recent project(s):\n\n`;

  switch (detail) {
    case ResponseDetail.MINIMAL:
      // Just project names
      projects.forEach((p, idx) => {
        const titleText = p.title || p.file;
        resultText += `${idx + 1}. ${titleText}\n`;
      });
      resultText += `\n💡 Use detail: "summary" for paths and dates`;
      break;

    case ResponseDetail.SUMMARY:
      // Name, path, created date
      projects.forEach((p, idx) => {
        const titleText = p.title || p.file;
        resultText += `${idx + 1}. ${titleText}\n`;
        if (p.repoPath) resultText += `   Repository: ${p.repoPath}\n`;
        if (p.created) resultText += `   Created: ${p.created}\n`;
        resultText += `\n`;
      });
      resultText += `💡 Use detail: "detailed" for recent commits`;
      break;

    case ResponseDetail.DETAILED:
      // + Recent commits from project page
      for (let idx = 0; idx < projects.length; idx++) {
        const p = projects[idx];
        const titleText = p.title || p.file;
        resultText += `${idx + 1}. ${titleText}\n`;
        if (p.repoPath) resultText += `   Repository: ${p.repoPath}\n`;
        if (p.created) resultText += `   Created: ${p.created}\n`;

        // Extract recent commits from project page
        try {
          const content = await fs.readFile(p.filePath, 'utf-8');
          const activityMatch = content.match(/## Recent Activity\n([\s\S]*?)(?=\n##|$)/);
          if (activityMatch) {
            const activities = activityMatch[1].trim().split('\n').slice(0, 5);
            if (activities.length > 0) {
              resultText += `   Recent commits:\n`;
              activities.forEach(a => {
                resultText += `   ${a}\n`;
              });
            }
          }
        } catch {
          // Skip if can't read commits
        }
        resultText += `\n`;
      }
      resultText += `💡 Use detail: "full" for complete project pages`;
      break;

    case ResponseDetail.FULL:
      // Full project pages
      for (let idx = 0; idx < projects.length; idx++) {
        const p = projects[idx];
        const titleText = p.title || p.file;
        resultText += `${idx + 1}. ${titleText}\n`;
        try {
          const content = await fs.readFile(p.filePath, 'utf-8');
          resultText += `\n${content}\n`;
        } catch {
          resultText += `\nError reading ${p.filePath}\n`;
        }
        resultText += `\n---\n`;
      }
      break;
  }

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
