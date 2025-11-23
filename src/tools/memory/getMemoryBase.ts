/**
 * Tool: get_memory_base
 *
 * Description: Retrieve the current contents of the rolling memory file.
 * Used at session start to provide continuity from recent conversations.
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

  try {
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    const stats = await fs.stat(memoryFilePath);

    // Count session boundaries
    const sessionCount = (content.match(/### --- SESSION BOUNDARY/g) || []).length;
    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: `Rolling memory base contents:\n\n${content}\n\n---\nMetadata:\n- Size: ${sizeBytes} bytes\n- Last modified: ${stats.mtime.toISOString()}\n- Session count: ${sessionCount}`,
        },
      ],
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return {
        content: [
          {
            type: 'text',
            text: 'Rolling memory base is empty. No previous session context available.',
          },
        ],
      };
    }
    throw error;
  }
}
