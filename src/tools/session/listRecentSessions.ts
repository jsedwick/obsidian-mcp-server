/**
 * Tool: list_recent_sessions
 *
 * Description: List the most recent conversation sessions.
 * Returns session metadata including ID, topic, date, and status.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface ListRecentSessionsArgs {
  limit?: number;
  detail?: string;
  _invoked_by_slash_command?: boolean;
}

export interface ListRecentSessionsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

enum ResponseDetail {
  MINIMAL = 'minimal',    // IDs, titles, counts only
  SUMMARY = 'summary',    // + brief snippets (default)
  DETAILED = 'detailed',  // + extended context
  FULL = 'full'          // Complete content
}

// Helper to parse detail level with default
function parseDetailLevel(detail?: string): ResponseDetail {
  if (!detail) return ResponseDetail.SUMMARY;

  const level = detail.toLowerCase();
  if (Object.values(ResponseDetail).includes(level as ResponseDetail)) {
    return level as ResponseDetail;
  }

  return ResponseDetail.SUMMARY;
}

interface ListRecentSessionsContext {
  vaultPath: string;
  ensureVaultStructure: () => Promise<void>;
}

export async function listRecentSessions(
  args: ListRecentSessionsArgs,
  context: ListRecentSessionsContext
): Promise<ListRecentSessionsResult> {
  // Enforce that this tool can only be called via the /sessions slash command
  if (!args._invoked_by_slash_command) {
    throw new Error('This tool can only be invoked via the /sessions slash command. Please ask the user to run the /sessions command.');
  }

  await context.ensureVaultStructure();

  const limit = args.limit || 5;
  const detailLevel = parseDetailLevel(args.detail);
  const sessionsDir = path.join(context.vaultPath, 'sessions');

  try {
    // Filter for .md files and get their stats, including from month subdirectories
    const sessionFiles: Array<{
      file: string;
      filePath: string;
      mtime: Date;
      session_id: string;
      topic?: string;
      date?: string;
      status?: string;
    }> = [];

    // Helper function to parse session file metadata
    const parseSessionFile = (file: string, filePath: string, stats: any, content: string) => {
      // Parse frontmatter to get metadata
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let session_id = file.replace('.md', '');
      let topic: string | undefined;
      let date: string | undefined;
      let status: string | undefined;

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const sessionIdMatch = frontmatter.match(/session_id:\s*(.+)/);
        const topicsMatch = frontmatter.match(/topics:\s*(\[.*?\])/);
        const dateMatch = frontmatter.match(/date:\s*(.+)/);
        const statusMatch = frontmatter.match(/status:\s*(.+)/);

        if (sessionIdMatch) session_id = sessionIdMatch[1].trim();
        if (dateMatch) date = dateMatch[1].trim();
        if (statusMatch) status = statusMatch[1].trim();

        if (topicsMatch) {
          try {
            const topicsArray = JSON.parse(topicsMatch[1]);
            if (Array.isArray(topicsArray) && topicsArray.length > 0) {
              topic = topicsArray[0];
            }
          } catch {
            // If parsing fails, try to extract from filename
            const topicFromFilename = file.match(/_(.+)\.md$/);
            if (topicFromFilename) {
              topic = topicFromFilename[1].replace(/-/g, ' ');
            }
          }
        } else {
          // Extract from filename if not in frontmatter
          const topicFromFilename = file.match(/_(.+)\.md$/);
          if (topicFromFilename) {
            topic = topicFromFilename[1].replace(/-/g, ' ');
          }
        }
      }

      sessionFiles.push({
        file,
        filePath,
        mtime: stats.mtime,
        session_id,
        topic,
        date,
        status,
      });
    };

    // Read both root sessions directory and month subdirectories (YYYY-MM)
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(sessionsDir, entry.name);

      if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
        // This is a month directory, read .md files from it
        const monthFiles = await fs.readdir(entryPath);
        for (const file of monthFiles) {
          if (!file.endsWith('.md')) continue;
          const filePath = path.join(entryPath, file);
          const stats = await fs.stat(filePath);
          const content = await fs.readFile(filePath, 'utf-8');
          parseSessionFile(file, filePath, stats, content);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Root-level .md file (for backwards compatibility)
        const stats = await fs.stat(entryPath);
        const content = await fs.readFile(entryPath, 'utf-8');
        parseSessionFile(entry.name, entryPath, stats, content);
      }
    }

    if (sessionFiles.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No sessions found. Start a new session with start_session.',
          },
        ],
      };
    }

    // Sort by modification time (most recent first)
    sessionFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Limit results
    const recentSessions = sessionFiles.slice(0, limit);

    if (recentSessions.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No sessions found. Start a new session with start_session.',
          },
        ],
      };
    }

    // Format using tiered response levels
    return await formatSessionList(recentSessions, detailLevel);
  } catch (error) {
    throw new Error(`Failed to list sessions: ${error}`);
  }
}

async function formatSessionList(
  sessions: Array<{
    file: string;
    filePath: string;
    mtime: Date;
    session_id: string;
    topic?: string;
    date?: string;
    status?: string;
  }>,
  detail: ResponseDetail
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let resultText = `Found ${sessions.length} recent session(s):\n\n`;

  switch (detail) {
    case ResponseDetail.MINIMAL:
      // Just ID and topic
      sessions.forEach((s, idx) => {
        const topicText = s.topic ? `: ${s.topic}` : '';
        resultText += `${idx + 1}. ${s.session_id}${topicText}\n`;
      });
      resultText += `\n💡 Use detail: "summary" for dates and status`;
      break;

    case ResponseDetail.SUMMARY:
      // ID, topic, date, status (default - current behavior)
      sessions.forEach((s, idx) => {
        const statusIcon = s.status === 'completed' ? '✓' : '○';
        const topicText = s.topic ? `: ${s.topic}` : '';
        const dateText = s.date ? ` (${s.date})` : '';
        resultText += `${idx + 1}. ${statusIcon} ${s.session_id}${topicText}${dateText}\n`;
      });
      resultText += `\n💡 Use get_session_context(session_id) for full content`;
      resultText += `\n💡 Use detail: "detailed" for file and commit info`;
      break;

    case ResponseDetail.DETAILED:
      // Everything in summary + parse session files for additional metadata
      for (let idx = 0; idx < sessions.length; idx++) {
        const s = sessions[idx];
        const statusIcon = s.status === 'completed' ? '✓' : '○';
        const topicText = s.topic ? `: ${s.topic}` : '';
        const dateText = s.date ? ` (${s.date})` : '';

        resultText += `${idx + 1}. ${statusIcon} ${s.session_id}${topicText}${dateText}\n`;

        // Try to read session file for additional metadata
        try {
          const content = await fs.readFile(s.filePath, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

          if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];

            // Extract repository info
            const repoMatch = frontmatter.match(/repository:\s*\n\s*path:\s*(.+)\n\s*name:\s*(.+)/);
            if (repoMatch) {
              resultText += `   Repository: ${repoMatch[2].trim()}\n`;
            }

            // Count files accessed
            const filesMatch = frontmatter.match(/files_accessed:/);
            if (filesMatch) {
              const filesSection = content.substring(content.indexOf('files_accessed:'));
              const filesCount = (filesSection.match(/- path:/g) || []).length;
              if (filesCount > 0) {
                resultText += `   Files accessed: ${filesCount}\n`;
              }
            }
          }
        } catch {
          // Couldn't read file, skip additional metadata
        }
        resultText += '\n';
      }
      resultText += `💡 Use get_session_context(session_id) for complete content`;
      break;

    case ResponseDetail.FULL:
      // Include summary snippets from each session
      for (let idx = 0; idx < sessions.length; idx++) {
        const s = sessions[idx];
        const statusIcon = s.status === 'completed' ? '✓' : '○';
        const topicText = s.topic ? `: ${s.topic}` : '';

        resultText += `${idx + 1}. ${statusIcon} ${s.session_id}${topicText}\n`;
        resultText += `   Date: ${s.date || 'Unknown'}\n`;

        // Try to extract summary
        try {
          const content = await fs.readFile(s.filePath, 'utf-8');
          const summaryMatch = content.match(/## Summary\n\n([\s\S]+?)(\n\n|$)/);
          if (summaryMatch) {
            const summary = summaryMatch[1].trim();
            const truncated = summary.substring(0, 200);
            resultText += `   ${truncated}${summary.length > 200 ? '...' : ''}\n`;
          }
        } catch {
          // Couldn't read file
        }
        resultText += '\n';
      }
      break;
  }

  resultText += `\nTo continue a session, use get_session_context with the session_id.`;

  return {
    content: [
      {
        type: 'text',
        text: resultText
      }
    ]
  };
}
