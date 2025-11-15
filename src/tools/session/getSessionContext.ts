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

export interface GetSessionContextResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface GetSessionContextContext {
  vaultPath: string;
  currentSessionId: string | null;
  currentSessionFile: string | null;
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

  return {
    content: [
      {
        type: 'text',
        text: `Session context for ${sessionId}:\n\n${content}`,
      },
    ],
  };
}
