/**
 * Layer 5: Runtime Governance (Phase 2 — interface only)
 *
 * Rate limiting, loop detection, and spend tracking.
 * Will be implemented when HTTP transport is actively used.
 */

import type { GovernorConfig } from './types.js';

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  maxCallsPerMinute: 120,
  maxCallsPerTool: 30,
  loopDetection: {
    windowSize: 20,
    repeatThreshold: 5,
  },
};

/** Runtime governance interface for Phase 2 implementation */
export interface Governor {
  /** Check if the current call is within rate limits. Throws SecurityError if not. */
  checkRateLimit(toolName: string, argsHash: string): void;
  /** Record a tool call for rate tracking */
  recordCall(toolName: string, argsHash: string): void;
  /** Reset all counters (e.g., on server restart) */
  reset(): void;
}
