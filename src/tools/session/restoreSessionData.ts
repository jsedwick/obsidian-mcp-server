/**
 * Tool: restore_session_data
 *
 * Description: Recover session state from session-state.md when MCP server
 * state is lost (restart, crash). This extends Decision 048's context
 * truncation recovery to cover server-level state loss.
 *
 * The tool reads session-state.md from the vault root and restores:
 * - Session start time
 * - Files accessed during session
 * - Phase 1 session data (if available)
 *
 * Related: Decision 048 (context truncation recovery)
 */

import type { RestoredSessionState } from '../../services/session/SessionStateFile.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RestoreSessionDataArgs {
  // No arguments needed - reads from known vault location
}

export interface RestoreSessionDataResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  /** Structured restored state for internal use */
  restoredState?: RestoredSessionState;
}

export interface RestoreSessionDataContext {
  /** Restore state from file and update server memory */
  restoreSessionStateFromFile: () => Promise<RestoredSessionState | null>;
}

/**
 * Restore session state from session-state.md file
 */
export async function restoreSessionData(
  _args: RestoreSessionDataArgs,
  context: RestoreSessionDataContext
): Promise<RestoreSessionDataResult> {
  const restored = await context.restoreSessionStateFromFile();

  if (!restored) {
    return {
      content: [
        {
          type: 'text',
          text:
            '❌ **Session State Recovery Failed**\n\n' +
            'No session state file found or file could not be parsed.\n\n' +
            'This can happen if:\n' +
            '- No session has been started (run /mb first)\n' +
            '- The session-state.md file was deleted\n' +
            '- The file is corrupted\n\n' +
            'To start a fresh session, run /mb.',
        },
      ],
    };
  }

  const phase1Status = restored.phase1Completed
    ? `✅ Phase 1 data available (session_data can be recovered)`
    : `⚠️ Phase 1 not completed yet`;

  return {
    content: [
      {
        type: 'text',
        text:
          '✅ **Session State Recovered**\n\n' +
          `**Session Start:** ${restored.sessionStart}\n` +
          `**Last Updated:** ${restored.lastUpdated}\n` +
          `**Files Accessed:** ${restored.filesAccessed.length}\n` +
          `**Phase 1 Status:** ${phase1Status}\n\n` +
          'Server memory has been restored from session-state.md.\n' +
          'You can now continue with Phase 2 if Phase 1 was completed.',
      },
    ],
    restoredState: restored,
  };
}
