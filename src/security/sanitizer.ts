/**
 * Layer 1: Input Sanitization
 *
 * Regex-based sanitization applied to all tool arguments before execution.
 * Catches known-bad patterns at near-zero cost (no LLM calls).
 */

import { createLogger } from '../utils/logger.js';
import { SecurityError } from '../utils/errors.js';
import type { SanitizationConfig, SecurityContext } from './types.js';

const logger = createLogger('Security:Sanitizer');

export const DEFAULT_SANITIZATION_CONFIG: SanitizationConfig = {
  maxStringLength: 100_000,
  maxContentLength: 500_000,
  blockPatterns: [],
  stripNullBytes: true,
  normalizeUnicode: true,
};

/** Fields that carry large content bodies (use maxContentLength) */
const CONTENT_FIELDS = new Set([
  'content',
  'entry',
  'summary',
  'handoff_summary',
  'description',
  'body',
]);

/** Built-in dangerous patterns — always checked */
const DANGEROUS_PATTERNS: Array<{ name: string; regex: RegExp; description: string }> = [
  {
    name: 'encoded_path_traversal',
    regex: /%2e%2e(?:%2f|%5c)/i,
    description: 'URL-encoded path traversal sequence',
  },
  {
    name: 'null_byte_injection',
    regex: /%00/,
    description: 'URL-encoded null byte',
  },
  {
    name: 'unicode_direction_override',
    regex: /[\u202A-\u202E\u2066-\u2069]/,
    description: 'Unicode bidirectional override character',
  },
  {
    name: 'zero_width_chars',
    regex: /[\u200B-\u200F\uFEFF]/,
    description: 'Zero-width or invisible Unicode character',
  },
];

/**
 * Sanitize all string values in a tool's arguments.
 * Returns a new sanitized args object (does not mutate original).
 * Throws SecurityError if dangerous patterns are detected.
 */
export function sanitizeArgs(
  ctx: SecurityContext,
  config: SanitizationConfig
): Record<string, unknown> {
  const compiledBlockPatterns = config.blockPatterns
    .map((p, i) => {
      try {
        return {
          name: `custom_${i}`,
          regex: new RegExp(p, 'i'),
          description: `Custom block pattern: ${p}`,
        };
      } catch {
        logger.warn('Invalid custom block pattern, skipping', { pattern: p, tool: ctx.toolName });
        return null;
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const allPatterns = [...DANGEROUS_PATTERNS, ...compiledBlockPatterns];

  return deepSanitize(ctx.args, allPatterns, config, ctx.toolName, []);
}

/**
 * Deep-walk an object, sanitizing all string values.
 */
function deepSanitize(
  obj: Record<string, unknown>,
  patterns: Array<{ name: string; regex: RegExp; description: string }>,
  config: SanitizationConfig,
  toolName: string,
  path: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fieldPath = [...path, key];

    if (typeof value === 'string') {
      result[key] = sanitizeString(value, key, patterns, config, toolName, fieldPath);
    } else if (Array.isArray(value)) {
      result[key] = (value as unknown[]).map((item: unknown, i: number) => {
        if (typeof item === 'string') {
          return sanitizeString(item, key, patterns, config, toolName, [...fieldPath, String(i)]);
        } else if (item && typeof item === 'object') {
          return deepSanitize(item as Record<string, unknown>, patterns, config, toolName, [
            ...fieldPath,
            String(i),
          ]);
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      result[key] = deepSanitize(
        value as Record<string, unknown>,
        patterns,
        config,
        toolName,
        fieldPath
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitize a single string value.
 */
function sanitizeString(
  value: string,
  fieldName: string,
  patterns: Array<{ name: string; regex: RegExp; description: string }>,
  config: SanitizationConfig,
  toolName: string,
  fieldPath: string[]
): string {
  let sanitized = value;

  // Strip null bytes
  if (config.stripNullBytes) {
    sanitized = sanitized.replace(/\0/g, '');
  }

  // Normalize Unicode
  if (config.normalizeUnicode) {
    sanitized = sanitized.normalize('NFC');
  }

  // Enforce length limits
  const maxLength = CONTENT_FIELDS.has(fieldName)
    ? config.maxContentLength
    : config.maxStringLength;
  if (sanitized.length > maxLength) {
    logger.warn('Input truncated due to length limit', {
      tool: toolName,
      field: fieldPath.join('.'),
      originalLength: sanitized.length,
      maxLength,
    });
    sanitized = sanitized.slice(0, maxLength);
  }

  // Check dangerous patterns
  for (const pattern of patterns) {
    if (pattern.regex.test(sanitized)) {
      logger.warn('Dangerous pattern detected in input', {
        tool: toolName,
        field: fieldPath.join('.'),
        pattern: pattern.name,
        description: pattern.description,
      });
      throw new SecurityError(
        `Input blocked: ${pattern.description} detected in field "${fieldPath.join('.')}"`,
        { tool: toolName, field: fieldPath.join('.'), pattern: pattern.name }
      );
    }
  }

  return sanitized;
}
