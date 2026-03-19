/**
 * Security layer types and configuration interfaces.
 *
 * Defines the configuration schema for the 6-layer security architecture
 * and the context objects passed through the security pipeline.
 */

/** Top-level security configuration in .obsidian-mcp.json */
export interface SecurityConfig {
  /** Master kill-switch. Default: true */
  enabled: boolean;
  sanitization: SanitizationConfig;
  accessControl: AccessControlConfig;
  governor?: GovernorConfig;
  redaction?: RedactionConfig;
}

/** Layer 1: Input sanitization configuration */
export interface SanitizationConfig {
  /** Max length for regular string fields. Default: 100_000 */
  maxStringLength: number;
  /** Max length for content fields (content, entry, summary). Default: 500_000 */
  maxContentLength: number;
  /** Additional regex patterns to block (user-configurable) */
  blockPatterns: string[];
  /** Strip null bytes from all string inputs. Default: true */
  stripNullBytes: boolean;
  /** Normalize Unicode to NFC form. Default: true */
  normalizeUnicode: boolean;
}

/** Layer 6: Access control configuration */
export interface AccessControlConfig {
  /** Resolve symlinks before path validation. Default: true */
  resolveSymlinks: boolean;
  /** Additional allowed path roots beyond vault paths */
  allowedPaths: string[];
  /** Explicit deny list (takes precedence over allowed) */
  deniedPaths: string[];
  /** Glob patterns to deny (e.g., "**\/.env") */
  deniedPatterns: string[];
}

/** Layer 5: Runtime governance configuration (Phase 2) */
export interface GovernorConfig {
  /** Max tool calls per minute across all tools. Default: 120 */
  maxCallsPerMinute: number;
  /** Max calls per minute per individual tool. Default: 30 */
  maxCallsPerTool: number;
  /** Loop detection settings */
  loopDetection: {
    /** Number of recent calls to examine. Default: 20 */
    windowSize: number;
    /** Max identical calls within window. Default: 5 */
    repeatThreshold: number;
  };
}

/** Layer 4: Output redaction configuration (Phase 2) */
export interface RedactionConfig {
  /** Enable output redaction. Default: false */
  enabled: boolean;
  /** Redaction patterns (built-in + user-defined) */
  patterns: RedactionPattern[];
}

/** A single redaction pattern definition */
export interface RedactionPattern {
  /** Human-readable name for this pattern */
  name: string;
  /** Regex pattern string */
  regex: string;
  /** Replacement text, e.g., "[REDACTED_EMAIL]" */
  replacement: string;
}

/** Context passed through the security pipeline for each tool call */
export interface SecurityContext {
  toolName: string;
  args: Record<string, unknown>;
  /** All active vault paths (primary + secondary) */
  vaultPaths: string[];
  primaryVaultPath: string;
  secondaryVaultPaths: string[];
  timestamp: Date;
}
