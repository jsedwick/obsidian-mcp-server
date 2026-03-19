/**
 * Layer 4: Output Redaction (Phase 2 — interface only)
 *
 * Strips PII, secrets, and sensitive data from tool output
 * before returning to the caller.
 */

import type { RedactionConfig } from './types.js';

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  enabled: false,
  patterns: [
    {
      name: 'email',
      regex: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
      replacement: '[REDACTED_EMAIL]',
    },
    {
      name: 'api_key',
      regex: '(?:api[_-]?key|token|secret)[\\s:=]+["\']?[a-zA-Z0-9_\\-]{20,}',
      replacement: '[REDACTED_SECRET]',
    },
    {
      name: 'ssn',
      regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
      replacement: '[REDACTED_SSN]',
    },
  ],
};

/** Output redaction interface for Phase 2 implementation */
export interface Redactor {
  /** Redact sensitive data from tool output content blocks */
  redact(output: Array<{ type: string; text: string }>): Array<{ type: string; text: string }>;
}
