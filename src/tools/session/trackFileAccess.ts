/**
 * Tool: track_file_access
 *
 * Description: Track a file that was accessed during the session.
 * Used to help detect relevant Git repositories.
 */

import type { FileAccess, FileAccessAction } from '../../models/Session.js';

export interface TrackFileAccessArgs {
  path: string;
  action: FileAccessAction;
}

export interface TrackFileAccessResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface TrackFileAccessContext {
  filesAccessed: FileAccess[];
}

export async function trackFileAccess(
  args: TrackFileAccessArgs,
  context: TrackFileAccessContext
): Promise<TrackFileAccessResult> {
  // Track file access regardless of whether a session exists
  // This data will be used when /close is invoked to create the session
  const timestamp = new Date().toISOString();
  context.filesAccessed.push({
    path: args.path,
    action: args.action,
    timestamp,
  });

  return {
    content: [
      {
        type: 'text',
        text: `File access tracked: ${args.action} ${args.path}`,
      },
    ],
  };
}
