/**
 * Tool: get_memory_base
 *
 * Description: Retrieve the vault index file showing recently modified files.
 * Used at session start for user orientation (see recent work) and to establish
 * session timing for the two-phase close workflow's commit detection.
 *
 * Note: This provides file existence awareness, not semantic context.
 * Claude still needs search_vault for substantive questions about content.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetMemoryBaseArgs {
  // No arguments needed - reads from fixed location
}

export interface GetMemoryBaseResult {
  content: Array<{ type: string; text: string }>;
}

export async function getMemoryBase(
  _args: GetMemoryBaseArgs,
  vaultPath: string
): Promise<GetMemoryBaseResult> {
  const memoryFilePath = path.join(vaultPath, 'memory-base.md');
  const userRefPath = path.join(vaultPath, 'user-reference.md');

  // Try to load user reference if it exists
  let userRefContent = '';
  try {
    userRefContent = await fs.readFile(userRefPath, 'utf-8');
  } catch (error) {
    // File doesn't exist - that's fine
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.warn('Failed to read user-reference.md:', (error as Error).message);
    }
  }

  try {
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    const stats = await fs.stat(memoryFilePath);

    // Count session boundaries
    const sessionCount = (content.match(/### --- SESSION BOUNDARY/g) || []).length;
    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    const memoryInfo = `Rolling memory base contents:\n\n${content}\n\n---\nMetadata:\n- Size: ${sizeBytes} bytes\n- Last modified: ${stats.mtime.toISOString()}\n- Session count: ${sessionCount}`;

    // Prepend user reference content if available
    const fullContent = userRefContent ? `${userRefContent}\n\n---\n\n${memoryInfo}` : memoryInfo;

    return {
      content: [
        {
          type: 'text',
          text: fullContent,
        },
      ],
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return {
        content: [
          {
            type: 'text',
            text:
              userRefContent ||
              'Rolling memory base is empty. No previous session context available.',
          },
        ],
      };
    }
    throw error;
  }
}
