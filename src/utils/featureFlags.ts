/**
 * Feature flag system for Obsidian MCP Server
 *
 * Allows gradual rollout of new features and safe experimentation.
 * Flags can be controlled via environment variables (FEATURE_FLAG_NAME=true).
 */

import { createLogger } from './logger.js';

const logger = createLogger('FeatureFlags');

/**
 * Available feature flags
 *
 * Add new flags here as features are developed.
 */
export enum FeatureFlag {
  // Phase 1.2 flags
  USE_NEW_SEARCH_ENGINE = 'use_new_search_engine',
  PARALLEL_FILE_OPS = 'parallel_file_ops',
  EMBEDDING_CACHE_V2 = 'embedding_cache_v2',

  // Phase 1.3 flags
  MODULAR_TOOLS = 'modular_tools',

  // Phase 1.4 flags
  STRICT_TYPE_CHECKING = 'strict_type_checking',
  PERFORMANCE_MONITORING = 'performance_monitoring',
}

export interface FeatureFlagConfig {
  flags?: Partial<Record<FeatureFlag, boolean>>;
  defaultEnabled?: boolean;
}

/**
 * Feature flag manager
 *
 * @example
 * ```typescript
 * const flags = new FeatureFlags();
 * if (flags.isEnabled(FeatureFlag.USE_NEW_SEARCH_ENGINE)) {
 *   return newSearchEngine.search(query);
 * } else {
 *   return legacySearch(query);
 * }
 * ```
 */
export class FeatureFlags {
  private flags: Map<FeatureFlag, boolean>;

  constructor(config?: FeatureFlagConfig) {
    this.flags = new Map();

    // Initialize from config
    if (config?.flags) {
      for (const [flag, enabled] of Object.entries(config.flags)) {
        this.flags.set(flag as FeatureFlag, enabled);
      }
    }

    // Load from environment variables (overrides config)
    this.loadFromEnv();
  }

  /**
   * Check if a feature flag is enabled
   *
   * @param flag - The feature flag to check
   * @returns true if enabled, false otherwise
   */
  isEnabled(flag: FeatureFlag): boolean {
    const enabled = this.flags.get(flag) ?? false;
    logger.debug(`Feature flag check: ${flag} = ${enabled}`);
    return enabled;
  }

  /**
   * Enable a feature flag
   *
   * @param flag - The feature flag to enable
   */
  enable(flag: FeatureFlag): void {
    logger.info(`Enabling feature flag: ${flag}`);
    this.flags.set(flag, true);
  }

  /**
   * Disable a feature flag
   *
   * @param flag - The feature flag to disable
   */
  disable(flag: FeatureFlag): void {
    logger.info(`Disabling feature flag: ${flag}`);
    this.flags.set(flag, false);
  }

  /**
   * Get all enabled feature flags
   *
   * @returns Array of enabled feature flag names
   */
  getEnabled(): FeatureFlag[] {
    return Array.from(this.flags.entries())
      .filter(([, enabled]) => enabled)
      .map(([flag]) => flag);
  }

  /**
   * Load feature flags from environment variables
   *
   * Environment variables should be in the format: FEATURE_FLAG_NAME=true
   * For example: FEATURE_USE_NEW_SEARCH_ENGINE=true
   */
  private loadFromEnv(): void {
    for (const flag of Object.values(FeatureFlag)) {
      const envVar = `FEATURE_${flag.toUpperCase()}`;
      const envValue = process.env[envVar];

      if (envValue !== undefined) {
        const enabled = envValue === 'true' || envValue === '1';
        this.flags.set(flag, enabled);
        logger.info(`Loaded from env: ${flag} = ${enabled}`);
      }
    }
  }
}

// Global singleton instance
export const featureFlags = new FeatureFlags();
