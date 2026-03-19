/**
 * Security Pipeline — orchestrates all security layers.
 *
 * Layers run in order, cheapest first:
 *   Pre-execution:  Layer 1 (sanitize) → Layer 6 (access control)
 *   Post-execution: Layer 4 (redact, Phase 2)
 *   Wrapping:       Layer 5 (governor, Phase 2)
 */

import { createLogger } from '../utils/logger.js';
import { sanitizeArgs, DEFAULT_SANITIZATION_CONFIG } from './sanitizer.js';
import { validateAccess, DEFAULT_ACCESS_CONTROL_CONFIG } from './access-control.js';
import type { SecurityConfig, SecurityContext } from './types.js';

const logger = createLogger('Security');

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enabled: true,
  sanitization: DEFAULT_SANITIZATION_CONFIG,
  accessControl: DEFAULT_ACCESS_CONTROL_CONFIG,
};

export class SecurityPipeline {
  private config: SecurityConfig;

  constructor(config?: Partial<SecurityConfig>) {
    this.config = mergeConfig(DEFAULT_SECURITY_CONFIG, config);
    logger.info('Security pipeline initialized', {
      enabled: this.config.enabled,
      sanitization: !!this.config.sanitization,
      accessControl: !!this.config.accessControl,
    });
  }

  /**
   * Pre-execution: sanitize inputs and check access control.
   * Returns sanitized args or throws SecurityError.
   */
  preExecute(ctx: SecurityContext): Record<string, unknown> {
    if (!this.config.enabled) return ctx.args;

    // Layer 1: Input sanitization
    const sanitizedArgs = sanitizeArgs(ctx, this.config.sanitization);

    // Layer 6: Access control (operates on sanitized args)
    const sanitizedCtx: SecurityContext = { ...ctx, args: sanitizedArgs };
    validateAccess(sanitizedCtx, this.config.accessControl);

    return sanitizedArgs;
  }

  /**
   * Post-execution: redact outputs.
   * Phase 2 — currently passthrough.
   */
  postExecute(
    _ctx: SecurityContext,
    output: Array<{ type: string; text: string }>
  ): Array<{ type: string; text: string }> {
    // Phase 2: redaction will be applied here
    return output;
  }

  /** Check if the security pipeline is enabled */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

/**
 * Deep-merge a partial config over defaults.
 */
function mergeConfig(
  defaults: SecurityConfig,
  overrides?: Partial<SecurityConfig>
): SecurityConfig {
  if (!overrides) return { ...defaults };

  return {
    enabled: overrides.enabled ?? defaults.enabled,
    sanitization: {
      ...defaults.sanitization,
      ...(overrides.sanitization || {}),
    },
    accessControl: {
      ...defaults.accessControl,
      ...(overrides.accessControl || {}),
    },
    governor: overrides.governor ?? defaults.governor,
    redaction: overrides.redaction ?? defaults.redaction,
  };
}

// Re-exports
export { SecurityError } from '../utils/errors.js';
export type { SecurityConfig, SecurityContext } from './types.js';
