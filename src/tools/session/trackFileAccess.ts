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

// Memory management constants
const MAX_TRACKED_FILES = 1000; // Max unique files to track per session
const DEDUP_WINDOW_MS = 60000; // 1 minute - ignore duplicate path+action within this window

export function trackFileAccess(
  args: TrackFileAccessArgs,
  context: TrackFileAccessContext
): TrackFileAccessResult {
  const timestamp = new Date().toISOString();
  const now = Date.now();

  // Deduplicate: check if same path+action was tracked recently
  const recentDuplicate = context.filesAccessed.find((f) => {
    if (f.path !== args.path || f.action !== args.action) return false;
    const entryTime = new Date(f.timestamp).getTime();
    return now - entryTime < DEDUP_WINDOW_MS;
  });

  if (recentDuplicate) {
    // Update timestamp of existing entry instead of adding new one
    recentDuplicate.timestamp = timestamp;
    return {
      content: [
        {
          type: 'text',
          text: `File access updated: ${args.action} ${args.path}`,
        },
      ],
    };
  }

  // Enforce max size - remove oldest entries if at limit
  if (context.filesAccessed.length >= MAX_TRACKED_FILES) {
    // Remove oldest 10% to avoid frequent trimming
    const removeCount = Math.floor(MAX_TRACKED_FILES * 0.1);
    context.filesAccessed.splice(0, removeCount);
  }

  // Track file access
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
