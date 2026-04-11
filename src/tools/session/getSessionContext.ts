/**
 * Tool: get_session_context
 *
 * Description: Retrieve the full context from a session file.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface GetSessionContextArgs {
  session_id?: string;
}

export interface GetSessionContextStructuredResult {
  session_id: string;
  date: string;
  status: string;
  topics: string[];
  decisions: string[];
  working_directory?: string;
  file_path: string;
  body: string;
}

export interface GetSessionContextResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  structuredContent?: GetSessionContextStructuredResult;
}

interface GetSessionContextContext {
  vaultPath: string;
  currentSessionId: string | null;
  currentSessionFile: string | null;
}

/**
 * Parse session frontmatter into structured fields.
 */
function parseSessionFrontmatter(
  content: string,
  sessionId: string,
  filePath: string
): { structured: GetSessionContextStructuredResult; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!frontmatterMatch) {
    return {
      structured: {
        session_id: sessionId,
        date: '',
        status: '',
        topics: [],
        decisions: [],
        file_path: filePath,
        body: content,
      },
      body: content,
    };
  }

  const fm = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  const getField = (name: string): string => {
    const match = fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, 'm'));
    return match ? match[1].trim() : '';
  };

  const getArrayField = (name: string): string[] => {
    const match = fm.match(new RegExp(`^${name}:\\s*\\[([^\\]]*)\\]`, 'm'));
    if (match) {
      return match[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    return [];
  };

  const structured: GetSessionContextStructuredResult = {
    session_id: getField('session_id') || sessionId,
    date: getField('date'),
    status: getField('status'),
    topics: getArrayField('topics'),
    decisions: getArrayField('decisions'),
    file_path: filePath,
    body,
  };

  const workingDir = getField('working_directory');
  if (workingDir) {
    structured.working_directory = workingDir;
  }

  return { structured, body };
}

export async function getSessionContext(
  args: GetSessionContextArgs,
  context: GetSessionContextContext
): Promise<GetSessionContextResult> {
  const sessionId = args.session_id || context.currentSessionId;

  if (!sessionId) {
    throw new Error('No session ID provided and no active session.');
  }

  let sessionFile: string;

  if (context.currentSessionFile && !args.session_id) {
    // Use current session file if available
    sessionFile = context.currentSessionFile;
  } else if (args.session_id) {
    // Try to find the session file in monthly directories or root
    // First, extract the date from session_id (format: YYYY-MM-DD_HH-mm-ss...)
    const dateMatch = args.session_id.match(/^(\d{4}-\d{2}-\d{2})/);

    if (dateMatch) {
      const dateStr = dateMatch[1];
      const monthStr = dateStr.substring(0, 7); // YYYY-MM
      const monthDir = path.join(context.vaultPath, 'sessions', monthStr);
      const monthFile = path.join(monthDir, `${sessionId}.md`);

      try {
        await fs.access(monthFile);
        sessionFile = monthFile;
      } catch {
        // Fall back to root if not in month directory
        sessionFile = path.join(context.vaultPath, 'sessions', `${sessionId}.md`);
      }
    } else {
      // No date in session_id, try root directory
      sessionFile = path.join(context.vaultPath, 'sessions', `${sessionId}.md`);
    }
  } else {
    throw new Error('Cannot determine session file path.');
  }

  const content = await fs.readFile(sessionFile, 'utf-8');
  const { structured } = parseSessionFrontmatter(content, sessionId, sessionFile);

  return {
    content: [
      {
        type: 'text',
        text: `Session context for ${sessionId}:\n\n${content}`,
      },
    ],
    structuredContent: structured,
  };
}
