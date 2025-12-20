/**
 * Tool: append_to_accumulator
 *
 * Append content to accumulator files - running logs that preserve context across sessions.
 * Accumulators are append-only to prevent accidental overwrites.
 *
 * Common use cases:
 * - accumulator-corrections.md: Record mistakes and corrections for learning
 * - accumulator-learnings.md: Quick insights that don't warrant full topics yet
 * - accumulator-questions.md: Persistent curiosities spanning sessions
 *
 * Inspired by duckdb-kb's append_accumulator pattern for incremental knowledge capture.
 */

import fs from 'fs/promises';
import path from 'path';
import { isProtectedFile } from '../../utils/protectedFiles.js';

export interface AppendToAccumulatorArgs {
  filename: string; // Accumulator filename (must match accumulator-*.md pattern)
  content: string; // Content to append
  add_timestamp?: boolean; // Add timestamp to entry (default: true)
}

export interface AppendToAccumulatorResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface AppendToAccumulatorContext {
  vaultPath: string;
  trackFileAccess?: (path: string, action: 'read' | 'edit' | 'create') => void;
}

/**
 * Template for creating new accumulator files
 */
function generateAccumulatorTemplate(title: string): string {
  return `# ${title}

**Running record of incremental insights and learnings. Each entry is timestamped and append-only. This preserves context across sessions without requiring formal topic structure.**

---

## Entries

`;
}

/**
 * Validate accumulator filename follows the pattern
 */
function validateAccumulatorFilename(filename: string): void {
  if (!filename.startsWith('accumulator-')) {
    throw new Error(
      `❌ Invalid accumulator filename: ${filename}\n\n` +
        'Accumulator files must follow the pattern: accumulator-{name}.md\n\n' +
        'Examples:\n' +
        '  - accumulator-corrections.md\n' +
        '  - accumulator-learnings.md\n' +
        '  - accumulator-questions.md'
    );
  }

  if (!filename.endsWith('.md')) {
    throw new Error(
      `❌ Invalid accumulator filename: ${filename}\n\n` + 'Accumulator files must end with .md'
    );
  }

  // Check that it matches the protected file pattern
  if (!isProtectedFile(filename)) {
    throw new Error(`❌ Internal error: ${filename} does not match protected accumulator pattern`);
  }
}

export async function appendToAccumulator(
  args: AppendToAccumulatorArgs,
  context: AppendToAccumulatorContext
): Promise<AppendToAccumulatorResult> {
  // Validate filename
  validateAccumulatorFilename(args.filename);

  const filePath = path.join(context.vaultPath, args.filename);
  const addTimestamp = args.add_timestamp !== false; // Default to true

  // Check if file exists
  let fileExists = false;
  try {
    await fs.access(filePath);
    fileExists = true;
  } catch {
    // File doesn't exist - will create it
  }

  let resultMessage: string;

  if (!fileExists) {
    // Create new accumulator with template
    const accumulatorName = args.filename
      .replace('accumulator-', '')
      .replace('.md', '')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    const title = `Accumulator: ${accumulatorName}`;
    const template = generateAccumulatorTemplate(title);

    // Add first entry
    const timestamp = addTimestamp ? `\n**${new Date().toISOString().split('T')[0]}**\n\n` : '\n';
    const newContent = template + timestamp + args.content + '\n';

    await fs.writeFile(filePath, newContent, 'utf-8');

    if (context.trackFileAccess) {
      context.trackFileAccess(filePath, 'create');
    }

    resultMessage =
      `✅ Created new accumulator: ${args.filename}\n\n` +
      `File: ${filePath}\n\n` +
      `Added first entry with ${addTimestamp ? 'timestamp' : 'no timestamp'}`;
  } else {
    // Append to existing accumulator
    const existingContent = await fs.readFile(filePath, 'utf-8');

    const timestamp = addTimestamp ? `\n**${new Date().toISOString().split('T')[0]}**\n\n` : '\n';
    const newContent = existingContent + timestamp + args.content + '\n';

    await fs.writeFile(filePath, newContent, 'utf-8');

    if (context.trackFileAccess) {
      context.trackFileAccess(filePath, 'edit');
    }

    resultMessage =
      `✅ Appended to accumulator: ${args.filename}\n\n` +
      `File: ${filePath}\n\n` +
      `Added entry with ${addTimestamp ? 'timestamp' : 'no timestamp'}`;
  }

  return {
    content: [
      {
        type: 'text',
        text: resultMessage,
      },
    ],
  };
}
