/**
 * Validation utilities for MCP tool inputs
 *
 * Provides centralized validation with helpful error messages.
 * All tool arguments are validated against Zod schemas before execution.
 */

import { z } from 'zod';
import { ValidationSchemas, TOOL_NAMES } from './schemas.js';

/**
 * Validation error with user-friendly formatting
 */
export class ValidationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly zodError: z.ZodError,
    public readonly rawArgs: unknown
  ) {
    super(ValidationError.formatErrorMessage(toolName, zodError));
    this.name = 'ValidationError';
  }

  /**
   * Format Zod errors into user-friendly messages
   */
  private static formatErrorMessage(toolName: string, error: z.ZodError): string {
    const issues = error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `  • ${path}: ${issue.message}`;
    }).join('\n');

    return `Invalid arguments for tool "${toolName}":\n\n${issues}\n\nPlease check your input and try again.`;
  }

  /**
   * Get a detailed error report (useful for debugging)
   */
  getDetailedReport(): string {
    let report = `Validation Error Report\n`;
    report += `${'='.repeat(50)}\n`;
    report += `Tool: ${this.toolName}\n`;
    report += `Timestamp: ${new Date().toISOString()}\n\n`;
    report += `Raw Arguments:\n`;
    report += JSON.stringify(this.rawArgs, null, 2);
    report += `\n\nValidation Issues:\n`;
    report += this.zodError.issues.map((issue, idx) => {
      return `${idx + 1}. Path: ${issue.path.join('.') || '(root)'}\n   Code: ${issue.code}\n   Message: ${issue.message}`;
    }).join('\n\n');
    return report;
  }
}

/**
 * Validate tool arguments against their schema
 *
 * @param toolName - The name of the tool being validated
 * @param args - The arguments to validate
 * @returns Validated and typed arguments
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const args = validateToolArgs('search_vault', {
 *   query: 'test',
 *   max_results: 10
 * });
 * // args is now typed as SearchVaultArgs and validated
 * ```
 */
export function validateToolArgs<T extends keyof typeof ValidationSchemas>(
  toolName: T,
  args: unknown
): z.infer<typeof ValidationSchemas[T]> {
  // Check if tool exists in registry
  if (!TOOL_NAMES.includes(toolName)) {
    throw new Error(
      `Unknown tool: "${toolName}". ` +
      `Available tools: ${TOOL_NAMES.join(', ')}`
    );
  }

  // Get the schema for this tool
  const schema = ValidationSchemas[toolName];

  try {
    // Validate and return typed result
    return schema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError(toolName, error, args);
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Safely validate tool arguments, returning a result object instead of throwing
 *
 * Useful when you want to handle validation errors without try-catch.
 *
 * @param toolName - The name of the tool being validated
 * @param args - The arguments to validate
 * @returns Object with success flag and either data or error
 *
 * @example
 * ```typescript
 * const result = safeValidateToolArgs('search_vault', args);
 * if (result.success) {
 *   console.log('Valid args:', result.data);
 * } else {
 *   console.error('Validation failed:', result.error.message);
 * }
 * ```
 */
export function safeValidateToolArgs<T extends keyof typeof ValidationSchemas>(
  toolName: T,
  args: unknown
):
  | { success: true; data: z.infer<typeof ValidationSchemas[T]> }
  | { success: false; error: ValidationError } {
  try {
    const data = validateToolArgs(toolName, args);
    return { success: true, data };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { success: false, error };
    }
    // Convert unexpected errors to ValidationError
    const validationError = new ValidationError(
      toolName,
      new z.ZodError([{
        code: 'custom',
        path: [],
        message: error instanceof Error ? error.message : String(error)
      }]),
      args
    );
    return { success: false, error: validationError };
  }
}

/**
 * Get the Zod schema for a specific tool
 *
 * Useful for advanced validation scenarios or schema introspection.
 *
 * @param toolName - The name of the tool
 * @returns The Zod schema for the tool's arguments
 *
 * @example
 * ```typescript
 * const schema = getValidationSchema('search_vault');
 * const shape = schema.shape; // Access schema properties
 * ```
 */
export function getValidationSchema<T extends keyof typeof ValidationSchemas>(
  toolName: T
): typeof ValidationSchemas[T] {
  if (!TOOL_NAMES.includes(toolName)) {
    throw new Error(
      `Unknown tool: "${toolName}". ` +
      `Available tools: ${TOOL_NAMES.join(', ')}`
    );
  }

  return ValidationSchemas[toolName];
}

/**
 * Validate multiple tool calls in a batch
 *
 * Useful when processing multiple tool invocations at once.
 *
 * @param calls - Array of tool calls with name and arguments
 * @returns Array of validation results
 *
 * @example
 * ```typescript
 * const results = validateBatch([
 *   { toolName: 'search_vault', args: { query: 'test' } },
 *   { toolName: 'create_topic_page', args: { topic: 'foo', content: 'bar' } }
 * ]);
 *
 * const allValid = results.every(r => r.success);
 * ```
 */
export function validateBatch(
  calls: Array<{ toolName: keyof typeof ValidationSchemas; args: unknown }>
): Array<
  | { success: true; toolName: string; data: unknown }
  | { success: false; toolName: string; error: ValidationError }
> {
  return calls.map(({ toolName, args }) => {
    const result = safeValidateToolArgs(toolName, args);
    if (result.success) {
      return { success: true, toolName, data: result.data };
    } else {
      return { success: false, toolName, error: result.error };
    }
  });
}

/**
 * Check if a value would pass validation without throwing
 *
 * @param toolName - The name of the tool
 * @param args - The arguments to check
 * @returns true if valid, false otherwise
 *
 * @example
 * ```typescript
 * if (isValid('search_vault', args)) {
 *   // Proceed with the call
 * }
 * ```
 */
export function isValid<T extends keyof typeof ValidationSchemas>(
  toolName: T,
  args: unknown
): boolean {
  const result = safeValidateToolArgs(toolName, args);
  return result.success;
}

// Re-export schemas for advanced use cases
export { ValidationSchemas, TOOL_NAMES } from './schemas.js';
export type { InferSchemaType } from './schemas.js';
