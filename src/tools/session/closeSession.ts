/**
 * Tool: close_session
 *
 * Description: Create a session retroactively to capture the work done in this conversation.
 * ONLY callable via the /close slash command. Call this at the end of a conversation to persist the session to the vault.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { generateSessionTemplate } from '../../templates.js';
import type { FileAccess } from '../../models/Session.js';
import type { RepoCandidate } from '../../models/Git.js';

export interface CloseSessionArgs {
  summary: string;
  topic?: string;
  _invoked_by_slash_command?: boolean;
}

export interface CloseSessionResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface CloseSessionContext {
  vaultPath: string;
  currentSessionId: string | null;
  filesAccessed: FileAccess[];
  topicsCreated: Array<{ slug: string; title: string; file: string }>;
  decisionsCreated: Array<{ slug: string; title: string; file: string }>;
  projectsCreated: Array<{ slug: string; name: string; file: string }>;
  ensureVaultStructure: () => Promise<void>;
  findGitRepos: (startPath: string, maxDepth?: number) => Promise<string[]>;
  getRepoInfo: (repoPath: string) => Promise<{ name: string; branch?: string; remote?: string | null }>;
  createProjectPage: (args: { repo_path: string }) => Promise<any>;
  findRelatedContentInText: (text: string) => Promise<{
    topics: Array<{ link: string; title: string }>;
    decisions: Array<{ link: string; title: string }>;
    projects: Array<{ link: string; name: string }>;
  }>;
  vaultCustodian: (args: { files_to_check: string[] }) => Promise<any>;
  slugify: (text: string) => string;
  setCurrentSession: (sessionId: string, sessionFile: string) => void;
  clearSessionState: () => void;
}

export async function closeSession(
  args: CloseSessionArgs,
  context: CloseSessionContext
): Promise<CloseSessionResult> {
  // Enforce that this tool can only be called via the /close slash command
  if (args._invoked_by_slash_command !== true) {
    throw new Error('❌ The close_session tool can ONLY be called via the /close slash command. Please ask the user to run the /close command to close this session.');
  }

  await context.ensureVaultStructure();

  // Generate session ID from current timestamp and optional topic
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const topicSlug = args.topic ? `_${context.slugify(args.topic)}` : '';
  const sessionId = `${dateStr}_${timeStr}${topicSlug}`;

  // Organize sessions by month
  const monthStr = dateStr.substring(0, 7); // YYYY-MM
  const monthDir = path.join(context.vaultPath, 'sessions', monthStr);
  await fs.mkdir(monthDir, { recursive: true });
  const sessionFile = path.join(monthDir, `${sessionId}.md`);

  // Auto-detect Git repositories BEFORE building session content
  // This allows the project to be included in the session's Projects section
  let detectedRepoInfo: { path: string; name: string; branch?: string; remote?: string } | null = null;

  // Always attempt repo detection - either from tracked files or from CWD
  try {
    const cwd = process.env.PWD || process.cwd();
    const repoPaths = await context.findGitRepos(cwd);

    if (repoPaths.length > 0) {
      const candidates: RepoCandidate[] = [];

      for (const repoPath of repoPaths) {
        let score = 0;
        const reasons: string[] = [];

        const filesInRepo = context.filesAccessed.filter(f => f.path.startsWith(repoPath));
        const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
        const readFiles = filesInRepo.filter(f => f.action === 'read');

        if (editedFiles.length > 0) {
          score += editedFiles.length * 10;
          reasons.push(`${editedFiles.length} file(s) modified`);
        }

        if (readFiles.length > 0) {
          score += readFiles.length * 5;
          reasons.push(`${readFiles.length} file(s) read`);
        }

        if (sessionId) {
          const repoName = path.basename(repoPath);
          if (sessionId.toLowerCase().includes(repoName.toLowerCase())) {
            score += 20;
            reasons.push('Session topic matches repo name');
          }
        }

        if (repoPath === cwd) {
          score += 15;
          reasons.push('Repo is current working directory');
        } else if (cwd.startsWith(repoPath)) {
          score += 8;
          reasons.push('CWD is within this repo');
        } else if (repoPath.startsWith(cwd)) {
          score += 5;
          reasons.push('Repo is subdirectory of CWD');
        }

        if (score > 0 || repoPaths.length === 1) {
          const info = await context.getRepoInfo(repoPath);
          candidates.push({
            path: repoPath,
            name: info.name,
            score,
            reasons,
            branch: info.branch,
            remote: info.remote,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length > 0) {
        const topCandidate = candidates[0];

        // High confidence - automatically create project page
        if (candidates.length === 1 || topCandidate.score > (candidates[1]?.score || 0) * 2) {
          try {
            detectedRepoInfo = {
              path: topCandidate.path,
              name: topCandidate.name,
              branch: topCandidate.branch,
              remote: topCandidate.remote ?? undefined,
            };
            await context.createProjectPage({ repo_path: topCandidate.path });
          } catch (error) {
            // If project creation fails, continue anyway
          }
        }
      }
    }
  } catch (error) {
    // Silently fail - repo detection is optional
  }

  // Build topics list from created content
  const topicsList = context.topicsCreated.map(t => t.title);
  const decisionsList = context.decisionsCreated.map(d => d.title);

  // Proactively search for related existing content mentioned in the summary
  const relatedContent = await context.findRelatedContentInText(args.summary);

  // Build session content using template
  const sessionContent = generateSessionTemplate({
    sessionId,
    date: dateStr,
    topic: args.topic,
    topicsList,
    decisionsList,
    summary: args.summary,
    filesAccessed: context.filesAccessed,
    topicsCreated: context.topicsCreated,
    decisionsCreated: context.decisionsCreated,
    projectsCreated: context.projectsCreated,
    relatedTopics: relatedContent.topics,
    relatedDecisions: relatedContent.decisions,
    relatedProjects: relatedContent.projects
  });

  // Write session file
  await fs.writeFile(sessionFile, sessionContent);

  // Set current session for back-linking
  context.setCurrentSession(sessionId, sessionFile);

  // Note: Reciprocal linking is now handled automatically by vault_custodian
  // which runs at the end of this method. No need for manual back-linking here.

  // Build repository detection message
  let repoDetectionMessage = '';
  if (detectedRepoInfo) {
    repoDetectionMessage = `\n\n📦 Git Repository Auto-Linked:\n`;
    repoDetectionMessage += `   ${detectedRepoInfo.name}\n`;
    repoDetectionMessage += `   Path: ${detectedRepoInfo.path}\n`;
    if (detectedRepoInfo.branch) repoDetectionMessage += `   Branch: ${detectedRepoInfo.branch}\n`;
    repoDetectionMessage += `   ✅ Project page created/updated\n`;
    if (context.topicsCreated.length > 0) {
      repoDetectionMessage += `   ✅ ${context.topicsCreated.length} topic(s) linked to project\n`;
    }
    repoDetectionMessage += `\n💡 Next step: Create and record your git commit`;
  }

  // Build summary message
  let summary = `✅ Session created: ${sessionId}\n`;
  summary += `📄 Session file: ${sessionFile}\n\n`;

  if (context.topicsCreated.length > 0) {
    summary += `📚 Topics linked (${context.topicsCreated.length}):\n`;
    summary += context.topicsCreated.map(t => `   - ${t.title}`).join('\n') + '\n\n';
  }

  if (context.decisionsCreated.length > 0) {
    summary += `🎯 Decisions linked (${context.decisionsCreated.length}):\n`;
    summary += context.decisionsCreated.map(d => `   - ${d.title}`).join('\n') + '\n\n';
  }

  if (context.projectsCreated.length > 0) {
    summary += `📦 Projects linked (${context.projectsCreated.length}):\n`;
    summary += context.projectsCreated.map(p => `   - ${p.name}`).join('\n') + '\n\n';
  }

  if (context.filesAccessed.length > 0) {
    summary += `📁 Files accessed: ${context.filesAccessed.length}\n`;
  }

  // Run vault custodian on files created/updated during this session
  const editedOrCreatedFiles = context.filesAccessed
    .filter(f => (f.action === 'edit' || f.action === 'create') && f.path.startsWith(context.vaultPath))
    .map(f => f.path);

  const filesToCheck: string[] = [
    sessionFile,
    ...context.topicsCreated.map(t => t.file),
    ...context.decisionsCreated.map(d => d.file),
    ...context.projectsCreated.map(p => p.file),
    ...editedOrCreatedFiles,
  ];

  // Remove duplicates
  const uniqueFilesToCheck = Array.from(new Set(filesToCheck));

  let vaultCustodianReport = '';
  if (uniqueFilesToCheck.length > 0) {
    try {
      const custodianResult = await context.vaultCustodian({ files_to_check: uniqueFilesToCheck });
      if (custodianResult.content && custodianResult.content[0]) {
        vaultCustodianReport = '\n\n' + (custodianResult.content[0] as { text: string }).text;
      }
    } catch (error) {
      vaultCustodianReport = '\n\n⚠️  Vault custodian check failed: ' + (error instanceof Error ? error.message : String(error));
    }
  }

  // Clear state for next conversation
  context.clearSessionState();

  return {
    content: [
      {
        type: 'text',
        text: summary + repoDetectionMessage + vaultCustodianReport,
      },
    ],
  };
}
