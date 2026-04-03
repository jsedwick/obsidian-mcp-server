/**
 * MCP Result Size Annotation
 *
 * Adds `_meta["anthropic/maxResultSizeChars"]` to tool results that exceed
 * a size threshold. This tells Claude Code to allow larger MCP tool results
 * through without truncation (up to the 500K limit).
 *
 * Without this annotation, Claude Code applies a default truncation limit
 * that can cut off large search results, full topic content, and session data.
 */

/** Maximum allowed by Claude Code */
const MAX_RESULT_SIZE_CHARS = 500_000;

/** Only annotate responses above this threshold (chars) */
const ANNOTATION_THRESHOLD = 5_000;

interface ContentBlock {
  type: string;
  text?: string;
}

interface ToolResult {
  content: ContentBlock[];
  _meta?: Record<string, unknown>;
}

/**
 * Annotates a tool result with `_meta["anthropic/maxResultSizeChars"]` if the
 * response text exceeds the annotation threshold. The annotation value is set
 * to the actual content size (capped at 500K), giving Claude Code permission
 * to pass the full result through.
 *
 * Small responses are returned unchanged (no annotation overhead).
 */
export function annotateResultSize<T extends ToolResult>(
  result: T
): T & { _meta?: Record<string, unknown> } {
  const totalChars = result.content.reduce((sum, block) => {
    return sum + (block.text?.length || 0);
  }, 0);

  if (totalChars <= ANNOTATION_THRESHOLD) {
    return result;
  }

  const maxResultSize = Math.min(totalChars, MAX_RESULT_SIZE_CHARS);

  return {
    ...result,
    _meta: {
      ...result._meta,
      'anthropic/maxResultSizeChars': maxResultSize,
    },
  };
}
